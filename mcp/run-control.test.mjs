import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRunCheckpoint, approveStage, assertRunModeAllowsStage, configureRunMode } from "./run-control.mjs";

function run() { return { runId: "dx-control", stage: "research", status: "production_in_progress", pipeline: { id: "brand-film", stages: [{ id: "research" }], stageStates: { research: { status: "active" } } }, approvals: [], decisions: [], artifacts: { "Director.md": {} }, events: [{ sequence: 7 }] }; }

test("enforces Codex-native run-mode and stage approvals", () => {
  const state = run();
  assert.throws(() => assertRunModeAllowsStage(state, "research", "begin"), /Confirm a Director X run mode/);
  configureRunMode(state, { mode: "stage_approval", confirmedBy: "request_user_input" });
  assert.deepEqual(state.runMode.hardGates.slice(0, 4), ["budget", "image_model", "video_model", "voice_model"]);
  assert.throws(() => assertRunModeAllowsStage(state, "research", "begin"), /requires Codex request_user_input/);
  approveStage(state, { stageId: "research", confirmedBy: "request_user_input", note: "proceed" });
  assert.doesNotThrow(() => assertRunModeAllowsStage(state, "research", "begin"));
  assert.throws(() => configureRunMode(state, { mode: "full_automation", confirmedBy: "chat_inference" }), /request_user_input/);
});

test("writes a superseding checkpoint replay artifact", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-checkpoint-"));
  try {
    const state = run(); configureRunMode(state, { mode: "guided_autonomy", confirmedBy: "request_user_input" });
    const first = await appendRunCheckpoint({ projectPath, runId: state.runId, run: state, reason: "stage.begin", detail: "research" });
    const second = await appendRunCheckpoint({ projectPath, runId: state.runId, run: state, reason: "stage.complete", detail: "research complete" });
    const artifact = JSON.parse(await readFile(second.path, "utf8"));
    assert.equal(artifact.checkpoints.length, 2);
    assert.equal(artifact.checkpoints[1].supersedes, first.checkpoint.checkpointId);
    assert.equal(artifact.event_cursor.replay_cursor, 7);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});
