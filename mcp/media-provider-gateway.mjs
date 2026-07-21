import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  customAuthHeaders,
  customProviderProfile,
  getCustomMediaProviderAdapter,
  listCustomMediaProviderAdapters,
  normalizeCustomMediaJob,
  prepareCustomMediaSubmit
} from "./custom-media-provider-adapter.mjs";

const MAX_JSON_BYTES = 100 * 1024 * 1024;
const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

export const MEDIA_PROVIDER_CATALOG = [
  provider("openai", "OpenAI Images / Sora", "direct", "https://api.openai.com/v1", "bearer", "OPENAI_API_KEY", ["DIRECTORX_IMAGE_API_KEY", "DIRECTORX_VIDEO_API_KEY"], "https://platform.openai.com/api-keys", "https://developers.openai.com/api/reference/resources/videos/methods/create", 10_000, [
    mediaModel("gpt-image-1.5", "GPT Image 1.5", "image", ["text_to_image"], true, { outputBase64: true, sizes: ["1024x1024", "1024x1536", "1536x1024"] }),
    mediaModel("gpt-image-1-mini", "GPT Image 1 mini", "image", ["text_to_image"], false, { economy: true }),
    mediaModel("sora-2", "Sora 2", "video", ["text_to_video", "image_to_video"], true, { durations: [4, 8, 12], nativeAudio: true }),
    mediaModel("sora-2-pro", "Sora 2 Pro", "video", ["text_to_video", "image_to_video"], false, { durations: [4, 8, 12], nativeAudio: true, quality: "pro" })
  ]),
  provider("google_gemini", "Google Gemini Image / Veo", "direct", "https://generativelanguage.googleapis.com/v1beta", "google_api_key", "GEMINI_API_KEY", ["GOOGLE_API_KEY", "DIRECTORX_IMAGE_API_KEY", "DIRECTORX_VIDEO_API_KEY"], "https://aistudio.google.com/app/apikey", "https://ai.google.dev/gemini-api/docs/veo", 10_000, [
    mediaModel("gemini-3.1-flash-image", "Gemini 3.1 Flash Image", "image", ["text_to_image", "image_to_image"], true, { maxReferenceImages: 14, maxResolution: "4K" }),
    mediaModel("gemini-3-pro-image", "Gemini 3 Pro Image", "image", ["text_to_image", "image_to_image"], false, { maxReferenceImages: 14, maxResolution: "4K" }),
    mediaModel("veo-3.1-generate-preview", "Veo 3.1", "video", ["text_to_video", "image_to_video", "keyframes_to_video", "reference_to_video", "video_extension"], true, { nativeAudio: true, maxReferenceImages: 3, durations: [4, 6, 8] }),
    mediaModel("veo-3.1-fast-generate-preview", "Veo 3.1 Fast", "video", ["text_to_video", "image_to_video", "keyframes_to_video", "reference_to_video", "video_extension"], false, { nativeAudio: true, durations: [4, 6, 8], economy: true })
  ]),
  provider("dashscope", "Alibaba Model Studio Wan", "direct", "https://dashscope.aliyuncs.com/api/v1", "bearer", "DASHSCOPE_API_KEY", ["QWEN_API_KEY", "DIRECTORX_IMAGE_API_KEY"], "https://dashscope.console.aliyun.com/apiKey", "https://help.aliyun.com/en/model-studio/text-to-image-v2-api-reference", 5_000, [
    mediaModel("wan2.6-t2i", "Wan 2.6 Text to Image", "image", ["text_to_image"], true, { asyncTask: true, regionSpecificEndpoint: true }),
    mediaModel("wan2.7-t2v", "Wan 2.7 Text to Video", "video", ["text_to_video"], true, { asyncTask: true, nativeAudio: true, durationSeconds: "2-15" }),
    mediaModel("wan2.7-i2v", "Wan 2.7 Image to Video", "video", ["image_to_video", "keyframes_to_video", "video_extension"], false, { asyncTask: true, firstLastFrame: true, videoExtension: true }),
    mediaModel("wan2.7-r2v", "Wan 2.7 Reference to Video", "video", ["reference_to_video"], false, { asyncTask: true, referenceMedia: true })
  ], true),
  provider("volcengine_ark", "Volcengine Ark Seedance", "direct", "https://ark.cn-beijing.volces.com/api/v3", "bearer", "ARK_API_KEY", ["VOLCENGINE_API_KEY", "DIRECTORX_VIDEO_API_KEY"], "https://console.volcengine.com/ark", "https://www.volcengine.com/docs/82379", 10_000, [
    mediaModel("doubao-seedance-2-0-260128", "Doubao Seedance 2.0", "video", ["text_to_video", "image_to_video", "reference_to_video"], true, { nativeAudio: true, accountEndpointId: true })
  ], true),
  provider("runway", "Runway", "direct", "https://api.dev.runwayml.com/v1", "bearer", "RUNWAYML_API_SECRET", ["RUNWAY_API_KEY", "DIRECTORX_IMAGE_API_KEY", "DIRECTORX_VIDEO_API_KEY"], "https://dev.runwayml.com/", "https://docs.dev.runwayml.com/guides/using-the-api/", 5_000, [
    mediaModel("gen4_image", "Runway Gen-4 Image", "image", ["text_to_image", "image_to_image"], true, { asyncTask: true }),
    mediaModel("gen4.5", "Runway Gen-4.5", "video", ["text_to_video", "image_to_video"], true, { asyncTask: true, durations: [5, 10] })
  ], true),
  provider("luma", "Luma Dream Machine", "direct", "https://api.lumalabs.ai/dream-machine/v1", "bearer", "LUMA_API_KEY", ["DIRECTORX_VIDEO_API_KEY"], "https://lumalabs.ai/dream-machine/api/keys", "https://docs.lumalabs.ai/docs/video-generation", 5_000, [
    mediaModel("ray-2", "Luma Ray 2", "video", ["text_to_video", "image_to_video", "keyframes_to_video", "video_extension"], true, { keyframes: true, resolutions: ["540p", "720p", "1080p", "4k"] }),
    mediaModel("ray-flash-2", "Luma Ray 2 Flash", "video", ["text_to_video", "image_to_video", "keyframes_to_video", "video_extension"], false, { keyframes: true, economy: true })
  ], true),
  provider("minimax", "MiniMax Hailuo", "direct", "https://api.minimaxi.com/v1", "bearer", "MINIMAX_API_KEY", ["HAILUO_API_KEY", "DIRECTORX_VIDEO_API_KEY"], "https://platform.minimaxi.com/user-center/basic-information/interface-key", "https://platform.minimaxi.com/docs/guides/video-generation", 10_000, [
    mediaModel("MiniMax-Hailuo-2.3", "MiniMax Hailuo 2.3", "video", ["text_to_video", "image_to_video"], true, { durations: [6, 10], resolutions: ["768P", "1080P"] }),
    mediaModel("MiniMax-Hailuo-2.3-Fast", "MiniMax Hailuo 2.3 Fast", "video", ["image_to_video"], false, { economy: true }),
    mediaModel("MiniMax-Hailuo-02", "MiniMax Hailuo 02", "video", ["text_to_video", "image_to_video", "keyframes_to_video"], false, { firstLastFrame: true })
  ], true),
  provider("vidu", "Vidu", "direct", "https://api.vidu.com", "token", "VIDU_API_KEY", ["DIRECTORX_VIDEO_API_KEY"], "https://platform.vidu.com/", "https://docs.platform.vidu.com/", 5_000, [
    mediaModel("viduq3-pro", "Vidu Q3 Pro", "video", ["text_to_video", "image_to_video", "keyframes_to_video"], true, { nativeAudio: true, maxDurationSeconds: 16 }),
    mediaModel("viduq3-turbo", "Vidu Q3 Turbo", "video", ["text_to_video", "image_to_video", "keyframes_to_video"], false, { nativeAudio: true, economy: true }),
    mediaModel("viduq2-pro", "Vidu Q2 Pro", "video", ["text_to_video", "image_to_video", "keyframes_to_video", "reference_to_video"], false, { referenceVideo: true })
  ], true),
  provider("fal", "fal Model Gateway", "gateway", "https://queue.fal.run", "fal_key", "FAL_KEY", ["DIRECTORX_IMAGE_API_KEY", "DIRECTORX_VIDEO_API_KEY"], "https://fal.ai/dashboard/keys", "https://fal.ai/docs/documentation/model-apis/inference/queue", 3_000, [
    mediaModel("fal-ai/flux/schnell", "FLUX Schnell on fal", "image", ["text_to_image"], true, { economy: true }),
    mediaModel("fal-ai/nano-banana-2", "Nano Banana 2 on fal", "image", ["text_to_image", "image_to_image"], false, {}),
    mediaModel("fal-ai/kling-video/o3/standard/text-to-video", "Kling O3 Standard on fal", "video", ["text_to_video"], true, { kling: true }),
    mediaModel("fal-ai/kling-video/v3/standard/image-to-video", "Kling V3 Standard on fal", "video", ["image_to_video", "keyframes_to_video"], false, { kling: true })
  ], true),
  provider("replicate", "Replicate Model Gateway", "gateway", "https://api.replicate.com/v1", "bearer", "REPLICATE_API_TOKEN", ["DIRECTORX_IMAGE_API_KEY", "DIRECTORX_VIDEO_API_KEY"], "https://replicate.com/account/api-tokens", "https://replicate.com/docs/topics/predictions/create-a-prediction", 3_000, [
    mediaModel("black-forest-labs/flux-schnell", "FLUX Schnell on Replicate", "image", ["text_to_image"], true, { economy: true }),
    mediaModel("bytedance/seedance-1-pro", "Seedance 1 Pro on Replicate", "video", ["text_to_video", "image_to_video"], true, {})
  ], true)
];

export function listMediaProviders({ mediaType, mode } = {}) {
  return [...MEDIA_PROVIDER_CATALOG, ...listCustomMediaProviderAdapters().map(customProviderProfile)].map(publicProvider)
    .map((entry) => ({ ...entry, models: entry.models.filter((model) => (!mediaType || model.mediaType === mediaType) && (!mode || model.modes.includes(mode))) }))
    .filter((entry) => entry.models.length > 0);
}

export function getMediaProvider(providerId) {
  const builtIn = MEDIA_PROVIDER_CATALOG.find((entry) => entry.providerId === providerId);
  if (builtIn) return builtIn;
  try { return customProviderProfile(getCustomMediaProviderAdapter(providerId)); }
  catch { throw new Error(`Unsupported media provider: ${providerId}`); }
}

export function mediaProviderSetup(providerId, modelId, mode, credentialConfigured = false) {
  const profile = getMediaProvider(providerId);
  const model = selectModel(profile, modelId, mode, false);
  const keySetup = providerKeySetup(profile, model, credentialConfigured);
  return {
    providerId,
    providerKind: profile.providerKind,
    displayName: profile.displayName,
    model: publicModel(model),
    credentialEnv: profile.credentialEnv,
    credentialAliases: [...profile.credentialAliases],
    credentialConfigured,
    setupUrl: profile.setupUrl,
    docsUrl: profile.docsUrl,
    pollingIntervalMs: profile.pollingIntervalMs,
    credentialPolicy: "session_only_not_persisted",
    keySetupRequired: keySetup.keySetupRequired,
    keySetupInteraction: keySetup.keySetupInteraction,
    keySetupAnswerActions: keySetup.keySetupAnswerActions,
    nextAction: credentialConfigured ? "confirm_budget_then_generate" : "ask_user_for_key_then_call_directorx_set_session_credential"
  };
}

export function resolveMediaCredential(providerId, sessionCredentials, environment = process.env) {
  const profile = getMediaProvider(providerId);
  const session = sessionCredentials?.get(providerId);
  // Generic DIRECTORX_* aliases are intentionally considered only when the
  // user bound that exact variable to this provider in the current session.
  const providerAliases = profile.credentialAliases.filter((name) => !name.startsWith("DIRECTORX_"));
  const names = [...new Set([session?.envName, profile.credentialEnv, ...providerAliases].filter(Boolean))];
  for (const envName of names) {
    const value = environment[envName];
    if (typeof value === "string" && value.trim()) return { value, envName, credentialRef: `session-env:${envName}` };
  }
  throw new Error(`No current-session credential is configured for ${providerId}. Ask the user for the key, then inject ${profile.credentialEnv} with directorx_set_session_credential; it will not be persisted.`);
}

export function prepareMediaSubmit(input) {
  if (!input.prompt?.trim()) throw new Error("A non-empty media generation prompt is required.");
  const profile = getMediaProvider(input.providerId);
  const selected = selectModel(profile, input.modelId, input.mode, input.allowUnlistedModel === true);
  if (profile.customAdapter) return prepareCustomMediaSubmit(profile.customAdapter, { ...input, modelId: selected.modelId });
  let url;
  let body;
  let bodyType = "json";
  let multipartFields;
  const extraHeaders = {};

  if (profile.providerId === "openai") {
    if (selected.mediaType === "image") {
      url = `${profile.baseUrl}/images/generations`;
      body = compact({ model: selected.modelId, prompt: input.prompt, size: openAiImageSize(input), quality: input.providerOptions?.quality ?? "high", output_format: input.providerOptions?.output_format ?? "png", n: input.outputCount ?? 1 });
    } else {
      url = `${profile.baseUrl}/videos`; bodyType = "multipart";
      multipartFields = compactStrings({ model: selected.modelId, prompt: input.prompt, seconds: String(input.durationSeconds ?? 4), size: input.size ?? videoSize(input.aspectRatio), input_reference: input.imageUrls?.[0] ? JSON.stringify({ image_url: input.imageUrls[0] }) : undefined });
    }
  } else if (profile.providerId === "google_gemini") {
    if (selected.mediaType === "image") {
      url = `${profile.baseUrl}/interactions`;
      const imageInput = (input.imageUrls ?? []).map(geminiInteractionImage);
      body = { model: selected.modelId, input: imageInput.length ? [{ type: "text", text: input.prompt }, ...imageInput] : input.prompt, response_format: compact({ type: "image", mime_type: input.providerOptions?.mime_type ?? "image/png", aspect_ratio: input.aspectRatio, image_size: input.resolution ?? input.size }) };
    } else {
      url = `${profile.baseUrl}/models/${encodeURIComponent(selected.modelId)}:predictLongRunning`;
      const instance = compact({ prompt: input.prompt, image: input.imageUrls?.[0] ? geminiInlineMedia(input.imageUrls[0], "image") : undefined, lastFrame: input.endImageUrl ? geminiInlineMedia(input.endImageUrl, "image") : undefined, video: input.videoUrl ? geminiInlineMedia(input.videoUrl, "video") : undefined });
      if (input.mode === "reference_to_video") instance.referenceImages = (input.imageUrls ?? []).map((url) => ({ image: geminiInlineMedia(url, "image"), referenceType: "asset" }));
      body = { instances: [instance], parameters: compact({ aspectRatio: input.aspectRatio, durationSeconds: input.durationSeconds, resolution: input.resolution, negativePrompt: input.negativePrompt, generateAudio: input.generateAudio }) };
    }
  } else if (profile.providerId === "dashscope") {
    extraHeaders["X-DashScope-Async"] = "enable";
    if (selected.mediaType === "image") {
      url = `${profile.baseUrl}/services/aigc/image-generation/generation`;
      body = { model: selected.modelId, input: { messages: [{ role: "user", content: [{ text: input.prompt }] }] }, parameters: compact({ prompt_extend: input.providerOptions?.prompt_extend ?? true, watermark: input.providerOptions?.watermark ?? false, n: input.outputCount ?? 1, negative_prompt: input.negativePrompt ?? "", size: input.size ?? imageSize(input.aspectRatio) }) };
    } else {
      url = `${profile.baseUrl}/services/aigc/video-generation/video-synthesis`;
      body = { model: selected.modelId, input: dashscopeVideoInput(input), parameters: compact({ resolution: input.resolution ?? "1080P", ratio: input.aspectRatio, duration: input.durationSeconds ?? 5, prompt_extend: input.providerOptions?.prompt_extend ?? true, watermark: input.providerOptions?.watermark ?? false, audio: input.generateAudio }) };
    }
  } else if (profile.providerId === "volcengine_ark") {
    url = `${profile.baseUrl}/contents/generations/tasks`;
    body = { model: selected.modelId, content: arkContent(input), generate_audio: input.generateAudio === true, ratio: input.aspectRatio ?? "16:9", duration: input.durationSeconds ?? 5, watermark: input.providerOptions?.watermark ?? false };
  } else if (profile.providerId === "runway") {
    extraHeaders["X-Runway-Version"] = "2024-11-06";
    url = selected.mediaType === "image" ? `${profile.baseUrl}/text_to_image` : `${profile.baseUrl}/image_to_video`;
    body = selected.mediaType === "image"
      ? compact({ model: selected.modelId, promptText: input.prompt, ratio: runwayRatio(input.aspectRatio, true), referenceImages: input.imageUrls?.map((uri) => ({ uri })) })
      : compact({ model: selected.modelId, promptText: input.prompt, promptImage: input.imageUrls?.[0], ratio: runwayRatio(input.aspectRatio, false), duration: input.durationSeconds ?? 5 });
  } else if (profile.providerId === "luma") {
    url = `${profile.baseUrl}/generations`;
    body = compact({ prompt: input.prompt, model: selected.modelId, resolution: input.resolution, duration: input.durationSeconds ? `${input.durationSeconds}s` : undefined, aspect_ratio: input.aspectRatio, loop: input.providerOptions?.loop, keyframes: lumaKeyframes(input) });
  } else if (profile.providerId === "minimax") {
    url = `${profile.baseUrl}/video_generation`;
    body = compact({ prompt: input.prompt, model: selected.modelId, duration: input.durationSeconds ?? 6, resolution: input.resolution ?? "1080P", first_frame_image: input.imageUrls?.[0], last_frame_image: input.endImageUrl, prompt_optimizer: input.providerOptions?.prompt_optimizer });
  } else if (profile.providerId === "vidu") {
    url = `${profile.baseUrl}${viduPath(input.mode)}`;
    body = compact({ model: selected.modelId, prompt: input.prompt, images: viduImages(input), duration: input.durationSeconds ?? 5, aspect_ratio: input.aspectRatio, resolution: input.resolution ?? "720p", audio: input.generateAudio, bgm: input.providerOptions?.bgm, seed: input.providerOptions?.seed, movement_amplitude: input.providerOptions?.movement_amplitude });
  } else if (profile.providerId === "fal") {
    assertSafeModelPath(selected.modelId); url = `${profile.baseUrl}/${selected.modelId}`; body = falInput(input);
  } else if (profile.providerId === "replicate") {
    assertSafeModelPath(selected.modelId); url = `${profile.baseUrl}/models/${selected.modelId}/predictions`; body = { input: replicateInput(input) };
  }

  return { providerId: profile.providerId, modelId: selected.modelId, mediaType: selected.mediaType, mode: input.mode, method: "POST", url, bodyType, body, multipartFields, extraHeaders };
}

export async function submitMediaGeneration(input, { credential, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const prepared = prepareMediaSubmit(input);
  const raw = await executeProviderRequest(prepared, credential, fetchImpl, timeoutMs, input.idempotencyKey);
  if (raw.binary) throw new Error(`${input.providerId} unexpectedly returned binary media from the submit endpoint.`);
  const profile = getMediaProvider(input.providerId);
  return profile.customAdapter
    ? normalizeCustomMediaJob(profile.customAdapter, raw.json, `sync-${input.attemptId ?? Date.now()}`)
    : normalizeMediaJob(input.providerId, raw.json, `sync-${input.attemptId ?? Date.now()}`);
}

export async function pollMediaGeneration(storedJob, { credential, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (TERMINAL.has(storedJob.status)) return storedJob;
  const profile = getMediaProvider(storedJob.providerId);
  const prepared = { providerId: profile.providerId, method: "GET", url: storedJob.providerState?.pollUrl ?? defaultPollUrl(profile, storedJob.providerJobId), bodyType: "none", extraHeaders: profile.providerId === "runway" ? { "X-Runway-Version": "2024-11-06" } : {} };
  const raw = await executeProviderRequest(prepared, credential, fetchImpl, timeoutMs);
  if (raw.binary) throw new Error(`${storedJob.providerId} unexpectedly returned binary media from the polling endpoint.`);
  return profile.customAdapter
    ? normalizeCustomMediaJob(profile.customAdapter, raw.json, storedJob.providerJobId, storedJob.providerState)
    : normalizeMediaJob(storedJob.providerId, raw.json, storedJob.providerJobId, storedJob.providerState);
}

export async function resolveGeneratedMedia(job, { credential, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (job.status !== "succeeded") throw new Error(`Provider job ${job.providerJobId} is not complete.`);
  if (job.inlineAssets?.length) return decodeInlineAsset(job.inlineAssets[0]);

  const profile = getMediaProvider(job.providerId);
  let resultUrls = [...(job.resultUrls ?? [])];
  let resultRequest;
  if (!resultUrls.length && job.providerId === "minimax" && job.providerState?.fileId) resultRequest = { providerId: job.providerId, method: "GET", url: `${profile.baseUrl}/files/retrieve?file_id=${encodeURIComponent(job.providerState.fileId)}`, bodyType: "none", extraHeaders: {} };
  else if (!resultUrls.length && job.providerId === "openai") resultRequest = { providerId: job.providerId, method: "GET", url: job.providerState?.contentUrl ?? `${profile.baseUrl}/videos/${encodeURIComponent(job.providerJobId)}/content`, bodyType: "none", extraHeaders: {} };
  else if (!resultUrls.length && job.providerState?.resultUrl) resultRequest = { providerId: job.providerId, method: "GET", url: job.providerState.resultUrl, bodyType: "none", extraHeaders: {} };

  if (resultRequest) {
    const resolved = await executeProviderRequest(resultRequest, credential, fetchImpl, timeoutMs);
    if (resolved.binary) return resolved.binary;
    const normalized = normalizeMediaJob(job.providerId, resolved.json, job.providerJobId, job.providerState);
    if (normalized.inlineAssets.length) return decodeInlineAsset(normalized.inlineAssets[0]);
    resultUrls = normalized.resultUrls;
  }
  if (!resultUrls.length) throw new Error(`Provider job ${job.providerJobId} completed without a downloadable media result.`);
  const resultRequiresAuth = job.providerId === "google_gemini" || profile.customAdapter?.response.resultRequiresAuth === true;
  return await fetchRemoteMedia(resultUrls[0], resultRequiresAuth ? authHeaders(profile, credential) : {}, fetchImpl, timeoutMs);
}

export async function writeGeneratedMedia({ projectPath, runId, candidateId, mediaType, asset }) {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(candidateId)) throw new Error("candidateId contains unsafe path characters.");
  const extension = extensionFor(asset.mimeType, asset.sourceUrl, mediaType);
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "media", "generation");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${candidateId}.${extension}`);
  await writeFile(path, asset.data, { mode: 0o600 });
  return { path, byteLength: asset.data.byteLength, mimeType: asset.mimeType, sourceUrl: asset.sourceUrl ?? null };
}

export function durableMediaJob(job) {
  return {
    providerId: job.providerId,
    providerJobId: job.providerJobId,
    status: job.status,
    progress: job.progress,
    resultUrls: job.resultUrls ?? [],
    inlineAssetCount: job.inlineAssets?.length ?? 0,
    error: job.error ?? null,
    providerState: job.providerState ?? {}
  };
}

export function normalizeMediaJob(providerId, raw, fallbackJobId = "sync-result", inheritedState = {}) {
  const record = asRecord(raw);
  const resultUrls = collectResultUrls(raw);
  const inlineAssets = collectInlineAssets(raw);
  const providerJobId = providerJobIdFor(providerId, record) ?? fallbackJobId;
  const providerState = providerStateFor(providerId, record, providerJobId, inheritedState);
  let error = providerError(record);
  let status = error ? "failed" : normalizeStatus(providerId, record);
  if ((status === "running" || status === "queued") && (resultUrls.length || inlineAssets.length)) status = "succeeded";
  if (status === "failed" && !error) error = { code: "provider_failed", message: stringValue(record.error_message) ?? stringValue(record.message) ?? "Provider generation failed." };
  return { providerId, providerJobId, status, progress: progressFor(record, status), resultUrls, inlineAssets, error: error ?? null, providerState };
}

async function executeProviderRequest(prepared, credential, fetchImpl, timeoutMs, idempotencyKey) {
  if (typeof credential !== "string" || !credential.trim()) throw new Error(`Missing current-session credential for ${prepared.providerId}.`);
  assertAllowedProviderUrl(prepared.providerId, prepared.url);
  const profile = getMediaProvider(prepared.providerId);
  const headers = { ...authHeaders(profile, credential), ...prepared.extraHeaders };
  if (idempotencyKey && prepared.providerId === "openai") headers["Idempotency-Key"] = idempotencyKey;
  let body;
  if (prepared.bodyType === "json") body = JSON.stringify(prepared.body ?? {});
  if (prepared.bodyType === "multipart") {
    body = new FormData();
    for (const [key, value] of Object.entries(prepared.multipartFields ?? {})) body.append(key, value);
    delete headers["content-type"];
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(prepared.url, { method: prepared.method, headers, body, signal: controller.signal, redirect: "follow" });
  } catch (error) {
    throw new Error(`${prepared.providerId} request failed: ${error?.name === "AbortError" ? "timeout" : error?.message ?? "network error"}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 4_000).replace(/\s+/g, " ");
    throw new Error(`${prepared.providerId} API ${response.status}: ${detail || response.statusText}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json") || contentType.startsWith("text/")) {
    const text = await readBoundedText(response, MAX_JSON_BYTES);
    try { return { json: JSON.parse(text) }; } catch { throw new Error(`${prepared.providerId} returned invalid JSON.`); }
  }
  return { binary: await readBoundedBinary(response, MAX_MEDIA_BYTES, prepared.url) };
}

async function fetchRemoteMedia(url, headers, fetchImpl, timeoutMs) {
  assertSafeResultUrl(url);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`Media download failed with HTTP ${response.status}.`);
    return await readBoundedBinary(response, MAX_MEDIA_BYTES, url);
  } finally { clearTimeout(timer); }
}

async function readBoundedText(response, limit) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > limit) throw new Error(`Provider JSON response exceeds ${limit} bytes.`);
  const text = await response.text();
  if (Buffer.byteLength(text) > limit) throw new Error(`Provider JSON response exceeds ${limit} bytes.`);
  return text;
}

async function readBoundedBinary(response, limit, sourceUrl) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > limit) throw new Error(`Generated media exceeds ${limit} bytes.`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > limit) throw new Error(`Generated media exceeds ${limit} bytes.`);
  return { data, mimeType: (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0], sourceUrl };
}

function provider(providerId, displayName, providerKind, baseUrl, authScheme, credentialEnv, credentialAliases, setupUrl, docsUrl, pollingIntervalMs, models, supportsCustomModels = false) {
  return { providerId, displayName, providerKind, baseUrl, authScheme, credentialEnv, credentialAliases, setupUrl, docsUrl, pollingIntervalMs, models, supportsCustomModels };
}
function mediaModel(modelId, displayName, mediaType, modes, isDefault, supports) { return { modelId, displayName, mediaType, modes, isDefault, supports }; }
function publicModel(model) { return { ...model, modes: [...model.modes], supports: { ...model.supports } }; }
function publicProvider(profile) { return { providerId: profile.providerId, displayName: profile.displayName, providerKind: profile.providerKind, credentialEnv: profile.credentialEnv, credentialAliases: [...profile.credentialAliases], setupUrl: profile.setupUrl, docsUrl: profile.docsUrl, pollingIntervalMs: profile.pollingIntervalMs, supportsCustomModels: profile.supportsCustomModels, models: profile.models.map(publicModel) }; }

function providerKeySetup(profile, model, credentialConfigured) {
  const keyId = `${profile.providerId.replace(/[^a-z0-9]/gi, "_")}_key_setup`;
  const focusCredentialPanel = { type: "focus_canvas_credential", providerId: profile.providerId, envName: profile.credentialEnv, persistence: "handoff", secretPolicy: "session_only_not_persisted" };
  return {
    keySetupRequired: !credentialConfigured,
    keySetupInteraction: {
      kind: "provider_input",
      gateKey: `${profile.providerId}-key-setup`,
      reason: `${profile.displayName}/${model.displayName} 已确认，但当前 Director X MCP 会话尚未配置 ${profile.credentialEnv}。`,
      questions: [{
        header: "API Key",
        id: keyId,
        question: `是否为 ${profile.displayName}/${model.displayName} 配置 API Key？`,
        options: [
          { label: "我已有 Key (Recommended)", description: "在 Director X 画布安全密码框输入；Key 只注入当前 MCP 会话且不会保存。" },
          { label: "前往供应商控制台", description: "在侧边 Browser 新标签打开官方控制台，创建 Key 后回到画布安全注入。" },
          { label: "暂不配置", description: "保留模型选择，暂停依赖该 Provider 的生成阶段。" }
        ]
      }]
    },
    keySetupAnswerActions: {
      "我已有 Key (Recommended)": [focusCredentialPanel],
      "前往供应商控制台": [{ type: "open_url", url: profile.setupUrl, browser: "iab", target: "new_tab", visibility: true, persistence: "handoff", keepProductionCanvas: true }, { ...focusCredentialPanel, after: "api_key_created" }],
      "暂不配置": [{ type: "block_dependent_stage", capability: model.mediaType, reason: `${profile.credentialEnv} is not configured.` }]
    }
  };
}

function selectModel(profile, modelId, mode, allowUnlisted) {
  const selected = modelId ? profile.models.find((item) => item.modelId === modelId) : profile.models.find((item) => item.isDefault && item.modes.includes(mode)) ?? profile.models.find((item) => item.modes.includes(mode));
  if (selected) { if (!selected.modes.includes(mode)) throw new Error(`${profile.providerId}/${selected.modelId} does not support ${mode}.`); return selected; }
  if (!modelId) throw new Error(`${profile.providerId} has no default model for ${mode}.`);
  if (!profile.supportsCustomModels || !allowUnlisted) throw new Error(`Model ${modelId} is not in the verified ${profile.providerId} catalog.`);
  return { modelId, displayName: modelId, mediaType: mode.includes("image") && !mode.includes("video") ? "image" : "video", modes: [mode], isDefault: false, supports: { accountSpecific: true } };
}

function authHeaders(profile, credential) {
  if (profile.customAdapter) return customAuthHeaders(profile.customAdapter, credential);
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (profile.authScheme === "google_api_key") headers["x-goog-api-key"] = credential;
  else if (profile.authScheme === "token") headers.authorization = `Token ${credential}`;
  else if (profile.authScheme === "fal_key") headers.authorization = `Key ${credential}`;
  else headers.authorization = `Bearer ${credential}`;
  return headers;
}

function openAiImageSize(input) { if (input.size) return input.size; if (["9:16", "2:3", "3:4"].includes(input.aspectRatio)) return "1024x1536"; if (["16:9", "3:2", "4:3"].includes(input.aspectRatio)) return "1536x1024"; return "1024x1024"; }
function videoSize(ratio) { return ratio === "16:9" ? "1280x720" : "720x1280"; }
function imageSize(ratio) { return ratio === "9:16" ? "720*1280" : ratio === "16:9" ? "1280*720" : "1280*1280"; }
function runwayRatio(ratio, image) { if (image) return ratio === "9:16" ? "768:1360" : ratio === "1:1" ? "1024:1024" : "1360:768"; return ratio === "9:16" ? "720:1280" : ratio === "1:1" ? "960:960" : "1280:720"; }

function geminiInteractionImage(url) { const data = parseDataUri(url); return data ? { type: "image", mime_type: data.mimeType, data: data.base64 } : { type: "image", uri: url, mime_type: mimeFromUrl(url, "image/png") }; }
function geminiInlineMedia(url, kind) { const data = parseDataUri(url); if (!data) throw new Error(`Gemini Veo direct ${kind} input must be a data URI.`); return { inlineData: { mimeType: data.mimeType, data: data.base64 } }; }
function arkContent(input) { const content = [{ type: "text", text: input.prompt }]; for (const url of input.imageUrls ?? []) content.push({ type: "image_url", image_url: { url }, role: "reference_image" }); if (input.videoUrl) content.push({ type: "video_url", video_url: { url: input.videoUrl }, role: "reference_video" }); return content; }
function lumaKeyframes(input) { const value = compact({ frame0: input.imageUrls?.[0] ? { type: "image", url: input.imageUrls[0] } : input.videoUrl ? { type: "generation", id: input.videoUrl } : undefined, frame1: input.endImageUrl ? { type: "image", url: input.endImageUrl } : undefined }); return Object.keys(value).length ? value : undefined; }
function viduPath(mode) { if (mode === "image_to_video") return "/ent/v2/img2video"; if (mode === "keyframes_to_video") return "/ent/v2/start-end2video"; if (mode === "reference_to_video") return "/ent/v2/reference2video"; return "/ent/v2/text2video"; }
function viduImages(input) { return input.mode === "keyframes_to_video" ? [input.imageUrls?.[0], input.endImageUrl].filter(Boolean) : input.imageUrls?.length ? input.imageUrls : undefined; }
function falInput(input) { return compact({ prompt: input.prompt, negative_prompt: input.negativePrompt, image_url: input.imageUrls?.[0], start_image_url: input.imageUrls?.[0], end_image_url: input.endImageUrl, image_urls: input.mode === "reference_to_video" ? input.imageUrls : undefined, aspect_ratio: input.aspectRatio, duration: input.durationSeconds ? String(input.durationSeconds) : undefined, resolution: input.resolution, num_images: input.outputCount }); }
function replicateInput(input) { return compact({ prompt: input.prompt, negative_prompt: input.negativePrompt, image: input.imageUrls?.[0], last_frame_image: input.endImageUrl, aspect_ratio: input.aspectRatio, duration: input.durationSeconds, resolution: input.resolution, num_outputs: input.outputCount }); }
function dashscopeVideoInput(input) { const media = []; if (input.mode === "image_to_video" && input.imageUrls?.[0]) media.push({ type: "first_frame", url: input.imageUrls[0] }); if (input.mode === "keyframes_to_video") { if (input.imageUrls?.[0]) media.push({ type: "first_frame", url: input.imageUrls[0] }); if (input.endImageUrl) media.push({ type: "last_frame", url: input.endImageUrl }); } if (input.mode === "reference_to_video") { for (const url of input.imageUrls ?? []) media.push({ type: "reference_image", url }); if (input.videoUrl) media.push({ type: "reference_video", url: input.videoUrl }); } if (input.mode === "video_extension") { if (input.videoUrl) media.push({ type: "first_clip", url: input.videoUrl }); if (input.endImageUrl) media.push({ type: "last_frame", url: input.endImageUrl }); } return compact({ prompt: input.prompt, negative_prompt: input.negativePrompt, media: media.length ? media : undefined }); }

function providerJobIdFor(providerId, record) { if (providerId === "google_gemini") return stringValue(record.name); if (providerId === "dashscope") return stringValue(asRecord(record.output).task_id); if (providerId === "fal") return stringValue(record.request_id); if (["vidu", "minimax"].includes(providerId)) return stringValue(record.task_id) ?? stringValue(record.id); return stringValue(record.id) ?? stringValue(record.task_id) ?? stringValue(record.job_id); }
function normalizeStatus(providerId, record) { if (providerId === "google_gemini") return record.error ? "failed" : record.done === true ? "succeeded" : record.output_image || record.steps ? "succeeded" : "running"; if (providerId === "dashscope") return mapStatus(stringValue(asRecord(record.output).task_status) ?? stringValue(asRecord(record.output).status)); return mapStatus(stringValue(record.status) ?? stringValue(record.state)); }
function mapStatus(value) { const status = (value ?? "running").toLowerCase().replace(/[\s-]+/g, "_"); if (["succeeded", "success", "successful", "completed", "done", "ready", "task_succeeded"].includes(status)) return "succeeded"; if (["failed", "fail", "error", "task_failed"].includes(status)) return "failed"; if (["cancelled", "canceled", "task_canceled"].includes(status)) return "cancelled"; if (["input_required", "requires_input"].includes(status)) return "input_required"; if (["queued", "pending", "created", "submitted", "preparing", "queueing", "in_queue", "starting", "task_pending"].includes(status)) return "queued"; return "running"; }
function progressFor(record, status) { const value = typeof record.progress === "number" ? record.progress : undefined; if (value !== undefined) return Math.max(0, Math.min(1, value > 1 ? value / 100 : value)); if (status === "succeeded") return 1; if (status === "queued") return 0.05; if (status === "running") return 0.5; return 0; }

function providerStateFor(providerId, record, jobId, inheritedState) {
  const urls = asRecord(record.urls); const output = asRecord(record.output); const profile = getMediaProvider(providerId);
  const state = compact({
    ...inheritedState,
    pollUrl: stringValue(record.status_url) ?? stringValue(urls.get) ?? inheritedState.pollUrl,
    resultUrl: stringValue(record.response_url) ?? inheritedState.resultUrl,
    cancelUrl: stringValue(record.cancel_url) ?? stringValue(urls.cancel) ?? inheritedState.cancelUrl,
    fileId: stringValue(record.file_id) ?? stringValue(output.file_id) ?? inheritedState.fileId,
    contentUrl: providerId === "openai" && jobId !== "sync-result" ? `${profile.baseUrl}/videos/${encodeURIComponent(jobId)}/content` : inheritedState.contentUrl
  });
  if (providerId === "fal" && (!state.pollUrl || !state.resultUrl)) throw new Error("fal submit response did not include status_url and response_url.");
  return state;
}

function defaultPollUrl(profile, jobId) { const id = encodeURIComponent(jobId); if (profile.customAdapter?.api.pollPath) return `${profile.baseUrl.replace(/\/+$/, "")}/${profile.customAdapter.api.pollPath.replace("{jobId}", id).replace(/^\/+/, "")}`; if (profile.providerId === "google_gemini") return `${profile.baseUrl}/${jobId.replace(/^\/+/, "")}`; if (profile.providerId === "dashscope") return `${profile.baseUrl}/tasks/${id}`; if (profile.providerId === "volcengine_ark") return `${profile.baseUrl}/contents/generations/tasks/${id}`; if (profile.providerId === "runway") return `${profile.baseUrl}/tasks/${id}`; if (profile.providerId === "luma") return `${profile.baseUrl}/generations/${id}`; if (profile.providerId === "minimax") return `${profile.baseUrl}/query/video_generation?task_id=${id}`; if (profile.providerId === "vidu") return `${profile.baseUrl}/ent/v2/tasks/${id}/creations`; if (profile.providerId === "replicate") return `${profile.baseUrl}/predictions/${id}`; if (profile.providerId === "openai") return `${profile.baseUrl}/videos/${id}`; throw new Error(`${profile.providerId} did not return a poll URL.`); }

function collectResultUrls(value) { const urls = new Set(); visit(value, [], (candidate, path) => { if (typeof candidate !== "string" || !/^https?:\/\//i.test(candidate)) return; const key = path.at(-1) ?? ""; const context = path.some((part) => ["output", "outputs", "result", "results", "artifacts", "assets", "image", "images", "video", "videos", "generated_videos", "generatedSamples", "creations", "file", "content"].includes(part)); if (["download_url", "video_url", "image_url", "uri", "image"].includes(key) || (key === "url" && context) || (path.at(-2) === "output" && /^\d+$/.test(key))) urls.add(candidate); }); return [...urls].filter((url) => !/\/(status|cancel)(\?|$)/.test(url)); }
function collectInlineAssets(value) { const assets = []; visit(value, [], (candidate) => { const record = asRecord(candidate); const mimeType = stringValue(record.mime_type) ?? stringValue(record.mimeType); const base64 = stringValue(record.b64_json) ?? ((record.type === "image" || mimeType?.startsWith("image/") || candidate === asRecord(value).output_image) ? stringValue(record.data) : undefined); if (base64 && /^[A-Za-z0-9+/=\s]+$/.test(base64)) assets.push({ mediaType: "image", mimeType: mimeType ?? "image/png", base64Data: base64.replace(/\s/g, "") }); }); return assets.filter((asset, index) => assets.findIndex((item) => item.base64Data === asset.base64Data) === index); }
function visit(value, path, inspect, depth = 0) { if (depth > 9) return; inspect(value, path); if (Array.isArray(value)) value.forEach((item, index) => visit(item, [...path, String(index)], inspect, depth + 1)); else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => visit(item, [...path, key], inspect, depth + 1)); }
function providerError(record) { const error = asRecord(record.error); if (Object.keys(error).length) return { code: stringValue(error.code) ?? stringValue(error.type) ?? "provider_error", message: stringValue(error.message) ?? JSON.stringify(error).slice(0, 500) }; const base = asRecord(record.base_resp); if (typeof base.status_code === "number" && base.status_code !== 0) return { code: String(base.status_code), message: stringValue(base.status_msg) ?? "Provider request failed." }; if (stringValue(record.code) && !["200", "OK"].includes(stringValue(record.code))) return { code: stringValue(record.code), message: stringValue(record.message) ?? "Provider request failed." }; return undefined; }

function decodeInlineAsset(asset) { const data = Buffer.from(asset.base64Data, "base64"); if (data.byteLength > MAX_MEDIA_BYTES) throw new Error("Generated inline media exceeds the safety limit."); return { data, mimeType: asset.mimeType }; }
function extensionFor(mimeType, sourceUrl, mediaType) { const byMime = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" }; if (byMime[mimeType]) return byMime[mimeType]; const candidate = sourceUrl ? extname(new URL(sourceUrl).pathname).slice(1).toLowerCase() : ""; if (/^(png|jpe?g|webp|mp4|webm|mov)$/.test(candidate)) return candidate === "jpeg" ? "jpg" : candidate; return mediaType === "image" ? "png" : "mp4"; }
function assertAllowedProviderUrl(providerId, value) { const profile = getMediaProvider(providerId); const url = new URL(value); const base = new URL(profile.baseUrl); if (url.protocol !== "https:" || url.hostname !== base.hostname) throw new Error(`Provider request URL is outside the trusted ${providerId} API origin.`); }
function assertSafeResultUrl(value) { const url = new URL(value); if (url.protocol !== "https:") throw new Error("Generated media downloads require HTTPS."); const host = url.hostname.toLowerCase(); if (host === "localhost" || host.endsWith(".local") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1") throw new Error("Generated media URL resolves to a disallowed local address."); }
function assertSafeModelPath(value) { const parts = value.split("/"); if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){1,8}$/.test(value) || parts.some((part) => part === "." || part === "..")) throw new Error(`Unsafe or invalid gateway model path: ${value}`); }
function parseDataUri(value) { const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value); return match ? { mimeType: match[1], base64: match[2].replace(/\s/g, "") } : undefined; }
function mimeFromUrl(value, fallback) { const path = value.split("?")[0].toLowerCase(); if (/\.jpe?g$/.test(path)) return "image/jpeg"; if (path.endsWith(".webp")) return "image/webp"; return fallback; }
function compact(input) { return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "")); }
function compactStrings(input) { return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === "string" && value.length)); }
function asRecord(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function stringValue(value) { return typeof value === "string" && value.trim() ? value : undefined; }
