import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DX_SUBAGENT_CATALOG } from "./subagent-registry.mjs";
import { renderCodexAgentRole } from "./codex-agent-roles.mjs";
import { createRun, updateRun } from "./run-store.mjs";
import { createOpenCutEditorSession, markOpenCutServiceRunning, recordPostProductionEditDecision } from "./opencut-editor.mjs";
import { buildWaveformPyramid } from "./waveform-pyramid.mjs";
import { quoteModelCost } from "./pricing-catalog.mjs";

const availableAgentTypes = DX_SUBAGENT_CATALOG.map((role) => role.agentType);
const readyHostToolNames = ["create_goal", "get_goal", "update_goal", "request_user_input", "exec", "wait"];
const preflightArgs = (projectPath, outcome) => ({
  projectPath,
  outcome,
  availableAgentTypes,
  hostToolNames: readyHostToolNames,
  hostSkillNames: ["browser:control-in-app-browser"]
});

async function claimBrowserCanvas(browserCanvasUrl) {
  const url = new URL(browserCanvasUrl);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const heartbeat = await fetch(`${url.origin}/directorx/api/surface-heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session: url.searchParams.get("session"),
      claimToken: url.searchParams.get("claim"),
      surface: "canvas",
      visibility: "visible",
      event: "boot"
    })
  });
  assert.equal(heartbeat.status, 200);
  return response;
}

function surfaceApiUrl(surfaceUrl, path, values = {}) {
  const surface = new URL(surfaceUrl);
  const url = new URL(path, surface.origin);
  url.searchParams.set("session", surface.searchParams.get("session"));
  url.searchParams.set("claim", surface.searchParams.get("claim"));
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
  return url;
}

function surfaceClaimHeaders(surfaceUrl, headers = {}) {
  return { ...headers, "X-DirectorX-Claim": new URL(surfaceUrl).searchParams.get("claim") };
}

test("serves MCP tools over newline-delimited stdio", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);

  try {
    await waitFor(() => messages(output).some((item) => item.id === 1), 1000);
    const message = messages(output).find((item) => item.id === 1);
    assert.equal(message.id, 1);
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_open_canvas"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_upsert_canvas_object"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_update_canvas_review_note"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_list_pipelines"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_list_subagent_roles"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_subagent"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_plan_production_team"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_plan_parallel_subagents"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_update_subagent"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_confirm_subagent_host_closed"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_select_pipeline"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_transition_stage"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_confirm_intake"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_record_intent_resolution"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_write_director_document"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_ingest_reference_video"));
    const readVideoTool = message.result.tools.find((tool) => tool.name === "directorx_read_video");
    assert.ok(readVideoTool);
    assert.equal(readVideoTool.inputSchema.properties.fps.maximum, 2);
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_search_video_evidence"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_materialize_evidence_clip"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_reference_replication_plan"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_reference_learning_candidate"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_promote_reference_learning"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_record_web_research"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_record_provider_api_research"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_record_reference_video_assessment"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_asset"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_acquire_web_image_asset"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_audit_visual_asset_coverage"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_validate_research_package"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_finalize_research"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_artifact"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_get_stage_requirements"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_stage_package"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_generation_plan"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_prompt_bound_generation_plan"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_list_media_providers"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_get_media_provider_setup"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_get_custom_media_provider_intake"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_custom_media_provider_adapter"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_get_custom_media_provider_setup"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_get_mosi_voice_setup"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_get_music_route_setup"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_list_music_libraries"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_audit_music_asset"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_audio_responsibility_plan"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_list_model_pricing"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_quote_model_cost"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_model_pricing"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_camera_continuity_graph"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_scene_coverage_plan"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_transition_language_plan"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_review_shot_sequence"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_claim_proof_map"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_shot_grounding_plan"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_finalize_shot_grounding"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_visual_prompt_pack"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_review_camera_references"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_segment_continuity_plan"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_extract_segment_boundary_frames"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_audit_segment_continuity"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_segment_stitch_plan"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_submit_media_generation"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_poll_media_generation"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_begin_generation_attempt"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_record_generation_candidate"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_generate_mosi_voiceover"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_generate_local_moss_tts_nano_voiceover"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_diagnose_setup"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_repair_setup"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_verify_final_media"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_record_scene_coverage_review"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_record_final_review_evidence"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_get_builtin_media_runtime"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_install_builtin_media_runtime"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_plan_production_complexity"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_prepare_fast_start_intake"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_get_fast_start_status"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_begin_creative_work"));
    const recoveryFacade = message.result.tools.find((tool) => tool.name === "directorx_recover_production");
    assert.ok(recoveryFacade);
    assert.equal(recoveryFacade._meta["directorx/legacyLooseContract"], false);
    assert.ok(recoveryFacade.inputSchema.oneOf);
    const statusFacade = message.result.tools.find((tool) => tool.name === "directorx_get_production_status");
    assert.ok(statusFacade);
    assert.equal(statusFacade._meta["directorx/legacyLooseContract"], false);
    assert.equal(statusFacade.annotations.readOnlyHint, true);
    const resumeFacade = message.result.tools.find((tool) => tool.name === "directorx_resume_production");
    assert.ok(resumeFacade);
    assert.equal(resumeFacade._meta["directorx/legacyLooseContract"], false);
    assert.equal(resumeFacade.annotations.readOnlyHint, true);
    const researchFacade = message.result.tools.find((tool) => tool.name === "directorx_research_video");
    assert.ok(researchFacade);
    assert.equal(researchFacade._meta["directorx/legacyLooseContract"], false);
    const generationFacade = message.result.tools.find((tool) => tool.name === "directorx_generate_media");
    assert.ok(generationFacade);
    assert.equal(generationFacade._meta["directorx/legacyLooseContract"], false);
    assert.ok(generationFacade.inputSchema.oneOf);
    const candidateReviewFacade = message.result.tools.find((tool) => tool.name === "directorx_review_media_candidate");
    assert.ok(candidateReviewFacade);
    assert.equal(candidateReviewFacade._meta["directorx/legacyLooseContract"], false);
    assert.ok(candidateReviewFacade.inputSchema.oneOf);
    assert.equal(message.result.tools.some((tool) => tool.name === "directorx_get_recovery_action"), false);
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_query_director_knowledge"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_query_cinematic_references"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_cinematic_reference_selection"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_transcribe_media_with_whisper"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_render_quality_contract"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_render_remotion_video"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_render_hyperframes_video"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_render_opencut_timeline"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_asset_search_plan"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_audit_asset_quality"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_review_generation_candidate"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_generation_repair"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_select_generation_candidate"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_prepare_goal_completion"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_edit_intent"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_timeline_revision"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_export_timeline_interchange"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_compile_edit_graph"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_register_timeline_patch"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_commit_timeline_patch"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_start_opencut_editor"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_get_opencut_editor_status"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_propose_evidence_rough_cut"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_import_opencut_edit_result"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_request_user_interaction"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_create_and_ask_native_question"));
    assert.ok(message.result.tools.some((tool) => tool.name === "directorx_resolve_user_interaction"));
    const preflight = message.result.tools.find((tool) => tool.name === "directorx_capability_preflight");
    const createRun = message.result.tools.find((tool) => tool.name === "directorx_create_run");
    const browserCanvas = message.result.tools.find((tool) => tool.name === "directorx_open_canvas");
    const inlineCanvas = message.result.tools.find((tool) => tool.name === "directorx_open_inline_canvas");
    const runSnapshot = message.result.tools.find((tool) => tool.name === "directorx_get_run_snapshot");
    const setupDoctor = message.result.tools.find((tool) => tool.name === "directorx_diagnose_setup");
    const setupRepair = message.result.tools.find((tool) => tool.name === "directorx_repair_setup");
    assert.equal(preflight.annotations.readOnlyHint, false);
    assert.equal(preflight.annotations.title, "准备制作空间");
    assert.ok(preflight.inputSchema.properties.hostToolNames);
    assert.ok(preflight.inputSchema.properties.hostSkillNames);
    assert.ok(preflight.inputSchema.required.includes("availableAgentTypes"));
    assert.ok(preflight.inputSchema.required.includes("hostToolNames"));
    assert.equal(createRun.annotations.readOnlyHint, false);
    assert.equal(setupDoctor.annotations.readOnlyHint, false);
    assert.equal(setupRepair.annotations.readOnlyHint, false);
    assert.deepEqual(setupDoctor.inputSchema.properties.profile.enum, ["planning_only", "local_video_read", "zero_key_edit", "local_composition", "provider_generation", "full_production"]);
    assert.equal(setupRepair.inputSchema.properties.confirmedBy.const, "request_user_input");
    assert.ok(message.result.tools.every((tool) => ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"].every((key) => typeof tool.annotations?.[key] === "boolean")));
    assert.equal(browserCanvas.annotations.readOnlyHint, false);
    assert.equal(inlineCanvas.annotations.readOnlyHint, true);
    assert.equal(runSnapshot.annotations.readOnlyHint, false);
    const mediaSubmission = message.result.tools.find((tool) => tool.name === "directorx_submit_media_generation");
    const mediaPoll = message.result.tools.find((tool) => tool.name === "directorx_poll_media_generation");
    const providerCancellation = message.result.tools.find((tool) => tool.name === "directorx_cancel_provider_job");
    assert.equal(mediaSubmission.annotations.openWorldHint, true);
    assert.equal(mediaSubmission.annotations.idempotentHint, true);
    assert.equal(mediaPoll.annotations.openWorldHint, true);
    assert.equal(providerCancellation.annotations.destructiveHint, true);
    assert.ok(message.result.tools.every((tool) => typeof tool.annotations?.title === "string" && tool.annotations.title.length > 0));
    assert.ok(message.result.tools.every((tool) => typeof tool._meta?.["openai/toolInvocation/invoking"] === "string"));
    assert.ok(message.result.tools.every((tool) => typeof tool._meta?.["openai/toolInvocation/invoked"] === "string"));
    assert.equal(preflight._meta["openai/toolInvocation/invoking"], "准备制作空间…");
    assert.equal(browserCanvas._meta["openai/toolInvocation/invoking"], "打开制作画布…");
    assert.equal(inlineCanvas._meta.ui.resourceUri, "ui://directorx/production-canvas-v1.html");
    assert.deepEqual(runSnapshot._meta.ui.visibility, ["model", "app"]);
    assert.match(runSnapshot.description, /MANDATORY on every resumed/);
  } finally {
    child.kill("SIGTERM");
  }
});

test("reviews and selects an accepted media candidate atomically and idempotently", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-review-facade-"));
  const created = await createRun({ projectPath, outcome: "Review one generated image" });
  const pricingQuote = quoteModelCost({ providerId: "openai", modelId: "gpt-image-1.5", mediaType: "image", usage: { outputCount: 1, quality: "high", resolution: "1024x1024" } });
  await updateRun({ projectPath, runId: created.runId, mutate(run) {
    run.status = "production_in_progress";
    run.stage = "generation";
    run.pipeline = { stageStates: { generation: { status: "active" } } };
    run.approvals = [{ kind: "budget", status: "approved" }, { kind: "image_model", status: "approved" }];
    run.decisions = [{ kind: "budget", value: { basis: "official_quotes", currency: "USD", cap: 2, routes: [{ providerId: "openai", modelId: "gpt-image-1.5", mediaType: "image", plannedCalls: 2, pricingQuote }] } }, { kind: "image_model", value: { providerId: "openai", modelId: "gpt-image-1.5" } }];
    run.generation = {
      generationRequestId: "GEN-REVIEW", currency: "USD", providerId: "openai", modelId: "gpt-image-1.5", requests: [
        { requestId: "REQ-1", shotId: "SHOT-1", mode: "image", qualityThreshold: 0.75, maxAttempts: 2, maxCost: 2, attemptCostCap: 1, attemptCount: 1, spent: 0.5, status: "awaiting_review", selectedCandidateId: null, negativeConstraints: [], inputAnchorAssets: [], outputAnchorAssets: [], carryForwardRules: [] },
        { requestId: "REQ-2", shotId: "SHOT-2", mode: "image", qualityThreshold: 0.75, maxAttempts: 2, maxCost: 2, attemptCostCap: 1, attemptCount: 1, spent: 0.5, status: "awaiting_review", selectedCandidateId: null, negativeConstraints: [], inputAnchorAssets: [], outputAnchorAssets: [], carryForwardRules: [] }
      ], attempts: [],
      candidates: [
        { requestId: "REQ-1", attemptId: "ATT-1", candidateId: "CAN-1", assetRef: "candidate:CAN-1", previewUri: "candidate.png", mediaType: "image", actualCost: 0.5, status: "awaiting_review", scores: null, decision: null, reviewReason: null, reviewedAt: null, selectedAt: null },
        { requestId: "REQ-2", attemptId: "ATT-2", candidateId: "CAN-2", assetRef: "candidate:CAN-2", previewUri: "candidate-2.png", mediaType: "image", actualCost: 0.5, status: "awaiting_review", scores: null, decision: null, reviewReason: null, reviewedAt: null, selectedAt: null }
      ], totalEstimatedCost: 1, totalActualCost: 1, providerJobs: []
    };
    run.canvas.nodes.push({ id: "candidate:CAN-1", type: "image", label: "Candidate", detail: "awaiting review", stage: "generation", status: "active", updatedAt: new Date().toISOString() });
    run.canvas.nodes.push({ id: "candidate:CAN-2", type: "image", label: "Candidate 2", detail: "awaiting review", stage: "generation", status: "active", updatedAt: new Date().toISOString() });
    return run;
  } });
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; });
  const review = { projectPath, runId: created.runId, action: "review", requestId: "REQ-1", candidateId: "CAN-1", scores: { promptMatch: 0.9, visualQuality: 0.9, continuity: 0.85, motion: 0.8, editFit: 0.9 }, evidence: [], defects: [], decision: "accept", reason: "Meets the approved image quality threshold." };
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 180, method: "tools/call", params: { name: "directorx_review_media_candidate", arguments: review } })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 180), 1500);
    const accepted = messages(output).find((item) => item.id === 180).result.structuredContent;
    assert.equal(accepted.candidateStatus, "selected");
    assert.equal(accepted.selected, true);
    assert.equal(accepted.nextRequiredAction, "directorx_build_rough_cut");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 181, method: "tools/call", params: { name: "directorx_review_media_candidate", arguments: review } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 181), 1500);
    const replay = messages(output).find((item) => item.id === 181).result.structuredContent;
    assert.equal(replay.candidateStatus, "selected");
    const rejected = { ...review, requestId: "REQ-2", candidateId: "CAN-2", scores: { promptMatch: 0.7, visualQuality: 0.6, continuity: 0.8, motion: 0.8, editFit: 0.55 }, evidence: [{ timeSeconds: 0, frameRef: "candidate:CAN-2", dimension: "composition", observation: "The product is cropped too tightly." }], defects: [{ code: "composition", severity: "major", timeSeconds: 0, description: "The product is cropped too tightly.", repairAction: "widen framing" }], decision: "retry", reason: "Composition needs one bounded correction.", primaryDefect: "composition" };
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 182, method: "tools/call", params: { name: "directorx_review_media_candidate", arguments: rejected } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 182), 1500);
    const repair = messages(output).find((item) => item.id === 182).result.structuredContent;
    assert.equal(repair.candidateStatus, "needs_action");
    assert.equal(repair.repair.disposition, "retry");
    assert.equal(repair.repair.controlVariable, "composition_clause");
    assert.equal(repair.nextRequiredAction, "directorx_generate_media:prepare");
    const prepare = { projectPath, runId: created.runId, action: "prepare", requestId: "REQ-2", attemptId: "ATT-RETRY-2", prompt: "Widen only the approved product composition while preserving identity and lighting.", providerOptions: {}, pricingUsage: { outputCount: 1, quality: "high", resolution: "1024x1024" } };
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 183, method: "tools/call", params: { name: "directorx_generate_media", arguments: prepare } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 183), 1500);
    const prepared = messages(output).find((item) => item.id === 183).result.structuredContent;
    assert.equal(prepared.attemptCount, 1);
    assert.equal(prepared.nextRequiredAction, "directorx_generate_media:submit");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 184, method: "tools/call", params: { name: "directorx_generate_media", arguments: prepare } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 184), 1500);
    assert.equal(messages(output).find((item) => item.id === 184).result.structuredContent.attemptCount, 1);
    const persisted = JSON.parse(await readFile(join(projectPath, ".directorx", "plugin-runs", `${created.runId}.json`), "utf8"));
    assert.equal(persisted.events.filter((item) => item.type === "generation.candidate.selected").length, 1);
    assert.equal(persisted.events.filter((item) => item.type === "generation.repair.compiled").length, 1);
    assert.equal(persisted.events.filter((item) => item.type === "generation.attempt.started").length, 1);
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("advertises the mandatory side-Browser startup contract during MCP initialization", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 100, method: "initialize", params: {} })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 100), 500);
    const initialized = messages(output).find((item) => item.id === 100).result;
    assert.match(initialized.instructions, /directorx_capability_preflight/);
    assert.match(initialized.instructions, /directorx_create_and_ask_native_question/);
    assert.match(initialized.instructions, /afterAnswer/);
    assert.match(initialized.instructions, /directorx_begin_creative_work/);
    assert.match(initialized.instructions, /directorx_prepare_fast_start_intake/);
    assert.match(initialized.instructions, /first-content, first-visual, or first-preview SLA/);
    assert.match(initialized.instructions, /music_strategy/);
    assert.match(initialized.instructions, /music_asset_selection/);
    assert.match(initialized.instructions, /Never start an auxiliary Director X MCP runtime/);
    assert.match(initialized.instructions, /directorx_record_scene_coverage_review/);
    assert.match(initialized.instructions, /audio_responsibility_plan\.json/);
    assert.match(initialized.instructions, /DX-Quality-Reviewer/);
    assert.match(initialized.instructions, /concise consumer-facing Director X voice/);
    assert.match(initialized.instructions, /never narrate tool calls/);
    assert.match(initialized.instructions, /at most two short sentences/);
  } finally { child.kill("SIGTERM"); }
});

test("prepares the complete minimum Intake contract through one MCP tool call", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-fast-start-intake-"));
  const run = await createRun({ projectPath, outcome: "制作 30 秒官网品牌片" });
  await updateRun({ projectPath, runId: run.runId, mutate(current) {
    current.goal = { ...current.goal, codexGoalId: "goal-fast-start", boundAt: "2026-07-20T00:00:00.000Z" };
    current.runMode = { mode: "guided_autonomy", confirmedAt: "2026-07-20T00:00:00.000Z", confirmedBy: "request_user_input", lowRiskAutoAdvance: true, stageApprovalRequired: false, hardGates: [] };
    current.subagentNamingStatus = { availableAgentTypes: ["default", "worker", "explorer"] };
    return current;
  } });
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; });
  const send = async (id, name, arguments_) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === id), 2000);
    return messages(output).find((item) => item.id === id);
  };
  const decisions = [
    ["objective", "建立产品认知", "brief"], ["audience", "企业客户", "brief"], ["platform", "官网", "user"],
    ["duration", "30 秒", "brief"], ["production_route", "ai_generation_plus_web_assets", "user"], ["asset_readiness", "需要联网获取公开素材", "user"]
  ].map(([field, value, source]) => ({ field, value, source, rationale: "已在最小 Intake 中确认" }));
  const director = {
    title: "科技品牌片", logline: "让复杂智能变得可感知", audience: "企业客户", platform: "官网", duration: "30s", aspectRatio: "16:9", objective: "建立产品认知",
    directorInterpretation: "从真实需求推进到可验证结果", hook: "界面与城市同时被点亮", beatProgression: "问题—能力—证据—行动", visualLanguage: "克制的未来现实主义", cameraGrammar: "稳定推进与功能性特写", composition: "秩序化构图", lightingColor: "中性灰与品牌强调色", performanceDirection: "自然可信", audioDirection: "清晰旁白与轻量空间声", musicDirection: "渐进电子乐", editRhythm: "前紧后稳", promptStrategy: "明确主体、动作、机位与光线变化", researchPlan: "优先官方资料和可授权资产", continuityAnchors: ["品牌色", "产品界面"], negativeRules: ["不使用空泛科技粒子"], reviewCriteria: ["信息准确", "字幕清晰"], approvalBoundaries: ["预算与模型需确认"]
  };
  try {
    const prepared = (await send(501, "directorx_prepare_fast_start_intake", {
      projectPath, runId: run.runId, pipelineId: "brand-film",
      intake: { decisions, questionsAsked: [], userAnswers: [] },
      resolution: { clarity: "clear", rawIntent: "制作 30 秒官网品牌片", resolvedIntent: "面向企业客户的 30 秒官网品牌片", directorPrompt: "以可验证产品证据建立信任", questionsAsked: [], userAnswers: [], safeInferences: ["使用 16:9"], unresolvedRisks: [] },
      director,
      production: { videoType: "brand_film", budgetCap: { currency: "CNY", amount: 10 }, durationSeconds: 30, qualityTarget: "professional", shotCount: 6, segmentCount: 1, referenceVideoCount: 0, modalities: ["image", "video", "voice", "music"], characterContinuity: false, deliveryTier: "publish" },
      delivery: { promise: "一支可播放、可审查的品牌短片", primaryViewerOutcome: "理解产品价值并产生下一步兴趣", minimumFinalScore: 0.8, minimumShotScore: 0.72, requiredArtifacts: ["script_or_outline.json", "semantic_timeline.json", "final_review.json"], requiredTracks: ["visual", "voiceover_or_dialogue", "music_or_ambience", "captions"] }
    })).result.structuredContent;
    assert.equal(prepared.pipeline.id, "brand-film");
    assert.equal(prepared.productionComplexityPlan.profile, "standard");
    assert.ok(prepared.readiness.blockers.includes("approval:budget"));
    assert.ok(!prepared.readiness.blockers.some((blocker) => blocker.startsWith("artifact:")));
    const brief = JSON.parse(await readFile(join(projectPath, ".directorx", "plugin-runs", run.runId, "artifacts", "project_brief.json"), "utf8"));
    const promise = JSON.parse(await readFile(join(projectPath, ".directorx", "plugin-runs", run.runId, "artifacts", "delivery_promise.json"), "utf8"));
    assert.equal(brief.run_mode, "guided_autonomy");
    assert.equal(promise.approved_production_paths[0].path, "ai_generation_plus_web_assets");
    const started = (await send(502, "directorx_begin_reference_research", { projectPath, runId: run.runId })).result.structuredContent;
    assert.equal(started.stage, "research");
    assert.equal(started.pipeline.stageStates.intake.status, "complete");
    assert.equal(started.pipeline.stageStates.research.status, "active");
    assert.equal(started.fastStart.dispatchPlan.tasks.length, 2);
    const dispatchActions = started.resumeActionPlan.groups.find((group) => group.phase === "parallel_dispatch").actions;
    assert.equal(dispatchActions.length, 2);
    assert.ok(dispatchActions.every((action) => action.tool === "spawn_agent"));
    assert.deepEqual(started.fastStart.generationBlockers, ["budget", "image_model", "video_model", "voice_model"]);
    const researched = (await send(503, "directorx_research_video", { projectPath, runId: run.runId })).result.structuredContent;
    assert.equal(researched.runId, run.runId);
    assert.equal(researched.stage, "research");
    assert.equal(researched.researchStatus, "reference_research_started");
    assert.equal(researched.taskCount, 2);
    assert.deepEqual(researched.generationBlockers, ["budget", "image_model", "video_model", "voice_model"]);
    const generation = (await send(504, "directorx_generate_media", { projectPath, runId: run.runId, action: "inspect" })).result.structuredContent;
    assert.equal(generation.runId, run.runId);
    assert.equal(generation.requestCount, 0);
    assert.deepEqual(generation.blockers, ["generation_plan_missing"]);
    assert.equal(generation.nextRequiredAction, "directorx_register_prompt_bound_generation_plan");
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("routes the first preflight to a standalone browser canvas", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "directorx_capability_preflight",
      arguments: preflightArgs("/tmp/directorx-browser-test", "Browser canvas test")
    }
  })}\n`);

  try {
    await waitFor(() => output.includes('"id":3'), 500);
    const message = JSON.parse(output.trim().split("\n").at(-1));
    const browserUrl = message.result.structuredContent.browserCanvasUrl;
    assert.deepEqual(message.result.structuredContent.requiredApprovals, ["goal_entry", "production_budget", "image_provider_and_model", "video_provider_and_model", "voice_provider_model_and_voice", "background_music_strategy"]);
    assert.deepEqual(message.result.structuredContent.hostAction, { type: "open_url", url: browserUrl, browser: "iab", visibility: true, persistence: "handoff", requiredBefore: "directorx_get_preflight_status" });
    assert.match(message.result.structuredContent.canvasTabKey, /^directorx:/);
    assert.match(message.result.structuredContent.hostActionInstructions.join(" "), /browser\.tabs\.finalize/);
    assert.equal(message.result.structuredContent.canvasTurnEndAction.keepStatus, "handoff");
    assert.equal(message.result.structuredContent.canvasService.status, "ready");
    assert.equal(message.result.structuredContent.status, "awaiting_canvas_open");
    assert.equal(message.result.structuredContent.nextHostInteraction, null);
    assert.equal(message.result.structuredContent.afterCanvasOpen.tool, "directorx_get_preflight_status");
    assert.equal(message.result.structuredContent.subagentNamingStatus.sessionReady, true);
    assert.equal(message.result.structuredContent.conversationExperience.mode, "concise_consumer");
    assert.equal(message.result.content[0].text, message.result.structuredContent.conversationExperience.startMessage);
    assert.doesNotMatch(message.result.content[0].text, /browserCanvasUrl|preflightId|MCP|JSON/);
    assert.match(browserUrl, /^http:\/\/127\.0\.0\.1:\d+\/directorx\/canvas/);
    const response = await claimBrowserCanvas(browserUrl);
    const html = await response.text();
    assert.match(html, /Director X Production Canvas/);
    assert.match(html, /生产画布/);
    assert.match(html, /审片/);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "directorx_get_preflight_status", arguments: { projectPath: "/tmp/directorx-browser-test", preflightId: message.result.structuredContent.preflightId } } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 31), 500);
    const opened = messages(output).find((item) => item.id === 31).result.structuredContent;
    assert.equal(opened.nextHostInteraction.hostAction.tool, "request_user_input");
  } finally {
    child.kill("SIGTERM");
  }
});

test("blocks Goal creation when a canonical DX role is not loaded in the current session", async () => {
  const userHome = await mkdtemp(join(tmpdir(), "directorx-empty-agent-home-"));
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { env: { ...process.env, HOME: userHome }, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  const projectPath = `/tmp/directorx-agent-bootstrap-${process.pid}`;
  const outcome = "Require real DX agents";
  const incompleteAgentTypes = availableAgentTypes.filter((agentType) => agentType !== "dx_quality_reviewer");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "directorx_capability_preflight", arguments: { ...preflightArgs(projectPath, outcome), availableAgentTypes: incompleteAgentTypes } } })}\n`);

  try {
    await waitFor(() => messages(output).some((item) => item.id === 4), 500);
    const preflight = messages(output).find((item) => item.id === 4).result.structuredContent;
    assert.equal(preflight.status, "awaiting_canvas_open");
    assert.deepEqual(preflight.requiredAgentTypes, ["quality_evaluator"]);
    await claimBrowserCanvas(preflight.browserCanvasUrl);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 44, method: "tools/call", params: { name: "directorx_get_preflight_status", arguments: { projectPath, preflightId: preflight.preflightId } } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 44), 500);
    const opened = messages(output).find((item) => item.id === 44).result.structuredContent;
    assert.equal(opened.status, "awaiting_agent_bootstrap");
    assert.equal(opened.nextHostInteraction.request.kind, "role_install");
    assert.match(opened.nextHostInteraction.request.requestId, /^dxq-role-/);
    assert.equal(opened.nextHostInteraction.hostAction.tool, "request_user_input");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "directorx_create_run", arguments: { projectPath, outcome, preflightId: preflight.preflightId, goalInteractionRequestId: "dxq-forged", confirmedBy: "request_user_input", goalAccepted: true } } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 5), 500);
    const blocked = messages(output).find((item) => item.id === 5).result;
    assert.equal(blocked.isError, true);
    assert.match(blocked.structuredContent.error.technicalMessage, /quality_evaluator/);
  } finally {
    child.kill("SIGTERM");
    await rm(userHome, { recursive: true, force: true });
  }
});

test("uses built-in compatibility hosts when custom DX roles are not loaded in this task", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-stale-agent-schema-"));
  const agentsDirectory = join(projectPath, ".codex", "agents");
  await mkdir(agentsDirectory, { recursive: true });
  await Promise.all(DX_SUBAGENT_CATALOG.map((role) => writeFile(join(agentsDirectory, `${role.agentType}.toml`), renderCodexAgentRole(role), "utf8")));
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "directorx_capability_preflight", arguments: { ...preflightArgs(projectPath, "Stale schema"), availableAgentTypes: ["default", "worker"] } } })}\n`);

  try {
    await waitFor(() => messages(output).some((item) => item.id === 41), 500);
    const preflight = messages(output).find((item) => item.id === 41).result.structuredContent;
    assert.equal(preflight.subagentNamingStatus.diskReady, true);
    assert.equal(preflight.subagentNamingStatus.sessionReady, true);
    assert.equal(preflight.subagentNamingStatus.customSessionReady, false);
    assert.equal(preflight.subagentNamingStatus.compatibilitySessionReady, true);
    assert.equal(preflight.subagentNamingStatus.sessionMode, "builtin_compatibility");
    assert.equal(preflight.status, "awaiting_canvas_open");
    await claimBrowserCanvas(preflight.browserCanvasUrl);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "directorx_get_preflight_status", arguments: { projectPath, preflightId: preflight.preflightId } } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 42), 500);
    const opened = messages(output).find((item) => item.id === 42).result.structuredContent;
    assert.equal(opened.status, "awaiting_goal_confirmation");
    assert.equal(opened.nextHostInteraction.request.kind, "goal_entry");
    assert.equal(opened.nextHostInteraction.hostAction.tool, "request_user_input");
    assert.equal(opened.subagentNamingStatus.restartRequired, false);
    assert.equal(opened.subagentNamingStatus.restartRecommended, true);
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("asks the host to reread spawn_agent enums when tool names are passed as agent types", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-invalid-agent-evidence-"));
  const agentsDirectory = join(projectPath, ".codex", "agents");
  await mkdir(agentsDirectory, { recursive: true });
  await Promise.all(DX_SUBAGENT_CATALOG.map((role) => writeFile(join(agentsDirectory, `${role.agentType}.toml`), renderCodexAgentRole(role), "utf8")));
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 42,
    method: "tools/call",
    params: {
      name: "directorx_capability_preflight",
      arguments: {
        projectPath,
        outcome: "Invalid agent evidence",
        availableAgentTypes: [
          "mcp__directorx_production__directorx_register_subagent",
          "multi_agent_v1__spawn_agent",
          "multi_agent_v1__wait_agent"
        ],
        hostToolNames: readyHostToolNames,
        hostSkillNames: ["browser:control-in-app-browser"]
      }
    }
  })}\n`);

  try {
    await waitFor(() => messages(output).some((item) => item.id === 42), 500);
    const preflight = messages(output).find((item) => item.id === 42).result.structuredContent;
    assert.equal(preflight.subagentNamingStatus.diskReady, true);
    assert.equal(preflight.subagentNamingStatus.sessionReady, false);
    assert.equal(preflight.subagentNamingStatus.restartRequired, false);
    assert.equal(preflight.subagentNamingStatus.agentTypeEvidence.status, "invalid_tool_names");
    assert.equal(preflight.status, "awaiting_canvas_open");
    await claimBrowserCanvas(preflight.browserCanvasUrl);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 102, method: "tools/call", params: { name: "directorx_get_preflight_status", arguments: { projectPath, preflightId: preflight.preflightId } } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 102), 500);
    const opened = messages(output).find((item) => item.id === 102).result.structuredContent;
    assert.equal(opened.status, "invalid_agent_type_evidence");
    assert.equal(opened.nextHostInteraction.request, null);
    assert.equal(opened.nextHostInteraction.hostAction.type, "retry_preflight");
    assert.equal(opened.nextHostInteraction.hostAction.sourceTool, "spawn_agent");
    assert.equal(opened.nextHostInteraction.hostAction.sourceField, "agent_type");
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("streams canvas video and audio with HTTP byte ranges", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-range-"));
  await writeFile(join(projectPath, "sample.mp4"), Buffer.from("0123456789abcdef"));
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 101, method: "tools/call", params: { name: "directorx_capability_preflight", arguments: preflightArgs(projectPath, "Range playback") } })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 101), 500);
    const canvasUrl = new URL(messages(output).find((item) => item.id === 101).result.structuredContent.browserCanvasUrl);
    const missingClaim = new URL(surfaceApiUrl(canvasUrl, "/directorx/api/media", { path: "sample.mp4" }));
    missingClaim.searchParams.delete("claim");
    assert.equal((await fetch(missingClaim)).status, 403);
    const wrongClaim = new URL(surfaceApiUrl(canvasUrl, "/directorx/api/media", { path: "sample.mp4" }));
    wrongClaim.searchParams.set("claim", "wrong");
    assert.equal((await fetch(wrongClaim)).status, 403);
    const response = await fetch(surfaceApiUrl(canvasUrl, "/directorx/api/media", { path: "sample.mp4" }), { headers: { Range: "bytes=4-9" } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 4-9/16");
    assert.equal(await response.text(), "456789");
  } finally { child.kill("SIGTERM"); await rm(projectPath, { recursive: true, force: true }); }
});

test("records claimed side-canvas timecode feedback into the durable Run", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-canvas-review-note-"));
  const mediaPath = join(projectPath, "candidate.mp4");
  await writeFile(mediaPath, Buffer.from("candidate"));
  const created = await createRun({ projectPath, outcome: "Review a candidate" });
  await updateRun({ projectPath, runId: created.runId, mutate(run) {
    run.artifacts["candidate.mp4"] = { artifactRef: "candidate.mp4", path: mediaPath, relativePath: "candidate.mp4", stage: "generation", mediaKind: "video", metadata: { durationSeconds: 10 } };
    return run;
  } });
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 151, method: "tools/call", params: { name: "directorx_open_canvas", arguments: { projectPath, runId: created.runId } } })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 151), 1000);
    const canvasUrl = new URL(messages(output).find((item) => item.id === 151).result.structuredContent.browserCanvasUrl);
    await claimBrowserCanvas(canvasUrl);
    const endpoint = surfaceApiUrl(canvasUrl, "/directorx/api/review-note");
    const payload = {
      session: canvasUrl.searchParams.get("session"),
      note: { clientNoteId: "client-note-151", targetArtifactRef: "candidate.mp4", targetNodeId: "artifact:candidate.mp4", timeSeconds: 3.5, category: "timing", severity: "major", body: "这里需要更快进入下一镜。" }
    };
    const missingClaim = new URL(endpoint); missingClaim.searchParams.delete("claim");
    assert.equal((await fetch(missingClaim, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })).status, 403);
    const response = await fetch(endpoint, { method: "POST", headers: surfaceClaimHeaders(canvasUrl, { "Content-Type": "application/json" }), body: JSON.stringify(payload) });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.note.timeSeconds, 3.5);
    assert.equal(result.isApproval, false);
    const retry = await fetch(endpoint, { method: "POST", headers: surfaceClaimHeaders(canvasUrl, { "Content-Type": "application/json" }), body: JSON.stringify(payload) });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).status, "unchanged");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 152, method: "tools/call", params: { name: "directorx_update_canvas_review_note", arguments: { projectPath, runId: created.runId, noteId: result.note.noteId, action: "acknowledge", owner: "DX-Editor" } } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 152), 1000);
    assert.equal(messages(output).find((item) => item.id === 152).result.structuredContent.canvasReviewNotes[0].status, "acknowledged");
    const state = await (await fetch(surfaceApiUrl(canvasUrl, "/directorx/api/state"))).json();
    assert.equal(state.canvasReviewNotes.length, 1);
    assert.equal(state.canvasReviewNotes[0].status, "acknowledged");
    assert.equal(state.events.filter((item) => item.type === "canvas.review_note.created").length, 1);
    assert.equal(state.productionCanvas.reviewNotes.openCount, 1);
    assert.ok(state.productionCanvas.reviewTimeline.markers.some((marker) => marker.noteId === result.note.noteId));
  } finally { child.kill("SIGTERM"); await rm(projectPath, { recursive: true, force: true }); }
});

test("starts Director X Cut only after a native choice and serves a saveable local edit draft", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-opencut-"));
  const sourcePath = join(projectPath, "reviewed.mp4");
  const analysisPath = join(projectPath, "audio-analysis.json");
  await writeFile(sourcePath, Buffer.from("0123456789abcdef"));
  await writeFile(analysisPath, JSON.stringify({ silence: [[1, 2]] }));
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; });
  const send = async (id, name, arguments_) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === id), 1500);
    return messages(output).find((item) => item.id === id).result;
  };
  try {
    const outcome = "Review then manually edit a short film";
    const preflight = (await send(301, "directorx_capability_preflight", preflightArgs(projectPath, outcome))).structuredContent;
    await claimBrowserCanvas(preflight.browserCanvasUrl);
    const openedPreflight = (await send(3012, "directorx_get_preflight_status", { projectPath, preflightId: preflight.preflightId })).structuredContent;
    await send(3011, "directorx_resolve_user_interaction", {
      projectPath,
      runId: `preflight:${preflight.preflightId}`,
      requestId: openedPreflight.nextHostInteraction.request.requestId,
      confirmedBy: "request_user_input",
      answers: { enter_directorx_goal: { answers: ["进入制作 (Recommended)"] } }
    });
    const run = (await send(302, "directorx_create_run", { projectPath, outcome, preflightId: preflight.preflightId, goalInteractionRequestId: openedPreflight.nextHostInteraction.request.requestId, confirmedBy: "request_user_input", goalAccepted: true })).structuredContent;
    const preflightCanvasUrl = new URL(preflight.browserCanvasUrl);
    const runCanvasUrl = new URL(run.browserCanvasUrl);
    assert.notEqual(runCanvasUrl.searchParams.get("claim"), preflightCanvasUrl.searchParams.get("claim"));
    assert.equal((await fetch(surfaceApiUrl(preflightCanvasUrl, "/directorx/api/state"))).status, 403);
    assert.equal((await fetch(surfaceApiUrl(runCanvasUrl, "/directorx/api/state"))).status, 200);
    await send(3021, "directorx_bind_goal", { projectPath, runId: run.runId, codexGoalId: "goal-opencut-test" });
    const waveform = await buildWaveformPyramid({ projectPath, runId: run.runId, waveformId: "delivery-mix", mediaPath: sourcePath, durationSeconds: 5, chunkDurationSeconds: 5, basePixelWidth: 64 }, { analyze: async ({ startSeconds, durationSeconds, pixelWidth }) => ({ startSeconds, durationSeconds, pixelWidth, sampleRate: 8000, samplesPerPoint: 1, peaks: Array.from({ length: pixelWidth * 2 }, (_, index) => index % 2 ? .6 : -.6) }) });
    await updateRun({ projectPath, runId: run.runId, mutate(current) {
      current.artifacts["delivery.video"] = { artifactRef: "delivery.video", path: sourcePath, relativePath: "reviewed.mp4", stage: "delivery", mediaKind: "video", sizeBytes: 16, sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };
      current.artifacts["audio_analysis_report.json"] = { artifactRef: "audio_analysis_report.json", path: analysisPath, relativePath: "audio-analysis.json", stage: "review", mediaKind: "document", sizeBytes: 20, sha256: "evidence" };
      current.waveformPyramids["delivery-mix"] = waveform.index;
      current.avReviewTimeline = { mediaArtifactRef: "delivery.video", subtitles: [], audioTracks: [{ id: "mix", role: "mix", waveformId: "delivery-mix", waveformWindow: { range: { start: { value: 0, rate: 1000 }, duration: { value: 5000, rate: 1000 } }, level: 0, samplesPerPoint: 1, pixelWidth: 64, peaks: [-.6, .6] } }], markers: [{ id: "silence-marker", evidenceRefs: ["audio_analysis_report.json"] }] };
      return current;
    } });
    const requested = (await send(303, "directorx_request_user_interaction", {
      projectPath, runId: run.runId, kind: "post_production_edit", reason: "决定是否进入手工剪辑。",
      questions: [{ header: "成片剪辑", id: "post_production_edit", question: "是否进入 Director X Cut？", options: [{ label: "进入剪辑 (Recommended)", description: "在本机侧边栏继续调整。" }, { label: "直接交付", description: "保留当前候选。" }] }]
    })).structuredContent.interaction.request;
    await send(304, "directorx_resolve_user_interaction", { projectPath, runId: run.runId, requestId: requested.requestId, confirmedBy: "request_user_input", answers: { post_production_edit: { answers: ["进入剪辑 (Recommended)"] } } });
    const started = await send(305, "directorx_start_opencut_editor", { projectPath, runId: run.runId, interactionRequestId: requested.requestId, confirmedBy: "request_user_input", editAccepted: true, sourceArtifactRef: "delivery.video", durationSeconds: 5, fps: 30, canvasSize: { width: 1920, height: 1080 } });
    assert.equal(started.isError, undefined);
    assert.match(started.structuredContent.editorUrl, /^http:\/\/127\.0\.0\.1:\d+\/directorx\/editor/);
    assert.equal(started.structuredContent.editorHostAction.visibility, true);
    const status = await send(306, "directorx_get_opencut_editor_status", { projectPath, runId: run.runId });
    assert.equal(status.structuredContent.editorHostAction.action, "open_or_claim");
    assert.equal(status.structuredContent.editorTurnEndAction.keepStatus, "handoff");

    const editorUrl = new URL(started.structuredContent.editorUrl);
    const html = await fetch(editorUrl);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Director X Cut/);
    const editorScript = await fetch(editorUrl.origin + "/directorx/opencut-editor.js");
    assert.equal(editorScript.status, 200);
    assert.match(await editorScript.text(), /function compactOperations/);
    const missingEditorClaim = new URL(surfaceApiUrl(editorUrl, "/directorx/api/editor-state"));
    missingEditorClaim.searchParams.delete("claim");
    assert.equal((await fetch(missingEditorClaim)).status, 403);
    const state = await (await fetch(surfaceApiUrl(editorUrl, "/directorx/api/editor-state"))).json();
    assert.equal(state.editorSurfaceHealth.status, "connected");
    assert.equal(state.branding.watermarkPolicy, "no_forced_output_watermark");
    assert.equal(state.attribution.commit, "cf5e79e919144200294fb9fed22a222592a0aeea");
    assert.equal(state.waveform.mode, "viewport_pyramid");
    const waveformWindow = await (await fetch(surfaceApiUrl(editorUrl, "/directorx/api/editor-waveform", { waveformId: "delivery-mix", start: 1, duration: 2, pixelWidth: 128 }))).json();
    assert.equal(waveformWindow.waveformId, "delivery-mix");
    assert.deepEqual(waveformWindow.range, { start: { value: 1000, rate: 1000 }, duration: { value: 2000, rate: 1000 } });
    const foreignWaveform = await fetch(surfaceApiUrl(editorUrl, "/directorx/api/editor-waveform", { waveformId: "other", start: 1, duration: 2, pixelWidth: 128 }));
    assert.equal(foreignWaveform.status, 403);
    const interchange = await send(3061, "directorx_export_timeline_interchange", { projectPath, runId: run.runId, revisionId: state.session.baseTimelineRevisionId });
    assert.equal(interchange.isError, undefined);
    assert.equal(interchange.structuredContent.timelineInterchange.status, "passed");
    assert.ok(interchange.structuredContent.artifacts["timeline_interchange.dx.json"]);
    assert.ok(interchange.structuredContent.artifacts["roundtrip_validation.json"]);
    const media = await fetch(surfaceApiUrl(editorUrl, "/directorx/api/editor-media"), { headers: { Range: "bytes=4-9" } });
    assert.equal(media.status, 206);
    assert.equal(await media.text(), "456789");

    const proposed = await send(307, "directorx_propose_evidence_rough_cut", {
      projectPath, runId: run.runId, editorSessionId: state.session.editorSessionId, proposalId: "stdio-rough-cut", owner: "DX-Editor",
      keepBeforeSeconds: 0, keepAfterSeconds: 0, minimumCutSeconds: 0.1,
      inactiveRanges: [{ startSeconds: 1, endSeconds: 2, reason: "silence", evidenceRefs: ["silence-marker"] }]
    });
    assert.equal(proposed.isError, undefined);
    assert.equal(proposed.structuredContent.roughCutProposal.owner, "DX-Editor");
    assert.equal(proposed.structuredContent.roughCutProposal.requiresNativeApproval, true);
    assert.equal(proposed.structuredContent.editorHostAction.action, "open_or_claim");

    const range = { start: { value: 0, rate: 30 }, duration: { value: 120, rate: 30 } };
    const rejectedDraft = await fetch(new URL("/directorx/api/editor-draft", editorUrl.origin), { method: "POST", headers: { "content-type": "application/json", "X-DirectorX-Claim": "wrong" }, body: JSON.stringify({ session: state.session.editorSessionId, editorSessionId: state.session.editorSessionId, baseRevision: state.session.baseRevision, baseContentHash: state.session.baseContentHash, summary: "Rejected draft", operations: [{ operation: "trim", clipId: "clip-final-1", value: { sourceRange: range, timelineRange: range }, affectedRanges: [range] }] }) });
    assert.equal(rejectedDraft.status, 403);
    const saved = await fetch(new URL("/directorx/api/editor-draft", editorUrl.origin), { method: "POST", headers: surfaceClaimHeaders(editorUrl, { "content-type": "application/json" }), body: JSON.stringify({ session: state.session.editorSessionId, editorSessionId: state.session.editorSessionId, baseRevision: state.session.baseRevision, baseContentHash: state.session.baseContentHash, summary: "Trim closing second", operations: [{ operation: "trim", clipId: "clip-final-1", value: { sourceRange: range, timelineRange: range }, affectedRanges: [range] }] }) });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).nextTool, "directorx_import_opencut_edit_result");
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("rebinds an active Director X Cut side-browser action after an MCP restart", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-opencut-rebind-"));
  const sourcePath = join(projectPath, "reviewed.mp4");
  await writeFile(sourcePath, Buffer.from("0123456789abcdef"));
  const run = await createRun({ projectPath, outcome: "Recover a side-browser editor" });
  await updateRun({ projectPath, runId: run.runId, mutate(current) {
    current.artifacts["delivery.video"] = { artifactRef: "delivery.video", path: sourcePath, relativePath: "reviewed.mp4", stage: "delivery", mediaKind: "video", sizeBytes: 16, sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };
    recordPostProductionEditDecision(current, { kind: "post_production_edit", requestId: "dxq-rebind", status: "resolved", confirmedBy: "request_user_input", answers: { post_production_edit: "进入剪辑 (Recommended)" } });
    const editor = createOpenCutEditorSession(current, { sourceArtifactRef: "delivery.video", durationSeconds: 5, fps: 30 });
    markOpenCutServiceRunning(current, editor.editorSessionId);
    return current;
  } });

  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 308, method: "tools/call", params: { name: "directorx_get_run_snapshot", arguments: { projectPath, runId: run.runId } } })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 308), 1500);
    const status = messages(output).find((item) => item.id === 308).result.structuredContent;
    assert.equal(status.canvasHostAction.action, "open_or_claim");
    assert.equal(status.editorHostAction.action, "open_or_claim");
    assert.equal(status.editorHostAction.visibility, true);
    assert.deepEqual(status.resumeActionPlan.groups[0].actions.map((action) => action.surface), ["canvas", "editor"]);
    assert.deepEqual(status.resumeActionPlan.groups.at(-1).actions.map((action) => action.keepStatus), ["handoff", "handoff"]);
    assert.equal((await fetch(status.editorUrl)).status, 200);
    const editorSession = new URL(status.editorUrl).searchParams.get("session");
    const editorUrl = new URL(status.editorUrl);
    const heartbeat = await fetch(`${editorUrl.origin}/directorx/api/surface-heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: editorSession, claimToken: editorUrl.searchParams.get("claim"), surface: "editor", visibility: "hidden", event: "test_hidden" }) });
    assert.equal(heartbeat.status, 200);
    assert.equal((await heartbeat.json()).health.status, "hidden");
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("reports session credential readiness without returning the secret", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 30, method: "tools/call", params: { name: "directorx_capability_preflight", arguments: preflightArgs("/tmp/directorx-credential-test", "Credential status") } })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 30), 500);
    const browserUrl = new URL(messages(output).find((item) => item.id === 30).result.structuredContent.browserCanvasUrl);
    const session = browserUrl.searchParams.get("session");
    assert.equal((await fetch(`${browserUrl.origin}/directorx/api/credential-status?session=${session}`)).status, 403);
    const malformed = await fetch(`${browserUrl.origin}/directorx/api/credential`, { method: "POST", headers: surfaceClaimHeaders(browserUrl, { "content-type": "application/json" }), body: "{" });
    assert.equal(malformed.status, 400);
    const oversized = await fetch(`${browserUrl.origin}/directorx/api/credential`, { method: "POST", headers: surfaceClaimHeaders(browserUrl, { "content-type": "application/json" }), body: JSON.stringify({ padding: "界".repeat(24_000) }) });
    assert.equal(oversized.status, 413);
    const posted = await fetch(`${browserUrl.origin}/directorx/api/credential`, { method: "POST", headers: surfaceClaimHeaders(browserUrl, { "content-type": "application/json" }), body: JSON.stringify({ session, providerId: "mosi.tts", envName: "MOSS_API_KEY", apiKey: "secret-test-key" }) });
    assert.equal(posted.status, 200);
    const mismatched = await fetch(`${browserUrl.origin}/directorx/api/credential`, { method: "POST", headers: surfaceClaimHeaders(browserUrl, { "content-type": "application/json" }), body: JSON.stringify({ session, providerId: "mosi.tts", envName: "IMAGE_PROVIDER_API_KEY", apiKey: "wrong-route-key" }) });
    assert.equal(mismatched.status, 400);
    const status = await fetch(surfaceApiUrl(browserUrl, "/directorx/api/credential-status"));
    const body = await status.json();
    assert.deepEqual(body.credentials.map(({ providerId, envName, configured }) => ({ providerId, envName, configured })), [{ providerId: "mosi.tts", envName: "MOSS_API_KEY", configured: true }]);
    assert.deepEqual(body.availableCredentials[0], { providerId: "mosi.tts", displayName: "MOSI Speech / MOSS-TTS", envName: "MOSS_API_KEY", recommended: true });
    assert.equal(JSON.stringify(body).includes("secret-test-key"), false);
  } finally { child.kill("SIGTERM"); }
});

test("returns official MOSI key creation guidance without requesting or exposing a key", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "directorx_get_mosi_voice_setup", arguments: {} } })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 31), 500);
    const setup = messages(output).find((item) => item.id === 31).result.structuredContent;
    assert.equal(setup.providerId, "mosi.tts");
    assert.equal(setup.modelId, "moss-tts");
    assert.deepEqual(setup.defaultSelection, { providerId: "mosi.tts", modelId: "moss-tts", recommended: true });
    assert.equal(setup.selectionQuestion.id, "voice_model");
    assert.equal(setup.selectionQuestion.options[0].label, "MOSS-TTS (Recommended)");
    assert.equal(setup.selectionQuestion.options[1].label, "MOSS-TTS-Nano (Local)");
    assert.match(setup.selectionQuestion.options[0].description, /platform\.mosi\.cn/);
    assert.deepEqual(setup.localSetup, {
      providerId: "openmoss.moss-tts-nano.local",
      modelId: "moss-tts-nano",
      repositoryUrl: "https://github.com/OpenMOSS/MOSS-TTS-Nano",
      command: "moss-tts-nano",
      commandEnv: "MOSS_TTS_NANO_COMMAND",
      generationTool: "directorx_generate_local_moss_tts_nano_voiceover",
      credentialRequired: false,
      requiredInputs: ["text", "promptSpeechPath", "promptSpeechRightsApproved", "outputPath"],
      outputFormat: "wav"
    });
    assert.equal(setup.keySetupInteraction.kind, "provider_input");
    assert.equal(setup.keySetupInteraction.gateKey, "mosi-tts-key-setup");
    assert.equal(setup.keySetupInteraction.questions[0].id, "mosi_key_setup");
    assert.equal(setup.keySetupInteraction.questions[0].question, "是否前往 MOSI 开放平台获取你的 TTS API Key？");
    assert.equal(setup.keySetupInteraction.questions[0].options[0].label, "前往 MOSI 开放平台 (Recommended)");
    assert.deepEqual(setup.keySetupAnswerActions["前往 MOSI 开放平台 (Recommended)"][0], {
      type: "open_url",
      url: "https://platform.mosi.cn",
      browser: "iab",
      target: "new_tab",
      visibility: true,
      persistence: "handoff",
      keepProductionCanvas: true
    });
    assert.equal(setup.keySetupAnswerActions["我已有 Key"][0].type, "focus_canvas_credential");
    assert.equal(setup.keyCreationUrl, "https://platform.mosi.cn");
    assert.equal(setup.docsUrl, "https://platform.mosi.cn/docs/getting-started/overview/");
    assert.equal(setup.credentialEnv, "MOSS_API_KEY");
    assert.equal(setup.credentialPolicy, "session_only_not_persisted");
    assert.equal(JSON.stringify(setup).includes("apiKey"), false);
  } finally { child.kill("SIGTERM"); }
});

test("requires exact provider and model intake before custom media API adaptation", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 32, method: "tools/call", params: { name: "directorx_get_custom_media_provider_intake", arguments: { mediaType: "video" } } })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 32), 500);
    const intake = messages(output).find((item) => item.id === 32).result.structuredContent;
    assert.equal(intake.interaction.kind, "provider_input");
    assert.equal(intake.interaction.questions[0].id, "video_provider_name");
    assert.equal(intake.interaction.questions[1].id, "video_model_name");
    assert.equal(intake.researchContract.sourcePolicy, "official_api_docs_only");
    assert.deepEqual(intake.researchContract.requiredHostActions, ["web.search_query", "web.open"]);
    assert.match(JSON.stringify(intake), /private-network API origins/);
  } finally { child.kill("SIGTERM"); }
});

test("keeps the side canvas open and returns a host repair action when Goal or AskUserQuestion is unavailable", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  const projectPath = `/tmp/directorx-host-capability-${process.pid}`;
  const outcome = "Deliver a verified video";
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 91,
    method: "tools/call",
    params: {
      name: "directorx_capability_preflight",
      arguments: {
        ...preflightArgs(projectPath, outcome),
        hostToolNames: ["exec", "wait"],
        hostSkillNames: ["browser:control-in-app-browser"]
      }
    }
  })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 91), 500);
    const preflight = messages(output).find((item) => item.id === 91).result.structuredContent;
    assert.equal(preflight.hostCapabilities.productionReadiness.status, "blocked");
    await claimBrowserCanvas(preflight.browserCanvasUrl);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 92, method: "tools/call", params: { name: "directorx_get_preflight_status", arguments: { projectPath, preflightId: preflight.preflightId } } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 92), 500);
    const status = messages(output).find((item) => item.id === 92).result.structuredContent;
    assert.equal(status.status, "host_capability_blocked");
    assert.equal(status.nextHostInteraction.request, null);
    assert.equal(status.nextHostInteraction.hostAction.type, "repair_host_capabilities");
    assert.ok(status.nextHostInteraction.hostAction.blockers.includes("native_goal"));
    assert.ok(status.nextHostInteraction.hostAction.blockers.includes("native_interaction"));
    assert.equal(status.bootTransaction.nextRequiredAction, "repair_host_capabilities");
  } finally {
    child.kill("SIGTERM");
  }
});

test("requires preflight and an opened browser canvas before run creation", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  const projectPath = `/tmp/directorx-startup-${process.pid}`;
  const outcome = "Deliver a final 60-second film";
  const startupPreflight = {
    ...preflightArgs(projectPath, outcome),
    hostToolNames: ["create_goal", "get_goal", "update_goal", "request_user_input", "exec", "wait"],
    hostSkillNames: ["browser:control-in-app-browser"]
  };
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "directorx_capability_preflight", arguments: startupPreflight } })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 10), 500);
    const preflight = messages(output).find((item) => item.id === 10).result.structuredContent;
    assert.equal(preflight.hostCapabilities.productionReadiness.status, "ready");
    const goalInteractionRequestId = `dxq-goal-${preflight.preflightId}`;
    const createArguments = { projectPath, outcome, preflightId: preflight.preflightId, goalInteractionRequestId, confirmedBy: "request_user_input", goalAccepted: true };
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "directorx_create_run", arguments: createArguments } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 11), 500);
    assert.match(messages(output).find((item) => item.id === 11).result.structuredContent.error.technicalMessage, /Open the Director X side Browser canvas/);
    await claimBrowserCanvas(preflight.browserCanvasUrl);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 113, method: "tools/call", params: { name: "directorx_get_preflight_status", arguments: { projectPath, preflightId: preflight.preflightId } } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 113), 500);
    const openedPreflight = messages(output).find((item) => item.id === 113).result.structuredContent;
    assert.equal(openedPreflight.nextHostInteraction.request.requestId, goalInteractionRequestId);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 112, method: "tools/call", params: { name: "directorx_create_run", arguments: createArguments } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 112), 500);
    assert.match(messages(output).find((item) => item.id === 112).result.structuredContent.error.technicalMessage, /Resolve the Director X Goal entry/);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 111, method: "tools/call", params: { name: "directorx_resolve_user_interaction", arguments: { projectPath, runId: `preflight:${preflight.preflightId}`, requestId: goalInteractionRequestId, confirmedBy: "request_user_input", answers: { enter_directorx_goal: { answers: ["进入制作 (Recommended)"] } } } } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 111), 500);
    const resolved = messages(output).find((item) => item.id === 111).result.structuredContent.resolvedInteraction;
    assert.deepEqual(resolved.answers, { enter_directorx_goal: "进入制作 (Recommended)" });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "directorx_create_run", arguments: createArguments } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 12), 500);
    const run = messages(output).find((item) => item.id === 12).result.structuredContent;
    assert.match(run.runId, /^dx-/);
    assert.equal(run.status, "awaiting_goal_binding");
    assert.equal(run.hostCapabilities.productionReadiness.status, "ready");
    assert.equal(run.nextHostInteraction.hostAction.tool, "create_goal");
    assert.equal(run.nextHostInteraction.nextTool.tool, "directorx_bind_goal");
  } finally {
    child.kill("SIGTERM");
  }
});

test("requires browser failure evidence before using the inline canvas fallback", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-inline-evidence-"));
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  const send = async (id, name, arguments_) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === id), 1000);
    return messages(output).find((item) => item.id === id).result;
  };
  try {
    const outcome = "Open a production canvas";
    const preflight = (await send(401, "directorx_capability_preflight", preflightArgs(projectPath, outcome))).structuredContent;
    const blocked = await send(402, "directorx_open_inline_canvas", { projectPath, preflightId: preflight.preflightId, outcome });
    assert.equal(blocked.isError, true);
    assert.match(blocked.structuredContent.error.technicalMessage, /invalid params|runId/i);

    const fallback = await send(403, "directorx_open_inline_canvas", {
      projectPath,
      preflightId: preflight.preflightId,
      outcome,
      fallbackReason: "browser_runtime_unavailable",
      failureDetail: "Official Browser runtime initialization returned browser_disconnected."
    });
    assert.equal(fallback.isError, true);
    assert.match(fallback.structuredContent.error.technicalMessage, /invalid params|runId/i);
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("starts the canvas service immediately and withholds Goal interaction until the side Browser opens", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-canvas-first-"));
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  const send = async (id, name, arguments_) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === id), 1000);
    return messages(output).find((item) => item.id === id).result;
  };
  try {
    const outcome = "Deliver a canvas-first product ad";
    const preflight = (await send(421, "directorx_capability_preflight", preflightArgs(projectPath, outcome))).structuredContent;
    assert.equal(preflight.canvasService.status, "ready");
    assert.equal(preflight.status, "awaiting_canvas_open");
    assert.equal(preflight.nextHostInteraction, null);
    assert.equal(preflight.afterCanvasOpen.tool, "directorx_get_preflight_status");

    const unopened = (await send(422, "directorx_get_preflight_status", { projectPath, preflightId: preflight.preflightId })).structuredContent;
    assert.equal(unopened.status, "awaiting_canvas_open");
    assert.equal(unopened.nextHostInteraction, null);

    const blockedResolve = await send(423, "directorx_resolve_user_interaction", {
      projectPath,
      runId: `preflight:${preflight.preflightId}`,
      requestId: `dxq-goal-${preflight.preflightId}`,
      confirmedBy: "request_user_input",
      answers: { enter_directorx_goal: { answers: ["进入制作 (Recommended)"] } }
    });
    assert.equal(blockedResolve.isError, true);
    assert.match(blockedResolve.structuredContent.error.technicalMessage, /open the Director X side Browser canvas/i);

    const served = await fetch(preflight.browserCanvasUrl);
    assert.equal(served.status, 200);
    const canvasUrl = new URL(preflight.browserCanvasUrl);
    const rejectedClaim = await fetch(`${canvasUrl.origin}/directorx/api/surface-heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: canvasUrl.searchParams.get("session"), claimToken: "wrong", surface: "canvas", visibility: "visible", event: "boot" })
    });
    assert.equal(rejectedClaim.status, 403);
    const fetchedOnly = (await send(424, "directorx_get_preflight_status", { projectPath, preflightId: preflight.preflightId })).structuredContent;
    assert.equal(fetchedOnly.status, "awaiting_canvas_open");
    assert.equal(fetchedOnly.canvasSurfaceHealth.status, "awaiting_open");
    assert.equal(fetchedOnly.canvasSurfaceHealth.hostClaimed, false);
    assert.match(fetchedOnly.canvasSurfaceHealth.documentServedAt, /^\d{4}-/);
    await claimBrowserCanvas(preflight.browserCanvasUrl);
    const opened = (await send(425, "directorx_get_preflight_status", { projectPath, preflightId: preflight.preflightId })).structuredContent;
    assert.equal(opened.status, "awaiting_goal_confirmation");
    assert.equal(opened.canvasSurfaceHealth.status, "connected");
    assert.equal(opened.canvasSurfaceHealth.hostClaimed, true);
    assert.match(opened.canvasSurfaceHealth.hostClaimedAt, /^\d{4}-/);
    assert.equal(opened.nextHostInteraction.hostAction.tool, "request_user_input");
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("recovers the pre-Run Goal transaction after an MCP restart without repeating the native question", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-preflight-restart-"));
  const outcome = "Deliver a restart-safe product film";
  let first = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let firstOutput = "";
  first.stdout.setEncoding("utf8");
  first.stdout.on("data", (chunk) => { firstOutput += chunk; });
  const sendFirst = async (id, name, arguments_) => {
    first.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } })}\n`);
    await waitFor(() => messages(firstOutput).some((item) => item.id === id), 1000);
    return messages(firstOutput).find((item) => item.id === id).result.structuredContent;
  };
  let second;
  try {
    const preflight = await sendFirst(501, "directorx_capability_preflight", preflightArgs(projectPath, outcome));
    await claimBrowserCanvas(preflight.browserCanvasUrl);
    const opened = await sendFirst(502, "directorx_get_preflight_status", { projectPath, preflightId: preflight.preflightId });
    const resolved = await sendFirst(503, "directorx_resolve_user_interaction", {
      projectPath,
      runId: `preflight:${preflight.preflightId}`,
      requestId: opened.nextHostInteraction.request.requestId,
      confirmedBy: "request_user_input",
      answers: { enter_directorx_goal: { answers: ["进入制作 (Recommended)"] } }
    });
    assert.equal(resolved.bootTransaction.state, "awaiting_goal_creation");

    first.kill("SIGTERM");
    await new Promise((resolveExit) => first.once("exit", resolveExit));

    second = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
    let secondOutput = "";
    second.stdout.setEncoding("utf8");
    second.stdout.on("data", (chunk) => { secondOutput += chunk; });
    const sendSecond = async (id, name, arguments_) => {
      second.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } })}\n`);
      await waitFor(() => messages(secondOutput).some((item) => item.id === id), 1000);
      return messages(secondOutput).find((item) => item.id === id).result.structuredContent;
    };

    const recovered = await sendSecond(504, "directorx_get_preflight_status", { projectPath, preflightId: preflight.preflightId });
    assert.equal(recovered.status, "awaiting_canvas_open");
    assert.equal(recovered.bootTransaction.recoveredFromDisk, true);
    assert.equal(recovered.bootTransaction.state, "awaiting_canvas_claim");
    assert.ok(recovered.bootTransaction.completedSteps.includes("goal_confirmed"));
    assert.notEqual(recovered.browserCanvasUrl, preflight.browserCanvasUrl);

    await claimBrowserCanvas(recovered.browserCanvasUrl);
    const reclaimed = await sendSecond(505, "directorx_get_preflight_status", { projectPath, preflightId: preflight.preflightId });
    assert.equal(reclaimed.status, "awaiting_goal_creation");
    assert.equal(reclaimed.nextHostInteraction, null);
    assert.equal(reclaimed.bootTransaction.nextRequiredAction, "create_goal_then_run");
    assert.deepEqual(reclaimed.goalLifecycle.afterAcceptance.map((action) => action.tool), ["create_goal", "directorx_create_run", "directorx_bind_goal"]);
  } finally {
    first.kill("SIGTERM");
    second?.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("blocks intake until the native Codex Goal is bound", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-goal-binding-"));
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  const send = async (id, name, arguments_) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === id), 1000);
    return messages(output).find((item) => item.id === id).result;
  };
  try {
    const outcome = "Deliver a playable Goal-bound film";
    const preflight = (await send(411, "directorx_capability_preflight", preflightArgs(projectPath, outcome))).structuredContent;
    await claimBrowserCanvas(preflight.browserCanvasUrl);
    const openedPreflight = (await send(417, "directorx_get_preflight_status", { projectPath, preflightId: preflight.preflightId })).structuredContent;
    await send(412, "directorx_resolve_user_interaction", {
      projectPath,
      runId: `preflight:${preflight.preflightId}`,
      requestId: openedPreflight.nextHostInteraction.request.requestId,
      confirmedBy: "request_user_input",
      answers: { enter_directorx_goal: { answers: ["进入制作 (Recommended)"] } }
    });
    const run = (await send(413, "directorx_create_run", {
      projectPath,
      outcome,
      preflightId: preflight.preflightId,
      goalInteractionRequestId: openedPreflight.nextHostInteraction.request.requestId,
      confirmedBy: "request_user_input",
      goalAccepted: true
    })).structuredContent;
    const question = {
      projectPath,
      runId: run.runId,
      kind: "intake",
      reason: "Confirm the brief.",
      questions: [{ header: "成片规格", id: "format", question: "请选择规格。", options: [{ label: "16:9 (Recommended)", description: "横屏产品广告。" }, { label: "9:16", description: "竖屏短视频。" }] }]
    };
    const blocked = await send(414, "directorx_request_user_interaction", question);
    assert.equal(blocked.isError, true);
    assert.match(blocked.structuredContent.error.technicalMessage, /Bind the native Codex Goal/);

    const bound = (await send(415, "directorx_bind_goal", { projectPath, runId: run.runId, codexGoalId: "goal-native-1" })).structuredContent;
    assert.equal(bound.goal.codexGoalId, "goal-native-1");
    assert.match(bound.goal.boundAt, /^\d{4}-/);
    assert.equal(bound.status, "awaiting_approval");
    const requested = await send(416, "directorx_request_user_interaction", question);
    assert.equal(requested.isError, undefined);
    assert.equal(requested.structuredContent.interaction.request.kind, "intake");
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("compiles an executable DX production team from complexity and execution graph state", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-auto-team-"));
  const seeded = await createRun({ projectPath, outcome: "Create a fast source-grounded product film", codexGoalId: "goal-auto-team" });
  await updateRun({ projectPath, runId: seeded.runId, mutate(run) {
    run.productionComplexityPlan = { profile: "quick", settings: { maxConcurrency: 2, maxSubagentTasksPerStage: 2 } };
    run.executionGraph = {
      intentSummary: "Research the product and usable visual assets in parallel",
      nodes: [
        { nodeId: "refs", kind: "agent", owner: "DX-Reference-Analyst", stage: "research", label: "Research official sources", dependsOn: [], inputArtifactRefs: ["Director.md"], outputArtifactRefs: ["reference_analysis.json"] },
        { nodeId: "assets", kind: "agent", owner: "DX-Asset-Manager", stage: "research", label: "Acquire and audit assets", dependsOn: [], inputArtifactRefs: ["Director.md"], outputArtifactRefs: ["asset_manifest.json"] }
      ]
    };
    return run;
  } });
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 430,
    method: "tools/call",
    params: {
      name: "directorx_plan_production_team",
      arguments: {
        projectPath,
        runId: seeded.runId,
        planId: "auto-research-team",
        objective: "Research facts and assets concurrently",
        availableAgentTypes,
        hostConcurrencyLimit: 2
      }
    }
  })}\n`);
  try {
    await waitFor(() => messages(output).some((item) => item.id === 430), 1000);
    const result = messages(output).find((item) => item.id === 430).result.structuredContent;
    assert.equal(result.subagentOrchestrationPlan.planId, "auto-research-team");
    assert.deepEqual(result.subagentOrchestrationPlan.tasks.map((item) => item.displayName), ["DX-Asset-Manager", "DX-Reference-Analyst"]);
    assert.equal(result.subagentOrchestrationPlan.batches[0].hostActions.length, 2);
    assert.ok(result.subagentOrchestrationPlan.batches[0].hostActions.every((action) => action.parallelGroupId === "auto-research-team:wave:1"));
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("persists, deduplicates, and enforces native request_user_input gates", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-native-gate-"));
  const outcome = "Render a native-gated film";
  const send = async (id, name, arguments_) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === id), 1000);
    return messages(output).find((item) => item.id === id);
  };
  try {
    const preflight = (await send(201, "directorx_capability_preflight", preflightArgs(projectPath, outcome))).result.structuredContent;
    await claimBrowserCanvas(preflight.browserCanvasUrl);
    const openedPreflight = (await send(2012, "directorx_get_preflight_status", { projectPath, preflightId: preflight.preflightId })).result.structuredContent;
    await send(2011, "directorx_resolve_user_interaction", {
      projectPath,
      runId: `preflight:${preflight.preflightId}`,
      requestId: openedPreflight.nextHostInteraction.request.requestId,
      confirmedBy: "request_user_input",
      answers: { enter_directorx_goal: { answers: ["进入制作 (Recommended)"] } }
    });
    const run = (await send(202, "directorx_create_run", { projectPath, outcome, preflightId: preflight.preflightId, goalInteractionRequestId: openedPreflight.nextHostInteraction.request.requestId, confirmedBy: "request_user_input", goalAccepted: true })).result.structuredContent;
    await send(2021, "directorx_bind_goal", { projectPath, runId: run.runId, codexGoalId: "goal-native-gate-test" });
    const compactStatus = (await send(2022, "directorx_get_production_status", { projectPath, runId: run.runId })).result.structuredContent;
    assert.equal(compactStatus.runId, run.runId);
    assert.equal(compactStatus.stage, "intake");
    assert.equal(compactStatus.status, "awaiting_approval");
    assert.equal(compactStatus.recovery.status, "clear");
    assert.equal(compactStatus.nextTool, "directorx_create_and_ask_native_question");
    const resumed = (await send(2023, "directorx_resume_production", { projectPath, runId: run.runId })).result.structuredContent;
    assert.equal(resumed.runId, run.runId);
    assert.equal(resumed.stage, "intake");
    assert.equal(resumed.nextRequiredAction, "plan_production_complexity");
    assert.equal(resumed.resumeActionPlan.runId, run.runId);
    const interactionInput = {
      projectPath, runId: run.runId, kind: "run_mode", reason: "运行模式会改变阶段批准频率。",
      questions: [{ header: "运行模式", id: "run_mode", question: "请选择 Director X 运行模式。", options: [{ label: "引导自治 (Recommended)", description: "自动推进安全步骤，只在硬门等待确认。" }, { label: "逐阶段确认", description: "每个阶段开始前都需要确认。" }] }]
    };
    const first = (await send(203, "directorx_create_and_ask_native_question", interactionInput)).result.structuredContent;
    const duplicate = (await send(204, "directorx_create_and_ask_native_question", interactionInput)).result.structuredContent;
    assert.equal(first.interaction.request.requestId, duplicate.interaction.request.requestId);
    assert.equal(first.interaction.hostAction.tool, "request_user_input");
    assert.equal(first.interaction.hostAction.afterAnswer.tool, "directorx_resolve_user_interaction");
    assert.equal(first.interaction.hostAction.afterAnswer.arguments.requestId, first.interaction.request.requestId);
    const blocked = await send(205, "directorx_configure_run_mode", { projectPath, runId: run.runId, mode: "guided_autonomy", confirmedBy: "request_user_input", interactionRequestId: first.interaction.request.requestId });
    assert.equal(blocked.result.isError, true);
    assert.match(blocked.result.structuredContent.error.technicalMessage, /Resolve native interaction/);
    await send(206, "directorx_resolve_user_interaction", { projectPath, runId: run.runId, requestId: first.interaction.request.requestId, confirmedBy: "request_user_input", answers: { run_mode: { answers: ["引导自治 (Recommended)"] } } });
    const configured = (await send(207, "directorx_configure_run_mode", { projectPath, runId: run.runId, mode: "guided_autonomy", confirmedBy: "request_user_input", interactionRequestId: first.interaction.request.requestId })).result.structuredContent;
    assert.equal(configured.runMode.mode, "guided_autonomy");
    assert.equal(configured.interactions.pending.length, 0);
    assert.equal(configured.interactions.history.length, 1);

    const pendingRequests = [];
    for (const [offset, kind, questionId] of [
      [208, "image_model", "image_model"],
      [209, "video_model", "video_model"],
      [210, "voice_model", "voice_model"]
    ]) {
      const requested = (await send(offset, "directorx_request_user_interaction", {
        projectPath,
        runId: run.runId,
        kind,
        reason: `Select ${kind}.`,
        questions: [{
          header: kind,
          id: questionId,
          question: `Choose ${kind}.`,
          options: [
            { label: "A (Recommended)", description: "Primary route." },
            { label: "B", description: "Fallback route." }
          ]
        }]
      })).result.structuredContent;
      pendingRequests.push(requested.interaction.request);
    }
    const batched = (await send(211, "directorx_get_run_snapshot", { projectPath, runId: run.runId })).result.structuredContent;
    assert.deepEqual(batched.nextHostInteraction.requestBatch.sourceRequestIds, pendingRequests.map((item) => item.requestId));
    assert.deepEqual(batched.nextHostInteraction.hostAction.arguments.questions.map((item) => item.id), ["image_model", "video_model", "voice_model"]);
    assert.equal(batched.nextHostInteraction.hostAction.afterAnswer.type, "mcp_tool_sequence");
    assert.deepEqual(
      batched.nextHostInteraction.hostAction.afterAnswer.actions.map((item) => item.arguments.requestId),
      pendingRequests.map((item) => item.requestId)
    );
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("serves the production canvas as an MCP App resource", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/read",
    params: { uri: "ui://directorx/production-canvas-v1.html" }
  })}\n`);

  try {
    await waitFor(() => output.includes("Director X"), 500);
    const message = JSON.parse(output.trim().split("\n").at(-1));
    assert.equal(message.id, 2);
    assert.equal(message.result.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(message.result.contents[0].text, /Director X/);
  } finally {
    child.kill("SIGTERM");
  }
});

test("lists and reads SHA-bound Director X Run artifact resource templates", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-mcp-artifact-resource-"));
  const content = "# Review notes\n\nUse the real product interface.\n";
  const path = join(projectPath, "review-notes.md");
  await writeFile(path, content);
  const run = await createRun({ projectPath, outcome: "Read one registered artifact" });
  const artifactRef = "review-notes.md";
  await updateRun({ projectPath, runId: run.runId, mutate(current) {
    current.artifacts[artifactRef] = {
      artifactRef,
      runId: run.runId,
      path,
      relativePath: artifactRef,
      stage: "review",
      mediaKind: "document",
      sizeBytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex")
    };
    return current;
  } });
  const uri = new URL("directorx://artifact");
  uri.searchParams.set("projectPath", projectPath);
  uri.searchParams.set("runId", run.runId);
  uri.searchParams.set("artifactRef", artifactRef);
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 601, method: "resources/templates/list", params: {} })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 601), 1000);
    const templates = messages(output).find((item) => item.id === 601).result.resourceTemplates;
    assert.equal(templates[0].uriTemplate, "directorx://artifact{?projectPath,runId,artifactRef}");

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 602, method: "resources/read", params: { uri: uri.toString() } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 602), 1000);
    const resource = messages(output).find((item) => item.id === 602).result.contents[0];
    assert.equal(resource.mimeType, "text/markdown; charset=utf-8");
    assert.equal(resource.text, content);
    assert.equal(resource._meta.artifactRef, artifactRef);

    await writeFile(path, "tampered");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 603, method: "resources/read", params: { uri: uri.toString() } })}\n`);
    await waitFor(() => messages(output).some((item) => item.id === 603), 1000);
    const rejected = messages(output).find((item) => item.id === 603);
    assert.equal(rejected.error.code, -32002);
    assert.match(rejected.error.message, /registered (?:byte size|SHA-256 identity)/);
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  const deadlineMs = Math.max(timeoutMs, 1500);
  while (!predicate()) {
    // Full-suite execution starts many MCP subprocesses concurrently; keep the assertion strict without turning scheduler pressure into a product failure.
    if (Date.now() - startedAt >= deadlineMs) throw new Error("Timed out waiting for MCP newline response.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function messages(output) {
  const lastNewline = output.lastIndexOf("\n");
  if (lastNewline < 0) return [];
  return output.slice(0, lastNewline).split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
