import test from "node:test";
import assert from "node:assert/strict";
import { compileReferenceReplicationReview, REPLICATION_DIMENSIONS } from "./reference-replication-review.mjs";

function run() {
  return {
    references: [{
      referenceId: "ref-1",
      rightsStatus: "reference_only",
      clipArtifactRef: "reference:ref-1:video",
      audioArtifactRef: "reference:ref-1:audio",
      fullFrameManifestArtifactRef: "reference:ref-1:full-frame-manifest",
      frameIdentityArtifactRef: "reference_frame_identity.ref-1.jsonl"
    }],
    artifacts: {
      "output:final.mp4": { artifactRef: "output:final.mp4", mediaKind: "video" },
      "frame_audit_report.json": { artifactRef: "frame_audit_report.json" },
      "final_review.json": { artifactRef: "final_review.json" }
    }
  };
}

function input(decision = "pass_export") {
  return {
    reportId: "replication-review-1",
    referenceId: "ref-1",
    reviewerId: "DX-Quality-Reviewer",
    outputArtifactRef: "output:final.mp4",
    differenceMethod: "time-aligned frame and audio-energy comparison",
    evidenceRefs: ["frame_audit_report.json", "final_review.json"],
    scores: Object.fromEntries(REPLICATION_DIMENSIONS.map((dimension) => [dimension, 0.86])),
    decision,
    rationale: "The output preserves the approved structure and pacing while changing the source identity."
  };
}

test("compiles a difference report and allows a passing export", () => {
  const report = compileReferenceReplicationReview(run(), input());
  assert.equal(report.comparison.mode, "difference");
  assert.equal(report.weightedScore, 0.86);
  assert.equal(report.recommendation, "pass_export");
  assert.equal(report.nextAction, "directorx_record_decision(delivery)");
});

test("forces regeneration when a replication dimension is weak", () => {
  const review = input("regenerate");
  review.scores.audio = 0.42;
  const report = compileReferenceReplicationReview(run(), review);
  assert.deepEqual(report.weakDimensions, ["audio"]);
  assert.equal(report.recommendation, "regenerate");
  assert.equal(report.nextAction, "directorx_compile_generation_repair");
  assert.throws(() => compileReferenceReplicationReview(run(), { ...review, decision: "pass_export" }), /below the/);
});

test("requires exhaustive audit evidence before scoring", () => {
  const state = run();
  delete state.artifacts["frame_audit_report.json"];
  assert.throws(() => compileReferenceReplicationReview(state, input()), /exhaustive frame audit/);
});
