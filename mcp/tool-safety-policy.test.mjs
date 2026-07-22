import test from "node:test";
import assert from "node:assert/strict";
import { assertDirectorXToolSafetyPolicy, directorXToolSafetyAnnotations } from "./tool-safety-policy.mjs";

test("defaults unclassified tools to the safest write contract", () => {
  assert.deepEqual(directorXToolSafetyAnnotations("directorx_future_tool"), {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  });
});

test("classifies reads, runtime mutation, network access, idempotency, and destructive actions", () => {
  assert.deepEqual(directorXToolSafetyAnnotations("directorx_list_pipelines"), {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  });
  assert.equal(directorXToolSafetyAnnotations("directorx_capability_preflight").readOnlyHint, false);
  assert.equal(directorXToolSafetyAnnotations("directorx_get_preflight_status").readOnlyHint, false);
  assert.equal(directorXToolSafetyAnnotations("directorx_open_canvas").readOnlyHint, false);
  assert.equal(directorXToolSafetyAnnotations("directorx_get_run_snapshot").readOnlyHint, false);

  const submission = directorXToolSafetyAnnotations("directorx_submit_media_generation");
  assert.equal(submission.openWorldHint, true);
  assert.equal(submission.idempotentHint, true);
  assert.equal(directorXToolSafetyAnnotations("directorx_poll_media_generation").openWorldHint, true);
  assert.equal(directorXToolSafetyAnnotations("directorx_generate_mosi_voiceover").openWorldHint, true);
  assert.equal(directorXToolSafetyAnnotations("directorx_install_builtin_media_runtime").openWorldHint, true);

  assert.equal(directorXToolSafetyAnnotations("directorx_cancel_provider_job").destructiveHint, true);
  assert.equal(directorXToolSafetyAnnotations("directorx_revoke_model_knowledge_patch").destructiveHint, true);
  assert.equal(directorXToolSafetyAnnotations("directorx_revoke_benchmark_baseline").destructiveHint, true);
});

test("normalizes incorrect inline hints and rejects stale policy entries", () => {
  const [normalized] = assertDirectorXToolSafetyPolicy([
    { name: "directorx_list_pipelines", annotations: { readOnlyHint: false, destructiveHint: true } },
    ...requiredPolicyDefinitions("directorx_list_pipelines")
  ]);
  assert.equal(normalized.annotations.readOnlyHint, true);
  assert.equal(normalized.annotations.destructiveHint, false);
  assert.throws(
    () => assertDirectorXToolSafetyPolicy([{ name: "directorx_future_tool" }]),
    /safety policy references missing tools/
  );
});

function requiredPolicyDefinitions(excludedName) {
  const names = [
    "directorx_list_subagent_roles", "directorx_get_subagent_naming_status", "directorx_list_video_capabilities",
    "directorx_list_benchmark_verifiers", "directorx_list_benchmark_fixture_templates", "directorx_get_benchmark_baselines",
    "directorx_get_fast_start_status", "directorx_query_director_knowledge",
    "directorx_query_cinematic_references", "directorx_get_opencut_editor_status", "directorx_validate_research_package",
    "directorx_get_stage_requirements", "directorx_list_media_providers", "directorx_get_media_provider_setup",
    "directorx_get_custom_media_provider_intake", "directorx_get_custom_media_provider_setup", "directorx_get_mosi_voice_setup",
    "directorx_get_music_route_setup", "directorx_list_music_libraries", "directorx_list_model_pricing",
    "directorx_quote_model_cost", "directorx_get_waveform_window", "directorx_get_builtin_media_runtime",
    "directorx_open_inline_canvas", "directorx_ingest_reference_video", "directorx_record_web_research",
    "directorx_record_provider_api_research", "directorx_acquire_web_image_asset", "directorx_submit_media_generation",
    "directorx_poll_media_generation", "directorx_generate_mosi_voiceover", "directorx_install_builtin_media_runtime",
    "directorx_revoke_model_knowledge_patch", "directorx_cancel_benchmark_schedule", "directorx_revoke_benchmark_baseline",
    "directorx_cancel_provider_job", "directorx_submit_provider_job", "directorx_recover_production"
  ];
  return names.filter((name) => name !== excludedName).map((name) => ({ name }));
}
