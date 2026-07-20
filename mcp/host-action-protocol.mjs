import { createHash } from "node:crypto";

const MAX_NATIVE_QUESTIONS = 3;
const BATCHABLE_MEDIA_ROUTE_KINDS = new Set(["image_model", "video_model", "voice_model", "music_route"]);

export function compileDirectorXGoalBootProtocol({ projectPath, outcome, preflightId, goalInteractionRequestId, questions, goalAccepted = false }) {
  if (!String(projectPath ?? "").trim() || !String(outcome ?? "").trim() || !String(preflightId ?? "").trim() || !String(goalInteractionRequestId ?? "").trim()) {
    throw new Error("Director X Goal boot protocol requires project, outcome, preflight, and interaction identity.");
  }
  if (!Array.isArray(questions) || !questions.length) throw new Error("Director X Goal boot protocol requires the native Goal question.");
  const objective = `Deliver and verify a playable final video for: ${outcome}. Include final render, structured review, and user delivery approval.`;
  const createGoalAction = { type: "host_tool", tool: "create_goal", required: true, arguments: { objective } };
  const afterAcceptance = [
    ...(!goalAccepted ? [{ type: "mcp_tool", tool: "directorx_resolve_user_interaction", required: true, arguments: { projectPath, runId: `preflight:${preflightId}`, requestId: goalInteractionRequestId, confirmedBy: "request_user_input", answers: "$request_user_input.answers" } }] : []),
    createGoalAction,
    { type: "mcp_tool", tool: "directorx_create_run", required: true, arguments: { projectPath, outcome, preflightId, goalInteractionRequestId, codexGoalId: "$create_goal.result.goal.threadId", confirmedBy: "request_user_input", goalAccepted: true } },
    { type: "mcp_tool", tool: "directorx_bind_goal", required: true, arguments: { projectPath, runId: "$directorx_create_run.result.runId", codexGoalId: "$create_goal.result.goal.threadId" } }
  ];
  return {
    objective,
    requestUserInputAction: {
      type: "host_tool",
      tool: "request_user_input",
      required: true,
      requestId: goalInteractionRequestId,
      arguments: { questions: structuredClone(questions) },
      afterAnswer: { type: "host_action_sequence", actions: afterAcceptance }
    },
    createGoalAction,
    afterAcceptance
  };
}

export function compileSubagentHostProtocol({ projectPath = "$projectPath", runId, task }) {
  if (!String(runId ?? "").trim()) throw new Error("Subagent host protocol requires a Director X Run ID.");
  if (!task?.taskId || !task.roleId || !task.displayName || !task.stage || !task.mission || !task.prompt) {
    throw new Error("Subagent host protocol requires a planned task with identity, stage, mission, and prompt.");
  }
  const collaborationTask = task.hostAgentTypeMode === "collaboration_task";
  if (!collaborationTask && !String(task.agentType ?? "").trim()) {
    throw new Error("Typed subagent host protocol requires an agent type.");
  }
  const spawnArguments = collaborationTask
    ? { task_name: collaborationTaskName(task), fork_turns: "all", message: task.prompt }
    : { agent_type: task.agentType, message: task.prompt };
  const afterSpawn = {
    tool: "directorx_register_subagent",
    taskId: task.taskId,
    arguments: {
      projectPath,
      runId,
      roleId: task.roleId,
      displayName: task.displayName,
      hostAgentId: collaborationTask ? "$spawn_agent.event.agent_thread_id" : "$spawn_agent.result.agent_id",
      hostNickname: collaborationTask ? "$spawn_agent.result.task_name" : "$spawn_agent.result.nickname",
      stage: task.stage,
      mission: task.mission,
      inputArtifactRefs: task.inputArtifactRefs ?? [],
      outputArtifactRefs: task.outputArtifactRefs ?? [],
      status: "running"
    }
  };
  const afterTerminal = collaborationTask ? {
    required: true,
    hostAction: { type: "host_tool", tool: "wait_agent", arguments: { timeout_ms: 30_000 } },
    evidenceSource: "sub_agent_activity",
    terminalIdentityField: "agent_thread_id",
    reason: `Wait for the terminal ${task.displayName} event before accepting its artifact handoff.`
  } : {
    required: true,
    hostAction: { type: "host_tool", tool: "close_agent", arguments: { target: "$registeredHostAgentId" } },
    confirmTool: "directorx_confirm_subagent_host_closed",
    reason: `Release the terminal ${task.displayName} host process and preserve the canonical Director X production identity.`
  };
  return {
    spawnArguments,
    afterSpawn,
    afterTerminal,
    expectedNickname: task.expectedNickname ?? null,
    expectedCanonicalIdentity: task.displayName,
    hostNicknamePolicy: task.hostNicknamePolicy ?? (collaborationTask ? "host_task_path_trace_only" : "canonical_or_codex_ordinal_variant"),
    identityTransport: task.identityTransport ?? (collaborationTask ? "prompt_registry_canvas_and_sub_agent_activity" : "custom_agent_nickname_and_prompt"),
    hostIdentitySource: task.hostIdentitySource ?? (collaborationTask ? "sub_agent_activity.agent_thread_id" : "spawn_agent.result.agent_id"),
    hostReleaseStrategy: task.hostReleaseStrategy ?? (collaborationTask ? "terminal_event" : "close_agent")
  };
}

export function compilePendingInteractionBatch({ projectPath = "$projectPath", runId, requests, maxQuestions = MAX_NATIVE_QUESTIONS }) {
  if (!String(runId ?? "").trim()) throw new Error("Native interaction batch requires a Director X Run ID.");
  if (!Number.isInteger(maxQuestions) || maxQuestions < 1 || maxQuestions > MAX_NATIVE_QUESTIONS) {
    throw new Error("Native interaction batch supports one to three questions.");
  }
  const selected = selectPendingRequests(requests, maxQuestions);
  if (!selected.length) return null;
  const sourceRequestIds = selected.map((request) => request.requestId);
  const questions = selected.flatMap((request) => structuredClone(request.questions));
  const requestId = selected.length === 1
    ? selected[0].requestId
    : `dxb-${createHash("sha256").update(sourceRequestIds.join(":")).digest("hex").slice(0, 16)}`;
  const resolutionActions = selected.map((request) => ({
    tool: "directorx_resolve_user_interaction",
    arguments: {
      projectPath,
      runId,
      requestId: request.requestId,
      confirmedBy: "request_user_input",
      answers: "$request_user_input.answers"
    }
  }));
  return {
    request: selected[0],
    requests: structuredClone(selected),
    requestId,
    sourceRequestIds,
    questionCount: questions.length,
    batchPolicy: selected.length > 1 ? "independent_media_routes_only" : "single_request",
    hostAction: {
      type: "host_tool",
      tool: "request_user_input",
      required: true,
      requestId,
      sourceRequestIds,
      arguments: { questions },
      afterAnswer: resolutionActions.length === 1
        ? resolutionActions[0]
        : { type: "mcp_tool_sequence", actions: resolutionActions }
    }
  };
}

function selectPendingRequests(requests, maxQuestions) {
  const selected = [];
  const questionIds = new Set();
  const requestIds = new Set();
  let questionCount = 0;
  for (const request of requests ?? []) {
    if (request?.status && request.status !== "pending") continue;
    if (!request?.requestId || !Array.isArray(request.questions) || !request.questions.length) continue;
    if (requestIds.has(request.requestId)) throw new Error(`Duplicate native interaction request ID: ${request.requestId}`);
    requestIds.add(request.requestId);
    const ids = request.questions.map((question) => question.id);
    const conflicts = ids.some((id) => !id || questionIds.has(id));
    if (conflicts || questionCount + request.questions.length > maxQuestions) break;
    if (selected.length && !BATCHABLE_MEDIA_ROUTE_KINDS.has(request.kind)) break;
    selected.push(request);
    questionCount += request.questions.length;
    for (const id of ids) questionIds.add(id);
    if (selected.length === 1 && (request.questions.length > 1 || !BATCHABLE_MEDIA_ROUTE_KINDS.has(request.kind))) break;
  }
  return selected;
}

function collaborationTaskName(task) {
  return `dx_${task.roleId}_${task.taskId}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}
