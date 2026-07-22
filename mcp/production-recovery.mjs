import { assertRecoveryToken, expectedRecoveryAction, projectRecoveryAction } from "./tool-failure-policy.mjs";

export function inspectProductionRecovery(run) {
  const gate = run.recoveryGate;
  if (gate?.status !== "blocked") {
    return { schemaVersion: "1.0", runId: run.runId, status: "clear", recovery: null, checkpointId: null, nextRequiredAction: "continue_from_run_snapshot" };
  }
  const recovery = projectRecoveryAction(gate);
  return { schemaVersion: "1.0", runId: run.runId, status: "blocked", recovery: compactRecovery(recovery), checkpointId: gate.recoveryCheckpointId ?? null, nextRequiredAction: "directorx_recover_production_apply" };
}

export function prepareProductionRecovery(run, input) {
  const prior = (run.recoveryHistory ?? []).find((item) => item.recoveryToken === input.recoveryToken);
  if (prior) return { idempotent: true, result: structuredClone(prior.result), gate: null };
  const gate = run.recoveryGate;
  if (gate?.status !== "blocked") throw new Error("There is no active recovery gate for this token.");
  assertRecoveryToken(gate, input.recoveryToken);
  const expected = expectedRecoveryAction(gate);
  if (input.recoveryAction !== expected) throw new Error(`Recovery action ${input.recoveryAction} does not match ${gate.code}; use ${expected}.`);
  return { idempotent: false, result: null, gate: structuredClone(gate) };
}

export function completeProductionRecovery(run, input) {
  const result = {
    schemaVersion: "1.0",
    runId: run.runId,
    status: "recovered",
    recovery: null,
    checkpointId: input.checkpointId,
    nextRequiredAction: `retry:${input.gate.toolName}`
  };
  run.recoveryHistory ??= [];
  run.recoveryHistory.push({ recoveryToken: input.recoveryToken, recoveryGateId: input.gate.recoveryGateId, checkpointId: input.checkpointId, recoveredAt: input.recoveredAt, result });
  run.recoveryGate = null;
  return result;
}

function compactRecovery(recovery) {
  return {
    recoveryToken: recovery.recoveryToken,
    blockedOperation: recovery.blockedOperation,
    rootCause: recovery.rootCause,
    correctedExample: recovery.correctedExample,
    requiredAction: recovery.requiredAction,
    preservesCompletedArtifacts: recovery.preservesCompletedArtifacts
  };
}
