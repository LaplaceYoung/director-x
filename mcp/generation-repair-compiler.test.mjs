import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileGenerationRepairPlan, writeGenerationRepairArtifacts } from "./generation-repair-compiler.mjs";

function fixture(overrides = {}) {
  const request = {
    requestId: "REQ-1", shotId: "S01", mode: "image_to_video", durationSeconds: 5,
    promptLayers: { action: "the hand places the product on the table" }, negativeConstraints: ["warped hands"],
    inputAnchorAssets: ["asset:product"], carryForwardRules: ["preserve product geometry"],
    maxAttempts: 3, attemptCount: 1, maxCost: 3, spent: 1, attemptCostCap: 1
  };
  const candidate = {
    requestId: "REQ-1", attemptId: "ATT-1", candidateId: "CAN-1", mediaType: "video", status: "needs_action",
    decision: "retry", reviewedAt: "2026-07-21T00:00:00.000Z", reviewReason: "Product shape drifts after contact.",
    failureType: "identity_drift", qualityScore: 0.66, criticalFloor: 0.4,
    scores: { promptMatch: 0.8, visualQuality: 0.7, continuity: 0.4, motion: 0.8, editFit: 0.8, worldConsistency: 0.6, actionCompleteness: 0.8 },
    evidence: [{ frameRef: "frame:2.5", timeSeconds: 2.5, dimension: "continuity", observation: "geometry changes" }],
    defects: [{ code: "product_mismatch", severity: "major", timeSeconds: 2.5, description: "Product shape drifts", repairAction: "repair" }]
  };
  return {
    generation: { providerId: "openai", modelId: "sora-2", requests: [{ ...request, ...(overrides.request ?? {}) }], candidates: [{ ...candidate, ...(overrides.candidate ?? {}) }] },
    generationRepairs: overrides.generationRepairs ?? {}
  };
}

test("compiles one evidence-bound identity repair without changing accepted dimensions", () => {
  const plan = compileGenerationRepairPlan(fixture(), { repairId: "repair-1", requestId: "REQ-1", candidateId: "CAN-1" });
  assert.equal(plan.diagnosis.primaryDefect, "identity_or_geometry");
  assert.equal(plan.repair.controlVariable, "primary_identity_or_geometry_reference");
  assert.equal(plan.repair.referencePatch.operation, "strengthen_role");
  assert.equal(plan.repair.promptPatch, null);
  assert.deepEqual(plan.diagnosis.evidenceRefs, ["frame:2.5"]);
  assert.ok(plan.invariantContract.preservedDimensions.includes("motion"));
  assert.equal(plan.execution.nextTool, "directorx_begin_generation_attempt");
});

test("routes exact text defects to deterministic composition without spending another draw", () => {
  const run = fixture({ candidate: { failureType: "text_artifacts", mediaType: "image" } });
  const plan = compileGenerationRepairPlan(run, { repairId: "repair-text", requestId: "REQ-1", candidateId: "CAN-1" });
  assert.equal(plan.repair.action, "compose_deterministic_overlay");
  assert.equal(plan.repair.generationRequired, false);
  assert.equal(plan.repair.editPatch.operation, "overlay");
  assert.equal(plan.execution.nextTool, "directorx_compile_edit_graph");
});

test("stops paid retries when the attempt cap is exhausted", () => {
  const run = fixture({ request: { attemptCount: 3 }, candidate: { failureType: "motion_jitter" } });
  const plan = compileGenerationRepairPlan(run, { repairId: "repair-budget", requestId: "REQ-1", candidateId: "CAN-1" });
  assert.equal(plan.repair.action, "stop_or_request_budget_change");
  assert.equal(plan.execution.requiresNativeApproval, true);
  assert.equal(plan.budget.attemptsRemaining, 0);
});

test("uses positive-only prompt repair for FLUX routes", () => {
  const run = fixture({ candidate: { failureType: "composition" } });
  run.generation.providerId = "black-forest-labs";
  run.generation.modelId = "flux-2-pro";
  const plan = compileGenerationRepairPlan(run, { repairId: "repair-flux", requestId: "REQ-1", candidateId: "CAN-1" });
  assert.equal(plan.route.promptDialect, "flux2_subject_first_positive_constraints");
  assert.match(plan.repair.promptPatch.positiveDelta, /positive desired-state language/);
  assert.equal(plan.repair.promptPatch.negativeDelta, null);
});

test("routes impossible boundary motion back to shot design", () => {
  const run = fixture({ candidate: { failureType: "boundary_teleport" } });
  const plan = compileGenerationRepairPlan(run, { repairId: "repair-boundary", requestId: "REQ-1", candidateId: "CAN-1" });
  assert.equal(plan.repair.structuralPatch.operation, "bridge_or_split");
  assert.equal(plan.repair.generationRequired, false);
  assert.equal(plan.execution.nextTool, "directorx_review_shot_sequence");
});

test("rejects visual repairs without inspected evidence", () => {
  const run = fixture({ candidate: { evidence: [], failureType: "composition" } });
  assert.throws(() => compileGenerationRepairPlan(run, { repairId: "repair-no-evidence", requestId: "REQ-1", candidateId: "CAN-1" }), /requires inspected candidate evidence/);
});

test("writes machine-readable and canvas-readable repair artifacts", async (t) => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-generation-repair-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(projectPath, { recursive: true, force: true })));
  const plan = compileGenerationRepairPlan(fixture(), { repairId: "repair-files", requestId: "REQ-1", candidateId: "CAN-1" });
  const written = await writeGenerationRepairArtifacts({ projectPath, runId: "dx-test", plan });
  assert.equal(JSON.parse(await readFile(written.json.path, "utf8")).repairId, "repair-files");
  assert.match(await readFile(written.summary.path, "utf8"), /唯一修改变量/);
});
