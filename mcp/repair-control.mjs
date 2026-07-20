import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export function createRepairBranch(run, input, now = new Date().toISOString()) {
  const source = run.generation?.candidates?.find((candidate) => candidate.candidateId === input.sourceCandidateId);
  if (!source || !source.reviewedAt) throw new Error("Repair requires a reviewed source candidate.");
  if (!input.defectCodes?.length || !input.repairActions?.length) throw new Error("Repair requires scoped defects and repair actions.");
  run.repairs ??= [];
  if (run.repairs.some((branch) => branch.repairId === input.repairId)) throw new Error(`Duplicate repair branch: ${input.repairId}`);
  const branch = {
    repairId: input.repairId, sourceCandidateId: source.candidateId, sourceAssetRef: source.assetRef,
    defectCodes: input.defectCodes, repairActions: input.repairActions, scope: input.scope,
    status: "planned", outputCandidateId: null, outputAssetRef: null, createdAt: now, completedAt: null
  };
  run.repairs.push(branch);
  return branch;
}

export function completeRepairBranch(run, input, now = new Date().toISOString()) {
  const branch = run.repairs?.find((item) => item.repairId === input.repairId);
  if (!branch) throw new Error(`Unknown repair branch: ${input.repairId}`);
  if (input.outputAssetRef === branch.sourceAssetRef) throw new Error("Repair output must not overwrite the source asset.");
  if (run.generation.candidates.some((candidate) => candidate.candidateId === input.outputCandidateId)) throw new Error(`Duplicate repair candidate: ${input.outputCandidateId}`);
  const source = run.generation.candidates.find((candidate) => candidate.candidateId === branch.sourceCandidateId);
  const request = run.generation.requests.find((item) => item.requestId === source.requestId);
  if (!Number.isFinite(input.actualCost) || input.actualCost < 0) throw new Error("Repair cost must be zero or greater.");
  if (request.spent + input.actualCost > request.maxCost) throw new Error("Repair exceeds the remaining shot budget; request approval before execution.");
  request.spent += input.actualCost; run.generation.totalActualCost += input.actualCost;
  run.generation.candidates.push({
    ...source, candidateId: input.outputCandidateId, assetRef: input.outputAssetRef, previewUri: input.previewUri,
    actualCost: input.actualCost, providerResultId: input.providerResultId ?? null, status: "awaiting_review",
    scores: null, decision: null, reviewReason: null, reviewedAt: null, selectedAt: null,
    repairLineage: { repairId: branch.repairId, sourceCandidateId: branch.sourceCandidateId, scope: branch.scope }
  });
  branch.status = "completed"; branch.outputCandidateId = input.outputCandidateId; branch.outputAssetRef = input.outputAssetRef; branch.completedAt = now;
  return branch;
}

export async function writeRepairBranches({ projectPath, runId, repairs }) {
  const dir = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(dir, { recursive: true });
  const path = join(dir, "repair_branches.json");
  await writeFile(path, `${JSON.stringify({ schemaVersion: "1.0", runId, branches: repairs }, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "repair_branches.json", path };
}
