const REQUIRED_STAGES = ["intake", "research", "script", "storyboard", "generation", "edit", "review", "delivery"];
const REQUIRED_FINAL_ARTIFACTS = ["render_report.json", "frame_audit_report.json", "frame_identity.jsonl", "frame_audit_repair_plan.json", "scene_coverage_conformance_report.json", "final_review_evidence.json", "final_review.json", "delivery_manifest.json"];

export function evaluateRunCompletion(run) {
  const blockers = [];
  const stages = run.pipeline?.stageStates ?? {};
  if (!run.pipeline || REQUIRED_STAGES.some((stage) => stages[stage]?.status !== "complete")) blockers.push("pipeline_not_delivered");
  for (const artifactRef of REQUIRED_FINAL_ARTIFACTS) if (!run.artifacts?.[artifactRef]) blockers.push(`artifact_missing:${artifactRef}`);
  const finalVideo = Object.values(run.artifacts ?? {}).find((artifact) => artifact?.mediaKind === "video" && Number(artifact.sizeBytes ?? 0) > 0 && artifact.stage === "delivery");
  if (!finalVideo) blockers.push("final_video_missing");
  if (finalVideo && run.finalMediaReview) {
    if (run.finalMediaReview.mediaArtifactRef !== finalVideo.artifactRef) blockers.push("final_media_artifact_mismatch");
    if (!run.finalMediaReview.mediaSha256 || run.finalMediaReview.mediaSha256 !== finalVideo.sha256) blockers.push("final_media_sha_mismatch");
  }
  if (!run.finalMediaReview) blockers.push("final_media_quality_gate_missing");
  else if (!run.finalMediaReview.passed && run.finalMediaReview.status !== "review_required") blockers.push(`final_media_quality_failed:${run.finalMediaReview.blockers.join("|")}`);
  if (!run.finalReviewEvidence) blockers.push("final_reviewer_evidence_missing");
  else if (run.finalReviewEvidence.decision !== "accept") blockers.push(`final_reviewer_decision:${run.finalReviewEvidence.decision}`);
  else if (finalVideo && (run.finalReviewEvidence.mediaArtifactRef !== finalVideo.artifactRef || run.finalReviewEvidence.mediaSha256 !== finalVideo.sha256)) blockers.push("final_review_media_binding_mismatch");
  const deliveryManifest = run.deliveryManifest;
  if (deliveryManifest && finalVideo && (deliveryManifest.finalVideoArtifactRef !== finalVideo.artifactRef || deliveryManifest.finalVideoSha256 !== finalVideo.sha256)) blockers.push("delivery_manifest_media_binding_mismatch");
  if (!run.sceneCoverageConformanceReport) blockers.push("scene_coverage_conformance_missing");
  else if (run.sceneCoverageConformanceReport.status !== "conformant") blockers.push(`scene_coverage_conformance:${run.sceneCoverageConformanceReport.status}`);
  if (run.finalMediaReview?.passed && run.finalReviewEvidence?.decision === "accept") {
    const editDecision = run.openCutEditor?.decision?.status ?? null;
    if (!editDecision) blockers.push("post_production_edit_decision_missing");
    else if (editDecision === "accepted") {
      const session = run.openCutEditor?.sessions?.[run.openCutEditor?.activeSessionId];
      if (!session) blockers.push("manual_editor_not_started");
      else if (session.status !== "completed") blockers.push(`manual_edit_not_completed:${session.status}`);
    }
  }
  if (!run.approvals?.some((approval) => approval.kind === "delivery" && approval.status === "approved")) blockers.push("final_delivery_approval_missing");
  else {
    const deliveryDecision = [...(run.decisions ?? [])].reverse().find((decision) => decision.kind === "delivery");
    if (!deliveryDecision?.value?.acceptedTier || deliveryDecision.value.acceptedTier !== run.finalMediaReview?.deliveryTier) blockers.push("final_delivery_tier_mismatch");
  }
  const failedOrBlocked = REQUIRED_STAGES.filter((stage) => ["blocked", "failed"].includes(stages[stage]?.status));
  if (failedOrBlocked.length) blockers.push(`stages_unresolved:${failedOrBlocked.join(",")}`);
  return {
    ready: blockers.length === 0,
    blockers,
    finalVideoArtifactRef: finalVideo?.artifactRef ?? null,
    nextAction: nextAction(blockers, stages)
  };
}

function nextAction(blockers, stages) {
  if (blockers.includes("pipeline_not_delivered")) {
    const stage = REQUIRED_STAGES.find((name) => stages[name]?.status !== "complete") ?? "intake";
    return { kind: "continue_stage", stage, instruction: `Continue the ${stage} stage; planning documents are not final delivery.` };
  }
  if (blockers.includes("final_video_missing")) return { kind: "produce_final_video", stage: "delivery", instruction: "Register a playable final video as delivery evidence." };
  if (blockers.includes("final_media_quality_gate_missing")) return { kind: "verify_final_media", stage: "review", instruction: "Run the tier-aware final media quality gate before requesting delivery approval." };
  if (blockers.includes("scene_coverage_conformance_missing")) return { kind: "verify_final_media", stage: "review", instruction: "Compile final shot-to-timeline coverage conformance from the verified media, semantic timeline, full-frame audit, and PTS identity evidence." };
  if (blockers.some((blocker) => blocker.startsWith("scene_coverage_conformance:"))) return { kind: "record_scene_coverage_review", stage: "review", instruction: "Have DX-Quality-Reviewer inspect every planned shot's identity-bound first, middle, and last frames, then record scene coverage dispositions." };
  if (blockers.includes("final_reviewer_evidence_missing")) return { kind: "record_final_review_evidence", stage: "review", instruction: "Have DX-Quality-Reviewer inspect every PTS-bound finding and evidence frame, then record structured dispositions before delivery." };
  if (blockers.some((blocker) => blocker.startsWith("final_reviewer_decision:"))) return { kind: "repair_final_media", stage: "review", instruction: "Apply the DX-Quality-Reviewer repair or rerender decision through an evidence-linked timeline patch, then render and verify again." };
  if (blockers.some((blocker) => blocker.startsWith("final_media_quality_failed:"))) return { kind: "repair_final_media", stage: "review", instruction: "Repair the failed visual, audio, rights, or placeholder quality checks before delivery." };
  if (blockers.includes("post_production_edit_decision_missing")) return { kind: "request_user_input", stage: "review", instruction: "Ask through Codex request_user_input whether the user wants to enter Director X Cut or proceed directly to delivery." };
  if (blockers.includes("manual_editor_not_started")) return { kind: "start_manual_editor", stage: "edit", instruction: "Start the loopback-only Director X Cut service and open it in the Codex side Browser." };
  if (blockers.some((blocker) => blocker.startsWith("manual_edit_not_completed:"))) return { kind: "continue_manual_edit", stage: "edit", instruction: "Finish, approve, render, and re-review the active Director X Cut session before delivery." };
  if (blockers.includes("final_delivery_approval_missing")) return { kind: "request_user_input", stage: "delivery", instruction: "Ask the user to approve the final candidate and delivery." };
  if (blockers.includes("final_delivery_tier_mismatch")) return { kind: "request_user_input", stage: "delivery", instruction: "Record explicit approval for the verified preview, review, or publish tier." };
  const missing = blockers.find((blocker) => blocker.startsWith("artifact_missing:"));
  if (missing) return { kind: "register_evidence", stage: "delivery", instruction: `Create and register ${missing.split(":")[1]}.` };
  return { kind: "complete_goal", stage: "delivery", instruction: "The final video and delivery evidence are ready; Codex Goal may now be completed." };
}

export const completionPolicy = Object.freeze({
  objectiveScope: "playable_final_video",
  requiredStages: REQUIRED_STAGES,
  requiredArtifacts: REQUIRED_FINAL_ARTIFACTS,
  deliveryTiers: ["preview", "review", "publish"],
  requiresTierAwareQualityGate: true,
  requiresStructuredReviewerEvidence: true,
  requiresFinalVideo: true,
  requiresPostProductionEditDecision: true,
  requiresFinalUserApproval: true,
  planningOnlyIsTerminal: false
});
