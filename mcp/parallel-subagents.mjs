import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DX_SUBAGENT_CATALOG } from "./subagent-registry.mjs";
import { resolveDxHostAgentBinding } from "./codex-agent-roles.mjs";
import { compileSubagentHostProtocol } from "./host-action-protocol.mjs";
import { buildDelegatedSubagentPrompt } from "./subagent-prompt-contract.mjs";

const STAGE_ORDER = ["intake", "research", "script", "storyboard", "generation", "edit", "review", "delivery"];
const STAGES = new Set(STAGE_ORDER);
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_DELEGATION_DEPTH = 1;
const NESTED_DELEGATION_TOOLS = Object.freeze([
  "spawn_agent",
  "directorx_plan_production_team",
  "directorx_plan_parallel_subagents",
  "create_thread",
  "create_goal"
]);

const ROLE_TOOL_DEFAULTS = Object.freeze({
  task_planner: ["directorx_get_stage_requirements", "directorx_query_director_knowledge"],
  director_runtime: ["directorx_query_director_knowledge", "directorx_query_cinematic_references"],
  reference_analyst: ["web_search", "web_open", "directorx_query_cinematic_references"],
  shot_planner: ["directorx_query_director_knowledge", "directorx_query_cinematic_references", "directorx_compile_scene_coverage_plan", "directorx_review_shot_sequence", "directorx_compile_shot_grounding_plan", "directorx_finalize_shot_grounding", "directorx_compile_visual_prompt_pack"],
  asset_manager: ["web_search", "web_open", "directorx_audit_asset_quality"],
  provider_operator: ["directorx_get_run_snapshot", "directorx_get_media_provider_setup", "directorx_begin_generation_attempt", "directorx_submit_media_generation", "directorx_poll_media_generation"],
  model_router: ["web_search", "web_open", "directorx_list_media_providers", "directorx_get_media_provider_setup", "directorx_record_provider_api_research", "directorx_probe_provider_capability", "directorx_register_generation_plan"],
  cost_controller: ["directorx_list_model_pricing", "directorx_quote_model_cost"],
  draw_loop_controller: ["directorx_get_run_snapshot", "directorx_review_generation_candidate", "directorx_compile_generation_repair", "directorx_select_generation_candidate"],
  memory_manager: ["directorx_get_run_snapshot", "directorx_query_director_knowledge"],
  quality_evaluator: ["directorx_get_run_snapshot", "directorx_review_generation_candidate", "directorx_verify_final_media", "directorx_record_scene_coverage_review", "directorx_record_final_review_evidence"],
  editing_agent: ["directorx_get_run_snapshot", "directorx_query_director_knowledge"],
  approval_producer: ["directorx_get_run_snapshot", "directorx_get_stage_requirements"]
});

const ROLE_ESCALATIONS = Object.freeze({
  reference_analyst: ["source provenance is unclear", "local reference download requires user consent"],
  asset_manager: ["rights or license evidence is incomplete", "downloaded media fails quality audit"],
  model_router: ["official API documentation is missing or stale", "the exact model lifecycle or pricing cannot be verified"],
  cost_controller: ["official price evidence is missing", "the approved budget cannot cover the route"],
  provider_operator: ["the approved generation plan or pricing quote is missing", "a paid attempt or credential is required", "provider capability probe fails", "reference media violates the selected mode or provider limits"],
  draw_loop_controller: ["the defect requires a provider or model reroute", "the next attempt would exceed the shot cap", "the repair changes the approved delivery promise"],
  quality_evaluator: ["a critical decode or continuity defect is confirmed", "the candidate needs a provider reroute rather than a prompt repair", "delivery evidence is incomplete"]
});

export function compileExecutionGraphSubagentTasks(run, input = {}) {
  if (!run?.executionGraph?.nodes?.length) throw new Error("Register execution_graph.json before compiling the DX production team.");
  if (!run.productionComplexityPlan?.settings) throw new Error("Plan production complexity before compiling the DX production team.");
  const stageFilter = new Set(input.stages?.length ? input.stages : STAGE_ORDER);
  const graphNodes = run.executionGraph.nodes;
  const agentNodes = graphNodes.filter((node) => node.kind === "agent" && stageFilter.has(node.stage));
  if (agentNodes.length < 2) throw new Error("The execution graph must expose at least two DX agent nodes for automatic production-team planning.");
  const roleByDisplayName = new Map(DX_SUBAGENT_CATALOG.map((role) => [role.displayName, role]));
  const nodeById = new Map(graphNodes.map((node) => [node.nodeId, node]));
  const groups = new Map();
  for (const node of agentNodes) {
    const role = roleByDisplayName.get(node.owner);
    if (!role) throw new Error(`${node.nodeId} uses an unknown DX owner: ${node.owner}`);
    const key = `${node.stage}:${role.roleId}`;
    const group = groups.get(key) ?? { key, stage: node.stage, role, nodes: [] };
    group.nodes.push(node);
    groups.set(key, group);
  }
  const maxTasksPerStage = run.productionComplexityPlan.settings.maxSubagentTasksPerStage;
  const stageCounts = new Map();
  for (const group of groups.values()) stageCounts.set(group.stage, (stageCounts.get(group.stage) ?? 0) + 1);
  const overstaffed = [...stageCounts.entries()].filter(([, count]) => count > maxTasksPerStage);
  if (overstaffed.length) {
    throw new Error(`Revise execution_graph.json for the ${run.productionComplexityPlan.profile} profile before dispatch: ${overstaffed.map(([stage, count]) => `${stage} has ${count} DX roles, limit ${maxTasksPerStage}`).join("; ")}.`);
  }
  const taskIdByGroup = new Map([...groups.values()].map((group) => [group.key, safeTaskId(`dx-${group.stage}-${group.role.roleId}`)]));
  const groupKeyByNodeId = new Map([...groups.values()].flatMap((group) => group.nodes.map((node) => [node.nodeId, group.key])));
  const tasks = [...groups.values()].map((group) => {
    const dependencies = new Set();
    for (const node of group.nodes) for (const dependencyId of node.dependsOn ?? []) {
      for (const upstreamKey of upstreamAgentGroups(dependencyId, nodeById, groupKeyByNodeId)) {
        if (upstreamKey !== group.key && groups.has(upstreamKey)) dependencies.add(taskIdByGroup.get(upstreamKey));
      }
    }
    const outputArtifactRefs = uniqueStrings(group.nodes.flatMap((node) => node.outputArtifactRefs));
    const inputArtifactRefs = uniqueStrings(group.nodes.flatMap((node) => node.inputArtifactRefs));
    const labels = uniqueStrings(group.nodes.map((node) => node.label));
    const configuredAllowedTools = uniqueStrings(group.nodes.flatMap((node) => node.config?.allowedTools ?? []));
    const configuredRestrictedTools = uniqueStrings(group.nodes.flatMap((node) => node.config?.restrictedTools ?? []));
    const configuredAttempts = group.nodes.map((node) => node.config?.maxAttempts).filter(Number.isInteger);
    const configuredCosts = group.nodes.map((node) => Number(node.config?.maxCost)).filter((value) => Number.isFinite(value) && value >= 0);
    return {
      taskId: taskIdByGroup.get(group.key),
      roleId: group.role.roleId,
      stage: group.stage,
      mission: `${labels.join("; ")}. Fulfil the execution-graph handoff for: ${run.executionGraph.intentSummary}`,
      inputArtifactRefs,
      outputArtifactRefs,
      dependsOnTaskIds: [...dependencies].sort(),
      allowedTools: configuredAllowedTools.length ? configuredAllowedTools : ROLE_TOOL_DEFAULTS[group.role.roleId] ?? ["directorx_get_run_snapshot"],
      restrictedTools: uniqueStrings(["credential_access", "unapproved_paid_generation", "scope_expansion", ...configuredRestrictedTools]),
      stopCondition: `Every declared output is written, registered, and ready for its downstream execution-graph consumer: ${outputArtifactRefs.join(", ")}.`,
      escalationTriggers: ROLE_ESCALATIONS[group.role.roleId] ?? ["required evidence is missing", "the task would cross an approval or cost boundary"],
      maxAttempts: configuredAttempts.length ? Math.min(...configuredAttempts) : run.productionComplexityPlan.profile === "complex" ? 3 : 2,
      maxCost: configuredCosts.length ? Math.min(...configuredCosts) : 0,
      currency: String(input.currency ?? "CNY"),
      approvalBoundary: "Do not ask the user directly or cross rights, credential, provider, model, budget, generation, edit, or delivery gates; escalate to the parent Director X agent."
    };
  }).sort((left, right) => STAGE_ORDER.indexOf(left.stage) - STAGE_ORDER.indexOf(right.stage) || left.taskId.localeCompare(right.taskId));
  if (tasks.length < 2) throw new Error("Automatic production-team planning requires at least two bounded DX tasks.");
  return tasks;
}

export function planParallelSubagents(run, input, now = new Date().toISOString()) {
  validatePlanInput(input);
  const availableAgentTypes = new Set(input.availableAgentTypes);
  const taskIds = new Set(input.tasks.map((task) => task.taskId));
  const outputOwners = new Map();
  const roleStageOwners = new Map();
  const tasks = input.tasks.map((task) => {
    const role = DX_SUBAGENT_CATALOG.find((candidate) => candidate.roleId === task.roleId);
    if (!role) throw new Error(`Unknown Director X subagent role: ${task.roleId}`);
    const hostBinding = resolveDxHostAgentBinding(role, availableAgentTypes);
    if (!hostBinding.agentType) throw new Error(`The current Codex session cannot route ${role.displayName}. Expose ${role.agentType} or a built-in default, worker, or explorer agent type.`);
    const roleStageKey = `${role.roleId}:${task.stage}`;
    if (roleStageOwners.has(roleStageKey)) throw new Error(`${role.displayName} may appear only once in stage ${task.stage}; combine its mission into one bounded task.`);
    roleStageOwners.set(roleStageKey, task.taskId);
    for (const dependency of task.dependsOnTaskIds) {
      if (!taskIds.has(dependency) || dependency === task.taskId) throw new Error(`${task.taskId} has an invalid dependency: ${dependency}`);
    }
    for (const output of task.outputArtifactRefs) {
      if (outputOwners.has(output)) throw new Error(`${output} has multiple subagent producers: ${outputOwners.get(output)} and ${task.taskId}.`);
      outputOwners.set(output, task.taskId);
    }
    const boundedTask = {
      ...task,
      restrictedTools: [...new Set([...task.restrictedTools, ...NESTED_DELEGATION_TOOLS])],
      delegationDepth: MAX_DELEGATION_DEPTH,
      maxDelegationDepth: MAX_DELEGATION_DEPTH,
      nestedDelegationAllowed: false,
      displayName: role.displayName,
      preferredAgentType: role.agentType,
      agentType: hostBinding.agentType,
      hostAgentTypeMode: hostBinding.hostAgentTypeMode,
      expectedNickname: hostBinding.expectedNickname,
      hostNicknamePolicy: hostBinding.hostNicknamePolicy,
      identityTransport: hostBinding.identityTransport,
      hostIdentitySource: hostBinding.hostIdentitySource,
      hostReleaseStrategy: hostBinding.hostReleaseStrategy,
      status: "pending",
      hostAgentId: null,
      hostReleaseRequired: hostBinding.hostReleaseStrategy === "close_agent",
      hostLifecycle: "not_spawned",
      plannedAt: now,
      updatedAt: now
    };
    boundedTask.prompt = buildSubagentPrompt(role, boundedTask, {
      projectPath: input.projectPath,
      runId: run.runId
    });
    return boundedTask;
  });
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  for (const task of tasks) for (const dependencyId of task.dependsOnTaskIds) {
    const dependency = byId.get(dependencyId);
    if (STAGE_ORDER.indexOf(dependency.stage) > STAGE_ORDER.indexOf(task.stage)) throw new Error(`${task.taskId} cannot depend on later-stage task ${dependencyId}.`);
  }
  if (run.executionGraph?.nodes?.length) for (const task of tasks) {
    const ownedNodes = run.executionGraph.nodes.filter((node) => node.kind === "agent" && node.owner === task.displayName && node.stage === task.stage);
    if (!ownedNodes.length) throw new Error(`${task.taskId} is not owned by ${task.displayName} in execution_graph.json.`);
    const graphOutputs = new Set(ownedNodes.flatMap((node) => node.outputArtifactRefs));
    const outsideGraph = task.outputArtifactRefs.filter((artifactRef) => !graphOutputs.has(artifactRef));
    if (outsideGraph.length) throw new Error(`${task.taskId} claims outputs outside its execution-graph ownership: ${outsideGraph.join(", ")}`);
  }
  const dependencyLayers = topologicalBatches(tasks);
  const maxTasksPerStage = run.productionComplexityPlan?.settings?.maxSubagentTasksPerStage;
  if (Number.isInteger(maxTasksPerStage)) {
    const stageCounts = new Map();
    for (const task of tasks) stageCounts.set(task.stage, (stageCounts.get(task.stage) ?? 0) + 1);
    const overplanned = [...stageCounts.entries()].filter(([, count]) => count > maxTasksPerStage);
    if (overplanned.length) {
      throw new Error(`The ${run.productionComplexityPlan.profile} production profile permits at most ${maxTasksPerStage} delegated tasks per stage; overplanned stages: ${overplanned.map(([stage, count]) => `${stage}=${count}`).join(", ")}.`);
    }
  }
  const independentWidth = Math.max(...dependencyLayers.map((batch) => batch.length));
  if (independentWidth < 2) throw new Error("The proposed work has no independent tasks to run in parallel; keep it sequential instead of claiming a speed-up.");
  const requestedHostConcurrency = input.hostConcurrencyLimit ?? Math.min(4, independentWidth);
  const complexityConcurrencyLimit = run.productionComplexityPlan?.settings?.maxConcurrency ?? 32;
  const hostConcurrencyLimit = Math.min(requestedHostConcurrency, complexityConcurrencyLimit);
  if (!Number.isInteger(hostConcurrencyLimit) || hostConcurrencyLimit < 2 || hostConcurrencyLimit > 32) throw new Error("hostConcurrencyLimit must be an integer from 2 to 32.");
  const batches = dependencyLayers.flatMap((layer) => chunk(layer, hostConcurrencyLimit));
  const maxConcurrency = Math.min(independentWidth, hostConcurrencyLimit);
  const plan = {
    schemaVersion: "1.0",
    planId: input.planId,
    runId: run.runId,
    objective: input.objective,
    strategy: "capacity_bounded_dependency_layered_parallelism",
    delegationDepth: 0,
    childDelegationDepth: MAX_DELEGATION_DEPTH,
    maxDelegationDepth: MAX_DELEGATION_DEPTH,
    nestedDelegationAllowed: false,
    productionComplexityProfile: run.productionComplexityPlan?.profile ?? "unclassified",
    status: "awaiting_host_dispatch",
    hostConcurrencyLimit,
    independentWidth,
    maxConcurrency,
    estimatedDispatchWaves: batches.length,
    schedulingPolicy: "dispatch every task in the current wave without awaiting individual results; wait for the wave barrier before releasing dependent work",
    tasks,
    batches: batches.map((batch, index) => ({
      batchId: `${input.planId}-batch-${index + 1}`,
      order: index + 1,
      dispatch: "parallel",
      waitFor: "all",
      status: "pending",
      parallelGroupId: `${input.planId}:wave:${index + 1}`,
      startedAt: null,
      completedAt: null,
      taskIds: batch.map((task) => task.taskId),
      hostActions: batch.map((task) => spawnHostAction(task, {
        projectPath: input.projectPath,
        runId: run.runId,
        parallelGroupId: `${input.planId}:wave:${index + 1}`
      }))
    })),
    createdAt: now,
    updatedAt: now
  };
  return plan;
}

export function assertCanInstallSubagentPlan(run, planId) {
  const existing = run?.subagentOrchestrationPlan;
  if (!existing) return { status: "new_plan" };
  if (existing.planId === planId) return { status: "existing_plan", plan: structuredClone(existing) };
  throw new Error(`Director X Run ${run.runId} already owns subagent plan ${existing.planId}; replacing it with ${planId} would create a nested or conflicting delegation tree.`);
}

export async function writeParallelSubagentPlan({ projectPath, runId, plan }) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Director X run ID.");
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "parallel_subagent_plan.json");
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "parallel_subagent_plan.json", path };
}

export function compileParallelSubagentDispatchEvidence(plan) {
  const tasks = new Map((plan?.tasks ?? []).map((task) => [task.taskId, task]));
  const batches = (plan?.batches ?? []).map((batch) => {
    const batchTasks = batch.taskIds.map((taskId) => tasks.get(taskId)).filter(Boolean);
    const receipts = batchTasks.map((task) => task.dispatchReceipt).filter(Boolean);
    const overlapPairs = [];
    for (let leftIndex = 0; leftIndex < receipts.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < receipts.length; rightIndex += 1) {
      const left = receipts[leftIndex], right = receipts[rightIndex];
      const overlap = intervalsOverlap(left, right);
      overlapPairs.push({ leftTaskId: left.taskId, rightTaskId: right.taskId, overlap });
    }
    return {
      batchId: batch.batchId,
      order: batch.order,
      status: batch.status,
      requiredConcurrency: batch.taskIds.length,
      dispatchedCount: receipts.length,
      startedAt: batch.startedAt ?? null,
      completedAt: batch.completedAt ?? null,
      overlapObserved: overlapPairs.some((pair) => pair.overlap),
      overlapPairs,
      receipts: structuredClone(receipts)
    };
  });
  return {
    schemaVersion: "1.0",
    planId: plan?.planId ?? null,
    runId: plan?.runId ?? null,
    status: plan?.status ?? "missing",
    parallelismObserved: batches.some((batch) => batch.requiredConcurrency > 1 && batch.overlapObserved),
    batches,
    updatedAt: plan?.updatedAt ?? null
  };
}

export function assertStageParallelDispatchStarted(run, stageId, artifactRef = null) {
  const plan = run.subagentOrchestrationPlan;
  const stageTasks = (plan?.tasks ?? []).filter((task) => task.stage === stageId);
  if (!stageTasks.length) return { required: false, status: "not_planned" };
  const ownedTask = artifactRef ? stageTasks.find((task) => task.outputArtifactRefs.includes(artifactRef)) : null;
  if (artifactRef && !ownedTask) return { required: false, status: "not_owned" };
  const batch = ownedTask
    ? (plan.batches ?? []).find((candidate) => candidate.taskIds.includes(ownedTask.taskId))
    : firstStageBatch(plan, stageId);
  const targetTasks = tasksInBatch(plan, batch);
  const undispatched = targetTasks.filter((task) => !task.dispatchReceipt || !task.hostAgentId || task.hostLifecycle === "not_spawned");
  if (undispatched.length) {
    throw new Error(`Dispatch the complete DX parallel wave before ${artifactRef ? `registering ${artifactRef}` : `continuing ${stageId}`}: ${undispatched.map((task) => task.displayName).join(", ")}`);
  }
  return { required: true, status: "dispatched", taskIds: targetTasks.map((task) => task.taskId) };
}

export function assertStageParallelismObserved(run, stageId) {
  const plan = run.subagentOrchestrationPlan;
  const stageTasks = new Set((plan?.tasks ?? []).filter((task) => task.stage === stageId).map((task) => task.taskId));
  if (!stageTasks.size) return { required: false, status: "not_planned" };
  const evidence = compileParallelSubagentDispatchEvidence(plan);
  const concurrentBatches = evidence.batches.filter((batch) => {
    const sourceBatch = plan.batches.find((candidate) => candidate.batchId === batch.batchId);
    return batch.requiredConcurrency > 1 && sourceBatch?.taskIds.every((taskId) => stageTasks.has(taskId));
  });
  if (!concurrentBatches.length || concurrentBatches.some((batch) => !batch.overlapObserved)) {
    throw new Error(`Complete ${stageId} with observed overlapping DX subagent execution; sequential or missing dispatch cannot satisfy the parallel production contract.`);
  }
  return { required: true, status: "observed", batchIds: concurrentBatches.map((batch) => batch.batchId) };
}

export async function writeParallelSubagentDispatchEvidence({ projectPath, runId, plan }) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Director X run ID.");
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "parallel_subagent_dispatch.json");
  await writeFile(path, `${JSON.stringify(compileParallelSubagentDispatchEvidence(plan), null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "parallel_subagent_dispatch.json", path };
}

function validatePlanInput(input) {
  if (!input?.planId || !TASK_ID_PATTERN.test(input.planId)) throw new Error("planId must use letters, numbers, hyphens, or underscores.");
  if (!String(input.objective ?? "").trim()) throw new Error("Parallel subagent planning requires an objective.");
  if (!Array.isArray(input.tasks) || input.tasks.length < 2) throw new Error("Parallel subagent planning requires at least two tasks.");
  if (!Array.isArray(input.availableAgentTypes) || !input.availableAgentTypes.length) throw new Error("Parallel subagent planning requires the agent types visible in the current spawn_agent schema.");
  const ids = new Set();
  for (const task of input.tasks) {
    if (!TASK_ID_PATTERN.test(task.taskId ?? "") || ids.has(task.taskId)) throw new Error("Subagent task IDs must be present, unique, and filesystem-safe.");
    ids.add(task.taskId);
    if (!STAGES.has(task.stage)) throw new Error(`${task.taskId} has an unsupported stage: ${task.stage}`);
    for (const field of ["mission", "stopCondition", "approvalBoundary"]) if (!String(task[field] ?? "").trim()) throw new Error(`${task.taskId}.${field} is required.`);
    for (const field of ["inputArtifactRefs", "outputArtifactRefs", "dependsOnTaskIds", "allowedTools", "restrictedTools", "escalationTriggers"]) if (!Array.isArray(task[field])) throw new Error(`${task.taskId}.${field} must be an array.`);
    if (!task.outputArtifactRefs.length) throw new Error(`${task.taskId} must own at least one output artifact.`);
    if (!task.allowedTools.length) throw new Error(`${task.taskId} must declare its allowed tools.`);
    const nestedDelegationTools = task.allowedTools.filter((tool) => NESTED_DELEGATION_TOOLS.includes(tool));
    if (nestedDelegationTools.length) throw new Error(`${task.taskId} cannot allow nested delegation tools: ${nestedDelegationTools.join(", ")}.`);
    if (!task.escalationTriggers.length) throw new Error(`${task.taskId} must declare escalation triggers.`);
    if (!Number.isInteger(task.maxAttempts) || task.maxAttempts < 1) throw new Error(`${task.taskId}.maxAttempts must be a positive integer.`);
    if (!Number.isFinite(task.maxCost) || task.maxCost < 0) throw new Error(`${task.taskId}.maxCost must be non-negative.`);
    if (!String(task.currency ?? "").trim()) throw new Error(`${task.taskId}.currency is required.`);
  }
}

function topologicalBatches(tasks) {
  const remaining = new Map(tasks.map((task) => [task.taskId, task]));
  const completed = new Set();
  const batches = [];
  while (remaining.size) {
    const dependencyReady = [...remaining.values()].filter((task) => task.dependsOnTaskIds.every((dependency) => completed.has(dependency)));
    if (!dependencyReady.length) throw new Error("Parallel subagent plan must be acyclic.");
    const earliestStage = Math.min(...dependencyReady.map((task) => STAGE_ORDER.indexOf(task.stage)));
    const ready = dependencyReady.filter((task) => STAGE_ORDER.indexOf(task.stage) === earliestStage);
    batches.push(ready);
    for (const task of ready) { remaining.delete(task.taskId); completed.add(task.taskId); }
  }
  return batches;
}

function buildSubagentPrompt(role, task, context = {}) {
  return buildDelegatedSubagentPrompt(role, task, context);
}

function spawnHostAction(task, context) {
  const protocol = compileSubagentHostProtocol({
    projectPath: context.projectPath,
    runId: context.runId,
    task
  });
  return {
    type: "spawn_agent",
    required: true,
    requiredStage: task.stage,
    arguments: protocol.spawnArguments,
    expectedNickname: protocol.expectedNickname,
    expectedCanonicalIdentity: protocol.expectedCanonicalIdentity,
    delegationDepth: task.delegationDepth,
    maxDelegationDepth: task.maxDelegationDepth,
    nestedDelegationAllowed: false,
    parallelGroupId: context.parallelGroupId,
    hostNicknamePolicy: protocol.hostNicknamePolicy,
    hostIdentitySource: protocol.hostIdentitySource,
    hostReleaseStrategy: protocol.hostReleaseStrategy,
    afterSpawn: protocol.afterSpawn,
    afterTerminal: protocol.afterTerminal
  };
}

function formatList(values) { return values.length ? values.join(", ") : "none"; }

function chunk(values, size) {
  const groups = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}

function firstStageBatch(plan, stageId) {
  const batch = [...(plan.batches ?? [])].sort((left, right) => left.order - right.order).find((candidate) =>
    candidate.taskIds.some((taskId) => plan.tasks.find((task) => task.taskId === taskId)?.stage === stageId)
  );
  if (!batch) throw new Error(`No parallel dispatch batch exists for stage ${stageId}.`);
  return batch;
}

function tasksInBatch(plan, batch) {
  if (!batch) throw new Error("Parallel subagent task is missing its dispatch batch.");
  return batch.taskIds.map((taskId) => plan.tasks.find((task) => task.taskId === taskId)).filter(Boolean);
}

function intervalsOverlap(left, right) {
  const leftStart = Date.parse(left.dispatchedAt);
  const rightStart = Date.parse(right.dispatchedAt);
  const leftEnd = left.terminalAt ? Date.parse(left.terminalAt) : Number.POSITIVE_INFINITY;
  const rightEnd = right.terminalAt ? Date.parse(right.terminalAt) : Number.POSITIVE_INFINITY;
  return Number.isFinite(leftStart) && Number.isFinite(rightStart) && leftStart < rightEnd && rightStart < leftEnd;
}

function upstreamAgentGroups(nodeId, nodeById, groupKeyByNodeId, seen = new Set()) {
  if (seen.has(nodeId)) return [];
  seen.add(nodeId);
  const directGroup = groupKeyByNodeId.get(nodeId);
  if (directGroup) return [directGroup];
  const node = nodeById.get(nodeId);
  if (!node) return [];
  return uniqueStrings((node.dependsOn ?? []).flatMap((dependencyId) => upstreamAgentGroups(dependencyId, nodeById, groupKeyByNodeId, seen)));
}

function safeTaskId(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  if (!TASK_ID_PATTERN.test(normalized)) throw new Error(`Cannot derive a safe DX task ID from ${value}.`);
  return normalized;
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}
