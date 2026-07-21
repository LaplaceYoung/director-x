import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DX_SUBAGENT_CATALOG } from "./subagent-registry.mjs";
import { DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID, buildSubagentSystemPrompt } from "./subagent-prompt-contract.mjs";

const HEADER = "# Managed by the Director X Codex plugin. Do not edit manually.\n";
const MANAGED_HEADER_PREFIX = "# Managed by the Director X Codex plugin.";
const BUILTIN_AGENT_TYPES = new Set(["default", "worker", "explorer"]);
export const COLLABORATION_TASK_AGENT_TYPE = "collaboration_task";
const ROLE_FALLBACK_PREFERENCES = Object.freeze({
  task_planner: ["default", "explorer", "worker"],
  director_runtime: ["default", "explorer", "worker"],
  reference_analyst: ["explorer", "default", "worker"],
  shot_planner: ["default", "explorer", "worker"],
  asset_manager: ["explorer", "worker", "default"],
  provider_operator: ["worker", "default", "explorer"],
  draw_loop_controller: ["worker", "default", "explorer"],
  memory_manager: ["worker", "default", "explorer"],
  quality_evaluator: ["explorer", "default", "worker"],
  editing_agent: ["worker", "default", "explorer"],
  approval_producer: ["default", "worker", "explorer"]
});

export async function inspectCodexAgentRoles(projectPath, { availableAgentTypes = [], userHome = homedir() } = {}) {
  const projectAgentsDirectory = resolve(projectPath, ".codex", "agents");
  const userAgentsDirectory = resolve(userHome, ".codex", "agents");
  const roles = await Promise.all(DX_SUBAGENT_CATALOG.map(async (role) => {
    const expected = renderCodexAgentRole(role);
    const roleProjectPath = join(projectAgentsDirectory, `${role.agentType}.toml`);
    const userPath = join(userAgentsDirectory, `${role.agentType}.toml`);
    const projectStatus = await inspectRoleFile(roleProjectPath, expected);
    const userStatus = await inspectRoleFile(userPath, expected);
    const source = projectStatus === "missing" ? "user" : "project";
    return {
      ...role,
      path: source === "project" ? roleProjectPath : userPath,
      projectPath: roleProjectPath,
      userPath,
      projectStatus,
      userStatus,
      source,
      status: source === "project" ? projectStatus : userStatus
    };
  }));
  const diskReady = roles.every((role) => role.status === "installed");
  const available = new Set(availableAgentTypes.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean));
  const invalidValues = [...available].filter(looksLikeCodexToolName);
  const agentTypeEvidence = {
    source: "spawn_agent.inputSchema.properties.agent_type.enum",
    status: invalidValues.length ? "invalid_tool_names" : available.size ? "valid" : "missing",
    valid: available.size > 0 && invalidValues.length === 0,
    invalidValues
  };
  const missingSessionAgentTypes = DX_SUBAGENT_CATALOG.map((role) => role.agentType).filter((agentType) => !available.has(agentType));
  const roleBindings = DX_SUBAGENT_CATALOG.map((role) => ({
    roleId: role.roleId,
    displayName: role.displayName,
    preferredAgentType: role.agentType,
    ...resolveDxHostAgentBinding(role, available)
  }));
  const customSessionReady = agentTypeEvidence.valid && missingSessionAgentTypes.length === 0;
  const unroutableRoleIds = roleBindings.filter((binding) => !binding.agentType).map((binding) => binding.roleId);
  const sessionReady = agentTypeEvidence.valid && unroutableRoleIds.length === 0;
  const compatibilitySessionReady = sessionReady && !customSessionReady;
  const collaborationTaskSessionReady = compatibilitySessionReady && roleBindings.every((binding) => binding.hostAgentTypeMode === "collaboration_task");
  const staleSession = diskReady && compatibilitySessionReady;
  const promptSyncRequired = roles.some((role) => role.projectStatus === "outdated" || role.userStatus === "outdated");
  return {
    schemaVersion: "1.0",
    agentsDirectory: userAgentsDirectory,
    installScope: "user",
    projectAgentsDirectory,
    userAgentsDirectory,
    diskReady,
    sessionReady,
    customSessionReady,
    compatibilitySessionReady,
    collaborationTaskSessionReady,
    sessionMode: customSessionReady ? "custom_dx_roles" : collaborationTaskSessionReady ? "collaboration_task" : compatibilitySessionReady ? "builtin_compatibility" : "unavailable",
    ready: sessionReady,
    restartRequired: !sessionReady && diskReady && agentTypeEvidence.valid,
    restartRecommended: staleSession,
    installRecommended: !diskReady,
    promptContractId: DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID,
    promptSyncRequired,
    agentTypeEvidence,
    availableAgentTypes: [...available],
    missingSessionAgentTypes,
    unroutableRoleIds,
    roleBindings,
    roles
  };
}

export async function installCodexAgentRoles(projectPath, { userHome = homedir() } = {}) {
  const before = await inspectCodexAgentRoles(projectPath, { userHome });
  const conflicts = before.roles.filter((role) => role.projectStatus === "conflict" || role.userStatus === "conflict");
  if (conflicts.length) {
    throw new Error(`Refusing to overwrite existing Codex agent roles: ${conflicts.flatMap((role) => [role.projectStatus === "conflict" ? role.projectPath : null, role.userStatus === "conflict" ? role.userPath : null]).filter(Boolean).join(", ")}`);
  }
  await mkdir(before.userAgentsDirectory, { recursive: true });
  const installed = [];
  const added = [];
  const updated = [];
  const unchanged = [];
  for (const role of DX_SUBAGENT_CATALOG) {
    const path = join(before.userAgentsDirectory, `${role.agentType}.toml`);
    const expected = renderCodexAgentRole(role);
    const previous = before.roles.find((candidate) => candidate.roleId === role.roleId);
    if (previous?.userStatus === "outdated") {
      await writeFile(path, expected, { encoding: "utf8" });
      updated.push(path);
    } else if (previous?.userStatus === "missing") {
      await writeFile(path, expected, { encoding: "utf8", flag: "wx" }).then(() => added.push(path)).catch(async (error) => {
        if (error?.code !== "EEXIST") throw error;
        const actual = await readFile(path, "utf8");
        if (actual !== expected) throw new Error(`Codex agent role changed during installation: ${path}`);
        unchanged.push(path);
      });
    } else {
      unchanged.push(path);
    }
    installed.push(path);

    const projectRole = previous?.projectStatus;
    if (projectRole === "outdated") {
      await writeFile(previous.projectPath, expected, { encoding: "utf8" });
      updated.push(previous.projectPath);
    }
  }
  const after = await inspectCodexAgentRoles(projectPath, { userHome });
  return {
    ...after,
    installed,
    added,
    updated,
    unchanged,
    installScope: "user",
    diskReady: true,
    sessionReady: false,
    ready: false,
    restartRequired: true,
    promptContractId: DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID,
    effectiveAfter: "new_codex_session",
    currentSessionFallback: "collaboration_task_or_builtin_compatibility_hosts_use_the_dynamic_prompt_immediately",
    spawnContract: "Call spawn_agent with the exact agentType. Normalize an exact displayName or Codex-generated ordinal host variant to the canonical DX production identity."
  };
}

async function inspectRoleFile(path, expected) {
  try {
    const actual = await readFile(path, "utf8");
    if (actual === expected) return "installed";
    return actual.startsWith(MANAGED_HEADER_PREFIX) ? "outdated" : "conflict";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

export function renderCodexAgentRole(role) {
  // Codex agent TOML is a host contract, not a Director X metadata store.
  // Keep the prompt contract inside developer_instructions because older and
  // current Codex hosts reject unknown top-level fields such as prompt_contract_id.
  return `${HEADER}name = ${tomlString(role.agentType)}\ndescription = ${tomlString(role.mission)}\nnickname_candidates = [${tomlString(role.displayName)}]\ndeveloper_instructions = ${tomlString(buildSubagentSystemPrompt(role))}\n`;
}

export function resolveDxHostAgentBinding(role, availableAgentTypes = []) {
  const available = availableAgentTypes instanceof Set ? availableAgentTypes : new Set(availableAgentTypes);
  if (available.has(role.agentType)) {
    return {
      agentType: role.agentType,
      hostAgentTypeMode: "custom_dx_role",
      expectedNickname: role.displayName,
      hostNicknamePolicy: "canonical_or_codex_ordinal_variant",
      identityTransport: "custom_agent_nickname_and_prompt",
      hostIdentitySource: "spawn_agent.result.agent_id",
      hostReleaseStrategy: "close_agent"
    };
  }
  if (available.has(COLLABORATION_TASK_AGENT_TYPE)) {
    return {
      agentType: COLLABORATION_TASK_AGENT_TYPE,
      hostAgentTypeMode: "collaboration_task",
      expectedNickname: null,
      hostNicknamePolicy: "host_task_path_trace_only",
      identityTransport: "prompt_registry_canvas_and_sub_agent_activity",
      hostIdentitySource: "sub_agent_activity.agent_thread_id",
      hostReleaseStrategy: "terminal_event"
    };
  }
  const fallback = (ROLE_FALLBACK_PREFERENCES[role.roleId] ?? ["default", "worker", "explorer"])
    .find((agentType) => BUILTIN_AGENT_TYPES.has(agentType) && available.has(agentType));
  if (!fallback) {
    return {
      agentType: null,
      hostAgentTypeMode: "unavailable",
      expectedNickname: null,
      hostNicknamePolicy: "unavailable",
      identityTransport: "none",
      hostIdentitySource: "none",
      hostReleaseStrategy: "none"
    };
  }
  return {
    agentType: fallback,
    hostAgentTypeMode: "builtin_compatibility",
    expectedNickname: null,
    hostNicknamePolicy: "host_trace_only",
    identityTransport: "prompt_registry_and_canvas",
    hostIdentitySource: "spawn_agent.result.agent_id",
    hostReleaseStrategy: "close_agent"
  };
}

function tomlString(value) {
  return JSON.stringify(value);
}

export function looksLikeCodexToolName(value) {
  return value.includes("__")
    || value.startsWith("mcp_")
    || /^(?:spawn|close|resume|send_input|wait)_agent$/.test(value)
    || /^(?:exec|wait|collaboration|request_user_input|request_permissions|create_goal|get_goal|update_goal)$/.test(value);
}
