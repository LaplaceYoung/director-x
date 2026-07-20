const ESSENTIAL_APPROVALS = Object.freeze(["budget", "image_model", "video_model", "voice_model"]);
const CREATIVE_DOCUMENTS = new Set([
  "research_plan.json", "reference_analysis.json", "reference_learning_report.json", "style_playbook.json",
  "script_or_outline.json", "shotlist.json", "keyframe_storyboard.json", "visual_prompt_pack.json"
]);

export function evaluateFastStartReadiness(run) {
  const blockers = [];
  if (!run.goal?.boundAt) blockers.push("goal_not_bound");
  if (!run.intakeGate?.ready) blockers.push("minimum_intake_not_confirmed");
  if (!run.pipeline) blockers.push("pipeline_not_selected");
  if (!run.productionComplexityPlan) blockers.push("complexity_not_planned");
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
  if (!run.fastStart?.startedAt) return { status: "awaiting_fast_start", creativeArtifactCount: creativeArtifacts.length, breached: false, nextRequiredAction: "directorx_begin_creative_work" };
  const elapsedMinutes = Math.max(0, (Date.parse(now) - Date.parse(run.fastStart.startedAt)) / 60000);
  const thresholdMinutes = Number(run.fastStart.creativeAssetSlaMinutes ?? 5);
  const satisfied = creativeArtifacts.length > 0;
  const breached = !satisfied && elapsedMinutes >= thresholdMinutes;
  return {
    schemaVersion: "1.0",
    status: satisfied ? "satisfied" : breached ? "breached" : "on_track",
    creativeArtifactCount: creativeArtifacts.length,
    creativeArtifactRefs: creativeArtifacts.map(([artifactRef]) => artifactRef),
    elapsedMinutes: Number(elapsedMinutes.toFixed(2)),
    thresholdMinutes,
    breached,
    nextRequiredAction: breached ? "dispatch_reference_asset_and_script_work_now" : satisfied ? null : "continue_parallel_creative_work",
    userFacingMessage: breached ? "五分钟内还没有出现新的脚本、图片、视频或音频，已要求立即切换到创作产出路线。" : null
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

function nextTool(blocker) {
  if (blocker === "goal_not_bound") return "directorx_bind_goal";
  if (blocker === "minimum_intake_not_confirmed") return "directorx_confirm_intake";
  if (blocker === "pipeline_not_selected") return "directorx_select_pipeline";
  if (blocker === "complexity_not_planned") return "directorx_plan_production_complexity";
  if (blocker === "reference_download_consent") return "directorx_create_and_ask_native_question";
  if (blocker.startsWith("approval:")) return "directorx_create_and_ask_native_question";
  return "directorx_register_stage_package";
}
