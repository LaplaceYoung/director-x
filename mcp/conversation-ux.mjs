const STAGE_COPY = Object.freeze({
  intake: { label: "明确方向", active: "正在把你的想法整理成清晰的制作方向。" },
  research: { label: "收集资料", active: "正在收集品牌资料、视觉素材和参考案例。" },
  script: { label: "打磨脚本", active: "正在打磨脚本、旁白和整体节奏。" },
  storyboard: { label: "设计镜头", active: "正在设计镜头、画面衔接和声音配合。" },
  generation: { label: "生成素材", active: "正在制作这支片需要的画面、视频和声音。" },
  edit: { label: "剪辑合成", active: "正在把画面、配音、字幕和音乐剪成完整版本。" },
  review: { label: "检查成片", active: "首版已经形成，正在检查画面、声音和衔接。" },
  delivery: { label: "准备交付", active: "成片已经准备好，正在整理最终交付。" }
});

const STATUS_COPY = Object.freeze({
  awaiting_approval: "等待确认",
  production_in_progress: "制作中",
  active: "制作中",
  ready: "制作中",
  blocked: "等待你的选择",
  failed: "需要处理",
  complete: "已完成"
});

const INTERACTION_COPY = Object.freeze({
  goal_entry: "是否开始正式制作",
  run_mode: "制作方式",
  intake: "创作方向",
  budget: "制作预算",
  image_model: "图片生成方式",
  video_model: "视频生成方式",
  voice_model: "配音方式",
  music_strategy: "背景音乐策略",
  music_asset_selection: "具体配乐",
  music_route: "背景音乐方式",
  provider_input: "模型接入",
  reference_download: "参考素材使用方式",
  strategy_change: "方案调整",
  edit_change: "剪辑修改",
  post_production_edit: "是否继续精剪",
  delivery: "最终交付"
});

const EXACT_TOOL_TITLES = Object.freeze({
  directorx_capability_preflight: "准备制作空间",
  directorx_get_preflight_status: "确认侧边画布",
  directorx_create_run: "开始正式制作",
  directorx_get_run_snapshot: "同步制作进度",
  directorx_request_user_interaction: "准备向你确认",
  directorx_create_and_ask_native_question: "准备向你确认",
  directorx_begin_creative_work: "开始创作",
  directorx_get_fast_start_status: "检查创作启动条件",
  directorx_get_recovery_action: "定位恢复动作",
  directorx_resolve_user_interaction: "记录你的选择",
  directorx_prepare_goal_completion: "确认交付条件",
  directorx_open_canvas: "打开制作画布",
  directorx_open_inline_canvas: "打开制作画布",
  directorx_get_mosi_voice_setup: "准备配音选择",
  directorx_ingest_reference_video: "逐帧分析参考片",
  directorx_compile_reference_replication_plan: "生成参考片复刻蓝图",
  directorx_set_session_credential: "连接本次使用的模型",
  directorx_get_builtin_media_runtime: "检查内置媒体能力",
  directorx_install_builtin_media_runtime: "准备内置媒体能力",
  directorx_plan_production_complexity: "选择合适制作节奏",
  directorx_plan_production_team: "安排并行制作团队",
  directorx_query_cinematic_references: "寻找优秀影视范例",
  directorx_plan_parallel_subagents: "安排并行制作团队",
  directorx_register_prompt_bound_generation_plan: "锁定提示词并准备生成",
  directorx_compile_scene_coverage_plan: "设计场景与摄影覆盖",
  directorx_compile_transition_language_plan: "设计镜头转场",
  directorx_review_shot_sequence: "审查镜头节奏",
  directorx_compile_shot_grounding_plan: "规划逐镜头素材",
  directorx_finalize_shot_grounding: "确认镜头素材依据",
  directorx_transcribe_media_with_whisper: "生成字幕时间轴",
  directorx_register_render_quality_contract: "检查旁白字幕与转场",
  directorx_render_remotion_video: "合成最终视频",
  directorx_render_hyperframes_video: "合成最终视频",
  directorx_verify_final_media: "全面检查成片",
  directorx_record_final_review_evidence: "记录审片结果",
  directorx_start_opencut_editor: "打开精剪工具",
  directorx_get_opencut_editor_status: "同步精剪进度"
});

export const DIRECTORX_CONVERSATION_POLICY = Object.freeze({
  mode: "concise_consumer",
  startMessage: "我会先和你确认几个关键选择，然后持续制作到可播放成片。制作过程可以在侧边画布查看。",
  updateCadence: "milestone_or_blocker_only",
  maxSentencesPerUpdate: 2,
  hideByDefault: ["tool_names", "artifact_ids", "json_filenames", "runtime_terms", "filesystem_paths", "test_counts"],
  technicalDetailsOnRequest: true
});

export function buildUserFacingRunSummary(run) {
  const stage = STAGE_COPY[run.stage] ? run.stage : "intake";
  const stageCopy = STAGE_COPY[stage];
  const pending = (run.interactions?.pending ?? []).find((item) => item.status === "pending");
  const status = run.status === "complete" ? "complete" : pending ? "blocked" : run.status;
  const pipelineStages = run.pipeline?.stages ?? [];
  const completedStages = pipelineStages.filter((item) => run.pipeline?.stageStates?.[item.id]?.status === "complete").length;
  const artifacts = Object.values(run.artifacts ?? {});
  const visibleResults = {
    documents: artifacts.filter((item) => item.mediaKind === "document" && (item.metadata?.canvasEssential === true || /\.(md|txt)$/i.test(item.relativePath ?? ""))).length,
    images: artifacts.filter((item) => item.mediaKind === "image").length,
    videos: artifacts.filter((item) => item.mediaKind === "video").length,
    audio: artifacts.filter((item) => item.mediaKind === "audio").length
  };

  let headline = stageCopy.active;
  if (pending) headline = `需要你确认${INTERACTION_COPY[pending.kind] ?? "下一步选择"}，确认后会继续制作。`;
  else if (run.recoveryGate?.status === "blocked") headline = "当前环节已暂停，处理后会从最近进度继续。";
  else if (run.status === "complete") headline = "成片已经完成并通过检查，可以交付了。";
  else if (run.finalMediaReview?.status === "passed") headline = "成片检查已经通过，正在准备最终交付。";

  return {
    presentation: "concise_consumer",
    headline,
    stageLabel: stageCopy.label,
    statusLabel: STATUS_COPY[status] ?? "制作中",
    awaitingUser: Boolean(pending),
    pendingDecisionLabel: pending ? INTERACTION_COPY[pending.kind] ?? "下一步选择" : null,
    completedStages,
    totalStages: pipelineStages.length,
    visibleResults,
    suggestedUpdate: headline
  };
}

export function friendlyToolTitle(name) {
  if (EXACT_TOOL_TITLES[name]) return EXACT_TOOL_TITLES[name];
  if (/list_|get_.*(catalog|templates|roles|capabilities|providers|pipelines)/.test(name)) return "查看可用制作方案";
  if (/interaction|approval|decision|confirm/.test(name)) return "处理制作确认";
  if (/research|reference|asset|web_image/.test(name)) return "整理参考素材";
  if (/script|director_document|intent/.test(name)) return "完善创作方向";
  if (/storyboard|shot|camera|continuity|segment/.test(name)) return "整理镜头与衔接";
  if (/generation|provider_job|media_provider|image|voiceover|tts/.test(name)) return "制作画面与声音";
  if (/edit|timeline|caption|waveform|remotion|opencut/.test(name)) return "剪辑并完善成片";
  if (/review|audit|verify|quality|benchmark/.test(name)) return "检查制作质量";
  if (/delivery|publish|completion/.test(name)) return "准备最终交付";
  if (/subagent|execution_graph|route|tool_inventory/.test(name)) return "安排制作任务";
  if (/run|stage|checkpoint|resume|event|artifact/.test(name)) return "更新制作进度";
  return "推进视频制作";
}

export function conciseToolResult(name, result) {
  if (result?.userFacingSummary?.headline) return result.userFacingSummary.headline;
  if (result?.conversationExperience?.startMessage) return result.conversationExperience.startMessage;
  if (result?.interaction?.request || result?.nextHostInteraction?.request) return "需要你的选择，确认后会继续制作。";
  if (name.startsWith("directorx_list_")) return "可用的制作方案已经准备好。";
  if (name.startsWith("directorx_get_")) return "制作信息已经同步。";
  return "制作进度已更新。";
}
