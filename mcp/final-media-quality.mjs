import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { runProcess } from "./media-execution.mjs";

export const DELIVERY_TIERS = Object.freeze(["preview", "review", "publish"]);

const QUALITY_PROFILES = Object.freeze({
  preview: { minimumLufs: -30, maximumLufs: -8, maximumTruePeakDbfs: 1, durationToleranceSeconds: 1, maximumAvDurationDeltaSeconds: 0.2, allowMockComponents: true, requireFullFrameAudit: true },
  review: { minimumLufs: -24, maximumLufs: -10, maximumTruePeakDbfs: 0, durationToleranceSeconds: 0.5, maximumAvDurationDeltaSeconds: 0.1, allowMockComponents: true, requireFullFrameAudit: true },
  publish: { minimumLufs: -24, maximumLufs: -9, maximumTruePeakDbfs: -1, durationToleranceSeconds: 0.25, maximumAvDurationDeltaSeconds: 0.05, allowMockComponents: false, requireFullFrameAudit: true }
});

const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 18;
const HASH_DISTANCE_THRESHOLD = 0.12;
const MOTION_DELTA_THRESHOLD = 0.004;
const FREEZE_DELTA_THRESHOLD = 0.0015;

export async function analyzeFinalMediaQuality({ run, media, deliveryTier, mockComponents = [], rightsStatus, visualContinuityMode = "multi_shot", singleTakeApprovalRef = null, timeoutMs = 120000 }, options = {}) {
  if (!DELIVERY_TIERS.includes(deliveryTier)) throw new Error(`Unsupported delivery tier: ${deliveryTier}`);
  const expectation = await deriveVisualExpectation(run, media.durationSeconds, visualContinuityMode);
  const visual = options.visual ?? await sampleVisualDiversity({ videoPath: media.videoPath, durationSeconds: media.durationSeconds, timeoutMs }, options);
  let frameAudit = options.frameAudit ?? null;
  if (!frameAudit) {
    try { frameAudit = await auditEveryFrame({ media, timeoutMs, motionExemptions: expectation.motionExemptions ?? [] }, options); }
    catch (error) { frameAudit = { schemaVersion: "1.0", auditMode: "exhaustive_decoded_frames", passed: false, blockers: ["decode_failed"], defectEvidence: [{ code: "decode_failed", detail: error instanceof Error ? error.message : String(error) }] }; }
  }
  let audio = options.audio ?? null;
  let audioAnalysisError = null;
  if (media.audioStreams?.length && !audio) {
    try { audio = await analyzeAudioLoudness({ videoPath: media.videoPath, timeoutMs }, options); }
    catch (error) { audioAnalysisError = error instanceof Error ? error.message : String(error); }
  }
  return evaluateFinalMediaQuality({
    deliveryTier, durationSeconds: media.durationSeconds, mockComponents, rightsStatus,
    visual, frameAudit, audio, audioAnalysisError, mediaIntegrity: media.mediaIntegrity ?? null, expectedVisualClusters: expectation.expectedVisualClusters,
    visualExpectation: expectation, visualContinuityMode, singleTakeApprovalRef,
    audioRequired: Boolean(media.audioStreams?.length)
  });
}

export function evaluateFinalMediaQuality(input) {
  const profile = QUALITY_PROFILES[input.deliveryTier];
  if (!profile) throw new Error(`Unsupported delivery tier: ${input.deliveryTier}`);
  const blockers = [];
  const warnings = [];
  const targetDurationSeconds = Number(input.visualExpectation?.targetDurationSeconds ?? 0);
  if (targetDurationSeconds > 0 && Math.abs(input.durationSeconds - targetDurationSeconds) > profile.durationToleranceSeconds) blockers.push(`duration:${round(input.durationSeconds)}_outside_${targetDurationSeconds}±${profile.durationToleranceSeconds}`);
  if (input.visualContinuityMode === "single_take" && !input.singleTakeApprovalRef) blockers.push("single_take_requires_approval_evidence");
  if (!input.visual || input.visual.sampleCount < 2) blockers.push("visual_sampling_insufficient");
  else if (input.visual.uniqueVisualClusters < input.expectedVisualClusters) blockers.push(`visual_diversity:${input.visual.uniqueVisualClusters}<${input.expectedVisualClusters}`);
  if (profile.requireFullFrameAudit) {
    if (!input.frameAudit) blockers.push("full_frame_audit_missing");
    else if (!input.frameAudit.passed) blockers.push(...input.frameAudit.blockers.map((item) => `frame_audit:${item}`));
  }
  if (input.mediaIntegrity?.avDurationDeltaSeconds != null && input.mediaIntegrity.avDurationDeltaSeconds > profile.maximumAvDurationDeltaSeconds) blockers.push(`av_duration_delta:${input.mediaIntegrity.avDurationDeltaSeconds}>${profile.maximumAvDurationDeltaSeconds}`);
  if (input.audioRequired) {
    if (input.audioAnalysisError || !input.audio) blockers.push(`audio_analysis_failed:${input.audioAnalysisError ?? "missing evidence"}`);
    else {
      if (input.audio.integratedLufs < profile.minimumLufs || input.audio.integratedLufs > profile.maximumLufs) blockers.push(`integrated_loudness:${input.audio.integratedLufs}_outside_${profile.minimumLufs}_${profile.maximumLufs}`);
      if (input.audio.truePeakDbfs > profile.maximumTruePeakDbfs) blockers.push(`true_peak:${input.audio.truePeakDbfs}>${profile.maximumTruePeakDbfs}`);
    }
  }
  if (!profile.allowMockComponents && input.mockComponents.length) blockers.push(`publish_mock_components:${input.mockComponents.join(",")}`);
  else if (input.mockComponents.length) warnings.push(`non_publish_components:${input.mockComponents.join(",")}`);
  if (input.deliveryTier !== "publish") warnings.push(`delivery_tier:${input.deliveryTier}`);
  const passed = blockers.length === 0;
  const reviewRequired = !passed && blockers.every(isReviewCandidateQualityBlocker);
  return {
    schemaVersion: "1.0",
    deliveryTier: input.deliveryTier,
    status: passed ? `${input.deliveryTier}_ready` : reviewRequired ? "review_required" : "repair_required",
    passed,
    reviewRequired,
    blockers,
    warnings,
    visual: { ...input.visual, expectedVisualClusters: input.expectedVisualClusters, expectation: input.visualExpectation },
    frameAudit: input.frameAudit ?? null,
    mediaIntegrity: input.mediaIntegrity ?? null,
    audio: input.audio,
    audioProfile: profile,
    mockComponents: input.mockComponents,
    rightsStatus: input.rightsStatus,
    visualContinuityMode: input.visualContinuityMode,
    singleTakeApprovalRef: input.singleTakeApprovalRef,
    checkedAt: new Date().toISOString()
  };
}

export function updateQualityFrameAudit(quality, frameAudit) {
  const blockers = [...(quality.blockers ?? []).filter((item) => !String(item).startsWith("frame_audit:"))];
  if (!frameAudit?.passed) blockers.push(...(frameAudit?.blockers ?? ["missing"]).map((item) => `frame_audit:${item}`));
  const warnings = [...new Set([...(quality.warnings ?? []), ...(frameAudit?.frameIdentity?.variableFrameRateDetected ? ["variable_frame_rate_pts_identity_required"] : [])])];
  const passed = blockers.length === 0;
  const reviewRequired = !passed && blockers.every(isReviewCandidateQualityBlocker);
  return {
    ...quality,
    frameAudit,
    blockers,
    warnings,
    passed,
    reviewRequired,
    status: passed ? `${quality.deliveryTier}_ready` : reviewRequired ? "review_required" : "repair_required",
    checkedAt: new Date().toISOString()
  };
}

export async function auditEveryFrame({ media, timeoutMs = 120000, motionExemptions = [] }, options = {}) {
  const stream = media.videoStreams?.[0] ?? {};
  const fps = parseFrameRate(stream.avg_frame_rate ?? stream.r_frame_rate) || Number(options.fps) || 30;
  const declaredFrameCount = Number(stream.nb_read_frames ?? stream.nb_frames);
  const hasDeclaredFrameCount = Number.isFinite(declaredFrameCount) && declaredFrameCount > 0;
  const expectedFrameCount = hasDeclaredFrameCount ? declaredFrameCount : Math.max(1, Math.round(media.durationSeconds * fps));
  const filter = `scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT}:flags=area,format=gray`;
  const args = ["-v", "error", "-xerror", "-copyts", "-i", media.videoPath, "-vf", filter, "-an", "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "-"];
  const exemptFrameRanges = motionExemptions.map((range) => ({ startFrame: Math.max(0, Math.floor(range.startSeconds * fps)), endFrame: Math.max(0, Math.ceil(range.endSeconds * fps)) }));
  const auditOptions = { sampleWidth: SAMPLE_WIDTH, sampleHeight: SAMPLE_HEIGHT, fps, expectedFrameCount, expectedFrameCountSource: hasDeclaredFrameCount ? (stream.nb_read_frames != null ? "ffprobe.nb_read_frames" : "stream.nb_frames") : "duration_times_nominal_fps", expectedFrameCountIsExact: hasDeclaredFrameCount, exemptFrameRanges, decodeReachedEof: true };
  if (options.frameAuditBytes) return summarizeFrameAudit(options.frameAuditBytes, auditOptions);
  if (options.frameAuditChunks) {
    const accumulator = createFrameAuditAccumulator(auditOptions);
    for (const chunk of options.frameAuditChunks) accumulator.pushBytes(chunk);
    return accumulator.finish();
  }
  return runStreamingFrameAuditProcess(options.ffmpegCommand ?? "ffmpeg", options.frameAuditArgs ?? args, { timeoutMs, auditOptions: { ...auditOptions, decodeReachedEof: false } });
}

export function summarizeFrameAudit(bytes, { sampleWidth = SAMPLE_WIDTH, sampleHeight = SAMPLE_HEIGHT, fps = 30, expectedFrameCount = null, expectedFrameCountSource = "caller", expectedFrameCountIsExact = expectedFrameCount != null && Number.isFinite(Number(expectedFrameCount)), exemptFrameRanges = [], decodeReachedEof = true } = {}) {
  const accumulator = createFrameAuditAccumulator({ sampleWidth, sampleHeight, fps, expectedFrameCount, expectedFrameCountSource, expectedFrameCountIsExact, exemptFrameRanges, decodeReachedEof });
  accumulator.pushBytes(bytes);
  return accumulator.finish();
}

export function createFrameAuditAccumulator({ sampleWidth = SAMPLE_WIDTH, sampleHeight = SAMPLE_HEIGHT, fps = 30, expectedFrameCount = null, expectedFrameCountSource = "caller", expectedFrameCountIsExact = expectedFrameCount != null && Number.isFinite(Number(expectedFrameCount)), exemptFrameRanges = [], decodeReachedEof = true } = {}) {
  const frameSize = sampleWidth * sampleHeight;
  let auditedFrameCount = 0;
  let blackFrameCount = 0;
  let whiteFrameCount = 0;
  let flashFrameCount = 0;
  let lowMotionTransitions = 0;
  let exemptTransitionCount = 0;
  let frozenRun = 0;
  let frozenRunStart = null;
  let longestFrozenRunFrames = 0;
  let longestFrozenRunStartFrame = null;
  const blackFrameIndices = [];
  const whiteFrameIndices = [];
  const flashFrameIndices = [];
  const blackIntervals = [];
  const whiteIntervals = [];
  const flashIntervals = [];
  const frozenIntervals = [];
  const intervalStarts = { black_frame: null, white_frame: null, flash_frame: null };
  let intervalsTruncated = false;
  let pendingBytes = Buffer.alloc(0);
  let previous = null;
  let previousMean = null;
  let finishedReport = null;
  let reachedEof = Boolean(decodeReachedEof);

  function pushFrame(frame) {
    if (frame.length !== frameSize) throw new Error("Frame audit received an incomplete analysis frame.");
    const index = auditedFrameCount;
    auditedFrameCount += 1;
    const mean = frame.reduce((sum, value) => sum + value, 0) / frameSize;
    const variance = frame.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / frameSize;
    const black = mean < 8 && variance < 16;
    const white = mean > 247 && variance < 16;
    if (black) { blackFrameCount += 1; pushBounded(blackFrameIndices, index); }
    if (white) { whiteFrameCount += 1; pushBounded(whiteFrameIndices, index); }
    updateInterval("black_frame", black, index, blackIntervals);
    updateInterval("white_frame", white, index, whiteIntervals);
    if (previous) {
      let delta = 0;
      for (let pixel = 0; pixel < frameSize; pixel += 1) delta += Math.abs(frame[pixel] - previous[pixel]);
      const normalizedDelta = delta / (frameSize * 255);
      const exempt = exemptFrameRanges.some((range) => index >= range.startFrame && index <= range.endFrame);
      if (exempt) exemptTransitionCount += 1;
      if (normalizedDelta < MOTION_DELTA_THRESHOLD && !exempt) lowMotionTransitions += 1;
      if (normalizedDelta < FREEZE_DELTA_THRESHOLD && !exempt) {
        frozenRunStart ??= index - 1;
        frozenRun += 1;
      } else {
        finishFrozenRun(index - 1);
        frozenRun = 0;
        frozenRunStart = null;
      }
      if (frozenRun > longestFrozenRunFrames) { longestFrozenRunFrames = frozenRun; longestFrozenRunStartFrame = frozenRunStart; }
      const flash = Math.abs(mean - previousMean) / 255 > 0.45;
      if (flash) { flashFrameCount += 1; pushBounded(flashFrameIndices, index); }
      updateInterval("flash_frame", flash, index, flashIntervals);
    }
    previous = Buffer.from(frame);
    previousMean = mean;
  }

  function pushBytes(chunk) {
    if (finishedReport) throw new Error("Frame audit cannot accept decoded bytes after it has finished.");
    if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) throw new Error("Frame audit chunks must contain binary decoded-frame data.");
    let input = Buffer.from(chunk);
    if (pendingBytes.length) {
      const needed = frameSize - pendingBytes.length;
      if (input.length < needed) { pendingBytes = Buffer.concat([pendingBytes, input]); return; }
      pushFrame(Buffer.concat([pendingBytes, input.subarray(0, needed)]));
      pendingBytes = Buffer.alloc(0);
      input = input.subarray(needed);
    }
    let offset = 0;
    for (; offset + frameSize <= input.length; offset += frameSize) pushFrame(input.subarray(offset, offset + frameSize));
    if (offset < input.length) pendingBytes = Buffer.from(input.subarray(offset));
  }

  function updateInterval(code, active, frameIndex, collection) {
    if (active && intervalStarts[code] == null) intervalStarts[code] = frameIndex;
    if (!active && intervalStarts[code] != null) {
      addInterval(collection, { code, startFrame: intervalStarts[code], endFrame: frameIndex - 1 });
      intervalStarts[code] = null;
    }
  }

  function addInterval(collection, interval) {
    if (collection.length < 200) collection.push(interval);
    else intervalsTruncated = true;
  }

  function finishFrozenRun(endFrame) {
    if (frozenRunStart == null || frozenRun <= 0) return;
    const durationSeconds = round(frozenRun / Math.max(1, fps));
    if (durationSeconds > 1) addInterval(frozenIntervals, { code: "frozen_run", startFrame: frozenRunStart, endFrame, durationSeconds });
  }

  function finish() {
    if (finishedReport) return finishedReport;
    finishFrozenRun(Math.max(0, auditedFrameCount - 1));
    for (const [code, collection] of [["black_frame", blackIntervals], ["white_frame", whiteIntervals], ["flash_frame", flashIntervals]]) {
      if (intervalStarts[code] != null) addInterval(collection, { code, startFrame: intervalStarts[code], endFrame: Math.max(intervalStarts[code], auditedFrameCount - 1) });
    }
    const expected = Number(expectedFrameCount) || auditedFrameCount;
    const frameCountDelta = auditedFrameCount - expected;
    const missingFrameCount = Math.max(0, -frameCountDelta);
    const overDecodedFrameCount = Math.max(0, frameCountDelta);
    const exactFrameCountParity = frameCountDelta === 0;
    const coverageRatio = expected > 0 ? round(Math.min(1, auditedFrameCount / expected)) : 0;
    const transitionCount = Math.max(0, auditedFrameCount - 1);
    const evaluatedTransitionCount = Math.max(0, transitionCount - exemptTransitionCount);
    const motionCoverage = evaluatedTransitionCount ? round(1 - (lowMotionTransitions / evaluatedTransitionCount)) : 1;
    const longestFrozenRunSeconds = round(longestFrozenRunFrames / Math.max(1, fps));
    const technicalBlockers = [];
    if (!reachedEof) technicalBlockers.push("decode_eof_unconfirmed");
    if (expectedFrameCountIsExact && !exactFrameCountParity) technicalBlockers.push(`frame_count_delta:${frameCountDelta}`);
    else if (!expectedFrameCountIsExact && coverageRatio < 0.98) technicalBlockers.push(`coverage:${coverageRatio}<0.98`);
    if (pendingBytes.length) technicalBlockers.push(`partial_frame_bytes:${pendingBytes.length}`);
    const reviewCandidateBlockers = [];
    if (blackFrameCount) reviewCandidateBlockers.push(`black_frames:${blackFrameCount}`);
    if (whiteFrameCount) reviewCandidateBlockers.push(`white_frames:${whiteFrameCount}`);
    if (flashFrameCount) reviewCandidateBlockers.push(`flash_frames:${flashFrameCount}`);
    if (longestFrozenRunSeconds > 1) reviewCandidateBlockers.push(`frozen_run:${longestFrozenRunSeconds}s`);
    if (evaluatedTransitionCount && motionCoverage < 0.08) reviewCandidateBlockers.push(`motion_coverage:${motionCoverage}<0.08`);
    const blockers = [...technicalBlockers, ...reviewCandidateBlockers];
    const defectIntervals = [...blackIntervals, ...whiteIntervals, ...flashIntervals, ...frozenIntervals]
      .map((interval) => enrichInterval(interval, fps))
      .sort((left, right) => left.startFrame - right.startFrame || left.code.localeCompare(right.code));
    const defectEvidence = defectIntervals.slice(0, 80).map((interval) => ({ ...interval }));
    finishedReport = {
      schemaVersion: "1.2",
      auditMode: "exhaustive_decoded_frames_streaming",
      sampleWidth,
      sampleHeight,
      fps: round(fps),
      expectedFrameCount: expected,
      expectedFrameCountSource,
      expectedFrameCountIsExact: Boolean(expectedFrameCountIsExact),
      auditedFrameCount,
      frameCountDelta,
      missingFrameCount,
      overDecodedFrameCount,
      exactFrameCountParity,
      decodeReachedEof: reachedEof,
      exactCoverage: reachedEof && !pendingBytes.length && Boolean(expectedFrameCountIsExact) && exactFrameCountParity,
      coverageRatio,
      blackFrameCount,
      whiteFrameCount,
      blackFrameIndices,
      whiteFrameIndices,
      flashFrameCount,
      flashFrameIndices,
      corruptFrameCount: null,
      corruptionStatus: reachedEof ? "no_decode_error_observed" : "unknown",
      longestFrozenRunFrames,
      longestFrozenRunStartFrame,
      longestFrozenRunSeconds,
      motionCoverage,
      evaluatedTransitionCount,
      exemptTransitionCount,
      exemptFrameRanges,
      defectIntervals,
      defectEvidence,
      evidenceLimit: 200,
      evidenceTruncated: intervalsTruncated || defectIntervals.length > defectEvidence.length,
      peakAnalysisFrameBytes: frameSize,
      technicalBlockers,
      reviewCandidateBlockers,
      reviewRequired: technicalBlockers.length === 0 && reviewCandidateBlockers.length > 0,
      blockers,
      passed: blockers.length === 0
    };
    return finishedReport;
  }

  function markDecodeComplete() {
    if (finishedReport) throw new Error("Frame audit cannot change decode completion after it has finished.");
    reachedEof = true;
  }

  return { pushBytes, markDecodeComplete, finish };
}

export async function sampleVisualDiversity({ videoPath, durationSeconds, timeoutMs = 120000 }, options = {}) {
  const sampleIntervalSeconds = Math.max(1, Math.min(10, durationSeconds / 12));
  const filter = `fps=1/${sampleIntervalSeconds},crop=iw*0.7:ih*0.55:iw*0.15:ih*0.18,scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT},format=gray,boxblur=2:1`;
  const args = ["-v", "error", "-i", videoPath, "-vf", filter, "-an", "-pix_fmt", "gray", "-f", "rawvideo", "-"];
  const bytes = options.sampleBytes ?? await runBinaryProcess(options.ffmpegCommand ?? "ffmpeg", options.ffmpegArgs ?? args, { timeoutMs, maxOutputBytes: 5_000_000 });
  return summarizeVisualSamples(bytes, { sampleWidth: SAMPLE_WIDTH, sampleHeight: SAMPLE_HEIGHT, sampleIntervalSeconds });
}

export function summarizeVisualSamples(bytes, { sampleWidth = SAMPLE_WIDTH, sampleHeight = SAMPLE_HEIGHT, sampleIntervalSeconds = null } = {}) {
  const frameSize = sampleWidth * sampleHeight;
  const sampleCount = Math.floor(bytes.length / frameSize);
  const hashes = [];
  for (let offset = 0; offset < sampleCount * frameSize; offset += frameSize) hashes.push(averageHash(bytes.subarray(offset, offset + frameSize)));
  const representatives = [];
  const clusterIds = [];
  for (const hash of hashes) {
    let cluster = representatives.findIndex((candidate) => hammingRatio(hash, candidate) < HASH_DISTANCE_THRESHOLD);
    if (cluster < 0) { representatives.push(hash); cluster = representatives.length - 1; }
    clusterIds.push(cluster);
  }
  const adjacentDistanceRatios = hashes.slice(1).map((hash, index) => round(hammingRatio(hashes[index], hash)));
  return {
    sampleCount,
    sampleIntervalSeconds,
    uniqueVisualClusters: representatives.length,
    clusterIds,
    adjacentDistanceRatios,
    averageAdjacentDistance: adjacentDistanceRatios.length ? round(adjacentDistanceRatios.reduce((sum, value) => sum + value, 0) / adjacentDistanceRatios.length) : 0,
    hashMethod: `center-crop-average-hash-${sampleWidth}x${sampleHeight}`,
    clusterDistanceThreshold: HASH_DISTANCE_THRESHOLD
  };
}

export async function analyzeAudioLoudness({ videoPath, timeoutMs = 120000 }, options = {}) {
  const args = ["-hide_banner", "-nostats", "-i", videoPath, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"];
  const result = await runProcess(options.ffmpegCommand ?? "ffmpeg", options.ffmpegArgs ?? args, { cwd: options.cwd ?? process.cwd(), timeoutMs, maxOutputBytes: 1_000_000, failureLabel: "Audio loudness analysis" });
  return parseLoudnessSummary(result.stderr);
}

export function parseLoudnessSummary(stderr) {
  const summary = String(stderr).split("Summary:").at(-1);
  const integratedLufs = Number(summary.match(/Integrated loudness:[\s\S]*?I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/)?.[1]);
  const loudnessRangeLu = Number(summary.match(/Loudness range:[\s\S]*?LRA:\s*(-?\d+(?:\.\d+)?)\s*LU/)?.[1]);
  const truePeakDbfs = Number(summary.match(/True peak:[\s\S]*?Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/)?.[1]);
  if (![integratedLufs, loudnessRangeLu, truePeakDbfs].every(Number.isFinite)) throw new Error("FFmpeg loudness analysis did not return a complete EBU R128 summary.");
  return { integratedLufs, loudnessRangeLu, truePeakDbfs, analyzer: "ffmpeg-ebur128" };
}

async function deriveVisualExpectation(run, durationSeconds, visualContinuityMode) {
  if (visualContinuityMode === "single_take") return { source: "single_take_approval", timelineClipCount: 1, uniqueTimelineSources: 1, expectedVisualClusters: 1, targetDurationSeconds: null };
  const timeline = await readRegisteredJson(run, "semantic_timeline.json");
  const canonicalTracks = Array.isArray(timeline?.tracks) ? timeline.tracks : [];
  const videoClips = canonicalTracks.length
    ? canonicalTracks.filter((track) => ["video", "visual"].includes(track.track_type ?? track.type)).flatMap((track) => track.clips ?? track.items ?? [])
    : timeline?.tracks?.video ?? timeline?.video ?? [];
  const uniqueTimelineSources = new Set(videoClips.map((clip) => clip.artifact_uri ?? clip.artifactUri ?? clip.source ?? clip.assetRef ?? clip.path).filter(Boolean)).size;
  const targetDurationSeconds = Number(timeline?.duration_seconds ?? timeline?.durationSeconds ?? 0) || null;
  const motionExemptions = (timeline?.transition_strategy ?? timeline?.transitionStrategy ?? []).filter((transition) => transition.method === "hold_final_frame" || transition.motion_expected === false).map((transition) => {
    const durationFrames = Number(transition.duration_frames ?? transition.durationFrames ?? 0);
    const duration = durationFrames > 0 ? durationFrames / 30 : 0;
    return { reason: transition.method ?? "declared_hold", startSeconds: Math.max(0, (targetDurationSeconds ?? durationSeconds) - duration), endSeconds: targetDurationSeconds ?? durationSeconds };
  });
  if (videoClips.length) return {
    source: "semantic_timeline.json",
    timelineClipCount: videoClips.length,
    uniqueTimelineSources,
    expectedVisualClusters: Math.max(2, Math.min(6, Math.ceil(Math.max(1, uniqueTimelineSources) * 0.75))),
    targetDurationSeconds,
    motionExemptions
  };
  const shotlist = await readRegisteredJson(run, "shotlist.json");
  const shotCount = shotlist?.shots?.length ?? 0;
  return { source: shotCount ? "shotlist.json" : "duration_default", shotCount, expectedVisualClusters: durationSeconds > 15 ? Math.max(2, Math.min(4, Math.ceil(shotCount / 4))) : 1, targetDurationSeconds: Number(shotlist?.durationSeconds ?? 0) || null };
}

async function readRegisteredJson(run, artifactRef) {
  const path = run.artifacts?.[artifactRef]?.path;
  if (!path) return null;
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return null; }
}

function averageHash(frame) {
  const average = frame.reduce((sum, value) => sum + value, 0) / Math.max(1, frame.length);
  return Uint8Array.from(frame, (value) => value >= average ? 1 : 0);
}

function hammingRatio(left, right) {
  let different = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) different += 1;
  return different / Math.max(1, left.length);
}

function parseFrameRate(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const [numerator, denominator = "1"] = String(value ?? "").split("/").map(Number);
  const result = numerator / denominator;
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function enrichInterval(interval, fps) {
  const startFrame = Math.max(0, interval.startFrame);
  const endFrame = Math.max(startFrame, interval.endFrame);
  const durationSeconds = interval.durationSeconds ?? round(Math.max(1, endFrame - startFrame + 1) / Math.max(1, fps));
  return {
    ...interval,
    startFrame,
    endFrame,
    timeSeconds: round(startFrame / Math.max(1, fps)),
    endSeconds: round((endFrame + 1) / Math.max(1, fps)),
    durationSeconds
  };
}

function pushBounded(collection, value, limit = 200) {
  if (collection.length < limit) collection.push(value);
}

function runStreamingFrameAuditProcess(command, args, { timeoutMs, auditOptions }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const accumulator = createFrameAuditAccumulator(auditOptions);
    let stderr = "";
    let streamError = null;
    let timedOut = false;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (streamError) return;
      try { accumulator.pushBytes(chunk); }
      catch (error) { streamError = error; child.kill("SIGTERM"); }
    });
    child.stdout.once("error", (error) => { streamError = error; child.kill("SIGTERM"); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-20_000); });
    child.once("error", (error) => finish(() => reject(new Error(`Unable to start ${command}: ${error.message}`))));
    child.once("close", (code, signal) => finish(() => {
      if (streamError) return reject(new Error(`Frame audit stream failed: ${streamError.message}`));
      if (timedOut) return reject(new Error(`Frame audit timed out after ${timeoutMs}ms.`));
      if (code !== 0) return reject(new Error(`Frame audit failed (${signal ?? code}): ${stderr.slice(-2000)}`));
      accumulator.markDecodeComplete();
      resolvePromise(accumulator.finish());
    }));
  });
}

function runBinaryProcess(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let size = 0;
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > options.maxOutputBytes) { child.kill("SIGTERM"); return; }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-20_000); });
    child.once("error", (error) => { clearTimeout(timer); reject(new Error(`Unable to start ${command}: ${error.message}`)); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (size > options.maxOutputBytes) return reject(new Error("Visual sampling exceeded the configured output limit."));
      if (code !== 0) return reject(new Error(`Visual sampling failed (${signal ?? code}): ${stderr.slice(-2000)}`));
      resolvePromise(Buffer.concat(chunks));
    });
  });
}

const round = (value) => Math.round(value * 10000) / 10000;

function isReviewCandidateQualityBlocker(blocker) {
  return /^frame_audit:(black_frames:|white_frames:|flash_frames:|frozen_run:|motion_coverage:)/.test(String(blocker));
}
