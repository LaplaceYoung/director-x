import { resolve } from "node:path";
import { dxIdentityInstruction } from "./subagent-registry.mjs";

export const DIRECTORX_SUBAGENT_PROMPT_VERSION = "2026-07-20";
export const DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID = `directorx-subagent-system-${DIRECTORX_SUBAGENT_PROMPT_VERSION}`;

const COMMON_RULES = Object.freeze([
  `Director X subagent prompt contract: ${DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID}`,
  "You are already a delegated child inside an active Director X production Run.",
  "Do not invoke @directorx, rerun preflight, create another Goal or Run, open another canvas, install roles, or ask for a Codex restart.",
  "Delegation depth is 1/1. Nested delegation is forbidden.",
  "Do not call spawn_agent, directorx_plan_production_team, directorx_plan_parallel_subagents, create_thread, create_goal, or any skill/tool that creates background agents.",
  "Stay inside the delegated mission and use structured, durable artifacts as the source of truth.",
  "Do not ask the user directly, spend money, change an approved provider or model, access credentials, or widen scope.",
  "Escalate rights, credential, provider, model, budget, generation, edit, and delivery decisions to the parent Director X agent through the native approval flow.",
  "Return a concise parent handoff with status, durable artifact references, blockers, evidence, and the next action."
]);

export function buildSubagentSystemPrompt(role) {
  return [
    dxIdentityInstruction(role.displayName),
    `Role mission: ${role.mission}.`,
    ...COMMON_RULES
  ].join("\n");
}

export function buildDelegatedSubagentPrompt(role, task, context = {}) {
  const projectPath = String(context.projectPath ?? "").trim();
  const runId = String(context.runId ?? "").trim();
  const artifactDirectory = projectPath && runId
    ? resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts")
    : null;
  return [
    buildSubagentSystemPrompt(role),
    projectPath ? `Active project path: ${projectPath}` : null,
    runId ? `Active Director X Run ID: ${runId}` : null,
    artifactDirectory ? `Write durable outputs under: ${artifactDirectory}` : null,
    `Delegation depth: ${task.delegationDepth}/${task.maxDelegationDepth}. Nested delegation is forbidden.`,
    `Mission: ${task.mission}`,
    `Stage: ${task.stage}`,
    `Input artifacts: ${formatList(task.inputArtifactRefs)}`,
    `Required output artifacts: ${formatList(task.outputArtifactRefs)}`,
    `Allowed tools: ${formatList(task.allowedTools)}`,
    `Restricted tools: ${formatList(task.restrictedTools)}`,
    `Stop condition: ${task.stopCondition}`,
    `Escalation triggers: ${formatList(task.escalationTriggers)}`,
    `Cost and attempt cap: ${task.currency} ${task.maxCost}; at most ${task.maxAttempts} attempts.`,
    `Approval boundary: ${task.approvalBoundary}`
  ].filter(Boolean).join("\n");
}

function formatList(values = []) {
  return values.length ? values.join(", ") : "none";
}
