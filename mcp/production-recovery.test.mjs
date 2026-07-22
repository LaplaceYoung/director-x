import assert from "node:assert/strict";
import test from "node:test";
import { completeProductionRecovery, inspectProductionRecovery, prepareProductionRecovery } from "./production-recovery.mjs";

function blockedRun() {
  return { runId: "dx-test", recoveryGate: { recoveryGateId: "DXR-1", recoveryCheckpointId: "DXC-1", failedInputKey: "directorx_render_video:abc", status: "blocked", toolName: "directorx_render_video", code: "execution_failure", nextRequiredAction: "directorx_recover_run_then_retry_corrected_arguments" } };
}

test("projects one compact opaque recovery intent", () => {
  const run = blockedRun();
  const inspected = inspectProductionRecovery(run);
  assert.equal(inspected.status, "blocked");
  assert.match(inspected.recovery.recoveryToken, /^dxr_/);
  assert.equal(inspected.recovery.requiredAction, "retry_corrected_arguments");
  assert.equal("recoveryGateId" in inspected.recovery, false);
  assert.equal("failedInputKey" in inspected.recovery, false);
});

test("applies the bound token once and returns the same result on replay", () => {
  const run = blockedRun();
  const recoveryToken = inspectProductionRecovery(run).recovery.recoveryToken;
  const prepared = prepareProductionRecovery(run, { recoveryToken, recoveryAction: "retry_corrected_arguments" });
  const result = completeProductionRecovery(run, { recoveryToken, gate: prepared.gate, checkpointId: "DXC-2", recoveredAt: "2026-07-22T00:00:00.000Z" });
  assert.equal(result.nextRequiredAction, "retry:directorx_render_video");
  assert.equal(run.recoveryGate, null);
  assert.deepEqual(prepareProductionRecovery(run, { recoveryToken, recoveryAction: "retry_corrected_arguments" }), { idempotent: true, result, gate: null });
  assert.throws(() => prepareProductionRecovery(blockedRun(), { recoveryToken: "dxr_stale", recoveryAction: "retry_corrected_arguments" }), /stale/);
});
