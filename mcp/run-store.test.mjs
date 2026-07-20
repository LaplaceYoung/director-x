import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSecretFree, createRun, publicSnapshot, readRun, updateRun } from "./run-store.mjs";

test("creates and updates a durable run", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-plugin-"));
  try {
    const created = await createRun({ projectPath, outcome: "Make a 60-second brand film" });
    await updateRun({ projectPath, runId: created.runId, mutate(run) { run.goal.codexGoalId = "goal-1"; return run; } });
    const stored = await readRun({ projectPath, runId: created.runId });
    assert.equal(stored.goal.codexGoalId, "goal-1");
    assert.deepEqual(stored.approvals.map(({ kind }) => kind), ["budget", "image_model", "video_model", "voice_model", "music_strategy", "delivery"]);
    assert.equal(stored.completionPolicy.objectiveScope, "playable_final_video");
    assert.equal(stored.goal.terminalOutcome, "Deliver a playable final video for: Make a 60-second brand film");
    assert.deepEqual(stored.canvas.nodes, []);
    assert.equal(publicSnapshot(stored).userFacingSummary.headline, "正在把你的想法整理成清晰的制作方向。");
    assert.equal(publicSnapshot(stored).userFacingSummary.presentation, "concise_consumer");
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("rejects credential-shaped fields", () => {
  assert.throws(() => assertSecretFree({ apiKey: "do-not-store" }), /Secrets are not accepted/);
  assert.doesNotThrow(() => assertSecretFree({ credentialRef: "env:IMAGE_PROVIDER_API_KEY", configured: true }));
});

test("keeps ordinal host nicknames out of user-visible run snapshots", () => {
  const snapshot = publicSnapshot({
    runId: "dx-public", goal: {}, completionPolicy: {}, status: "active", stage: "review", approvals: [], decisions: [], artifacts: {}, events: [],
    subagents: [{ displayName: "DX-Quality-Reviewer", hostAgentId: "agent-1", hostNickname: "DX-Quality-Reviewer the 3rd", hostNicknameMode: "codex_ordinal_variant" }],
    subagentOrchestrationPlan: { planId: "plan", tasks: [{ displayName: "DX-Quality-Reviewer", hostAgentId: "agent-1", hostNickname: "DX-Quality-Reviewer the 3rd", hostNicknameMode: "codex_ordinal_variant" }] }
  });
  assert.equal(snapshot.subagents[0].hostNickname, undefined);
  assert.equal(snapshot.subagents[0].hostNicknameMode, "codex_ordinal_variant");
  assert.equal(snapshot.subagentOrchestrationPlan.tasks[0].hostNickname, undefined);
  assert.doesNotMatch(snapshot.userFacingSummary.suggestedUpdate, /agent|runtime|artifact|JSON|MCP/i);
});

test("migrates a legacy generic model gate into explicit media and music route gates", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-plugin-legacy-model-"));
  try {
    const created = await createRun({ projectPath, outcome: "Migrate model approvals" });
    await updateRun({ projectPath, runId: created.runId, mutate(run) {
      run.approvals = [{ id: "legacy-model", kind: "model", status: "approved" }];
      return run;
    } });
    const stored = await readRun({ projectPath, runId: created.runId });
    assert.deepEqual(stored.approvals.map(({ kind, status }) => ({ kind, status })), [
      { kind: "image_model", status: "pending" },
      { kind: "video_model", status: "pending" },
      { kind: "voice_model", status: "pending" },
      { kind: "music_strategy", status: "pending" }
    ]);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("serializes concurrent updates without losing either mutation", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-plugin-concurrent-"));
  try {
    const created = await createRun({ projectPath, outcome: "Exercise concurrent writes" });
    await Promise.all([
      updateRun({ projectPath, runId: created.runId, async mutate(run) { await new Promise((resolve) => setTimeout(resolve, 20)); run.decisions.push({ kind: "budget" }); return run; } }),
      updateRun({ projectPath, runId: created.runId, mutate(run) { run.decisions.push({ kind: "video_model" }); return run; } })
    ]);
    const stored = await readRun({ projectPath, runId: created.runId });
    assert.deepEqual(stored.decisions.map(({ kind }) => kind), ["budget", "video_model"]);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
