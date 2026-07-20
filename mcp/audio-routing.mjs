import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const MUSIC_ROUTES = new Set(["local_file", "rights_safe_library", "generated_music", "none", "video_native_fallback"]);

export function compileAudioResponsibilityPlan(run, input, now = new Date().toISOString()) {
  if (!input?.planId || !input.video?.providerId || !input.video?.modelId) throw new Error("Audio responsibility planning requires a plan ID and the selected video provider/model.");
  if (!MUSIC_ROUTES.has(input.music?.route)) throw new Error(`Unsupported music route: ${input.music?.route}`);
  const voiceEnabled = input.voice?.enabled === true;
  const voiceConfigured = voiceEnabled && input.voice?.configured === true;
  if (voiceEnabled && (!input.voice.providerId || !input.voice.modelId)) throw new Error("An enabled voice route requires an exact provider and model.");
  if (["local_file", "rights_safe_library"].includes(input.music.route) && !input.music.assetRef) throw new Error(`${input.music.route} music requires a selected local assetRef.`);
  if (["local_file", "rights_safe_library"].includes(input.music.route)) {
    const selected = (run.musicAssets ?? []).find((asset) => [asset.assetId, asset.artifactRef].includes(input.music.assetRef) && asset.status === "ready");
    if (!selected) throw new Error("A local or library music route requires a passing DX-Asset-Manager music quality and rights audit.");
  }
  if (input.music.route === "generated_music" && (!input.music.providerId || !input.music.modelId)) throw new Error("Generated music requires an exact provider and model.");

  const independentMusic = ["local_file", "rights_safe_library", "generated_music"].includes(input.music.route);
  const independentAudio = voiceEnabled || independentMusic;
  const nativeFallbackRequested = input.music.route === "video_native_fallback";
  if (nativeFallbackRequested && (voiceEnabled || independentMusic)) throw new Error("Video-native full audio is allowed only when no independent TTS or music route is active.");
  if (nativeFallbackRequested && input.video.nativeAudio !== true) throw new Error("The selected video model does not support native audio fallback.");
  if (nativeFallbackRequested && input.nativeFallbackApproved !== true) throw new Error("Video-native full audio fallback requires explicit user approval.");

  const nativeAudioEnabled = nativeFallbackRequested && !independentAudio;
  const plan = {
    schemaVersion: "1.0",
    planId: input.planId,
    video: {
      providerId: input.video.providerId,
      modelId: input.video.modelId,
      nativeAudioCapability: Boolean(input.video.nativeAudio),
      generateAudio: nativeAudioEnabled,
      responsibility: nativeAudioEnabled ? "full_soundtrack_fallback" : "visual_only",
      nativeAudioDisposition: nativeAudioEnabled ? "keep" : input.video.nativeAudio ? "disable_or_discard_on_ingest" : "not_available"
    },
    voice: voiceEnabled
      ? { owner: "tts", providerId: input.voice.providerId, modelId: input.voice.modelId, configured: voiceConfigured, status: voiceConfigured ? "ready" : "credential_required" }
      : { owner: nativeAudioEnabled ? "video_model" : "none", status: nativeAudioEnabled ? "fallback" : "not_used" },
    music: musicPlan(input.music, nativeAudioEnabled),
    ambienceAndSfx: { owner: nativeAudioEnabled ? "video_model" : "edit_sound_design", status: nativeAudioEnabled ? "fallback" : "planned_separately" },
    promptConstraints: [
      ...(voiceEnabled ? ["Do not generate speech, narration, dialogue, singing, lip-synced voice, or intelligible vocalizations."] : []),
      ...(independentMusic ? ["Do not generate background music, melody, score, song, or rhythmic music bed."] : []),
      ...(!nativeAudioEnabled ? ["Treat the video generation output as a visual source; its audio track will not be used in the final mix."] : [])
    ],
    finalMix: {
      requiredTracks: [
        ...(voiceEnabled ? ["voice"] : []),
        ...(independentMusic ? ["music"] : []),
        nativeAudioEnabled ? "video_native_full_audio" : "ambience_sfx"
      ],
      duckMusicUnderVoice: voiceEnabled && independentMusic,
      rejectUnplannedSpeech: voiceEnabled,
      rejectUnplannedMusic: independentMusic
    },
    confirmedBy: input.confirmedBy,
    createdAt: now
  };
  run.audioResponsibilityPlan = plan;
  return plan;
}

export async function writeAudioResponsibilityPlan({ projectPath, runId, plan }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const artifactRef = "audio_responsibility_plan.json";
  const path = resolve(directory, artifactRef);
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef, path };
}

export function applyAudioResponsibilityToMediaInput(run, mediaInput) {
  if (mediaInput.mediaType === "image") return mediaInput;
  const plan = run.audioResponsibilityPlan;
  if (!plan) throw new Error("Register audio_responsibility_plan.json before video generation.");
  if (plan.video.providerId !== mediaInput.providerId || plan.video.modelId !== mediaInput.modelId) throw new Error("The audio responsibility plan does not match the selected video provider/model.");
  const requested = mediaInput.generateAudio;
  if (requested != null && Boolean(requested) !== plan.video.generateAudio) throw new Error("Video native-audio settings conflict with the approved audio responsibility plan.");
  return {
    ...mediaInput,
    generateAudio: plan.video.generateAudio,
    negativePrompt: [mediaInput.negativePrompt, ...plan.promptConstraints].filter(Boolean).join(", "),
    providerOptions: {
      ...(mediaInput.providerOptions ?? {}),
      bgm: plan.video.generateAudio ? mediaInput.providerOptions?.bgm : false,
      audioResponsibilityPlanId: plan.planId,
      nativeAudioDisposition: plan.video.nativeAudioDisposition
    }
  };
}

export function musicRouteSetup() {
  return {
    schemaVersion: "1.0",
    selectionQuestion: {
      header: "背景音乐",
      id: "music_strategy",
      question: "这支片的背景音乐从哪里来？",
      options: [
        { label: "正版曲库检索 (Recommended)", description: "从可商用或明确授权曲库寻找音乐，下载后检查授权、音质和剪辑适配。" },
        { label: "使用本地音乐", description: "使用你已有的本地配乐文件，并检查可用权利与音频质量。" },
        { label: "暂不单独配乐", description: "不配置独立配乐；只有同时未配置配音且视频模型支持时，才可再确认原生整套声音。" }
      ]
    },
    fallbackQuestion: {
      header: "原生声音",
      id: "native_audio_fallback",
      question: "当前没有独立配音和配乐，是否让视频模型同时生成完整声音？",
      options: [
        { label: "允许原生声音 (Recommended)", description: "视频模型负责画面、对白、环境声与配乐，预算按带音频官方价格计算。" },
        { label: "保持静音", description: "只生成画面，后续再补声音。" }
      ]
    },
    searchContract: {
      owner: "DX-Asset-Manager",
      actions: ["search_official_library", "open_track_page", "capture_license", "download_local_copy", "audit_audio_quality", "register_rights_evidence"],
      requiredArtifactRefs: ["music_asset_plan.json", "music_rights_receipt.json", "music_quality_audit_<assetId>.json"],
      rule: "A search result URL is not a usable music asset until a local file, track-level license evidence, and a passing quality audit are registered."
    },
    assetSelectionKind: "music_asset_selection"
  };
}

function musicPlan(value, nativeAudioEnabled) {
  if (nativeAudioEnabled) return { owner: "video_model", route: "video_native_fallback", status: "fallback" };
  if (value.route === "local_file") return { owner: "local_asset", route: value.route, assetRef: value.assetRef, status: "selected" };
  if (value.route === "rights_safe_library") return { owner: "licensed_asset", route: value.route, assetRef: value.assetRef, libraryId: value.libraryId ?? null, status: "selected" };
  if (value.route === "generated_music") return { owner: "music_model", route: value.route, providerId: value.providerId, modelId: value.modelId, status: value.configured ? "ready" : "credential_required" };
  return { owner: "none", route: "none", status: "not_used" };
}
