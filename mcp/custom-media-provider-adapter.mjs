import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const PROVIDER_ID_PATTERN = /^custom\.[a-z0-9][a-z0-9._-]{1,62}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/;
const HEADER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const JSON_PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.(?:[A-Za-z_][A-Za-z0-9_-]*|\d+)){0,11}$/;
const TEMPLATE_PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){0,11}$/;
const PATH_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*(?:\{jobId\})?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/;
const MEDIA_TYPES = new Set(["image", "video"]);
const MODES = new Set(["text_to_image", "image_to_image", "text_to_video", "image_to_video", "keyframes_to_video", "reference_to_video", "video_extension"]);
const PROTOCOLS = new Set(["json_sync", "json_async_poll"]);
const AUTH_SCHEMES = new Set(["bearer", "token", "key", "header"]);
const ALLOWED_INPUT_FIELDS = new Set([
  "modelId", "prompt", "negativePrompt", "aspectRatio", "size", "resolution",
  "durationSeconds", "imageUrls", "endImageUrl", "videoUrl", "outputCount", "generateAudio"
]);
const CANONICAL_STATUSES = new Set(["queued", "running", "input_required", "succeeded", "failed", "cancelled"]);
const BLOCKED_HEADERS = new Set(["cookie", "set-cookie", "host", "origin", "referer", "proxy-authorization", "proxy-authenticate"]);
const adapterRegistry = new Map();

export function customProviderIntake(mediaType) {
  if (!MEDIA_TYPES.has(mediaType)) throw new Error("mediaType must be image or video.");
  return {
    schemaVersion: "1.0",
    mediaType,
    interaction: {
      kind: "provider_input",
      gateKey: `${mediaType}-custom-provider-model`,
      reason: `需要先确定${mediaType === "image" ? "生图" : "视频生成"}供应商和精确模型，才能检索官方 API 文档并建立适配。`,
      questions: [
        {
          header: "模型供应商",
          id: `${mediaType}_provider_name`,
          question: `请选择或在“其他”中填写你接入的${mediaType === "image" ? "生图" : "视频"}模型供应商名称。`,
          options: [
            { label: "使用内置供应商 (Recommended)", description: "优先使用 Director X 已验证的主流供应商，可直接进入模型确认。" },
            { label: "供应商官方 API", description: "在“其他”中填写供应商准确名称，Codex 将只检索其官方 API 文档。" },
            { label: "第三方模型网关", description: "在“其他”中填写网关名称，并继续确认实际模型 ID。" }
          ]
        },
        {
          header: "精确模型",
          id: `${mediaType}_model_name`,
          question: "请选择，或在“其他”中填写供应商文档中的精确模型名称 / model ID。",
          options: [
            { label: "指定精确模型 (Recommended)", description: "在“其他”中填写精确 model ID，避免 Codex 猜测或静默替换模型。" },
            { label: "供应商推荐模型", description: "允许 Codex根据官方文档推荐一个当前可用模型，之后仍需再次确认。" },
            { label: "供应商默认模型", description: "仅在官方 API 明确支持省略 model 字段时使用。" }
          ]
        }
      ]
    },
    researchContract: {
      sourcePolicy: "official_api_docs_only",
      requiredHostActions: ["web.search_query", "web.open"],
      requiredEvidence: ["verified official source", "submit endpoint", "authentication scheme", "request fields", "response or polling fields", "model capability and limits"],
      forbidden: ["community-only endpoint guesses", "generated SDK code execution", "arbitrary JavaScript", "shell commands", "private-network API origins"]
    }
  };
}

export function registerCustomMediaProviderAdapter(input) {
  const adapter = validateCustomMediaProviderAdapter(input);
  adapterRegistry.set(adapter.providerId, adapter);
  return structuredClone(adapter);
}

export function hydrateCustomMediaProviderAdapters(adapters = {}) {
  for (const adapter of Object.values(adapters ?? {})) registerCustomMediaProviderAdapter(adapter);
}

export function getCustomMediaProviderAdapter(providerId) {
  const adapter = adapterRegistry.get(providerId);
  if (!adapter) throw new Error(`Custom media provider adapter is not registered in this Director X session: ${providerId}`);
  return adapter;
}

export function listCustomMediaProviderAdapters() {
  return [...adapterRegistry.values()].map((adapter) => structuredClone(adapter));
}

export function customProviderProfile(adapter) {
  return {
    providerId: adapter.providerId,
    displayName: adapter.displayName,
    providerKind: adapter.providerKind,
    baseUrl: adapter.api.baseUrl,
    authScheme: "custom",
    credentialEnv: adapter.auth.credentialEnv,
    credentialAliases: [],
    setupUrl: adapter.setupUrl,
    docsUrl: adapter.docs.sources[0].url,
    pollingIntervalMs: adapter.api.pollingIntervalMs,
    supportsCustomModels: false,
    customAdapter: adapter,
    models: [{
      modelId: adapter.model.modelId,
      displayName: adapter.model.displayName,
      mediaType: adapter.model.mediaType,
      modes: [...adapter.model.modes],
      isDefault: true,
      supports: { ...adapter.model.supports, officialDocsAdapted: true }
    }]
  };
}

export function customProviderSetup(adapter, credentialConfigured = false) {
  const focusCredentialPanel = {
    type: "focus_canvas_credential",
    providerId: adapter.providerId,
    envName: adapter.auth.credentialEnv,
    persistence: "handoff",
    secretPolicy: "session_only_not_persisted"
  };
  return {
    providerId: adapter.providerId,
    providerKind: adapter.providerKind,
    displayName: adapter.displayName,
    model: structuredClone(adapter.model),
    credentialEnv: adapter.auth.credentialEnv,
    credentialConfigured,
    setupUrl: adapter.setupUrl,
    docsUrl: adapter.docs.sources[0].url,
    pollingIntervalMs: adapter.api.pollingIntervalMs,
    docsEvidence: structuredClone(adapter.docs),
    credentialPolicy: "session_only_not_persisted",
    keySetupRequired: !credentialConfigured,
    keySetupInteraction: {
      kind: "provider_input",
      gateKey: `${adapter.providerId}-key-setup`,
      reason: `${adapter.displayName}/${adapter.model.modelId} 已确认，但当前 Director X MCP 会话没有配置 ${adapter.auth.credentialEnv}。`,
      questions: [{
        header: "API Key",
        id: `${adapter.providerId.replace(/[^a-z0-9]/gi, "_")}_key_setup`,
        question: `是否现在为 ${adapter.displayName} 配置 API Key？`,
        options: [
          { label: "我已有 Key (Recommended)", description: "在 Director X 画布安全密码框输入；Codex 自动注入当前会话环境变量且不会保存。" },
          { label: "前往供应商控制台", description: "在侧边 Browser 新标签打开供应商控制台，创建 Key 后回到画布安全注入。" },
          { label: "暂不配置", description: "保留适配器，但暂停依赖该供应商的生成阶段。" }
        ]
      }]
    },
    keySetupAnswerActions: {
      "我已有 Key (Recommended)": [focusCredentialPanel],
      "前往供应商控制台": [
        { type: "open_url", url: adapter.setupUrl, browser: "iab", target: "new_tab", visibility: true, persistence: "handoff", keepProductionCanvas: true },
        { ...focusCredentialPanel, after: "api_key_created" }
      ],
      "暂不配置": [{ type: "block_dependent_stage", capability: adapter.model.mediaType, reason: `${adapter.auth.credentialEnv} is not configured.` }]
    },
    nextAction: credentialConfigured ? "confirm_budget_then_probe_and_generate" : "resolve_native_key_setup_then_secure_canvas_injection"
  };
}

export function prepareCustomMediaSubmit(adapter, input) {
  if (input.modelId !== adapter.model.modelId) throw new Error(`${adapter.providerId} is registered only for exact model ${adapter.model.modelId}.`);
  if (!adapter.model.modes.includes(input.mode)) throw new Error(`${adapter.providerId}/${input.modelId} does not support ${input.mode}.`);
  const body = structuredClone(adapter.request.defaults);
  for (const [source, target] of Object.entries(adapter.request.fieldMap)) {
    const value = input[source];
    if (value !== undefined && value !== null && value !== "") setTemplatePath(body, target, value);
  }
  return {
    providerId: adapter.providerId,
    modelId: adapter.model.modelId,
    mediaType: adapter.model.mediaType,
    mode: input.mode,
    method: "POST",
    url: joinApiUrl(adapter.api.baseUrl, adapter.api.submitPath),
    bodyType: "json",
    body,
    extraHeaders: structuredClone(adapter.api.headers)
  };
}

export function normalizeCustomMediaJob(adapter, raw, fallbackJobId = "sync-result", inheritedState = {}) {
  const errorMessage = valueAtPath(raw, adapter.response.errorMessagePath);
  const resultUrls = adapter.response.resultUrlPaths.flatMap((path) => stringValues(valueAtPath(raw, path))).filter(isHttpsUrl);
  const inlineAssets = adapter.response.inlineBase64Paths
    .flatMap((path) => stringValues(valueAtPath(raw, path)))
    .filter((value) => /^[A-Za-z0-9+/=\s]+$/.test(value))
    .map((base64Data) => ({ mediaType: adapter.model.mediaType, mimeType: adapter.response.inlineMimeType, base64Data: base64Data.replace(/\s/g, "") }));
  const providerJobId = stringValue(valueAtPath(raw, adapter.response.jobIdPath)) ?? fallbackJobId;
  const rawStatus = stringValue(valueAtPath(raw, adapter.response.statusPath));
  const status = errorMessage
    ? "failed"
    : adapter.api.protocol === "json_sync" && (resultUrls.length || inlineAssets.length)
      ? "succeeded"
      : canonicalStatus(rawStatus, adapter.response.statusMap);
  const rawProgress = Number(valueAtPath(raw, adapter.response.progressPath));
  const progress = status === "succeeded" ? 1 : Number.isFinite(rawProgress) ? Math.max(0, Math.min(1, rawProgress > 1 ? rawProgress / 100 : rawProgress)) : status === "queued" ? 0.05 : 0.5;
  const pollUrl = adapter.api.protocol === "json_async_poll"
    ? joinApiUrl(adapter.api.baseUrl, adapter.api.pollPath.replace("{jobId}", encodeURIComponent(providerJobId)))
    : inheritedState.pollUrl;
  return {
    providerId: adapter.providerId,
    providerJobId,
    status,
    progress,
    resultUrls: [...new Set(resultUrls)],
    inlineAssets,
    error: errorMessage ? { code: "provider_error", message: String(errorMessage).slice(0, 1_000) } : null,
    providerState: { ...inheritedState, pollUrl }
  };
}

export function customAuthHeaders(adapter, credential) {
  const prefix = adapter.auth.prefix ? `${adapter.auth.prefix} ` : "";
  return {
    accept: "application/json",
    "content-type": "application/json",
    [adapter.auth.headerName]: `${prefix}${credential}`
  };
}

export async function writeCustomMediaProviderAdapter({ projectPath, runId, adapter }) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Director X run ID.");
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts", "provider-adapters");
  await mkdir(directory, { recursive: true });
  const fileName = `${adapter.providerId.replace(/[^a-z0-9._-]/gi, "-")}-${adapter.model.modelId.replace(/[^a-z0-9._-]/gi, "-")}.json`;
  const path = join(directory, fileName);
  await writeFile(path, `${JSON.stringify(adapter, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: `provider_adapter:${adapter.providerId}:${adapter.model.modelId}`, path };
}

export function validateCustomMediaProviderAdapter(input) {
  const adapter = structuredClone(input ?? {});
  if (!PROVIDER_ID_PATTERN.test(adapter.providerId ?? "")) throw new Error("Custom providerId must use the custom.<slug> namespace.");
  if (!String(adapter.displayName ?? "").trim()) throw new Error("Custom provider displayName is required.");
  if (!["direct", "gateway"].includes(adapter.providerKind)) throw new Error("Custom providerKind must be direct or gateway.");
  if (!MODEL_ID_PATTERN.test(adapter.model?.modelId ?? "")) throw new Error("Custom provider modelId is invalid.");
  if (!String(adapter.model?.displayName ?? "").trim()) throw new Error("Custom provider model displayName is required.");
  if (!MEDIA_TYPES.has(adapter.model?.mediaType)) throw new Error("Custom provider model mediaType must be image or video.");
  if (!Array.isArray(adapter.model?.modes) || !adapter.model.modes.length || adapter.model.modes.some((mode) => !MODES.has(mode))) throw new Error("Custom provider model modes are missing or unsupported.");
  adapter.model.supports = plainRecord(adapter.model.supports);

  assertSafePublicHttps(adapter.api?.baseUrl, "api.baseUrl");
  if (!PROTOCOLS.has(adapter.api?.protocol)) throw new Error("Custom provider protocol must be json_sync or json_async_poll.");
  if (!PATH_PATTERN.test(adapter.api?.submitPath ?? "") || adapter.api.submitPath.includes("{jobId}")) throw new Error("Custom provider submitPath is invalid.");
  if (adapter.api.protocol === "json_async_poll" && (!PATH_PATTERN.test(adapter.api?.pollPath ?? "") || !adapter.api.pollPath.includes("{jobId}"))) throw new Error("Async custom providers require a safe pollPath containing {jobId}.");
  adapter.api.pollingIntervalMs = integerInRange(adapter.api.pollingIntervalMs ?? 5_000, 1_000, 60_000, "api.pollingIntervalMs");
  adapter.api.headers = validateStaticHeaders(adapter.api.headers);

  if (!AUTH_SCHEMES.has(adapter.auth?.scheme)) throw new Error("Custom provider auth scheme is unsupported.");
  if (!ENV_NAME_PATTERN.test(adapter.auth?.credentialEnv ?? "")) throw new Error("Custom provider credentialEnv must be an uppercase environment variable name.");
  if (!HEADER_NAME_PATTERN.test(adapter.auth?.headerName ?? "")) throw new Error("Custom provider auth headerName is invalid.");
  if (BLOCKED_HEADERS.has(adapter.auth.headerName.toLowerCase())) throw new Error("Custom provider auth headerName is not allowed.");
  if (adapter.auth.scheme !== "header" && adapter.auth.headerName.toLowerCase() !== "authorization") throw new Error("Bearer, Token, and Key auth schemes must use the Authorization header.");
  if (adapter.auth.scheme === "bearer" && adapter.auth.prefix !== "Bearer") throw new Error("Bearer auth requires the Bearer prefix.");
  if (adapter.auth.scheme === "token" && adapter.auth.prefix !== "Token") throw new Error("Token auth requires the Token prefix.");
  if (adapter.auth.scheme === "key" && adapter.auth.prefix !== "Key") throw new Error("Key auth requires the Key prefix.");
  if (adapter.auth.headerName.toLowerCase() === "authorization" && !String(adapter.auth.prefix ?? "").trim()) throw new Error("Authorization-based custom providers require an explicit auth prefix.");
  if (adapter.auth.prefix && !["Bearer", "Token", "Key"].includes(adapter.auth.prefix)) throw new Error("Custom provider auth prefix must be Bearer, Token, Key, or empty.");

  assertSafePublicHttps(adapter.setupUrl, "setupUrl");
  if (!Array.isArray(adapter.docs?.sources) || !adapter.docs.sources.length) throw new Error("Custom provider adapter requires official API documentation evidence.");
  for (const source of adapter.docs.sources) {
    assertSafePublicHttps(source.url, "docs.sources.url");
    if (source.sourceType !== "official_api_docs" || source.verificationStatus !== "verified") throw new Error("Every custom provider documentation source must be verified official_api_docs.");
    if (!String(source.sourceId ?? "").trim() || !String(source.observedAt ?? "").trim() || !String(source.evidenceSummary ?? "").trim()) throw new Error("Official API documentation evidence requires sourceId, observedAt, and evidenceSummary.");
  }
  if (!Array.isArray(adapter.docs.hostExecutions) || !adapter.docs.hostExecutions.some((item) => item.action === "search") || !adapter.docs.hostExecutions.some((item) => item.action === "open")) throw new Error("Custom provider adaptation requires recorded host search and source-open executions.");

  adapter.request.defaults = plainRecord(adapter.request?.defaults);
  adapter.request.fieldMap = plainRecord(adapter.request?.fieldMap);
  if (!adapter.request.fieldMap.prompt || !adapter.request.fieldMap.modelId) throw new Error("Custom provider request fieldMap must map prompt and modelId.");
  for (const [source, target] of Object.entries(adapter.request.fieldMap)) {
    if (!ALLOWED_INPUT_FIELDS.has(source)) throw new Error(`Custom provider request source field is not allowed: ${source}`);
    if (!TEMPLATE_PATH_PATTERN.test(target)) throw new Error(`Custom provider request target path is invalid: ${target}`);
  }

  adapter.response = plainRecord(adapter.response);
  for (const field of ["jobIdPath", "statusPath", "progressPath", "errorMessagePath"]) {
    if (adapter.response[field] !== undefined && adapter.response[field] !== null && adapter.response[field] !== "" && !JSON_PATH_PATTERN.test(adapter.response[field])) throw new Error(`Custom provider response ${field} is invalid.`);
  }
  if (adapter.api.protocol === "json_async_poll" && (!adapter.response.jobIdPath || !adapter.response.statusPath)) throw new Error("Async custom providers require jobIdPath and statusPath.");
  adapter.response.resultUrlPaths = adapter.response.resultUrlPaths ?? [];
  adapter.response.inlineBase64Paths = adapter.response.inlineBase64Paths ?? [];
  if (!Array.isArray(adapter.response.resultUrlPaths) || adapter.response.resultUrlPaths.some((path) => !JSON_PATH_PATTERN.test(path))) throw new Error("Custom provider response resultUrlPaths are invalid.");
  if (!Array.isArray(adapter.response.inlineBase64Paths) || adapter.response.inlineBase64Paths.some((path) => !JSON_PATH_PATTERN.test(path))) throw new Error("Custom provider response inlineBase64Paths are invalid.");
  if (!adapter.response.resultUrlPaths.length && !adapter.response.inlineBase64Paths.length) throw new Error("Custom provider response requires resultUrlPaths or inlineBase64Paths.");
  if (adapter.response.inlineBase64Paths.length && !/^image\/(png|jpeg|webp)$|^video\/(mp4|webm|quicktime)$/.test(adapter.response.inlineMimeType ?? "")) throw new Error("Custom provider inline Base64 responses require a supported inlineMimeType.");
  adapter.response.inlineMimeType ??= adapter.model.mediaType === "image" ? "image/png" : "video/mp4";
  adapter.response.resultRequiresAuth = adapter.response.resultRequiresAuth === true;
  adapter.response.statusMap = plainRecord(adapter.response.statusMap);
  for (const canonical of Object.values(adapter.response.statusMap)) if (!CANONICAL_STATUSES.has(canonical)) throw new Error(`Custom provider statusMap contains unsupported canonical status: ${canonical}`);

  adapter.schemaVersion = "1.0";
  adapter.registeredAt = adapter.registeredAt ?? new Date().toISOString();
  return adapter;
}

function validateStaticHeaders(value) {
  const headers = plainRecord(value);
  for (const [name, content] of Object.entries(headers)) {
    if (!HEADER_NAME_PATTERN.test(name) || BLOCKED_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === "authorization" || /(api[-_]?key|token|secret|credential)/i.test(name)) throw new Error(`Custom provider static header is not allowed: ${name}`);
    if (typeof content !== "string" || content.length > 512 || /[\r\n]/.test(content)) throw new Error(`Custom provider static header value is invalid: ${name}`);
  }
  return headers;
}

function assertSafePublicHttps(value, field) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Custom provider ${field} must be a valid URL.`); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error(`Custom provider ${field} must use a credential-free HTTPS origin.`);
  if (host === "localhost" || host.endsWith(".local") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1") throw new Error(`Custom provider ${field} cannot target a local or private host.`);
}

function setTemplatePath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const current = cursor[part];
    if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current))) throw new Error(`Custom provider field mapping collides at ${path}.`);
    cursor = cursor[part] ??= {};
  }
  cursor[parts.at(-1)] = value;
}

function valueAtPath(value, path) {
  if (!path) return undefined;
  return path.split(".").reduce((cursor, part) => cursor?.[part], value);
}

function canonicalStatus(raw, statusMap) {
  if (!raw) return "running";
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (statusMap[raw] || statusMap[normalized]) return statusMap[raw] ?? statusMap[normalized];
  if (["succeeded", "success", "completed", "done", "ready"].includes(normalized)) return "succeeded";
  if (["failed", "error"].includes(normalized)) return "failed";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["queued", "pending", "created", "submitted"].includes(normalized)) return "queued";
  if (["input_required", "requires_input"].includes(normalized)) return "input_required";
  return "running";
}

function stringValues(value) {
  if (Array.isArray(value)) return value.flatMap(stringValues);
  return typeof value === "string" ? [value] : [];
}

function isHttpsUrl(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function plainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function integerInRange(value, minimum, maximum, field) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Custom provider ${field} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

function joinApiUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
