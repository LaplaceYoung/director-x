import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { runProcess } from "./media-execution.mjs";

const REVIEWER_ID = "DX-Quality-Reviewer";
const REVIEW_STATUSES = new Set(["fulfilled", "intentional_deviation", "confirmed_defect"]);
const REVIEW_DECISIONS = new Set(["accept", "repair_required", "blocked"]);

export function compileSceneCoverageConformance({
  plan,
  timeline,
  frameAudit,
  frameIdentity,
  mediaArtifactRef = "delivery.video",
  mediaSha256,
  mediaDurationsByRef = {},
  finalDurationSeconds,
  fps = 30
}) {
  if (!plan?.planId || !plan.sequenceId || !Array.isArray(plan.shots)) throw new Error("Scene coverage conformance requires a compiled scene coverage plan.");
  if (!timeline) throw new Error("Scene coverage conformance requires the final semantic or canonical timeline.");
  if (!mediaSha256) throw new Error("Scene coverage conformance requires the verified final-media SHA-256.");
  const normalizedFps = positiveNumber(fps, "fps");
  const normalizedDuration = positiveNumber(finalDurationSeconds, "finalDurationSeconds");
  const technicalBlockers = [];
  const warnings = [];
  const clips = normalizeVideoClips(timeline);

  if (plan.status !== "ready" || plan.sourceBinding?.status !== "ready") technicalBlockers.push(blocker("scene_coverage_plan_not_ready", [], "场景覆盖方案未通过 shotlist SHA 绑定。"));
  if (!clips.length) technicalBlockers.push(blocker("final_timeline_video_track_missing", [], "最终时间线没有可核验的视频轨。"));
  if (!frameAudit || !String(frameAudit.auditMode ?? "").startsWith("exhaustive_decoded_frames")) technicalBlockers.push(blocker("full_frame_audit_missing", [], "最终成片缺少穷举解码全帧审计。"));
  else if (!frameAudit.passed) technicalBlockers.push(blocker("full_frame_audit_failed", [], "最终成片全帧审计未通过。", frameAudit.blockers ?? []));
  if (!frameIdentity?.passed || frameIdentity.frameCountParity !== true) technicalBlockers.push(blocker("frame_identity_not_verified", [], "最终成片 PTS 身份或帧数一致性未通过。", frameIdentity?.blockers ?? []));
  if (frameIdentity?.sourceMediaSha256 && frameIdentity.sourceMediaSha256 !== mediaSha256) technicalBlockers.push(blocker("frame_identity_media_hash_mismatch", [], "PTS 身份证据未绑定当前最终成片哈希。"));

  const plannedOrder = plan.shotOrder?.length ? plan.shotOrder : plan.shots.map((shot) => shot.shotId);
  const timelineOrder = compactConsecutive(clips.map((clip) => clip.shotId).filter(Boolean));
  const unmappedClips = clips.filter((clip) => !clip.shotId);
  if (unmappedClips.length) technicalBlockers.push(blocker("timeline_clip_shot_identity_missing", [], "每个最终视频 clip 必须显式绑定 shotId。", unmappedClips.map((clip) => clip.clipId)));
  if (timelineOrder.length && !same(plannedOrder, timelineOrder)) technicalBlockers.push(blocker("final_shot_order_mismatch", [...new Set([...plannedOrder, ...timelineOrder])], "最终时间线镜头顺序与导演覆盖方案不一致。", timelineOrder));

  const durationToleranceSeconds = Math.max(1 / normalizedFps, 0.01);
  const shotResults = plan.shots.map((shot) => auditShot({
    shot,
    clips: clips.filter((clip) => clip.shotId === shot.shotId),
    mediaDurationsByRef,
    fps: normalizedFps,
    finalFrameCount: Number(frameIdentity?.frameCount ?? frameAudit?.auditedFrameCount ?? Math.round(normalizedDuration * normalizedFps)),
    capturedFrameIndices: new Set(Object.keys(frameIdentity?.capturedFrames ?? {}).map(Number))
  }));
  for (const result of shotResults) technicalBlockers.push(...result.technicalBlockers);

  const timelineEndSeconds = clips.length ? Math.max(...clips.map((clip) => clip.endSeconds)) : 0;
  if (Math.abs(timelineEndSeconds - normalizedDuration) > durationToleranceSeconds) technicalBlockers.push(blocker("final_timeline_duration_mismatch", plannedOrder, "最终视频时长与最终视频轨时长不一致。", [timelineEndSeconds, normalizedDuration]));
  if (Math.abs(Number(plan.targetDurationSeconds ?? normalizedDuration) - normalizedDuration) > Math.max(durationToleranceSeconds, normalizedDuration * 0.01)) warnings.push(blocker("approved_duration_drift", plannedOrder, "最终成片时长偏离已批准覆盖目标。", [plan.targetDurationSeconds, normalizedDuration]));

  const reviewTasks = shotResults.map((result) => ({
    taskId: `scene-coverage-review:${result.shotId}`,
    shotId: result.shotId,
    owner: REVIEWER_ID,
    timelineRange: result.timelineRange,
    evidenceTargets: result.evidenceTargets,
    requiredJudgments: [
      "coverage_role_and_narrative_purpose",
      "camera_position_shot_size_lens_intent",
      "blocking_action_phase_and_screen_direction",
      "composition_depth_focus_and_negative_space",
      "lighting_direction_temperature_and_contrast",
      "movement_motivation_and_edit_fit",
      "fallback_coverage_validity"
    ],
    disposition: "pending"
  }));

  return {
    schemaVersion: "1.0",
    reportId: `scene-coverage-conformance:${String(mediaSha256).slice(0, 12)}:${plan.sequenceId}`,
    owner: REVIEWER_ID,
    planId: plan.planId,
    sequenceId: plan.sequenceId,
    mediaArtifactRef,
    mediaSha256,
    sourceRefs: ["scene_coverage_plan.json", "semantic_timeline.json", "frame_audit_report.json", "frame_identity.jsonl"],
    status: technicalBlockers.length ? "technical_blocked" : "awaiting_multimodal_review",
    machineChecks: {
      planReady: plan.status === "ready" && plan.sourceBinding?.status === "ready",
      timelineShotIdentityComplete: unmappedClips.length === 0,
      shotOrderMatches: same(plannedOrder, timelineOrder),
      fullFrameAuditPassed: frameAudit?.passed === true,
      frameIdentityPassed: frameIdentity?.passed === true && frameIdentity?.frameCountParity === true,
      finalDurationSeconds: normalizedDuration,
      timelineDurationSeconds: round(timelineEndSeconds),
      durationToleranceSeconds: round(durationToleranceSeconds)
    },
    shotOrder: plannedOrder,
    shots: shotResults.map(({ technicalBlockers: _technicalBlockers, ...result }) => result),
    reviewTasks,
    technicalBlockers: uniqueBlockers(technicalBlockers),
    warnings: uniqueBlockers(warnings),
    reviewerEvidenceRef: null,
    approvalBoundary: "Technical identity, decode coverage, duration, shot mapping, and real source-handle failures cannot be waived. Artistic fulfillment requires canonical DX-Quality-Reviewer evidence and cannot be inferred from metadata alone.",
    compiledAt: new Date().toISOString()
  };
}

export function sceneCoverageEvidenceFrameIndices({ plan, timeline, fps = 30, frameCount }) {
  const normalizedFps = positiveNumber(fps, "fps");
  const count = Math.max(1, Number(frameCount) || 1);
  const clips = normalizeVideoClips(timeline);
  const indices = [];
  for (const shot of plan?.shots ?? []) {
    const mapped = clips.filter((clip) => clip.shotId === shot.shotId).sort((left, right) => left.startSeconds - right.startSeconds);
    if (!mapped.length) continue;
    const start = mapped[0].startSeconds;
    const end = mapped.at(-1).endSeconds;
    for (const seconds of [start, start + (end - start) / 2, Math.max(start, end - 1 / normalizedFps)]) {
      const frameIndex = Math.max(0, Math.min(count - 1, Math.round(seconds * normalizedFps)));
      if (!indices.includes(frameIndex)) indices.push(frameIndex);
    }
  }
  return indices;
}

export async function extractSceneCoverageEvidence({ projectPath, runId, videoPath, report, frameIdentity, timeoutMs = 120000 }, options = {}) {
  const absoluteVideoPath = containedPath(projectPath, videoPath);
  const evidence = {};
  for (const shot of report?.shots ?? []) {
    for (const target of shot.evidenceTargets ?? []) {
      const identity = frameIdentity?.capturedFrames?.[String(target.frameIndex)];
      if (!identity) throw new Error(`Scene coverage frame identity was not captured for ${shot.shotId}/${target.role}.`);
      const safeShotId = safeArtifactSegment(shot.shotId);
      const artifactRef = `scene_coverage_evidence/${safeShotId}-${target.role}.png`;
      const outputPath = containedPath(projectPath, `.directorx/plugin-runs/${runId}/artifacts/${artifactRef}`);
      await mkdir(dirname(outputPath), { recursive: true });
      const exactPtsTicks = String(identity.bestEffortTimestampTicks ?? "").trim();
      const duplicatePts = Number(frameIdentity?.duplicateTimestampCount ?? 0) > 0;
      const extractionMode = /^-?\d+$/.test(exactPtsTicks) && !duplicatePts ? "bounded_exact_pts" : "exact_decode_ordinal";
      const args = extractionMode === "bounded_exact_pts"
        ? ["-v", "error", "-ss", String(Math.max(0, Number(identity.ptsTimeSeconds ?? target.timeSeconds) - 2)), "-copyts", "-i", absoluteVideoPath, "-vf", `select=eq(pts\\,${exactPtsTicks}),scale=960:-2:force_original_aspect_ratio=decrease`, "-frames:v", "1", "-fps_mode", "passthrough", "-an", "-y", outputPath]
        : ["-v", "error", "-copyts", "-i", absoluteVideoPath, "-vf", `select=eq(n\\,${target.frameIndex}),scale=960:-2:force_original_aspect_ratio=decrease`, "-frames:v", "1", "-fps_mode", "passthrough", "-an", "-y", outputPath];
      let extractionReceipt = null;
      if (options.extractor) await options.extractor({ absoluteVideoPath, outputPath, shot, target, identity, extractionMode });
      else {
        const result = await runProcess(options.ffmpegCommand ?? "ffmpeg", options.argsFactory?.({ absoluteVideoPath, outputPath, shot, target, identity, extractionMode }) ?? args, { cwd: resolve(projectPath), timeoutMs, maxOutputBytes: 100_000, failureLabel: `Scene coverage evidence ${shot.shotId}/${target.role}` });
        extractionReceipt = { command: result.command, args: result.args, exitCode: result.exitCode };
      }
      const details = await stat(outputPath);
      if (!details.isFile() || details.size <= 0) throw new Error(`Scene coverage evidence extraction produced no image for ${shot.shotId}/${target.role}.`);
      evidence[shot.shotId] ??= [];
      evidence[shot.shotId].push({
        artifactRef,
        path: outputPath,
        shotId: shot.shotId,
        role: target.role,
        frameIndex: target.frameIndex,
        decodeOrdinal: identity.decodeOrdinal ?? target.frameIndex,
        bestEffortTimestampTicks: identity.bestEffortTimestampTicks ?? null,
        ptsTimeSeconds: identity.ptsTimeSeconds ?? target.timeSeconds,
        timeBase: frameIdentity.streamTimeBase,
        streamIndex: frameIdentity.streamIndex ?? 0,
        sourceMediaSha256: frameIdentity.sourceMediaSha256,
        extractionMode,
        extractionReceipt,
        identityVerified: true
      });
    }
  }
  return evidence;
}

export function attachSceneCoverageEvidence(report, evidenceByShot) {
  const next = structuredClone(report);
  next.evidenceIndex = [];
  next.shots = next.shots.map((shot) => {
    const evidence = evidenceByShot?.[shot.shotId] ?? [];
    next.evidenceIndex.push(...evidence.map(({ path: _path, ...item }) => item));
    return { ...shot, evidenceRefs: evidence.map((item) => item.artifactRef) };
  });
  next.reviewTasks = next.reviewTasks.map((task) => ({ ...task, evidenceRefs: evidenceByShot?.[task.shotId]?.map((item) => item.artifactRef) ?? [] }));
  if (next.reviewTasks.some((task) => task.evidenceRefs.length !== task.evidenceTargets.length)) {
    next.technicalBlockers = uniqueBlockers([...(next.technicalBlockers ?? []), blocker("scene_evidence_incomplete", next.reviewTasks.filter((task) => task.evidenceRefs.length !== task.evidenceTargets.length).map((task) => task.shotId), "每个镜头必须具有身份验证的首、中、尾证据帧。")]);
    next.status = "technical_blocked";
  }
  return next;
}

export function recordSceneCoverageConformanceReview(report, review, registeredEvidenceRefs = []) {
  if (!report?.reportId || !Array.isArray(report.reviewTasks)) throw new Error("A compiled scene coverage conformance report is required.");
  if (report.technicalBlockers?.length) throw new Error("Technical scene-coverage blockers must be repaired and re-audited before review acceptance.");
  if (!review?.reviewId || review.reviewerId !== REVIEWER_ID || !REVIEW_DECISIONS.has(review.decision) || !review.summary?.trim()) throw new Error("Scene coverage review requires the canonical reviewer, decision, summary, and review ID.");
  const knownEvidence = new Set(registeredEvidenceRefs);
  const dispositions = new Map();
  for (const item of review.dispositions ?? []) {
    if (!item.taskId || dispositions.has(item.taskId) || !REVIEW_STATUSES.has(item.status) || !item.reason?.trim() || !item.evidenceRefs?.length) throw new Error("Every scene coverage task needs one structured disposition with reason and evidence.");
    for (const ref of item.evidenceRefs) if (!knownEvidence.has(ref)) throw new Error(`Scene coverage review evidence is not registered: ${ref}`);
    dispositions.set(item.taskId, structuredClone(item));
  }
  const taskIds = new Set(report.reviewTasks.map((task) => task.taskId));
  for (const taskId of dispositions.keys()) if (!taskIds.has(taskId)) throw new Error(`Unknown scene coverage review task: ${taskId}`);
  for (const task of report.reviewTasks) {
    const disposition = dispositions.get(task.taskId);
    if (!disposition) throw new Error(`DX-Quality-Reviewer must disposition every scene coverage task: ${task.taskId}`);
    const requiredEvidenceRefs = new Set(task.evidenceRefs ?? []);
    if (!requiredEvidenceRefs.size) throw new Error(`Scene coverage task has no identity-bound evidence: ${task.taskId}`);
    const citedEvidenceRefs = new Set(disposition.evidenceRefs);
    for (const ref of requiredEvidenceRefs) {
      if (!citedEvidenceRefs.has(ref)) throw new Error(`Scene coverage review must cite every first/middle/last evidence frame for ${task.taskId}: ${ref}`);
    }
  }
  const defects = [...dispositions.values()].filter((item) => item.status === "confirmed_defect");
  if (review.decision === "accept" && defects.length) throw new Error("Scene coverage cannot be accepted with confirmed defects.");
  if (review.decision === "repair_required" && !defects.length) throw new Error("repair_required needs at least one confirmed scene coverage defect.");
  const versionedArtifactRef = sceneCoverageReviewArtifactRef(review.reviewId);
  const next = structuredClone(report);
  next.reviewTasks = next.reviewTasks.map((task) => ({ ...task, ...dispositions.get(task.taskId), reviewedAt: new Date().toISOString() }));
  next.reviewerEvidenceRef = versionedArtifactRef;
  next.reviewId = review.reviewId;
  next.reviewSummary = review.summary;
  next.unresolvedTaskIds = defects.map((item) => item.taskId);
  next.status = review.decision === "accept" ? "conformant" : review.decision;
  next.reviewedAt = new Date().toISOString();
  return {
    report: next,
    evidence: {
      schemaVersion: "1.0",
      artifactRef: versionedArtifactRef,
      reviewId: review.reviewId,
      reviewerId: REVIEWER_ID,
      reportId: report.reportId,
      mediaArtifactRef: report.mediaArtifactRef,
      mediaSha256: report.mediaSha256,
      decision: review.decision,
      summary: review.summary,
      dispositions: [...dispositions.values()],
      unresolvedTaskIds: defects.map((item) => item.taskId),
      reviewedAt: new Date().toISOString()
    }
  };
}

export async function writeSceneCoverageConformance({ projectPath, runId, report, evidence = null }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const written = {};
  const values = {
    "scene_coverage_conformance_report.json": report,
    [`scene_coverage_conformance_reports/${safeArtifactSegment(report.reportId)}.json`]: report,
    "scene_coverage_conformance_report.md": sceneCoverageConformanceMarkdown(report),
    ...(evidence ? { [evidence.artifactRef]: evidence } : {})
  };
  for (const [artifactRef, value] of Object.entries(values)) {
    const path = join(directory, artifactRef);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    written[artifactRef] = { artifactRef, path };
  }
  return written;
}

export function sceneCoverageReviewArtifactRef(reviewId) {
  return `scene_coverage_review/${String(reviewId).replace(/[^A-Za-z0-9._-]/g, "-")}.json`;
}

function auditShot({ shot, clips, mediaDurationsByRef, fps, finalFrameCount, capturedFrameIndices }) {
  const technicalBlockers = [];
  if (!clips.length) technicalBlockers.push(blocker("planned_shot_missing_from_final_timeline", [shot.shotId], `${shot.shotId} 未进入最终时间线。`));
  const ordered = [...clips].sort((left, right) => left.startSeconds - right.startSeconds);
  const timelineDurationSeconds = sum(ordered.map((clip) => clip.endSeconds - clip.startSeconds));
  const timelineDurationFrames = secondsToFrames(timelineDurationSeconds, fps, "round");
  const plannedDurationFrames = secondsToFrames(shot.durationSeconds, fps, "round");
  if (clips.length && timelineDurationFrames !== plannedDurationFrames) technicalBlockers.push(blocker("final_shot_duration_drift", [shot.shotId], `${shot.shotId} 的最终时长与导演覆盖方案不一致。`, [timelineDurationFrames, plannedDurationFrames]));
  let headAvailableSeconds = null;
  let tailAvailableSeconds = null;
  if (ordered.length) {
    const first = ordered[0];
    const last = ordered.at(-1);
    headAvailableSeconds = first.sourceStartSeconds;
    const sourceDurationSeconds = Number(mediaDurationsByRef[last.mediaRef] ?? last.sourceDurationSeconds);
    if (!Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= 0) technicalBlockers.push(blocker("source_duration_evidence_missing", [shot.shotId], `${shot.shotId} 缺少源媒体总时长，无法证明真实尾部 handle。`, [last.mediaRef]));
    else tailAvailableSeconds = Math.max(0, sourceDurationSeconds - last.sourceEndSeconds);
    const availableHeadFrames = secondsToFrames(headAvailableSeconds, fps, "floor");
    const requiredHeadFrames = secondsToFrames(shot.handles.headSeconds, fps, "ceil");
    const availableTailFrames = tailAvailableSeconds == null ? null : secondsToFrames(tailAvailableSeconds, fps, "floor");
    const requiredTailFrames = secondsToFrames(shot.handles.tailSeconds, fps, "ceil");
    if (availableHeadFrames < requiredHeadFrames) technicalBlockers.push(blocker("real_head_handle_insufficient", [shot.shotId], `${shot.shotId} 的真实头部源帧余量不足。`, [availableHeadFrames, requiredHeadFrames]));
    if (availableTailFrames != null && availableTailFrames < requiredTailFrames) technicalBlockers.push(blocker("real_tail_handle_insufficient", [shot.shotId], `${shot.shotId} 的真实尾部源帧余量不足。`, [availableTailFrames, requiredTailFrames]));
  }
  const startSeconds = ordered[0]?.startSeconds ?? 0;
  const endSeconds = ordered.at(-1)?.endSeconds ?? startSeconds;
  const middleSeconds = startSeconds + Math.max(0, endSeconds - startSeconds) / 2;
  const evidenceTargets = [
    evidenceTarget("first", startSeconds, fps, finalFrameCount),
    evidenceTarget("middle", middleSeconds, fps, finalFrameCount),
    evidenceTarget("last", Math.max(startSeconds, endSeconds - 1 / fps), fps, finalFrameCount)
  ];
  if (evidenceTargets.some((target) => !capturedFrameIndices.has(target.frameIndex))) technicalBlockers.push(blocker("scene_frame_identity_missing", [shot.shotId], `${shot.shotId} 的首、中、尾 PTS 身份证据未完整采集。`, evidenceTargets.filter((target) => !capturedFrameIndices.has(target.frameIndex)).map((target) => target.frameIndex)));
  return {
    shotId: shot.shotId,
    sceneId: shot.sceneId,
    coverageRole: shot.coverageRole,
    purpose: shot.purpose,
    plannedDurationSeconds: shot.durationSeconds,
    plannedDurationFrames,
    timelineDurationSeconds: round(timelineDurationSeconds),
    timelineDurationFrames,
    timelineRange: { startSeconds: round(startSeconds), endSeconds: round(endSeconds) },
    clipIds: ordered.map((clip) => clip.clipId),
    mediaRefs: [...new Set(ordered.map((clip) => clip.mediaRef).filter(Boolean))],
    handles: {
      requiredHeadSeconds: shot.handles.headSeconds,
      requiredTailSeconds: shot.handles.tailSeconds,
      requiredHeadFrames: secondsToFrames(shot.handles.headSeconds, fps, "ceil"),
      requiredTailFrames: secondsToFrames(shot.handles.tailSeconds, fps, "ceil"),
      availableHeadSeconds: headAvailableSeconds == null ? null : round(headAvailableSeconds),
      availableTailSeconds: tailAvailableSeconds == null ? null : round(tailAvailableSeconds),
      availableHeadFrames: headAvailableSeconds == null ? null : secondsToFrames(headAvailableSeconds, fps, "floor"),
      availableTailFrames: tailAvailableSeconds == null ? null : secondsToFrames(tailAvailableSeconds, fps, "floor")
    },
    evidenceTargets,
    machineStatus: technicalBlockers.length ? "blocked" : "passed",
    technicalBlockerCodes: technicalBlockers.map((item) => item.code),
    technicalBlockers
  };
}

function normalizeVideoClips(timeline) {
  const source = timeline.timeline ?? timeline;
  const clips = [];
  for (const [trackIndex, track] of (source.tracks ?? []).entries()) {
    const kind = track.kind ?? track.track_type ?? track.type;
    if (!["video", "visual"].includes(kind)) continue;
    for (const [clipIndex, clip] of (track.clips ?? track.items ?? []).entries()) {
      const timelineRange = rangeSeconds(clip.timelineRange) ?? numericRange(clip.start_seconds ?? clip.startSeconds, clip.end_seconds ?? clip.endSeconds);
      if (!timelineRange) continue;
      const sourceRange = rangeSeconds(clip.sourceRange) ?? numericRange(clip.source_start_seconds ?? clip.sourceStartSeconds ?? 0, clip.source_end_seconds ?? clip.sourceEndSeconds ?? (timelineRange.endSeconds - timelineRange.startSeconds));
      clips.push({
        trackId: track.trackId ?? track.track_id ?? `video-${trackIndex + 1}`,
        clipId: clip.clipId ?? clip.clip_id ?? clip.id ?? `clip-${trackIndex + 1}-${clipIndex + 1}`,
        shotId: String(clip.shotId ?? clip.shot_id ?? clip.metadata?.shotId ?? clip.metadata?.shot_id ?? "").trim() || null,
        mediaRef: clip.mediaRef ?? clip.artifact_uri ?? clip.artifactUri ?? clip.source ?? clip.assetRef ?? null,
        startSeconds: timelineRange.startSeconds,
        endSeconds: timelineRange.endSeconds,
        sourceStartSeconds: sourceRange?.startSeconds ?? 0,
        sourceEndSeconds: sourceRange?.endSeconds ?? (timelineRange.endSeconds - timelineRange.startSeconds),
        sourceDurationSeconds: Number(clip.sourceDurationSeconds ?? clip.source_duration_seconds ?? clip.metadata?.sourceDurationSeconds ?? clip.metadata?.source_duration_seconds)
      });
    }
  }
  return clips.sort((left, right) => left.startSeconds - right.startSeconds || left.clipId.localeCompare(right.clipId));
}

function rangeSeconds(range) {
  if (!range?.start || !range?.duration) return null;
  const startSeconds = rationalSeconds(range.start);
  const durationSeconds = rationalSeconds(range.duration);
  return Number.isFinite(startSeconds) && Number.isFinite(durationSeconds) && durationSeconds > 0 ? { startSeconds, endSeconds: startSeconds + durationSeconds } : null;
}

function numericRange(start, end) {
  const startSeconds = Number(start), endSeconds = Number(end);
  return Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && endSeconds > startSeconds ? { startSeconds, endSeconds } : null;
}

function evidenceTarget(role, seconds, fps, frameCount) {
  const frameIndex = Math.max(0, Math.min(Math.max(0, frameCount - 1), Math.round(seconds * fps)));
  return { role, timeSeconds: round(seconds), frameIndex, requiredEvidenceKind: "identity_verified_frame" };
}

function secondsToFrames(seconds, fps, mode) {
  const value = Math.max(0, Number(seconds) * fps);
  if (mode === "ceil") return Math.ceil(value - 1e-9);
  if (mode === "floor") return Math.floor(value + 1e-9);
  return Math.round(value);
}

function sceneCoverageConformanceMarkdown(report) {
  return [
    "# 最终成片场景覆盖回查",
    "",
    `- 状态：${report.status}`,
    `- 序列：${report.sequenceId}`,
    `- 最终媒体：${report.mediaArtifactRef}`,
    `- 技术阻塞：${report.technicalBlockers.length}`,
    `- 待导演审片：${report.reviewTasks.filter((task) => task.disposition === "pending").length}`,
    "",
    "## 镜头回查",
    "",
    ...report.shots.map((shot) => `- ${shot.shotId} · ${shot.coverageRole} · ${shot.machineStatus} · ${shot.timelineRange.startSeconds}s–${shot.timelineRange.endSeconds}s · handles ${shot.handles.availableHeadSeconds ?? "?"}/${shot.handles.availableTailSeconds ?? "?"}s`),
    "",
    "## 技术阻塞",
    "",
    ...(report.technicalBlockers.length ? report.technicalBlockers.map((item) => `- ${item.code}：${item.message}`) : ["- 无"]),
    ""
  ].join("\n");
}

function blocker(code, shotIds, message, evidence = []) { return { code, shotIds: [...new Set(shotIds)], message, evidence }; }
function uniqueBlockers(items) { return [...new Map(items.map((item) => [`${item.code}:${item.shotIds.join(",")}`, item])).values()]; }
function compactConsecutive(items) { return items.filter((item, index) => index === 0 || item !== items[index - 1]); }
function rationalSeconds(value) { return Number(value?.value) / Number(value?.rate); }
function positiveNumber(value, label) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than zero.`); return number; }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function round(value) { return Math.round(Number(value) * 1000) / 1000; }
function safeArtifactSegment(value) { return String(value).replace(/[^A-Za-z0-9._-]/g, "-"); }
function containedPath(projectPath, path) { const root = resolve(projectPath); const absolute = resolve(root, path); const relation = relative(root, absolute); if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Scene coverage evidence paths must stay inside the project workspace."); return absolute; }

export const sceneCoverageReviewerId = REVIEWER_ID;
export const sceneCoverageReviewStatuses = [...REVIEW_STATUSES];
export const sceneCoverageReviewDecisions = [...REVIEW_DECISIONS];
