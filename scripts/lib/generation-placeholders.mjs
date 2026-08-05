import { addCanvasObject } from "./project.mjs";

const MODALITIES = new Set(["image", "video"]);
const ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);
const REVIEWED_AT = "2026-08-05";

export async function addGenerationPlaceholder(projectPath, input) {
  const placeholder = buildGenerationPlaceholder(input);
  return addCanvasObject(projectPath, {
    type: "text",
    title: placeholder.title,
    text: formatGenerationPlaceholder(placeholder),
    width: 420,
    height: 520,
    dependsOn: input.dependsOn,
    metadata: {
      kind: "generation-placeholder",
      status: "awaiting-generation-access",
      renderer: "none",
      ...placeholder
    }
  });
}

export function buildGenerationPlaceholder(input = {}) {
  const modality = required(input.modality, "modality");
  if (!MODALITIES.has(modality)) {
    throw new Error("Generation placeholder modality must be image or video.");
  }
  const prompt = required(input.prompt, "prompt");
  const aspectRatio = input.aspectRatio || "16:9";
  if (!ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error("Generation placeholder aspect ratio must be 16:9, 9:16, 1:1, 4:3, or 3:4.");
  }
  if (modality === "video" && !["16:9", "9:16"].includes(aspectRatio)) {
    throw new Error("Video generation placeholders currently support 16:9 or 9:16.");
  }

  const needs = inferNeeds(input.needs, prompt, input.mode);
  const outputSpecs = desiredSpecs(modality, aspectRatio, input);
  const recommendations = modality === "image"
    ? imageRecommendations(aspectRatio, needs, outputSpecs)
    : videoRecommendations(aspectRatio, needs, outputSpecs);
  return {
    title: input.title || `${modality === "image" ? "Image" : "Video"} generation placeholder`,
    modality,
    mode: input.mode || (modality === "image" ? "text-to-image" : "text-to-video"),
    prompt,
    negativePrompt: input.negativePrompt || defaultNegativePrompt(modality),
    needs,
    desiredSpecs: outputSpecs,
    recommendations,
    reviewedAt: REVIEWED_AT
  };
}

export function formatGenerationPlaceholder(placeholder) {
  const specs = Object.entries(placeholder.desiredSpecs)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  const recommendations = placeholder.recommendations
    .map((item, index) => [
      `${index + 1}. ${item.provider} — ${item.model}`,
      `   Use: ${item.use}`,
      `   Best for: ${item.strengths.join(", ")}`,
      `   Specs: ${formatInlineSpecs(item.specs)}`,
      `   Status: ${item.status}`,
      `   Docs: ${item.docsUrl || "Official provider/model documentation required before use"}`
    ].join("\n"))
    .join("\n");
  return [
    "WAITING FOR GENERATION ACCESS",
    "",
    `Mode: ${placeholder.mode}`,
    "",
    "PROMPT",
    placeholder.prompt,
    "",
    "NEGATIVE CONSTRAINTS",
    placeholder.negativePrompt,
    "",
    "DESIRED OUTPUT",
    specs,
    "",
    `SHOT NEEDS: ${placeholder.needs.join(", ") || "general"}`,
    "",
    "RECOMMENDED ROUTES",
    recommendations,
    "",
    `Recommendations checked: ${placeholder.reviewedAt}`,
    "Verify current official documentation before a provider call.",
    "",
    "NEXT",
    "Provide a key through a local environment variable, choose another supported provider, or copy this prompt and generate externally. Replace this placeholder with the resulting media; do not silently switch to Remotion."
  ].join("\n");
}

function desiredSpecs(modality, aspectRatio, input) {
  const outputCount = positiveInteger(input.outputCount, 1);
  if (modality === "image") {
    return {
      aspectRatio,
      resolution: input.resolution || "2K or the closest supported high-quality size",
      outputCount,
      format: input.format || "png",
      quality: input.quality || "high"
    };
  }
  return {
    aspectRatio,
    durationSeconds: positiveNumber(input.durationSeconds, 8),
    resolution: input.resolution || "1080p",
    fps: positiveInteger(input.fps, 24),
    outputCount,
    audio: "external master unless the chosen model is explicitly assigned audio"
  };
}

function imageRecommendations(aspectRatio, needs, desired) {
  const openAiSize = {
    "16:9": "1536x1024",
    "9:16": "1024x1536",
    "1:1": "1024x1024",
    "4:3": "1536x1024",
    "3:4": "1024x1536"
  }[aspectRatio];
  const imagenSize = {
    "16:9": "1408x768",
    "9:16": "768x1408",
    "1:1": "1024x1024",
    "4:3": "1280x896",
    "3:4": "896x1280"
  }[aspectRatio];
  return rankRecommendations([
    {
      provider: "ByteDance Seed",
      model: "Seedream 5.0 Lite",
      use: "reasoning-heavy image creation, dense text, knowledge visuals, and instruction-driven work",
      strengths: ["text", "reasoning", "editing", "prompt-following"],
      specs: { aspectRatio, resolution: desired.resolution, outputCount: desired.outputCount },
      docsUrl: "https://seed.bytedance.com/en/blog/deeper-thinking-more-accurate-generation-introducing-seedream-5-0-lite",
      status: "official model page available; verify the exact API model ID",
      priority: 8
    },
    {
      provider: "ByteDance Seed",
      model: "Seedream 4.0",
      use: "4K keyframes, multi-reference composition, character consistency, and image editing",
      strengths: ["4k", "multi-reference", "identity", "editing", "product"],
      specs: { aspectRatio, resolution: desired.resolution === "4K" ? "4K" : "up to 4K", outputCount: desired.outputCount },
      docsUrl: "https://seed.bytedance.com/en/seedream4_0",
      status: "official model page available; verify the exact API model ID",
      priority: 7
    },
    {
      provider: "OpenAI",
      model: "gpt-image-1",
      use: "high-quality keyframes, products, characters, and general image generation",
      strengths: ["prompt-following", "editing", "product", "text"],
      specs: { size: openAiSize, quality: desired.quality, format: desired.format, outputCount: desired.outputCount },
      docsUrl: "https://platform.openai.com/docs/guides/image-generation",
      status: "official API documentation available",
      priority: 6
    },
    {
      provider: "Google Vertex AI",
      model: "imagen-4.0-generate-001",
      use: "high-quality text-to-image generation with an exact common aspect ratio",
      strengths: ["aesthetics", "text-to-image", "aspect-ratio", "product"],
      specs: { size: imagenSize, outputCount: desired.outputCount, promptLanguage: "English preferred" },
      docsUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/4-0-generate",
      status: "official API documentation available",
      priority: 5
    }
  ], needs, 3);
}

function videoRecommendations(aspectRatio, needs, desired) {
  return rankRecommendations([
    {
      provider: "ByteDance Seed",
      model: "Seedance 2.5 family",
      use: "complex choreography, multi-shot construction, reference-heavy scenes, and native audiovisual generation",
      strengths: ["complex-motion", "multishot", "camera", "reference-heavy", "audio", "long-shot"],
      specs: { aspectRatio, resolution: desired.resolution, durationSeconds: desired.durationSeconds, outputCount: desired.outputCount },
      docsUrl: "https://seed.bytedance.com/en/blog/seedance-2-0-official-launch",
      status: "2.5 requested as a current candidate; exact official 2.5 API documentation and model ID were not verified on 2026-08-05. Use the linked official Seedance family page and confirm access before calling.",
      priority: 9
    },
    {
      provider: "Kuaishou Kling AI",
      model: "Kling 3.0 / Kling Omni family",
      use: "identity-sensitive image-to-video, controlled camera movement, first/last-frame continuity, dialogue, and multi-shot work",
      strengths: ["identity", "image-to-video", "first-last-frame", "camera", "lip-sync", "audio", "multishot", "product"],
      specs: { aspectRatio, resolution: desired.resolution, durationSeconds: desired.durationSeconds, outputCount: desired.outputCount },
      docsUrl: "https://app.klingai.com/global/dev/document-api/quickStart/productIntroduction/overview",
      status: "official developer portal available; verify the currently exposed model ID and parameters",
      priority: 8
    },
    {
      provider: "Google Vertex AI",
      model: "veo-3.1-generate-001",
      use: "cinematic motion, physical coherence, synchronized audio, and first/last-frame generation",
      strengths: ["physics", "cinematic", "audio", "first-last-frame", "prompt-following"],
      specs: {
        aspectRatio,
        resolution: desired.resolution,
        fps: 24,
        durationSeconds: nearestSupported(desired.durationSeconds, [4, 6, 8]),
        outputCount: desired.outputCount
      },
      docsUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate",
      status: "official API documentation available",
      priority: 7
    },
    {
      provider: "OpenAI",
      model: "sora-2",
      use: "general text-to-video or image-guided generation",
      strengths: ["physics", "prompt-following", "camera", "text-to-video", "image-to-video"],
      specs: {
        size: aspectRatio === "9:16" ? "720x1280" : "1280x720",
        durationSeconds: nearestSupported(desired.durationSeconds, [4, 8, 12]),
        outputCount: desired.outputCount
      },
      docsUrl: "https://platform.openai.com/docs/api-reference/videos",
      status: "official API documentation available",
      priority: 6
    },
    {
      provider: "Happy Horse",
      model: "Happy Horse model family",
      use: "experimental open-model audiovisual generation when the user can provide a trustworthy runtime or provider",
      strengths: ["open-source", "audio", "text-to-video", "image-to-video", "experimental"],
      specs: { aspectRatio, resolution: desired.resolution, durationSeconds: desired.durationSeconds, outputCount: desired.outputCount },
      docsUrl: null,
      status: "unverified candidate: no authoritative first-party model or API documentation was found on 2026-08-05. Do not call or claim capabilities until the user supplies official documentation.",
      priority: 0
    }
  ], needs, 5);
}

function defaultNegativePrompt(modality) {
  return modality === "image"
    ? "No identity drift, malformed anatomy, changed product geometry, accidental text, watermark, logo, duplicate subject, or unrelated object."
    : "No identity drift, geometry changes, extra subjects, unstable camera motion, broken physics, accidental text, watermark, duplicate music, or unrequested dialogue.";
}

function formatInlineSpecs(specs) {
  return Object.entries(specs).map(([key, value]) => `${key}=${value}`).join(", ");
}

function inferNeeds(input, prompt, mode = "") {
  const explicit = Array.isArray(input)
    ? input
    : String(input || "").split(",");
  const needs = new Set(explicit.map(normalizeNeed).filter(Boolean));
  const evidence = `${prompt} ${mode}`.toLowerCase();
  const patterns = [
    ["lip-sync", /lip.?sync|dialogue|speaking|singing|口型|对白|说话|演唱/],
    ["audio", /audio|sound|music|voice|音频|声音|音乐|配音/],
    ["identity", /identity|same character|consistent character|角色一致|人物一致|主体一致/],
    ["multishot", /multi.?shot|montage|sequence|多镜头|蒙太奇|镜头组/],
    ["complex-motion", /choreograph|fight|dance|complex motion|打斗|舞蹈|复杂动作/],
    ["camera", /camera|tracking|dolly|crane|orbit|摄影机|运镜|跟拍|环绕/],
    ["first-last-frame", /first.?last|start.?end|首尾帧|起始帧|结束帧/],
    ["physics", /physics|fluid|collision|cloth|物理|流体|碰撞|布料/],
    ["multi-reference", /multi.?reference|multiple reference|多参考|多图参考/],
    ["text", /typography|poster|title|text rendering|字体|海报|文字/],
    ["editing", /edit|replace|remove|修改|替换|移除/],
    ["open-source", /open.?source|local model|开源|本地模型/]
  ];
  for (const [need, pattern] of patterns) {
    if (pattern.test(evidence)) needs.add(need);
  }
  return [...needs];
}

function rankRecommendations(items, needs, limit) {
  return items
    .map((item) => ({
      ...item,
      score: item.priority + needs.reduce(
        (score, need) => score + (item.strengths.includes(need) ? 4 : 0),
        0
      )
    }))
    .sort((left, right) => right.score - left.score || right.priority - left.priority)
    .slice(0, limit)
    .map(({ priority, score, ...item }) => item);
}

function normalizeNeed(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Generation placeholder ${label} is required.`);
  }
  return value.trim();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nearestSupported(value, choices) {
  return choices.reduce((best, choice) => (
    Math.abs(choice - value) <= Math.abs(best - value) ? choice : best
  ), choices[0]);
}
