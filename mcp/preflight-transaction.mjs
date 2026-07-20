import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

const writeQueues = new Map();

function transactionPath(projectPath, preflightId) {
  return join(resolve(projectPath), ".directorx", "plugin-preflights", `${preflightId}.json`);
}

async function writeAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function serialize(path, operation) {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  writeQueues.set(path, current);
  try {
    return await current;
  } finally {
    if (writeQueues.get(path) === current) writeQueues.delete(path);
  }
}

export async function persistPreflightTransaction(preflightId, session) {
  const path = transactionPath(session.projectPath, preflightId);
  const now = new Date().toISOString();
  const transaction = {
    schemaVersion: "1.0",
    preflightId,
    projectPath: session.projectPath,
    outcome: session.outcome,
    runId: session.runId ?? null,
    codexGoalId: session.codexGoalId ?? null,
    goalBoundAt: session.goalBoundAt ?? null,
    subagentNamingStatus: session.subagentNamingStatus ?? null,
    hostCapabilities: session.hostCapabilities ?? null,
    subagentSessionReady: session.subagentSessionReady === true,
    invalidAgentTypeEvidence: session.invalidAgentTypeEvidence === true,
    goalInteractionRequestId: session.goalInteractionRequestId ?? null,
    roleInstallInteractionRequestId: session.roleInstallInteractionRequestId ?? null,
    goalInteraction: session.goalInteraction ?? null,
    roleInstallInteraction: session.roleInstallInteraction ?? null,
    createdAt: session.createdAt ?? now,
    updatedAt: now,
    recoveryCount: Number(session.recoveryCount ?? 0)
  };
  await serialize(path, () => writeAtomic(path, transaction));
  return transaction;
}

export async function readPreflightTransaction(projectPath, preflightId) {
  try {
    const value = JSON.parse(await readFile(transactionPath(projectPath, preflightId), "utf8"));
    if (value.preflightId !== preflightId || value.projectPath !== projectPath) return null;
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function projectPreflightBootTransaction(preflightId, session) {
  const goalChoice = String(session.goalInteraction?.answers?.enter_directorx_goal ?? "");
  const goalAccepted = session.goalInteraction?.status === "resolved" && goalChoice.startsWith("进入制作");
  const goalDeclined = session.goalInteraction?.status === "resolved" && !goalAccepted;
  const completedSteps = ["service_ready"];
  if (session.canvasOpenedAt && session.surface === "browser") completedSteps.push("canvas_claimed");
  if (goalAccepted) completedSteps.push("goal_confirmed");
  if (session.codexGoalId) completedSteps.push("codex_goal_created");
  if (session.runId) completedSteps.push("run_created");
  if (session.goalBoundAt) completedSteps.push("goal_bound");

  let state = "awaiting_canvas_claim";
  let nextRequiredAction = "open_side_browser_canvas";
  const canvasClaimed = Boolean(session.canvasOpenedAt && session.surface === "browser");
  const hostCapabilityBlocked = session.hostCapabilities?.observed === true
    && session.hostCapabilities?.productionReadiness?.mayCreateRun === false;
  if (!canvasClaimed) {
    state = "awaiting_canvas_claim";
    nextRequiredAction = "open_side_browser_canvas";
  } else if (session.goalBoundAt) {
    state = "ready_for_intake";
    nextRequiredAction = "resume_run";
  } else if (session.runId) {
    state = "awaiting_goal_binding";
    nextRequiredAction = "bind_goal";
  } else if (hostCapabilityBlocked) {
    state = "host_capability_blocked";
    nextRequiredAction = "repair_host_capabilities";
  } else if (goalDeclined) {
    state = "goal_declined";
    nextRequiredAction = null;
  } else if (goalAccepted) {
    state = "awaiting_goal_creation";
    nextRequiredAction = "create_goal_then_run";
  } else {
    state = session.subagentSessionReady ? "awaiting_goal_confirmation" : "awaiting_agent_route";
    nextRequiredAction = session.subagentSessionReady ? "request_goal_confirmation" : "repair_agent_route";
  }

  return {
    schemaVersion: "1.0",
    transactionId: `directorx-boot:${preflightId}`,
    preflightId,
    state,
    completedSteps,
    nextRequiredAction,
    retrySafe: true,
    recoveredFromDisk: session.recoveredFromDisk === true,
    recoveryCount: Number(session.recoveryCount ?? 0),
    runId: session.runId ?? null,
    codexGoalId: session.codexGoalId ?? null
  };
}
