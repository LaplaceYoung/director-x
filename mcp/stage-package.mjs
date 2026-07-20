import { inspectArtifact } from "./artifact-registry.mjs";

const MAX_STAGE_ARTIFACTS = 64;

export function getStageRequirements(run, stageId, pendingArtifactRefs = []) {
  if (!run.pipeline) throw new Error("Select a Director X pipeline before inspecting stage requirements.");
  const index = run.pipeline.stages.findIndex((stage) => stage.id === stageId);
  if (index < 0) throw new Error(`Stage ${stageId} is not part of the selected pipeline.`);
  const definition = run.pipeline.stages[index];
  const available = new Set([...Object.keys(run.artifacts ?? {}), ...pendingArtifactRefs]);
  const registeredOutputs = definition.requiredOutputs.filter((artifactRef) => available.has(artifactRef));
  const missingOutputs = definition.requiredOutputs.filter((artifactRef) => !available.has(artifactRef));
  const previousIncompleteStage = run.pipeline.stages.slice(0, index).find((stage) => run.pipeline.stageStates?.[stage.id]?.status !== "complete")?.id ?? null;
  const missingApprovals = (definition.approvalKinds ?? []).filter((kind) => !["goal_entry", "delivery"].includes(kind) && !run.approvals?.some((approval) => approval.kind === kind && approval.status === "approved"));
  return {
    stageId,
    label: definition.label,
    ownerSkill: definition.ownerSkill,
    status: run.pipeline.stageStates?.[stageId]?.status ?? "pending",
    requiredOutputs: definition.requiredOutputs,
    registeredOutputs,
    missingOutputs,
    approvalKinds: definition.approvalKinds ?? [],
    missingApprovals,
    previousIncompleteStage,
    canBegin: previousIncompleteStage === null && missingApprovals.length === 0,
    canComplete: missingOutputs.length === 0
  };
}

export async function inspectStagePackage({ projectPath, runId, stageId, artifacts }) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error("Stage package requires at least one artifact.");
  if (artifacts.length > MAX_STAGE_ARTIFACTS) throw new Error(`Stage package exceeds the ${MAX_STAGE_ARTIFACTS}-artifact limit.`);
  const refs = new Set();
  for (const artifact of artifacts) {
    if (!artifact?.artifactRef || refs.has(artifact.artifactRef)) throw new Error("Stage package artifact refs must be present and unique.");
    refs.add(artifact.artifactRef);
  }
  return await Promise.all(artifacts.map((artifact) => inspectArtifact({
    projectPath,
    runId,
    stage: stageId,
    artifactRef: artifact.artifactRef,
    path: artifact.path,
    mediaKind: artifact.mediaKind ?? "document",
    metadata: artifact.metadata ?? {}
  })));
}

export const stagePackageLimits = Object.freeze({ maxArtifacts: MAX_STAGE_ARTIFACTS });
