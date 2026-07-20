import test from "node:test";
import assert from "node:assert/strict";
import { beginCreativeWork, evaluateCreativeProgressSla, evaluateFastStartReadiness } from "./fast-start-policy.mjs";

function readyRun() {
  const requiredOutputs = ["intake_confirmation.json", "intent_resolution.json", "Director.md", "director_contract.json", "project_brief.json", "delivery_promise.json", "production_complexity_plan.json"];
  return {
    goal: { boundAt: "2026-07-20T00:00:00.000Z" }, intakeGate: { ready: true },
    pipeline: { id: "reference-remix", stages: [{ id: "intake", requiredOutputs, deferredOutputs: ["execution_graph.json"] }] },
    productionComplexityPlan: { settings: { firstKeyframeTargetMinutes: 10, targetFirstPreviewMinutes: 15 } },
    approvals: ["budget", "image_model", "video_model", "voice_model"].map((kind) => ({ kind, status: "approved" })),
    artifacts: Object.fromEntries(requiredOutputs.map((ref) => [ref, { artifactRef: ref }])), references: []
  };
}

test("allows creative work before deferred governance artifacts exist", () => {
  const run = readyRun();
  const readiness = evaluateFastStartReadiness(run);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.deferredUntilGeneration, ["execution_graph.json"]);
  const started = beginCreativeWork(run, "2026-07-20T00:05:00.000Z");
  assert.equal(started.creativeAssetSlaMinutes, 5);
});

test("requires reference consent only when a reference is actually registered", () => {
  const run = readyRun();
  run.references = [{ referenceId: "ref-1", sourceUrl: "https://example.com/video" }];
  assert.equal(evaluateFastStartReadiness(run).nextTool, "directorx_create_and_ask_native_question");
  run.referenceDownloadConsent = { decision: "authorized" };
  assert.equal(evaluateFastStartReadiness(run).ready, true);
});

test("raises a five-minute creative-output breach and clears it after a real asset appears", () => {
  const run = readyRun();
  beginCreativeWork(run, "2026-07-20T00:00:00.000Z");
  assert.equal(evaluateCreativeProgressSla(run, "2026-07-20T00:04:59.000Z").status, "on_track");
  assert.equal(evaluateCreativeProgressSla(run, "2026-07-20T00:05:01.000Z").status, "breached");
  run.artifacts["first-keyframe.png"] = { mediaKind: "image", path: "/tmp/first-keyframe.png" };
  assert.equal(evaluateCreativeProgressSla(run, "2026-07-20T00:06:00.000Z").status, "satisfied");
});
