import test from "node:test";
import assert from "node:assert/strict";
import { finalizeEvidenceBundle, recordVideoEvidenceSearch, recordVideoRetrievalTrace, registerMediaEvidenceIndex, registerVideoQueryPlan, searchMediaEvidence } from "./media-evidence.mjs";

const index = { indexId: "idx-1", source: { assetId: "asset-1", uri: "asset://asset-1", sha256: "a".repeat(64), duration: { value: 1800, rate: 30 } }, timebase: { rate: { num: 30000, den: 1001 }, startTimecode: "00:00:00:00" }, levels: [{ level: "shot", nodes: [{ nodeId: "shot-1", range: { start: { value: 300, rate: 30 }, duration: { value: 150, rate: 30 } }, modalities: ["vision", "speech"], observations: [{ kind: "action", value: "robot presents product", confidence: .9 }], evidenceRefs: ["frame://asset-1/12"] }] }], analyzers: [{ name: "shot-indexer", version: "1", configHash: "cfg" }] };
const plan = { queryId: "q1", indexId: "idx-1", question: "Find product proof", constraints: { shotFunction: "proof" }, strategy: ["semantic_recall", "local_inspection"], budget: { maxRounds: 2, maxFrames: 8, maxDecodeSeconds: 20, maxCost: .2 }, acceptance: { minEvidenceCoverage: .8, minTopScore: .7 } };
const trace = { queryId: "q1", rounds: [{ round: 1, informationGap: "Need visible proof", tool: "semantic_recall", candidateNodeIds: ["shot-1"], newEvidenceRefs: ["frame://asset-1/12"], framesInspected: 2, decodeSeconds: 5, cost: .02, coverageDelta: .9, decision: "stop" }], selectedNodeIds: ["shot-1"], rejectedNodeIds: [], conflicts: [], stopReason: "evidence_sufficient" };

test("registers a bounded evidence query and claim bundle", () => {
  const run = {};
  registerMediaEvidenceIndex(run, index); registerVideoQueryPlan(run, plan); recordVideoRetrievalTrace(run, trace);
  const bundle = finalizeEvidenceBundle(run, { bundleId: "bundle-1", queryId: "q1", claim: "Shot proves product interaction", support: [{ nodeId: "shot-1", evidenceRefs: ["frame://asset-1/12"] }], contradictions: [], coverage: .9, limitations: [], rightsStatus: "user_owned" });
  assert.equal(run.videoEvidenceQueries.q1.status, "complete");
  assert.equal(bundle.support[0].nodeId, "shot-1");
});

test("fails closed on unknown nodes and retrieval budget overruns", () => {
  const run = {}; registerMediaEvidenceIndex(run, index); registerVideoQueryPlan(run, plan);
  const over = structuredClone(trace); over.rounds[0].framesInspected = 9;
  assert.throws(() => recordVideoRetrievalTrace(run, over), /approved budget/);
  const unknown = structuredClone(trace); unknown.selectedNodeIds = ["missing"];
  assert.throws(() => recordVideoRetrievalTrace(run, unknown), /unknown result/);
});

test("searches indexed observations deterministically and keeps candidates separate from selected evidence", () => {
  const run = {};
  registerMediaEvidenceIndex(run, {
    ...index,
    levels: [{ level: "shot", nodes: [
      index.levels[0].nodes[0],
      { nodeId: "shot-2", range: { start: { value: 900, rate: 30 }, duration: { value: 120, rate: 30 } }, modalities: ["vision"], observations: [{ kind: "action", value: "wide landscape establishing view", confidence: .95 }], evidenceRefs: ["frame://asset-1/30"] }
    ] }]
  });
  registerVideoQueryPlan(run, plan);
  const result = searchMediaEvidence(run.mediaEvidenceIndexes["idx-1"], { query: "product proof", maxResults: 5 });
  assert.equal(result.searchKind, "deterministic_observation_lexical");
  assert.equal(result.candidates[0].nodeId, "shot-1");
  assert.ok(result.candidates[0].score > 0.5);
  assert.equal(result.candidates[0].startSeconds, 10);

  const record = recordVideoEvidenceSearch(run, { searchId: "search-1", queryId: "q1", result });
  assert.equal(record.round, 1);
  assert.equal(run.videoEvidenceQueries.q1.status, "searching");
  assert.deepEqual(run.videoEvidenceQueries.q1.trace, null);
  assert.equal(searchMediaEvidence(run.mediaEvidenceIndexes["idx-1"], { query: "product", level: "program" }).candidates.length, 0);
});
