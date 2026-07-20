const STAGES = ["intake", "research", "script", "storyboard", "generation", "edit", "review", "delivery"];

const STAGE_LABELS = {
  intake: "需求与确认",
  research: "品牌研究",
  script: "脚本",
  storyboard: "分镜",
  generation: "生成",
  edit: "剪辑",
  review: "审片",
  delivery: "交付"
};

const APPROVAL_LABELS = {
  goal_entry: "进入 Goal",
  budget: "预算确认",
  model: "模型确认（兼容）",
  image_model: "图片模型确认",
  video_model: "视频模型确认",
  voice_model: "语音模型确认",
  music_route: "背景音乐确认",
  provider: "供应商确认",
  post_production_edit: "成片剪辑确认",
  delivery: "最终交付确认"
};

const APPROVAL_INSTRUCTIONS = {
  goal_entry: "请回到 Codex 确认是否进入 Director X Goal",
  budget: "请回到 Codex 选择制作预算与币种",
  model: "请回到 Codex 选择生成模型",
  image_model: "请回到 Codex 选择图片供应商与精确模型，或明确本项目不使用图片生成",
  video_model: "请回到 Codex 选择视频供应商与精确模型，或明确本项目不使用视频生成",
  voice_model: "请回到 Codex 选择语音供应商、精确模型与声音，或明确本项目不使用语音生成",
  music_route: "请回到 Codex 选择本地配乐、正版曲库、音乐模型或明确不单独配乐",
  provider: "请回到 Codex 选择供应商",
  post_production_edit: "请回到 Codex 决定进入 Director X Cut 或直接交付",
  delivery: "请回到 Codex 审看成片并确认交付"
};

export function projectCanvas(snapshot) {
  const currentIndex = Math.max(0, STAGES.indexOf(snapshot.stage));
  const stageNodes = STAGES.map((stage, index) => {
    const latest = [...(snapshot.events ?? [])].reverse().find((item) => item.stage === stage);
    const pipelineState = snapshot.pipeline?.stageStates?.[stage];
    return {
      id: `stage:${stage}`,
      type: "stage",
      stage,
      label: STAGE_LABELS[stage],
      detail: pipelineState?.detail ?? latest?.detail ?? "等待上游产物",
      status: pipelineState?.status ?? (index === currentIndex ? "active" : "pending"),
      x: 120 + index * 270,
      y: index % 2 === 0 ? 180 : 410,
      metadata: { eventSequence: latest?.sequence, evidenceRefs: pipelineState?.evidenceRefs ?? [], ownerSkill: snapshot.pipeline?.stages?.find((item) => item.id === stage)?.ownerSkill }
    };
  });
  const stageEdges = STAGES.slice(1).map((stage, index) => ({
    id: `stage-edge:${STAGES[index]}:${stage}`,
    source: `stage:${STAGES[index]}`,
    target: `stage:${stage}`,
    kind: "workflow"
  }));
  const canvas = snapshot.canvas ?? { nodes: [], edges: [] };
  const objectNodes = (canvas.nodes ?? []).map((node, index) => ({
    ...node,
    x: Number.isFinite(node.x) ? node.x : 180 + (index % 5) * 300,
    y: Number.isFinite(node.y) ? node.y : 690 + Math.floor(index / 5) * 260
  }));
  const objectEdges = (canvas.edges ?? []).map((edge) => ({ ...edge, kind: edge.kind ?? "dependency" }));
  const representedArtifactRefs = new Set(objectNodes.map((node) => node.artifactRef).filter(Boolean));
  const artifactNodes = Object.entries(snapshot.artifacts ?? {}).filter(([artifactRef]) => !representedArtifactRefs.has(artifactRef)).map(([artifactRef, artifact], index) => ({
    id: `artifact:${artifactRef}`, type: artifact.mediaKind === "archive" ? "artifact" : artifact.mediaKind ?? "document", stage: artifact.stage ?? "intake",
    label: artifactLabel(artifactRef), detail: artifact.relativePath ?? artifact.path ?? artifactRef, status: "complete",
    x: 180 + (index % 5) * 300, y: 1760 + Math.floor(index / 5) * 230, artifactRef,
    previewUri: ["image", "video", "audio"].includes(artifact.mediaKind) ? artifact.relativePath ?? artifact.path : undefined,
    metadata: { path: artifact.relativePath ?? artifact.path, absolutePath: artifact.path, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256, registeredAt: artifact.registeredAt, ...artifact.metadata }
  }));
  const artifactEdges = artifactNodes.map((node) => ({ id: `artifact-stage:${node.id}`, source: `stage:${node.stage}`, target: node.id, kind: "evidence" }));
  const artifactNodeIds = new Map([...objectNodes, ...artifactNodes].filter((node) => node.artifactRef).map((node) => [node.artifactRef, node.id]));
  const artifactLineageEdges = [...objectNodes, ...artifactNodes].flatMap((node) => {
    const sourceRefs = [...new Set([...(node.metadata?.sourceArtifactRefs ?? []), ...(node.metadata?.inputArtifactRefs ?? []), ...(node.metadata?.derivedFromArtifactRefs ?? [])])];
    return sourceRefs.map((sourceRef) => ({ id: `artifact-lineage:${sourceRef}:${node.artifactRef ?? node.id}`, source: artifactNodeIds.get(sourceRef), target: node.id, kind: "derived_from", sourceArtifactRef: sourceRef, targetArtifactRef: node.artifactRef ?? null })).filter((edge) => edge.source && edge.source !== edge.target);
  });
  const goalNode = {
    id: "goal:outcome",
    type: "brief",
    stage: "intake",
    label: "制作目标",
    detail: snapshot.goal?.outcome ?? "Director X production",
    status: snapshot.status === "awaiting_goal_confirmation" ? "blocked" : "complete",
    x: 120,
    y: 40,
    metadata: { displayMode: snapshot.goal?.displayMode ?? "Director X Goal" }
  };
  const approvals = (snapshot.approvals ?? []).map((approval, index) => ({
    id: `approval:${approval.kind}`,
    type: "approval",
    stage: "intake",
    label: APPROVAL_LABELS[approval.kind] ?? `确认 · ${approval.kind}`,
    detail: approval.status === "approved" ? "已确认" : "等待用户确认",
    status: approval.status === "approved" ? "complete" : "blocked",
    x: 420 + index * 220,
    y: 40,
    metadata: { approvalId: approval.id, kind: approval.kind }
  }));
  const approvalEdges = approvals.map((approval) => ({ id: `goal-edge:${approval.id}`, source: goalNode.id, target: approval.id, kind: "approval" }));
  const runModeNode = snapshot.runMode ? {
    id: "run:mode", type: "decision", stage: "intake", label: "运行模式",
    detail: ({ guided_autonomy: "引导自治", stage_approval: "逐阶段确认", full_automation: "约束内全自动" })[snapshot.runMode.mode] ?? snapshot.runMode.mode,
    status: "complete", x: 120, y: 700,
    metadata: { ...snapshot.runMode, interactionSurface: "codex_request_user_input" }
  } : null;
  const checkpointNodes = (snapshot.checkpoints ?? []).slice(-8).map((checkpoint, index) => ({
    id: `checkpoint:${checkpoint.checkpointId}`, type: "artifact", stage: checkpoint.stage, label: `检查点 #${checkpoint.sequence}`,
    detail: `${checkpoint.reason} · event ${checkpoint.eventCursor}`, status: "complete", x: 380 + index * 225, y: 700,
    artifactRef: "checkpoint_replay.json", metadata: { checkpointId: checkpoint.checkpointId, supersedes: checkpoint.supersedes, artifactRefs: checkpoint.artifactRefs, generationCost: checkpoint.generationCost }
  }));
  const checkpointEdges = checkpointNodes.map((checkpoint, index) => ({ id: `checkpoint-edge:${checkpoint.id}`, source: index ? checkpointNodes[index - 1].id : "run:mode", target: checkpoint.id, kind: "dependency" }));
  const providerNodes = Object.values(snapshot.providerCapabilities ?? {}).map((provider, index) => ({
    id: `provider:${provider.providerId}:${provider.modelId}`, type: "artifact", stage: "generation", label: `${provider.providerId} / ${provider.modelId}`,
    detail: `${provider.status} · ${provider.capabilities.join(", ")}`, status: provider.status === "available" ? "complete" : provider.status === "degraded" ? "blocked" : "failed",
    x: 120 + index * 280, y: 850, artifactRef: "provider_capability_snapshot.json", metadata: provider
  }));
  const providerEdges = providerNodes.map((provider) => ({ id: `provider-edge:${provider.id}`, source: "stage:generation", target: provider.id, kind: "dependency" }));
  const subagents = (snapshot.subagents ?? []).map((agent, index) => ({
    id: `agent:${agent.displayName}`, type: "agent", stage: agent.stage, label: agent.displayName,
    detail: agent.detail ?? agent.mission ?? "等待任务", status: agent.status === "running" ? "active" : agent.status === "complete" ? "complete" : agent.status === "failed" ? "blocked" : agent.status,
    x: 180 + index * 250, y: 930 + (index % 2) * 150,
    metadata: { roleId: agent.roleId, hostAgentId: agent.hostAgentId, hostIdentityStatus: agent.hostNicknameMode ?? "legacy", mission: agent.mission, inputArtifactRefs: agent.inputArtifactRefs ?? [], outputArtifactRefs: agent.outputArtifactRefs ?? [] }
  }));
  const subagentEdges = subagents.map((agent) => ({ id: `agent-stage:${agent.id}`, source: `stage:${agent.stage}`, target: agent.id, kind: "agent" }));
  const executionNodes = (snapshot.executionGraph?.nodes ?? []).map((node, index) => ({
    id: `execution:${node.nodeId}`, type: node.kind === "agent" ? "agent" : node.kind === "approval" ? "approval" : node.kind === "review" ? "decision" : "artifact",
    stage: node.stage, label: node.label, detail: `${node.capability} · ${node.owner}`, status: node.status === "running" ? "active" : node.status === "complete" ? "complete" : node.status === "failed" ? "failed" : node.status === "blocked" ? "blocked" : "pending",
    x: 180 + index * 245, y: 1080 + (index % 3) * 130, artifactRef: node.outputArtifactRefs?.[0], metadata: { graphId: snapshot.executionGraph.graphId, revision: snapshot.executionGraph.revision, nodeId: node.nodeId, owner: node.owner, capability: node.capability, inputArtifactRefs: node.inputArtifactRefs, outputArtifactRefs: node.outputArtifactRefs, evidenceRefs: node.evidenceRefs }
  }));
  const executionEdges = (snapshot.executionGraph?.nodes ?? []).flatMap((node) => node.dependsOn.map((dependency) => ({ id: `execution-edge:${dependency}:${node.nodeId}`, source: `execution:${dependency}`, target: `execution:${node.nodeId}`, kind: "dependency" })));
  const capabilityNodes = (snapshot.capabilityRoute?.capabilities ?? []).map((item, index) => ({
    id: `capability:${item.id}`, type: "decision", stage: capabilityStage(item.department), label: item.id,
    detail: `${item.owner} · ${item.toolClass}${item.missingInputs.length ? ` · 缺少 ${item.missingInputs.length} 项输入` : ""}`,
    status: item.missingInputs.length ? "blocked" : "complete", x: 180 + index * 245, y: 1350 + (index % 3) * 130,
    artifactRef: "capability_route.json", metadata: item
  }));
  const capabilityEdges = capabilityNodes.map((node) => ({ id: `capability-stage:${node.id}`, source: `stage:${node.stage}`, target: node.id, kind: "capability" }));
  const toolNodes = (snapshot.toolInventory?.tools ?? []).map((tool, index) => ({
    id: `tool:${tool.toolId}`, type: "artifact", stage: "intake", label: tool.toolId,
    detail: `${tool.toolClass} · ${tool.source} · Q${tool.qualityScore.toFixed(2)} · ${tool.latencyMsP50}ms`,
    status: tool.status === "available" ? "complete" : tool.status === "degraded" ? "blocked" : "failed", x: 180 + index * 245, y: 1740,
    artifactRef: "tool_inventory.json", metadata: tool
  }));
  const selectedToolIds = new Set((snapshot.capabilityExecutionPlan?.candidates ?? []).find((candidate) => candidate.strategy === snapshot.capabilityExecutionPlan?.recommendedStrategy)?.selections?.map((selection) => selection.toolId) ?? []);
  const toolEdges = toolNodes.filter((node) => selectedToolIds.has(node.metadata.toolId)).map((node) => ({ id: `tool-route:${node.id}`, source: "stage:intake", target: node.id, kind: "tool_route" }));
  const telemetryNodes = (snapshot.executionTelemetry?.executions ?? []).slice(-30).map((execution, index) => ({
    id: `telemetry:${execution.executionId}`, type: "artifact", stage: telemetryStage(execution.capabilityId), label: `${execution.toolId} · ${execution.status}`,
    detail: `${execution.capabilityId} · ${execution.latencyMs}ms · cost ${execution.actualCost}${Number.isFinite(execution.qualityScore) ? ` · Q${execution.qualityScore.toFixed(2)}` : ""}`,
    status: execution.status === "succeeded" ? "complete" : execution.status === "input_required" ? "blocked" : "failed", x: 180 + index * 245, y: 1890,
    artifactRef: "execution_telemetry.json", metadata: execution
  }));
  const telemetryEdges = telemetryNodes.map((node) => ({ id: `telemetry-stage:${node.id}`, source: `stage:${node.stage}`, target: node.id, kind: "telemetry" }));
  const lineageNodes = Object.values(snapshot.productionLineage ?? {}).slice(-30).map((binding, index) => ({
    id: `lineage:${binding.bindingId}`, type: "artifact", stage: telemetryStage(binding.activity.capabilityId), label: `${binding.activity.providerId}/${binding.activity.modelId}@${binding.activity.modelVersion}`,
    detail: `${binding.activity.dxAgent} · ${binding.activity.promptContractId} · Director ${binding.activity.directorContractFingerprint.slice(0, 18)}…`, status: "complete", x: 180 + index * 245, y: 1960,
    artifactRef: "production_lineage.json", metadata: binding
  }));
  const lineageEdges = lineageNodes.map((node) => ({ id: `lineage-stage:${node.id}`, source: `stage:${node.stage}`, target: node.id, kind: "lineage" }));
  const feedbackNode = snapshot.routeFeedback ? { id: `route-feedback:${snapshot.routeFeedback.reportId}`, type: "decision", stage: "review", label: "路由反馈与知识建议", detail: `${snapshot.routeFeedback.samples.length} samples · ${snapshot.modelKnowledgePatch?.status ?? "unknown"}`, status: snapshot.modelKnowledgePatch?.status === "review_required" ? "blocked" : "complete", x: 180, y: 2040, artifactRef: "route_regret_report.json", metadata: { routeFeedback: snapshot.routeFeedback, modelKnowledgePatch: snapshot.modelKnowledgePatch } } : null;
  const knowledgeNode = snapshot.acceptedModelKnowledge ? { id: `accepted-knowledge:${snapshot.acceptedModelKnowledge.sourceReportId}`, type: "decision", stage: "review", label: "已批准模型知识", detail: `${snapshot.acceptedModelKnowledge.entries.length} active entries · scoped and expiring`, status: "complete", x: 450, y: 2040, artifactRef: "accepted_model_knowledge.json", metadata: snapshot.acceptedModelKnowledge } : null;
  const benchmarkSuiteNodes = Object.values(snapshot.benchmarkSuites ?? {}).map((suite, index) => ({ id: `benchmark-suite:${suite.suiteId}`, type: "artifact", stage: "review", label: `Benchmark Suite · ${suite.taskFamily}`, detail: `${suite.suiteId}@${suite.version} · ${suite.fixtures.length} fixtures · ${suite.capabilityIds.length} capabilities`, status: "complete", x: 450 + index * 260, y: 2100, artifactRef: "benchmark_suite.json", metadata: suite }));
  const benchmarkVerifierNodes = Object.values(snapshot.benchmarkVerifierReceipts ?? {}).map((receipt, index) => ({ id: `benchmark-verifier:${receipt.receiptId}`, type: "artifact", stage: "review", label: `Verifier · ${receipt.fixtureId}`, detail: `${receipt.results.filter((item) => item.passed).length}/${receipt.results.length} hard checks · ${receipt.status}`, status: receipt.status === "passed" ? "complete" : "failed", x: 450 + index * 260, y: 2160, artifactRef: "benchmark_verifier_receipt.json", metadata: receipt }));
  const benchmarkNodes = Object.values(snapshot.benchmarkReports ?? {}).map((report, index) => ({ id: `benchmark:${report.reportId}`, type: "decision", stage: "review", label: `Benchmark · ${report.suiteId}`, detail: `${report.trialCount} trials · pass ${report.passRate} [${report.passRateInterval95?.lower ?? "?"}, ${report.passRateInterval95?.upper ?? "?"}] · Q${report.meanScore} · ${report.status}`, status: report.status === "passed" ? "complete" : report.status === "regressed" ? "failed" : "blocked", x: 720 + index * 270, y: 2040, artifactRef: "benchmark_report.json", metadata: report }));
  const benchmarkScheduleNodes = Object.values(snapshot.benchmarkSchedules ?? {}).flatMap((schedule, scheduleIndex) => schedule.jobs.map((job, index) => ({ id: `benchmark-job:${job.jobId}`, type: "artifact", stage: "review", label: `${job.fixtureId} · seed ${job.seed}`, detail: `${job.status} · repeat ${job.repeatIndex + 1} · est. ${job.estimatedCost}`, status: job.status === "succeeded" ? "complete" : job.status === "failed" ? "failed" : job.status === "running" ? "active" : job.status === "cancelled" ? "blocked" : "pending", x: 720 + index * 220, y: 2140 + scheduleIndex * 120, artifactRef: "benchmark_schedule.json", metadata: { scheduleId: schedule.scheduleId, ...job } })));
  const traceNode = snapshot.observabilityTrace ? { id: "observability:otlp", type: "artifact", stage: "review", label: "Agent 可观测轨迹", detail: `${snapshot.observabilityTrace.spanCount} spans · ${snapshot.observabilityTrace.contentPolicy}`, status: "complete", x: 990, y: 2180, artifactRef: "agent_trace_otlp.json", metadata: snapshot.observabilityTrace } : null;
  const baselineNodes = (snapshot.benchmarkBaselineDecisions ?? []).slice(-10).map((decision, index) => ({ id: `benchmark-baseline:${decision.baselineId}:${index}`, type: "decision", stage: "review", label: `Benchmark 基线 · ${decision.suiteId}`, detail: `${decision.action} · ${decision.baselineId}`, status: decision.action === "promote" ? "complete" : "blocked", x: 1260 + index * 250, y: 2180, artifactRef: "benchmark_baseline_decisions.json", metadata: decision }));
  const feedbackEdges = feedbackNode ? [{ id: `feedback-stage:${feedbackNode.id}`, source: "stage:review", target: feedbackNode.id, kind: "feedback" }] : [];
  const evidenceSeconds = (time) => Number(time?.value ?? 0) / Number(time?.rate ?? 1);
  const evidenceIndexNodes = Object.values(snapshot.mediaEvidenceIndexes ?? {}).map((index, offset) => ({ id: `evidence-index:${index.indexId}`, type: "artifact", stage: "research", label: `证据索引 · ${index.source.assetId}`, detail: `${evidenceSeconds(index.source.duration).toFixed(2)}s · ${index.levels.flatMap((level) => level.nodes).length} moments · ${index.analyzers.length} analyzers`, status: "complete", x: 180 + offset * 270, y: 1480, artifactRef: "media_evidence_index.json", metadata: { indexId: index.indexId, source: index.source, timebase: index.timebase, analyzers: index.analyzers } }));
  const evidenceQueryNodes = Object.values(snapshot.videoEvidenceQueries ?? {}).map((query, offset) => ({ id: `evidence-query:${query.plan.queryId}`, type: "decision", stage: "research", label: query.plan.question, detail: `${query.status} · ${query.trace?.stopReason ?? "waiting"}`, status: query.status === "complete" ? "complete" : query.status === "input_required" ? "blocked" : query.status === "stopped" ? "failed" : "active", x: 500 + offset * 285, y: 1480, artifactRef: query.evidenceBundle ? "evidence_bundle.json" : query.trace ? "retrieval_trace.json" : "video_query_plan.json", metadata: { plan: query.plan, trace: query.trace, evidenceBundle: query.evidenceBundle } }));
  const evidenceEdges = [...evidenceIndexNodes.map((node) => ({ id: `evidence-stage:${node.id}`, source: "stage:research", target: node.id, kind: "dependency" })), ...Object.values(snapshot.videoEvidenceQueries ?? {}).map((query) => ({ id: `evidence-query-edge:${query.plan.queryId}`, source: `evidence-index:${query.plan.indexId}`, target: `evidence-query:${query.plan.queryId}`, kind: "dependency" }))];
  const evidenceRail = { queries: Object.values(snapshot.videoEvidenceQueries ?? {}).map((query) => {
    const index = snapshot.mediaEvidenceIndexes?.[query.plan.indexId]; const byId = new Map(index?.levels.flatMap((level) => level.nodes.map((node) => [node.nodeId, node])) ?? []);
    return { queryId: query.plan.queryId, question: query.plan.question, status: query.status, stopReason: query.trace?.stopReason ?? null, coverage: query.evidenceBundle?.coverage ?? null, claim: query.evidenceBundle?.claim ?? null, conflicts: query.trace?.conflicts ?? [], hits: (query.trace?.selectedNodeIds ?? []).map((id) => ({ ...byId.get(id), nodeId: id })).filter((item) => item.range).map((item) => ({ ...item, targetNodeId: `asset:${index.source.assetId}`, targetArtifactRef: index.source.artifactRef ?? null, coordinateSpace: "source", startSeconds: evidenceSeconds(item.range.start), durationSeconds: evidenceSeconds(item.range.duration) })) };
  }) };
  const editGraphNodes = (snapshot.editSession?.graph?.nodes ?? []).map((node, index) => ({ id: `edit:${node.nodeId}`, type: "artifact", stage: "edit", label: `${node.operation} · ${node.nodeId}`, detail: `${node.status} · ${node.inputArtifactRefs.join(", ")} → ${node.outputArtifactRefs.join(", ")}`, status: node.status === "complete" ? "complete" : node.status === "failed" ? "failed" : node.status === "running" ? "active" : "pending", x: 180 + index * 260, y: 2020 + (index % 2) * 130, artifactRef: "edit_graph.json", metadata: node }));
  const editGraphEdges = (snapshot.editSession?.graph?.nodes ?? []).flatMap((node) => node.dependsOn.map((dependency) => ({ id: `edit-edge:${dependency}:${node.nodeId}`, source: `edit:${dependency}`, target: `edit:${node.nodeId}`, kind: "edit" })));
  const timelineRevisions = Object.values(snapshot.editSession?.revisions ?? {}).sort((a, b) => a.revision - b.revision);
  const timelineRevisionNodes = timelineRevisions.map((revision, index) => ({ id: `timeline-revision:${revision.revisionId}`, type: "artifact", stage: "edit", label: `${revision.timelineId} · v${revision.revision}`, detail: `${revision.contentHash.slice(0, 20)}…${snapshot.editSession?.timelineHeads?.[revision.timelineId] === revision.revisionId ? " · HEAD" : ""}`, status: snapshot.editSession?.timelineHeads?.[revision.timelineId] === revision.revisionId ? "active" : "complete", x: 900 + index * 230, y: 2280, artifactRef: "timeline_revision.json", metadata: revision }));
  const timelineRevisionEdges = timelineRevisions.filter((revision) => revision.parentRevisionId).map((revision) => ({ id: `timeline-revision-edge:${revision.parentRevisionId}:${revision.revisionId}`, source: `timeline-revision:${revision.parentRevisionId}`, target: `timeline-revision:${revision.revisionId}`, kind: "revision" }));
  const patch = snapshot.editSession?.patch;
  const editPatchNode = patch ? { id: `edit-patch:${patch.patchId}`, type: "decision", stage: "edit", label: `时间线补丁 · v${patch.baseRevision} → v${patch.targetRevision}`, detail: `${patch.status} · ${(patch.operations ?? []).length} operations · ${(patch.materialChanges ?? []).length} material changes`, status: patch.status === "committed" ? "complete" : patch.status === "awaiting_approval" ? "blocked" : "active", x: 500, y: 2280, artifactRef: "timeline_patch.json", metadata: patch } : null;
  const editPatchEdges = editPatchNode ? (snapshot.editSession.graph?.nodes ?? []).map((node) => ({ id: `edit-patch-edge:${node.nodeId}`, source: `edit:${node.nodeId}`, target: editPatchNode.id, kind: "edit_patch" })) : [];
  const editDiff = patch ? { patchId: patch.patchId, summary: patch.summary, status: patch.status, baseTimelineRef: patch.baseTimelineRef, baseRevision: patch.baseRevision, targetRevision: patch.targetRevision, materialChanges: patch.materialChanges ?? [], requiresUserApproval: patch.requiresUserApproval, operations: (patch.operations ?? []).map((operation) => ({ ...operation, startSeconds: evidenceSeconds(operation.affectedRanges[0].start), durationSeconds: evidenceSeconds(operation.affectedRanges[0].duration) })) } : null;
  const continuityPlan = snapshot.segmentContinuityPlan ?? (snapshot.longformPlan ? { sequenceId: snapshot.longformPlan.longformId, segments: snapshot.longformPlan.segments.map((segment) => ({ ...segment, requestId: segment.generationRequestId, startFrameAssetRef: segment.inputStartFrameAssetId, endFrameAssetRef: segment.outputEndFrameAssetId })) } : null);
  const longformSegments = (continuityPlan?.segments ?? []).map((segment, index) => ({
    id: `segment:${segment.segmentId}`, type: "shot", stage: "storyboard", label: `片段 ${index + 1} · ${segment.segmentId}`,
    detail: `${segment.durationSeconds}s · ${segment.storyBeat ?? "首尾帧连续性片段"}`, status: "complete", x: 180 + index * 270, y: 1240,
    artifactRef: snapshot.segmentContinuityPlan ? "segment_continuity_plan.json" : "longform_segment_plan.json", metadata: { generationRequestId: segment.requestId ?? segment.generationRequestId, inputStartFrameAssetId: segment.startFrameAssetRef ?? segment.inputStartFrameAssetId, outputEndFrameAssetId: segment.endFrameAssetRef ?? segment.outputEndFrameAssetId, handoff: segment.handoff }
  }));
  const longformEdges = longformSegments.slice(1).map((segment, index) => ({
    id: `frame-handoff:${longformSegments[index].id}:${segment.id}`, source: longformSegments[index].id, target: segment.id, kind: "frame_handoff",
    label: continuityPlan.segments[index].endFrameAssetRef ?? continuityPlan.segments[index].outputEndFrameAssetId
  }));
  const cameraGraph = snapshot.cameraContinuityGraph;
  const cameraRows = new Map((cameraGraph?.cameras ?? []).map((camera) => [camera.cameraId, camera.row]));
  const taskWave = new Map((cameraGraph?.executionWaves ?? []).flatMap((wave) => wave.taskNodeIds.map((nodeId) => [nodeId, wave.wave])));
  const referenceTargets = new Map((snapshot.cameraReferenceSelectionPlan?.targets ?? []).map((target) => [target.targetId, target]));
  const cameraContinuityNodes = (cameraGraph?.shots ?? []).map((shot) => {
    const references = shot.referenceTargetIds.map((targetId) => referenceTargets.get(targetId)).filter(Boolean);
    const referenceCount = references.reduce((count, target) => count + (target.selectedAssetRefs?.length || target.recommendedAssetRefs?.length || 0), 0);
    return {
      id: `camera-shot:${shot.shotId}`,
      type: "shot",
      stage: "storyboard",
      label: `${shot.shotId} · ${shot.cameraId}`,
      detail: `${shot.durationSeconds}s · ${shot.handoffStrategy ?? "origin"} · ${referenceCount} refs`,
      status: cameraGraph.status === "ready" ? "complete" : "blocked",
      x: 120 + shot.order * 290,
      y: 100 + (cameraRows.get(shot.cameraId) ?? 0) * 210,
      artifactRef: "camera_dependency_graph.json",
      metadata: {
        ...shot,
        firstWave: taskWave.get(shot.taskNodeIds.firstFrame),
        lastWave: shot.taskNodeIds.lastFrame ? taskWave.get(shot.taskNodeIds.lastFrame) : null,
        clipWave: taskWave.get(shot.taskNodeIds.clip),
        references
      }
    };
  });
  const cameraContinuityEdges = (cameraGraph?.shots ?? []).filter((shot) => shot.parentShotId).map((shot) => ({
    id: `camera-handoff:${shot.parentShotId}:${shot.shotId}`,
    source: `camera-shot:${shot.parentShotId}`,
    target: `camera-shot:${shot.shotId}`,
    kind: shot.handoffStrategy ?? "frame_handoff",
    label: `${shot.parentFrameRole} → first`
  }));
  const cameraContinuity = cameraGraph ? {
    graphId: cameraGraph.graphId,
    status: cameraGraph.status,
    cameras: cameraGraph.cameras,
    executionWaves: cameraGraph.executionWaves,
    nodes: cameraContinuityNodes,
    edges: cameraContinuityEdges
  } : { graphId: null, status: "not_planned", cameras: [], executionWaves: [], nodes: [], edges: [] };
  const collageLayers = (snapshot.layeredCollagePlan?.scenes ?? []).flatMap((scene, sceneIndex) => scene.layers.map((layer, layerIndex) => ({
    id: `layer:${scene.sceneId}:${layer.layerId}`, type: "artifact", stage: "storyboard", label: layer.layerId,
    detail: `${scene.sceneId} · ${layer.layerType} · ${layer.role} · z${layer.zIndex}`, status: "complete",
    x: 180 + layerIndex * 230, y: 1240 + sceneIndex * 180, artifactRef: "layer_manifest.json",
    metadata: { sceneId: scene.sceneId, layerType: layer.layerType, role: layer.role, zIndex: layer.zIndex, assetPath: layer.assetPath, entranceDelayFrames: layer.entranceDelayFrames }
  })));
  const collageEdges = collageLayers.map((layer) => ({ id: `layer-stage:${layer.id}`, source: "stage:storyboard", target: layer.id, kind: "dependency" }));
  const collageReviewLabels = { static_layout: "静态排版门", motion_audio: "动效与音频门", final_media: "成片抽帧门" };
  const collageReviewStages = { static_layout: "storyboard", motion_audio: "edit", final_media: "review" };
  const collageReviews = snapshot.pipeline?.id === "layered-collage" ? Object.keys(collageReviewLabels).map((phase, index) => {
    const review = snapshot.layeredCollageReviews?.[phase];
    return { id: `layered-review:${phase}`, type: "approval", stage: collageReviewStages[phase], label: collageReviewLabels[phase], detail: review ? `${review.status} · ${review.checks.length} checks` : "等待证据审查", status: review?.status === "passed" ? "complete" : review?.status === "failed" ? "failed" : "blocked", x: 1150 + index * 250, y: 1180, artifactRef: `layered_review_${phase}.json`, metadata: review ?? { phase } };
  }) : [];
  const collageReviewEdges = collageReviews.map((review) => ({ id: `layered-review-edge:${review.id}`, source: `stage:${review.stage}`, target: review.id, kind: "approval" }));
  const generation = snapshot.generation;
  const budgetNode = generation ? {
    id: "generation:budget",
    type: "decision",
    stage: "generation",
    label: "生成预算与消耗",
    detail: `${generation.currency} ${generation.totalActualCost} 已用 · ${generation.requests.filter((item) => item.status === "selected").length}/${generation.requests.length} 已选`,
    status: generation.requests.some((item) => ["request_approval", "stopped"].includes(item.status)) ? "blocked" : generation.requests.every((item) => item.status === "selected") ? "complete" : "active",
    x: 1470,
    y: 40,
    metadata: { providerId: generation.providerId, modelId: generation.modelId, totalEstimatedCost: generation.totalEstimatedCost, totalActualCost: generation.totalActualCost, currency: generation.currency }
  } : null;
  const budgetEdges = budgetNode ? [{ id: "generation-budget-edge", source: "stage:generation", target: budgetNode.id, kind: "budget" }] : [];
  const completionNode = snapshot.completionPolicy ? {
    id: "goal:completion-gate",
    type: "approval",
    stage: "delivery",
    label: "最终视频完成门",
    detail: snapshot.completionCheck?.ready ? `可完成 Goal · ${snapshot.completionCheck.finalVideoArtifactRef}` : snapshot.completionCheck?.nextAction?.instruction ?? "需要成片、终审、交付清单与用户确认",
    status: snapshot.completionCheck?.ready ? "complete" : "blocked",
    x: 2280,
    y: 40,
    metadata: { objectiveScope: snapshot.completionPolicy.objectiveScope, blockers: snapshot.completionCheck?.blockers ?? ["completion_not_checked"] }
  } : null;
  const completionEdges = completionNode ? [{ id: "completion-gate-edge", source: "stage:delivery", target: completionNode.id, kind: "approval" }] : [];
  const nodes = [goalNode, ...approvals, ...stageNodes, ...(budgetNode ? [budgetNode] : []), ...(completionNode ? [completionNode] : []), ...(runModeNode ? [runModeNode] : []), ...checkpointNodes, ...providerNodes, ...subagents, ...capabilityNodes, ...toolNodes, ...telemetryNodes, ...lineageNodes, ...(feedbackNode ? [feedbackNode] : []), ...(knowledgeNode ? [knowledgeNode] : []), ...benchmarkSuiteNodes, ...benchmarkVerifierNodes, ...benchmarkNodes, ...benchmarkScheduleNodes, ...(traceNode ? [traceNode] : []), ...baselineNodes, ...executionNodes, ...evidenceIndexNodes, ...evidenceQueryNodes, ...editGraphNodes, ...(editPatchNode ? [editPatchNode] : []), ...timelineRevisionNodes, ...longformSegments, ...collageLayers, ...collageReviews, ...objectNodes, ...artifactNodes];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [...approvalEdges, ...stageEdges, ...budgetEdges, ...completionEdges, ...checkpointEdges, ...providerEdges, ...subagentEdges, ...capabilityEdges, ...toolEdges, ...telemetryEdges, ...lineageEdges, ...feedbackEdges, ...(knowledgeNode ? [{ id: `knowledge-stage:${knowledgeNode.id}`, source: "stage:review", target: knowledgeNode.id, kind: "knowledge" }] : []), ...benchmarkSuiteNodes.map((node) => ({ id: `benchmark-suite-stage:${node.id}`, source: "stage:review", target: node.id, kind: "benchmark_suite" })), ...benchmarkVerifierNodes.map((node) => ({ id: `benchmark-verifier-stage:${node.id}`, source: "stage:review", target: node.id, kind: "benchmark_verifier" })), ...benchmarkNodes.map((node) => ({ id: `benchmark-stage:${node.id}`, source: "stage:review", target: node.id, kind: "benchmark" })), ...benchmarkScheduleNodes.map((node) => ({ id: `benchmark-job-stage:${node.id}`, source: "stage:review", target: node.id, kind: "benchmark_job" })), ...(traceNode ? [{ id: "observability-stage", source: "stage:review", target: traceNode.id, kind: "observability" }] : []), ...baselineNodes.map((node) => ({ id: `baseline-stage:${node.id}`, source: "stage:review", target: node.id, kind: "benchmark_baseline" })), ...executionEdges, ...evidenceEdges, ...editGraphEdges, ...editPatchEdges, ...timelineRevisionEdges, ...longformEdges, ...collageEdges, ...collageReviewEdges, ...objectEdges, ...artifactEdges, ...artifactLineageEdges].filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const assets = [...objectNodes, ...artifactNodes].filter(isStoryboardAsset);
  const assetIds = new Set(assets.map((node) => node.id));
  const assetRelations = edges.filter((edge) => assetIds.has(edge.source) && assetIds.has(edge.target)).map((edge) => ({ ...edge, sourceLabel: nodes.find((node) => node.id === edge.source)?.label, targetLabel: nodes.find((node) => node.id === edge.target)?.label }));
  const mediaGraph = buildMediaGraph(assets, assetRelations);
  const workflow = buildWorkflowProjection({ goalNode, approvals, stageNodes, runModeNode, budgetNode, completionNode, subagents, executionNodes });
  const sceneCoverage = buildSceneCoverageProjection(snapshot.sceneCoveragePlan);
  const currentStageDefinition = snapshot.pipeline?.stages?.find((stage) => stage.id === snapshot.stage);
  const registered = snapshot.artifacts ?? {};
  const missingEvidence = (currentStageDefinition?.requiredOutputs ?? []).filter((artifactRef) => !registered[artifactRef]);
  const pendingInteractions = (snapshot.interactions?.pending ?? []).map((interaction) => ({
    requestId: interaction.requestId,
    kind: interaction.kind,
    label: APPROVAL_LABELS[interaction.kind] ?? interaction.questions?.[0]?.header ?? interaction.kind,
    instruction: interaction.reason,
    questions: interaction.questions,
    createdAt: interaction.createdAt,
    interactionSurface: "codex_request_user_input"
  }));
  const durableKinds = new Set(pendingInteractions.map((interaction) => interaction.kind));
  for (const approval of (snapshot.approvals ?? []).filter((item) => item.status !== "approved" && !durableKinds.has(item.kind))) {
    pendingInteractions.push({ kind: approval.kind, label: APPROVAL_LABELS[approval.kind] ?? approval.kind, instruction: APPROVAL_INSTRUCTIONS[approval.kind] ?? "请回到 Codex 完成确认", interactionSurface: "codex_request_user_input", requestState: "not_requested" });
  }
  for (const job of generation?.providerJobs ?? []) if (job.status === "input_required") pendingInteractions.push({ kind: "provider_input", label: `生成任务 ${job.providerJobId} 等待输入`, instruction: job.inputRequest?.instruction ?? "请回到 Codex 补充供应商所需输入", interactionSurface: "codex_request_user_input", providerJobId: job.providerJobId });
  for (const query of Object.values(snapshot.videoEvidenceQueries ?? {})) if (query.status === "input_required") pendingInteractions.push({ kind: "evidence_input", label: `证据查询 ${query.plan.queryId} 等待决定`, instruction: "请回到 Codex 确认是否继续检索、调整预算或采用现有证据。", interactionSurface: "codex_request_user_input", queryId: query.plan.queryId });
  if (patch?.status === "awaiting_approval") pendingInteractions.push({ kind: "timeline_patch", label: `时间线补丁 ${patch.patchId} 等待批准`, instruction: `请回到 Codex 审核 ${(patch.materialChanges ?? []).join(", ")} 后决定是否提交。`, interactionSurface: "codex_request_user_input", patchId: patch.patchId });
  if (snapshot.modelKnowledgePatch?.status === "review_required") pendingInteractions.push({ kind: "model_knowledge_patch", label: "模型经验建议等待审批", instruction: "请回到 Codex 审核建议的依据、作用域和有效期后接受或拒绝。", interactionSurface: "codex_request_user_input", reportId: snapshot.modelKnowledgePatch.reportId });
  const agentBatches = (snapshot.subagentOrchestrationPlan?.batches ?? []).map((batch) => ({
    batchId: batch.batchId,
    order: batch.order,
    status: batch.status ?? "pending",
    taskIds: batch.taskIds,
    startedAt: batch.startedAt ?? null,
    completedAt: batch.completedAt ?? null,
    dispatchedCount: batch.taskIds.filter((taskId) => snapshot.subagentOrchestrationPlan.tasks.find((task) => task.taskId === taskId)?.dispatchReceipt).length
  }));
  return {
    schemaVersion: "1.0",
    views: ["media", "review", "activity", "workflow", "coverage", "continuity", "storyboard"],
    nodes,
    edges,
    workflow,
    assets,
    assetRelations,
    mediaGraph,
    sceneCoverage,
    cameraContinuity,
    reviewTimeline: snapshot.avReviewTimeline ?? null,
    reviewSession: snapshot.reviewSession ?? null,
    hostCapabilities: snapshot.hostCapabilities ?? null,
    evidenceRail,
    editDiff,
    viewport: canvas.viewport ?? { x: 0, y: 0, zoom: 0.72 },
    activity: { events: [...(snapshot.events ?? [])].reverse().slice(0, 80), pendingInteractions, missingEvidence, agentBatches },
    summary: { nodeCount: nodes.length, workflowNodeCount: workflow.nodes.length, assetCount: assets.length, mediaGraphNodeCount: mediaGraph.nodes.length, mediaGraphEdgeCount: mediaGraph.edges.length, mediaCounts: mediaGraph.counts, agentCount: subagents.length, agentBatchCount: agentBatches.length, activeAgentBatchCount: agentBatches.filter((batch) => batch.status === "running").length, lineageCount: lineageNodes.length, acceptedKnowledgeCount: snapshot.acceptedModelKnowledge?.entries.length ?? 0, benchmarkReportCount: benchmarkNodes.length, capabilityCount: capabilityNodes.length, capabilityRouteStatus: snapshot.capabilityRoute?.status ?? null, toolCount: toolNodes.length, toolRouteStatus: snapshot.capabilityExecutionPlan?.status ?? null, recommendedToolStrategy: snapshot.capabilityExecutionPlan?.recommendedStrategy ?? null, executionTelemetryCount: telemetryNodes.length, routeFeedbackStatus: snapshot.modelKnowledgePatch?.status ?? null, timelineRevisionCount: timelineRevisions.length, manualEditorStatus: snapshot.openCutEditor?.sessions?.[snapshot.openCutEditor?.activeSessionId]?.status ?? snapshot.openCutEditor?.decision?.status ?? null, roughCutProposalCount: Object.keys(snapshot.roughCutProposals ?? {}).length, executionGraph: snapshot.executionGraph ? { graphId: snapshot.executionGraph.graphId, revision: snapshot.executionGraph.revision, nodeCount: executionNodes.length, completedCount: executionNodes.filter((node) => node.status === "complete").length } : null, sceneCoveragePlan: sceneCoverage ? { planId: sceneCoverage.planId, status: sceneCoverage.status, sceneCount: sceneCoverage.scenes.length, shotCount: sceneCoverage.shots.length, setupCount: sceneCoverage.setupGroups.length } : null, cameraContinuityGraph: cameraGraph ? { graphId: cameraGraph.graphId, status: cameraGraph.status, shotCount: cameraContinuityNodes.length, cameraCount: cameraGraph.cameras.length, executionWaveCount: cameraGraph.executionWaves.length } : null, checkpointCount: snapshot.checkpoints?.length ?? 0, providerProbeCount: providerNodes.length, providerJobCount: generation?.providerJobs?.length ?? 0, repairBranchCount: snapshot.repairs?.length ?? 0, taskTransport: snapshot.taskTransport?.transport ?? null, reviewTimelineMarkerCount: snapshot.avReviewTimeline?.markers?.length ?? 0, runMode: snapshot.runMode?.mode ?? null, currentStage: snapshot.stage, pipelineId: snapshot.pipeline?.id ?? null, pipelineLabel: snapshot.pipeline?.label ?? null, pendingInteractionCount: pendingInteractions.length, missingEvidenceCount: missingEvidence.length, generationCost: generation ? { currency: generation.currency, estimated: generation.totalEstimatedCost, actual: generation.totalActualCost } : null }
  };
}

export const productionCanvasStages = STAGES;

function artifactLabel(artifactRef) {
  const labels = { "Director.md": "Director.md · 导演核心文档", "script.md": "脚本文档", "shotlist.json": "镜头清单", "storyboard.json": "分镜板", "delivery.video": "最终交付视频" };
  return labels[artifactRef] ?? artifactRef.replaceAll("_", " ");
}

function buildSceneCoverageProjection(plan) {
  if (!plan) return null;
  const blockerShotIds = new Set((plan.blockers ?? []).flatMap((issue) => issue.shotIds ?? []));
  const warningShotIds = new Set((plan.warnings ?? []).flatMap((issue) => issue.shotIds ?? []));
  const shots = (plan.shots ?? []).map((shot) => ({
    id: `coverage-shot:${shot.shotId}`,
    type: "shot",
    stage: "storyboard",
    label: `${shot.shotId} · ${shot.coverageRole}`,
    detail: `${shot.shotSize} · ${shot.lensMm}mm · ${shot.movement}`,
    status: blockerShotIds.has(shot.shotId) ? "blocked" : warningShotIds.has(shot.shotId) ? "active" : "complete",
    metadata: shot
  }));
  const byScene = new Map((plan.scenes ?? []).map((scene) => [scene.sceneId, []]));
  for (const node of shots) byScene.get(node.metadata.sceneId)?.push(node);
  return {
    planId: plan.planId,
    sequenceId: plan.sequenceId,
    status: plan.status,
    overallScore: plan.overallScore,
    dimensions: plan.dimensions ?? {},
    scenes: (plan.scenes ?? []).map((scene) => ({ ...scene, shots: byScene.get(scene.sceneId) ?? [] })),
    shots,
    setupGroups: plan.setupGroups ?? [],
    executionWaves: plan.executionWaves ?? [],
    blockers: plan.blockers ?? [],
    warnings: plan.warnings ?? []
  };
}

function isStoryboardAsset(node) {
  if (["image", "video", "audio"].includes(node.type)) {
    return node.metadata?.canvasEssential === true &&
      node.metadata?.internal !== true &&
      !node.metadata?.findingId &&
      Boolean(node.previewUri || node.metadata?.path);
  }
  if (node.type !== "document" || node.metadata?.internal === true || node.metadata?.canvasEssential === false) return false;
  return /\.md$/i.test(node.artifactRef ?? "") || /\.md$/i.test(node.metadata?.path ?? "");
}

function buildMediaGraph(assets, relations) {
  const columns = ["image", "video", "audio", "document"];
  const grouped = new Map(columns.map((type) => [type, []]));
  for (const asset of assets) grouped.get(grouped.has(asset.type) ? asset.type : "document").push(asset);
  const nodes = columns.flatMap((type, column) => grouped.get(type).map((asset, row) => ({
    ...asset,
    x: 40 + column * 290,
    y: 80 + row * 150,
    metadata: { ...asset.metadata, mediaGraphColumn: type, mediaGraphRow: row }
  })));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = relations.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).map((edge) => ({ ...edge, kind: edge.kind ?? "derived_from" }));
  const counts = Object.fromEntries(columns.map((type) => [type, grouped.get(type).length]));
  return { nodes, edges, counts, empty: nodes.length === 0 };
}

function buildWorkflowProjection({ goalNode, approvals, stageNodes, runModeNode, budgetNode, completionNode, subagents, executionNodes }) {
  const stageX = Object.fromEntries(STAGES.map((stage, index) => [stage, 80 + index * 260]));
  const nodes = [{ ...goalNode, x: stageX.intake, y: 40 }];
  const edges = [{ id: "workflow-goal-intake", source: goalNode.id, target: "stage:intake", kind: "workflow" }];
  const upperSlots = Object.fromEntries(STAGES.map((stage) => [stage, stage === "intake" ? 1 : 0]));
  const lowerSlots = Object.fromEntries(STAGES.map((stage) => [stage, 0]));
  const approvalStage = (kind) => kind === "delivery" ? "delivery" : ["image_model", "video_model", "voice_model", "music_route", "model", "provider"].includes(kind) ? "generation" : "intake";

  for (const approval of approvals) {
    const targetStage = approvalStage(approval.metadata?.kind ?? approval.id.replace(/^approval:/, ""));
    const slot = upperSlots[targetStage]++;
    nodes.push({ ...approval, x: stageX[targetStage], y: 40 + slot * 110 });
    edges.push({ id: `workflow-gate:${approval.id}`, source: approval.id, target: `stage:${targetStage}`, kind: "approval" });
  }

  if (runModeNode) {
    const slot = upperSlots.intake++;
    nodes.push({ ...runModeNode, x: stageX.intake, y: 40 + slot * 110 });
    edges.push({ id: "workflow-mode-intake", source: runModeNode.id, target: "stage:intake", kind: "decision" });
  }

  for (const [index, stageNode] of stageNodes.entries()) {
    nodes.push({ ...stageNode, x: stageX[stageNode.stage], y: 420 });
    if (index) edges.push({ id: `workflow-stage:${STAGES[index - 1]}:${stageNode.stage}`, source: `stage:${STAGES[index - 1]}`, target: stageNode.id, kind: "workflow" });
  }

  const agentsByStage = groupByStage(subagents.filter((agent) => ["active", "blocked", "failed"].includes(agent.status)));
  for (const stage of STAGES) {
    const agents = agentsByStage[stage] ?? [];
    if (!agents.length) continue;
    const slot = lowerSlots[stage]++;
    nodes.push({
      id: `workflow-agents:${stage}`, type: "agent", stage, label: agents.length === 1 ? agents[0].label : `${agents.length} 个 DX 智能体`,
      detail: agents.map((agent) => `${agent.label} · ${agent.status}`).join("；"), status: agents.some((agent) => ["blocked", "failed"].includes(agent.status)) ? "blocked" : "active",
      x: stageX[stage], y: 590 + slot * 120, metadata: { agentIds: agents.map((agent) => agent.id) }
    });
    edges.push({ id: `workflow-agents-edge:${stage}`, source: `stage:${stage}`, target: `workflow-agents:${stage}`, kind: "agent" });
  }

  const activeTasks = executionNodes.filter((node) => ["active", "blocked", "failed"].includes(node.status));
  const tasksByStage = groupByStage(activeTasks);
  for (const stage of STAGES) {
    const tasks = tasksByStage[stage] ?? [];
    if (!tasks.length) continue;
    const slot = lowerSlots[stage]++;
    nodes.push({
      id: `workflow-work:${stage}`, type: "decision", stage, label: `${STAGE_LABELS[stage]}当前任务`,
      detail: tasks.map((task) => `${task.label} · ${task.status}`).join("；"), status: tasks.some((task) => ["blocked", "failed"].includes(task.status)) ? "blocked" : "active",
      x: stageX[stage], y: 590 + slot * 120, metadata: { executionNodeIds: tasks.map((task) => task.id) }
    });
    edges.push({ id: `workflow-work-edge:${stage}`, source: `stage:${stage}`, target: `workflow-work:${stage}`, kind: "dependency" });
  }

  for (const extra of [budgetNode, completionNode].filter(Boolean)) {
    const stage = extra.stage;
    const slot = lowerSlots[stage]++;
    nodes.push({ ...extra, x: stageX[stage], y: 590 + slot * 120 });
    edges.push({ id: `workflow-extra:${extra.id}`, source: `stage:${stage}`, target: extra.id, kind: extra.type === "approval" ? "approval" : "budget" });
  }

  return { nodes, edges };
}

function groupByStage(items) {
  return items.reduce((groups, item) => {
    (groups[item.stage] ??= []).push(item);
    return groups;
  }, {});
}

function capabilityStage(department) {
  return ({ direction: "intake", research: "research", writing: "script", preproduction: "storyboard", generation: "generation", production: "generation", editing: "edit", audio: "edit", localization: "edit", review: "review", delivery: "delivery" })[department] ?? "intake";
}

function telemetryStage(capabilityId) {
  if (capabilityId.startsWith("review.")) return "review";
  if (capabilityId.startsWith("delivery.")) return "delivery";
  if (capabilityId.startsWith("script.")) return "script";
  if (capabilityId.startsWith("storyboard.") || capabilityId.startsWith("continuity.")) return "storyboard";
  if (capabilityId.startsWith("reference.")) return "research";
  if (capabilityId.startsWith("audio.") || capabilityId.startsWith("subtitle.")) return "edit";
  if (["video.text_to_video", "video.image_to_video", "video.first_last_frame", "video.extend"].includes(capabilityId)) return "generation";
  if (capabilityId.startsWith("video.")) return "edit";
  return "generation";
}
