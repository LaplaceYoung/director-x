const ESSENTIAL_APPROVALS = Object.freeze(["budget", "image_model", "video_model", "voice_model"]);
import { transitionPipelineStage } from "./pipeline-catalog.mjs";
const CREATIVE_DOCUMENTS = new Set([
  "reference_analysis.json", "reference_learning_report.json", "style_playbook.json",
  "script_or_outline.json", "shotlist.json", "keyframe_storyboard.json", "visual_prompt_pack.json"
]);

export function evaluateFastStartReadiness(run) {
  const blockers = [];
  if (!run.goal?.boundAt) blockers.push("goal_not_bound");
  if (!run.runMode?.mode) blockers.push("run_mode_not_confirmed");
  if (!run.intakeGate?.ready) blockers.push("minimum_intake_not_confirmed");
  if (!run.pipeline) blockers.push("pipeline_not_selected");
  if (!run.productionComplexityPlan) blockers.push("complexity_not_planned");
  if (run.runMode?.mode === "stage_approval" && run.stageApprovals?.research?.status !== "approved") blockers.push("stage_approval:research");
  for (const kind of ESSENTIAL_APPROVALS) if (!approved(run, kind)) blockers.push(`approval:${kind}`);
  const intake = run.pipeline?.stages?.find((stage) => stage.id === "intake");
  for (const artifactRef of intake?.requiredOutputs ?? []) if (!run.artifacts?.[artifactRef]) blockers.push(`artifact:${artifactRef}`);
  if (run.pipeline?.id === "reference-remix" && (run.references?.length ?? 0) > 0 && run.referenceDownloadConsent?.decision !== "authorized") blockers.push("reference_download_consent");
  return {
    schemaVersion: "1.0",
    ready: blockers.length === 0,
    blockers,
    requiredApprovals: ESSENTIAL_APPROVALS,
    deferredUntilGeneration: intake?.deferredOutputs ?? [],
    nextTool: blockers.length ? nextTool(blockers[0]) : "directorx_begin_creative_work"
  };
}

// Research must be able to start while a paid provider is still being configured.
// Provider approvals remain hard gates for generation, but they should not prevent
// downloading and understanding an authorized reference or writing the first script.
export function evaluateReferenceResearchReadiness(run) {
  const blockers = [];
  if (!run.goal?.boundAt) blockers.push("goal_not_bound");
  if (!run.runMode?.mode) blockers.push("run_mode_not_confirmed");
  if (!run.intakeGate?.ready) blockers.push("minimum_intake_not_confirmed");
  if (!run.pipeline) blockers.push("pipeline_not_selected");
  if (!run.productionComplexityPlan) blockers.push("complexity_not_planned");
  const intake = run.pipeline?.stages?.find((stage) => stage.id === "intake");
  for (const artifactRef of intake?.requiredOutputs ?? []) if (!run.artifacts?.[artifactRef]) blockers.push(`artifact:${artifactRef}`);
  if (run.runMode?.mode === "stage_approval" && run.stageApprovals?.research?.status !== "approved") blockers.push("stage_approval:research");
  return {
    schemaVersion: "1.0",
    ready: blockers.length === 0,
    blockers,
    generationBlockedUntil: ESSENTIAL_APPROVALS.filter((kind) => !approved(run, kind)),
    nextTool: blockers.length ? nextTool(blockers[0]) : "directorx_begin_reference_research"
  };
}

export function beginReferenceResearch(run, now = new Date().toISOString()) {
  const readiness = evaluateReferenceResearchReadiness(run);
  if (!readiness.ready) throw new Error(`Reference research is blocked: ${readiness.blockers.join(", ")}`);
  if (run.fastStart?.startedAt && run.stage === "research") return run.fastStart;
  run.fastStart = {
    schemaVersion: "1.0",
    startedAt: run.fastStart?.startedAt ?? now,
    creativeAssetSlaMinutes: 5,
    firstKeyframeTargetMinutes: run.productionComplexityPlan?.settings?.firstKeyframeTargetMinutes ?? 10,
    firstPreviewTargetMinutes: run.productionComplexityPlan?.settings?.targetFirstPreviewMinutes ?? 15,
    deferredUntilGeneration: run.pipeline?.stages?.find((stage) => stage.id === "intake")?.deferredOutputs ?? [],
    status: "reference_research_started",
    generationReady: false,
    generationBlockers: readiness.generationBlockedUntil
  };
  const intake = run.pipeline.stages.find((stage) => stage.id === "intake");
  const evidenceRefs = intake.requiredOutputs;
  run.pipeline = transitionPipelineStage(run.pipeline, run.approvals, { stageId: "intake", action: "complete", detail: "Minimum Intake complete; research starts before provider generation readiness.", evidenceRefs });
  run.pipeline = transitionPipelineStage(run.pipeline, run.approvals, { stageId: "research", action: "begin", detail: "Reference download, media understanding, asset search, and first script run in parallel." });
  run.stage = "research";
  run.status = "production_in_progress";
  return run.fastStart;
}

export function beginCreativeWork(run, now = new Date().toISOString()) {
  const readiness = evaluateFastStartReadiness(run);
  if (!readiness.ready) throw new Error(`Fast-start production is blocked: ${readiness.blockers.join(", ")}`);
  run.fastStart = {
    schemaVersion: "1.0",
    startedAt: run.fastStart?.startedAt ?? now,
    creativeAssetSlaMinutes: 5,
    firstKeyframeTargetMinutes: run.productionComplexityPlan?.settings?.firstKeyframeTargetMinutes ?? 10,
    firstPreviewTargetMinutes: run.productionComplexityPlan?.settings?.targetFirstPreviewMinutes ?? 15,
    deferredUntilGeneration: readiness.deferredUntilGeneration,
    status: "creative_work_started"
  };
  return run.fastStart;
}

export function evaluateCreativeProgressSla(run, now = new Date().toISOString()) {
  const creativeArtifacts = Object.entries(run.artifacts ?? {}).filter(([artifactRef, artifact]) => isCreativeArtifact(artifactRef, artifact));
  const visualArtifacts = creativeArtifacts.filter(([artifactRef, artifact]) => isVisualArtifact(artifactRef, artifact));
  const previewArtifacts = creativeArtifacts.filter(([artifactRef, artifact]) => isPreviewArtifact(artifactRef, artifact));
  if (!run.fastStart?.startedAt) return { status: "awaiting_fast_start", creativeArtifactCount: creativeArtifacts.length, breached: false, nextRequiredAction: "directorx_begin_reference_research", lanes: {} };
  const nowMs = Date.parse(now);
  const startedAtMs = Date.parse(run.fastStart.startedAt);
  const thresholdMinutes = Number(run.fastStart.creativeAssetSlaMinutes ?? 5);
  const timestampedArtifacts = creativeArtifacts.map(([artifactRef, artifact]) => ({ artifactRef, timestamp: creativeArtifactTimestamp(artifact) })).filter((item) => Number.isFinite(item.timestamp));
  const latestCreativeAtMs = timestampedArtifacts.length ? Math.max(...timestampedArtifacts.map((item) => item.timestamp)) : null;
  const monitoringSinceMs = latestCreativeAtMs ?? startedAtMs;
  const elapsedMinutes = Math.max(0, (nowMs - monitoringSinceMs) / 60000);
  const hasCreativeArtifacts = creativeArtifacts.length > 0;
  const canMonitorContinuously = !hasCreativeArtifacts || latestCreativeAtMs !== null;
  const breached = canMonitorContinuously && elapsedMinutes >= thresholdMinutes;
  const status = breached ? "breached" : hasCreativeArtifacts ? "satisfied" : "on_track";
  const latestCreativeArtifactRefs = latestCreativeAtMs === null ? [] : timestampedArtifacts.filter((item) => item.timestamp === latestCreativeAtMs).map((item) => item.artifactRef);
  const lanes = {
    firstContent: firstArtifactLane(creativeArtifacts, startedAtMs, nowMs, thresholdMinutes),
    firstVisual: firstArtifactLane(visualArtifacts, startedAtMs, nowMs, Number(run.fastStart.firstKeyframeTargetMinutes ?? 10)),
    firstPreview: firstArtifactLane(previewArtifacts, startedAtMs, nowMs, Number(run.fastStart.firstPreviewTargetMinutes ?? 15))
  };
  const breachedLane = ["firstPreview", "firstVisual", "firstContent"].find((lane) => lanes[lane].breached);
  const anyBreached = breached || Boolean(breachedLane);
  return {
    schemaVersion: "1.0",
    status: anyBreached ? "breached" : status,
    creativeArtifactCount: creativeArtifacts.length,
    creativeArtifactRefs: creativeArtifacts.map(([artifactRef]) => artifactRef),
    latestCreativeArtifactAt: latestCreativeAtMs === null ? null : new Date(latestCreativeAtMs).toISOString(),
    latestCreativeArtifactRefs,
    elapsedMinutes: Number(elapsedMinutes.toFixed(2)),
    thresholdMinutes,
    breached: anyBreached,
    lanes,
    visualArtifactRefs: visualArtifacts.map(([artifactRef]) => artifactRef),
    previewArtifactRefs: previewArtifacts.map(([artifactRef]) => artifactRef),
    nextRequiredAction: breachedLane === "firstPreview" ? "produce_playable_preview_now" : breachedLane === "firstVisual" ? "produce_first_keyframe_now" : breached ? "dispatch_reference_asset_and_script_work_now" : "continue_parallel_creative_work",
    userFacingMessage: breachedLane === "firstPreview" ? "首版可播放预览已超过目标时间，已停止追加配置并转入预览产出。" : breachedLane === "firstVisual" ? "首个关键画面已超过目标时间，已停止追加配置并转入视觉产出。" : breached ? (hasCreativeArtifacts ? "最近五分钟没有出现新的脚本、图片、视频或音频，已要求立即恢复并行创作。" : "启动创作五分钟后仍没有出现脚本、图片、视频或音频，已要求立即切换到创作产出路线。") : null
  };
}

function firstArtifactLane(artifacts, startedAtMs, nowMs, thresholdMinutes) {
  const elapsedMinutes = Math.max(0, (nowMs - startedAtMs) / 60000);
  const satisfied = artifacts.length > 0;
  return {
    status: satisfied ? "satisfied" : elapsedMinutes >= thresholdMinutes ? "breached" : "on_track",
    thresholdMinutes,
    elapsedMinutes: Number(elapsedMinutes.toFixed(2)),
    artifactRefs: artifacts.map(([artifactRef]) => artifactRef),
    breached: !satisfied && elapsedMinutes >= thresholdMinutes
  };
}

function approved(run, kind) {
  return (run.approvals ?? []).some((approval) => approval.kind === kind && approval.status === "approved");
}

function isCreativeArtifact(artifactRef, artifact = {}) {
  const mediaKind = artifact.mediaKind ?? artifact.kind;
  if (["image", "video", "audio"].includes(mediaKind)) return true;
  if (/\.(?:png|jpe?g|webp|gif|mp4|mov|webm|wav|mp3|m4a|aac)$/i.test(artifact.relativePath ?? artifact.path ?? artifactRef)) return true;
  return CREATIVE_DOCUMENTS.has(artifactRef) || /(?:script|storyboard|shotlist|reference_analysis|style_playbook)\.md$/i.test(artifactRef);
}

function isVisualArtifact(artifactRef, artifact = {}) {
  const mediaKind = artifact.mediaKind ?? artifact.kind;
  return ["image", "video"].includes(mediaKind) || /\.(?:png|jpe?g|webp|gif|mp4|mov|webm)$/i.test(artifact.relativePath ?? artifact.path ?? artifactRef);
}

function isPreviewArtifact(artifactRef, artifact = {}) {
  const mediaKind = artifact.mediaKind ?? artifact.kind;
  return mediaKind === "video" || /\.(?:mp4|mov|webm)$/i.test(artifact.relativePath ?? artifact.path ?? artifactRef);
}

function creativeArtifactTimestamp(artifact = {}) {
  for (const value of [artifact.updatedAt, artifact.registeredAt, artifact.createdAt, artifact.metadata?.updatedAt, artifact.metadata?.registeredAt, artifact.metadata?.createdAt]) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function nextTool(blocker) {
  if (blocker === "goal_not_bound") return "directorx_bind_goal";
  if (blocker === "run_mode_not_confirmed") return "directorx_create_and_ask_native_question";
  if (blocker === "minimum_intake_not_confirmed") return "directorx_confirm_intake";
  if (blocker === "pipeline_not_selected") return "directorx_select_pipeline";
  if (blocker === "complexity_not_planned") return "directorx_plan_production_complexity";
  if (blocker === "reference_download_consent") return "directorx_create_and_ask_native_question";
  if (blocker.startsWith("stage_approval:")) return "directorx_create_and_ask_native_question";
  if (blocker.startsWith("approval:")) return "directorx_create_and_ask_native_question";
  return "directorx_register_stage_package";
}
