import test from "node:test";
import assert from "node:assert/strict";
import { planProductionComplexity } from "./production-complexity.mjs";

test("keeps a simple 15-second film on the quick path without weakening final QA", () => {
  const plan = planProductionComplexity({ durationSeconds: 15, shotCount: 4, segmentCount: 1, referenceVideoCount: 0, modalities: ["image", "voice", "music"], characterContinuity: false, deliveryTier: "review" });
  assert.equal(plan.profile, "quick");
  assert.equal(plan.settings.maxConcurrency, 2);
  assert.equal(plan.settings.maxSubagentTasksPerStage, 2);
  assert.equal(plan.settings.stageExecution, "compressed_passes");
  assert.equal(plan.settings.firstPreviewStrategy, "one_director_pass_one_generation_pass");
  assert.ok(plan.invariants.includes("full decoded-frame audit remains required before delivery"));
});

test("promotes reference-driven long and continuity-sensitive work to complex", () => {
  const plan = planProductionComplexity({ durationSeconds: 120, shotCount: 20, segmentCount: 12, referenceVideoCount: 2, modalities: ["image", "video", "voice", "music"], characterContinuity: true, deliveryTier: "publish" });
  assert.equal(plan.profile, "complex");
  assert.equal(plan.settings.maxConcurrency, 6);
  assert.equal(plan.settings.candidateCapPerShot, 4);
});
