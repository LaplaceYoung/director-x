import test from "node:test";
import assert from "node:assert/strict";
import { projectCanvas } from "./canvas-projector.mjs";

test("projects run stages, approvals, and production objects into a graph", () => {
  const canvas = projectCanvas({
    stage: "storyboard",
    status: "ready",
    goal: { outcome: "制作 60 秒品牌片", displayMode: "Director X Goal" },
    approvals: [{ id: "budget", kind: "budget", status: "approved" }],
    events: [{ sequence: 2, stage: "storyboard", detail: "分镜表已生成" }],
    canvas: {
      nodes: [{ id: "shot:01", type: "shot", label: "镜头 01", stage: "storyboard", status: "complete", artifactRef: "shotlist.json" }],
      edges: [{ id: "shot-edge", source: "stage:storyboard", target: "shot:01" }]
    }
  });
  assert.deepEqual(canvas.views, ["media", "review", "activity", "workflow", "coverage", "continuity", "storyboard"]);
  assert.equal(canvas.nodes.find((node) => node.id === "stage:storyboard").status, "active");
  assert.equal(canvas.assets.length, 0);
  assert.ok(canvas.edges.some((edge) => edge.target === "shot:01"));
});

test("projects the negotiated Codex host contract without adding workflow clutter", () => {
  const hostCapabilities = {
    productionReadiness: { status: "ready", blockers: [], mayCreateRun: true },
    transport: { agent: "typed_spawn_agent", interaction: "request_user_input", surface: "in_app_browser_skill" }
  };
  const canvas = projectCanvas({
    stage: "intake",
    status: "production_in_progress",
    goal: { outcome: "film" },
    approvals: [],
    events: [],
    canvas: { nodes: [], edges: [] },
    hostCapabilities
  });
  assert.deepEqual(canvas.hostCapabilities, hostCapabilities);
  assert.equal(canvas.nodes.some((node) => node.id.startsWith("host-capability:")), false);
});

test("provides a compact non-overlapping workflow projection instead of every diagnostic node", () => {
  const canvas = projectCanvas({
    stage: "generation", status: "production_in_progress", goal: { outcome: "film" },
    approvals: [
      { id: "image", kind: "image_model", status: "approved" },
      { id: "video", kind: "video_model", status: "pending" },
      { id: "voice", kind: "voice_model", status: "approved" }
    ],
    events: [], canvas: { nodes: [], edges: [] },
    subagents: [
      { displayName: "DX-Provider-Operator", stage: "generation", status: "running", mission: "generate" },
      { displayName: "DX-Reviewer", stage: "review", status: "pending", mission: "review" }
    ],
    executionGraph: { graphId: "g", revision: 1, nodes: Array.from({ length: 12 }, (_, index) => ({ nodeId: `n${index}`, kind: "tool", stage: "generation", label: `Tool ${index}`, owner: "DX-Provider-Operator", capability: "video.text_to_video", dependsOn: [], inputArtifactRefs: [], outputArtifactRefs: [], status: "pending" })) },
    executionTelemetry: { executions: Array.from({ length: 20 }, (_, index) => ({ executionId: `e${index}`, capabilityId: "video.text_to_video", toolId: "tool", status: "succeeded" })) }
  });
  assert.ok(canvas.workflow.nodes.length <= 16);
  const occupied = new Set(canvas.workflow.nodes.map((node) => `${node.x}:${node.y}`));
  assert.equal(occupied.size, canvas.workflow.nodes.length);
  assert.ok(canvas.workflow.edges.length <= canvas.workflow.nodes.length + 2);
  assert.ok(canvas.workflow.nodes.some((node) => node.id === "approval:video_model"));
  assert.ok(!canvas.workflow.nodes.some((node) => node.id.startsWith("telemetry:")));
});

test("exposes only generated Markdown and essential media as storyboard assets", () => {
  const canvas = projectCanvas({
    stage: "storyboard", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] },
    artifacts: {
      "Director.md": { mediaKind: "document", relativePath: "Director.md", stage: "intake" },
      "script_or_outline.json": { mediaKind: "document", relativePath: "script_or_outline.json", stage: "script" },
      "checkpoint_replay.json": { mediaKind: "document", relativePath: "checkpoint_replay.json", stage: "storyboard" },
      "execution_telemetry.json": { mediaKind: "document", relativePath: "execution_telemetry.json", stage: "review" },
      "notes.md": { mediaKind: "document", relativePath: "notes.md", stage: "script" },
      "approved-treatment.md": { mediaKind: "document", relativePath: "approved-treatment.md", stage: "script", metadata: { canvasEssential: true } },
      "hero.png": { mediaKind: "image", relativePath: "hero.png", stage: "storyboard", metadata: { canvasEssential: true } },
      "clip.mp4": { mediaKind: "video", relativePath: "clip.mp4", stage: "generation", metadata: { canvasEssential: true } },
      "voice.wav": { mediaKind: "audio", relativePath: "voice.wav", stage: "generation", metadata: { canvasEssential: true } },
      "audit-frame.png": { mediaKind: "image", relativePath: "audit-frame.png", stage: "review", metadata: { canvasEssential: true, findingId: "f-1" } }
    }
  });
  assert.deepEqual(canvas.assets.map((asset) => asset.artifactRef).sort(), ["Director.md", "approved-treatment.md", "clip.mp4", "hero.png", "notes.md", "voice.wav"].sort());
  assert.deepEqual([...new Set(canvas.assets.map((asset) => asset.type))].sort(), ["audio", "document", "image", "video"]);
});

test("projects typed relations between research, Markdown, image, audio, and video assets", () => {
  const canvas = projectCanvas({
    stage: "edit", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] },
    artifacts: {
      "research.md": { mediaKind: "document", relativePath: "research.md", stage: "research" },
      "script.md": { mediaKind: "document", relativePath: "script.md", stage: "script", metadata: { sourceArtifactRefs: ["research.md"] } },
      "hero.png": { mediaKind: "image", relativePath: "hero.png", stage: "generation", metadata: { canvasEssential: true, sourceArtifactRefs: ["script.md"] } },
      "voice.wav": { mediaKind: "audio", relativePath: "voice.wav", stage: "generation", metadata: { canvasEssential: true, sourceArtifactRefs: ["script.md"] } },
      "final.mp4": { mediaKind: "video", relativePath: "final.mp4", stage: "edit", metadata: { canvasEssential: true, sourceArtifactRefs: ["hero.png", "voice.wav"] } }
    }
  });
  assert.equal(canvas.assetRelations.length, 5);
  assert.ok(canvas.assetRelations.some((edge) => edge.sourceArtifactRef === "research.md" && edge.targetArtifactRef === "script.md"));
  assert.ok(canvas.assetRelations.some((edge) => edge.sourceArtifactRef === "hero.png" && edge.targetArtifactRef === "final.mp4"));
  assert.ok(canvas.assetRelations.every((edge) => edge.kind === "derived_from"));
});

test("projects a media-first graph with playable assets and only asset-to-asset relations", () => {
  const canvas = projectCanvas({
    stage: "generation", status: "production_in_progress", goal: { outcome: "media graph" }, approvals: [], events: [], canvas: { nodes: [], edges: [] },
    artifacts: {
      "logo.png": { mediaKind: "image", relativePath: "logo.png", stage: "research", metadata: { canvasEssential: true } },
      "shot-01.mp4": { mediaKind: "video", relativePath: "shot-01.mp4", stage: "generation", metadata: { canvasEssential: true, sourceArtifactRefs: ["logo.png"] } },
      "voice.wav": { mediaKind: "audio", relativePath: "voice.wav", stage: "edit", metadata: { canvasEssential: true, sourceArtifactRefs: ["shot-01.mp4"] } },
      "internal.json": { mediaKind: "document", relativePath: "internal.json", stage: "review", metadata: { internal: true } }
    }
  });
  assert.deepEqual(canvas.mediaGraph.counts, { image: 1, video: 1, audio: 1, document: 0 });
  assert.equal(canvas.mediaGraph.nodes.length, 3);
  assert.equal(canvas.mediaGraph.edges.length, 2);
  assert.ok(canvas.mediaGraph.edges.every((edge) => edge.source.startsWith("artifact:") && edge.target.startsWith("artifact:")));
  assert.equal(canvas.summary.mediaGraphNodeCount, 3);
  assert.equal(canvas.summary.mediaGraphEdgeCount, 2);
});

test("projects per-shot grounding from acquired media through readable reports into prompt documents", () => {
  const canvas = projectCanvas({
    stage: "storyboard", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] },
    artifacts: {
      "mosi-logo.png": { mediaKind: "image", relativePath: "mosi-logo.png", stage: "research", metadata: { canvasEssential: true } },
      "shot_grounding_plan.md": { mediaKind: "document", relativePath: "shot_grounding_plan.md", stage: "storyboard" },
      "shot_grounding_report.md": { mediaKind: "document", relativePath: "shot_grounding_report.md", stage: "storyboard", metadata: { sourceArtifactRefs: ["shot_grounding_plan.md", "mosi-logo.png"] } },
      "visual_prompt_pack.md": { mediaKind: "document", relativePath: "visual_prompt_pack.md", stage: "storyboard", metadata: { sourceArtifactRefs: ["shot_grounding_report.md"] } }
    }
  });
  assert.ok(canvas.assetRelations.some((edge) => edge.sourceArtifactRef === "mosi-logo.png" && edge.targetArtifactRef === "shot_grounding_report.md"));
  assert.ok(canvas.assetRelations.some((edge) => edge.sourceArtifactRef === "shot_grounding_report.md" && edge.targetArtifactRef === "visual_prompt_pack.md"));
});

test("projects run mode and superseding recovery checkpoints", () => {
  const canvas = projectCanvas({ stage: "research", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, runMode: { mode: "guided_autonomy", confirmedBy: "request_user_input" }, checkpoints: [
    { checkpointId: "c1", sequence: 1, stage: "intake", reason: "run.mode.configured", eventCursor: 2, artifactRefs: [] },
    { checkpointId: "c2", sequence: 2, stage: "research", reason: "stage.active", eventCursor: 5, artifactRefs: ["research_plan.json"], supersedes: "c1" }
  ] });
  assert.equal(canvas.nodes.find((node) => node.id === "run:mode").detail, "引导自治");
  assert.equal(canvas.summary.checkpointCount, 2);
  assert.ok(canvas.edges.some((edge) => edge.source === "checkpoint:c1" && edge.target === "checkpoint:c2"));
});

test("projects runtime provider capability evidence", () => {
  const canvas = projectCanvas({ stage: "generation", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, pipeline: { stages: [{ id: "generation", label: "Generation" }], stageStates: { generation: { status: "active" } } }, providerCapabilities: { "p:m": { providerId: "p", modelId: "m", status: "degraded", capabilities: ["image_to_video"], evidence: "dry-run" } } });
  assert.equal(canvas.summary.providerProbeCount, 1);
  assert.equal(canvas.nodes.find((node) => node.id === "provider:p:m").status, "blocked");
});

test("projects asynchronous provider input back to Codex interaction", () => {
  const canvas = projectCanvas({ stage: "generation", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, generation: { currency: "CNY", totalActualCost: 0, totalEstimatedCost: 1, requests: [], providerJobs: [{ providerJobId: "job-1", status: "input_required", inputRequest: { instruction: "上传首帧" } }] }, repairs: [{ repairId: "fix-1" }] });
  assert.equal(canvas.summary.providerJobCount, 1);
  assert.equal(canvas.summary.repairBranchCount, 1);
  assert.equal(canvas.activity.pendingInteractions[0].instruction, "上传首帧");
});

test("projects negotiated task transport and synchronized A/V review timeline", () => {
  const timeline = { durationSeconds: 10, shots: [], subtitles: [], audioTracks: [], markers: [{ id: "m1", timeSeconds: 2, kind: "defect", label: "jitter", evidenceRef: "frame.jpg" }] };
  const canvas = projectCanvas({ stage: "review", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, taskTransport: { transport: "provider_job_polling" }, avReviewTimeline: timeline });
  assert.equal(canvas.summary.taskTransport, "provider_job_polling");
  assert.equal(canvas.summary.reviewTimelineMarkerCount, 1);
  assert.equal(canvas.reviewTimeline, timeline);
});

test("projects native Codex interactions, evidence gaps, DX agents, and long-form frame handoffs", () => {
  const canvas = projectCanvas({
    stage: "storyboard", status: "production_in_progress", goal: { outcome: "long film" },
    approvals: [{ kind: "video_model", status: "pending" }], artifacts: { "shotlist.json": { path: "/tmp/shotlist.json" } },
    pipeline: { label: "长视频", stages: [{ id: "storyboard", requiredOutputs: ["shotlist.json", "frame_handoff_manifest.json"] }], stageStates: { storyboard: { status: "active" } } },
    subagents: [{ displayName: "DX-Shot-Planner", roleId: "shot_planner", hostAgentId: "agent-shot", hostNickname: "DX-Shot-Planner the 2nd", hostNicknameMode: "codex_ordinal_variant", stage: "storyboard", status: "running", mission: "plan linked segments" }],
    longformPlan: { segments: [
      { segmentId: "s1", durationSeconds: 8, storyBeat: "start", generationRequestId: "r1", outputEndFrameAssetId: "f1" },
      { segmentId: "s2", durationSeconds: 8, storyBeat: "continue", generationRequestId: "r2", inputStartFrameAssetId: "f1", outputEndFrameAssetId: "f2" }
    ] }, events: [{ sequence: 4, stage: "storyboard", type: "agent.running", detail: "planning" }], canvas: { nodes: [], edges: [] }
  });
  assert.equal(canvas.activity.pendingInteractions[0].interactionSurface, "codex_request_user_input");
  assert.deepEqual(canvas.activity.missingEvidence, ["frame_handoff_manifest.json"]);
  const agentNode = canvas.nodes.find((node) => node.id === "agent:DX-Shot-Planner");
  assert.equal(agentNode.status, "active");
  assert.equal(agentNode.metadata.hostIdentityStatus, "codex_ordinal_variant");
  assert.equal(agentNode.metadata.hostNickname, undefined);
  assert.ok(canvas.edges.some((edge) => edge.kind === "frame_handoff" && edge.source === "segment:s1" && edge.target === "segment:s2"));
});

test("projects a separate multi-camera continuity view without cluttering the workflow", () => {
  const canvas = projectCanvas({
    stage: "storyboard", status: "production_in_progress", goal: { outcome: "multi-camera film" }, approvals: [], artifacts: {}, events: [], canvas: { nodes: [], edges: [] },
    cameraContinuityGraph: {
      graphId: "cg-1", status: "ready",
      cameras: [{ cameraId: "CAM-A", row: 0 }, { cameraId: "CAM-B", row: 1 }],
      executionWaves: [{ wave: 1, taskNodeIds: ["frame:S01:first"] }, { wave: 2, taskNodeIds: ["frame:S01:last", "frame:S02:first"] }],
      shots: [
        { shotId: "S01", requestId: "R1", order: 0, cameraId: "CAM-A", sceneId: "SC-1", durationSeconds: 4, handoffStrategy: null, parentShotId: null, parentFrameRole: null, taskNodeIds: { firstFrame: "frame:S01:first", lastFrame: "frame:S01:last", clip: "clip:S01" }, referenceTargetIds: ["reference:S01:first"] },
        { shotId: "S02", requestId: "R2", order: 1, cameraId: "CAM-B", sceneId: "SC-1", durationSeconds: 4, handoffStrategy: "reference_recompose", parentShotId: "S01", parentFrameRole: "last", taskNodeIds: { firstFrame: "frame:S02:first", lastFrame: null, clip: "clip:S02" }, referenceTargetIds: ["reference:S02:first"] }
      ]
    },
    cameraReferenceSelectionPlan: {
      status: "approved",
      targets: [
        { targetId: "reference:S01:first", selectedAssetRefs: ["portrait:alice"] },
        { targetId: "reference:S02:first", selectedAssetRefs: ["frame:S01:last", "portrait:bob"] }
      ]
    }
  });
  assert.ok(canvas.views.includes("continuity"));
  assert.deepEqual(canvas.cameraContinuity.nodes.map((node) => node.id), ["camera-shot:S01", "camera-shot:S02"]);
  assert.equal(canvas.cameraContinuity.edges[0].kind, "reference_recompose");
  assert.equal(canvas.cameraContinuity.nodes[1].metadata.references[0].selectedAssetRefs.length, 2);
  assert.equal(canvas.summary.cameraContinuityGraph.executionWaveCount, 2);
  assert.ok(!canvas.workflow.nodes.some((node) => node.id.startsWith("camera-shot:")));
});

test("projects scene coverage as a grouped table view without adding workflow edges", () => {
  const canvas = projectCanvas({
    stage: "storyboard", status: "production_in_progress", goal: { outcome: "coverage film" }, approvals: [], artifacts: {}, events: [], canvas: { nodes: [], edges: [] },
    sceneCoveragePlan: {
      planId: "coverage-1", sequenceId: "sequence-1", status: "revision_required", overallScore: 82,
      dimensions: { coverageCompleteness: 100, spatialContinuity: 82, editSafety: 75, compositionDepth: 80, setupEfficiency: 73 },
      scenes: [{ sceneId: "SC-1", purpose: "prove product", axisId: "axis-1", axisType: "product_demo", defaultScreenDirection: "left_to_right", coverageMatrix: { geography: true, action: true, reaction: false, proof: true, editSafety: true } }],
      shots: [
        { shotId: "S01", sceneId: "SC-1", coverageRole: "geography", shotSize: "WS", lensMm: 28, movement: "locked", cameraSide: "axis_a", cameraHeight: "eye", cameraAzimuthDegrees: 20, cameraDistanceMeters: 4, lighting: { keyDirection: "front_left", colorTemperatureK: 5200 }, handles: { headSeconds: .5, tailSeconds: .5 }, composition: { foreground: "desk", midground: "person", background: "office" }, blocking: [], fallbackShotId: "S02" },
        { shotId: "S02", sceneId: "SC-1", coverageRole: "proof", shotSize: "CU", lensMm: 70, movement: "micro push", cameraSide: "axis_a", cameraHeight: "eye", cameraAzimuthDegrees: 45, cameraDistanceMeters: 1.2, lighting: { keyDirection: "front_left", colorTemperatureK: 5200 }, handles: { headSeconds: .2, tailSeconds: .2 }, composition: { foreground: "", midground: "product", background: "soft office" }, blocking: [], fallbackShotId: "S01" }
      ],
      setupGroups: [{ setupId: "setup-01", shotIds: ["S01", "S02"], executionNote: "shared light" }],
      executionWaves: [{ waveId: "coverage-wave-01", sceneId: "SC-1", shotIds: ["S01", "S02"], setupIds: ["setup-01"], dependsOn: [] }],
      blockers: [{ code: "generated_video_handles_insufficient", shotIds: ["S02"], detail: "handles" }], warnings: []
    }
  });
  assert.ok(canvas.views.includes("coverage"));
  assert.equal(canvas.sceneCoverage.scenes[0].shots.length, 2);
  assert.equal(canvas.sceneCoverage.shots[1].status, "blocked");
  assert.equal(canvas.summary.sceneCoveragePlan.setupCount, 1);
  assert.ok(!canvas.workflow.nodes.some((node) => node.id.startsWith("coverage-shot:")));
});

test("projects generation cost and selection progress", () => {
  const canvas = projectCanvas({
    stage: "generation", status: "ready", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] },
    generation: { currency: "CNY", providerId: "imagegen", modelId: "host", totalEstimatedCost: 8, totalActualCost: 5, requests: [{ status: "selected" }, { status: "awaiting_review" }] }
  });
  const budget = canvas.nodes.find((node) => node.id === "generation:budget");
  assert.equal(budget.status, "active");
  assert.match(budget.detail, /1\/2 已选/);
  assert.equal(canvas.summary.generationCost.actual, 5);
});

test("labels delivery approval separately from Goal entry", () => {
  const canvas = projectCanvas({
    stage: "delivery", status: "production_in_progress", goal: { outcome: "film" },
    approvals: [{ id: "delivery", kind: "delivery", status: "pending" }], events: [], canvas: { nodes: [], edges: [] }
  });
  const approval = canvas.nodes.find((node) => node.id === "approval:delivery");
  assert.equal(approval.label, "最终交付确认");
  assert.equal(approval.status, "blocked");
});

test("does not invent completed stages when no pipeline is selected", () => {
  const canvas = projectCanvas({
    stage: "generation", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }
  });
  assert.equal(canvas.nodes.find((node) => node.id === "stage:research").status, "pending");
  assert.equal(canvas.nodes.find((node) => node.id === "stage:generation").status, "active");
});

test("keeps the final-video completion gate blocked until runtime evidence passes", () => {
  const canvas = projectCanvas({
    stage: "script", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] },
    completionPolicy: { objectiveScope: "playable_final_video" },
    completionCheck: { ready: false, blockers: ["pipeline_not_delivered"], nextAction: { instruction: "Continue storyboard", stage: "storyboard" } }
  });
  const gate = canvas.nodes.find((node) => node.id === "goal:completion-gate");
  assert.equal(gate.status, "blocked");
  assert.equal(gate.detail, "Continue storyboard");
});

test("projects layered collage production gates beside their stages", () => {
  const canvas = projectCanvas({ stage: "edit", status: "production_in_progress", goal: { outcome: "paper film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, pipeline: { id: "layered-collage", stages: [], stageStates: {} }, layeredCollageReviews: { static_layout: { status: "passed", checks: [{ id: "hierarchy" }] }, motion_audio: { status: "failed", checks: [{ id: "sync" }] } } });
  assert.equal(canvas.nodes.find((node) => node.id === "layered-review:static_layout").status, "complete");
  assert.equal(canvas.nodes.find((node) => node.id === "layered-review:motion_audio").status, "failed");
  assert.equal(canvas.nodes.find((node) => node.id === "layered-review:final_media").status, "blocked");
});

test("projects capability-filtered execution DAG nodes and progress", () => {
  const canvas = projectCanvas({ stage: "storyboard", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, executionGraph: { graphId: "g2", revision: 2, nodes: [
    { nodeId: "research", kind: "agent", stage: "research", label: "Research", owner: "DX-Reference-Analyst", capability: "web_research", dependsOn: [], inputArtifactRefs: [], outputArtifactRefs: ["reference_analysis.json"], status: "complete", evidenceRefs: ["reference_analysis.json"] },
    { nodeId: "shots", kind: "agent", stage: "storyboard", label: "Shots", owner: "DX-Shot-Planner", capability: "shot_planning", dependsOn: ["research"], inputArtifactRefs: ["reference_analysis.json"], outputArtifactRefs: ["shotlist.json"], status: "running", evidenceRefs: [] }
  ] } });
  assert.equal(canvas.nodes.find((node) => node.id === "execution:shots").status, "active");
  assert.ok(canvas.edges.some((edge) => edge.source === "execution:research" && edge.target === "execution:shots"));
  assert.deepEqual(canvas.summary.executionGraph, { graphId: "g2", revision: 2, nodeCount: 2, completedCount: 1 });
});

test("projects runtime tool availability and the recommended route", () => {
  const tool = { toolId: "codex-imagegen", toolClass: "image_generation", source: "codex_host", status: "available", qualityScore: 0.9, latencyMsP50: 8000 };
  const canvas = projectCanvas({ stage: "intake", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, toolInventory: { tools: [tool] }, capabilityExecutionPlan: { status: "ready", recommendedStrategy: "quality", candidates: [{ strategy: "quality", selections: [{ toolId: tool.toolId }] }] } });
  assert.equal(canvas.nodes.find((node) => node.id === "tool:codex-imagegen").status, "complete");
  assert.equal(canvas.summary.toolCount, 1);
  assert.equal(canvas.summary.recommendedToolStrategy, "quality");
  assert.ok(canvas.edges.some((edge) => edge.kind === "tool_route" && edge.target === "tool:codex-imagegen"));
});

test("projects evidence-backed execution telemetry and review-required route learning", () => {
  const execution = { executionId: "e1", capabilityId: "video.text_to_video", toolId: "video-a", status: "succeeded", actualCost: 2, latencyMs: 1200, qualityScore: 0.72 };
  const canvas = projectCanvas({ stage: "review", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, executionTelemetry: { executions: [execution] }, routeFeedback: { reportId: "f1", samples: [{}] }, modelKnowledgePatch: { status: "review_required", proposals: [{}] } });
  assert.equal(canvas.nodes.find((node) => node.id === "telemetry:e1").stage, "generation");
  assert.equal(canvas.nodes.find((node) => node.id === "route-feedback:f1").status, "blocked");
  assert.equal(canvas.summary.executionTelemetryCount, 1);
  assert.equal(canvas.summary.routeFeedbackStatus, "review_required");
});

test("projects benchmark regressions as review failures", () => {
  const report = { reportId: "b1", suiteId: "post-production", trialCount: 5, passRate: 0.6, meanScore: 0.72, status: "regressed" };
  const canvas = projectCanvas({ stage: "review", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, benchmarkReports: { b1: report } });
  assert.equal(canvas.nodes.find((node) => node.id === "benchmark:b1").status, "failed");
  assert.equal(canvas.summary.benchmarkReportCount, 1);
  assert.ok(canvas.edges.some((edge) => edge.kind === "benchmark" && edge.target === "benchmark:b1"));
});

test("projects instantiated benchmark suites and hard verifier receipts", () => {
  const suite = { suiteId: "seq", version: "1", taskFamily: "sequencing", fixtures: [{}], capabilityIds: ["video.trim_reorder"] };
  const receipt = { receiptId: "vr1", fixtureId: "seq-1", status: "failed", results: [{ passed: true }, { passed: false }] };
  const canvas = projectCanvas({ stage: "review", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, benchmarkSuites: { seq: suite }, benchmarkVerifierReceipts: { vr1: receipt } });
  assert.equal(canvas.nodes.find((node) => node.id === "benchmark-suite:seq").status, "complete");
  assert.equal(canvas.nodes.find((node) => node.id === "benchmark-verifier:vr1").status, "failed");
  assert.ok(canvas.edges.some((edge) => edge.kind === "benchmark_suite"));
  assert.ok(canvas.edges.some((edge) => edge.kind === "benchmark_verifier"));
});

test("projects observability exports and benchmark baseline governance", () => {
  const canvas = projectCanvas({ stage: "review", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, observabilityTrace: { spanCount: 8, contentPolicy: "identifiers_hashes_metrics_only" }, benchmarkBaselineDecisions: [{ action: "promote", baselineId: "base:1", suiteId: "s1", confirmedBy: "request_user_input" }] });
  assert.equal(canvas.nodes.find((node) => node.id === "observability:otlp").status, "complete");
  assert.ok(canvas.nodes.some((node) => node.id.startsWith("benchmark-baseline:base:1")));
  assert.ok(canvas.edges.some((edge) => edge.kind === "observability"));
  assert.ok(canvas.edges.some((edge) => edge.kind === "benchmark_baseline"));
});

test("projects every scheduled benchmark cell without cherry-picking", () => {
  const schedule = { scheduleId: "q1", jobs: [{ jobId: "q1:f1:1", fixtureId: "f1", seed: 42, repeatIndex: 0, estimatedCost: 2, status: "running" }, { jobId: "q1:f1:2", fixtureId: "f1", seed: 43, repeatIndex: 1, estimatedCost: 2, status: "failed" }] };
  const canvas = projectCanvas({ stage: "review", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, benchmarkSchedules: { q1: schedule } });
  assert.equal(canvas.nodes.find((node) => node.id === "benchmark-job:q1:f1:1").status, "active");
  assert.equal(canvas.nodes.find((node) => node.id === "benchmark-job:q1:f1:2").status, "failed");
  assert.equal(canvas.edges.filter((edge) => edge.kind === "benchmark_job").length, 2);
});

test("projects retrieval claims and selected moments into an evidence rail", () => {
  const index = { indexId: "idx", source: { assetId: "a1", duration: { value: 900, rate: 30 } }, timebase: { rate: { num: 30, den: 1 } }, analyzers: [{}], levels: [{ level: "shot", nodes: [{ nodeId: "s1", range: { start: { value: 120, rate: 30 }, duration: { value: 90, rate: 30 } }, modalities: ["vision"], evidenceRefs: ["frame://a1/5"] }] }] };
  const query = { plan: { queryId: "q1", indexId: "idx", question: "Find proof" }, trace: { stopReason: "user_decision_required", selectedNodeIds: ["s1"], conflicts: [] }, evidenceBundle: { claim: "Visible proof", coverage: .9 }, status: "input_required" };
  const canvas = projectCanvas({ stage: "research", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] }, mediaEvidenceIndexes: { idx: index }, videoEvidenceQueries: { q1: query } });
  assert.equal(canvas.evidenceRail.queries[0].hits[0].startSeconds, 4);
  assert.equal(canvas.evidenceRail.queries[0].hits[0].targetNodeId, "asset:a1");
  assert.equal(canvas.evidenceRail.queries[0].hits[0].coordinateSpace, "source");
  assert.equal(canvas.activity.pendingInteractions[0].interactionSurface, "codex_request_user_input");
  assert.equal(canvas.evidenceRail.queries[0].claim, "Visible proof");
  assert.ok(canvas.edges.some((edge) => edge.source === "evidence-index:idx" && edge.target === "evidence-query:q1"));
});

test("projects edit graphs and approval-aware timeline dry-runs", () => {
  const canvas = projectCanvas({
    stage: "edit", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] },
    editSession: {
      revisions: {
        "tl:1": { revisionId: "tl:1", timelineId: "tl", revision: 1, parentRevisionId: null, contentHash: "sha256:one", timeline: {} },
        "tl:2": { revisionId: "tl:2", timelineId: "tl", revision: 2, parentRevisionId: "tl:1", contentHash: "sha256:two", timeline: {} }
      },
      timelineHeads: { tl: "tl:2" },
      graph: { nodes: [{ nodeId: "trim-1", operation: "trim", status: "pending", dependsOn: [], inputArtifactRefs: ["source.mp4"], outputArtifactRefs: ["timeline:v2"] }] },
      patch: { patchId: "patch-1", baseRevision: 1, targetRevision: 2, summary: "缩短开场", status: "awaiting_approval", materialChanges: ["duration_change"], requiresUserApproval: true, operations: [{ operationId: "op-1", operation: "trim", path: "/tracks/video/0", affectedRanges: [{ start: { value: 0, rate: 30 }, duration: { value: 60, rate: 30 } }], evidenceRefs: ["review:opening"], reversible: true }] }
    }
  });
  assert.equal(canvas.editDiff.operations[0].durationSeconds, 2);
  assert.ok(canvas.nodes.some((node) => node.id === "edit:trim-1"));
  assert.ok(canvas.nodes.some((node) => node.id === "edit-patch:patch-1" && node.status === "blocked"));
  assert.equal(canvas.summary.timelineRevisionCount, 2);
  assert.ok(canvas.edges.some((edge) => edge.kind === "revision" && edge.source === "timeline-revision:tl:1" && edge.target === "timeline-revision:tl:2"));
  assert.ok(canvas.activity.pendingInteractions.some((item) => item.kind === "timeline_patch"));
});

test("projects every registered artifact internally while selecting only essential media for Storyboard", () => {
  const canvas = projectCanvas({ stage: "script", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [{ id: "document:director", type: "document", stage: "intake", label: "Director.md · 导演核心文档", status: "complete", artifactRef: "Director.md", metadata: { path: "Director.md" } }], edges: [] }, artifacts: {
    "Director.md": { path: "/project/Director.md", relativePath: "Director.md", stage: "intake", mediaKind: "document", sizeBytes: 1200, sha256: "abc" },
    "script.md": { path: "/project/script.md", relativePath: "script.md", stage: "script", mediaKind: "document" },
    "voice.wav": { path: "/project/voice.wav", relativePath: "voice.wav", stage: "script", mediaKind: "audio", metadata: { canvasEssential: true } },
    "shot-01.png": { path: "/project/shot-01.png", relativePath: "shot-01.png", stage: "storyboard", mediaKind: "image", metadata: { canvasEssential: true } },
    "delivery.video": { path: "/project/final.mp4", relativePath: "final.mp4", stage: "delivery", mediaKind: "video", metadata: { canvasEssential: true } }
  } });
  assert.equal(canvas.assets.length, 5);
  assert.equal(canvas.assets.filter((item) => item.artifactRef === "Director.md").length, 1);
  assert.equal(canvas.assets.find((item) => item.artifactRef === "Director.md").label, "Director.md · 导演核心文档");
  assert.equal(canvas.assets.find((item) => item.artifactRef === "voice.wav").previewUri, "voice.wav");
  assert.equal(canvas.assets.find((item) => item.artifactRef === "delivery.video").type, "video");
  assert.ok(canvas.edges.some((edge) => edge.source === "stage:script" && edge.target === "artifact:script.md"));
});

test("projects durable DX dispatch batches into Activity without adding storyboard assets", () => {
  const canvas = projectCanvas({
    stage: "research", status: "production_in_progress", goal: { outcome: "film" }, approvals: [], events: [], canvas: { nodes: [], edges: [] },
    subagentOrchestrationPlan: {
      tasks: [{ taskId: "refs", dispatchReceipt: { hostAgentId: "agent-ref" } }, { taskId: "assets" }],
      batches: [{ batchId: "research-batch-1", order: 1, status: "running", taskIds: ["refs", "assets"], startedAt: "2026-07-16T01:00:00.000Z" }]
    }
  });
  assert.deepEqual(canvas.activity.agentBatches, [{ batchId: "research-batch-1", order: 1, status: "running", taskIds: ["refs", "assets"], startedAt: "2026-07-16T01:00:00.000Z", completedAt: null, dispatchedCount: 1 }]);
  assert.equal(canvas.summary.agentBatchCount, 1);
  assert.equal(canvas.summary.activeAgentBatchCount, 1);
  assert.equal(canvas.assets.length, 0);
});
