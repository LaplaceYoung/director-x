import { createHash } from "node:crypto";
import { looksLikeCodexToolName } from "./codex-agent-roles.mjs";

const CAPABILITY_ALIASES = Object.freeze({
  native_goal_lifecycle: ["create_goal", "get_goal", "update_goal"],
  native_user_input: ["request_user_input"],
  native_permissions: ["request_permissions", "request_codex_security_user_input"],
  typed_agent_schema: [],
  collaboration_agents: ["collaboration", "multi_agent_v1__spawn_agent", "spawn_agents_on_csv"],
  durable_wait: ["wait", "wait_agent", "multi_agent_v1__wait_agent", "get_handoff_status", "wait_for_environment"],
  host_exec: ["exec", "shell_command", "exec_command"],
  computer_use: ["mcp__computer_use", "computer-use:computer-use"],
  app_control: ["get_app_state", "list_apps", "click", "set_value", "select_text", "scroll", "drag", "press_key", "type_text"],
  event_stream: ["mcp__event_stream", "event_stream_start", "event_stream_status", "event_stream_stop"],
  thread_lifecycle: ["create_thread", "fork_thread", "send_message_to_thread", "read_thread", "get_handoff_status"],
  official_openai_docs: ["mcp__openaiDeveloperDocs__fetch_openai_doc", "mcp__openaiDeveloperDocs__search_openai_docs", "mcp__openaiDeveloperDocs__get_openapi_spec"],
  session_key_confirmation: ["mcp__openai_api_key_local_confirmation", "confirm_openai_api_key_local_destination"],
  node_repl: ["mcp__node_repl__js", "mcp__node_repl__js_add_node_module_dir"]
});

const SIDE_BROWSER_SKILL_ALIASES = Object.freeze(["browser:control-in-app-browser", "control-in-app-browser"]);

export function detectCodexHostCapabilities({ toolNames = [], skillNames = [], availableAgentTypes = [] } = {}) {
  const names = normalizeToolNames(toolNames);
  const skills = normalizeToolNames(skillNames);
  const observed = names.length > 0 || skills.length > 0;
  const available = normalizeToolNames(availableAgentTypes);
  const capabilities = Object.fromEntries(Object.entries(CAPABILITY_ALIASES).map(([id, aliases]) => [id, observedCapability(names, aliases, observed)]));
  capabilities.native_goal_lifecycle = observedCapability(names, CAPABILITY_ALIASES.native_goal_lifecycle, observed, { minimum: 3 });
  capabilities.typed_agent_schema = typedAgentCapability(available, observed);
  capabilities.side_browser = sideBrowserCapability({ names, skills, observed, computerUse: capabilities.computer_use, appControl: capabilities.app_control });
  capabilities.loop_execution = loopCapability(capabilities, observed);

  const agentTransport = capabilities.typed_agent_schema.mode === "collaboration_task"
    ? "collaboration_task"
    : capabilities.typed_agent_schema.status === "ready"
      ? "typed_spawn_agent"
      : capabilities.collaboration_agents.status === "ready"
        ? "collaboration_surface_observed"
        : "unresolved";
  const interactionTransport = capabilities.native_user_input.status === "ready"
    ? "request_user_input"
    : capabilities.host_exec.status === "ready"
      ? "nested_host_action_candidate"
      : "unresolved";
  const surfaceTransport = capabilities.side_browser.status === "ready"
    ? "in_app_browser_skill"
    : capabilities.side_browser.status === "degraded"
      ? "host_ui_fallback_candidate"
      : "unresolved";

  const requirements = {
    native_goal: requirement(capabilities.native_goal_lifecycle, "Codex create_goal, get_goal, and update_goal keep Director X in a durable production objective.", { required: true }),
    native_interaction: requirement(capabilities.native_user_input, "Codex request_user_input is required for every material decision.", { required: true }),
    agent_dispatch: requirement(capabilities.typed_agent_schema.status === "ready" || capabilities.collaboration_agents.status === "ready" ? { status: "ready", evidence: [...capabilities.typed_agent_schema.evidence, ...capabilities.collaboration_agents.evidence] } : capabilities.typed_agent_schema, "A typed spawn schema or collaboration surface is required for DX parallel work.", { required: true }),
    durable_loop: requirement(capabilities.loop_execution, "A Goal-aware execution and wait lifecycle is required to continue until a verified deliverable or a real blocker.", { required: true }),
    side_browser: requirement(capabilities.side_browser, "The Director X production canvas must open in the Codex side Browser; host UI control is only a degraded recovery route.", { required: true, allowDegraded: true, allowUnknown: true }),
    permissions: requirement(capabilities.native_permissions, "Permission prompts are required only when a restricted host operation needs them.", { required: false, allowDegraded: true })
  };
  const productionReadiness = compileProductionReadiness(requirements, observed);

  return {
    schemaVersion: "1.0",
    source: "codex_host_tool_inventory",
    observed,
    observedToolCount: names.length,
    observedSkillCount: skills.length,
    inventorySha256: sha256({ tools: names, skills }),
    capabilities,
    transport: { agent: agentTransport, interaction: interactionTransport, surface: surfaceTransport },
    requirements,
    productionReadiness,
    fallbackPolicy: {
      unknownHostInventory: "block_run_creation; request a fresh exact host inventory before Goal entry",
      missingGoalLifecycle: "block_run_creation; never simulate Director X Goal in chat-only state",
      missingNativeInteraction: "block_and_return_host_action; never ask the same question in chat",
      missingAgentDispatch: "use collaboration_task only when the host schema explicitly exposes it; never infer it from an unrelated tool name",
      missingDurableLoop: "preserve the run checkpoint and return a resumable blocker instead of ending as if production completed",
      missingSideBrowser: "attempt the official Browser skill/runtime, then record browser-unavailable evidence before inline fallback"
    }
  };
}

export function normalizeToolNames(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => typeof value === "string" ? value.trim() : value?.name)
    .filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function observedCapability(names, aliases, observed, { minimum = 1 } = {}) {
  const evidence = aliases.filter((alias) => names.includes(alias));
  const status = !observed ? "unknown" : evidence.length >= minimum ? "ready" : evidence.length ? "degraded" : "missing";
  return { status, evidence };
}

function typedAgentCapability(available, observed) {
  const valid = available.filter((value) => !looksLikeCodexToolName(value) && !value.includes("/"));
  if (!available.length) return { status: observed ? "missing" : "unknown", mode: "unresolved", evidence: [], availableAgentTypes: [] };
  if (valid.length === 1 && valid[0] === "collaboration_task") {
    return { status: "ready", mode: "collaboration_task", evidence: ["spawn_agent.inputSchema.properties.task_name+fork_turns+message"], availableAgentTypes: valid };
  }
  const typed = valid.filter((value) => value !== "collaboration_task");
  const mixedContracts = typed.length !== valid.length;
  return {
    status: typed.length && !mixedContracts ? "ready" : typed.length ? "degraded" : "missing",
    mode: typed.length && !mixedContracts ? "agent_type_enum" : mixedContracts ? "mixed_invalid" : "unresolved",
    evidence: typed.length ? ["spawn_agent.inputSchema.properties.agent_type.enum"] : [],
    availableAgentTypes: typed
  };
}

function sideBrowserCapability({ names, skills, observed, computerUse, appControl }) {
  const evidence = SIDE_BROWSER_SKILL_ALIASES.filter((alias) => names.includes(alias) || skills.includes(alias));
  if (evidence.length) return { status: "ready", evidence, recoveryEvidence: [] };
  const recoveryEvidence = [...computerUse.evidence, ...appControl.evidence];
  if (recoveryEvidence.length) return { status: "degraded", evidence: [], recoveryEvidence };
  // The Browser is Skill-backed in Codex Desktop and may not appear in a direct tool inventory.
  return { status: "unknown", evidence: [], recoveryEvidence: [] };
}

function loopCapability(capabilities, observed) {
  if (!observed) return { status: "unknown", evidence: [] };
  const evidence = [
    ...capabilities.native_goal_lifecycle.evidence,
    ...capabilities.host_exec.evidence,
    ...capabilities.durable_wait.evidence
  ];
  const goalReady = capabilities.native_goal_lifecycle.status === "ready";
  const executionReady = capabilities.host_exec.status === "ready" || capabilities.durable_wait.status === "ready";
  return { status: goalReady && executionReady ? "ready" : evidence.length ? "degraded" : "missing", evidence };
}

function requirement(capability, rationale, { required, allowDegraded = false, allowUnknown = false }) {
  return { status: capability.status, evidence: capability.evidence ?? [], recoveryEvidence: capability.recoveryEvidence ?? [], required, optional: !required, allowDegraded, allowUnknown, rationale };
}

function compileProductionReadiness(requirements, observed) {
  const entries = Object.entries(requirements);
  const blockers = entries.filter(([, value]) => value.required && (
    value.status === "missing"
    || (value.status === "degraded" && !value.allowDegraded)
    || (value.status === "unknown" && !value.allowUnknown)
  )).map(([id]) => id);
  const degraded = entries.filter(([, value]) => value.required && value.status === "degraded").map(([id]) => id);
  const unknown = entries.filter(([, value]) => value.required && value.status === "unknown").map(([id]) => id);
  return {
    status: blockers.length ? "blocked" : degraded.length ? "degraded" : unknown.length ? "unknown" : "ready",
    observed,
    blockers,
    degraded,
    unknown,
    mayCreateRun: blockers.length === 0
  };
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
