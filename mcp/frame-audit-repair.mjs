import { readFile } from "node:fs/promises";

const FRAME_MARKER_PREFIX = "frame-audit:";

export async function buildFrameAuditRepairPlan({ run, frameAudit, mediaArtifactRef = "delivery.video", mediaSha256 = null, durationSeconds }) {
  if (!frameAudit || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Frame-audit repair planning requires a report and positive media duration.");
  const timeline = await resolveTimeline(run);
  const clips = normalizeVideoClips(timeline?.timeline ?? timeline, durationSeconds);
  const intervals = normalizeDefectIntervals(frameAudit, durationSeconds);
  const findings = intervals.map((interval, index) => {
    const affected = clips.filter((clip) => overlaps(interval, clip));
    const primary = affected[0] ?? null;
    const severity = severityFor(interval.code);
    const timelineRange = secondsRange(interval.startSeconds, Math.max(1 / Math.max(1, frameAudit.fps ?? 30), interval.endSeconds - interval.startSeconds));
    const sourceRange = primary ? sourceRangeFor(primary, interval, frameAudit.fps ?? 30) : null;
    return {
      findingId: `${FRAME_MARKER_PREFIX}${index + 1}`,
      code: interval.code,
      severity,
      technicalGate: severity === "critical" ? "blocked" : "passed",
      label: labelFor(interval.code),
      startSeconds: round(interval.startSeconds),
      endSeconds: round(interval.endSeconds),
      durationSeconds: round(Math.max(0, interval.endSeconds - interval.startSeconds)),
      startFrame: interval.startFrame ?? null,
      endFrame: interval.endFrame ?? null,
      startPresentationTimestamp: interval.startPresentationTimestamp ?? null,
      endPresentationTimestamp: interval.endPresentationTimestamp ?? null,
      startPresentationTimestampTicks: interval.startPresentationTimestampTicks ?? null,
      endPresentationTimestampTicks: interval.endPresentationTimestampTicks ?? null,
      streamTimeBase: interval.streamTimeBase ?? frameAudit.frameIdentity?.streamTimeBase ?? null,
      presentationRange: presentationRangeFor(interval, frameAudit.frameIdentity?.streamTimeBase ?? null, frameAudit.fps ?? 30),
      timelineRange,
      sourceRange,
      trackId: primary?.trackId ?? null,
      clipId: primary?.clipId ?? null,
      mediaRef: primary?.mediaRef ?? mediaArtifactRef,
      sourceMediaSha256: mediaSha256,
      affectedClipIds: affected.map((clip) => clip.clipId),
      repairAction: repairActionFor(interval.code),
      detectorDisposition: "pending",
      evidenceRefs: ["frame_audit_report.json", ...(frameAudit.frameIdentityRef ? [frameAudit.frameIdentityRef] : []), ...(timeline?.artifactRef ? [timeline.artifactRef] : [])]
    };
  });
  return {
    schemaVersion: "1.0",
    planId: `frame-audit-repair:${run.runId ?? "run"}`,
    owner: "DX-Quality-Reviewer",
    repairOwner: "DX-Editor",
    mediaArtifactRef,
    mediaSha256,
    auditMode: frameAudit.auditMode,
    sourceFrameAuditRef: "frame_audit_report.json",
    sourceTimelineRef: timeline?.artifactRef ?? null,
    sourceRevisionId: timeline?.revisionId ?? null,
    durationSeconds,
    status: findings.some((finding) => finding.severity === "critical") ? "rerender_required" : findings.length ? "review_required" : "passed",
    findings,
    timelineClips: clips,
    mappedFindingCount: findings.filter((finding) => finding.clipId).length,
    unmappedFindingCount: findings.filter((finding) => !finding.clipId).length,
    approvalBoundary: "This plan is evidence only. Any timeline mutation requires an audited Director X Cut patch and Codex-native approval when material.",
    generatedAt: new Date().toISOString()
  };
}

export function mergeFrameAuditIntoReviewTimeline({ existingTimeline = null, repairPlan, durationSeconds, fps = 30, mediaArtifactRef = "delivery.video" }) {
  if (!repairPlan || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Review timeline synthesis requires a repair plan and positive duration.");
  const rate = 1000;
  const durationValue = Math.max(1, Math.round(durationSeconds * rate));
  const existingMarkers = (existingTimeline?.markers ?? []).filter((marker) => !String(marker.id ?? "").startsWith(FRAME_MARKER_PREFIX));
  const markers = repairPlan.findings.map((finding) => {
    const startValue = clamp(Math.round(finding.startSeconds * rate), 0, durationValue - 1);
    const requestedDuration = Math.max(1, Math.round(Math.max(1 / Math.max(1, fps), finding.durationSeconds) * rate));
    const markerDuration = Math.max(1, Math.min(requestedDuration, durationValue - startValue));
    return {
      id: finding.findingId,
      range: { start: { value: startValue, rate }, duration: { value: markerDuration, rate } },
      kind: "defect",
      label: finding.clipId ? `${finding.label} · ${finding.clipId}` : finding.label,
      evidenceRefs: [...new Set(["frame_audit_report.json", "frame_audit_repair_plan.json", ...finding.evidenceRefs])],
      severity: finding.severity,
      clipId: finding.clipId,
      trackId: finding.trackId,
      repairAction: finding.repairAction,
      detectorDisposition: finding.detectorDisposition,
      frameEvidence: finding.frameEvidence ?? []
    };
  });
  const shots = repairPlan.timelineClips.map((clip) => {
    const startValue = clamp(Math.round(clip.startSeconds * rate), 0, durationValue - 1);
    const shotDuration = Math.max(1, Math.min(Math.round((clip.endSeconds - clip.startSeconds) * rate), durationValue - startValue));
    return { id: clip.clipId, range: { start: { value: startValue, rate }, duration: { value: shotDuration, rate } }, label: clip.clipId };
  });
  return {
    schemaVersion: "1.0",
    timelineId: existingTimeline?.timelineId ?? `review:${repairPlan.planId}`,
    revisionId: existingTimeline?.revisionId ?? repairPlan.sourceRevisionId ?? "frame-audit",
    mediaArtifactRef: existingTimeline?.mediaArtifactRef ?? mediaArtifactRef,
    projectRate: existingTimeline?.projectRate ?? { value: Math.max(1, Math.round(fps * 1000)), rate: 1000 },
    duration: { value: durationValue, rate },
    shots: shots.length ? shots : (existingTimeline?.shots ?? []),
    subtitles: existingTimeline?.subtitles ?? [],
    audioTracks: existingTimeline?.audioTracks ?? [],
    markers: [...existingMarkers, ...markers]
  };
}

async function resolveTimeline(run) {
  const heads = run.editSession?.timelineHeads ?? {};
  const preferredTimelineId = run.editSession?.patch?.timelineId ?? Object.keys(heads).at(-1);
  const revisionId = preferredTimelineId ? heads[preferredTimelineId] : null;
  const revision = revisionId ? run.editSession?.revisions?.[revisionId] : null;
  if (revision?.timeline) return { timeline: revision.timeline, revisionId, artifactRef: "timeline_revision.json" };
  const artifact = run.artifacts?.["semantic_timeline.json"];
  if (!artifact?.path) return null;
  try { return { timeline: JSON.parse(await readFile(artifact.path, "utf8")), revisionId: null, artifactRef: "semantic_timeline.json" }; }
  catch { return null; }
}

function normalizeVideoClips(timeline, durationSeconds) {
  const tracks = Array.isArray(timeline?.tracks) ? timeline.tracks : [];
  const clips = [];
  for (const [trackIndex, track] of tracks.entries()) {
    const kind = track.kind ?? track.track_type ?? track.type;
    if (!["video", "visual"].includes(kind)) continue;
    for (const [clipIndex, clip] of (track.clips ?? track.items ?? []).entries()) {
      const range = normalizeRange(clip, durationSeconds);
      if (!range) continue;
      clips.push({
        trackId: track.trackId ?? track.track_id ?? `video-${trackIndex + 1}`,
        clipId: clip.clipId ?? clip.clip_id ?? clip.id ?? `clip-${trackIndex + 1}-${clipIndex + 1}`,
        mediaRef: clip.mediaRef ?? clip.artifact_uri ?? clip.artifactUri ?? clip.source ?? clip.assetRef ?? null,
        startSeconds: range.startSeconds,
        endSeconds: range.endSeconds,
        sourceStartSeconds: sourceRangeSeconds(clip)?.startSeconds ?? 0,
        sourceEndSeconds: sourceRangeSeconds(clip)?.endSeconds ?? (range.endSeconds - range.startSeconds)
      });
    }
  }
  return clips.sort((left, right) => left.startSeconds - right.startSeconds || left.clipId.localeCompare(right.clipId));
}

function normalizeRange(clip, durationSeconds) {
  if (clip.timelineRange?.start && clip.timelineRange?.duration) {
    const startSeconds = rationalSeconds(clip.timelineRange.start);
    const length = rationalSeconds(clip.timelineRange.duration);
    if (Number.isFinite(startSeconds) && Number.isFinite(length) && length > 0) return { startSeconds, endSeconds: Math.min(durationSeconds, startSeconds + length) };
  }
  const startSeconds = Number(clip.start_seconds ?? clip.startSeconds);
  const endSeconds = Number(clip.end_seconds ?? clip.endSeconds ?? (Number.isFinite(startSeconds) ? startSeconds + Number(clip.duration_seconds ?? clip.durationSeconds) : NaN));
  return Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && endSeconds > startSeconds ? { startSeconds, endSeconds: Math.min(durationSeconds, endSeconds) } : null;
}

function normalizeDefectIntervals(frameAudit, durationSeconds) {
  const fps = Number(frameAudit.fps) || 30;
  const source = frameAudit.defectIntervals?.length ? frameAudit.defectIntervals : frameAudit.defectEvidence ?? [];
  const intervals = source.map((item) => {
    const startSeconds = Number.isFinite(item.timeSeconds) ? item.timeSeconds : Number(item.startFrame ?? item.frameIndex ?? 0) / fps;
    const endSeconds = Number.isFinite(item.endSeconds) ? item.endSeconds
      : Number.isFinite(item.durationSeconds) ? startSeconds + item.durationSeconds
        : (Number(item.endFrame ?? item.frameIndex ?? item.startFrame ?? 0) + 1) / fps;
    return { ...item, code: item.code ?? "frame_audit_defect", startSeconds: clamp(startSeconds, 0, durationSeconds), endSeconds: clamp(Math.max(startSeconds + (1 / fps), endSeconds), 0, durationSeconds), startFrame: item.startFrame ?? item.frameIndex ?? null, endFrame: item.endFrame ?? item.frameIndex ?? null };
  }).filter((item) => item.endSeconds > item.startSeconds);
  const representedCodes = new Set(intervals.map((item) => item.code));
  for (const blocker of frameAudit.blockers ?? []) {
    const code = blockerCode(blocker);
    if (!code || representedCodes.has(code)) continue;
    const endFrame = Math.max(0, Number(frameAudit.auditedFrameCount ?? 1) - 1);
    const firstIdentity = frameAudit.frameIdentityCapturedFrames?.["0"] ?? null;
    const lastIdentity = frameAudit.frameIdentityCapturedFrames?.[String(endFrame)] ?? null;
    intervals.push({ code, startSeconds: 0, endSeconds: durationSeconds, startFrame: 0, endFrame, startPresentationTimestampTicks: firstIdentity?.bestEffortTimestampTicks ?? null, endPresentationTimestampTicks: lastIdentity?.bestEffortTimestampTicks ?? null, startPresentationTimestamp: firstIdentity?.presentationTimestamp ?? null, endPresentationTimestamp: lastIdentity?.presentationTimestamp ?? null, streamTimeBase: frameAudit.frameIdentity?.streamTimeBase ?? null });
    representedCodes.add(code);
  }
  return intervals.sort((left, right) => left.startSeconds - right.startSeconds || left.code.localeCompare(right.code));
}

function blockerCode(blocker) {
  const value = String(blocker);
  if (value.startsWith("coverage:") || value.startsWith("frame_count_delta:") || value.startsWith("partial_frame_bytes:") || value === "decode_eof_unconfirmed") return "decode_coverage";
  if (value.startsWith("motion_coverage:")) return "motion_coverage";
  if (value === "decode_failed") return "decode_failed";
  return null;
}

function overlaps(interval, clip) { return interval.startSeconds < clip.endSeconds && interval.endSeconds > clip.startSeconds; }
function rationalSeconds(value) { return Number(value?.value) / Number(value?.rate); }
function sourceRangeSeconds(clip) {
  if (!clip.sourceRange?.start || !clip.sourceRange?.duration) return null;
  const startSeconds = rationalSeconds(clip.sourceRange.start);
  const durationSeconds = rationalSeconds(clip.sourceRange.duration);
  return Number.isFinite(startSeconds) && Number.isFinite(durationSeconds) && durationSeconds > 0 ? { startSeconds, endSeconds: startSeconds + durationSeconds } : null;
}
function sourceRangeFor(clip, interval, fps) {
  const overlapStart = Math.max(interval.startSeconds, clip.startSeconds);
  const overlapEnd = Math.min(interval.endSeconds, clip.endSeconds);
  const sourceStart = clip.sourceStartSeconds + Math.max(0, overlapStart - clip.startSeconds);
  return secondsRange(sourceStart, Math.max(1 / Math.max(1, fps), overlapEnd - overlapStart));
}
function secondsRange(startSeconds, durationSeconds, rate = 1_000_000) {
  return { start: { value: Math.max(0, Math.round(startSeconds * rate)), rate }, duration: { value: Math.max(1, Math.round(durationSeconds * rate)), rate } };
}
function presentationRangeFor(interval, timeBase, fps) {
  const startTicks = integerBigInt(interval.startPresentationTimestampTicks ?? interval.startPresentationTimestamp);
  const endTicks = integerBigInt(interval.endPresentationTimestampTicks ?? interval.endPresentationTimestamp);
  if (startTicks == null || !Number.isSafeInteger(timeBase?.num) || !Number.isSafeInteger(timeBase?.den)) return null;
  const fallbackTicks = BigInt(Math.max(1, Math.round(timeBase.den / (timeBase.num * Math.max(1, fps)))));
  const durationTicks = endTicks != null && endTicks >= startTicks ? endTicks - startTicks + 1n : fallbackTicks;
  const scaledStart = startTicks * BigInt(timeBase.num);
  const scaledDuration = durationTicks * BigInt(timeBase.num);
  return {
    start: { value: safeBigIntNumber(scaledStart), valueTicks: scaledStart.toString(), rate: timeBase.den },
    duration: { value: safeBigIntNumber(scaledDuration), valueTicks: scaledDuration.toString(), rate: timeBase.den }
  };
}
function integerBigInt(value) { try { const text = String(value ?? ""); return /^-?\d+$/.test(text) ? BigInt(text) : null; } catch { return null; } }
function safeBigIntNumber(value) { const number = Number(value); return Number.isSafeInteger(number) ? number : null; }
function severityFor(code) { return ["decode_failed", "decode_coverage"].includes(code) ? "critical" : ["black_frame", "white_frame", "flash_frame", "frozen_run"].includes(code) ? "major" : "minor"; }
function repairActionFor(code) {
  if (["decode_failed", "decode_coverage"].includes(code)) return "rerender_from_canonical_timeline";
  if (code === "frozen_run") return "replace_or_regenerate_affected_clip_interval";
  if (["black_frame", "white_frame", "flash_frame"].includes(code)) return "inspect_transition_then_trim_replace_or_rerender";
  return "review_director_intent_before_editing";
}
function labelFor(code) { return ({ black_frame: "黑帧", white_frame: "白帧", flash_frame: "异常闪变", frozen_run: "冻结画面", decode_coverage: "解码覆盖不足", decode_failed: "解码失败", motion_coverage: "动态覆盖不足" })[code] ?? code; }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function round(value) { return Math.round(value * 10000) / 10000; }
