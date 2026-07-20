import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { runProcess } from "./media-execution.mjs";

const FRAME_IDENTITY_ARTIFACT = "frame_identity.jsonl";
const MAX_CAPTURED_IDENTITIES = 512;
const MAX_EVIDENCE_FINDINGS = 8;

export async function collectFrameIdentityEvidence({ projectPath, runId, videoPath, sourceMediaSha256 = null, stream = {}, auditedFrameCount = null, captureFrameIndices = [], timeoutMs = 120000, artifactRef = FRAME_IDENTITY_ARTIFACT }, options = {}) {
  const absoluteVideoPath = containedPath(projectPath, videoPath);
  const outputPath = containedPath(projectPath, `.directorx/plugin-runs/${runId}/artifacts/${artifactRef}`);
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  const accumulator = createFrameIdentityAccumulator({
    streamTimeBase: stream.time_base,
    averageFrameRate: stream.avg_frame_rate,
    nominalFrameRate: stream.r_frame_rate,
    sourceMediaSha256,
    streamIndex: Number.isInteger(Number(stream.index)) ? Number(stream.index) : 0,
    auditedFrameCount,
    captureFrameIndices
  });
  const handle = await open(temporaryPath, "w", 0o600);
  let buffered = "";
  let peakBufferedBytes = 0;
  const appendRecord = async (record) => {
    const identityRecord = { ...record, sourceMediaSha256, streamIndex: Number.isInteger(Number(stream.index)) ? Number(stream.index) : 0, timeBase: parseRational(stream.time_base) };
    accumulator.push(identityRecord);
    buffered += `${JSON.stringify(identityRecord)}\n`;
    peakBufferedBytes = Math.max(peakBufferedBytes, Buffer.byteLength(buffered));
    if (Buffer.byteLength(buffered) >= 64 * 1024) {
      await handle.write(buffered);
      buffered = "";
    }
  };
  try {
    if (options.lines) {
      for await (const line of options.lines) {
        const record = parseFrameIdentityLine(line, accumulator.frameCount);
        if (record) await appendRecord(record);
      }
      accumulator.markProbeComplete();
    } else {
      const args = options.args ?? [
        "-v", "error", "-select_streams", "v:0", "-show_frames",
        "-show_entries", "frame=key_frame,best_effort_timestamp,best_effort_timestamp_time,pkt_duration,pkt_duration_time,pict_type",
        "-of", "compact=p=0:nk=0", absoluteVideoPath
      ];
      const result = await streamFrameIdentityProcess(options.command ?? "ffprobe", args, { timeoutMs, onLine: async (line) => {
        const record = parseFrameIdentityLine(line, accumulator.frameCount);
        if (record) await appendRecord(record);
      } });
      accumulator.markProbeComplete();
      accumulator.setExecution(result);
    }
    if (buffered) await handle.write(buffered);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    ...accumulator.finish(),
    artifactRef,
    path: outputPath,
    peakWriterBufferBytes: peakBufferedBytes
  };
}

export function createFrameIdentityAccumulator({ streamTimeBase = null, averageFrameRate = null, nominalFrameRate = null, sourceMediaSha256 = null, streamIndex = 0, auditedFrameCount = null, captureFrameIndices = [] } = {}) {
  const timeBase = parseRational(streamTimeBase);
  const capture = new Set([...captureFrameIndices].filter(Number.isInteger).filter((value) => value >= 0).slice(0, MAX_CAPTURED_IDENTITIES));
  const capturedFrames = {};
  const ptsDeltaTicks = new Set();
  let frameCount = 0;
  let firstFrame = null;
  let lastFrame = null;
  let previousPtsTicks = null;
  let previousPtsTimeSeconds = null;
  let missingTimestampCount = 0;
  let nonMonotonicTimestampCount = 0;
  let duplicateTimestampCount = 0;
  let minimumPtsDeltaTicks = null;
  let maximumPtsDeltaTicks = null;
  let probeReachedEof = false;
  let execution = null;

  function push(record) {
    if (!record || record.frameIndex !== frameCount) throw new Error("Frame identity records must be contiguous and zero-based.");
    frameCount += 1;
    const currentPtsTicks = bigintOrNull(record.bestEffortTimestampTicks);
    if (currentPtsTicks == null) missingTimestampCount += 1;
    if (currentPtsTicks != null && previousPtsTicks != null) {
      const delta = currentPtsTicks - previousPtsTicks;
      if (delta < 0n) nonMonotonicTimestampCount += 1;
      if (delta === 0n) duplicateTimestampCount += 1;
      if (delta > 0n) {
        minimumPtsDeltaTicks = minimumPtsDeltaTicks == null || delta < minimumPtsDeltaTicks ? delta : minimumPtsDeltaTicks;
        maximumPtsDeltaTicks = maximumPtsDeltaTicks == null || delta > maximumPtsDeltaTicks ? delta : maximumPtsDeltaTicks;
        if (ptsDeltaTicks.size < 64) ptsDeltaTicks.add(delta.toString());
      }
    } else if (Number.isFinite(record.ptsTimeSeconds) && Number.isFinite(previousPtsTimeSeconds)) {
      const delta = record.ptsTimeSeconds - previousPtsTimeSeconds;
      if (delta < 0) nonMonotonicTimestampCount += 1;
      if (delta === 0) duplicateTimestampCount += 1;
    }
    firstFrame ??= record;
    lastFrame = record;
    previousPtsTicks = currentPtsTicks;
    previousPtsTimeSeconds = record.ptsTimeSeconds;
    if (capture.has(record.frameIndex)) capturedFrames[String(record.frameIndex)] = record;
  }

  function finish() {
    const expected = Number.isFinite(Number(auditedFrameCount)) ? Number(auditedFrameCount) : null;
    const blockers = [];
    if (!probeReachedEof) blockers.push("frame_identity_eof_unconfirmed");
    if (!timeBase) blockers.push("stream_time_base_missing");
    if (missingTimestampCount) blockers.push(`frame_identity_timestamps_missing:${missingTimestampCount}`);
    if (nonMonotonicTimestampCount) blockers.push(`frame_identity_non_monotonic:${nonMonotonicTimestampCount}`);
    if (expected != null && frameCount !== expected) blockers.push(`frame_identity_count_delta:${frameCount - expected}`);
    const observedPositivePtsDeltaTicks = [...ptsDeltaTicks].sort(compareIntegerStrings);
    return {
      schemaVersion: "1.0",
      source: "ffprobe_show_frames_best_effort_timestamp",
      frameCount,
      auditedFrameCount: expected,
      frameCountParity: expected == null ? null : frameCount === expected,
      probeReachedEof,
      streamTimeBase: timeBase,
      sourceMediaSha256,
      streamIndex,
      averageFrameRate: parseRational(averageFrameRate),
      nominalFrameRate: parseRational(nominalFrameRate),
      firstFrame,
      lastFrame,
      missingTimestampCount,
      nonMonotonicTimestampCount,
      duplicateTimestampCount,
      minimumPtsDeltaTicks: minimumPtsDeltaTicks?.toString() ?? null,
      maximumPtsDeltaTicks: maximumPtsDeltaTicks?.toString() ?? null,
      observedPositivePtsDeltaTicks,
      variableFrameRateDetected: ptsDeltaTicks.size > 1,
      capturedFrames,
      blockers,
      passed: blockers.length === 0,
      execution
    };
  }

  return {
    get frameCount() { return frameCount; },
    push,
    markProbeComplete() { probeReachedEof = true; },
    setExecution(value) { execution = value; },
    finish
  };
}

export function parseFrameIdentityLine(line, frameIndex) {
  const text = String(line ?? "").trim();
  if (!text) return null;
  const fields = Object.fromEntries(text.split("|").map((part) => {
    const at = part.indexOf("=");
    return at < 0 ? [part, ""] : [part.slice(0, at), part.slice(at + 1)];
  }));
  const timestampTicks = decimalIntegerOrNull(fields.best_effort_timestamp);
  const timestampSeconds = numberOrNull(fields.best_effort_timestamp_time);
  return {
    schemaVersion: "1.0",
    frameIndex,
    decodeOrdinal: frameIndex,
    bestEffortTimestampTicks: timestampTicks,
    presentationTimestamp: safeIntegerOrNull(timestampTicks),
    ptsTimeSeconds: timestampSeconds,
    packetDurationTicks: decimalIntegerOrNull(fields.pkt_duration),
    packetDuration: safeIntegerOrNull(fields.pkt_duration),
    packetDurationSeconds: numberOrNull(fields.pkt_duration_time),
    keyFrame: fields.key_frame === "1",
    pictureType: valueOrNull(fields.pict_type)
  };
}

export function frameEvidenceCaptureIndices(frameAudit, maximumFindings = MAX_EVIDENCE_FINDINGS) {
  const count = Math.max(0, Number(frameAudit?.auditedFrameCount ?? 0));
  const indices = [];
  for (const interval of (frameAudit?.defectIntervals ?? []).slice(0, maximumFindings)) {
    const start = Math.max(0, Number(interval.startFrame ?? interval.frameIndex ?? 0));
    const end = Math.max(start, Number(interval.endFrame ?? interval.frameIndex ?? start));
    for (const index of [Math.max(0, start - 1), start, end, Math.min(Math.max(0, count - 1), end + 1)]) if (!indices.includes(index)) indices.push(index);
  }
  if ((frameAudit?.blockers ?? []).some((blocker) => String(blocker).startsWith("motion_coverage:"))) {
    for (const index of [0, Math.max(0, count - 1)]) if (!indices.includes(index)) indices.push(index);
  }
  return indices.slice(0, MAX_CAPTURED_IDENTITIES);
}

export function attachFrameIdentityToAudit(frameAudit, identity) {
  const next = structuredClone(frameAudit);
  const captured = identity?.capturedFrames ?? {};
  next.frameIdentityRef = identity?.artifactRef ?? FRAME_IDENTITY_ARTIFACT;
  next.frameIdentity = { ...identity, capturedFrames: undefined, path: undefined };
  next.frameIdentityCapturedFrames = structuredClone(identity?.capturedFrames ?? {});
  next.defectIntervals = (next.defectIntervals ?? []).map((interval) => {
    const start = captured[String(interval.startFrame ?? interval.frameIndex)] ?? null;
    const end = captured[String(interval.endFrame ?? interval.frameIndex)] ?? null;
    return {
      ...interval,
      startPresentationTimestampTicks: start?.bestEffortTimestampTicks ?? null,
      startPresentationTimestamp: start?.presentationTimestamp ?? null,
      startPtsTimeSeconds: start?.ptsTimeSeconds ?? interval.timeSeconds ?? null,
      endPresentationTimestampTicks: end?.bestEffortTimestampTicks ?? null,
      endPresentationTimestamp: end?.presentationTimestamp ?? null,
      endPtsTimeSeconds: end?.ptsTimeSeconds ?? interval.endSeconds ?? null,
      streamTimeBase: identity?.streamTimeBase ?? null
    };
  });
  next.defectEvidence = next.defectIntervals.slice(0, 80).map((interval) => ({ ...interval }));
  next.technicalBlockers = [...new Set([...(next.technicalBlockers ?? technicalBlockers(next.blockers)), ...(identity?.blockers ?? [])])];
  next.blockers = [...new Set([...(next.blockers ?? []), ...(identity?.blockers ?? [])])];
  next.passed = next.blockers.length === 0;
  return next;
}

export async function extractFrameAuditEvidence({ projectPath, runId, videoPath, repairPlan, frameIdentity, fps = 30, timeoutMs = 120000 }, options = {}) {
  const absoluteVideoPath = containedPath(projectPath, videoPath);
  const evidence = {};
  for (const finding of (repairPlan?.findings ?? []).filter((item) => item.startFrame != null && item.severity !== "critical").slice(0, MAX_EVIDENCE_FINDINGS)) {
    const requested = [
      ["before", Math.max(0, finding.startFrame - 1)],
      ["trigger", finding.startFrame],
      ["after", Math.min(Math.max(0, Number(frameIdentity?.frameCount ?? 1) - 1), Math.max(finding.startFrame, finding.endFrame ?? finding.startFrame) + 1)]
    ];
    const byIndex = new Map();
    for (const [role, frameIndex] of requested) {
      const existing = byIndex.get(frameIndex);
      if (existing) { evidence[finding.findingId] ??= []; evidence[finding.findingId].push({ ...existing, role }); continue; }
      const identity = frameIdentity?.capturedFrames?.[String(frameIndex)] ?? null;
      const timeSeconds = Number.isFinite(identity?.ptsTimeSeconds) ? identity.ptsTimeSeconds : frameIndex / Math.max(1, fps);
      const safeId = finding.findingId.replace(/[^A-Za-z0-9._-]/g, "-");
      const artifactRef = `frame_evidence/${safeId}-${role}.png`;
      const outputPath = containedPath(projectPath, `.directorx/plugin-runs/${runId}/artifacts/${artifactRef}`);
      await mkdir(dirname(outputPath), { recursive: true });
      const exactPtsTicks = decimalIntegerOrNull(identity?.bestEffortTimestampTicks);
      const duplicatePts = Number(frameIdentity?.duplicateTimestampCount ?? 0) > 0;
      const extractionMode = exactPtsTicks != null && !duplicatePts ? "bounded_exact_pts" : "exact_decode_ordinal";
      const defaultArgs = extractionMode === "bounded_exact_pts"
        ? ["-v", "error", "-ss", String(Math.max(0, timeSeconds - 2)), "-copyts", "-i", absoluteVideoPath, "-vf", `select=eq(pts\\,${exactPtsTicks}),scale=960:-2:force_original_aspect_ratio=decrease`, "-frames:v", "1", "-fps_mode", "passthrough", "-an", "-y", outputPath]
        : ["-v", "error", "-copyts", "-i", absoluteVideoPath, "-vf", `select=eq(n\\,${frameIndex}),scale=960:-2:force_original_aspect_ratio=decrease`, "-frames:v", "1", "-fps_mode", "passthrough", "-an", "-y", outputPath];
      let extractionReceipt = null;
      if (options.extractor) await options.extractor({ absoluteVideoPath, outputPath, timeSeconds, frameIndex, role, finding, identity, extractionMode });
      else {
        const result = await runProcess(options.ffmpegCommand ?? "ffmpeg", options.argsFactory?.({ absoluteVideoPath, outputPath, timeSeconds, frameIndex, identity, extractionMode }) ?? defaultArgs, { cwd: resolve(projectPath), timeoutMs, maxOutputBytes: 100_000, failureLabel: `Frame evidence extraction ${finding.findingId}/${role}` });
        extractionReceipt = { command: result.command, args: result.args, exitCode: result.exitCode };
      }
      const details = await stat(outputPath);
      if (!details.isFile() || details.size <= 0) throw new Error(`Frame evidence extraction did not produce the identity-bound frame ${frameIndex}.`);
      const record = { role, frameIndex, decodeOrdinal: identity?.decodeOrdinal ?? frameIndex, bestEffortTimestampTicks: exactPtsTicks, presentationTimestamp: identity?.presentationTimestamp ?? null, ptsTimeSeconds: timeSeconds, sourceMediaSha256: frameIdentity?.sourceMediaSha256 ?? null, streamIndex: frameIdentity?.streamIndex ?? 0, timeBase: frameIdentity?.streamTimeBase ?? null, extractionMode, extractionReceipt, identityVerified: true, artifactRef, path: outputPath };
      byIndex.set(frameIndex, record);
      evidence[finding.findingId] ??= [];
      evidence[finding.findingId].push(record);
    }
  }
  return evidence;
}

export function attachFrameEvidenceToRepairPlan(repairPlan, evidenceByFinding) {
  const next = structuredClone(repairPlan);
  next.findings = next.findings.map((finding) => {
    const frames = evidenceByFinding?.[finding.findingId] ?? [];
    return {
      ...finding,
      frameEvidence: frames.map(({ path, ...frame }) => frame),
      evidenceRefs: [...new Set([...(finding.evidenceRefs ?? []), ...frames.map((frame) => frame.artifactRef)])]
    };
  });
  next.evidenceFrameCount = next.findings.reduce((sum, finding) => sum + (finding.frameEvidence?.length ?? 0), 0);
  return next;
}

function streamFrameIdentityProcess(command, args, { timeoutMs, onLine }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let stderr = "";
    let timedOut = false;
    let processing = Promise.resolve();
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    lines.on("line", (line) => { processing = processing.then(() => onLine(line)); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-20_000); });
    child.once("error", (error) => { clearTimeout(timer); reject(new Error(`Unable to start ${command}: ${error.message}`)); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      processing.then(() => {
        if (timedOut) return reject(new Error(`Frame identity probe timed out after ${timeoutMs}ms.`));
        if (code !== 0) return reject(new Error(`Frame identity probe failed (${signal ?? code}): ${stderr.slice(-2000)}`));
        resolvePromise({ command, args, exitCode: code });
      }).catch(reject);
    });
  });
}

function technicalBlockers(blockers = []) {
  return blockers.filter((item) => /^(decode_|frame_count_delta:|coverage:|partial_frame_bytes:|frame_identity_)/.test(String(item)));
}

function containedPath(projectPath, path) {
  const root = resolve(projectPath);
  const absolute = resolve(root, path);
  const relation = relative(root, absolute);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Frame evidence paths must stay inside the project workspace.");
  return absolute;
}

function parseRational(value) {
  if (value && typeof value === "object" && Number.isInteger(value.num) && Number.isInteger(value.den) && value.num > 0 && value.den > 0) return value;
  const [num, den = "1"] = String(value ?? "").split("/").map(Number);
  return Number.isInteger(num) && Number.isInteger(den) && num > 0 && den > 0 ? { num, den } : null;
}

function decimalIntegerOrNull(value) { const text = String(value ?? "").trim(); return /^-?\d+$/.test(text) ? text : null; }
function safeIntegerOrNull(value) { const number = Number(value); return Number.isSafeInteger(number) ? number : null; }
function bigintOrNull(value) { try { const text = decimalIntegerOrNull(value); return text == null ? null : BigInt(text); } catch { return null; } }
function compareIntegerStrings(left, right) { const a = BigInt(left), b = BigInt(right); return a < b ? -1 : a > b ? 1 : 0; }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function valueOrNull(value) { return value && value !== "N/A" ? value : null; }

export const frameIdentityArtifactRef = FRAME_IDENTITY_ARTIFACT;
