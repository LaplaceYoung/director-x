import { createHash, randomUUID } from "node:crypto";

export const NATIVE_INTERACTION_KINDS = Object.freeze([
  "goal_entry", "role_install", "run_mode", "intake", "pipeline", "budget",
  "image_model", "video_model", "voice_model", "music_strategy", "music_asset_selection", "music_route", "reference_download",
  "stage_approval", "provider_input", "post_production_edit", "edit_change", "candidate", "delivery", "knowledge"
]);

const INTERACTION_KIND_SET = new Set(NATIVE_INTERACTION_KINDS);
const QUESTION_ID = /^[a-z][a-z0-9_]{1,63}$/;
const STABLE_DECISION_KINDS = new Set([
  "run_mode", "intake", "pipeline", "budget", "image_model", "video_model",
  "voice_model", "music_strategy", "music_asset_selection", "music_route", "provider_input"
]);

export function requestNativeInteraction(run, input, now = new Date().toISOString()) {
  assertInteractionInput(input);
  const store = interactionStore(run);
  const gateKey = normalizedGateKey(input);
  const fingerprint = interactionFingerprint(input);
  const previous = [...store.history].reverse().find((item) => item.fingerprint === fingerprint && item.status === "resolved");
  if (previous) return { request: previous, hostAction: null, deduplicated: true };
  // Provider intake is often rebuilt after a runtime recovery or skill refresh.
  // Wording/recommended-label changes must not make the user answer the same
  // supplier/model question again. A caller can intentionally re-open it by
  // using a new gateKey (for example, a new provider job or route revision).
  if (STABLE_DECISION_KINDS.has(input.kind)) {
    const equivalent = [...store.history].reverse().find((item) => item.status === "resolved" && item.kind === input.kind && (item.gateKey ?? item.kind) === gateKey && sameQuestionIds(item.questions, input.questions));
    if (equivalent) return { request: equivalent, hostAction: null, deduplicated: true };
  }
  const pending = store.pending.find((item) => item.fingerprint === fingerprint);
  if (pending) return { request: pending, hostAction: hostAction(pending), deduplicated: true };
  const sameKind = store.pending.find((item) => item.kind === input.kind && (item.gateKey ?? item.kind) === gateKey);
  const request = {
    schemaVersion: "1.0",
    requestId: `dxq-${randomUUID()}`,
    runId: run.runId,
    kind: input.kind,
    gateKey,
    reason: input.reason.trim(),
    questions: structuredClone(input.questions),
    fingerprint,
    status: "pending",
    interactionSurface: "codex_request_user_input",
    createdAt: now,
    updatedAt: now
  };
  if (sameKind) {
    sameKind.status = "superseded";
    sameKind.updatedAt = now;
    sameKind.supersededAt = now;
    sameKind.supersededBy = request.requestId;
    request.supersedes = sameKind.requestId;
    store.pending = store.pending.filter((item) => item.requestId !== sameKind.requestId);
    store.history.push(sameKind);
  }
  store.pending.push(request);
  return { request, hostAction: hostAction(request), deduplicated: false, supersededRequestId: sameKind?.requestId ?? null };
}

export function resolveNativeInteraction(run, input, now = new Date().toISOString()) {
  if (input?.confirmedBy !== "request_user_input") throw new Error("Director X confirmations must be resolved through Codex request_user_input.");
  const store = interactionStore(run);
  const request = store.pending.find((item) => item.requestId === input.requestId);
  if (!request) {
    const historical = store.history.find((item) => item.requestId === input.requestId);
    if (historical?.status === "resolved") return historical;
    if (historical?.status === "superseded") {
      throw new Error(`Native interaction ${input.requestId} was superseded by ${historical.supersededBy}; resolve the replacement request instead.`);
    }
    throw new Error(`Unknown pending native interaction: ${input.requestId}`);
  }
  assertRawRequestUserInputEnvelope(request.questions, input.answers);
  const answers = normalizeNativeAnswers(request.questions, input.answers);
  for (const question of request.questions) {
    if (!String(answers[question.id] ?? "").trim()) throw new Error(`Missing request_user_input answer for ${question.id}.`);
  }
  request.status = "resolved";
  request.confirmedBy = "request_user_input";
  request.answers = structuredClone(answers);
  request.resolvedAt = now;
  request.updatedAt = now;
  store.pending = store.pending.filter((item) => item.requestId !== request.requestId);
  store.history.push(request);
  return request;
}

export function normalizeNativeAnswers(questions, input = {}) {
  const normalized = {};
  for (const question of questions ?? []) {
    const values = answerValues(input?.[question.id]);
    if (!values.length) throw new Error(`Missing request_user_input answer for ${question.id}.`);
    const options = question.options ?? [];
    const labels = new Set(options.map((option) => option.label));
    const hasExplicitCustomOption = options.some((option) => /其他|自定义|填写|custom|other/i.test(String(option.label ?? "")));
    const unmatched = values.filter((value) => !labels.has(value) && !/^\s*(Other|其他)\s*[:：]/i.test(value) && !hasExplicitCustomOption);
    if (unmatched.length) throw new Error(`request_user_input answer for ${question.id} must match one of the offered options or use the client Other option.`);
    normalized[question.id] = values.length === 1 ? values[0] : values;
  }
  return normalized;
}

export function requireResolvedInteraction(run, requestId, expectedKind) {
  const expectedKinds = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
  const label = expectedKinds.filter(Boolean).join(" or ");
  if (!requestId) throw new Error(`${label} requires an interactionRequestId resolved through Codex request_user_input.`);
  const request = interactionStore(run).history.find((item) => item.requestId === requestId && item.status === "resolved");
  if (!request) throw new Error(`Resolve native interaction ${requestId} through Codex request_user_input before ${label}.`);
  if (expectedKinds.some(Boolean) && !expectedKinds.includes(request.kind)) throw new Error(`Interaction ${requestId} is ${request.kind}, not ${label}.`);
  return request;
}

function interactionStore(run) {
  run.interactions ??= { pending: [], history: [] };
  run.interactions.pending ??= [];
  run.interactions.history ??= [];
  return run.interactions;
}

function hostAction(request) {
  return { type: "host_tool", tool: "request_user_input", required: true, requestId: request.requestId, arguments: { questions: request.questions } };
}

function interactionFingerprint(input) {
  return createHash("sha256").update(JSON.stringify({
    kind: input.kind,
    gateKey: normalizedGateKey(input),
    reason: input.reason.trim(),
    questions: input.questions,
    scope: interactionScope(input)
  })).digest("hex");
}

function interactionScope(input) {
  return Object.fromEntries([
    ["sourceUrl", input.sourceUrl],
    ["sourceHash", input.sourceHash],
    ["referenceId", input.referenceId],
    ["candidateId", input.candidateId],
    ["mediaArtifactRef", input.mediaArtifactRef],
    ["mediaSha256", input.mediaSha256],
    ["stageId", input.stageId]
  ].filter(([, value]) => value != null && String(value).trim() !== ""));
}

function assertInteractionInput(input) {
  if (!INTERACTION_KIND_SET.has(input?.kind)) throw new Error(`Unsupported native interaction kind: ${input?.kind}`);
  if (!String(input.reason ?? "").trim()) throw new Error("Native interaction reason is required.");
  if (input.gateKey != null && !/^[A-Za-z0-9._:-]{1,120}$/.test(input.gateKey)) throw new Error("Native interaction gateKey contains unsupported characters.");
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 3) throw new Error("Native interaction requires one to three questions.");
  const ids = new Set();
  for (const question of input.questions) {
    if (!QUESTION_ID.test(question?.id ?? "") || ids.has(question.id)) throw new Error("Question IDs must be unique snake_case identifiers.");
    ids.add(question.id);
    if (!String(question.header ?? "").trim() || !String(question.question ?? "").trim()) throw new Error(`${question.id} requires a header and question.`);
    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 3) throw new Error(`${question.id} requires two or three options.`);
    for (const option of question.options) if (!String(option?.label ?? "").trim() || !String(option?.description ?? "").trim()) throw new Error(`${question.id} options require labels and tradeoff descriptions.`);
  }
}

function normalizedGateKey(input) {
  const value = input.gateKey ?? input.kind;
  // Keep compatibility with the short-lived `*-v2` provider intake keys that
  // shipped during the custom-adapter migration.
  return input.kind === "provider_input" ? value.replace(/-v\d+$/i, "") : value;
}

function sameQuestionIds(left = [], right = []) {
  const a = left.map((item) => item?.id).filter(Boolean).sort();
  const b = right.map((item) => item?.id).filter(Boolean).sort();
  return a.length > 0 && a.length === b.length && a.every((id, index) => id === b[index]);
}

function assertRawRequestUserInputEnvelope(questions, answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new Error("Director X requires the raw request_user_input answer envelope.");
  }
  for (const question of questions ?? []) {
    const entry = answers[question.id];
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !Array.isArray(entry.answers)) {
      throw new Error(`Director X requires the raw request_user_input answer envelope for ${question.id}.`);
    }
  }
}

function answerValues(value) {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(answerValues);
  if (value && typeof value === "object") {
    if (Object.hasOwn(value, "answers")) return answerValues(value.answers);
    if (Object.hasOwn(value, "answer")) return answerValues(value.answer);
  }
  return [];
}
