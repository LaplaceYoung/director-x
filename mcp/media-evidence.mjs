import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const LEVELS = ["program", "sequence", "scene", "shot", "moment"];
const STOP_REASONS = ["evidence_sufficient", "budget_exhausted", "no_new_evidence", "user_decision_required"];

export function registerMediaEvidenceIndex(run, index) {
  validateMediaEvidenceIndex(index);
  run.mediaEvidenceIndexes ??= {};
  const previous = run.mediaEvidenceIndexes[index.indexId];
  if (previous && previous.source.sha256 !== index.source.sha256) throw new Error("An evidence index ID cannot be reused for different source content.");
  run.mediaEvidenceIndexes[index.indexId] = { schemaVersion: "1.0", ...index, registeredAt: new Date().toISOString() };
  return run.mediaEvidenceIndexes[index.indexId];
}

export function registerVideoQueryPlan(run, plan) {
  const index = run.mediaEvidenceIndexes?.[plan.indexId];
  if (!index) throw new Error(`Register media evidence index ${plan.indexId} before its query plan.`);
  validateQueryPlan(plan);
  run.videoEvidenceQueries ??= {};
  if (run.videoEvidenceQueries[plan.queryId]) throw new Error(`Video query ${plan.queryId} already exists.`);
  run.videoEvidenceQueries[plan.queryId] = { plan: { schemaVersion: "1.0", ...plan }, searches: [], trace: null, evidenceBundle: null, status: "planned", updatedAt: new Date().toISOString() };
  return run.videoEvidenceQueries[plan.queryId];
}

/**
 * Search a registered index without rescanning or mutating source media.
 * This is intentionally deterministic and lexical: multimodal analyzers may add
 * richer observations later, while the plugin still has a useful local-first
 * retrieval path with an auditable score and explicit limitations.
 */
export function searchMediaEvidence(index, input = {}) {
  validateMediaEvidenceIndex(index);
  const query = String(input.query ?? input.question ?? "").trim();
  if (!query) throw new Error("Video evidence search requires a non-empty query.");
  const maxResults = boundedInteger(input.maxResults ?? 12, 1, 50, "Video evidence result bound");
  const requestedLevel = input.level == null ? null : String(input.level);
  if (requestedLevel && !LEVELS.includes(requestedLevel)) throw new Error(`Unsupported evidence search level: ${requestedLevel}`);
  const startSeconds = input.startSeconds == null ? null : finiteNonNegative(input.startSeconds, "Evidence search start");
  const endSeconds = input.endSeconds == null ? null : finiteNonNegative(input.endSeconds, "Evidence search end");
  if (startSeconds != null && endSeconds != null && endSeconds <= startSeconds) throw new Error("Evidence search end must be after start.");
  const queryTokens = tokenizeSearchText(query);
  const constraints = input.constraints && typeof input.constraints === "object" ? input.constraints : {};
  const constraintTokens = tokenizeSearchText(Object.values(constraints).flatMap((value) => Array.isArray(value) ? value : [value]).join(" "));
  const allTerms = [...new Set([...queryTokens, ...constraintTokens])];
  const nodes = index.levels.flatMap((level) => level.nodes.map((node) => ({ level: level.level, node })));
  const candidates = nodes
    .filter(({ level, node }) => requestedLevel == null || level === requestedLevel)
    .filter(({ node }) => overlapsSearchRange(node, startSeconds, endSeconds))
    .map(({ level, node }) => scoreEvidenceNode(level, node, allTerms, query))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.startSeconds - right.startSeconds || left.nodeId.localeCompare(right.nodeId))
    .slice(0, maxResults);
  return {
    searchKind: "deterministic_observation_lexical",
    query,
    indexId: index.indexId,
    sourceAssetId: index.source.assetId,
    maxResults,
    examinedNodeCount: nodes.length,
    totalMatchCount: candidates.length,
    candidates,
    limitations: ["Results match registered observations and metadata; they do not replace multimodal visual inspection.", "A candidate must be inspected and selected in a retrieval trace before supporting a production claim."]
  };
}

export function recordVideoEvidenceSearch(run, search) {
  const query = run.videoEvidenceQueries?.[search.queryId];
  if (!query) throw new Error(`Register video query ${search.queryId} before searching.`);
  const index = run.mediaEvidenceIndexes?.[query.plan.indexId];
  if (!index) throw new Error(`Evidence index ${query.plan.indexId} is not registered.`);
  if (!search.result || search.result.indexId !== index.indexId) throw new Error("Video evidence search result does not match the query index.");
  const indexedNodeIds = new Set(index.levels.flatMap((level) => level.nodes.map((node) => node.nodeId)));
  for (const candidate of search.result.candidates ?? []) if (!indexedNodeIds.has(candidate.nodeId) || !(candidate.score >= 0 && candidate.score <= 1) || !(candidate.startSeconds >= 0) || !(candidate.durationSeconds > 0)) throw new Error("Video evidence search contains an invalid or unindexed candidate.");
  const searchId = safeToken(search.searchId);
  if (query.searches?.some((item) => item.searchId === searchId)) throw new Error(`Video evidence search ${searchId} already exists.`);
  const roundsUsed = query.searches?.length ?? 0;
  if (roundsUsed >= query.plan.budget.maxRounds) throw new Error("Video evidence search exceeds the approved round budget.");
  const record = { schemaVersion: "1.0", searchId, queryId: search.queryId, result: search.result, round: roundsUsed + 1, createdAt: new Date().toISOString() };
  query.searches ??= [];
  query.searches.push(record);
  if (query.status === "planned") query.status = "searching";
  query.updatedAt = record.createdAt;
  return record;
}

export function recordVideoRetrievalTrace(run, trace) {
  const query = run.videoEvidenceQueries?.[trace.queryId];
  if (!query) throw new Error(`Register video query ${trace.queryId} before its retrieval trace.`);
  validateRetrievalTrace(trace, query.plan, run.mediaEvidenceIndexes[query.plan.indexId]);
  query.trace = { schemaVersion: "1.0", ...trace };
  query.status = trace.stopReason === "evidence_sufficient" ? "evidence_ready" : trace.stopReason === "user_decision_required" ? "input_required" : "stopped";
  query.updatedAt = new Date().toISOString();
  return query;
}

export function finalizeEvidenceBundle(run, bundle) {
  const query = run.videoEvidenceQueries?.[bundle.queryId];
  if (!query?.trace) throw new Error(`Record retrieval trace for ${bundle.queryId} before its evidence bundle.`);
  if (!bundle.bundleId || !bundle.claim || !Array.isArray(bundle.support) || !bundle.support.length) throw new Error("Evidence bundle requires bundleId, claim, and support.");
  const selected = new Set(query.trace.selectedNodeIds);
  for (const item of bundle.support) if (!selected.has(item.nodeId)) throw new Error(`${item.nodeId} is not a selected retrieval result.`);
  if (!(bundle.coverage >= 0 && bundle.coverage <= 1) || !bundle.rightsStatus) throw new Error("Evidence bundle requires bounded coverage and rightsStatus.");
  query.evidenceBundle = { schemaVersion: "1.0", ...bundle, createdAt: new Date().toISOString() };
  query.status = "complete";
  query.updatedAt = new Date().toISOString();
  return query.evidenceBundle;
}

export async function writeMediaEvidenceArtifacts({ projectPath, runId, index, query, search }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const suffix = safeToken(index?.indexId ?? query?.plan.queryId ?? search?.searchId);
  const values = index ? { "media_evidence_index.json": index, [`media_evidence_index.${suffix}.json`]: index } : search ? {
    [`video_search_results.${suffix}.json`]: search
  } : {
    "video_query_plan.json": query.plan, [`video_query_plan.${suffix}.json`]: query.plan,
    ...(query.trace ? { "retrieval_trace.json": query.trace, [`retrieval_trace.${suffix}.json`]: query.trace } : {}),
    ...(query.evidenceBundle ? { "evidence_bundle.json": query.evidenceBundle, [`evidence_bundle.${suffix}.json`]: query.evidenceBundle } : {})
  };
  const written = {};
  for (const [artifactRef, value] of Object.entries(values)) {
    const path = join(directory, artifactRef); await writeFile(path, `${JSON.stringify({ runId, ...value }, null, 2)}\n`, { mode: 0o600 }); written[artifactRef] = { artifactRef, path };
  }
  return written;
}

function safeToken(value) { const token = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 80); if (!token) throw new Error("Evidence artifact identifier is required."); return token; }

export function validateMediaEvidenceIndex(index) {
  if (!index?.indexId || !index.source?.assetId || !index.source?.uri || !/^[a-f0-9]{64}$/i.test(index.source.sha256 ?? "") || !validRationalTime(index.source.duration, false)) throw new Error("Evidence index requires a source asset, URI, SHA-256, and rational duration.");
  if (!(index.timebase?.rate?.num > 0) || !(index.timebase?.rate?.den > 0) || !Array.isArray(index.levels) || !index.levels.length || !Array.isArray(index.analyzers) || !index.analyzers.length) throw new Error("Evidence index requires a rational timebase, levels, and analyzer lineage.");
  const nodes = new Map();
  for (const level of index.levels) {
    if (!LEVELS.includes(level.level) || !Array.isArray(level.nodes)) throw new Error(`Unsupported evidence index level: ${level.level}`);
    for (const node of level.nodes) {
      if (!node.nodeId || nodes.has(node.nodeId) || !validRationalTime(node.range?.start, true) || !validRationalTime(node.range?.duration, false) || rationalSeconds(node.range.start) + rationalSeconds(node.range.duration) > rationalSeconds(index.source.duration) + 1e-9) throw new Error("Evidence nodes require unique IDs and source-contained rational ranges.");
      if (!Array.isArray(node.modalities) || !node.modalities.length || !Array.isArray(node.observations) || !Array.isArray(node.evidenceRefs)) throw new Error(`${node.nodeId} requires modalities, observations, and evidence refs.`);
      for (const observation of node.observations) if (!observation.kind || observation.value === undefined || !(observation.confidence >= 0 && observation.confidence <= 1)) throw new Error(`${node.nodeId} contains an invalid observation.`);
      nodes.set(node.nodeId, node);
    }
  }
  for (const node of nodes.values()) if (node.parentId && !nodes.has(node.parentId)) throw new Error(`${node.nodeId} references missing parent ${node.parentId}.`);
}

function validRationalTime(value, allowZero) { return Number.isInteger(value?.value) && (allowZero ? value.value >= 0 : value.value > 0) && Number.isInteger(value?.rate) && value.rate > 0; }
export function rationalSeconds(value) { return Number(value.value) / Number(value.rate); }

function validateQueryPlan(plan) {
  if (!plan.queryId || !plan.question || !Array.isArray(plan.strategy) || !plan.strategy.length) throw new Error("Video query plan requires queryId, question, and strategy.");
  const budget = plan.budget ?? {};
  if (!Number.isInteger(budget.maxRounds) || budget.maxRounds < 1 || budget.maxRounds > 20 || !Number.isInteger(budget.maxFrames) || budget.maxFrames < 1 || budget.maxFrames > 500 || !(budget.maxDecodeSeconds > 0) || budget.maxDecodeSeconds > 3600 || !(budget.maxCost >= 0)) throw new Error("Video query plan requires bounded rounds, frames, decode time, and cost.");
  if (!(plan.acceptance?.minEvidenceCoverage >= 0 && plan.acceptance.minEvidenceCoverage <= 1) || !(plan.acceptance?.minTopScore >= 0 && plan.acceptance.minTopScore <= 1)) throw new Error("Video query acceptance thresholds must be between zero and one.");
}

function scoreEvidenceNode(level, node, terms, query) {
  const observations = node.observations.map((observation) => ({ kind: String(observation.kind), value: String(observation.value) }));
  const searchable = [node.nodeId, level, ...(node.modalities ?? []), ...observations.flatMap((item) => [item.kind, item.value])].join(" ");
  const searchableTokens = new Set(tokenizeSearchText(searchable));
  const matchedTerms = terms.filter((term) => searchableTokens.has(term));
  const phraseBonus = normalizeSearchText(searchable).includes(normalizeSearchText(query)) ? 0.18 : 0;
  const averageConfidence = observations.length ? observations.reduce((sum, item) => sum + Number(node.observations.find((candidate) => String(candidate.kind) === item.kind && String(candidate.value) === item.value)?.confidence ?? 0), 0) / observations.length : 0;
  const lexical = terms.length ? matchedTerms.length / terms.length : 0;
  const score = Math.min(1, 0.62 * lexical + 0.2 * averageConfidence + 0.18 * (matchedTerms.length ? 1 : 0) + phraseBonus);
  return {
    nodeId: node.nodeId,
    parentId: node.parentId ?? null,
    level,
    score: round(score),
    matchedTerms,
    confidence: round(averageConfidence),
    startSeconds: round(rationalSeconds(node.range.start)),
    durationSeconds: round(rationalSeconds(node.range.duration)),
    modalities: node.modalities,
    observations,
    evidenceRefs: node.evidenceRefs
  };
}

function overlapsSearchRange(node, startSeconds, endSeconds) {
  const start = rationalSeconds(node.range.start);
  const end = start + rationalSeconds(node.range.duration);
  return (startSeconds == null || end > startSeconds) && (endSeconds == null || start < endSeconds);
}

function tokenizeSearchText(value) {
  const normalized = normalizeSearchText(value);
  const tokens = [];
  for (const part of normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? []) {
    if (/^[\u4e00-\u9fff]+$/.test(part)) {
      for (const character of part) tokens.push(character);
      for (let index = 0; index < part.length - 1; index += 1) tokens.push(part.slice(index, index + 2));
    } else tokens.push(part);
  }
  return [...new Set(tokens)];
}

function normalizeSearchText(value) { return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim(); }
function finiteNonNegative(value, label) { const result = Number(value); if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be finite and non-negative.`); return result; }
function boundedInteger(value, minimum, maximum, label) { const result = Number(value); if (!Number.isInteger(result) || result < minimum || result > maximum) throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`); return result; }
function round(value) { return Math.round(value * 1000) / 1000; }

function validateRetrievalTrace(trace, plan, index) {
  if (!Array.isArray(trace.rounds) || !trace.rounds.length || !STOP_REASONS.includes(trace.stopReason)) throw new Error("Retrieval trace requires rounds and a supported stop reason.");
  if (trace.rounds.length > plan.budget.maxRounds) throw new Error("Retrieval trace exceeds maxRounds.");
  const nodeIds = new Set(index.levels.flatMap((level) => level.nodes.map((node) => node.nodeId)));
  let frames = 0, decode = 0, cost = 0;
  for (const [offset, round] of trace.rounds.entries()) {
    if (round.round !== offset + 1 || !round.informationGap || !round.tool || !Array.isArray(round.candidateNodeIds) || !Array.isArray(round.newEvidenceRefs)) throw new Error("Retrieval rounds must be ordered and evidence-facing.");
    for (const id of round.candidateNodeIds) if (!nodeIds.has(id)) throw new Error(`Retrieval round references unknown evidence node ${id}.`);
    frames += round.framesInspected ?? 0; decode += round.decodeSeconds ?? 0; cost += round.cost ?? 0;
  }
  if (frames > plan.budget.maxFrames || decode > plan.budget.maxDecodeSeconds || cost > plan.budget.maxCost + 1e-9) throw new Error("Retrieval trace exceeds its approved budget.");
  for (const id of [...(trace.selectedNodeIds ?? []), ...(trace.rejectedNodeIds ?? [])]) if (!nodeIds.has(id)) throw new Error(`Retrieval trace references unknown result ${id}.`);
  if (!Array.isArray(trace.conflicts)) throw new Error("Retrieval trace must preserve conflict evidence.");
}
