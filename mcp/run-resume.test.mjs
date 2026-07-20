import test from "node:test";
import assert from "node:assert/strict";
import { buildRunResumeActionPlan } from "./run-resume.mjs";

const canvasBinding = {
  canvasHostAction: { type: "in_app_browser", action: "open_or_claim", tabKey: "directorx:dx-test", url: "http://127.0.0.1/canvas", visibility: true, required: true },
  canvasTurnEndAction: { type: "browser_tabs_finalize", tabKey: "directorx:dx-test", keepStatus: "handoff", required: true },
  canvasSurfaceHealth: { status: "stale" }
};

function task(overrides = {}) {
  return {
    taskId: "refs", stage: "research", status: "pending", hostAgentId: null, hostLifecycle: "not_spawned",
    hostReleaseRequired: true, dependsOnTaskIds: [], agentType: "dx_reference_analyst",
    roleId: "reference_analyst", displayName: "DX-Reference-Analyst", mission: "Research references",
    inputArtifactRefs: ["Director.md"], outputArtifactRefs: ["reference_analysis.json"],
    prompt: "Director X identity: DX-Reference-Analyst.", ...overrides
  };
}

function snapshot(overrides = {}) {
  const first = task();
  return {
    runId: "dx-test", status: "production_in_progress", stage: "research",
    interactions: { pending: [], history: [] }, subagents: [], openCutEditor: null,
    subagentOrchestrationPlan: {
      planId: "research", tasks: [first], batches: [{ batchId: "research-batch-1", order: 1, taskIds: [first.taskId] }]
    },
    ...overrides
  };
}

test("rebinds surfaces before releasing terminal DX hosts with the current Codex target schema", () => {
  const plan = buildRunResumeActionPlan(snapshot({ subagents: [{ displayName: "DX-Editor", status: "complete", hostLifecycle: "release_required", hostAgentId: "agent-edit" }] }), { projectPath: "/tmp/project", canvasBinding, now: "2026-07-16T00:00:00.000Z" });
  assert.equal(plan.groups[0].phase, "surface_rebind");
  assert.equal(plan.groups[0].actions[0].surface, "canvas");
  assert.equal(plan.groups[1].actions[0].tool, "close_agent");
  assert.deepEqual(plan.groups[1].actions[0].arguments, { target: "agent-edit" });
  assert.equal(plan.groups[1].actions[0].arguments.id, undefined);
  assert.equal(plan.blockedBy, "terminal_subagent_host_release");
  assert.equal(plan.groups[3].actions.length, 0);
});

test("native request_user_input blocks new subagent dispatch but not surface recovery", () => {
  const question = { id: "budget", header: "预算", question: "请选择预算", options: [{ label: "低预算", description: "快速试片" }, { label: "正式预算", description: "提高质量" }] };
  const plan = buildRunResumeActionPlan(snapshot({ interactions: { pending: [{ requestId: "dxq-1", questions: [question] }], history: [] } }), { canvasBinding });
  assert.equal(plan.groups[0].actions.length, 1);
  assert.equal(plan.groups[2].actions[0].tool, "request_user_input");
  assert.deepEqual(plan.groups[2].actions[0].arguments.questions, [question]);
  assert.deepEqual(plan.groups[2].actions[0].afterAnswer, {
    tool: "directorx_resolve_user_interaction",
    arguments: {
      projectPath: "$projectPath",
      runId: "dx-test",
      requestId: "dxq-1",
      confirmedBy: "request_user_input",
      answers: "$request_user_input.answers"
    }
  });
  assert.equal(plan.groups[3].actions.length, 0);
  assert.equal(plan.blockedBy, "native_interactions:dxq-1");
});

test("batches up to three ready native questions and resolves their stable request IDs", () => {
  const pending = ["image_model", "video_model", "voice_model", "music_route"].map((id, index) => ({
    requestId: `dxq-${index + 1}`,
    status: "pending",
    kind: id,
    questions: [{
      id,
      header: id,
      question: `Choose ${id}`,
      options: [{ label: "A", description: "First" }, { label: "B", description: "Second" }]
    }]
  }));
  const plan = buildRunResumeActionPlan(snapshot({ interactions: { pending, history: [] } }), {
    projectPath: "/tmp/project",
    canvasBinding: { ...canvasBinding, canvasSurfaceHealth: { status: "connected" } }
  });
  const action = plan.groups[2].actions[0];
  assert.deepEqual(action.arguments.questions.map((question) => question.id), ["image_model", "video_model", "voice_model"]);
  assert.deepEqual(action.sourceRequestIds, ["dxq-1", "dxq-2", "dxq-3"]);
  assert.equal(action.afterAnswer.type, "mcp_tool_sequence");
  assert.deepEqual(action.afterAnswer.actions.map((item) => item.arguments.requestId), ["dxq-1", "dxq-2", "dxq-3"]);
  assert.equal(plan.nativeInteraction.requestId, "dxq-1");
  assert.equal(plan.nativeInteractionBatch.questionCount, 3);
  assert.match(plan.attention, /Ask 3 ready production decisions together/);
  assert.equal(plan.groups[3].actions.length, 0);
});

test("emits every same-stage ready DX spawn action concurrently with message, never prompt", () => {
  const first = task();
  const second = task({
    taskId: "assets", roleId: "asset_manager", agentType: "dx_asset_manager",
    displayName: "DX-Asset-Manager", mission: "Acquire assets",
    outputArtifactRefs: ["asset_manifest.json"], prompt: "Director X identity: DX-Asset-Manager."
  });
  const plan = buildRunResumeActionPlan(snapshot({ subagentOrchestrationPlan: { planId: "research", tasks: [first, second], batches: [{ batchId: "research-batch-1", order: 1, taskIds: ["refs", "assets"] }] } }), { canvasBinding });
  const actions = plan.groups[3].actions;
  assert.equal(actions.length, 2);
  assert.ok(actions.every((action) => action.concurrentGroup === "research-batch-1"));
  assert.deepEqual(actions.map((action) => action.arguments.agent_type), ["dx_reference_analyst", "dx_asset_manager"]);
  assert.equal(actions[0].arguments.message, first.prompt);
  assert.equal(actions[0].arguments.prompt, undefined);
});

test("resumes built-in compatibility hosts with canonical DX identity outside the nickname", () => {
  const first = task({
    agentType: "explorer", preferredAgentType: "dx_reference_analyst",
    hostAgentTypeMode: "builtin_compatibility", expectedNickname: null,
    hostNicknamePolicy: "host_trace_only", identityTransport: "prompt_registry_and_canvas"
  });
  const plan = buildRunResumeActionPlan(snapshot({
    subagentOrchestrationPlan: { planId: "research", tasks: [first], batches: [{ batchId: "research-batch-1", order: 1, taskIds: ["refs"] }] }
  }), { canvasBinding });
  const action = plan.groups[3].actions[0];
  assert.equal(action.arguments.agent_type, "explorer");
  assert.equal(action.expectedNickname, null);
  assert.equal(action.expectedCanonicalIdentity, "DX-Reference-Analyst");
  assert.equal(action.hostNicknamePolicy, "host_trace_only");
  assert.equal(action.identityTransport, "prompt_registry_and_canvas");
});

test("resumes collaboration task hosts with task_name schema and full registration handoff", () => {
  const first = task({
    roleId: "reference_analyst", mission: "Research references",
    inputArtifactRefs: ["Director.md"], outputArtifactRefs: ["reference_analysis.json"],
    agentType: "collaboration_task", preferredAgentType: "dx_reference_analyst",
    hostAgentTypeMode: "collaboration_task", expectedNickname: null,
    hostNicknamePolicy: "host_task_path_trace_only",
    identityTransport: "prompt_registry_canvas_and_sub_agent_activity",
    hostIdentitySource: "sub_agent_activity.agent_thread_id",
    hostReleaseStrategy: "terminal_event", hostReleaseRequired: false
  });
  const plan = buildRunResumeActionPlan(snapshot({
    subagentOrchestrationPlan: { planId: "research", tasks: [first], batches: [{ batchId: "research-batch-1", order: 1, taskIds: ["refs"] }] }
  }), { projectPath: "/tmp/project", canvasBinding });
  const action = plan.groups[3].actions[0];
  assert.deepEqual(action.arguments, {
    task_name: "dx_reference_analyst_refs",
    fork_turns: "all",
    message: first.prompt
  });
  assert.equal(action.hostIdentitySource, "sub_agent_activity.agent_thread_id");
  assert.equal(action.afterSpawn.arguments.projectPath, "/tmp/project");
  assert.equal(action.afterSpawn.arguments.hostAgentId, "$spawn_agent.event.agent_thread_id");
  assert.equal(action.afterSpawn.arguments.hostNickname, "$spawn_agent.result.task_name");
  assert.equal(action.afterSpawn.arguments.displayName, "DX-Reference-Analyst");
  assert.equal(action.afterTerminal.hostAction.tool, "wait_agent");
});

test("does not duplicate a running or host-bound DX task", () => {
  const running = task({ status: "running", hostLifecycle: "active", hostAgentId: "agent-ref" });
  const plan = buildRunResumeActionPlan(snapshot({ subagentOrchestrationPlan: { planId: "research", tasks: [running], batches: [{ batchId: "research-batch-1", order: 1, taskIds: ["refs"] }] } }), { canvasBinding });
  assert.equal(plan.groups[3].actions.length, 0);
});

test("rebinds an active editor and preserves both side-browser surfaces at turn end", () => {
  const editorBinding = {
    editorHostAction: { type: "in_app_browser", action: "open_or_claim", tabKey: "directorx-cut:dx-test", url: "http://127.0.0.1/editor", visibility: true, required: true },
    editorTurnEndAction: { type: "browser_tabs_finalize", tabKey: "directorx-cut:dx-test", keepStatus: "handoff", required: true },
    editorSurfaceHealth: { status: "connected" }
  };
  const plan = buildRunResumeActionPlan(snapshot({ openCutEditor: { activeSessionId: "dxe-1" } }), { canvasBinding, editorBinding });
  assert.deepEqual(plan.groups[0].actions.map((action) => action.surface), ["canvas", "editor"]);
  assert.deepEqual(plan.groups[4].actions.map((action) => [action.surface, action.keepStatus]), [["canvas", "handoff"], ["editor", "handoff"]]);
});

test("projects the continuous Goal-to-team bootstrap state and ready first dispatch", () => {
  const first = task();
  const second = task({
    taskId: "assets", roleId: "asset_manager", agentType: "dx_asset_manager",
    displayName: "DX-Asset-Manager", outputArtifactRefs: ["asset_manifest.json"]
  });
  const plan = buildRunResumeActionPlan(snapshot({
    goal: { codexGoalId: "goal-test", boundAt: "2026-07-17T00:00:00.000Z" },
    productionComplexityPlan: { profile: "quick" },
    executionGraph: { graphId: "graph-1" },
    subagentOrchestrationPlan: {
      planId: "research",
      tasks: [first, second],
      batches: [{ batchId: "research-batch-1", order: 1, taskIds: ["refs", "assets"] }]
    }
  }), { canvasBinding });
  assert.equal(plan.schemaVersion, "1.1");
  assert.equal(plan.productionBootstrap.state, "ready_for_parallel_dispatch");
  assert.equal(plan.productionBootstrap.nextRequiredAction, "spawn_ready_wave");
  assert.equal(plan.productionBootstrap.readyBatchId, "research-batch-1");
  assert.deepEqual(plan.productionBootstrap.taskCounts, { total: 2, running: 0, completed: 0 });
});
