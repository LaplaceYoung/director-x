const READ_ONLY_TOOLS = new Set([
  "directorx_list_pipelines",
  "directorx_list_subagent_roles",
  "directorx_get_subagent_naming_status",
  "directorx_list_video_capabilities",
  "directorx_list_benchmark_verifiers",
  "directorx_list_benchmark_fixture_templates",
  "directorx_get_benchmark_baselines",
  "directorx_get_fast_start_status",
  "directorx_get_production_status",
  "directorx_resume_production",
  "directorx_query_director_knowledge",
  "directorx_query_cinematic_references",
  "directorx_get_opencut_editor_status",
  "directorx_validate_research_package",
  "directorx_get_stage_requirements",
  "directorx_list_media_providers",
  "directorx_get_media_provider_setup",
  "directorx_get_custom_media_provider_intake",
  "directorx_get_custom_media_provider_setup",
  "directorx_get_mosi_voice_setup",
  "directorx_get_music_route_setup",
  "directorx_list_music_libraries",
  "directorx_list_model_pricing",
  "directorx_quote_model_cost",
  "directorx_get_waveform_window",
  "directorx_get_builtin_media_runtime",
  "directorx_open_inline_canvas"
]);

const OPEN_WORLD_TOOLS = new Set([
  "directorx_ingest_reference_video",
  "directorx_record_web_research",
  "directorx_record_provider_api_research",
  "directorx_acquire_web_image_asset",
  "directorx_submit_media_generation",
  "directorx_poll_media_generation",
  "directorx_generate_media",
  "directorx_generate_mosi_voiceover",
  "directorx_install_builtin_media_runtime"
]);

const DESTRUCTIVE_TOOLS = new Set([
  "directorx_revoke_model_knowledge_patch",
  "directorx_cancel_benchmark_schedule",
  "directorx_revoke_benchmark_baseline",
  "directorx_cancel_provider_job"
]);

const IDEMPOTENT_WRITE_TOOLS = new Set([
  "directorx_recover_production",
  "directorx_submit_provider_job",
  "directorx_submit_media_generation",
  "directorx_generate_media",
  "directorx_install_builtin_media_runtime"
]);

const EXPLICIT_POLICY_SETS = [READ_ONLY_TOOLS, OPEN_WORLD_TOOLS, DESTRUCTIVE_TOOLS, IDEMPOTENT_WRITE_TOOLS];

export function directorXToolSafetyAnnotations(toolName) {
  const readOnlyHint = READ_ONLY_TOOLS.has(toolName);
  return {
    readOnlyHint,
    destructiveHint: !readOnlyHint && DESTRUCTIVE_TOOLS.has(toolName),
    idempotentHint: readOnlyHint || IDEMPOTENT_WRITE_TOOLS.has(toolName),
    openWorldHint: OPEN_WORLD_TOOLS.has(toolName)
  };
}

export function assertDirectorXToolSafetyPolicy(definitions) {
  const names = definitions.map((definition) => definition?.name);
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicateNames.length > 0) throw new Error(`Duplicate Director X tool definitions: ${[...new Set(duplicateNames)].join(", ")}`);

  const knownNames = new Set(names);
  const stalePolicyNames = EXPLICIT_POLICY_SETS.flatMap((set) => [...set]).filter((name) => !knownNames.has(name));
  if (stalePolicyNames.length > 0) throw new Error(`Director X tool safety policy references missing tools: ${[...new Set(stalePolicyNames)].join(", ")}`);

  return definitions.map((definition) => ({
    ...definition,
    annotations: {
      ...(definition.annotations ?? {}),
      ...directorXToolSafetyAnnotations(definition.name)
    }
  }));
}
