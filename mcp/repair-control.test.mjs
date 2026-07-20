import test from "node:test";
import assert from "node:assert/strict";
import { completeRepairBranch, createRepairBranch } from "./repair-control.mjs";

test("creates a non-destructive repair candidate with explicit lineage", () => {
  const run = { generation: { totalActualCost: 0, requests: [{ requestId: "r1", spent: 0, maxCost: 10 }], candidates: [{ candidateId: "c1", assetRef: "candidate:c1", previewUri: "c1.mp4", mediaType: "video", reviewedAt: "now", requestId: "r1", attemptId: "a1" }] } };
  createRepairBranch(run, { repairId: "fix-1", sourceCandidateId: "c1", defectCodes: ["motion_failure"], repairActions: ["regenerate 2-3s"], scope: { startSeconds: 2, endSeconds: 3 } });
  assert.throws(() => completeRepairBranch(run, { repairId: "fix-1", outputCandidateId: "c2", outputAssetRef: "candidate:c1", previewUri: "c2.mp4", actualCost: 1 }), /must not overwrite/);
  completeRepairBranch(run, { repairId: "fix-1", outputCandidateId: "c2", outputAssetRef: "candidate:c2", previewUri: "c2.mp4", actualCost: 1 });
  assert.equal(run.generation.candidates[1].repairLineage.sourceCandidateId, "c1");
});
