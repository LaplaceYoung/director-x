import test from "node:test";
import assert from "node:assert/strict";
import { classifyDxHostNickname, confirmDxSubagentHostClosed, DX_SUBAGENT_CATALOG, dxIdentityInstruction, registerDxSubagent, updateDxSubagent } from "./subagent-registry.mjs";

test("catalog gives every Director X subagent a canonical DX name", () => {
  assert.equal(DX_SUBAGENT_CATALOG.length, 13);
  assert.ok(DX_SUBAGENT_CATALOG.every((role) => /^DX-/.test(role.displayName)));
  assert.ok(DX_SUBAGENT_CATALOG.every((role) => /^dx_[a-z_]+$/.test(role.agentType)));
  assert.equal(new Set(DX_SUBAGENT_CATALOG.map((role) => role.displayName)).size, DX_SUBAGENT_CATALOG.length);
  assert.equal(new Set(DX_SUBAGENT_CATALOG.map((role) => role.agentType)).size, DX_SUBAGENT_CATALOG.length);
});

test("registers and updates a host agent through its canonical DX identity", () => {
  const run = {};
  registerDxSubagent(run, { roleId: "shot_planner", displayName: "DX-Shot-Planner", hostAgentId: "agent-1", hostNickname: "DX-Shot-Planner", stage: "storyboard", mission: "Plan shots", inputArtifactRefs: ["script_or_outline.json"], outputArtifactRefs: ["shotlist.json"], status: "running" });
  updateDxSubagent(run, { displayName: "DX-Shot-Planner", status: "complete", detail: "Shotlist ready", outputArtifactRefs: ["keyframe_storyboard.json"] });
  assert.equal(run.subagents[0].status, "complete");
  assert.equal(run.subagents[0].hostLifecycle, "release_required");
  assert.deepEqual(run.subagents[0].outputArtifactRefs, ["shotlist.json", "keyframe_storyboard.json"]);
  confirmDxSubagentHostClosed(run, { displayName: "DX-Shot-Planner", hostAgentId: "agent-1", closedBy: "close_agent", hostCloseStatus: "closed" }, "2026-07-16T01:00:00.000Z");
  assert.equal(run.subagents[0].hostLifecycle, "released");
  assert.match(dxIdentityInstruction("DX-Shot-Planner"), /^Director X identity: DX-Shot-Planner/);
});

test("rejects non-DX and noncanonical role names", () => {
  assert.throws(() => registerDxSubagent({}, { roleId: "shot_planner", displayName: "Shot Planner", hostAgentId: "a", stage: "storyboard", mission: "x" }), /must match DX-/);
  assert.throws(() => registerDxSubagent({}, { roleId: "shot_planner", displayName: "DX-Shots", hostAgentId: "a", stage: "storyboard", mission: "x" }), /canonical name DX-Shot-Planner/);
});

test("rejects a generic Codex host nickname instead of masking it", () => {
  assert.throws(() => registerDxSubagent({}, { roleId: "shot_planner", displayName: "DX-Shot-Planner", hostAgentId: "a", hostNickname: "random-host-name", stage: "storyboard", mission: "x" }), /dx_shot_planner.*DX-Shot-Planner/);
});

test("keeps built-in host nickname as trace metadata under canonical DX identity", () => {
  const run = {
    orchestrationPolicy: { canonicalDxRequired: true },
    subagentOrchestrationPlan: {
      planId: "compat",
      tasks: [{
        taskId: "shots", roleId: "shot_planner", displayName: "DX-Shot-Planner", stage: "storyboard",
        status: "pending", outputArtifactRefs: ["shotlist.json"], agentType: "default",
        preferredAgentType: "dx_shot_planner", hostAgentTypeMode: "builtin_compatibility"
      }],
      batches: [{ batchId: "compat-batch-1", order: 1, status: "pending", taskIds: ["shots"] }]
    }
  };
  registerDxSubagent(run, { roleId: "shot_planner", displayName: "DX-Shot-Planner", hostAgentId: "agent-compat", hostNickname: "Cobalt", stage: "storyboard", mission: "Plan shots", status: "running" });
  assert.equal(run.subagents[0].displayName, "DX-Shot-Planner");
  assert.equal(run.subagents[0].hostNickname, "Cobalt");
  assert.equal(run.subagents[0].hostNicknameMode, "builtin_trace_only");
  assert.equal(run.subagents[0].hostAgentType, "default");
  assert.equal(run.subagentOrchestrationPlan.tasks[0].dispatchReceipt.agentType, "default");
  assert.equal(run.subagentOrchestrationPlan.tasks[0].dispatchReceipt.preferredAgentType, "dx_shot_planner");
});

test("accepts collaboration task paths as trace metadata and auto-releases terminal hosts", () => {
  const run = {
    artifacts: { "reference_analysis.json": { path: "/tmp/reference_analysis.json" } },
    orchestrationPolicy: { canonicalDxRequired: true },
    subagentOrchestrationPlan: {
      planId: "collaboration",
      tasks: [{
        taskId: "refs", roleId: "reference_analyst", displayName: "DX-Reference-Analyst", stage: "research",
        status: "pending", outputArtifactRefs: ["reference_analysis.json"], agentType: "collaboration_task",
        preferredAgentType: "dx_reference_analyst", hostAgentTypeMode: "collaboration_task",
        hostReleaseRequired: false, hostReleaseStrategy: "terminal_event",
        hostIdentitySource: "sub_agent_activity.agent_thread_id"
      }],
      batches: [{ batchId: "collaboration-batch-1", order: 1, status: "pending", taskIds: ["refs"] }]
    }
  };
  registerDxSubagent(run, {
    roleId: "reference_analyst", displayName: "DX-Reference-Analyst",
    hostAgentId: "019f-agent-thread", hostNickname: "/root/dx_reference_analyst_refs",
    stage: "research", mission: "Research", outputArtifactRefs: ["reference_analysis.json"], status: "running"
  });
  assert.equal(run.subagents[0].hostNicknameMode, "collaboration_task_trace_only");
  assert.equal(run.subagents[0].hostReleaseStrategy, "terminal_event");
  updateDxSubagent(run, {
    displayName: "DX-Reference-Analyst", status: "complete",
    detail: "Terminal sub_agent_activity received", outputArtifactRefs: ["reference_analysis.json"]
  });
  assert.equal(run.subagents[0].hostLifecycle, "released");
  assert.ok(run.subagents[0].hostReleasedAt);
  assert.equal(run.subagentOrchestrationPlan.tasks[0].hostLifecycle, "released");
  assert.equal(run.subagentOrchestrationPlan.batches[0].status, "complete");
});

test("normalizes Codex ordinal host variants while preserving one canonical DX production identity", () => {
  const run = {};
  registerDxSubagent(run, { roleId: "quality_evaluator", displayName: "DX-Quality-Reviewer", hostAgentId: "agent-q", hostNickname: "DX-Quality-Reviewer the 3rd", stage: "review", mission: "Review", status: "running" });
  assert.equal(run.subagents[0].displayName, "DX-Quality-Reviewer");
  assert.equal(run.subagents[0].hostNicknameMode, "codex_ordinal_variant");
  assert.equal(classifyDxHostNickname("DX-Quality-Reviewer", "DX-Quality-Reviewer"), "canonical");
  assert.equal(classifyDxHostNickname("DX-Quality-Reviewer the 12th", "DX-Quality-Reviewer"), "codex_ordinal_variant");
});

test("binds required DX agents to a plan and blocks completion before real artifact handoff", () => {
  const run = {
    orchestrationPolicy: { canonicalDxRequired: true },
    artifacts: {},
    subagentOrchestrationPlan: {
      status: "awaiting_host_dispatch",
      planId: "research-plan",
      tasks: [
        { taskId: "refs", roleId: "reference_analyst", displayName: "DX-Reference-Analyst", stage: "research", status: "pending", outputArtifactRefs: ["reference_analysis.json"] },
        { taskId: "assets", roleId: "asset_manager", displayName: "DX-Asset-Manager", stage: "research", status: "pending", outputArtifactRefs: ["asset_manifest.json"] }
      ],
      batches: [{ batchId: "research-plan-batch-1", order: 1, status: "pending", taskIds: ["refs", "assets"] }]
    }
  };
  registerDxSubagent(run, { roleId: "reference_analyst", displayName: "DX-Reference-Analyst", hostAgentId: "agent-ref", hostNickname: "DX-Reference-Analyst", stage: "research", mission: "research", outputArtifactRefs: ["reference_analysis.json"], status: "running" });
  assert.equal(run.subagentOrchestrationPlan.tasks[0].hostAgentId, "agent-ref");
  assert.equal(run.subagentOrchestrationPlan.tasks[0].dispatchReceipt.hostAgentId, "agent-ref");
  assert.equal(run.subagentOrchestrationPlan.batches[0].status, "running");
  assert.throws(() => updateDxSubagent(run, { displayName: "DX-Reference-Analyst", status: "complete", detail: "done", outputArtifactRefs: ["reference_analysis.json"] }), /registering real artifacts/);
  assert.equal(run.subagents[0].status, "running");
  run.artifacts["reference_analysis.json"] = { path: "/tmp/reference_analysis.json" };
  updateDxSubagent(run, { displayName: "DX-Reference-Analyst", status: "complete", detail: "done", outputArtifactRefs: ["reference_analysis.json"] });
  assert.equal(run.subagentOrchestrationPlan.tasks[0].status, "complete");
  assert.equal(run.subagentOrchestrationPlan.status, "running");
  assert.equal(run.subagentOrchestrationPlan.tasks[0].hostLifecycle, "release_required");
  confirmDxSubagentHostClosed(run, { displayName: "DX-Reference-Analyst", hostAgentId: "agent-ref", closedBy: "close_agent", hostCloseStatus: "closed" });
  assert.equal(run.subagentOrchestrationPlan.tasks[0].hostLifecycle, "released");
});

test("accepts an explicit close_agent release acknowledgement through update", () => {
  const run = { artifacts: { "refs.json": {} }, subagentOrchestrationPlan: { tasks: [{ taskId: "refs", roleId: "reference_analyst", stage: "research", status: "pending", hostReleaseRequired: true, outputArtifactRefs: ["refs.json"] }], batches: [{ batchId: "b1", order: 1, status: "pending", taskIds: ["refs"] }] } };
  registerDxSubagent(run, { roleId: "reference_analyst", displayName: "DX-Reference-Analyst", hostAgentId: "agent-refs", hostNickname: "DX-Reference-Analyst", stage: "research", mission: "Research", outputArtifactRefs: ["refs.json"], status: "running" });
  updateDxSubagent(run, { displayName: "DX-Reference-Analyst", status: "complete", detail: "done", outputArtifactRefs: ["refs.json"], hostRelease: { hostAgentId: "agent-refs", closedBy: "close_agent", hostCloseStatus: "closed" } });
  assert.equal(run.subagents[0].hostLifecycle, "released");
  assert.equal(run.subagentOrchestrationPlan.tasks[0].hostLifecycle, "released");
});

test("blocks later dispatch batches until prior artifacts complete and terminal hosts release", () => {
  const run = {
    orchestrationPolicy: { canonicalDxRequired: true },
    artifacts: { "refs.json": {}, "assets.json": {}, "route.json": {} },
    subagents: [],
    subagentOrchestrationPlan: {
      planId: "wave",
      status: "awaiting_host_dispatch",
      tasks: [
        { taskId: "refs", roleId: "reference_analyst", agentType: "dx_reference_analyst", displayName: "DX-Reference-Analyst", stage: "research", status: "pending", hostLifecycle: "not_spawned", hostReleaseRequired: true, outputArtifactRefs: ["refs.json"] },
        { taskId: "assets", roleId: "asset_manager", agentType: "dx_asset_manager", displayName: "DX-Asset-Manager", stage: "research", status: "pending", hostLifecycle: "not_spawned", hostReleaseRequired: true, outputArtifactRefs: ["assets.json"] },
        { taskId: "route", roleId: "model_router", agentType: "dx_model_router", displayName: "DX-Model-Router", stage: "research", status: "pending", hostLifecycle: "not_spawned", hostReleaseRequired: true, outputArtifactRefs: ["route.json"] }
      ],
      batches: [
        { batchId: "wave-batch-1", order: 1, status: "pending", taskIds: ["refs", "assets"] },
        { batchId: "wave-batch-2", order: 2, status: "pending", taskIds: ["route"] }
      ]
    }
  };
  const spawn = (roleId, displayName, hostAgentId) => registerDxSubagent(run, { roleId, displayName, hostAgentId, hostNickname: displayName, stage: "research", mission: roleId, status: "running" });
  assert.throws(() => spawn("model_router", "DX-Model-Router", "agent-route"), /prior batches complete/);
  spawn("reference_analyst", "DX-Reference-Analyst", "agent-refs");
  spawn("asset_manager", "DX-Asset-Manager", "agent-assets");
  updateDxSubagent(run, { displayName: "DX-Reference-Analyst", status: "complete", detail: "done", outputArtifactRefs: ["refs.json"] });
  updateDxSubagent(run, { displayName: "DX-Asset-Manager", status: "complete", detail: "done", outputArtifactRefs: ["assets.json"] });
  assert.equal(run.subagentOrchestrationPlan.batches[0].status, "running");
  confirmDxSubagentHostClosed(run, { displayName: "DX-Reference-Analyst", hostAgentId: "agent-refs", closedBy: "close_agent", hostCloseStatus: "closed" });
  confirmDxSubagentHostClosed(run, { displayName: "DX-Asset-Manager", hostAgentId: "agent-assets", closedBy: "close_agent", hostCloseStatus: "closed" });
  assert.equal(run.subagentOrchestrationPlan.batches[0].status, "complete");
  spawn("model_router", "DX-Model-Router", "agent-route");
  assert.equal(run.subagentOrchestrationPlan.batches[1].status, "running");
  assert.equal(run.subagentOrchestrationPlan.tasks[2].dispatchReceipt.batchId, "wave-batch-2");
  assert.throws(() => spawn("model_router", "DX-Model-Router", "agent-route-duplicate"), /already dispatched/);
});

test("rejects forged or premature DX host-release confirmations", () => {
  const run = {};
  registerDxSubagent(run, { roleId: "editing_agent", displayName: "DX-Editor", hostAgentId: "agent-editor", hostNickname: "DX-Editor", stage: "edit", mission: "Edit", status: "running" });
  assert.throws(() => confirmDxSubagentHostClosed(run, { displayName: "DX-Editor", hostAgentId: "agent-editor", closedBy: "close_agent", hostCloseStatus: "closed" }), /terminal handoff/);
  updateDxSubagent(run, { displayName: "DX-Editor", status: "failed", detail: "failed" });
  assert.throws(() => confirmDxSubagentHostClosed(run, { displayName: "DX-Editor", hostAgentId: "other", closedBy: "close_agent", hostCloseStatus: "closed" }), /does not match/);
  assert.throws(() => confirmDxSubagentHostClosed(run, { displayName: "DX-Editor", hostAgentId: "agent-editor", closedBy: "manual", hostCloseStatus: "closed" }), /successful Codex close_agent/);
});
