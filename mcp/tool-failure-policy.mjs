import { createHash, randomUUID } from "node:crypto";
import { readRun, updateRun } from "./run-store.mjs";
import { appendRunCheckpoint } from "./run-control.mjs";

const MAX_RETRIES = 2;
const VOLATILE_KEYS = new Set(["answers", "confirmedBy", "timeoutMs", "retryAfterSeconds"]);
const SENSITIVE_KEYS = /^(?:key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|authorization|credential|token|secret)$/i;

export class DirectorXToolExecutionError extends Error {
  constructor(message, details, cause = null) {
    super(message, { cause });
    this.name = "DirectorXToolExecutionError";
    this.details = details;
  }
}

export async function withToolFailureGuard(toolName, args, operation) {
  const key = failureKey(toolName, args);
  await assertRecoveryGateAllows(toolName, args);
  try {
    const result = await operation();
    await clearRecoveryGate(args, key);
    return result;
  } catch (cause) {
    const failure = classifyFailure(toolName, args, cause);
    const recorded = await recordFailure(args, key, failure);
    const details = {
      schemaVersion: "1.0",
      code: failure.code,
      toolName,
      retryable: failure.retryable && recorded.attempts < MAX_RETRIES,
      attempts: recorded.attempts,
      maxAttempts: MAX_RETRIES,
      stop: failure.stop || recorded.attempts >= MAX_RETRIES,
      nextRequiredAction: failure.code === "execution_failure" ? "directorx_recover_run_then_retry_corrected_arguments" : failure.nextRequiredAction,
      userFacingMessage: userFacingMessage(failure, recorded.attempts),
      technicalMessage: String(cause?.message ?? cause),
      recovery: projectRecoveryAction({ toolName, code: failure.code, nextRequiredAction: recoveryActionFor(failure), technicalMessage: String(cause?.message ?? cause) })
    };
    throw new DirectorXToolExecutionError(details.technicalMessage, details, cause);
  }
}

async function assertRecoveryGateAllows(toolName, args) {
  if (!args?.projectPath || !args?.runId || String(args.runId).startsWith("preflight:")) return;
  let run;
  try {
    run = await readRun(args);
  } catch {
    return;
  }
  const gate = run.recoveryGate;
  if (gate?.status !== "blocked") return;
  if (toolName === "directorx_get_run_snapshot" || toolName === "directorx_get_recovery_action") return;
  if (toolName === "directorx_checkpoint_run" || toolName === "directorx_resume_run" || toolName === "directorx_recover_run" || toolName === "directorx_recover_production") return;
  if (toolName === gate.toolName && gate.code === "transient_execution_failure" && gate.attempts < MAX_RETRIES) return;
  if (toolName === gate.toolName && gate.code === "execution_failure" && gate.failedInputKey && failureKey(toolName, args) !== gate.failedInputKey) return;
  if (gate.nextRequiredAction === "bind_native_goal" && toolName === "directorx_bind_goal") return;
  if (gate.code === "native_interaction_required" && ["directorx_create_and_ask_native_question", "directorx_request_user_interaction", "directorx_resolve_user_interaction"].includes(toolName)) return;
  if (gate.code === "native_reference_consent_required" && toolName === "directorx_record_reference_download_consent") return;
  if (gate.code === "native_reference_consent_required" && toolName === gate.toolName && run.referenceDownloadConsent?.decision === "authorized") return;
  throw new DirectorXToolExecutionError("Director X recovery gate is active.", {
    schemaVersion: "1.0",
    code: "recovery_gate_active",
    toolName,
    retryable: false,
    attempts: gate.attempts,
    maxAttempts: MAX_RETRIES,
    stop: true,
    nextRequiredAction: gate.nextRequiredAction,
    userFacingMessage: "当前环节已暂停，请先完成恢复动作，再继续制作。",
    technicalMessage: `Recovery gate is active for ${gate.toolName}.`,
    recovery: gate.recovery ?? projectRecoveryAction(gate)
  });
}

export function toolFailurePayload(error) {
  if (!(error instanceof DirectorXToolExecutionError)) return null;
  return error.details;
}

function classifyFailure(toolName, args, cause) {
  const message = String(cause?.message ?? cause);
  if (/provider submission outcome is unknown|automatic retry is disabled to prevent duplicate billing/i.test(message)) {
    return { code: "provider_submission_unknown", retryable: false, stop: true, nextRequiredAction: "inspect_provider_dashboard_then_reconcile_submission" };
  }
  if (/request_user_input|native interaction|raw request_user_input answer envelope|confirmed through Codex/i.test(message)) {
    return { code: "native_interaction_required", retryable: false, stop: true, nextRequiredAction: "directorx_create_and_ask_native_question" };
  }
  if (/authorization|consent|download.*authorized|authorized.*download|reference.*download/i.test(message)) {
    return { code: "native_reference_consent_required", retryable: false, stop: true, nextRequiredAction: "resolve_reference_download" };
  }
  if (/bind the native codex goal|directorx_bind_goal/i.test(message)) {
    return { code: "workflow_state_invalid", retryable: false, stop: true, nextRequiredAction: "bind_native_goal" };
  }
  if (/unknown pending|already resolved|cannot.*repeat|duplicate|stale|mismatch|invalid params|unsupported|requires .* before/i.test(message)) {
    return { code: "workflow_state_invalid", retryable: false, stop: true, nextRequiredAction: "read_run_snapshot_and_follow_resume_action" };
  }
  if (/timeout|timed out|rate.?limit|429|5\d\d|ECONNRESET|ECONNREFUSED|network|temporarily unavailable/i.test(message)) {
    return { code: "transient_execution_failure", retryable: true, stop: false, nextRequiredAction: "retry_same_operation_once_then_use_fallback" };
  }
  return { code: "execution_failure", retryable: false, stop: true, nextRequiredAction: toolName.includes("reference") ? "use_local_reference_fallback_or_request_user_help" : "read_run_snapshot_and_request_recovery" };
}

async function recordFailure(args, key, failure) {
  if (!args?.projectPath || !args?.runId || String(args.runId).startsWith("preflight:")) return { attempts: 1 };
  let recorded = { attempts: 1 };
  try {
    await updateRun({ ...args, async mutate(run) {
      run.toolFailureLedger ??= {};
      const previous = run.toolFailureLedger[key];
      recorded = {
        attempts: (previous?.attempts ?? 0) + 1,
        firstAt: previous?.firstAt ?? new Date().toISOString(),
        lastAt: new Date().toISOString(),
        code: failure.code,
        nextRequiredAction: recoveryActionFor(failure)
      };
      run.toolFailureLedger[key] = recorded;
      if (failure.stop || recorded.attempts >= MAX_RETRIES) {
        let recoveryCheckpoint = null;
        try {
          recoveryCheckpoint = await appendRunCheckpoint({
            ...args,
            run,
            reason: "tool.failure",
            detail: `${key.split(":", 1)[0]} · ${failure.code} · ${recorded.attempts}`
          });
          run.artifacts ??= {};
          run.artifacts[recoveryCheckpoint.artifactRef] = {
            artifactRef: recoveryCheckpoint.artifactRef,
            path: recoveryCheckpoint.path,
            kind: "document",
            stage: run.stage,
            registeredAt: recorded.lastAt
          };
        } catch {
          // The original failure remains the source of truth if checkpointing fails.
        }
        const recoveryGate = {
          recoveryGateId: `DXR-${randomUUID()}`,
          status: "blocked",
          kind: "tool_failure",
          toolName: key.split(":", 1)[0],
          code: failure.code,
          attempts: recorded.attempts,
          failedInputKey: key,
          recoveryCheckpointId: recoveryCheckpoint?.checkpoint?.checkpointId ?? null,
          nextRequiredAction: recoveryActionFor(failure),
          updatedAt: recorded.lastAt
        };
        recoveryGate.recovery = projectRecoveryAction(recoveryGate);
        run.recoveryGate = recoveryGate;
      }
      run.events ??= [];
      run.events.push({
        id: randomUUID(),
        sequence: run.events.length + 1,
        type: "tool.execution.failed",
        stage: run.stage,
        at: recorded.lastAt,
        detail: `${key} · ${failure.code} · attempt ${recorded.attempts}`
      });
      return run;
    } });
  } catch {
    // Failure reporting must never hide the original tool error.
  }
  return recorded;
}

export function projectRecoveryAction(gate = {}) {
  return {
    recoveryToken: recoveryTokenFor(gate),
    recoveryGateId: gate.recoveryGateId ?? null,
    recoveryCheckpointId: gate.recoveryCheckpointId ?? null,
    failedInputKey: gate.failedInputKey ?? null,
    blockedOperation: gate.toolName ?? null,
    rootCause: gate.technicalMessage ?? gate.code ?? "unknown_failure",
    correctedExample: correctedExample(gate.code),
    requiredAction: expectedRecoveryAction(gate),
    resumeWith: gate.nextRequiredAction ?? "directorx_get_run_snapshot",
    preservesCompletedArtifacts: true
  };
}

export function recoveryTokenFor(gate = {}) {
  if (!gate.toolName && !gate.failedInputKey) return null;
  return `dxr_${createHash("sha256").update([gate.recoveryGateId ?? "legacy", gate.recoveryCheckpointId ?? "", gate.failedInputKey ?? gate.toolName, gate.code ?? ""].join(":"), "utf8").digest("hex").slice(0, 32)}`;
}

export function assertRecoveryToken(gate, token) {
  const expected = recoveryTokenFor(gate);
  if (!expected || token !== expected) throw new Error("Recovery token is stale or does not match the active failure gate.");
}

export function expectedRecoveryAction(gate = {}) {
  return gate.code === "execution_failure" ? "retry_corrected_arguments" : "write_checkpoint_and_retry";
}

export function assertRecoveryRequest(gate, input) {
  if (!gate || gate.status !== "blocked") return;
  if (input.recoveryGateId !== gate.recoveryGateId || input.recoveryCheckpointId !== gate.recoveryCheckpointId || input.failedInputKey !== gate.failedInputKey) {
    throw new Error("Recovery request is stale or does not match the active failure gate.");
  }
  const expectedAction = expectedRecoveryAction(gate);
  if (input.recoveryAction !== expectedAction) {
    throw new Error(`Recovery action ${input.recoveryAction} does not match ${gate.code}; use ${expectedAction}.`);
  }
}

function correctedExample(code) {
  if (code === "native_interaction_required") return { tool: "directorx_create_and_ask_native_question", rule: "persist_then_ask_then_resolve" };
  if (code === "native_reference_consent_required") return { tool: "directorx_create_and_ask_native_question", kind: "reference_download" };
  return { rule: "change the invalid argument once, then retry the blocked operation" };
}

function recoveryActionFor(failure) {
  return failure.code === "execution_failure"
    ? "directorx_recover_run_then_retry_corrected_arguments"
    : failure.nextRequiredAction;
}

async function clearRecoveryGate(args, key) {
  if (!args?.projectPath || !args?.runId || String(args.runId).startsWith("preflight:")) return;
  try {
    const current = await readRun(args);
    if (current.recoveryGate?.kind !== "tool_failure") return;
    const toolName = key.split(":", 1)[0];
    const sameTool = current.recoveryGate.toolName === toolName;
    const recoveryAction = (current.recoveryGate.nextRequiredAction === "bind_native_goal" && toolName === "directorx_bind_goal")
      || (current.recoveryGate.code === "native_interaction_required" && toolName === "directorx_resolve_user_interaction");
    const explicitRecovery = toolName === "directorx_recover_run";
    if (!sameTool && !recoveryAction && !explicitRecovery) return;
    await updateRun({ ...args, mutate(run) {
      if (run.recoveryGate?.toolName === toolName || recoveryAction || explicitRecovery) run.recoveryGate = null;
      return run;
    } });
  } catch {
    // A successful operation remains successful even if recovery metadata cleanup is unavailable.
  }
}

function failureKey(toolName, args = {}) {
  const stable = sanitize(args);
  return `${toolName}:${createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 24)}`;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !VOLATILE_KEYS.has(key) && !SENSITIVE_KEYS.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function userFacingMessage(failure, attempts) {
  if (failure.code === "provider_submission_unknown") return "供应商提交结果不明确。为避免重复扣费，已停止自动重试，请先核对供应商任务记录。";
  if (failure.code === "native_interaction_required") return "这一步需要通过 Codex 原生确认完成，我已暂停重复尝试，等确认后继续。";
  if (failure.code === "native_reference_consent_required") return "参考素材需要先完成一次原生授权确认，我已暂停下载和分析。";
  if (failure.code === "workflow_state_invalid") return "当前制作状态与这一步不一致，我已暂停，恢复后会从最近检查点继续。";
  if (failure.retryable && attempts < MAX_RETRIES) return "这一步暂时没有完成，我会按同一路线再尝试一次。";
  if (failure.retryable) return "同一环节连续失败，已暂停，准备切换到可解释的备用路线。";
  return "这一步没有安全的自动重试路径，已暂停，等待恢复处理。";
}
