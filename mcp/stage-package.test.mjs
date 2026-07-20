import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPipelineRunState } from "./pipeline-catalog.mjs";
import { getStageRequirements, inspectStagePackage } from "./stage-package.mjs";

test("reports every missing stage artifact before mutation", () => {
  const run = {
    pipeline: createPipelineRunState("brand-film"),
    approvals: [{ kind: "budget", status: "approved" }],
    artifacts: { "script_or_outline.json": {} }
  };
  run.pipeline.stageStates.intake.status = "complete";
  run.pipeline.stageStates.research.status = "complete";
  const status = getStageRequirements(run, "script");
  assert.equal(status.canBegin, true);
  assert.equal(status.canComplete, false);
  assert.deepEqual(status.registeredOutputs, ["script_or_outline.json"]);
  assert.deepEqual(status.missingOutputs, ["claim_to_proof_map.json", "audio_cue_sheet.json"]);
  assert.equal(getStageRequirements(run, "script", ["claim_to_proof_map.json", "audio_cue_sheet.json"]).canComplete, true);
});

test("validates and hashes a stage artifact package as one bounded unit", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-stage-package-"));
  try {
    await writeFile(join(projectPath, "script.json"), "{}\n");
    await writeFile(join(projectPath, "claims.json"), "{}\n");
    await writeFile(join(projectPath, "audio.json"), "{}\n");
    const records = await inspectStagePackage({ projectPath, runId: "dx-stage-package", stageId: "script", artifacts: [
      { artifactRef: "script_or_outline.json", path: "script.json", mediaKind: "document" },
      { artifactRef: "claim_to_proof_map.json", path: "claims.json", mediaKind: "document" },
      { artifactRef: "audio_cue_sheet.json", path: "audio.json", mediaKind: "document" }
    ] });
    assert.equal(records.length, 3);
    assert.ok(records.every((record) => record.stage === "script" && /^[a-f0-9]{64}$/.test(record.sha256)));
    await assert.rejects(() => inspectStagePackage({ projectPath, runId: "dx-stage-package", stageId: "script", artifacts: [
      { artifactRef: "duplicate", path: "script.json" }, { artifactRef: "duplicate", path: "audio.json" }
    ] }), /unique/);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});
