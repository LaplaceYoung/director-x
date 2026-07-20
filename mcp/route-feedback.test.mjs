import test from "node:test";
import assert from "node:assert/strict";
import { compileRouteFeedback, recordProviderCapacity, recordToolExecution } from "./route-feedback.mjs";

const run = () => ({ capabilityExecutionPlan: { planId: "plan:1", recommendedStrategy: "balanced", candidates: [{ strategy: "balanced", selections: [{ capabilityId: "video.text_to_video", toolId: "video-a", qualityScore: 0.9, estimatedCost: 2, latencyMsP50: 1000 }] }] }, productionLineage: { l1: { activity: { capabilityId: "video.text_to_video", toolId: "video-a" } } } });

test("records evidence-backed executions and proposes future-only knowledge patches", () => {
  const state = run();
  for (let index = 0; index < 2; index++) recordToolExecution(state, { executionId: `exec:${index}`, lineageBindingId: "l1", capabilityId: "video.text_to_video", toolId: "video-a", status: "succeeded", failureClass: "none", actualCost: 2.5, latencyMs: 1400, qualityScore: 0.7 + index * 0.1, reviewEvidenceRefs: [`shot-review:${index}`] });
  const { report, modelKnowledgePatch } = compileRouteFeedback(state, { reportId: "feedback:1", minimumSamples: 2 });
  assert.equal(report.metric, "empirical_regret_proxy_not_counterfactual_regret");
  assert.equal(report.toolSummaries[0].meanActualQuality, 0.75);
  assert.equal(modelKnowledgePatch.status, "review_required");
  assert.equal(modelKnowledgePatch.proposals[0].currentApprovedRouteImmutable, true);
});

test("requires review evidence and records provider capacity", () => {
  const state = run();
  assert.throws(() => recordToolExecution(state, { executionId: "x", lineageBindingId: "l1", capabilityId: "video.text_to_video", toolId: "video-a", status: "succeeded", failureClass: "none", actualCost: 1, latencyMs: 1, qualityScore: 0.9, reviewEvidenceRefs: [] }), /review evidence/);
  const capacity = recordProviderCapacity(state, { snapshotId: "cap:1", toolId: "video-a", state: "constrained", activeJobs: 4, maxConcurrentJobs: 5, queueDepth: 3, retryAfterSeconds: 10 });
  assert.equal(capacity.state, "constrained");
});
