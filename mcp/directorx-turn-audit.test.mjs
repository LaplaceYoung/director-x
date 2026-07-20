import test from "node:test";
import assert from "node:assert/strict";
import { auditDirectorXTurn } from "./directorx-turn-audit.mjs";

const record = (payload) => JSON.stringify({ timestamp: "2026-07-15T00:00:00Z", payload });
const completeBoot = () => [
  record({ type: "message", text: "[@directorx](plugin://directorx@openmoss-local) 做宣传片" }),
  record({ type: "function_call", name: "directorx_capability_preflight" }),
  record({ type: "function_call_output", structuredContent: { browserCanvasUrl: "http://127.0.0.1:1234/directorx/canvas?session=dx" } }),
  record({ type: "browser_call", action: "navigate", url: "http://127.0.0.1:1234/directorx/canvas?session=dx", visibility: true }),
  record({ type: "function_call", name: "directorx_get_preflight_status" }),
  record({ type: "browser_call", action: "finalize", keep: [{ status: "handoff" }] }),
  record({ type: "function_call", name: "request_user_input" }),
  record({ type: "function_call", name: "directorx_resolve_user_interaction" }),
  record({ type: "function_call", name: "create_goal" }),
  record({ type: "function_call", name: "directorx_create_run" }),
  record({ type: "function_call", name: "directorx_bind_goal" })
];

test("reports the six startup failures from a stale MCP runtime", () => {
  const result = auditDirectorXTurn([
    record({ type: "message", text: "[@directorx](plugin://directorx@openmoss-local) 做宣传片" }),
    record({ type: "tool_search_output", query: "directorx_capability_preflight", tools: [] }),
    record({ type: "message", text: "没有可用的 Director X MCP，先输出宣传片前期包" }),
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.mcpUnavailable, true);
  assert.equal(result.canvasOpened, false);
  assert.match(result.failures.join("\n"), /missing boot actions/);
  assert.match(result.failures.join("\n"), /downgraded/);
});

test("accepts a complete Director X boot sequence", () => {
  const result = auditDirectorXTurn([
    record({ type: "message", text: "[@directorx](plugin://directorx@openmoss-local) 做宣传片" }),
    record({ type: "function_call", name: "directorx_capability_preflight" }),
    record({ type: "function_call_output", browserCanvasUrl: "http://127.0.0.1:1234/canvas" }),
    record({ type: "browser_call", action: "navigate", url: "http://127.0.0.1:1234/canvas", visibility: true }),
    record({ type: "function_call", name: "directorx_get_preflight_status" }),
    record({ type: "browser_call", action: "finalize", keep: [{ status: "handoff", url: "http://127.0.0.1:1234/canvas" }] }),
    record({ type: "function_call", name: "request_user_input" }),
    record({ type: "function_call", name: "directorx_resolve_user_interaction" }),
    record({ type: "function_call", name: "create_goal" }),
    record({ type: "function_call", name: "directorx_create_run" }),
    record({ type: "function_call", name: "directorx_bind_goal" }),
  ]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test("rejects a visible canvas that was not finalized as a handoff", () => {
  const result = auditDirectorXTurn([
    record({ type: "message", text: "[@directorx](plugin://directorx@openmoss-local) 做宣传片" }),
    record({ type: "function_call", name: "directorx_capability_preflight" }),
    record({ type: "function_call_output", browserCanvasUrl: "http://127.0.0.1:1234/canvas" }),
    record({ type: "browser_call", action: "navigate", url: "http://127.0.0.1:1234/canvas", visibility: true }),
    record({ type: "function_call", name: "directorx_get_preflight_status" }),
    record({ type: "function_call", name: "request_user_input" }),
    record({ type: "function_call", name: "directorx_resolve_user_interaction" }),
    record({ type: "function_call", name: "create_goal" }),
    record({ type: "function_call", name: "directorx_create_run" }),
    record({ type: "function_call", name: "directorx_bind_goal" }),
  ]);
  assert.equal(result.canvasOpened, true);
  assert.equal(result.canvasHandoffPreserved, false);
  assert.match(result.failures.join("\n"), /not finalized as handoff/i);
});

test("rejects claimed web research without observed host search and open actions", () => {
  const boot = [
    record({ type: "message", text: "[@directorx](plugin://directorx@openmoss-local) 做宣传片" }),
    record({ type: "function_call", name: "directorx_capability_preflight" }),
    record({ type: "browser_call", action: "navigate", url: "http://127.0.0.1:1234/directorx/canvas", visibility: true }),
    record({ type: "function_call", name: "directorx_get_preflight_status" }),
    record({ type: "browser_call", action: "finalize", keep: [{ status: "handoff" }] }),
    record({ type: "function_call", name: "request_user_input" }),
    record({ type: "function_call", name: "directorx_resolve_user_interaction" }),
    record({ type: "function_call", name: "create_goal" }),
    record({ type: "function_call", name: "directorx_create_run" }),
    record({ type: "function_call", name: "directorx_bind_goal" })
  ];
  const blocked = auditDirectorXTurn([...boot, record({ type: "function_call", name: "directorx_record_web_research" })]);
  assert.match(blocked.failures.join("\n"), /without observed host search/);
  const ready = auditDirectorXTurn([
    ...boot,
    record({ type: "function_call", name: "web__run", arguments: { search_query: [{ q: "MOSI official" }] } }),
    record({ type: "function_call", name: "web__run", arguments: { open: [{ ref_id: "official" }] } }),
    record({ type: "function_call", name: "directorx_record_web_research" })
  ]);
  assert.equal(ready.webSearchObserved, true);
  assert.equal(ready.webOpenObserved, true);
  assert.equal(ready.ok, true);
});

test("requires a registered DX parallel plan to produce a real host spawn", () => {
  const boot = [
    record({ type: "message", text: "[@directorx](plugin://directorx@openmoss-local) 做宣传片" }),
    record({ type: "function_call", name: "directorx_capability_preflight" }),
    record({ type: "browser_call", action: "navigate", url: "http://127.0.0.1:1234/directorx/canvas", visibility: true }),
    record({ type: "function_call", name: "directorx_get_preflight_status" }),
    record({ type: "browser_call", action: "finalize", keep: [{ status: "handoff" }] }),
    record({ type: "function_call", name: "request_user_input" }),
    record({ type: "function_call", name: "directorx_resolve_user_interaction" }),
    record({ type: "function_call", name: "create_goal" }),
    record({ type: "function_call", name: "directorx_create_run" }),
    record({ type: "function_call", name: "directorx_bind_goal" }),
    record({ type: "function_call", name: "directorx_plan_parallel_subagents" })
  ];
  const blocked = auditDirectorXTurn(boot);
  assert.equal(blocked.parallelPlanRecorded, true);
  assert.equal(blocked.subagentSpawnObserved, false);
  assert.match(blocked.failures.join("\n"), /expected at least 2 spawn_agent calls/);

  const ready = auditDirectorXTurn([
    ...boot,
    record({ type: "custom_tool_call", name: "exec", input: "const agents = await Promise.all([tools.spawn_agent({agent_type:'dx_reference_analyst',message:'go'}), tools.spawn_agent({agent_type:'dx_asset_manager',message:'go'})]);" }),
    record({ type: "function_call", name: "directorx_register_subagent" }),
    record({ type: "function_call", name: "directorx_register_subagent" })
  ]);
  assert.equal(ready.subagentSpawnObserved, true);
  assert.equal(ready.subagentSpawnCount, 2);
  assert.equal(ready.parallelDispatchObserved, true);
  assert.equal(ready.subagentRegistrationComplete, true);
  assert.equal(ready.ok, true);
});

test("treats the execution-graph production-team compiler as the normal parallel plan", () => {
  const blocked = auditDirectorXTurn([
    ...completeBoot(),
    record({ type: "function_call", name: "directorx_plan_production_team", arguments: { hostConcurrencyLimit: 2 } })
  ]);
  assert.equal(blocked.parallelPlanRecorded, true);
  assert.match(blocked.failures.join("\n"), /expected at least 2 spawn_agent calls/);

  const ready = auditDirectorXTurn([
    ...completeBoot(),
    record({ type: "function_call", name: "directorx_plan_production_team", arguments: { hostConcurrencyLimit: 2 } }),
    record({ type: "custom_tool_call", name: "exec", input: "await Promise.all([tools.spawn_agent({agent_type:'dx_reference_analyst',message:'go'}),tools.spawn_agent({agent_type:'dx_asset_manager',message:'go'})]);" }),
    record({ type: "function_call", name: "directorx_register_subagent", arguments: { displayName: "DX-Reference-Analyst" } }),
    record({ type: "function_call", name: "directorx_register_subagent", arguments: { displayName: "DX-Asset-Manager" } })
  ]);
  assert.equal(ready.parallelDispatchObserved, true);
  assert.equal(ready.subagentRegistrationComplete, true);
  assert.equal(ready.ok, true);
});

test("audits nested Director X MCP calls and rejects an unjustified inline fallback", () => {
  const result = auditDirectorXTurn([
    record({ type: "message", text: "[@directorx](plugin://directorx@openmoss-local) 做宣传片" }),
    record({ type: "custom_tool_call", name: "exec", input: "await tools.mcp__directorx_production__directorx_capability_preflight({projectPath, outcome, availableAgentTypes});" }),
    record({ type: "custom_tool_call", name: "exec", input: "await tools.mcp__directorx_production__directorx_get_preflight_status({projectPath, preflightId});" }),
    record({ type: "custom_tool_call", name: "exec", input: "await tools.mcp__directorx_production__directorx_open_inline_canvas({projectPath, preflightId, outcome});" }),
    record({ type: "function_call", name: "request_user_input" }),
    record({ type: "function_call", name: "directorx_resolve_user_interaction" }),
    record({ type: "custom_tool_call", name: "exec", input: "await tools.mcp__directorx_production__directorx_create_run({projectPath, preflightId});" })
  ]);

  assert.deepEqual(result.actions, [
      "directorx_capability_preflight",
      "directorx_get_preflight_status",
      "directorx_resolve_user_interaction",
      "directorx_create_run",
      "request_user_input"
  ]);
  assert.equal(result.inlineCanvasOpened, true);
  assert.equal(result.inlineFallbackAuthorized, false);
  assert.match(result.failures.join("\n"), /inline canvas fallback.*observed Browser runtime attempt/i);
  assert.match(result.failures.join("\n"), /create_goal/);
  assert.match(result.failures.join("\n"), /directorx_bind_goal/);
});

test("accepts an inline fallback only with explicit Browser failure evidence", () => {
  const result = auditDirectorXTurn([
    record({ type: "message", text: "[@directorx](plugin://directorx@openmoss-local) 做宣传片" }),
    record({ type: "function_call", name: "directorx_capability_preflight" }),
    record({ type: "function_call", name: "directorx_get_preflight_status" }),
    record({ type: "custom_tool_call", name: "exec", input: "await setupBrowserRuntime({globals: globalThis}); await agent.browsers.get('iab');" }),
    record({ type: "function_call", name: "directorx_open_inline_canvas", arguments: { runId: "dx-existing", fallbackReason: "browser_runtime_unavailable", failureDetail: "Official Browser runtime could not connect." } }),
    record({ type: "function_call", name: "request_user_input" }),
    record({ type: "function_call", name: "directorx_resolve_user_interaction" }),
    record({ type: "function_call", name: "create_goal" }),
    record({ type: "function_call", name: "directorx_create_run" }),
    record({ type: "function_call", name: "directorx_bind_goal" })
  ]);

  assert.equal(result.inlineCanvasOpened, true);
  assert.equal(result.browserRuntimeAttempted, true);
  assert.equal(result.inlineFallbackAuthorized, true);
  assert.equal(result.canvasSurfaceReady, true);
  assert.equal(result.ok, true);
});

test("rejects a claimed inline fallback when the Browser runtime was never attempted", () => {
  const result = auditDirectorXTurn([
    record({ type: "message", text: "[@directorx](plugin://directorx@openmoss-local) 做宣传片" }),
    record({ type: "custom_tool_call", name: "exec", input: "await tools.mcp__directorx_production__directorx_capability_preflight({projectPath, outcome, availableAgentTypes});" }),
    record({ type: "custom_tool_call", name: "exec", input: "await tools.create_goal({objective: outcome});" }),
    record({ type: "custom_tool_call", name: "exec", input: "await tools.mcp__directorx_production__directorx_open_inline_canvas({projectPath, preflightId, outcome, fallbackReason:'host_capability_absent', failureDetail:'No Browser tool name was listed.'});" }),
    record({ type: "function_call", name: "request_user_input" }),
    record({ type: "function_call", name: "directorx_resolve_user_interaction" }),
    record({ type: "custom_tool_call", name: "exec", input: "await tools.mcp__directorx_production__directorx_create_run({projectPath, preflightId});" }),
    record({ type: "custom_tool_call", name: "exec", input: "await tools.mcp__directorx_production__directorx_bind_goal({projectPath, runId, codexGoalId});" })
  ]);

  assert.equal(result.actions.includes("create_goal"), true);
  assert.equal(result.browserRuntimeAttempted, false);
  assert.equal(result.inlineFallbackAuthorized, false);
  assert.match(result.failures.join("\n"), /without an observed Browser runtime attempt/i);
});

test("rejects boot actions that exist but execute in the wrong order", () => {
  const result = auditDirectorXTurn([
    record({ type: "message", text: "[@directorx](plugin://directorx@openmoss-local) 做宣传片" }),
    record({ type: "function_call", name: "directorx_capability_preflight" }),
    record({ type: "function_call", name: "directorx_get_preflight_status" }),
    record({ type: "browser_call", action: "navigate", url: "http://127.0.0.1:1234/directorx/canvas", visibility: true }),
    record({ type: "browser_call", action: "finalize", keep: [{ status: "handoff" }] }),
    record({ type: "function_call", name: "create_goal" }),
    record({ type: "function_call", name: "request_user_input" }),
    record({ type: "function_call", name: "directorx_resolve_user_interaction" }),
    record({ type: "function_call", name: "directorx_create_run" }),
    record({ type: "function_call", name: "directorx_bind_goal" })
  ]);
  assert.equal(result.bootSequence.ok, false);
  assert.match(result.failures.join("\n"), /invalid boot action order/);
});

test("rejects navigation to an unrelated browser page as a Director X canvas open", () => {
  const records = completeBoot();
  records[3] = record({ type: "browser_call", action: "navigate", url: "https://example.com", visibility: true });
  const result = auditDirectorXTurn(records);
  assert.equal(result.canvasTargetMatched, false);
  assert.equal(result.canvasOpened, false);
  assert.match(result.failures.join("\n"), /exact preflight URL/);
});

test("audits only the first ready dependency wave and requires canonical registration", () => {
  const tasks = [
    { taskId: "refs", stage: "research", dependsOnTaskIds: [] },
    { taskId: "assets", stage: "research", dependsOnTaskIds: [] },
    { taskId: "routing", stage: "research", dependsOnTaskIds: ["refs"] }
  ];
  const ready = auditDirectorXTurn([
    ...completeBoot(),
    record({ type: "function_call", name: "directorx_plan_parallel_subagents", arguments: { tasks, hostConcurrencyLimit: 2 } }),
    record({ type: "function_call", name: "spawn_agent", arguments: { agent_type: "explorer", message: "DX refs" } }),
    record({ type: "function_call", name: "spawn_agent", arguments: { agent_type: "explorer", message: "DX assets" } }),
    record({ type: "function_call", name: "directorx_register_subagent", arguments: { displayName: "DX-Reference-Analyst" } }),
    record({ type: "function_call", name: "directorx_register_subagent", arguments: { displayName: "DX-Asset-Manager" } })
  ]);
  assert.equal(ready.plannedTaskCount, 3);
  assert.equal(ready.expectedInitialSpawnCount, 2);
  assert.equal(ready.parallelDispatchObserved, true);
  assert.equal(ready.ok, true);

  const invalid = auditDirectorXTurn([
    ...completeBoot(),
    record({ type: "function_call", name: "directorx_plan_parallel_subagents", arguments: { tasks, hostConcurrencyLimit: 2 } }),
    record({ type: "function_call", name: "spawn_agent", arguments: { agent_type: "explorer", message: "DX refs" } }),
    record({ type: "function_call", name: "spawn_agent", arguments: { agent_type: "explorer", message: "DX assets" } }),
    record({ type: "function_call", name: "directorx_register_subagent", arguments: { displayName: "Reference Analyst" } }),
    record({ type: "function_call", name: "directorx_register_subagent", arguments: { displayName: "DX-Asset-Manager" } })
  ]);
  assert.match(invalid.failures.join("\n"), /non-canonical identities/);
});

test("rejects premature Codex Goal completion without the Director X completion gate", () => {
  const blocked = auditDirectorXTurn([
    ...completeBoot(),
    record({ type: "function_call", name: "update_goal", arguments: { status: "complete" } })
  ]);
  assert.equal(blocked.goalCompletionPrepared, false);
  assert.match(blocked.failures.join("\n"), /without directorx_prepare_goal_completion/);

  const ready = auditDirectorXTurn([
    ...completeBoot(),
    record({ type: "function_call", name: "directorx_prepare_goal_completion" }),
    record({ type: "function_call", name: "update_goal", arguments: { status: "complete" } })
  ]);
  assert.equal(ready.goalCompletionPrepared, true);
  assert.equal(ready.ok, true);
});
