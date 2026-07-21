import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const REPLICATION_DIMENSIONS = Object.freeze([
  "structure", "pacing", "camera", "motion", "audio", "originality"
]);

export function compileReferenceReplicationReview(run, input) {
  if (input.reviewerId !== "DX-Quality-Reviewer") throw new Error("Reference replication review requires the canonical DX-Quality-Reviewer.");
  const reference = (run.references ?? []).find((item) => item.referenceId === input.referenceId);
  if (!reference) throw new Error(`Unknown reference for replication review: ${input.referenceId}`);
  if (!run.artifacts?.[input.outputArtifactRef]) throw new Error(`Replication output artifact is not registered: ${input.outputArtifactRef}`);
  if (!run.artifacts?.["frame_audit_report.json"] || !run.artifacts?.["final_review.json"]) throw new Error("Replication review requires the completed exhaustive frame audit and final media review first.");
  const scores = Object.fromEntries(REPLICATION_DIMENSIONS.map((dimension) => [dimension, boundedScore(input.scores?.[dimension], dimension)]));
  const weightedScore = Number((REPLICATION_DIMENSIONS.reduce((sum, dimension) => sum + scores[dimension], 0) / REPLICATION_DIMENSIONS.length).toFixed(4));
  const threshold = Number.isFinite(input.minimumScore) ? input.minimumScore : 0.72;
  const weakDimensions = REPLICATION_DIMENSIONS.filter((dimension) => scores[dimension] < 0.6);
  const recommendation = weakDimensions.length || weightedScore < threshold ? "regenerate" : "pass_export";
  if (input.decision === "pass_export" && recommendation !== "pass_export") throw new Error(`Replication score ${weightedScore} is below the ${threshold} export threshold; choose regenerate or improve the weak dimensions.`);
  return {
    schemaVersion: "1.0",
    reportId: input.reportId,
    referenceId: input.referenceId,
    source: {
      videoArtifactRef: reference.clipArtifactRef,
      audioArtifactRef: reference.audioArtifactRef,
      fullFrameManifestArtifactRef: reference.fullFrameManifestArtifactRef,
      frameIdentityArtifactRef: reference.frameIdentityArtifactRef,
      rightsStatus: reference.rightsStatus
    },
    output: { artifactRef: input.outputArtifactRef, mediaSha256: input.outputMediaSha256 ?? null },
    comparison: { mode: "difference", compareArtifactRefs: [reference.clipArtifactRef, input.outputArtifactRef], differenceMethod: input.differenceMethod ?? "time-aligned evidence-frame and audio-energy comparison", evidenceRefs: input.evidenceRefs ?? [] },
    scores,
    weightedScore,
    minimumScore: threshold,
    weakDimensions,
    decision: input.decision,
    recommendation,
    rationale: input.rationale,
    nextAction: input.decision === "pass_export" ? "directorx_record_decision(delivery)" : input.decision === "needs_edit" ? "directorx_register_edit_intent" : "directorx_compile_generation_repair",
    auditRefs: ["frame_audit_report.json", "final_review.json", ...(input.auditRefs ?? [])]
  };
}

export async function writeReferenceReplicationReview({ projectPath, runId, report }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "replication_conformance_report.json");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { artifactRef: "replication_conformance_report.json", path };
}

function boundedScore(value, dimension) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Replication score for ${dimension} must be between 0 and 1.`);
  return Number(value.toFixed(4));
}
