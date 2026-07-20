import test from "node:test";
import assert from "node:assert/strict";
import { compileDirectorXGoalBootProtocol, compilePendingInteractionBatch, compileSubagentHostProtocol } from "./host-action-protocol.mjs";

function task(overrides = {}) {
  return {
    taskId: "refs",
    roleId: "reference_analyst",
    displayName: "DX-Reference-Analyst",
    stage: "research",
    mission: "Research references",
    prompt: "Director X identity: DX-Reference-Analyst.",
    inputArtifactRefs: ["Director.md"],
    outputArtifactRefs: ["reference_analysis.json"],
    agentType: "dx_reference_analyst",
    hostAgentTypeMode: "custom_dx_role",
    expectedNickname: "DX-Reference-Analyst",
    hostNicknamePolicy: "canonical_or_codex_ordinal_variant",
    identityTransport: "custom_agent_nickname_and_prompt",
    hostIdentitySource: "spawn_agent.result.agent_id",
    hostReleaseStrategy: "close_agent",
    ...overrides
  };
}

function request(requestId, questionId, overrides = {}) {
  return {
    requestId,
    status: "pending",
    kind: questionId,
    questions: [{
      id: questionId,
      header: questionId,
      question: `Choose ${questionId}`,
      options: [
        { label: "A", description: "First" },
        { label: "B", description: "Second" }
      ]
    }],
    ...overrides
  };
}

test("compiles typed and collaboration subagent adapters through one interface", () => {
  const typed = compileSubagentHostProtocol({ projectPath: "/tmp/project", runId: "dx-test", task: task() });
  assert.deepEqual(typed.spawnArguments, {
    agent_type: "dx_reference_analyst",
    message: "Director X identity: DX-Reference-Analyst."
  });
  assert.equal(typed.afterSpawn.arguments.hostAgentId, "$spawn_agent.result.agent_id");
  assert.equal(typed.afterTerminal.hostAction.tool, "close_agent");

  const collaboration = compileSubagentHostProtocol({
    projectPath: "/tmp/project",
    runId: "dx-test",
    task: task({
      agentType: "collaboration_task",
      hostAgentTypeMode: "collaboration_task",
      expectedNickname: null,
      hostNicknamePolicy: undefined,
      identityTransport: undefined,
      hostIdentitySource: undefined,
      hostReleaseStrategy: undefined
    })
  });
  assert.deepEqual(collaboration.spawnArguments, {
    task_name: "dx_reference_analyst_refs",
    fork_turns: "all",
    message: "Director X identity: DX-Reference-Analyst."
  });
  assert.equal(collaboration.afterSpawn.arguments.hostAgentId, "$spawn_agent.event.agent_thread_id");
  assert.equal(collaboration.afterTerminal.hostAction.tool, "wait_agent");
  assert.equal(collaboration.hostNicknamePolicy, "host_task_path_trace_only");
  assert.equal(collaboration.identityTransport, "prompt_registry_canvas_and_sub_agent_activity");
  assert.equal(collaboration.hostIdentitySource, "sub_agent_activity.agent_thread_id");
  assert.equal(collaboration.hostReleaseStrategy, "terminal_event");
});

test("compiles Goal entry into executable native host actions", () => {
  const protocol = compileDirectorXGoalBootProtocol({
    projectPath: "/tmp/project",
    outcome: "Create a 60-second film",
    preflightId: "preflight-1",
    goalInteractionRequestId: "dxq-goal-1",
    questions: [request("unused", "enter_directorx_goal").questions[0]]
  });
  assert.equal(protocol.requestUserInputAction.tool, "request_user_input");
  assert.equal(protocol.requestUserInputAction.afterAnswer.type, "host_action_sequence");
  assert.deepEqual(protocol.afterAcceptance.map((action) => action.tool), ["directorx_resolve_user_interaction", "create_goal", "directorx_create_run", "directorx_bind_goal"]);
  assert.equal(protocol.afterAcceptance[2].arguments.codexGoalId, "$create_goal.result.goal.threadId");
  assert.equal(protocol.afterAcceptance[3].arguments.codexGoalId, "$create_goal.result.goal.threadId");
});

test("batches three independent native questions into one request and resolves every source request", () => {
  const batch = compilePendingInteractionBatch({
    projectPath: "/tmp/project",
    runId: "dx-test",
    requests: [
      request("dxq-image", "image_model"),
      request("dxq-video", "video_model"),
      request("dxq-voice", "voice_model"),
      request("dxq-music", "music_route")
    ]
  });
  assert.equal(batch.questionCount, 3);
  assert.equal(batch.batchPolicy, "independent_media_routes_only");
  assert.deepEqual(batch.sourceRequestIds, ["dxq-image", "dxq-video", "dxq-voice"]);
  assert.deepEqual(batch.hostAction.arguments.questions.map((question) => question.id), ["image_model", "video_model", "voice_model"]);
  assert.equal(batch.hostAction.afterAnswer.type, "mcp_tool_sequence");
  assert.deepEqual(batch.hostAction.afterAnswer.actions.map((action) => action.arguments.requestId), ["dxq-image", "dxq-video", "dxq-voice"]);
  assert.ok(batch.hostAction.afterAnswer.actions.every((action) => action.arguments.answers === "$request_user_input.answers"));
});

test("preserves FIFO ordering and never merges duplicate or dependent questions", () => {
  const duplicate = compilePendingInteractionBatch({
    runId: "dx-test",
    requests: [
      request("dxq-provider-a", "provider_model"),
      request("dxq-provider-b", "provider_model"),
      request("dxq-budget", "budget")
    ]
  });
  assert.deepEqual(duplicate.sourceRequestIds, ["dxq-provider-a"]);
  assert.equal(duplicate.hostAction.afterAnswer.tool, "directorx_resolve_user_interaction");

  const twoQuestionRequest = request("dxq-intake", "platform", {
    kind: "intake",
    questions: [
      request("unused", "platform").questions[0],
      request("unused", "production_route").questions[0]
    ]
  });
  const bounded = compilePendingInteractionBatch({
    runId: "dx-test",
    requests: [twoQuestionRequest, request("dxq-budget", "budget"), request("dxq-model", "video_model")]
  });
  assert.deepEqual(bounded.sourceRequestIds, ["dxq-intake"]);
  assert.equal(bounded.questionCount, 2);
  assert.equal(bounded.batchPolicy, "single_request");

  assert.throws(() => compilePendingInteractionBatch({
    runId: "dx-test",
    requests: [request("dxq-same", "image_model"), request("dxq-same", "video_model")]
  }), /Duplicate native interaction request ID/);
});
