import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, readRun } from "./run-store.mjs";
import { DirectorXToolExecutionError, withToolFailureGuard } from "./tool-failure-policy.mjs";

test("stops native interaction resolution errors instead of allowing blind retries", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-failure-policy-"));
  try {
    const run = await createRun({ projectPath, outcome: "test" });
    await assert.rejects(
      () => withToolFailureGuard("directorx_resolve_user_interaction", { projectPath, runId: run.runId, requestId: "dxq-1" }, async () => {
        throw new Error("Director X requires the raw request_user_input answer envelope.");
      }),
      (error) => {
        assert.ok(error instanceof DirectorXToolExecutionError);
        assert.equal(error.details.code, "native_interaction_required");
        assert.equal(error.details.stop, true);
        assert.equal(error.details.nextRequiredAction, "directorx_create_and_ask_native_question");
        assert.match(error.details.userFacingMessage, /原生确认/);
        return true;
      }
    );
    const persisted = await readRun({ projectPath, runId: run.runId });
    assert.equal(persisted.recoveryGate.status, "blocked");
    assert.equal(Object.values(persisted.toolFailureLedger)[0].attempts, 1);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("limits transient retries and persists a recovery gate after the retry budget", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-failure-policy-"));
  try {
    const run = await createRun({ projectPath, outcome: "test" });
    const args = { projectPath, runId: run.runId, referenceId: "ref-1", url: "https://example.com/video" };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await assert.rejects(
        () => withToolFailureGuard("directorx_ingest_reference_video", args, async () => {
          throw new Error("Reference ingest timed out while contacting the source.");
        }),
        (error) => {
          assert.equal(error.details.code, "transient_execution_failure");
          assert.equal(error.details.attempts, attempt);
          assert.equal(error.details.retryable, attempt < 2);
          return true;
        }
      );
    }
    const persisted = await readRun({ projectPath, runId: run.runId });
    assert.equal(persisted.recoveryGate.status, "blocked");
    assert.equal(persisted.recoveryGate.nextRequiredAction, "retry_same_operation_once_then_use_fallback");
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("clears a matching recovery gate after a later successful operation", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-failure-policy-"));
  try {
    const run = await createRun({ projectPath, outcome: "test" });
    const args = { projectPath, runId: run.runId, referenceId: "ref-2", url: "https://example.com/video" };
    await assert.rejects(() => withToolFailureGuard("directorx_ingest_reference_video", args, async () => {
      throw new Error("Reference ingest timed out while contacting the source.");
    }));
    await withToolFailureGuard("directorx_ingest_reference_video", args, async () => ({ status: "ok" }));
    const persisted = await readRun({ projectPath, runId: run.runId });
    assert.equal(persisted.recoveryGate, null);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("keeps semantic asset identifiers distinct in the failure ledger", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-failure-policy-"));
  try {
    const run = await createRun({ projectPath, outcome: "test" });
    for (const keyframeId of ["kf-01", "kf-02"]) {
      await assert.rejects(() => withToolFailureGuard("directorx_generate_keyframe", {
        projectPath,
        runId: run.runId,
        keyframeId,
        sourceKey: `source-${keyframeId}`
      }, async () => {
        throw new Error("keyframe generation timed out");
      }));
    }
    const persisted = await readRun({ projectPath, runId: run.runId });
    assert.equal(Object.keys(persisted.toolFailureLedger).length, 2);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("hard-blocks unrelated work while a recovery gate is active", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-failure-policy-"));
  try {
    const run = await createRun({ projectPath, outcome: "test" });
    const args = { projectPath, runId: run.runId, requestId: "dxq-hard-gate" };
    await assert.rejects(() => withToolFailureGuard("directorx_resolve_user_interaction", args, async () => {
      throw new Error("Director X requires the raw request_user_input answer envelope.");
    }));
    let executed = false;
    await assert.rejects(
      () => withToolFailureGuard("directorx_generate_image", args, async () => {
        executed = true;
        return { status: "should-not-run" };
      }),
      (error) => {
        assert.equal(error.details.code, "recovery_gate_active");
        assert.equal(error.details.nextRequiredAction, "directorx_create_and_ask_native_question");
        return true;
      }
    );
    assert.equal(executed, false);
    await withToolFailureGuard("directorx_get_run_snapshot", args, async () => ({ status: "snapshot" }));
    await withToolFailureGuard("directorx_get_recovery_action", args, async () => ({ status: "recovery" }));
    await withToolFailureGuard("directorx_create_and_ask_native_question", args, async () => ({ status: "question_created" }));
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("allows the declared recovery action to clear a workflow gate", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-failure-policy-"));
  try {
    const run = await createRun({ projectPath, outcome: "test" });
    const args = { projectPath, runId: run.runId };
    await assert.rejects(() => withToolFailureGuard("directorx_request_user_interaction", args, async () => {
      throw new Error("Bind the native Codex Goal with directorx_bind_goal before Director X Intake.");
    }), (error) => {
      assert.equal(error.details.code, "workflow_state_invalid");
      assert.equal(error.details.nextRequiredAction, "bind_native_goal");
      return true;
    });
    await withToolFailureGuard("directorx_bind_goal", args, async () => ({ status: "bound" }));
    const persisted = await readRun({ projectPath, runId: run.runId });
    assert.equal(persisted.recoveryGate, null);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("blocks the failed native-gated operation until its interaction is resolved", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-failure-policy-"));
  try {
    const run = await createRun({ projectPath, outcome: "test" });
    const args = { projectPath, runId: run.runId, requestId: "dxq-native-recovery" };
    await assert.rejects(() => withToolFailureGuard("directorx_configure_run_mode", args, async () => {
      throw new Error("Resolve native interaction before configuring the Director X run mode.");
    }));
    let executed = false;
    await assert.rejects(
      () => withToolFailureGuard("directorx_configure_run_mode", args, async () => {
        executed = true;
        return { status: "should-not-run" };
      }),
      (error) => {
        assert.equal(error.details.code, "recovery_gate_active");
        assert.equal(error.details.nextRequiredAction, "directorx_create_and_ask_native_question");
        return true;
      }
    );
    assert.equal(executed, false);
    await withToolFailureGuard("directorx_resolve_user_interaction", args, async () => ({ status: "resolved" }));
    const persisted = await readRun({ projectPath, runId: run.runId });
    assert.equal(persisted.recoveryGate, null);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("writes a failure checkpoint and allows corrected deterministic arguments", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-failure-recovery-"));
  try {
    const run = await createRun({ projectPath, outcome: "Recover an execution graph" });
    const originalArgs = { projectPath, runId: run.runId, graphId: "graph-1", selectedCapabilities: ["web_research"] };
    await assert.rejects(
      () => withToolFailureGuard("directorx_register_execution_graph", originalArgs, async () => {
        throw new Error("script uses capability script_craft outside selectedCapabilities");
      }),
      (error) => {
        assert.equal(error.details.code, "execution_failure");
        assert.equal(error.details.nextRequiredAction, "directorx_recover_run_then_retry_corrected_arguments");
        return true;
      }
    );
    let stored = await readRun({ projectPath, runId: run.runId });
    assert.equal(stored.recoveryGate.status, "blocked");
    assert.ok(stored.checkpoints.length >= 2, "initial and failure checkpoints should exist");
    assert.ok(stored.recoveryGate.recoveryCheckpointId);

    const correctedArgs = { ...originalArgs, selectedCapabilities: ["web_research", "script_craft"] };
    await withToolFailureGuard("directorx_recover_run", { projectPath, runId: run.runId, recoveryAction: "retry_corrected_arguments", detail: "Add the missing script capability." }, async () => ({ status: "recovered" }));
    stored = await readRun({ projectPath, runId: run.runId });
    assert.equal(stored.recoveryGate, null);
    await withToolFailureGuard("directorx_register_execution_graph", correctedArgs, async () => ({ status: "registered" }));
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("keeps checkpoint and resume available while a generic recovery gate is active", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-failure-recovery-"));
  try {
    const run = await createRun({ projectPath, outcome: "Resume after a tool failure" });
    const args = { projectPath, runId: run.runId, value: "bad" };
    await assert.rejects(() => withToolFailureGuard("directorx_render_video", args, async () => {
      throw new Error("renderer rejected the composition");
    }));
    await withToolFailureGuard("directorx_checkpoint_run", { projectPath, runId: run.runId, reason: "manual.recovery", detail: "Preserve the failed render state." }, async () => ({ status: "checkpointed" }));
    await withToolFailureGuard("directorx_resume_run", { projectPath, runId: run.runId }, async () => ({ status: "resumed" }));
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
