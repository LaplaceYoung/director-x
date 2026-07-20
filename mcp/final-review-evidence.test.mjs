import test from "node:test";
import assert from "node:assert/strict";
import { buildFinalReviewEvidence } from "./final-review-evidence.mjs";

function baseRun({ critical = false } = {}) {
  const finding = {
    findingId: "frame-audit:1", code: critical ? "decode_coverage" : "black_frame", severity: critical ? "critical" : "major",
    detectorDisposition: "pending", startFrame: 10, evidenceRefs: ["frame_audit_report.json", "frame_evidence/frame-audit-1-trigger.png"]
  };
  return {
    artifacts: {
      "delivery.video": { artifactRef: "delivery.video", path: "/project/final.mp4", sha256: "abc" },
      "frame_audit_report.json": { artifactRef: "frame_audit_report.json" },
      "frame_audit_repair_plan.json": { artifactRef: "frame_audit_repair_plan.json" },
      "frame_evidence/frame-audit-1-trigger.png": { artifactRef: "frame_evidence/frame-audit-1-trigger.png" }
    },
    frameAuditRepairPlan: { mediaSha256: "abc", findings: [finding], evidenceFrameCount: critical ? 0 : 1 },
    sceneCoverageConformanceReport: { status: "conformant", reportId: "scene-coverage-conformance:abc:sequence-1" },
    finalMediaReview: {
      deliveryTier: "review", rightsStatus: "project_generated", mockComponents: [], status: critical ? "repair_required" : "review_required", passed: false,
      blockers: [critical ? "frame_audit:frame_count_delta:-1" : "frame_audit:black_frames:1"],
      frameAudit: { blockers: [critical ? "frame_count_delta:-1" : "black_frames:1"], technicalBlockers: critical ? ["frame_count_delta:-1"] : [], passed: false }
    },
    avReviewTimeline: { timelineId: "review", markers: [{ id: "frame-audit:1", evidenceRefs: ["frame_audit_report.json"] }] }
  };
}

test("accepts intentional visual candidates only after evidence-backed DX review", () => {
  const result = buildFinalReviewEvidence(baseRun(), {
    reviewId: "review-1", reviewerId: "DX-Quality-Reviewer", mediaArtifactRef: "delivery.video", mediaSha256: "abc",
    frameAuditRef: "frame_audit_report.json", repairPlanRef: "frame_audit_repair_plan.json", decision: "accept", summary: "Intentional black transition.",
    dispositions: [{ findingId: "frame-audit:1", status: "intentional", reason: "Director.md declares a black transition.", evidenceRefs: ["frame_evidence/frame-audit-1-trigger.png"] }]
  });
  assert.equal(result.quality.passed, true);
  assert.equal(result.finalReview.approvedForUserReview, true);
  assert.equal(result.repairPlan.findings[0].detectorDisposition, "intentional");
  assert.equal(result.timeline.markers[0].reviewId, "review-1");
  assert.equal(result.deliveryManifest.deliveryStatus, "awaiting_user_approval");
});

test("keeps confirmed defects blocked and preserves the unresolved finding", () => {
  const result = buildFinalReviewEvidence(baseRun(), {
    reviewId: "review-2", reviewerId: "DX-Quality-Reviewer", mediaArtifactRef: "delivery.video", mediaSha256: "abc",
    frameAuditRef: "frame_audit_report.json", repairPlanRef: "frame_audit_repair_plan.json", decision: "repair_required", summary: "Unexpected black frame.",
    dispositions: [{ findingId: "frame-audit:1", status: "confirmed_defect", reason: "Not declared by the timeline or Director.md.", evidenceRefs: ["frame_evidence/frame-audit-1-trigger.png"] }]
  });
  assert.equal(result.quality.passed, false);
  assert.deepEqual(result.evidence.unresolvedFindingIds, ["frame-audit:1"]);
  assert.equal(result.deliveryManifest.deliveryStatus, "repair_required");
});

test("does not allow a reviewer to dismiss critical decode coverage", () => {
  assert.throws(() => buildFinalReviewEvidence(baseRun({ critical: true }), {
    reviewId: "review-3", reviewerId: "DX-Quality-Reviewer", mediaArtifactRef: "delivery.video", mediaSha256: "abc",
    frameAuditRef: "frame_audit_report.json", repairPlanRef: "frame_audit_repair_plan.json", decision: "accept", summary: "Dismiss coverage.",
    dispositions: [{ findingId: "frame-audit:1", status: "false_positive", reason: "Attempted dismissal.", evidenceRefs: ["frame_audit_report.json"] }]
  }), /cannot be dismissed/);
});

test("keeps versioned reviewer evidence append-only", () => {
  const run = baseRun();
  run.artifacts["final_review_evidence/review-1.json"] = { artifactRef: "final_review_evidence/review-1.json" };
  assert.throws(() => buildFinalReviewEvidence(run, {
    reviewId: "review-1", reviewerId: "DX-Quality-Reviewer", mediaArtifactRef: "delivery.video", mediaSha256: "abc",
    frameAuditRef: "frame_audit_report.json", repairPlanRef: "frame_audit_repair_plan.json", decision: "accept", summary: "Attempt overwrite.",
    dispositions: [{ findingId: "frame-audit:1", status: "intentional", reason: "Existing review ID.", evidenceRefs: ["frame_evidence/frame-audit-1-trigger.png"] }]
  }), /cannot be overwritten/);
});
