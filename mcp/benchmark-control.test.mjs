import test from "node:test";
import assert from "node:assert/strict";
import { compileBenchmarkReport, recordBenchmarkTrial, registerBenchmarkSuite } from "./benchmark-control.mjs";

const fixture = { fixtureId: "f1", objective: "Produce a coherent product clip", expectedArtifactRefs: ["clip.mp4"], programmaticChecks: ["playable", "duration"], expertRubric: [{ dimensionId: "story", weight: 0.4, minimumScore: 0.7 }, { dimensionId: "continuity", weight: 0.6, minimumScore: 0.7 }], maxCost: 10, maxLatencyMs: 60000 };
const results = [{ checkId: "playable", passed: true, evidenceRefs: ["probe"] }, { checkId: "duration", passed: true, evidenceRefs: ["probe"] }];
const state = () => ({ capabilityRoute: { capabilities: [{ id: "video.text_to_video" }] }, productionLineage: { l1: {} }, artifacts: { "clip.mp4": {} }, benchmarkVerifierReceipts: { vr1: { receiptId: "vr1", suiteId: "s1", fixtureId: "f1", results } } });

test("runs evidence-backed benchmark trials and detects regression", () => {
  const run = state(); registerBenchmarkSuite(run, { suiteId: "s1", version: "1", taskFamily: "generation", capabilityIds: ["video.text_to_video"], fixtures: [fixture] });
  for (let index = 0; index < 20; index++) recordBenchmarkTrial(run, { trialId: `t${index}`, suiteId: "s1", fixtureId: "f1", lineageBindingIds: ["l1"], outputArtifactRefs: ["clip.mp4"], verifierReceiptId: "vr1", rubricScores: [{ dimensionId: "story", score: 0.7, evidenceRefs: ["review"] }, { dimensionId: "continuity", score: 0.8, evidenceRefs: ["review"] }], actualCost: 2, latencyMs: 1000 });
  const report = compileBenchmarkReport(run, { suiteId: "s1", reportId: "r1", minimumTrials: 20, regressionTolerance: 0.05, maxConfidenceWidth: 1, baseline: { reportId: "old", passRate: 1, meanScore: 0.9 } });
  assert.equal(run.benchmarkTrials[0].status, "passed"); assert.equal(report.status, "regressed"); assert.deepEqual(report.regressions.map((item) => item.metric), ["mean_score"]);
});

test("fails closed on missing evidence and unrouted capabilities", () => {
  const run = state(); assert.throws(() => registerBenchmarkSuite(run, { suiteId: "x", version: "1", taskFamily: "generation", capabilityIds: ["video.unknown"], fixtures: [fixture] }), /not routed/);
  registerBenchmarkSuite(run, { suiteId: "s1", version: "1", taskFamily: "generation", capabilityIds: ["video.text_to_video"], fixtures: [fixture] });
  assert.throws(() => recordBenchmarkTrial(run, { trialId: "t", suiteId: "s1", fixtureId: "f1", lineageBindingIds: ["l1"], outputArtifactRefs: ["clip.mp4"], verifierReceiptId: "missing", rubricScores: [], actualCost: 1, latencyMs: 1 }), /plugin-executed/);
});
