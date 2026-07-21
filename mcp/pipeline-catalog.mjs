export const CORE_PIPELINE_STAGES = [
  stage("intake", "最小确认与快速创作启动", "directorx-production-orchestration", ["intake_confirmation.json", "intent_resolution.json", "Director.md", "director_contract.json", "project_brief.json", "delivery_promise.json", "production_complexity_plan.json"], ["goal_entry", "budget"], ["intent_analysis.json", "budget_plan.json", "audio_responsibility_plan.json", "capability_route.json", "tool_inventory.json", "capability_execution_plan.json", "execution_graph.json", "parallel_subagent_plan.json"]),
  stage("research", "联网研究、资产与参考分析", "directorx-reference-intake", ["research_plan.json", "web_research_receipt.json", "reference_manifest.json", "reference_analysis.json", "reference_video_assessment.json", "reference_learning_report.json", "asset_manifest.json", "rights_ledger.json", "visual_asset_coverage.json", "style_playbook.json"]),
  stage("script", "脚本与声音结构", "directorx-script-craft", ["script_or_outline.json", "claim_to_proof_map.json", "audio_cue_sheet.json"]),
  stage("storyboard", "镜头、分镜与连续性", "directorx-shot-planning", ["shotlist.json", "keyframe_storyboard.json", "continuity_plan.json", "scene_coverage_plan.json", "transition_language_plan.json", "shot_sequence_review.json", "shot_grounding_plan.json", "shot_grounding_report.json", "visual_prompt_pack.json"]),
  stage("generation", "素材与候选生成", "directorx-visual-prompting", ["audio_responsibility_plan.json", "capability_route.json", "tool_inventory.json", "capability_execution_plan.json", "execution_graph.json", "parallel_subagent_plan.json", "generation_request.json", "attempt_log.json", "selected_clips.json"], ["image_model", "video_model", "voice_model", "music_strategy"]),
  stage("edit", "剪辑、混音、字幕与渲染", "directorx-render-composition", ["edit_intent.json", "edit_graph.json", "timeline_patch.json", "timeline_preview.json", "edit_receipt.json", "timeline_revision.json", "semantic_timeline.json", "edit_decisions.json", "render_quality_contract.json", "render_report.json"]),
  stage("review", "画面、连续性、成本与交付审查", "directorx-production-review", ["review_session.json", "shot_review_report.json", "continuity_report.json", "production_lineage.json", "execution_telemetry.json", "route_regret_report.json", "model_knowledge_patch.json", "frame_audit_report.json", "frame_identity.jsonl", "frame_audit_repair_plan.json", "scene_coverage_conformance_report.json", "final_review_evidence.json", "final_review.json"]),
  stage("delivery", "平台包装与交付", "directorx-publish-packaging", ["publish_package.json", "delivery_manifest.json"], ["delivery"])
];

export const PIPELINE_CATALOG = [
  pipeline("brand-film", "品牌宣传片", ["directorx-director-runtime", "directorx-cinematography-audio"], "企业品牌、产品发布、科技宣传片"),
  pipeline("social-short", "平台短视频", ["directorx-platform-content-strategy", "directorx-subtitle-localization"], "抖音、小红书、视频号、Bilibili 短内容"),
  pipeline("reference-remix", "参考驱动创作", ["directorx-reference-intake", "directorx-continuity-memory"], "参考视频、竞品拆解、风格迁移"),
  pipeline("reference-replication", "参考片复刻", ["directorx-reference-intake", "directorx-visual-prompting", "directorx-production-review"], "下载并理解参考视频/音频，迁移节奏与导演语言，生成后做差异审计与复刻评分"),
  pipeline("screen-demo", "录屏与产品演示", ["directorx-screen-demo-production", "directorx-subtitle-localization"], "SaaS 演示、教程、应用走查"),
  pipeline("avatar", "数字人口播", ["directorx-avatar-lipsync", "directorx-cinematography-audio"], "数字人、真人口播、配音与唇形同步"),
  pipeline("footage-edit", "素材驱动剪辑", ["directorx-asset-sourcing", "directorx-render-composition"], "用户素材、采访、活动回顾与混剪"),
  pipeline("longform", "长视频与系列内容", ["directorx-longform-adaptation", "directorx-continuity-memory"], "长叙事、课程、纪录片和系列化内容"),
  pipeline("layered-collage", "分层纸片与拼贴动画", ["directorx-layered-collage-production", "directorx-render-composition"], "纸片动画、历史科普、人物关系、商业故事和分层视差视频")
];

export function getPipeline(pipelineId) {
  const selected = PIPELINE_CATALOG.find((pipeline) => pipeline.id === pipelineId);
  if (!selected) throw new Error(`Unknown Director X pipeline: ${pipelineId}`);
  return structuredClone(selected);
}

export function createPipelineRunState(pipelineId, selectedAt = new Date().toISOString()) {
  const selected = getPipeline(pipelineId);
  return { ...selected, selectedAt, stageStates: Object.fromEntries(selected.stages.map((stage) => [stage.id, { status: "pending", evidenceRefs: [] }])) };
}

export function transitionPipelineStage(pipeline, approvals, { stageId, action, detail, evidenceRefs = [] }, updatedAt = new Date().toISOString()) {
  const index = pipeline.stages.findIndex((stage) => stage.id === stageId);
  if (index < 0) throw new Error(`Stage ${stageId} is not part of the selected pipeline.`);
  const definition = pipeline.stages[index];
  if (action === "begin") {
    const incomplete = pipeline.stages.slice(0, index).find((stage) => pipeline.stageStates[stage.id].status !== "complete");
    if (incomplete) throw new Error(`Complete ${incomplete.id} before beginning ${stageId}.`);
    const missingApproval = definition.approvalKinds.find((kind) => !approvals.some((gate) => gate.kind === kind && gate.status === "approved") && kind !== "goal_entry" && kind !== "delivery");
    if (missingApproval) throw new Error(`Approval ${missingApproval} is required before ${stageId}.`);
  }
  if (action === "complete") {
    const missingEvidence = definition.requiredOutputs.filter((required) => !evidenceRefs.includes(required));
    if (missingEvidence.length) throw new Error(`Stage completion is missing required evidence: ${missingEvidence.join(", ")}`);
  }
  const status = { begin: "active", block: "blocked", fail: "failed", complete: "complete" }[action];
  if (!status) throw new Error(`Unsupported pipeline action: ${action}`);
  const next = structuredClone(pipeline);
  next.stageStates[stageId] = { status, detail, evidenceRefs, updatedAt };
  return next;
}

export function missingRegisteredArtifacts(pipeline, stageId, artifacts = {}) {
  const definition = pipeline.stages.find((stage) => stage.id === stageId);
  if (!definition) throw new Error(`Stage ${stageId} is not part of the selected pipeline.`);
  return definition.requiredOutputs.filter((artifactRef) => !artifacts[artifactRef]);
}

function stage(id, label, ownerSkill, requiredOutputs, approvalKinds = [], deferredOutputs = []) {
  return { id, label, ownerSkill, requiredOutputs, deferredOutputs, approvalKinds, reviewRequired: !["intake", "delivery"].includes(id) };
}

function pipeline(id, label, overlaySkills, useWhen) {
  const stages = structuredClone(CORE_PIPELINE_STAGES);
  if (["reference-remix", "footage-edit"].includes(id)) stages.find((stage) => stage.id === "research").requiredOutputs.push("media_evidence_index.json", "video_query_plan.json", "retrieval_trace.json", "evidence_bundle.json");
  if (id === "reference-remix") stages.find((stage) => stage.id === "research").requiredOutputs.push("reference_replication_plan.json", "reference_shot_blueprint.json", "reference_tool_route.json");
  if (id === "reference-replication") {
    const intake = stages.find((stage) => stage.id === "intake");
    intake.requiredOutputs = intake.requiredOutputs.filter((artifactRef) => !["Director.md", "director_contract.json"].includes(artifactRef));
    const research = stages.find((stage) => stage.id === "research");
    research.requiredOutputs.push("reference_replication_plan.json", "reference_shot_blueprint.json", "reference_tool_route.json", "reference_media_bundle.json", "Director.md", "director_contract.json");
    stages.find((stage) => stage.id === "review").requiredOutputs.push("replication_conformance_report.json");
  }
  if (id === "longform") {
    stages.find((stage) => stage.id === "storyboard").requiredOutputs.push("longform_segment_plan.json", "frame_handoff_manifest.json");
    stages.find((stage) => stage.id === "edit").requiredOutputs.push("longform_stitch_plan.json");
  }
  if (id === "layered-collage") {
    stages.find((stage) => stage.id === "script").requiredOutputs.push("audio_layer_plan.json");
    stages.find((stage) => stage.id === "storyboard").requiredOutputs.push("layered_scene_plan.json", "layer_manifest.json", "motion_preset.json", "layered_review_static_layout.json");
    stages.find((stage) => stage.id === "edit").requiredOutputs.push("layered_composition_config.json", "layered_review_motion_audio.json");
    stages.find((stage) => stage.id === "review").requiredOutputs.push("layered_review_final_media.json");
  }
  return { id, label, useWhen, overlaySkills, stages };
}
