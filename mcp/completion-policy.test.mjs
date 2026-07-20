import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRunCompletion } from "./completion-policy.mjs";

function baseRun() {
  return {
    status: "ready",
    pipeline: {
      stageStates: Object.fromEntries(["intake", "research", "script", "storyboard", "generation", "edit", "review", "delivery"].map((stage) => [stage, { status: "complete" }]))
    },
    approvals: [
      { kind: "budget", status: "approved" },
      { kind: "image_model", status: "approved" },
      { kind: "video_model", status: "approved" },
      { kind: "voice_model", status: "approved" },
      { kind: "delivery", status: "approved" }
    ],
    decisions: [{ kind: "delivery", value: { acceptedTier: "review" } }],
    finalMediaReview: { passed: true, deliveryTier: "review", blockers: [], mediaArtifactRef: "final-video.mp4", mediaSha256: "a".repeat(64) },
    sceneCoverageConformanceReport: { status: "conformant", reportId: "scene-coverage-conformance:abc:sequence-1" },
    finalReviewEvidence: { reviewId: "review-1", reviewerId: "DX-Quality-Reviewer", decision: "accept", mediaArtifactRef: "final-video.mp4", mediaSha256: "a".repeat(64) },
    deliveryManifest: { finalVideoArtifactRef: "final-video.mp4", finalVideoSha256: "a".repeat(64) },
    openCutEditor: { decision: { status: "skipped", confirmedBy: "request_user_input" }, activeSessionId: null, sessions: {} },
    artifacts: {
      "render_report.json": { mediaKind: "document" },
      "frame_audit_report.json": { mediaKind: "document" },
      "frame_identity.jsonl": { mediaKind: "document" },
      "frame_audit_repair_plan.json": { mediaKind: "document" },
      "scene_coverage_conformance_report.json": { mediaKind: "document" },
      "final_review_evidence.json": { mediaKind: "document" },
      "final_review.json": { mediaKind: "document" },
      "delivery_manifest.json": { mediaKind: "document" },
      "final-video.mp4": { artifactRef: "final-video.mp4", stage: "delivery", mediaKind: "video", sizeBytes: 100, sha256: "a".repeat(64) }
    }
  };
}

test("rejects planning documents as completion evidence for a requested video", () => {
  const run = baseRun();
  run.pipeline.stageStates = { intake: { status: "complete" }, research: { status: "complete" }, script: { status: "complete" } };
  run.artifacts = { "Director.md": { mediaKind: "document" }, "script_or_outline.json": { mediaKind: "document" } };
  run.approvals = [{ kind: "budget", status: "approved" }];
  const result = evaluateRunCompletion(run);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("pipeline_not_delivered"));
  assert.ok(result.blockers.includes("final_video_missing"));
  assert.ok(result.blockers.includes("final_delivery_approval_missing"));
});

test("accepts only a delivered, reviewed, user-approved playable video", () => {
  const result = evaluateRunCompletion(baseRun());
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

test("blocks technically playable media that failed visual or audio quality", () => {
  const run = baseRun();
  run.finalMediaReview = { passed: false, deliveryTier: "review", blockers: ["visual_diversity:1<4"] };
  const result = evaluateRunCompletion(run);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((blocker) => blocker.startsWith("final_media_quality_failed:")));
  assert.equal(result.nextAction.kind, "repair_final_media");
});

test("blocks a final review that points at a different media hash", () => {
  const run = baseRun();
  run.finalReviewEvidence = { ...run.finalReviewEvidence, mediaSha256: "b".repeat(64) };
  const result = evaluateRunCompletion(run);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("final_review_media_binding_mismatch"));
});

test("blocks a delivery manifest that points at a preview or stale render", () => {
  const run = baseRun();
  run.deliveryManifest = { finalVideoArtifactRef: "preview.mp4", finalVideoSha256: "b".repeat(64) };
  const result = evaluateRunCompletion(run);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("delivery_manifest_media_binding_mismatch"));
});

test("requires structured DX-Quality-Reviewer evidence before post-production approval", () => {
  const run = baseRun();
  run.finalReviewEvidence = null;
  delete run.artifacts["final_review_evidence.json"];
  const result = evaluateRunCompletion(run);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("final_reviewer_evidence_missing"));
  assert.equal(result.nextAction.kind, "record_final_review_evidence");
});

test("requires conformant final shot coverage before frame-finding acceptance", () => {
  const run = baseRun();
  run.sceneCoverageConformanceReport = { status: "awaiting_multimodal_review" };
  const result = evaluateRunCompletion(run);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("scene_coverage_conformance:awaiting_multimodal_review"));
  assert.equal(result.nextAction.kind, "record_scene_coverage_review");
});

test("requires the user approval to name the verified delivery tier", () => {
  const run = baseRun();
  run.decisions = [{ kind: "delivery", value: { acceptedTier: "preview" } }];
  const result = evaluateRunCompletion(run);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("final_delivery_tier_mismatch"));
});

test("requires a native post-production edit decision before final delivery", () => {
  const run = baseRun();
  run.openCutEditor = null;
  const result = evaluateRunCompletion(run);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("post_production_edit_decision_missing"));
  assert.equal(result.nextAction.kind, "request_user_input");
});

test("keeps completion blocked while an accepted manual edit session is active", () => {
  const run = baseRun();
  run.openCutEditor = { decision: { status: "accepted", confirmedBy: "request_user_input" }, activeSessionId: "dxe-1", sessions: { "dxe-1": { status: "running" } } };
  const result = evaluateRunCompletion(run);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("manual_edit_not_completed:running"));
  assert.equal(result.nextAction.kind, "continue_manual_edit");
});
