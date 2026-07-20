import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DX_SUBAGENT_CATALOG } from "./subagent-registry.mjs";

const capability = (id, department, ownerRoleId, toolClass, inputs, outputs, interaction = "automatic") => Object.freeze({ id, department, ownerRoleId, toolClass, inputs, outputs, interaction });

export const VIDEO_CAPABILITY_CATALOG = Object.freeze([
  capability("brief.resolve", "direction", "task_planner", "reasoning", ["project_brief.json"], ["intent_resolution.json", "Director.md"], "clarify_if_materially_ambiguous"),
  capability("reference.retrieve", "research", "reference_analyst", "web_search", ["research_plan.json"], ["reference_manifest.json", "rights_ledger.json"], "consent_before_download"),
  capability("reference.temporal_ground", "research", "reference_analyst", "media_analysis", ["reference_manifest.json"], ["media_evidence_index.json", "evidence_bundle.json"]),
  capability("asset.audit", "research", "asset_manager", "media_analysis", ["reference_manifest.json"], ["asset_manifest.json", "rights_ledger.json"]),
  capability("script.compose", "writing", "director_runtime", "reasoning", ["Director.md"], ["script_or_outline.json"]),
  capability("storyboard.plan", "preproduction", "shot_planner", "reasoning", ["script_or_outline.json"], ["shotlist.json", "keyframe_storyboard.json"]),
  capability("continuity.manage", "preproduction", "memory_manager", "state", ["shotlist.json"], ["continuity_plan.json"]),
  capability("image.generate", "generation", "provider_operator", "image_generation", ["keyframe_storyboard.json"], ["generated_image_candidates.json"], "provider_model_budget_confirmation"),
  capability("video.text_to_video", "generation", "provider_operator", "video_generation", ["shotlist.json"], ["generated_video_candidates.json"], "provider_model_budget_confirmation"),
  capability("video.image_to_video", "generation", "provider_operator", "video_generation", ["keyframe_storyboard.json"], ["generated_video_candidates.json"], "provider_model_budget_confirmation"),
  capability("video.first_last_frame", "generation", "provider_operator", "video_generation", ["frame_handoff_manifest.json"], ["generated_video_candidates.json"], "provider_model_budget_confirmation"),
  capability("video.extend", "generation", "provider_operator", "video_generation", ["selected_clips.json"], ["generated_video_candidates.json"], "provider_model_budget_confirmation"),
  capability("video.inpaint", "editing", "editing_agent", "video_edit_model", ["semantic_timeline.json", "mask_track.json"], ["timeline_patch.json"], "preview_then_approve"),
  capability("video.replace", "editing", "editing_agent", "video_edit_model", ["semantic_timeline.json", "reference_manifest.json"], ["timeline_patch.json"], "preview_then_approve"),
  capability("video.restyle", "editing", "editing_agent", "video_edit_model", ["semantic_timeline.json", "style_playbook.json"], ["timeline_patch.json"], "preview_then_approve"),
  capability("video.reframe", "editing", "editing_agent", "local_media", ["semantic_timeline.json"], ["timeline_patch.json"], "preview_then_approve"),
  capability("video.trim_reorder", "editing", "editing_agent", "local_media", ["semantic_timeline.json"], ["timeline_patch.json"], "preview_then_approve"),
  capability("video.transition", "editing", "editing_agent", "local_media", ["semantic_timeline.json"], ["timeline_patch.json"], "preview_then_approve"),
  capability("video.speed_ramp", "editing", "editing_agent", "local_media", ["semantic_timeline.json"], ["timeline_patch.json"], "preview_then_approve"),
  capability("screen.capture", "production", "provider_operator", "computer_use", ["shotlist.json"], ["screen_capture_manifest.json"], "confirm_target_and_sensitive_data"),
  capability("speech.transcribe", "audio", "provider_operator", "speech_to_text", ["source_media.json"], ["transcript_report.json"]),
  capability("speech.synthesize", "audio", "provider_operator", "text_to_speech", ["script_or_outline.json"], ["voice_track.json"], "voice_provider_confirmation"),
  capability("speech.lipsync", "audio", "provider_operator", "lipsync", ["voice_track.json", "character_reference.json"], ["lipsync_clip.json"], "consent_and_provider_confirmation"),
  capability("audio.music", "audio", "asset_manager", "music_generation_or_stock", ["audio_cue_sheet.json"], ["music_track.json", "rights_ledger.json"], "rights_and_budget_confirmation"),
  capability("audio.sound_design", "audio", "editing_agent", "local_media", ["audio_cue_sheet.json"], ["sound_design_track.json"]),
  capability("audio.mix", "audio", "editing_agent", "local_media", ["semantic_timeline.json"], ["audio_analysis_report.json", "render_report.json"]),
  capability("subtitle.compose", "localization", "editing_agent", "caption", ["transcript_report.json"], ["caption_track.json"]),
  capability("review.candidate_search", "review", "quality_evaluator", "visual_understanding", ["generated_video_candidates.json"], ["shot_review_report.json"]),
  capability("review.av_sync", "review", "quality_evaluator", "media_analysis", ["render_report.json"], ["av_review_timeline.json"]),
  capability("review.compare", "review", "quality_evaluator", "canvas", ["review_session.json"], ["review_decision.json"], "user_review"),
  capability("delivery.render", "delivery", "editing_agent", "local_media", ["semantic_timeline.json"], ["render_report.json"]),
  capability("delivery.package", "delivery", "approval_producer", "reasoning", ["render_report.json", "final_review.json"], ["publish_package.json", "delivery_manifest.json"], "delivery_approval")
]);

export function planCapabilityRoute(run, input, now = new Date().toISOString()) {
  if (!input?.routeId || !Array.isArray(input.requestedCapabilities) || !input.requestedCapabilities.length) throw new Error("Capability route requires an ID and requested capabilities.");
  const requested = [...new Set(input.requestedCapabilities)];
  const unknown = requested.filter((id) => !VIDEO_CAPABILITY_CATALOG.some((item) => item.id === id));
  if (unknown.length) throw new Error(`Unknown video capabilities: ${unknown.join(", ")}`);
  const availableArtifacts = new Set(Object.keys(run.artifacts ?? {}));
  const selected = VIDEO_CAPABILITY_CATALOG.filter((item) => requested.includes(item.id)).map((item) => {
    const owner = DX_SUBAGENT_CATALOG.find((role) => role.roleId === item.ownerRoleId);
    return { ...item, owner: owner.displayName, agentType: owner.agentType, missingInputs: item.inputs.filter((ref) => !availableArtifacts.has(ref)) };
  });
  const route = {
    schemaVersion: "1.0", routeId: input.routeId, objective: input.objective, pipelineId: run.pipeline?.id ?? null,
    requestedCapabilities: requested, capabilities: selected,
    interactionGates: [...new Set(selected.map((item) => item.interaction).filter((value) => value !== "automatic"))],
    requiredToolClasses: [...new Set(selected.map((item) => item.toolClass))], status: selected.some((item) => item.missingInputs.length) ? "inputs_required" : "ready", createdAt: now
  };
  run.capabilityRoute = route;
  return route;
}

export async function writeCapabilityRoute({ projectPath, runId, route }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "capability_route.json");
  await writeFile(path, `${JSON.stringify({ runId, ...route }, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "capability_route.json", path };
}
