import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistPreflightTransaction, projectPreflightBootTransaction, readPreflightTransaction } from "./preflight-transaction.mjs";

test("persists only the durable pre-Run boot transaction and resumes at the exact next gate", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-preflight-store-"));
  const preflightId = "preflight-test";
  const session = {
    projectPath,
    outcome: "Deliver a playable film",
    claimToken: "ephemeral-claim-must-not-persist",
    serviceOrigin: "http://127.0.0.1:9999",
    createdAt: "2026-07-17T00:00:00.000Z",
    canvasOpenedAt: "2026-07-17T00:00:01.000Z",
    surface: "browser",
    subagentSessionReady: true,
    subagentNamingStatus: { sessionReady: true, sessionMode: "builtin_compatibility" },
    goalInteractionRequestId: "dxq-goal-preflight-test",
    goalInteraction: {
      requestId: "dxq-goal-preflight-test",
      kind: "goal_entry",
      status: "resolved",
      answers: { enter_directorx_goal: "进入制作 (Recommended)" }
    }
  };
  try {
    await persistPreflightTransaction(preflightId, session);
    const persisted = await readPreflightTransaction(projectPath, preflightId);
    assert.equal(persisted.goalInteraction.status, "resolved");
    assert.equal(persisted.claimToken, undefined);
    assert.equal(persisted.serviceOrigin, undefined);

    const active = projectPreflightBootTransaction(preflightId, session);
    assert.equal(active.state, "awaiting_goal_creation");
    assert.deepEqual(active.completedSteps, ["service_ready", "canvas_claimed", "goal_confirmed"]);

    const recovered = projectPreflightBootTransaction(preflightId, { ...persisted, recoveredFromDisk: true, recoveryCount: 1 });
    assert.equal(recovered.state, "awaiting_canvas_claim");
    assert.equal(recovered.recoveredFromDisk, true);
    assert.ok(recovered.completedSteps.includes("goal_confirmed"));
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("keeps a claimed canvas at the host-capability repair gate before Goal creation", () => {
  const transaction = projectPreflightBootTransaction("preflight-host-gate", {
    projectPath: "/tmp/directorx-host-gate",
    outcome: "Deliver a playable film",
    canvasOpenedAt: "2026-07-17T00:00:01.000Z",
    surface: "browser",
    subagentSessionReady: true,
    hostCapabilities: {
      observed: true,
      productionReadiness: { mayCreateRun: false, blockers: ["native_goal", "native_interaction"] }
    }
  });
  assert.equal(transaction.state, "host_capability_blocked");
  assert.equal(transaction.nextRequiredAction, "repair_host_capabilities");
});
