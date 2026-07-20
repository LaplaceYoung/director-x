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
  run.videoEvidenceQueries[plan.queryId] = { plan: { schemaVersion: "1.0", ...plan }, trace: null, evidenceBundle: null, status: "planned", updatedAt: new Date().toISOString() };
  return run.videoEvidenceQueries[plan.queryId];
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

export async function writeMediaEvidenceArtifacts({ projectPath, runId, index, query }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const suffix = safeToken(index?.indexId ?? query?.plan.queryId);
  const values = index ? { "media_evidence_index.json": index, [`media_evidence_index.${suffix}.json`]: index } : {
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
