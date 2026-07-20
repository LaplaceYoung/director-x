const REVIEWER_ID = "DX-Quality-Reviewer";
const DISPOSITIONS = new Set(["intentional", "false_positive", "confirmed_defect"]);
const DECISIONS = new Set(["accept", "repair_required", "rerender_required", "blocked"]);

export function buildFinalReviewEvidence(run, review) {
  if (!run.finalMediaReview || !run.frameAuditRepairPlan) throw new Error("Run final-media verification before recording DX-Quality-Reviewer evidence.");
  if (run.sceneCoverageConformanceReport?.status !== "conformant") throw new Error("Complete the identity-bound DX-Quality-Reviewer scene coverage review before recording final frame-audit acceptance.");
  if (!review?.reviewId || review.reviewerId !== REVIEWER_ID || !DECISIONS.has(review.decision) || !review.summary?.trim()) throw new Error("Final review evidence requires an ID, canonical DX-Quality-Reviewer identity, decision, and summary.");
  const versionedArtifactRef = finalReviewEvidenceArtifactRef(review.reviewId);
  if (run.artifacts?.[versionedArtifactRef]) throw new Error(`Final review ID already exists and cannot be overwritten: ${review.reviewId}`);
  const plan = run.frameAuditRepairPlan;
  const media = run.artifacts?.[review.mediaArtifactRef];
  if (!media || !review.mediaSha256 || media.sha256 !== review.mediaSha256 || plan.mediaSha256 && plan.mediaSha256 !== review.mediaSha256) throw new Error("Final review evidence must bind the exact registered media SHA-256 used by the frame audit.");
  if (run.finalMediaReview?.mediaArtifactRef && run.finalMediaReview.mediaArtifactRef !== review.mediaArtifactRef) throw new Error("Final review evidence must bind the media artifact already verified by the final quality gate.");
  if (run.finalMediaReview?.mediaSha256 && run.finalMediaReview.mediaSha256 !== review.mediaSha256) throw new Error("Final review evidence must bind the media SHA-256 already verified by the final quality gate.");
  if (review.frameAuditRef !== "frame_audit_report.json" || review.repairPlanRef !== "frame_audit_repair_plan.json") throw new Error("Final review evidence must bind the canonical frame-audit artifacts.");
  const dispositionById = new Map();
  for (const disposition of review.dispositions ?? []) {
    if (!disposition.findingId || dispositionById.has(disposition.findingId) || !DISPOSITIONS.has(disposition.status) || !disposition.reason?.trim() || !disposition.evidenceRefs?.length) throw new Error("Each finding requires one unique structured disposition with reason and evidence refs.");
    dispositionById.set(disposition.findingId, structuredClone(disposition));
  }
  const findingIds = new Set(plan.findings.map((finding) => finding.findingId));
  for (const id of dispositionById.keys()) if (!findingIds.has(id)) throw new Error(`Unknown frame-audit finding: ${id}`);
  for (const finding of plan.findings) {
    const disposition = dispositionById.get(finding.findingId);
    if (!disposition) throw new Error(`DX-Quality-Reviewer must disposition every finding: ${finding.findingId}`);
    for (const ref of disposition.evidenceRefs) if (!evidenceExists(run, ref)) throw new Error(`Review evidence is not registered in this Run: ${ref}`);
    if (finding.severity !== "critical" && finding.startFrame != null && !disposition.evidenceRefs.some((ref) => String(ref).startsWith("frame_evidence/"))) throw new Error(`Visual finding ${finding.findingId} requires an inspectable frame_evidence reference.`);
    if (finding.severity === "critical" && disposition.status !== "confirmed_defect") throw new Error(`Critical technical finding ${finding.findingId} cannot be dismissed as intentional or false positive.`);
  }
  const confirmed = [...dispositionById.values()].filter((item) => item.status === "confirmed_defect");
  if (review.decision === "accept" && confirmed.length) throw new Error("A final review with confirmed defects cannot be accepted.");
  if (review.decision === "accept" && plan.findings.some((finding) => finding.severity === "critical")) throw new Error("Critical technical findings require rerender or blocking, not acceptance.");
  if (review.decision === "repair_required" && !confirmed.length) throw new Error("repair_required needs at least one confirmed defect.");
  if (review.decision === "rerender_required" && !confirmed.some((item) => plan.findings.find((finding) => finding.findingId === item.findingId)?.severity === "critical")) throw new Error("rerender_required needs a confirmed critical/global finding.");

  const evidence = {
    schemaVersion: "1.0",
    versionedArtifactRef,
    reviewId: review.reviewId,
    reviewerId: REVIEWER_ID,
    mediaArtifactRef: review.mediaArtifactRef,
    mediaSha256: review.mediaSha256,
    frameAuditRef: review.frameAuditRef,
    repairPlanRef: review.repairPlanRef,
    inspectedFindingIds: plan.findings.map((finding) => finding.findingId),
    dispositions: plan.findings.map((finding) => dispositionById.get(finding.findingId)),
    decision: review.decision,
    summary: review.summary,
    unresolvedFindingIds: confirmed.map((item) => item.findingId),
    approvalBoundary: "Reviewer evidence may classify findings and propose repair. It cannot mutate the canonical timeline or grant final user approval.",
    reviewedAt: new Date().toISOString()
  };
  const updatedPlan = structuredClone(plan);
  updatedPlan.reviewEvidenceRef = versionedArtifactRef;
  updatedPlan.reviewId = review.reviewId;
  updatedPlan.findings = updatedPlan.findings.map((finding) => {
    const disposition = dispositionById.get(finding.findingId);
    return { ...finding, detectorDisposition: disposition.status, dispositionReason: disposition.reason, dispositionEvidenceRefs: disposition.evidenceRefs, reviewId: review.reviewId };
  });
  updatedPlan.status = review.decision === "accept" ? "review_accepted" : review.decision;
  const quality = applyDispositionsToQuality(run.finalMediaReview, updatedPlan, review.decision, versionedArtifactRef);
  if (review.decision === "accept" && !quality.passed) throw new Error(`Review acceptance cannot override non-review quality blockers: ${quality.blockers.join(", ")}`);
  const timeline = applyDispositionsToTimeline(run.avReviewTimeline, updatedPlan, review.reviewId, versionedArtifactRef);
  const finalReview = {
    schemaVersion: "1.1",
    reviewerId: REVIEWER_ID,
    reviewId: review.reviewId,
    mediaArtifactRef: review.mediaArtifactRef,
    mediaSha256: review.mediaSha256,
    technicalPlaybackPassed: true,
    deliveryTier: quality.deliveryTier,
    rightsStatus: quality.rightsStatus,
    mockComponents: quality.mockComponents,
    qualityGate: quality,
    frameAuditRepairPlanRef: "frame_audit_repair_plan.json",
    sceneCoverageConformanceRef: "scene_coverage_conformance_report.json",
    reviewerEvidenceRef: versionedArtifactRef,
    approvedForUserReview: review.decision === "accept" && quality.passed,
    finalUserApproval: "pending"
  };
  const deliveryManifest = {
    schemaVersion: "1.1",
    finalVideoArtifactRef: review.mediaArtifactRef,
    finalVideoSha256: review.mediaSha256,
    finalVideoPath: media.path,
    rightsStatus: quality.rightsStatus,
    deliveryTier: quality.deliveryTier,
    mockComponents: quality.mockComponents,
    qualityGatePassed: quality.passed,
    frameAuditRepairPlanRef: "frame_audit_repair_plan.json",
    sceneCoverageConformanceRef: "scene_coverage_conformance_report.json",
    reviewerEvidenceRef: versionedArtifactRef,
    deliveryStatus: quality.passed && review.decision === "accept" ? "awaiting_user_approval" : review.decision
  };
  return { evidence, repairPlan: updatedPlan, timeline, quality, finalReview, deliveryManifest };
}

function applyDispositionsToQuality(quality, plan, decision, reviewerEvidenceRef) {
  const acceptedCodes = new Set(plan.findings.filter((finding) => ["intentional", "false_positive"].includes(finding.detectorDisposition)).map((finding) => finding.code));
  const blockers = (quality.blockers ?? []).filter((blocker) => !resolvedCandidateBlocker(blocker, acceptedCodes));
  if (decision !== "accept") for (const finding of plan.findings.filter((item) => item.detectorDisposition === "confirmed_defect")) blockers.push(`review_confirmed:${finding.findingId}`);
  const uniqueBlockers = [...new Set(blockers)];
  const frameAudit = structuredClone(quality.frameAudit);
  frameAudit.blockers = (frameAudit.blockers ?? []).filter((blocker) => !resolvedFrameBlocker(blocker, acceptedCodes));
  frameAudit.reviewDispositions = Object.fromEntries(plan.findings.map((finding) => [finding.findingId, finding.detectorDisposition]));
  frameAudit.reviewRequired = decision !== "accept";
  frameAudit.passed = decision === "accept" && (frameAudit.technicalBlockers ?? []).length === 0 && frameAudit.blockers.length === 0;
  const passed = decision === "accept" && uniqueBlockers.length === 0 && frameAudit.passed;
  return { ...quality, frameAudit, blockers: uniqueBlockers, passed, reviewRequired: !passed, status: passed ? `${quality.deliveryTier}_ready` : decision, reviewerEvidenceRef, checkedAt: new Date().toISOString() };
}

function applyDispositionsToTimeline(timeline, plan, reviewId, reviewerEvidenceRef) {
  if (!timeline) return null;
  const byId = new Map(plan.findings.map((finding) => [finding.findingId, finding]));
  return {
    ...structuredClone(timeline),
    markers: (timeline.markers ?? []).map((marker) => {
      const finding = byId.get(marker.id);
      return finding ? { ...marker, detectorDisposition: finding.detectorDisposition, dispositionReason: finding.dispositionReason, reviewId, evidenceRefs: [...new Set([...(marker.evidenceRefs ?? []), ...(finding.dispositionEvidenceRefs ?? []), reviewerEvidenceRef])] } : marker;
    })
  };
}

function evidenceExists(run, ref) {
  if (run.artifacts?.[ref]) return true;
  if (ref === "frame_audit_repair_plan.json" || ref === "frame_audit_report.json" || ref === "av_review_timeline.json") return true;
  return (run.avReviewTimeline?.markers ?? []).some((marker) => marker.id === ref);
}

function resolvedCandidateBlocker(blocker, codes) {
  const value = String(blocker);
  return value.startsWith("frame_audit:") && resolvedFrameBlocker(value.slice("frame_audit:".length), codes);
}

function resolvedFrameBlocker(blocker, codes) {
  const value = String(blocker);
  return (value.startsWith("black_frames:") && codes.has("black_frame"))
    || (value.startsWith("white_frames:") && codes.has("white_frame"))
    || (value.startsWith("flash_frames:") && codes.has("flash_frame"))
    || (value.startsWith("frozen_run:") && codes.has("frozen_run"))
    || (value.startsWith("motion_coverage:") && codes.has("motion_coverage"));
}

export const finalReviewDispositions = [...DISPOSITIONS];
export const finalReviewDecisions = [...DECISIONS];
export const finalReviewReviewerId = REVIEWER_ID;
export function finalReviewEvidenceArtifactRef(reviewId) { return `final_review_evidence/${String(reviewId).replace(/[^A-Za-z0-9._-]/g, "-")}.json`; }
