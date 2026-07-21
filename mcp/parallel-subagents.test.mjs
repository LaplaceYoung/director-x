import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCanInstallSubagentPlan, assertStageParallelDispatchStarted, assertStageParallelismObserved, compileExecutionGraphSubagentTasks, compileParallelSubagentDispatchEvidence, planParallelSubagents, writeParallelSubagentDispatchEvidence, writeParallelSubagentPlan } from "./parallel-subagents.mjs";
import { DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID } from "./subagent-prompt-contract.mjs";
import { DX_SUBAGENT_CATALOG } from "./subagent-registry.mjs";

const availableAgentTypes = DX_SUBAGENT_CATALOG.map((role) => role.agentType);
const input = (value) => ({ ...value, availableAgentTypes });

function task(taskId, roleId, outputArtifactRefs, dependsOnTaskIds = []) {
  return {
    taskId, roleId, stage: "research", mission: `Complete ${taskId}`,
    inputArtifactRefs: ["Director.md"], outputArtifactRefs, dependsOnTaskIds,
    allowedTools: ["web_search"], restrictedTools: ["provider_generation"],
    stopCondition: "Required artifacts are registered.", escalationTriggers: ["rights are unknown"],
    maxAttempts: 2, maxCost: 0, currency: "CNY", approvalBoundary: "Escalate before downloads that require separate user consent."
  };
}

test("builds canonical DX host actions in dependency-layered parallel batches", () => {
  const plan = planParallelSubagents({ runId: "dx-test" }, input({
    projectPath: "/tmp/directorx-project", planId: "research-wave", objective: "Research a brand film",
    tasks: [
      task("references", "reference_analyst", ["reference_analysis.json"]),
      task("assets", "asset_manager", ["asset_manifest.json"]),
      task("routing", "director_runtime", ["provider_route.json"], ["references"])
    ]
  }), "2026-07-15T00:00:00.000Z");
  assert.equal(plan.maxConcurrency, 2);
  assert.deepEqual(plan.batches.map((batch) => batch.taskIds), [["references", "assets"], ["routing"]]);
  assert.equal(plan.batches[0].hostActions[0].arguments.agent_type, "dx_reference_analyst");
  assert.equal(plan.batches[0].hostActions[0].arguments.message, plan.tasks[0].prompt);
  assert.equal(plan.batches[0].hostActions[0].arguments.prompt, undefined);
  assert.equal(plan.batches[0].hostActions[0].expectedNickname, "DX-Reference-Analyst");
  assert.equal(plan.batches[0].hostActions[0].hostNicknamePolicy, "canonical_or_codex_ordinal_variant");
  assert.equal(plan.batches[0].hostActions[0].afterTerminal.hostAction.tool, "close_agent");
  assert.equal(plan.batches[0].hostActions[0].afterTerminal.hostAction.arguments.target, "$registeredHostAgentId");
  assert.equal(plan.batches[0].hostActions[0].afterTerminal.hostAction.arguments.id, undefined);
  assert.equal(plan.batches[0].hostActions[0].afterTerminal.confirmTool, "directorx_confirm_subagent_host_closed");
  assert.equal(plan.tasks[0].hostLifecycle, "not_spawned");
  assert.equal(plan.tasks[0].hostReleaseRequired, true);
  assert.equal(plan.batches[0].status, "pending");
  assert.equal(plan.delegationDepth, 0);
  assert.equal(plan.childDelegationDepth, 1);
  assert.equal(plan.maxDelegationDepth, 1);
  assert.equal(plan.nestedDelegationAllowed, false);
  assert.equal(plan.tasks[0].delegationDepth, 1);
  assert.equal(plan.tasks[0].maxDelegationDepth, 1);
  assert.equal(plan.tasks[0].nestedDelegationAllowed, false);
  assert.equal(plan.batches[0].hostActions[0].delegationDepth, 1);
  assert.equal(plan.batches[0].hostActions[0].nestedDelegationAllowed, false);
  assert.ok(plan.tasks[0].restrictedTools.includes("spawn_agent"));
  assert.ok(plan.tasks[0].restrictedTools.includes("directorx_plan_production_team"));
  assert.ok(plan.tasks[0].restrictedTools.includes("directorx_plan_parallel_subagents"));
  assert.match(plan.tasks[0].prompt, /^Director X identity: DX-Reference-Analyst\./);
  assert.match(plan.tasks[0].prompt, /Active project path: \/tmp\/directorx-project/);
  assert.match(plan.tasks[0].prompt, /Active Director X Run ID: dx-test/);
  assert.match(plan.tasks[0].prompt, /Do not invoke @directorx, rerun preflight/);
  assert.match(plan.tasks[0].prompt, /Delegation depth: 1\/1\. Nested delegation is forbidden/);
  assert.match(plan.tasks[0].prompt, /Do not call spawn_agent, directorx_plan_production_team, directorx_plan_parallel_subagents/);
  assert.match(plan.tasks[0].prompt, /Cost and attempt cap/);
  assert.match(plan.tasks[0].prompt, new RegExp(DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID));
  assert.match(plan.tasks[0].prompt, /Escalate rights, credential, provider, model, budget/);
});

test("compiles a bounded DX production team directly from the execution graph", () => {
  const run = {
    runId: "dx-auto-team",
    productionComplexityPlan: { profile: "standard", settings: { maxConcurrency: 4, maxSubagentTasksPerStage: 4 } },
    executionGraph: {
      intentSummary: "Create a source-grounded product film",
      nodes: [
        { nodeId: "research-refs", kind: "agent", owner: "DX-Reference-Analyst", stage: "research", label: "Research references", dependsOn: [], inputArtifactRefs: ["Director.md"], outputArtifactRefs: ["reference_analysis.json"] },
        { nodeId: "research-assets", kind: "agent", owner: "DX-Asset-Manager", stage: "research", label: "Acquire and audit assets", dependsOn: [], inputArtifactRefs: ["Director.md"], outputArtifactRefs: ["asset_manifest.json"] },
        { nodeId: "research-gate", kind: "review", stage: "research", label: "Research gate", dependsOn: ["research-refs", "research-assets"], inputArtifactRefs: ["reference_analysis.json", "asset_manifest.json"], outputArtifactRefs: [] },
        { nodeId: "script-director", kind: "agent", owner: "DX-Director", stage: "script", label: "Write the causal script", dependsOn: ["research-gate"], inputArtifactRefs: ["reference_analysis.json", "asset_manifest.json"], outputArtifactRefs: ["script_or_outline.json"] }
      ]
    }
  };
  const tasks = compileExecutionGraphSubagentTasks(run, { currency: "CNY" });
  assert.deepEqual(tasks.map((item) => item.taskId), ["dx-research-asset_manager", "dx-research-reference_analyst", "dx-script-director_runtime"]);
  assert.deepEqual(tasks[2].dependsOnTaskIds, ["dx-research-asset_manager", "dx-research-reference_analyst"]);
  assert.deepEqual(tasks[0].allowedTools, ["directorx_get_run_snapshot", "web_search", "web_open", "directorx_register_asset_search_plan", "directorx_acquire_web_image_asset", "directorx_register_asset", "directorx_audit_asset_quality", "directorx_audit_visual_asset_coverage"]);
  assert.match(tasks[1].mission, /Research references/);
  const plan = planParallelSubagents(run, input({
    projectPath: "/tmp/directorx-project",
    planId: "auto-team",
    objective: "Create the film through the execution graph",
    tasks
  }));
  assert.deepEqual(plan.batches.map((batch) => batch.taskIds), [
    ["dx-research-asset_manager", "dx-research-reference_analyst"],
    ["dx-script-director_runtime"]
  ]);
});

test("gives generation roles the tools needed for prompt compilation, provider execution, and evidence review", () => {
  const run = {
    runId: "dx-generation-team",
    productionComplexityPlan: { profile: "standard", settings: { maxConcurrency: 4, maxSubagentTasksPerStage: 4 } },
    executionGraph: {
      intentSummary: "Generate reviewed image and video shots",
      nodes: [
        { nodeId: "prompts", kind: "agent", owner: "DX-Shot-Planner", stage: "storyboard", label: "Compile visual prompts", dependsOn: [], inputArtifactRefs: ["shotlist.json"], outputArtifactRefs: ["visual_prompt_pack.json"] },
        { nodeId: "route", kind: "agent", owner: "DX-Director", stage: "generation", label: "Bind exact model route", dependsOn: ["prompts"], inputArtifactRefs: ["visual_prompt_pack.json"], outputArtifactRefs: ["generation_request.json"] },
        { nodeId: "execute", kind: "agent", owner: "DX-Provider-Operator", stage: "generation", label: "Generate and localize candidates", dependsOn: ["route"], inputArtifactRefs: ["generation_request.json"], outputArtifactRefs: ["attempt_log.json"] },
        { nodeId: "review", kind: "agent", owner: "DX-Draw-Loop", stage: "generation", label: "Review and select candidates", dependsOn: ["execute"], inputArtifactRefs: ["attempt_log.json"], outputArtifactRefs: ["selected_clips.json"] }
      ]
    }
  };
  const tasks = compileExecutionGraphSubagentTasks(run);
  const byRole = new Map(tasks.map((item) => [item.roleId, item]));
  assert.ok(byRole.get("shot_planner").allowedTools.includes("directorx_compile_visual_prompt_pack"));
  assert.ok(byRole.get("director_runtime").allowedTools.includes("directorx_probe_provider_capability"));
  assert.ok(byRole.get("director_runtime").allowedTools.includes("directorx_register_prompt_bound_generation_plan"));
  assert.ok(byRole.get("provider_operator").allowedTools.includes("directorx_submit_media_generation"));
  assert.ok(byRole.get("provider_operator").allowedTools.includes("directorx_poll_media_generation"));
  assert.ok(byRole.get("draw_loop_controller").allowedTools.includes("directorx_review_generation_candidate"));
  assert.ok(byRole.get("draw_loop_controller").allowedTools.includes("directorx_compile_generation_repair"));
  assert.deepEqual(byRole.get("provider_operator").dependsOnTaskIds, ["dx-generation-director_runtime"]);
  assert.deepEqual(byRole.get("draw_loop_controller").dependsOnTaskIds, ["dx-generation-provider_operator"]);
});

test("rejects an execution graph that overstaffs the selected complexity profile", () => {
  const run = {
    productionComplexityPlan: { profile: "quick", settings: { maxConcurrency: 2, maxSubagentTasksPerStage: 2 } },
    executionGraph: {
      intentSummary: "Quick film",
      nodes: [
        { nodeId: "a", kind: "agent", owner: "DX-Reference-Analyst", stage: "research", label: "A", dependsOn: [], inputArtifactRefs: [], outputArtifactRefs: ["a.json"] },
        { nodeId: "b", kind: "agent", owner: "DX-Asset-Manager", stage: "research", label: "B", dependsOn: [], inputArtifactRefs: [], outputArtifactRefs: ["b.json"] },
        { nodeId: "c", kind: "agent", owner: "DX-Director", stage: "research", label: "C", dependsOn: [], inputArtifactRefs: [], outputArtifactRefs: ["c.json"] }
      ]
    }
  };
  assert.throws(() => compileExecutionGraphSubagentTasks(run), /quick profile.*research has 3 DX roles, limit 2/);
});

test("rejects nested delegation tools in delegated task allowlists", () => {
  const nestedTask = task("references", "reference_analyst", ["reference_analysis.json"]);
  nestedTask.allowedTools.push("spawn_agent");
  assert.throws(() => planParallelSubagents({ runId: "dx-test" }, input({
    planId: "nested-wave",
    objective: "Do not recursively delegate",
    tasks: [
      nestedTask,
      task("assets", "asset_manager", ["asset_manifest.json"])
    ]
  })), /cannot allow nested delegation tools: spawn_agent/);
  const nestedTeamTask = task("assets", "asset_manager", ["asset_manifest.json"]);
  nestedTeamTask.allowedTools.push("directorx_plan_production_team");
  assert.throws(() => planParallelSubagents({ runId: "dx-test" }, input({
    planId: "nested-production-team",
    objective: "Do not recursively plan a production team",
    tasks: [task("references", "reference_analyst", ["reference_analysis.json"]), nestedTeamTask]
  })), /cannot allow nested delegation tools: directorx_plan_production_team/);
});

test("keeps one immutable delegation tree per Director X run", () => {
  assert.deepEqual(assertCanInstallSubagentPlan({ runId: "dx-test" }, "research-wave"), { status: "new_plan" });
  const existing = { planId: "research-wave", tasks: [] };
  assert.equal(assertCanInstallSubagentPlan({ runId: "dx-test", subagentOrchestrationPlan: existing }, "research-wave").status, "existing_plan");
  assert.throws(
    () => assertCanInstallSubagentPlan({ runId: "dx-test", subagentOrchestrationPlan: existing }, "replacement-wave"),
    /already owns subagent plan research-wave/
  );
});

test("bounds independent DX work to the host concurrency capacity", () => {
  const roles = ["task_planner", "reference_analyst", "asset_manager", "director_runtime"];
  const plan = planParallelSubagents({ runId: "dx-test" }, input({
    planId: "capacity-wave", objective: "Reduce the research critical path", hostConcurrencyLimit: 2,
    tasks: roles.map((roleId, index) => task(`task-${index + 1}`, roleId, [`output-${index + 1}.json`]))
  }), "2026-07-16T01:00:00.000Z");
  assert.equal(plan.strategy, "capacity_bounded_dependency_layered_parallelism");
  assert.equal(plan.independentWidth, 4);
  assert.equal(plan.hostConcurrencyLimit, 2);
  assert.equal(plan.maxConcurrency, 2);
  assert.equal(plan.estimatedDispatchWaves, 2);
  assert.deepEqual(plan.batches.map((batch) => batch.taskIds.length), [2, 2]);
  assert.equal(plan.batches[0].parallelGroupId, "capacity-wave:wave:1");
  assert.equal(plan.batches[0].hostActions[0].parallelGroupId, "capacity-wave:wave:1");
  assert.match(plan.schedulingPolicy, /without awaiting individual results/);
});

test("prevents a quick production from spawning a full department for one stage", () => {
  const run = {
    runId: "dx-test",
    productionComplexityPlan: { profile: "quick", settings: { maxConcurrency: 2, maxSubagentTasksPerStage: 2 } }
  };
  assert.throws(() => planParallelSubagents(run, input({
    planId: "overstaffed-quick", objective: "Make a simple preview",
    tasks: [
      task("references", "reference_analyst", ["references.json"]),
      task("assets", "asset_manager", ["assets.json"]),
      task("routing", "director_runtime", ["routing.json"])
    ]
  })), /quick production profile permits at most 2 delegated tasks per stage/);
});

test("compiles durable overlap evidence from real task dispatch intervals", async () => {
  const plan = planParallelSubagents({ runId: "dx-test" }, input({
    planId: "dispatch-wave", objective: "prove concurrent dispatch",
    tasks: [task("refs", "reference_analyst", ["refs.json"]), task("assets", "asset_manager", ["assets.json"])]
  }), "2026-07-16T01:00:00.000Z");
  plan.batches[0].status = "running";
  plan.batches[0].startedAt = "2026-07-16T01:00:01.000Z";
  plan.tasks[0].dispatchReceipt = { taskId: "refs", dispatchedAt: "2026-07-16T01:00:01.000Z", terminalAt: "2026-07-16T01:00:04.000Z" };
  plan.tasks[1].dispatchReceipt = { taskId: "assets", dispatchedAt: "2026-07-16T01:00:02.000Z", terminalAt: "2026-07-16T01:00:05.000Z" };
  const evidence = compileParallelSubagentDispatchEvidence(plan);
  assert.equal(evidence.parallelismObserved, true);
  assert.equal(evidence.batches[0].overlapObserved, true);
  assert.deepEqual(evidence.batches[0].overlapPairs, [{ leftTaskId: "refs", rightTaskId: "assets", overlap: true }]);
  const projectPath = await mkdtemp(join(tmpdir(), "dx-dispatch-"));
  try {
    const written = await writeParallelSubagentDispatchEvidence({ projectPath, runId: "dx-test", plan });
    assert.equal(written.artifactRef, "parallel_subagent_dispatch.json");
    assert.equal(JSON.parse(await readFile(written.path, "utf8")).parallelismObserved, true);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("blocks owned stage work until the complete DX wave is dispatched and overlap is observed", () => {
  const run = { runId: "dx-test" };
  run.subagentOrchestrationPlan = planParallelSubagents(run, input({
    planId: "hard-gate", objective: "force real parallel production",
    tasks: [task("refs", "reference_analyst", ["refs.json"]), task("assets", "asset_manager", ["assets.json"])]
  }), "2026-07-16T01:00:00.000Z");
  assert.throws(() => assertStageParallelDispatchStarted(run, "research", "refs.json"), /complete DX parallel wave/);

  const [refs, assets] = run.subagentOrchestrationPlan.tasks;
  refs.hostAgentId = "agent-refs";
  refs.hostLifecycle = "active";
  refs.dispatchReceipt = { taskId: "refs", dispatchedAt: "2026-07-16T01:00:01.000Z", terminalAt: "2026-07-16T01:00:04.000Z" };
  assert.throws(() => assertStageParallelDispatchStarted(run, "research", "refs.json"), /DX-Asset-Manager/);
  assets.hostAgentId = "agent-assets";
  assets.hostLifecycle = "active";
  assets.dispatchReceipt = { taskId: "assets", dispatchedAt: "2026-07-16T01:00:02.000Z", terminalAt: "2026-07-16T01:00:05.000Z" };
  assert.equal(assertStageParallelDispatchStarted(run, "research", "refs.json").status, "dispatched");
  assert.equal(assertStageParallelismObserved(run, "research").status, "observed");

  assets.dispatchReceipt.dispatchedAt = "2026-07-16T01:00:05.000Z";
  assert.throws(() => assertStageParallelismObserved(run, "research"), /sequential or missing dispatch/);
});

test("rejects fake parallelism, duplicate roles, and output ownership", () => {
  assert.throws(() => planParallelSubagents({ runId: "dx-test" }, input({
    planId: "serial", objective: "serial",
    tasks: [task("a", "reference_analyst", ["a.json"]), task("b", "asset_manager", ["b.json"], ["a"])]
  })), /no independent tasks/);
  assert.throws(() => planParallelSubagents({ runId: "dx-test" }, input({
    planId: "roles", objective: "roles",
    tasks: [task("a", "asset_manager", ["a.json"]), task("b", "asset_manager", ["b.json"])]
  })), /only once/);
  assert.throws(() => planParallelSubagents({ runId: "dx-test" }, input({
    planId: "outputs", objective: "outputs",
    tasks: [task("a", "reference_analyst", ["same.json"]), task("b", "asset_manager", ["same.json"])]
  })), /multiple subagent producers/);
});

test("requires planned agent outputs to match execution-graph ownership", () => {
  const run = { runId: "dx-test", executionGraph: { nodes: [
    { kind: "agent", owner: "DX-Reference-Analyst", stage: "research", outputArtifactRefs: ["reference_analysis.json"] },
    { kind: "agent", owner: "DX-Asset-Manager", stage: "research", outputArtifactRefs: ["asset_manifest.json"] }
  ] } };
  assert.doesNotThrow(() => planParallelSubagents(run, input({
    planId: "owned", objective: "owned",
    tasks: [task("refs", "reference_analyst", ["reference_analysis.json"]), task("assets", "asset_manager", ["asset_manifest.json"])]
  })));
  assert.throws(() => planParallelSubagents(run, input({
    planId: "unowned", objective: "unowned",
    tasks: [task("refs", "reference_analyst", ["reference_manifest.json"]), task("assets", "asset_manager", ["asset_manifest.json"])]
  })), /outside its execution-graph ownership/);
});

test("writes the parallel subagent plan as a durable artifact", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-parallel-"));
  try {
    const plan = planParallelSubagents({ runId: "dx-test" }, input({
      planId: "wave", objective: "parallel",
      tasks: [task("a", "reference_analyst", ["a.json"]), task("b", "asset_manager", ["b.json"])]
    }));
    const written = await writeParallelSubagentPlan({ projectPath, runId: "dx-test", plan });
    assert.equal(written.artifactRef, "parallel_subagent_plan.json");
    assert.equal(JSON.parse(await readFile(written.path, "utf8")).maxConcurrency, 2);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("fails before emitting host actions when the current session has not loaded a DX role", () => {
  assert.throws(() => planParallelSubagents({ runId: "dx-test" }, {
    planId: "stale", objective: "stale session", availableAgentTypes: ["dx_reference_analyst"],
    tasks: [task("refs", "reference_analyst", ["reference.json"]), task("assets", "asset_manager", ["assets.json"])]
  }), /cannot route DX-Asset-Manager/);
});

test("maps canonical DX tasks onto built-in Codex hosts without losing production identity", () => {
  const plan = planParallelSubagents({ runId: "dx-test" }, {
    planId: "compat", objective: "parallel production without restart",
    availableAgentTypes: ["default", "worker", "explorer"],
    tasks: [
      task("refs", "reference_analyst", ["reference.json"]),
      task("assets", "asset_manager", ["assets.json"])
    ]
  }, "2026-07-16T02:00:00.000Z");
  assert.deepEqual(plan.tasks.map((item) => item.agentType), ["explorer", "explorer"]);
  assert.ok(plan.tasks.every((item) => item.hostAgentTypeMode === "builtin_compatibility"));
  assert.ok(plan.tasks.every((item) => item.expectedNickname === null));
  assert.ok(plan.tasks.every((item) => item.hostNicknamePolicy === "host_trace_only"));
  assert.ok(plan.tasks.every((item) => item.identityTransport === "prompt_registry_and_canvas"));
  assert.deepEqual(plan.batches[0].hostActions.map((action) => action.arguments.agent_type), ["explorer", "explorer"]);
  assert.deepEqual(plan.batches[0].hostActions.map((action) => action.expectedCanonicalIdentity), ["DX-Reference-Analyst", "DX-Asset-Manager"]);
});

test("compiles current Codex collaboration spawn actions and terminal-event lifecycle", () => {
  const plan = planParallelSubagents({ runId: "dx-test" }, {
    projectPath: "/tmp/directorx-project",
    planId: "collaboration", objective: "parallel production on collaboration task hosts",
    availableAgentTypes: ["collaboration_task"],
    tasks: [
      task("refs", "reference_analyst", ["reference.json"]),
      task("assets", "asset_manager", ["assets.json"])
    ]
  }, "2026-07-16T02:00:00.000Z");
  const [action] = plan.batches[0].hostActions;
  assert.equal(plan.tasks[0].hostAgentTypeMode, "collaboration_task");
  assert.equal(plan.tasks[0].hostReleaseRequired, false);
  assert.equal(plan.tasks[0].hostReleaseStrategy, "terminal_event");
  assert.deepEqual(action.arguments, {
    task_name: "dx_reference_analyst_refs",
    fork_turns: "all",
    message: plan.tasks[0].prompt
  });
  assert.equal(action.arguments.agent_type, undefined);
  assert.equal(action.hostIdentitySource, "sub_agent_activity.agent_thread_id");
  assert.equal(action.afterSpawn.arguments.hostAgentId, "$spawn_agent.event.agent_thread_id");
  assert.equal(action.afterSpawn.arguments.hostNickname, "$spawn_agent.result.task_name");
  assert.equal(action.afterSpawn.arguments.displayName, "DX-Reference-Analyst");
  assert.equal(action.afterTerminal.hostAction.tool, "wait_agent");
  assert.equal(action.afterTerminal.evidenceSource, "sub_agent_activity");
  assert.equal(action.afterTerminal.confirmTool, undefined);
});
