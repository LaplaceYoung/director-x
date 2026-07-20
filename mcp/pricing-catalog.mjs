import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_MAX_AGE_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

const OFFICIAL_DOMAINS = Object.freeze({
  openai: ["developers.openai.com", "platform.openai.com", "openai.com"],
  google_gemini: ["ai.google.dev", "cloud.google.com"],
  runway: ["docs.dev.runwayml.com", "dev.runwayml.com"],
  dashscope: ["help.aliyun.com", "aliyun.com"],
  volcengine_ark: ["volcengine.com"],
  luma: ["docs.lumalabs.ai", "lumalabs.ai"],
  minimax: ["platform.minimaxi.com", "minimax.io"],
  vidu: ["docs.platform.vidu.com", "platform.vidu.com"],
  fal: ["fal.ai"],
  replicate: ["replicate.com"],
  "mosi.tts": ["platform.mosi.cn", "mosi.cn"]
});

const BUILT_IN_PRICING = Object.freeze([
  snapshot("openai", "gpt-image-1.5", "image", "USD", "https://developers.openai.com/api/docs/models/gpt-image-1.5", "2026-07-16", [
    imageRate(.009, "low", "1024x1024"), imageRate(.013, "low", "1024x1536"), imageRate(.013, "low", "1536x1024"),
    imageRate(.034, "medium", "1024x1024"), imageRate(.05, "medium", "1024x1536"), imageRate(.05, "medium", "1536x1024"),
    imageRate(.133, "high", "1024x1024"), imageRate(.20, "high", "1024x1536"), imageRate(.20, "high", "1536x1024")
  ]),
  snapshot("openai", "gpt-image-1-mini", "image", "USD", "https://developers.openai.com/api/docs/models/gpt-image-1-mini", "2026-07-16", [
    imageRate(.005, "low", "1024x1024"), imageRate(.006, "low", "1024x1536"), imageRate(.006, "low", "1536x1024"),
    imageRate(.011, "medium", "1024x1024"), imageRate(.015, "medium", "1024x1536"), imageRate(.015, "medium", "1536x1024"),
    imageRate(.036, "high", "1024x1024"), imageRate(.052, "high", "1024x1536"), imageRate(.052, "high", "1536x1024")
  ]),
  snapshot("openai", "sora-2", "video", "USD", "https://developers.openai.com/api/docs/models/sora-2", "2026-07-16", [
    secondRate(.10, { resolution: "720p" }, "Synced audio is bundled in the official rate.")
  ]),
  snapshot("openai", "sora-2-pro", "video", "USD", "https://developers.openai.com/api/docs/models/sora-2-pro", "2026-07-16", [
    secondRate(.30, { resolution: "720p" }, "Synced audio is bundled in the official rate."),
    secondRate(.50, { resolution: "1024p" }, "Synced audio is bundled in the official rate."),
    secondRate(.70, { resolution: "1080p" }, "Synced audio is bundled in the official rate.")
  ]),
  snapshot("google_gemini", "gemini-3.1-flash-image", "image", "USD", "https://ai.google.dev/gemini-api/docs/pricing", "2026-07-16", [
    imageRate(.045, null, "0.5k"), imageRate(.067, null, "1k"), imageRate(.101, null, "2k"), imageRate(.151, null, "4k")
  ]),
  snapshot("google_gemini", "gemini-3-pro-image", "image", "USD", "https://ai.google.dev/gemini-api/docs/pricing", "2026-07-16", [
    imageRate(.134, null, "1k"), imageRate(.134, null, "2k"), imageRate(.24, null, "4k")
  ]),
  snapshot("google_gemini", "veo-3.1-generate-preview", "video", "USD", "https://ai.google.dev/gemini-api/docs/pricing", "2026-07-16", [
    secondRate(.40, { resolution: "720p" }, "Official direct-API price includes audio."),
    secondRate(.40, { resolution: "1080p" }, "Official direct-API price includes audio."),
    secondRate(.60, { resolution: "4k" }, "Official direct-API price includes audio.")
  ]),
  snapshot("google_gemini", "veo-3.1-fast-generate-preview", "video", "USD", "https://ai.google.dev/gemini-api/docs/pricing", "2026-07-16", [
    secondRate(.10, { resolution: "720p" }, "Official direct-API price includes audio."),
    secondRate(.12, { resolution: "1080p" }, "Official direct-API price includes audio."),
    secondRate(.30, { resolution: "4k" }, "Official direct-API price includes audio.")
  ]),
  snapshot("google_gemini", "lyria-3-clip-preview", "music", "USD", "https://ai.google.dev/gemini-api/docs/pricing", "2026-07-16", [
    requestRate(.04, { durationSeconds: 30 })
  ]),
  snapshot("google_gemini", "lyria-3-pro-preview", "music", "USD", "https://ai.google.dev/gemini-api/docs/pricing", "2026-07-16", [
    requestRate(.08)
  ]),
  snapshot("runway", "gen4_image", "image", "USD", "https://docs.dev.runwayml.com/guides/pricing/", "2026-07-16", [
    imageRate(.05, null, "720p", "5 credits × USD 0.01."), imageRate(.08, null, "1080p", "8 credits × USD 0.01.")
  ]),
  snapshot("runway", "gen4.5", "video", "USD", "https://docs.dev.runwayml.com/guides/pricing/", "2026-07-16", [
    secondRate(.12, {}, "12 credits per second × USD 0.01.")
  ]),
  {
    pricingId: "host:codex-imagegen:included",
    providerId: "codex-imagegen",
    modelId: "host",
    mediaType: "image",
    currency: "CNY",
    sourceUrl: "codex://host-capability",
    sourceTitle: "Codex host image generation capability",
    verifiedAt: "2026-07-16",
    maxAgeDays: null,
    evidenceKind: "host_included",
    rates: [imageRate(0)]
  }
]);

export function listModelPricing({ providerId, modelId, mediaType } = {}) {
  return BUILT_IN_PRICING
    .filter((entry) => (!providerId || entry.providerId === providerId) && (!modelId || entry.modelId === modelId) && (!mediaType || entry.mediaType === mediaType))
    .map((entry) => structuredClone(entry));
}

export function registerModelPricing(run, evidence) {
  const normalized = normalizePricingEvidence(evidence);
  run.pricingEvidence ??= [];
  const index = run.pricingEvidence.findIndex((entry) => entry.pricingId === normalized.pricingId);
  if (index >= 0) run.pricingEvidence[index] = normalized;
  else run.pricingEvidence.push(normalized);
  return normalized;
}

export async function writeModelPricingEvidence({ projectPath, runId, evidence }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const artifactRef = `model_pricing_${safeId(evidence.providerId)}_${safeId(evidence.modelId)}.json`;
  const path = resolve(directory, artifactRef);
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef, path };
}

export function quoteModelCost(input, options = {}) {
  const now = new Date(options.now ?? Date.now());
  const evidence = [
    ...(input.pricingEvidence ?? []),
    ...BUILT_IN_PRICING
  ].map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.providerId === input.providerId && entry.modelId === input.modelId && entry.mediaType === input.mediaType)
    .sort((left, right) => Date.parse(right.entry.verifiedAt) - Date.parse(left.entry.verifiedAt) || right.index - left.index)
    .map(({ entry }) => entry)[0];
  if (!evidence) {
    throw new Error(`No official pricing evidence is registered for ${input.providerId}/${input.modelId}. Search and open the provider's official pricing page, then register it before budget approval.`);
  }
  assertFresh(evidence, now);
  const usage = normalizeUsage(input.mediaType, input.usage);
  const rate = selectRate(evidence.rates, usage);
  if (!rate) throw new Error(`Official pricing for ${input.providerId}/${input.modelId} does not cover this quality, resolution, audio mode, or duration. Refresh the official pricing evidence.`);
  const quantity = quantityFor(rate.metric, usage);
  const amount = rounded(quantity * rate.unitPrice);
  const quoteBase = {
    pricingId: evidence.pricingId,
    providerId: evidence.providerId,
    modelId: evidence.modelId,
    mediaType: evidence.mediaType,
    currency: evidence.currency,
    amount,
    metric: rate.metric,
    unitPrice: rate.unitPrice,
    quantity,
    conditions: rate.conditions ?? {},
    usage,
    formula: `${quantity} ${rate.metric} × ${evidence.currency} ${rate.unitPrice} = ${evidence.currency} ${amount}`,
    sourceUrl: evidence.sourceUrl,
    sourceTitle: evidence.sourceTitle,
    verifiedAt: evidence.verifiedAt,
    evidenceKind: evidence.evidenceKind ?? "official_api_pricing",
    note: rate.note ?? null
  };
  return { schemaVersion: "1.0", quoteId: `price-${digest(quoteBase).slice(0, 24)}`, ...quoteBase };
}

export function assertPricingQuoteMatches(quote, expected) {
  const recalculated = quoteModelCost(expected);
  if (!quote || quote.quoteId !== recalculated.quoteId || quote.amount !== recalculated.amount || quote.currency !== recalculated.currency) {
    throw new Error("Generation pricing must use the current Director X quote calculated from official pricing evidence.");
  }
  return recalculated;
}

export function assertQuoteApprovedByBudget(budget, quote) {
  if (!budget) throw new Error("A current user-approved budget decision is required before paid or included model execution.");
  if (budget.basis === "zero_external_api") {
    if (quote.amount !== 0) throw new Error("The approved zero-external-API budget does not authorize this paid model quote.");
    return { basis: budget.basis, plannedCalls: null, pricingQuote: quote };
  }
  if (budget.basis !== "official_quotes") throw new Error("The approved budget is not backed by official model quotes.");
  const route = (budget.routes ?? []).find((entry) =>
    entry.providerId === quote.providerId &&
    entry.modelId === quote.modelId &&
    entry.mediaType === quote.mediaType &&
    entry.pricingQuote?.quoteId === quote.quoteId
  );
  if (!route) throw new Error("This exact provider, model, usage tier, and official price quote were not included in the user-approved budget.");
  if (budget.currency !== quote.currency) throw new Error("The approved budget currency does not match the official execution quote.");
  return route;
}

export function validateOfficialBudget(value = {}, pricingEvidence = []) {
  if (value.basis === "zero_external_api") {
    if (Number(value.cap) !== 0 || !/^[A-Z]{3}$/.test(value.currency ?? "CNY")) throw new Error("A zero-external-API budget requires cap=0 and a three-letter currency.");
    if ((value.routes ?? []).length) throw new Error("A zero-external-API budget cannot contain paid model routes.");
    return { basis: "zero_external_api", currency: value.currency ?? "CNY", cap: 0, routes: [], quotedTotal: 0, pricingPolicy: "no_paid_external_api" };
  }
  if (value.basis !== "official_quotes" || !/^[A-Z]{3}$/.test(value.currency ?? "") || !Number.isFinite(value.cap) || value.cap <= 0 || !Array.isArray(value.routes) || !value.routes.length) {
    throw new Error("A paid production budget requires basis=official_quotes, currency, positive cap, and at least one officially quoted model route.");
  }
  let quotedTotal = 0;
  const routes = value.routes.map((route) => {
    if (!route.providerId || !route.modelId || !["image", "video", "voice", "music"].includes(route.mediaType) || !route.pricingQuote) throw new Error("Every budget route requires providerId, modelId, mediaType, usage, and the Director X pricingQuote.");
    const quote = quoteModelCost({ providerId: route.providerId, modelId: route.modelId, mediaType: route.mediaType, usage: route.usage ?? {}, pricingEvidence });
    if (quote.quoteId !== route.pricingQuote.quoteId || quote.amount !== route.pricingQuote.amount || quote.currency !== route.pricingQuote.currency) throw new Error("Budget quotes must exactly match current official Director X pricing evidence.");
    if (quote.currency !== value.currency) throw new Error("Every official quote must use the approved budget currency.");
    const plannedCalls = Number(route.plannedCalls ?? 1);
    if (!Number.isInteger(plannedCalls) || plannedCalls < 1) throw new Error("Budget route plannedCalls must be a positive integer.");
    quotedTotal += quote.amount * plannedCalls;
    return { providerId: route.providerId, modelId: route.modelId, mediaType: route.mediaType, usage: structuredClone(route.usage ?? {}), plannedCalls, pricingQuote: quote };
  });
  quotedTotal = rounded(quotedTotal);
  if (quotedTotal > value.cap) throw new Error("Official route quotes exceed the proposed production budget cap.");
  return { basis: "official_quotes", currency: value.currency, cap: value.cap, routes, quotedTotal, pricingPolicy: "official_sources_only" };
}

function normalizePricingEvidence(value) {
  if (!value?.pricingId || !value.providerId || !value.modelId || !["image", "video", "voice", "music"].includes(value.mediaType)) throw new Error("Pricing evidence requires pricingId, providerId, modelId, and mediaType.");
  if (!/^[A-Z]{3}$/.test(value.currency ?? "")) throw new Error("Pricing currency must be a three-letter code.");
  const source = new URL(value.sourceUrl);
  if (source.protocol !== "https:") throw new Error("Pricing evidence must use an HTTPS official source.");
  const allowed = OFFICIAL_DOMAINS[value.providerId];
  if (allowed && !allowed.some((domain) => source.hostname === domain || source.hostname.endsWith(`.${domain}`))) throw new Error(`${value.providerId} pricing evidence must use its official documentation domain.`);
  if (!Number.isFinite(Date.parse(value.verifiedAt))) throw new Error("Pricing evidence requires a valid verifiedAt timestamp or date.");
  if (!Array.isArray(value.rates) || !value.rates.length) throw new Error("Pricing evidence requires at least one rate.");
  const rates = value.rates.map((rate) => {
    if (!["per_image", "per_second", "per_request", "per_character", "per_1k_characters"].includes(rate.metric) || !Number.isFinite(rate.unitPrice) || rate.unitPrice < 0) throw new Error("Pricing rates require a supported metric and non-negative unitPrice.");
    return { metric: rate.metric, unitPrice: rate.unitPrice, conditions: structuredClone(rate.conditions ?? {}), note: rate.note ?? null };
  });
  return {
    schemaVersion: "1.0",
    pricingId: value.pricingId,
    providerId: value.providerId,
    modelId: value.modelId,
    mediaType: value.mediaType,
    currency: value.currency,
    sourceUrl: source.toString(),
    sourceTitle: String(value.sourceTitle ?? `${value.providerId} official pricing`),
    verifiedAt: new Date(value.verifiedAt).toISOString(),
    maxAgeDays: value.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
    evidenceKind: "official_api_pricing",
    rates
  };
}

function assertFresh(evidence, now) {
  if (evidence.maxAgeDays == null) return;
  const ageMs = now.getTime() - Date.parse(evidence.verifiedAt);
  if (!Number.isFinite(ageMs) || ageMs < -DAY_MS || ageMs > evidence.maxAgeDays * DAY_MS) {
    throw new Error(`Official pricing evidence ${evidence.pricingId} is stale. Refresh the provider's official pricing page before estimating or approving budget.`);
  }
}

function normalizeUsage(mediaType, value = {}) {
  const usage = {
    imageCount: integer(value.imageCount ?? value.outputCount ?? 1, "imageCount"),
    durationSeconds: positive(value.durationSeconds ?? 0, "durationSeconds", mediaType !== "video"),
    requestCount: integer(value.requestCount ?? 1, "requestCount"),
    characterCount: integer(value.characterCount ?? 0, "characterCount", true),
    quality: normalized(value.quality ?? "high"),
    resolution: normalizeResolution(value.resolution ?? value.size ?? defaultResolution(mediaType)),
    generateAudio: Boolean(value.generateAudio)
  };
  if (mediaType === "video" && usage.durationSeconds <= 0) throw new Error("Video pricing requires a positive durationSeconds.");
  return usage;
}

function selectRate(rates, usage) {
  return rates
    .filter((rate) => Object.entries(rate.conditions ?? {}).every(([key, expected]) => normalized(usage[key]) === normalized(expected)))
    .sort((left, right) => Object.keys(right.conditions ?? {}).length - Object.keys(left.conditions ?? {}).length)[0] ?? null;
}

function quantityFor(metric, usage) {
  if (metric === "per_image") return usage.imageCount;
  if (metric === "per_second") return usage.durationSeconds;
  if (metric === "per_request") return usage.requestCount;
  if (metric === "per_character") return usage.characterCount;
  if (metric === "per_1k_characters") return usage.characterCount / 1000;
  throw new Error(`Unsupported pricing metric: ${metric}`);
}

function snapshot(providerId, modelId, mediaType, currency, sourceUrl, verifiedAt, rates) {
  return {
    pricingId: `official:${providerId}:${modelId}:${verifiedAt}`,
    providerId, modelId, mediaType, currency, sourceUrl,
    sourceTitle: `${providerId} official API pricing`,
    verifiedAt,
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    evidenceKind: "official_api_pricing",
    rates
  };
}

function imageRate(unitPrice, quality, resolution, note = null) {
  return { metric: "per_image", unitPrice, conditions: compact({ quality, resolution: normalizeResolution(resolution) }), note };
}
function secondRate(unitPrice, conditions = {}, note = null) {
  return { metric: "per_second", unitPrice, conditions: Object.fromEntries(Object.entries(conditions).map(([key, value]) => [key, key === "resolution" ? normalizeResolution(value) : value])), note };
}
function requestRate(unitPrice, conditions = {}, note = null) { return { metric: "per_request", unitPrice, conditions, note }; }
function defaultResolution(mediaType) { return mediaType === "image" ? "1024x1024" : "720p"; }
function normalizeResolution(value) {
  const text = normalized(value);
  if (["1280x720", "720x1280", "720"].includes(text)) return "720p";
  if (["1920x1080", "1080x1920", "1080"].includes(text)) return "1080p";
  if (["1792x1024", "1024x1792", "1024"].includes(text)) return "1024p";
  return text;
}
function normalized(value) { return String(value ?? "").trim().toLowerCase(); }
function integer(value, label, allowZero = false) {
  const number = Number(value);
  if (!Number.isInteger(number) || (allowZero ? number < 0 : number < 1)) throw new Error(`${label} must be ${allowZero ? "zero or greater" : "a positive integer"}.`);
  return number;
}
function positive(value, label, allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) throw new Error(`${label} must be ${allowZero ? "zero or greater" : "positive"}.`);
  return number;
}
function compact(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== "")); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function rounded(value) { return Math.round(value * 1_000_000) / 1_000_000; }
function safeId(value) {
  const result = String(value ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 100);
  if (!result) throw new Error("Pricing provider/model ID is required.");
  return result;
}
