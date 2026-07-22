import { compilePendingInteractionBatch, compileSubagentHostProtocol } from "./host-action-protocol.mjs";

const TERMINAL_AGENT_STATES = new Set(["complete", "failed"]);

export function buildRunResumeActionPlan(snapshot, context = {}) {
  const recovery = snapshot.recoveryGate?.status === "blocked" ? snapshot.recoveryGate.recovery ?? {
    blockedOperation: snapshot.recoveryGate.toolName,
    rootCause: snapshot.recoveryGate.code,
    resumeWith: snapshot.recoveryGate.nextRequiredAction,
    preservesCompletedArtifacts: true
  } : null;
  const surfaceActions = surfaceRebindActions(snapshot, context);
  const releaseActions = terminalReleaseActions(snapshot, context);
  const nativeInteractionBatch = compilePendingInteractionBatch({
    projectPath: context.projectPath,
    runId: snapshot.runId,
    requests: snapshot.interactions?.pending ?? []
  });
  const dispatch = !recovery && !nativeInteractionBatch && !releaseActions.length ? readyParallelDispatch(snapshot, context) : null;
  const finalizeActions = surfaceFinalizeActions(snapshot, context);
  const blockedBy = recovery
    ? `recovery:${recovery.blockedOperation}`
    : nativeInteractionBatch
    ? `native_interactions:${nativeInteractionBatch.sourceRequestIds.join(",")}`
    : releaseActions.length
      ? "terminal_subagent_host_release"
      : null;
  const groups = [
    group("surface_rebind", surfaceActions, false),
    group("terminal_host_release", releaseActions, true),
    group("native_interaction", nativeInteractionBatch ? [nativeInteractionBatch.hostAction] : [], true),
    group("parallel_dispatch", dispatch?.actions ?? [], true),
    group("surface_finalize", finalizeActions, true)
  ];
  return {
    schemaVersion: "1.1",
    protocol: "claim_hydrate_verify_resume",
    runId: snapshot.runId,
    generatedAt: context.now ?? new Date().toISOString(),
    blockedBy,
    attention: recovery ? `Recover ${recovery.blockedOperation} with ${recovery.resumeWith}; completed artifacts remain available.` : attentionMessage(surfaceActions, releaseActions, nativeInteractionBatch, dispatch),
    recovery,
    groups,
    readyBatchId: dispatch?.batchId ?? null,
    nativeInteraction: nativeInteractionBatch?.request ?? null,
    nativeInteractionBatch: nativeInteractionBatch ? {
      requestId: nativeInteractionBatch.requestId,
      sourceRequestIds: nativeInteractionBatch.sourceRequestIds,
      questionCount: nativeInteractionBatch.questionCount,
      batchPolicy: nativeInteractionBatch.batchPolicy,
      requests: nativeInteractionBatch.requests
    } : null,
    productionBootstrap: productionBootstrapState(snapshot, dispatch)
  };
}

function productionBootstrapState(snapshot, dispatch) {
  const plan = snapshot.subagentOrchestrationPlan ?? snapshot.fastStart?.dispatchPlan;
  const tasks = plan?.tasks ?? [];
  const running = tasks.filter((task) => task.status === "running").length;
  const completed = tasks.filter((task) => task.status === "complete").length;
  let state = "awaiting_goal_binding";
  let nextRequiredAction = "bind_goal";
  if (snapshot.goal?.boundAt) {
    if (snapshot.recoveryGate?.status === "blocked") {
      state = "recovery_blocked";
      nextRequiredAction = "directorx_recover_production";
    } else if (snapshot.fastStart?.startedAt && !snapshot.executionGraph) {
      state = "creative_work_active_governance_deferred";
      nextRequiredAction = snapshot.creativeProgressSla?.breached ? "dispatch_creative_work_now" : "continue_research_asset_and_script_work";
    } else if (!snapshot.productionComplexityPlan) {
      state = "awaiting_complexity_plan";
      nextRequiredAction = "plan_production_complexity";
    } else if (!snapshot.executionGraph) {
      state = "awaiting_execution_graph";
      nextRequiredAction = "register_execution_graph";
    } else if (!plan?.tasks?.length) {
      state = "awaiting_team_plan";
      nextRequiredAction = "plan_production_team";
    } else if (dispatch?.actions?.length) {
      state = "ready_for_parallel_dispatch";
      nextRequiredAction = "spawn_ready_wave";
    } else if (running > 0) {
      state = "team_active";
      nextRequiredAction = "wait_for_wave";
    } else if (completed === tasks.length) {
      state = "stage_handoffs_complete";
      nextRequiredAction = "advance_stage";
    } else {
      state = "waiting_for_dependencies";
      nextRequiredAction = "complete_current_handoffs";
    }
  }
  return {
    schemaVersion: "1.0",
    state,
    nextRequiredAction,
    complexityProfile: snapshot.productionComplexityPlan?.profile ?? null,
    executionGraphReady: Boolean(snapshot.executionGraph),
    teamPlanReady: Boolean(plan?.tasks?.length),
    readyBatchId: dispatch?.batchId ?? null,
    taskCounts: { total: tasks.length, running, completed }
  };
}

function surfaceRebindActions(snapshot, context) {
  const actions = [];
  if (context.canvasBinding?.canvasHostAction) actions.push({
    ...context.canvasBinding.canvasHostAction,
    surface: "canvas",
    protocol: "claim_hydrate_verify",
    expectedRunId: snapshot.runId,
    health: context.canvasBinding.canvasSurfaceHealth ?? null,
    staleBindingPolicy: "reacquire_tab_from_existing_browser_binding"
  });
  if (context.editorBinding?.editorHostAction) actions.push({
    ...context.editorBinding.editorHostAction,
    surface: "editor",
    protocol: "claim_hydrate_verify",
    expectedRunId: snapshot.runId,
    expectedEditorSessionId: snapshot.openCutEditor?.activeSessionId ?? null,
    health: context.editorBinding.editorSurfaceHealth ?? null,
    staleBindingPolicy: "reacquire_tab_from_existing_browser_binding"
  });
  return actions;
}

function terminalReleaseActions(snapshot, context) {
  const projectPath = context.projectPath ?? "$projectPath";
  return (snapshot.subagents ?? [])
    .filter((agent) => TERMINAL_AGENT_STATES.has(agent.status) && agent.hostLifecycle === "release_required" && agent.hostAgentId)
    .map((agent) => ({
      type: "host_tool",
      tool: "close_agent",
      required: true,
      arguments: { target: agent.hostAgentId },
      canonicalIdentity: agent.displayName,
      afterClose: {
        tool: "directorx_confirm_subagent_host_closed",
        arguments: {
          projectPath,
          runId: snapshot.runId,
          displayName: agent.displayName,
          hostAgentId: agent.hostAgentId,
          closedBy: "close_agent",
          hostCloseStatus: "closed"
        }
      }
    }));
}

function readyParallelDispatch(snapshot, context) {
  const plan = snapshot.subagentOrchestrationPlan ?? snapshot.fastStart?.dispatchPlan;
  if (!plan?.tasks?.length || !stageIsActive(snapshot, snapshot.stage)) return null;
  const byId = new Map(plan.tasks.map((task) => [task.taskId, task]));
  const orderedBatches = [...(plan.batches ?? [])].sort((a, b) => a.order - b.order);
  for (let batchIndex = 0; batchIndex < orderedBatches.length; batchIndex += 1) {
    const batch = orderedBatches[batchIndex];
    if (orderedBatches.slice(0, batchIndex).some((candidate) => !batchIsComplete(candidate, byId))) break;
    const tasks = batch.taskIds.map((taskId) => byId.get(taskId)).filter(Boolean);
    const ready = tasks.filter((task) => task.stage === snapshot.stage && taskIsReady(task, byId));
    if (!ready.length) continue;
    return {
      batchId: batch.batchId,
      actions: ready.map((task) => resumeSpawnAction(snapshot, task, batch, context))
    };
  }
  return null;
}

function resumeSpawnAction(snapshot, task, batch, context) {
  const protocol = compileSubagentHostProtocol({
    projectPath: context.projectPath,
    runId: snapshot.runId,
    task
  });
  return {
    type: "host_tool",
    tool: "spawn_agent",
    required: true,
    concurrentGroup: batch.batchId,
    arguments: protocol.spawnArguments,
    expectedNickname: protocol.expectedNickname,
    expectedCanonicalIdentity: protocol.expectedCanonicalIdentity,
    hostNicknamePolicy: protocol.hostNicknamePolicy,
    identityTransport: protocol.identityTransport,
    hostIdentitySource: protocol.hostIdentitySource,
    hostReleaseStrategy: protocol.hostReleaseStrategy,
    afterSpawn: protocol.afterSpawn,
    afterTerminal: protocol.afterTerminal
  };
}

function batchIsComplete(batch, byId) {
  return batch.status === "complete" || batch.taskIds.every((taskId) => {
    const task = byId.get(taskId);
    return task?.status === "complete" && (task.hostReleaseRequired !== true || task.hostLifecycle === "released");
  });
}

function taskIsReady(task, byId) {
  if (task.status !== "pending" || task.hostAgentId || ![null, undefined, "not_spawned"].includes(task.hostLifecycle)) return false;
  return (task.dependsOnTaskIds ?? []).every((taskId) => {
    const dependency = byId.get(taskId);
    return dependency?.status === "complete" && (dependency.hostReleaseRequired !== true || dependency.hostLifecycle === "released");
  });
}

function stageIsActive(snapshot, stage) {
  return snapshot.stage === stage || snapshot.pipeline?.stageStates?.[stage]?.status === "active";
}

function surfaceFinalizeActions(snapshot, context) {
  const actions = [];
  if (context.canvasBinding?.canvasTurnEndAction) actions.push({ ...context.canvasBinding.canvasTurnEndAction, surface: "canvas" });
  if (context.editorBinding?.editorTurnEndAction) actions.push({ ...context.editorBinding.editorTurnEndAction, surface: "editor", keepStatus: "handoff" });
  return actions;
}

function attentionMessage(surfaceActions, releaseActions, nativeInteractionBatch, dispatch) {
  if (surfaceActions.some((action) => ["awaiting_open", "stale"].includes(action.health?.status))) return "Rebind the Director X side-browser surface before continuing production.";
  if (releaseActions.length) return "Release terminal DX subagent hosts and confirm each release before new dispatch.";
  if (nativeInteractionBatch) return nativeInteractionBatch.questionCount > 1
    ? `Ask ${nativeInteractionBatch.questionCount} ready production decisions together with one Codex request_user_input.`
    : "Ask the pending decision with Codex request_user_input before dispatching new production work.";
  if (dispatch?.actions.length) return `Spawn ${dispatch.actions.length} ready DX subagent tasks concurrently.`;
  return "Hydrate the current Run and continue from its durable stage evidence.";
}

function group(phase, actions, requiresPreviousGroupsComplete) {
  return { phase, required: actions.length > 0, requiresPreviousGroupsComplete, actions };
}
