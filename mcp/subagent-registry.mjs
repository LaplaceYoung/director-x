const DX_NAME_PATTERN = /^DX-[A-Za-z0-9][A-Za-z0-9-]{1,48}$/;

export const DX_SUBAGENT_CATALOG = Object.freeze([
  role("task_planner", "dx_task_planner", "DX-Task-Planner", "需求澄清、任务拆解与 Pipeline 规划"),
  role("director_runtime", "dx_director", "DX-Director", "导演语言、创意原则与交付承诺"),
  role("reference_analyst", "dx_reference_analyst", "DX-Reference-Analyst", "联网研究、参考分析与迁移规则"),
  role("shot_planner", "dx_shot_planner", "DX-Shot-Planner", "镜头设计、关键帧与依赖关系"),
  role("asset_manager", "dx_asset_manager", "DX-Asset-Manager", "资产、来源、授权与替代方案"),
  role("provider_operator", "dx_provider_operator", "DX-Provider-Operator", "Provider 调用、轮询与结果持久化"),
  role("model_router", "dx_model_router", "DX-Model-Router", "模型能力、成本与 fallback 路由"),
  role("cost_controller", "dx_cost_controller", "DX-Cost-Controller", "项目、阶段、镜头与尝试预算"),
  role("draw_loop_controller", "dx_draw_loop", "DX-Draw-Loop", "候选生成、审核、修复与停止条件"),
  role("memory_manager", "dx_memory_manager", "DX-Memory-Manager", "连续性、审批与失败记忆"),
  role("quality_evaluator", "dx_quality_reviewer", "DX-Quality-Reviewer", "画面、连续性、剪辑与终审"),
  role("editing_agent", "dx_editor", "DX-Editor", "选片、时间线、字幕、音频与渲染"),
  role("approval_producer", "dx_approval_producer", "DX-Approval-Producer", "用户确认、发布打包与交付证据")
]);

export function registerDxSubagent(run, input) {
  assertDxName(input.displayName);
  const catalogRole = DX_SUBAGENT_CATALOG.find((item) => item.roleId === input.roleId);
  if (!catalogRole) throw new Error(`Unknown Director X subagent role: ${input.roleId}`);
  if (catalogRole.displayName !== input.displayName) throw new Error(`Role ${input.roleId} must use the canonical name ${catalogRole.displayName}.`);
  if (!input.hostAgentId?.trim()) throw new Error("hostAgentId is required after Codex spawns the subagent.");
  const plannedTask = plannedTaskFor(run, input.roleId, input.stage);
  const hostAgentTypeMode = plannedTask?.hostAgentTypeMode ?? "custom_dx_role";
  const hostNicknameMode = classifyDxHostNickname(input.hostNickname, catalogRole.displayName, catalogRole.agentType, hostAgentTypeMode);
  const hostReleaseRequired = plannedTask?.hostReleaseRequired !== false;
  const hostReleaseStrategy = plannedTask?.hostReleaseStrategy ?? "close_agent";
  const plannedBatch = plannedTask ? batchForTask(run.subagentOrchestrationPlan, plannedTask.taskId) : null;
  if (plannedBatch) assertPriorBatchesComplete(run.subagentOrchestrationPlan, plannedBatch);
  if (plannedTask?.hostAgentId && plannedTask.hostAgentId !== input.hostAgentId) throw new Error(`${catalogRole.displayName} task ${plannedTask.taskId} is already dispatched to host agent ${plannedTask.hostAgentId}; create a new plan revision before retrying it.`);
  run.subagents ??= [];
  const duplicateHost = run.subagents.find((item) => item.hostAgentId === input.hostAgentId && item.displayName !== input.displayName);
  if (duplicateHost) throw new Error(`Host agent ${input.hostAgentId} is already bound to ${duplicateHost.displayName}.`);
  const now = new Date().toISOString();
  const record = {
    roleId: input.roleId,
    displayName: input.displayName,
    hostAgentId: input.hostAgentId,
    hostNickname: input.hostNickname ?? null,
    hostNicknameMode,
    hostAgentType: plannedTask?.agentType ?? catalogRole.agentType,
    hostAgentTypeMode,
    hostReleaseRequired,
    hostReleaseStrategy,
    stage: input.stage,
    mission: input.mission,
    inputArtifactRefs: input.inputArtifactRefs ?? [],
    outputArtifactRefs: input.outputArtifactRefs ?? [],
    status: input.status ?? "running",
    hostLifecycle: "active",
    hostReleasedAt: null,
    registeredAt: now,
    updatedAt: now
  };
  const index = run.subagents.findIndex((item) => item.displayName === input.displayName);
  if (index >= 0) run.subagents[index] = { ...run.subagents[index], ...record, registeredAt: run.subagents[index].registeredAt };
  else run.subagents.push(record);
  if (plannedTask) {
    plannedTask.dispatchedAt ??= now;
    plannedTask.dispatchReceipt ??= {
      receiptId: `dispatch:${run.subagentOrchestrationPlan.planId}:${plannedTask.taskId}`,
      planId: run.subagentOrchestrationPlan.planId,
      batchId: plannedBatch.batchId,
      taskId: plannedTask.taskId,
      agentType: plannedTask.agentType,
      preferredAgentType: catalogRole.agentType,
      hostAgentTypeMode,
      hostIdentitySource: plannedTask.hostIdentitySource ?? "spawn_agent.result.agent_id",
      hostReleaseStrategy,
      displayName: catalogRole.displayName,
      hostAgentId: input.hostAgentId,
      dispatchedAt: now,
      terminalAt: null,
      releasedAt: null,
      status: "running"
    };
    plannedTask.hostAgentId = input.hostAgentId;
    plannedTask.hostNickname = input.hostNickname;
    plannedTask.hostNicknameMode = hostNicknameMode;
    plannedTask.status = record.status;
    plannedTask.hostLifecycle = "active";
    plannedTask.updatedAt = now;
    plannedBatch.startedAt ??= now;
    plannedBatch.status = "running";
    updatePlanStatus(run, now);
  }
  return run;
}

export function updateDxSubagent(run, input) {
  assertDxName(input.displayName);
  const record = run.subagents?.find((item) => item.displayName === input.displayName);
  if (!record) throw new Error(`Register ${input.displayName} before updating it.`);
  const plannedTask = run.subagentOrchestrationPlan?.tasks?.find((task) => task.roleId === record.roleId && task.stage === record.stage);
  if (plannedTask && input.status === "complete") {
    const declaredHandoff = new Set([...(record.outputArtifactRefs ?? []), ...(input.outputArtifactRefs ?? [])]);
    const missingDeclared = plannedTask.outputArtifactRefs.filter((artifactRef) => !declaredHandoff.has(artifactRef));
    const missingRegistered = plannedTask.outputArtifactRefs.filter((artifactRef) => !run.artifacts?.[artifactRef]);
    if (missingDeclared.length) throw new Error(`${input.displayName} cannot complete before handing off: ${missingDeclared.join(", ")}`);
    if (missingRegistered.length) throw new Error(`${input.displayName} cannot complete before registering real artifacts: ${missingRegistered.join(", ")}`);
  }
  record.status = input.status;
  record.detail = input.detail;
  record.outputArtifactRefs = [...new Set([...(record.outputArtifactRefs ?? []), ...(input.outputArtifactRefs ?? [])])];
  record.updatedAt = new Date().toISOString();
  if (["complete", "failed"].includes(input.status)) {
    record.hostLifecycle = record.hostReleaseRequired === false ? "released" : "release_required";
    record.terminalAt = record.updatedAt;
    if (record.hostReleaseRequired === false) record.hostReleasedAt = record.updatedAt;
  }
  if (plannedTask) {
    plannedTask.status = input.status;
    plannedTask.detail = input.detail;
    plannedTask.outputArtifactRefs = [...new Set([...plannedTask.outputArtifactRefs, ...(input.outputArtifactRefs ?? [])])];
    if (["complete", "failed"].includes(input.status)) {
      plannedTask.hostLifecycle = plannedTask.hostReleaseRequired === false ? "released" : "release_required";
      plannedTask.terminalAt = record.updatedAt;
      if (plannedTask.hostReleaseRequired === false) plannedTask.hostReleasedAt = record.updatedAt;
      if (plannedTask.dispatchReceipt) {
        plannedTask.dispatchReceipt.status = input.status;
        plannedTask.dispatchReceipt.terminalAt = record.updatedAt;
        if (plannedTask.hostReleaseRequired === false) plannedTask.dispatchReceipt.releasedAt = record.updatedAt;
      }
    }
    plannedTask.updatedAt = record.updatedAt;
    updatePlanStatus(run, record.updatedAt);
  }
  if (input.hostRelease && ["complete", "failed"].includes(input.status)) {
    confirmDxSubagentHostClosed(run, {
      displayName: input.displayName,
      hostAgentId: input.hostRelease.hostAgentId,
      closedBy: input.hostRelease.closedBy,
      hostCloseStatus: input.hostRelease.hostCloseStatus
    }, record.updatedAt);
  }
  return run;
}

export function confirmDxSubagentHostClosed(run, input, now = new Date().toISOString()) {
  assertDxName(input.displayName);
  const record = run.subagents?.find((item) => item.displayName === input.displayName);
  if (!record) throw new Error(`Register ${input.displayName} before confirming host release.`);
  if (record.hostAgentId !== input.hostAgentId) throw new Error(`${input.displayName} host release does not match its registered Codex agent.`);
  if (!["complete", "failed"].includes(record.status) || record.hostLifecycle !== "release_required") throw new Error(`${input.displayName} can release its host only after a terminal handoff.`);
  if (input.closedBy !== "close_agent" || input.hostCloseStatus !== "closed") throw new Error("DX subagent host release must be confirmed from a successful Codex close_agent result.");
  record.hostLifecycle = "released";
  record.hostReleasedAt = now;
  record.updatedAt = now;
  const plannedTask = run.subagentOrchestrationPlan?.tasks?.find((task) => task.roleId === record.roleId && task.stage === record.stage);
  if (plannedTask) {
    plannedTask.hostLifecycle = "released";
    plannedTask.hostReleasedAt = now;
    if (plannedTask.dispatchReceipt) {
      plannedTask.dispatchReceipt.releasedAt = now;
      plannedTask.dispatchReceipt.status = plannedTask.status;
    }
    plannedTask.updatedAt = now;
    updatePlanStatus(run, now);
  }
  return run;
}

export function dxIdentityInstruction(displayName) {
  assertDxName(displayName);
  return `Director X identity: ${displayName}. Use this exact DX-prefixed identity in every artifact owner, handoff, status message, and result.`;
}

export function classifyDxHostNickname(hostNickname, displayName, agentType = "Director X role", hostAgentTypeMode = "custom_dx_role") {
  if (hostAgentTypeMode === "collaboration_task") {
    if (!String(hostNickname ?? "").trim()) throw new Error(`Codex collaboration task for ${displayName} must return a trace task path.`);
    return "collaboration_task_trace_only";
  }
  if (hostAgentTypeMode === "builtin_compatibility") {
    if (!String(hostNickname ?? "").trim()) throw new Error(`Codex built-in host for ${displayName} must return a trace nickname.`);
    return "builtin_trace_only";
  }
  if (hostNickname === displayName) return "canonical";
  const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^${escaped} the \\d+(?:st|nd|rd|th)$`).test(hostNickname ?? "")) return "codex_ordinal_variant";
  throw new Error(`Codex role ${agentType} must return ${displayName} or a Codex ordinal host variant that normalizes to it.`);
}

export function assertDxName(value) {
  if (!DX_NAME_PATTERN.test(value ?? "")) throw new Error("Director X subagent names must match DX-xxxxx using letters, numbers, and hyphens only.");
}

function role(roleId, agentType, displayName, mission) { return { roleId, agentType, displayName, mission }; }

function plannedTaskFor(run, roleId, stage) {
  const plan = run.subagentOrchestrationPlan;
  if (!plan) {
    if (run.orchestrationPolicy?.canonicalDxRequired) throw new Error("Call directorx_plan_parallel_subagents before spawning Director X subagents.");
    return null;
  }
  const task = plan.tasks.find((candidate) => candidate.roleId === roleId && candidate.stage === stage);
  if (!task) throw new Error(`The active parallel_subagent_plan.json does not assign ${roleId} to ${stage}.`);
  return task;
}

function updatePlanStatus(run, now) {
  const plan = run.subagentOrchestrationPlan;
  if (!plan) return;
  for (const batch of plan.batches ?? []) {
    const tasks = batch.taskIds.map((taskId) => plan.tasks.find((task) => task.taskId === taskId)).filter(Boolean);
    const complete = tasks.length > 0 && tasks.every((task) => task.status === "complete" && (task.hostReleaseRequired !== true || task.hostLifecycle === "released"));
    batch.status = complete ? "complete"
      : tasks.some((task) => task.status === "failed") ? "failed"
        : tasks.some((task) => task.status === "blocked") ? "blocked"
          : tasks.some((task) => task.dispatchReceipt || ["running", "complete"].includes(task.status)) ? "running"
            : "pending";
    if (batch.status === "complete") batch.completedAt ??= now;
    else batch.completedAt = null;
  }
  plan.status = plan.tasks.every((task) => task.status === "complete" && (task.hostReleaseRequired !== true || task.hostLifecycle === "released")) ? "complete"
    : plan.tasks.some((task) => task.status === "failed") ? "failed"
      : plan.tasks.some((task) => task.status === "blocked") ? "blocked"
        : plan.tasks.some((task) => ["running", "complete"].includes(task.status)) ? "running"
          : "awaiting_host_dispatch";
  plan.updatedAt = now;
}

function batchForTask(plan, taskId) {
  const batch = plan.batches?.find((candidate) => candidate.taskIds.includes(taskId));
  if (!batch) throw new Error(`Parallel subagent task ${taskId} is not assigned to a dispatch batch.`);
  return batch;
}

function assertPriorBatchesComplete(plan, batch) {
  const incomplete = (plan.batches ?? []).filter((candidate) => candidate.order < batch.order && !batchCompleteFromTasks(plan, candidate));
  if (incomplete.length) throw new Error(`Cannot dispatch ${batch.batchId} before prior batches complete and release their hosts: ${incomplete.map((candidate) => candidate.batchId).join(", ")}`);
}

function batchCompleteFromTasks(plan, batch) {
  const tasks = batch.taskIds.map((taskId) => plan.tasks.find((task) => task.taskId === taskId)).filter(Boolean);
  return tasks.length > 0 && tasks.every((task) => task.status === "complete" && (task.hostReleaseRequired !== true || task.hostLifecycle === "released"));
}
