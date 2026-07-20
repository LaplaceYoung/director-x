import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectCodexAgentRoles, installCodexAgentRoles, renderCodexAgentRole } from "./codex-agent-roles.mjs";
import { DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID } from "./subagent-prompt-contract.mjs";
import { DX_SUBAGENT_CATALOG } from "./subagent-registry.mjs";

test("installs user-scoped Codex roles with canonical native DX nicknames", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-agent-roles-"));
  const userHome = await mkdtemp(join(tmpdir(), "directorx-agent-home-"));
  const before = await inspectCodexAgentRoles(projectPath, { userHome });
  assert.equal(before.ready, false);
  assert.ok(before.roles.every((role) => role.status === "missing"));

  const result = await installCodexAgentRoles(projectPath, { userHome });
  assert.equal(result.diskReady, true);
  assert.equal(result.sessionReady, false);
  assert.equal(result.ready, false);
  assert.equal(result.restartRequired, true);
  assert.equal(result.installScope, "user");
  assert.equal(result.promptContractId, DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID);
  assert.equal(result.added.length, DX_SUBAGENT_CATALOG.length);
  assert.equal(result.roles.length, DX_SUBAGENT_CATALOG.length);
  const shotPlanner = DX_SUBAGENT_CATALOG.find((role) => role.roleId === "shot_planner");
  const source = await readFile(join(userHome, ".codex", "agents", "dx_shot_planner.toml"), "utf8");
  assert.equal(source, renderCodexAgentRole(shotPlanner));
  assert.match(source, /nickname_candidates = \["DX-Shot-Planner"\]/);
  assert.doesNotMatch(source, /^prompt_contract_id\s*=/m);
  assert.match(source, /Director X subagent prompt contract:/);
  await assert.rejects(access(join(projectPath, ".codex", "agents", "dx_shot_planner.toml")));
});

test("is idempotent and refuses to overwrite a conflicting role", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-agent-roles-"));
  const userHome = await mkdtemp(join(tmpdir(), "directorx-agent-home-"));
  await installCodexAgentRoles(projectPath, { userHome });
  await installCodexAgentRoles(projectPath, { userHome });
  const rolePath = join(userHome, ".codex", "agents", "dx_editor.toml");
  await writeFile(rolePath, "name = \"user-editor\"\n", "utf8");
  await assert.rejects(() => installCodexAgentRoles(projectPath, { userHome }), /Refusing to overwrite/);
});

test("synchronizes outdated plugin-managed prompts without overwriting user-owned files", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-agent-roles-"));
  const userHome = await mkdtemp(join(tmpdir(), "directorx-agent-home-"));
  await installCodexAgentRoles(projectPath, { userHome });
  const rolePath = join(userHome, ".codex", "agents", "dx_editor.toml");
  await writeFile(rolePath, "# Managed by the Director X Codex plugin. Restart Codex after changing this file.\nname = \"dx_editor\"\n", "utf8");
  const before = await inspectCodexAgentRoles(projectPath, { userHome });
  assert.equal(before.roles.find((role) => role.roleId === "editing_agent").userStatus, "outdated");
  const result = await installCodexAgentRoles(projectPath, { userHome });
  assert.ok(result.updated.includes(rolePath));
  assert.equal(await readFile(rolePath, "utf8"), renderCodexAgentRole(DX_SUBAGENT_CATALOG.find((role) => role.roleId === "editing_agent")));
  assert.equal(result.promptSyncRequired, false);
});

test("distinguishes files on disk from roles loaded in the current Codex session", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-agent-roles-"));
  const userHome = await mkdtemp(join(tmpdir(), "directorx-agent-home-"));
  await installCodexAgentRoles(projectPath, { userHome });
  const staleSession = await inspectCodexAgentRoles(projectPath, { availableAgentTypes: ["default", "worker"], userHome });
  assert.equal(staleSession.diskReady, true);
  assert.equal(staleSession.sessionReady, true);
  assert.equal(staleSession.customSessionReady, false);
  assert.equal(staleSession.compatibilitySessionReady, true);
  assert.equal(staleSession.sessionMode, "builtin_compatibility");
  assert.equal(staleSession.ready, true);
  assert.equal(staleSession.restartRequired, false);
  assert.equal(staleSession.restartRecommended, true);
  assert.ok(staleSession.missingSessionAgentTypes.includes("dx_quality_reviewer"));
  assert.equal(staleSession.unroutableRoleIds.length, 0);
  assert.equal(staleSession.roleBindings.find((binding) => binding.roleId === "editing_agent").agentType, "worker");
  assert.equal(staleSession.roleBindings.find((binding) => binding.roleId === "reference_analyst").agentType, "default");

  const currentSession = await inspectCodexAgentRoles(projectPath, { availableAgentTypes: DX_SUBAGENT_CATALOG.map((role) => role.agentType), userHome });
  assert.equal(currentSession.diskReady, true);
  assert.equal(currentSession.sessionReady, true);
  assert.equal(currentSession.customSessionReady, true);
  assert.equal(currentSession.sessionMode, "custom_dx_roles");
  assert.equal(currentSession.ready, true);
});

test("uses built-in agents as role-appropriate compatibility hosts", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-agent-roles-"));
  const userHome = await mkdtemp(join(tmpdir(), "directorx-agent-home-"));
  const result = await inspectCodexAgentRoles(projectPath, { availableAgentTypes: ["default", "worker", "explorer"], userHome });
  assert.equal(result.diskReady, false);
  assert.equal(result.sessionReady, true);
  assert.equal(result.installRecommended, true);
  assert.equal(result.restartRequired, false);
  assert.equal(result.roleBindings.find((binding) => binding.roleId === "reference_analyst").agentType, "explorer");
  assert.equal(result.roleBindings.find((binding) => binding.roleId === "editing_agent").agentType, "worker");
  assert.equal(result.roleBindings.find((binding) => binding.roleId === "director_runtime").agentType, "default");
  assert.ok(result.roleBindings.every((binding) => binding.identityTransport === "prompt_registry_and_canvas"));
});

test("supports Codex collaboration task hosts without an agent_type enum or restart", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-agent-roles-"));
  const userHome = await mkdtemp(join(tmpdir(), "directorx-agent-home-"));
  const result = await inspectCodexAgentRoles(projectPath, { availableAgentTypes: ["collaboration_task"], userHome });
  assert.equal(result.sessionReady, true);
  assert.equal(result.customSessionReady, false);
  assert.equal(result.compatibilitySessionReady, true);
  assert.equal(result.collaborationTaskSessionReady, true);
  assert.equal(result.sessionMode, "collaboration_task");
  assert.equal(result.restartRequired, false);
  assert.ok(result.roleBindings.every((binding) => binding.agentType === "collaboration_task"));
  assert.ok(result.roleBindings.every((binding) => binding.hostIdentitySource === "sub_agent_activity.agent_thread_id"));
  assert.ok(result.roleBindings.every((binding) => binding.hostReleaseStrategy === "terminal_event"));
});

test("rejects tool names as agent-type evidence without recommending a restart", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-agent-roles-"));
  const userHome = await mkdtemp(join(tmpdir(), "directorx-agent-home-"));
  await installCodexAgentRoles(projectPath, { userHome });
  const result = await inspectCodexAgentRoles(projectPath, {
    availableAgentTypes: [
      "mcp__directorx_production__directorx_register_subagent",
      "multi_agent_v1__spawn_agent",
      "multi_agent_v1__wait_agent"
    ],
    userHome
  });

  assert.equal(result.diskReady, true);
  assert.equal(result.sessionReady, false);
  assert.equal(result.ready, false);
  assert.equal(result.restartRequired, false);
  assert.equal(result.agentTypeEvidence.status, "invalid_tool_names");
  assert.equal(result.agentTypeEvidence.valid, false);
  assert.deepEqual(result.agentTypeEvidence.invalidValues, [
    "mcp__directorx_production__directorx_register_subagent",
    "multi_agent_v1__spawn_agent",
    "multi_agent_v1__wait_agent"
  ]);
});
