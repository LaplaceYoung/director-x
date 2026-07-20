import assert from "node:assert/strict";
import test from "node:test";
import { detectCodexHostCapabilities, normalizeToolNames } from "./codex-host-capabilities.mjs";

test("fails closed when the host inventory is omitted", () => {
  const result = detectCodexHostCapabilities({ availableAgentTypes: ["collaboration_task"] });
  assert.equal(result.observed, false);
  assert.equal(result.capabilities.native_user_input.status, "unknown");
  assert.equal(result.requirements.native_interaction.status, "unknown");
  assert.equal(result.capabilities.typed_agent_schema.status, "ready");
  assert.equal(result.productionReadiness.status, "blocked");
  assert.deepEqual(result.productionReadiness.blockers, ["native_goal", "native_interaction", "durable_loop"]);
  assert.equal(result.productionReadiness.mayCreateRun, false);
});

test("recognizes Codex 5.6 collaboration, exec, wait, permission, event, and app controls", () => {
  const result = detectCodexHostCapabilities({
    toolNames: ["collaboration", "exec", "wait", "request_permissions", "mcp__event_stream", "get_app_state", "click", "set_value"],
    availableAgentTypes: ["collaboration_task"]
  });
  assert.equal(result.transport.agent, "collaboration_task");
  assert.equal(result.transport.interaction, "nested_host_action_candidate");
  assert.equal(result.capabilities.durable_wait.status, "ready");
  assert.equal(result.capabilities.event_stream.status, "ready");
  assert.equal(result.capabilities.app_control.status, "ready");
  assert.equal(result.requirements.agent_dispatch.status, "ready");
});

test("does not infer agent types from tool names", () => {
  const result = detectCodexHostCapabilities({ toolNames: ["multi_agent_v1__spawn_agent", "multi_agent_v1__wait_agent"] });
  assert.equal(result.capabilities.typed_agent_schema.status, "missing");
  assert.equal(result.transport.agent, "collaboration_surface_observed");
  assert.deepEqual(result.capabilities.typed_agent_schema.availableAgentTypes, []);
});

test("recognizes the Goal, ask-user-question, side-browser, and loop production contract", () => {
  const result = detectCodexHostCapabilities({
    toolNames: ["create_goal", "get_goal", "update_goal", "request_user_input", "exec", "wait"],
    skillNames: ["browser:control-in-app-browser"],
    availableAgentTypes: ["default", "worker", "explorer"]
  });
  assert.equal(result.capabilities.native_goal_lifecycle.status, "ready");
  assert.equal(result.capabilities.native_user_input.status, "ready");
  assert.equal(result.capabilities.side_browser.status, "ready");
  assert.equal(result.capabilities.loop_execution.status, "ready");
  assert.equal(result.productionReadiness.status, "ready");
  assert.equal(result.productionReadiness.mayCreateRun, true);
});

test("blocks Run creation when an observed inventory is missing Goal and native interaction", () => {
  const result = detectCodexHostCapabilities({
    toolNames: ["exec", "wait"],
    skillNames: ["browser:control-in-app-browser"],
    availableAgentTypes: ["worker"]
  });
  assert.equal(result.productionReadiness.status, "blocked");
  assert.deepEqual(result.productionReadiness.blockers, ["native_goal", "native_interaction", "durable_loop"]);
  assert.equal(result.productionReadiness.mayCreateRun, false);
});

test("treats a partial Goal lifecycle as a blocker rather than a usable degradation", () => {
  const result = detectCodexHostCapabilities({
    toolNames: ["create_goal", "request_user_input", "exec"],
    skillNames: ["browser:control-in-app-browser"],
    availableAgentTypes: ["worker"]
  });
  assert.equal(result.capabilities.native_goal_lifecycle.status, "degraded");
  assert.ok(result.productionReadiness.blockers.includes("native_goal"));
  assert.ok(result.productionReadiness.blockers.includes("durable_loop"));
  assert.equal(result.productionReadiness.mayCreateRun, false);
});

test("keeps the skill-backed side Browser unknown when only unrelated host tools are observed", () => {
  const result = detectCodexHostCapabilities({ toolNames: ["exec"], availableAgentTypes: ["worker"] });
  assert.equal(result.capabilities.side_browser.status, "unknown");
  assert.ok(result.productionReadiness.unknown.includes("side_browser"));
  assert.ok(!result.productionReadiness.blockers.includes("side_browser"));
});

test("normalizes descriptors and produces a stable inventory hash", () => {
  const names = normalizeToolNames([{ name: "exec" }, "request_user_input", "exec", " "]);
  assert.deepEqual(names, ["exec", "request_user_input"]);
  const first = detectCodexHostCapabilities({ toolNames: names });
  const second = detectCodexHostCapabilities({ toolNames: [...names].reverse() });
  assert.equal(first.inventorySha256, second.inventorySha256);
});
