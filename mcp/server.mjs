import { readFile } from "node:fs/promises";
import process, { stdin, stdout } from "node:process";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { createRun, publicSnapshot, readRun, updateRun, assertSecretFree } from "./run-store.mjs";
import { projectCanvas } from "./canvas-projector.mjs";
import { createPipelineRunState, missingRegisteredArtifacts, PIPELINE_CATALOG, transitionPipelineStage } from "./pipeline-catalog.mjs";
import { writeDeliveryPromise, writeDirectorDocument, writeIntakeConfirmation, writeIntentResolution, writeProjectBrief } from "./director-artifacts.mjs";
import { assertReferenceDownloadAuthorized, ingestReferenceVideo } from "./reference-ingest.mjs";
import { readVideoEvidence, VIDEO_READ_PROFILES } from "./video-reading.mjs";
import { artifactRecord, inspectArtifact } from "./artifact-registry.mjs";
import { buildResearchPackageTemplate, validateResearchPackage, writeReferenceDownloadConsent, writeReferenceVideoAssessment, writeResearchPackage, writeWebResearch } from "./research-artifacts.mjs";
import { beginGenerationAttempt, recordGenerationCandidate, registerGenerationPlan, reviewGenerationCandidate, selectGenerationCandidate, writeGenerationArtifacts } from "./generation-control.mjs";
import { assertPromptBoundSubmission, compilePromptBoundGenerationPlan } from "./prompt-bound-generation-plan.mjs";
import { compileGenerationRepairPlan, generationRepairDefectTypes, writeGenerationRepairArtifacts } from "./generation-repair-compiler.mjs";
import { confirmDxSubagentHostClosed, DX_SUBAGENT_CATALOG, dxIdentityInstruction, registerDxSubagent, updateDxSubagent } from "./subagent-registry.mjs";
import { inspectCodexAgentRoles, installCodexAgentRoles } from "./codex-agent-roles.mjs";
import { projectRecoveryAction, toolFailurePayload, withToolFailureGuard } from "./tool-failure-policy.mjs";
import { evaluateRunCompletion } from "./completion-policy.mjs";
import { assertIntakeReady, confirmIntake } from "./intake-gate.mjs";
import { analyzeMediaWaveform, executeHyperframesRender, executeMosiTts, executeMossTtsNano, executeRemotionRender, executeWhisperTranscription, inspectAudioSource, inspectMediaDelivery, writeExecutionReceipt } from "./media-execution.mjs";
import { inspectMediaRuntime } from "../runtime/media-runtime.mjs";
import { installDirectorXMediaRuntime } from "../runtime/install-media-runtime.mjs";
import { diagnosePluginHealth, PLUGIN_HEALTH_PROFILES } from "../runtime/plugin-health.mjs";
import { createPluginRepairRegistry } from "../runtime/plugin-repair.mjs";
import { runPluginSmokeTest } from "../runtime/plugin-smoke-test.mjs";
import { writeLongformPlan, writeLongformStitchPlan } from "./longform-control.mjs";
import { assertRenderPropsBindSegmentStitch, auditSegmentContinuity, extractSegmentBoundaryFrames, preserveSegmentContinuityRenderEvidence, writeBoundaryContinuityReport, writeSegmentBoundaryIndex, writeSegmentContinuityPlan, writeSegmentStitchPlan } from "./segment-continuity.mjs";
import { extractChromaLayers, writeLayeredCollagePlan, writeLayeredCollageReview } from "./layered-collage.mjs";
import { appendRunCheckpoint, approveStage, assertRunModeAllowsStage, configureRunMode, RUN_MODES } from "./run-control.mjs";
import { recordProviderCapabilityProbe, writeProviderCapabilitySnapshot } from "./provider-capabilities.mjs";
import { requestProviderJobCancellation, submitProviderJob, updateProviderJob } from "./provider-jobs.mjs";
import { durableMediaJob, getMediaProvider, listMediaProviders, mediaProviderSetup, pollMediaGeneration, resolveGeneratedMedia, resolveMediaCredential, submitMediaGeneration, writeGeneratedMedia } from "./media-provider-gateway.mjs";
import { customProviderIntake, customProviderSetup, getCustomMediaProviderAdapter, hydrateCustomMediaProviderAdapters, registerCustomMediaProviderAdapter, writeCustomMediaProviderAdapter } from "./custom-media-provider-adapter.mjs";
import { completeRepairBranch, createRepairBranch, writeRepairBranches } from "./repair-control.mjs";
import { negotiateTaskTransport, writeTaskTransport } from "./task-transport.mjs";
import { registerAvReviewTimeline, writeAvReviewTimeline } from "./av-review-timeline.mjs";
import { importCaptionTrack } from "./caption-import.mjs";
import { buildWaveformPyramid, getWaveformWindow } from "./waveform-pyramid.mjs";
import { normalizeExecutionGraph, registerExecutionGraph, transitionExecutionNode, writeExecutionGraph } from "./execution-graph.mjs";
import { finalizeEvidenceBundle, recordVideoEvidenceSearch, recordVideoRetrievalTrace, registerMediaEvidenceIndex, registerVideoQueryPlan, searchMediaEvidence, writeMediaEvidenceArtifacts } from "./media-evidence.mjs";
import { materializeEvidenceClip } from "./evidence-clips.mjs";
import { commitTimelinePatch, compileEditGraph, createPatchPreview, editOperations, materialEditChanges, registerEditIntent, registerTimelinePatch, registerTimelineRevision, writeEditArtifacts } from "./edit-graph.mjs";
import { createReviewSession, reviewCompareModes, updateReviewTransport, writeReviewSession } from "./review-session.mjs";
import { planCapabilityRoute, VIDEO_CAPABILITY_CATALOG, writeCapabilityRoute } from "./video-capabilities.mjs";
import { planToolRoute, registerToolInventory, writeToolRoutingArtifacts } from "./tool-routing.mjs";
import { compileRouteFeedback, recordProviderCapacity, recordToolExecution, writeRouteFeedbackArtifacts } from "./route-feedback.mjs";
import { bindExecutionLineage, reviewKnowledgePatch, revokeKnowledgePatch, writeLineageArtifacts } from "./production-lineage.mjs";
import { compileBenchmarkReport, recordBenchmarkTrial, registerBenchmarkSuite, writeBenchmarkArtifacts } from "./benchmark-control.mjs";
import { BENCHMARK_VERIFIER_CATALOG, executeBenchmarkVerifiers } from "./benchmark-verifiers.mjs";
import { compileOtlpTrace, promoteBenchmarkBaseline, readBaselineStore, revokeBenchmarkBaseline, writeGovernanceArtifacts } from "./observability-baseline.mjs";
import { BENCHMARK_FIXTURE_TEMPLATES, cancelBenchmarkSchedule, claimBenchmarkJob, instantiateBenchmarkTemplate, planBenchmarkSchedule, updateBenchmarkJob, writeBenchmarkSchedule } from "./benchmark-scheduler.mjs";
import { getStageRequirements, inspectStagePackage } from "./stage-package.mjs";
import { analyzeFinalMediaQuality, DELIVERY_TIERS, updateQualityFrameAudit } from "./final-media-quality.mjs";
import { buildFrameAuditRepairPlan, mergeFrameAuditIntoReviewTimeline } from "./frame-audit-repair.mjs";
import { attachFrameEvidenceToRepairPlan, attachFrameIdentityToAudit, collectFrameIdentityEvidence, extractFrameAuditEvidence, frameEvidenceCaptureIndices } from "./frame-identity-evidence.mjs";
import { buildFinalReviewEvidence, finalReviewDecisions, finalReviewDispositions, finalReviewReviewerId } from "./final-review-evidence.mjs";
import { assertCanInstallSubagentPlan, assertStageParallelDispatchStarted, assertStageParallelismObserved, compileExecutionGraphSubagentTasks, planParallelSubagents, writeParallelSubagentDispatchEvidence, writeParallelSubagentPlan } from "./parallel-subagents.mjs";
import { acquireWebImageAsset, auditVisualAssetCoverage, WEB_IMAGE_CATEGORIES, writeVisualAssetCoverage } from "./web-image-assets.mjs";
import { NATIVE_INTERACTION_KINDS, requestNativeInteraction, requireResolvedInteraction, resolveNativeInteraction } from "./interaction-gates.mjs";
import { buildOpenCutEditorBootstrap, createOpenCutEditorSession, getOpenCutEditorStatus, importOpenCutEditorDraft, markOpenCutEditCommitted, markOpenCutEditRendered, markOpenCutEditReviewed, markOpenCutServiceRunning, openCutEditorWaveformDescriptor, recordPostProductionEditDecision, resumeOpenCutEditorAfterDecline, saveOpenCutEditorDraft, writeOpenCutEditorArtifacts } from "./opencut-editor.mjs";
import { proposeEvidenceRoughCut, writeEvidenceRoughCutArtifact } from "./evidence-rough-cut.mjs";
import { writeDirectorXTimelineInterchange } from "./timeline-interchange.mjs";
import { buildRunResumeActionPlan } from "./run-resume.mjs";
import { executeOpenCutRender } from "./opencut-render.mjs";
import { normalizeCanvasUiState } from "./canvas-ui-state.mjs";
import { acknowledgeCanvasReviewNote, recordCanvasReviewNote, resolveCanvasReviewNote, writeCanvasReviewNotesArtifact } from "./canvas-review-notes.mjs";
import { auditAssetQuality, registerAssetSearchPlan, requireWebAssetDownloadAuthorization, writeAssetQualityAudit, writeAssetSearchPlan } from "./asset-retrieval.mjs";
import { compileCameraContinuityPlan, reviewCameraReferences, writeCameraContinuityArtifacts } from "./camera-continuity-graph.mjs";
import { conciseToolResult, DIRECTORX_CONVERSATION_POLICY, friendlyToolTitle } from "./conversation-ux.mjs";
import { assertQuoteApprovedByBudget, listModelPricing, quoteModelCost, registerModelPricing, validateOfficialBudget, writeModelPricingEvidence } from "./pricing-catalog.mjs";
import { applyAudioResponsibilityToMediaInput, compileAudioResponsibilityPlan, musicRouteSetup, writeAudioResponsibilityPlan } from "./audio-routing.mjs";
import { auditMusicAsset, listMusicLibraries, registerMusicAudit, writeMusicAudit } from "./music-assets.mjs";
import { compileReferenceReplicationPlan, writeReferenceReplicationPlan } from "./reference-replication.mjs";
import { compileReferenceReplicationReview, writeReferenceReplicationReview, REPLICATION_DIMENSIONS } from "./reference-replication-review.mjs";
import { assertRenderQualityReady, compileRenderQualityContract } from "./render-quality-contract.mjs";
import { planProductionComplexity } from "./production-complexity.mjs";
import { beginCreativeWork, beginReferenceResearch, evaluateCreativeProgressSla, evaluateFastStartReadiness, evaluateReferenceResearchReadiness } from "./fast-start-policy.mjs";
import { compileTransitionLanguagePlan, DIRECTOR_TRANSITION_METHODS, writeTransitionLanguagePlan } from "./transition-language.mjs";
import { assertRenderPropsBindTransitionExecution, preserveTransitionExecutionRenderEvidence } from "./transition-execution-contract.mjs";
import { assertRenderPropsBindRemotionProjection, compileRemotionRenderProjection } from "./remotion-render-projection.mjs";
import { bindShotSequenceReviewToShotlist, reviewShotSequence, SHOT_SEQUENCE_FUNCTIONS, SHOT_SEQUENCE_MOVEMENTS, SHOT_SEQUENCE_SIZES, writeShotSequenceReview } from "./shot-sequence-review.mjs";
import { AXIS_TYPES, bindSceneCoveragePlanToShotlist, CAMERA_HEIGHTS, CAMERA_SIDES, compileSceneCoveragePlan, FACING_DIRECTIONS, FOCUS_STRATEGIES, FRAME_REGIONS, LENS_INTENTS, LIGHT_DIRECTIONS, MEDIA_MODES, NEGATIVE_SPACE_PURPOSES, SCENE_COVERAGE_ROLES, writeSceneCoveragePlan } from "./scene-coverage-plan.mjs";
import { attachSceneCoverageEvidence, compileSceneCoverageConformance, extractSceneCoverageEvidence, recordSceneCoverageConformanceReview, sceneCoverageEvidenceFrameIndices, sceneCoverageReviewDecisions, sceneCoverageReviewerId, sceneCoverageReviewStatuses, writeSceneCoverageConformance } from "./scene-coverage-conformance.mjs";
import { createToolRegistry } from "./tool-registry.mjs";
import { applyToolContracts } from "./tool-contracts.mjs";
import { CanvasSurfaceHostError, createCanvasSurfaceHost } from "./canvas-surface-host.mjs";
import { resolveWorkspaceMediaFile } from "./workspace-media-access.mjs";
import { ARTIFACT_RESOURCE_URI_TEMPLATE, readArtifactResource } from "./artifact-resources.mjs";
import { bindVisualPromptPackToGroundingReport, bindVisualPromptPackToShotSequence, compileClaimProofMap, compileVisualPromptPack, writeDirectorGenerationArtifact, writeVisualPromptPackSummary } from "./director-generation-contracts.mjs";
import { bindShotGroundingPlanToShotlist, compileShotGroundingPlan, finalizeShotGrounding, writeShotGroundingArtifacts } from "./shot-grounding.mjs";
import { loadBundledDirectorKnowledge, mergeDirectorKnowledgeLibraries, queryDirectorKnowledge } from "./director-knowledge-library.mjs";
import { compileCinematicReferenceSelection, loadBundledCinematicReferences, queryCinematicReferences, writeCinematicReferenceSelection } from "./cinematic-reference-library.mjs";
import { compileReferenceLearningCandidate, promoteReferenceLearningCandidate, readProjectDirectorKnowledge, writePromotedProjectKnowledge, writeReferenceLearningCandidate } from "./reference-learning.mjs";
import { compileDirectorXGoalBootProtocol, compilePendingInteractionBatch } from "./host-action-protocol.mjs";
import { persistPreflightTransaction, projectPreflightBootTransaction, readPreflightTransaction } from "./preflight-transaction.mjs";
import { detectCodexHostCapabilities } from "./codex-host-capabilities.mjs";
import { assertDirectorXToolSafetyPolicy } from "./tool-safety-policy.mjs";

const CANVAS_URI = "ui://directorx/production-canvas-v1.html";
const SCENE_CONFORMANCE_INSTRUCTIONS = "After directorx_verify_final_media, require scene_coverage_conformance_report.json to pass all non-waivable shot identity, order, duration, source-handle, full-frame, and PTS checks. Dispatch DX-Quality-Reviewer to inspect every planned shot's first/middle/last identity-bound frame, then call directorx_record_scene_coverage_review before final frame-finding acceptance. Metadata cannot prove camera, blocking, composition, lighting, movement, proof, reaction, or narrative fulfillment.";
const SERVER_INSTRUCTIONS = "Use a concise consumer-facing Director X voice. In the Codex conversation, never narrate tool calls, file registration, JSON artifacts, schemas, MCP/runtime details, IDs, paths, test counts, or subagent plumbing unless the user asks for technical details or a failure requires diagnosis. Do not use Current Problem / Plan / Risks / Changed / Verified templates during production. Send one short start message, then only tangible stage milestones, blockers, native questions, preview availability, and final delivery. A normal update is at most two short sentences and should reuse userFacingSummary.suggestedUpdate. Do not duplicate a request_user_input question in chat. A returned native interaction may batch up to three independent image, video, voice, or music route questions; execute it once, then execute every afterAnswer resolution action with the same answer map before continuing. Never batch Goal, budget, credential, rights, stage, edit, or delivery approvals. Keep technical execution in collapsed tool results and the canvas Activity details. A delegated DX child must never call directorx_plan_production_team or create another background delegation plan. " +
  "For every Director X trigger, call directorx_capability_preflight before all other work. Use directorx_create_and_ask_native_question as the single model-visible native interaction entry. At production start, confirm exact image, video, and voice routes through Codex request_user_input. For built-in routes, call directorx_get_media_provider_setup, resolve its native keySetupInteraction, and inject the secret only through the secure canvas credential field before recording the decision. For an unknown supplier/model, call directorx_get_custom_media_provider_intake and require the user to provide the exact model plus an official HTTPS API documentation or homepage URL; DX-Model-Router must read only verified official sources before registering a declarative adapter. After Goal, run mode, any required Intake answer, and the minimum Intake contract are resolved, use directorx_prepare_fast_start_intake when available, then call directorx_begin_reference_research immediately. Reference download, audio extraction, video reading, asset search, and the first script must proceed in parallel while provider docs and Keys are being configured. Provider, budget, and Key approvals remain hard gates for Generation, not for Research. Use directorx_begin_creative_work only as an idempotent compatibility path after research has started. The canvas is a projection of the durable Run and must prioritize growing real image, video, audio, research, script, storyboard, keyframe, and preview assets. If the five-minute creative-output SLA breaches, stop adding configuration work and dispatch the creative tracks immediately. Record music_strategy before research, then music_asset_selection only after search, local acquisition, rights proof, and quality audit. Research and generation must register the audio_responsibility_plan.json route before final review. For a reference-replication run, ingest the video and audio bundle first, compile the replication plan, then call directorx_score_reference_replication after exhaustive audit to choose pass_export, needs_edit, or regenerate. Never start an auxiliary Director X MCP runtime; one active runtime owns each Run. Preserve all existing provider, rights, pricing, continuity, render, exhaustive review, and delivery gates.";
const FAILURE_POLICY_INSTRUCTIONS = "When a tool fails, inspect retryable, attempts, stop, recovery, and nextRequiredAction. Retry a transient semantic operation at most once. Use directorx_get_recovery_action for the minimal blocked operation, root cause, corrected example, and unique resume action; completed artifacts remain available. For deterministic failures, call directorx_recover_run and retry only corrected arguments. Use directorx_create_and_ask_native_question for native gates; a chat message such as ‘继续’ cannot satisfy them. Never create a replacement Run or auxiliary MCP runtime.";
const credentialStatus = new Map();
const preflightSessions = new Map();
const setupRepairRegistry = createPluginRepairRegistry();
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/;
const INLINE_FALLBACK_REASONS = Object.freeze(["browser_runtime_unavailable", "browser_disconnected"]);
const canvasSurfaceHost = createCanvasSurfaceHost({ handleRequest: handleCanvasRequest });

const rawTools = [
  {
    name: "directorx_capability_preflight",
    description: "MANDATORY FIRST TOOL for every Director X request. Start the local canvas service and return the side-Browser URL before any question, workspace scan, planning, research, or file creation. Pass spawn_agent agent_type enum values, or the sentinel collaboration_task when the host schema uses task_name/fork_turns/message without agent_type. Also pass exact current Codex host tool and skill names when available so Goal, request_user_input, side-Browser, and durable-loop routes can be negotiated. Host inventory is capability evidence only and must never be used as agent types.",
    inputSchema: objectSchema({ projectPath: stringSchema(), outcome: stringSchema(), availableAgentTypes: { type: "array", minItems: 1, items: stringSchema() }, hostToolNames: { type: "array", minItems: 1, items: stringSchema() }, hostSkillNames: { type: "array", items: stringSchema() } }, ["projectPath", "outcome", "availableAgentTypes", "hostToolNames"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_get_preflight_status",
    description: "Call immediately after the preflight side-Browser URL has loaded. Returns the native Goal or role-install question only after the real side Browser canvas is connected.",
    inputSchema: objectSchema({ projectPath: stringSchema(), preflightId: stringSchema() }, ["projectPath", "preflightId"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_request_user_interaction",
    description: "Create or reuse one durable, deduplicated Codex request_user_input gate and return the exact host-tool action. The model must execute that host action and wait for its raw answer envelope; never infer an answer from chat text or continue the gated stage while it is pending.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), kind: { enum: NATIVE_INTERACTION_KINDS, type: "string" }, gateKey: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,120}$" }, reason: stringSchema(), questions: { type: "array", minItems: 1, maxItems: 3, items: nativeQuestionSchema() } }, ["projectPath", "runId", "kind", "reason", "questions"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_create_and_ask_native_question",
    description: "Preferred atomic native-question entry. Persist the Director X request first, then return one request_user_input host action whose afterAnswer resolves the same durable request automatically.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), kind: { enum: NATIVE_INTERACTION_KINDS, type: "string" }, gateKey: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,120}$" }, reason: stringSchema(), questions: { type: "array", minItems: 1, maxItems: 3, items: nativeQuestionSchema() } }, ["projectPath", "runId", "kind", "reason", "questions"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_resolve_user_interaction",
    description: "Resolve a pending Director X interaction only with the raw answers envelope returned by the immediately preceding Codex request_user_input action. A chat message such as ‘继续’ is not an answer and must not be used to resolve a pending gate.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), requestId: stringSchema(), confirmedBy: { enum: ["request_user_input"], type: "string" }, answers: { type: "object" } }, ["projectPath", "runId", "requestId", "confirmedBy", "answers"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_create_run",
    description: "Create a durable Director X run after the user has explicitly accepted Director X Goal mode.",
    inputSchema: objectSchema({ projectPath: stringSchema(), outcome: stringSchema(), preflightId: stringSchema(), goalInteractionRequestId: stringSchema(), codexGoalId: { type: "string" }, confirmedBy: { enum: ["request_user_input"], type: "string" }, goalAccepted: { const: true, type: "boolean" } }, ["projectPath", "outcome", "preflightId", "goalInteractionRequestId", "confirmedBy", "goalAccepted"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_prepare_goal_completion",
    description: "Enforce the Director X terminal contract before Codex marks its Goal complete. Planning documents never satisfy a requested final video.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema() }, ["projectPath", "runId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_list_pipelines",
    description: "List the built-in Director X production pipelines and their stage and skill contracts.",
    inputSchema: objectSchema({}),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_list_subagent_roles",
    description: "List canonical Director X subagent roles and their required DX-prefixed display names.",
    inputSchema: objectSchema({}),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_get_subagent_naming_status",
    description: "Check effective project-or-user role files and whether the current Codex spawn_agent schema has actually loaded every dx_* role.",
    inputSchema: objectSchema({ projectPath: stringSchema(), availableAgentTypes: { type: "array", minItems: 1, items: stringSchema() } }, ["projectPath", "availableAgentTypes"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_install_subagent_roles",
    description: "Install or synchronize Director X Codex dx_* role files with the versioned system-prompt contract so every project can display canonical DX-prefixed subagents. This mutation requires Codex request_user_input, updates only plugin-managed files, and never overwrites project or user conflicts.",
    inputSchema: objectSchema({ projectPath: stringSchema(), preflightId: stringSchema(), interactionRequestId: stringSchema(), confirmedBy: { enum: ["request_user_input"], type: "string" }, roleInstallAccepted: { const: true, type: "boolean" } }, ["projectPath", "preflightId", "interactionRequestId", "confirmedBy", "roleInstallAccepted"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_list_video_capabilities",
    description: "List the machine-routable Director X video abilities, owning DX roles, tool classes, artifacts, and native interaction gates.",
    inputSchema: objectSchema({}),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_plan_capability_route",
    description: "Resolve selected Video Agent abilities into an auditable capability route before building the execution graph or spawning DX agents.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), routeId: stringSchema(), objective: stringSchema(), requestedCapabilities: { type: "array", minItems: 1, items: stringSchema() } }, ["projectPath", "runId", "routeId", "objective", "requestedCapabilities"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_tool_inventory",
    description: "Record the currently available Codex host, plugin, MCP app, local-runtime, and provider tools with permissions and observed service metrics.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), inventoryId: stringSchema(), hostBuild: { type: "string" }, currency: stringSchema(),
      tools: { type: "array", minItems: 1, items: objectSchema({
        toolId: stringSchema(), toolClass: stringSchema(),
        source: { enum: ["codex_host", "directorx_plugin", "mcp_app", "local_runtime", "provider"], type: "string" },
        status: { enum: ["available", "degraded", "unavailable"], type: "string" },
        permissions: { type: "array", items: stringSchema() }, taskSupport: { enum: ["required", "optional", "forbidden", "unknown"], type: "string" }, capabilityIds: { type: "array", items: stringSchema() },
        qualityScore: { type: "number", minimum: 0, maximum: 1 }, reliabilityScore: { type: "number", minimum: 0, maximum: 1 }, estimatedCost: { type: "number", minimum: 0 }, latencyMsP50: { type: "number", minimum: 0 }
      }, ["toolId", "toolClass", "source", "status", "permissions", "qualityScore", "reliabilityScore", "estimatedCost", "latencyMsP50"] ) }
    }, ["projectPath", "runId", "inventoryId", "currency", "tools"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_plan_tool_route",
    description: "Match the selected Video Agent capabilities to runtime tools and compare quality, balanced, and economy execution strategies under hard constraints.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), planId: stringSchema(), maxEstimatedCost: { type: "number", minimum: 0 }, maxLatencyMs: { type: "number", exclusiveMinimum: 0 }, minimumQuality: { type: "number", minimum: 0, maximum: 1 }, allowedSources: { type: "array", items: stringSchema() }, requiredPermissions: { type: "array", items: stringSchema() } }, ["projectPath", "runId", "planId", "maxEstimatedCost", "maxLatencyMs", "minimumQuality"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_tool_execution",
    description: "Record evidence-backed actual cost, latency, outcome, quality, and failure classification for a tool selected by the active execution plan.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), executionId: stringSchema(), lineageBindingId: stringSchema(), capabilityId: stringSchema(), toolId: stringSchema(), status: { enum: ["succeeded", "failed", "cancelled", "input_required"], type: "string" }, failureClass: { enum: ["none", "timeout", "rate_limited", "provider_error", "permission_denied", "invalid_output", "quality_rejected", "rights_blocked", "user_cancelled"], type: "string" }, actualCost: { type: "number", minimum: 0 }, latencyMs: { type: "number", minimum: 0 }, qualityScore: { type: "number", minimum: 0, maximum: 1 }, reviewEvidenceRefs: { type: "array", items: stringSchema() } }, ["projectPath", "runId", "executionId", "lineageBindingId", "capabilityId", "toolId", "status", "failureClass", "actualCost", "latencyMs"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_bind_execution_lineage",
    description: "Bind a production execution to immutable DX agent, tool/provider/model version, prompt contract, Director contract, and hashed input/output media evidence before telemetry is accepted.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), bindingId: stringSchema(), capabilityId: stringSchema(), toolId: stringSchema(), providerId: stringSchema(), modelId: stringSchema(), modelVersion: stringSchema(), promptContractId: stringSchema(), promptContractHash: stringSchema(), directorContractFingerprint: stringSchema(), dxAgent: stringSchema(),
      inputArtifacts: { type: "array", minItems: 1, items: objectSchema({ artifactRef: stringSchema(), sha256: stringSchema() }, ["artifactRef", "sha256"]) },
      outputArtifacts: { type: "array", minItems: 1, items: objectSchema({ artifactRef: stringSchema(), sha256: stringSchema() }, ["artifactRef", "sha256"]) }
    }, ["projectPath", "runId", "bindingId", "capabilityId", "toolId", "providerId", "modelId", "modelVersion", "promptContractId", "promptContractHash", "directorContractFingerprint", "dxAgent", "inputArtifacts", "outputArtifacts"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_provider_capacity",
    description: "Record an observed provider/tool capacity window for queue-aware future routing without changing the approved current route.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), snapshotId: stringSchema(), toolId: stringSchema(), state: { enum: ["healthy", "constrained", "saturated", "unavailable"], type: "string" }, activeJobs: { type: "integer", minimum: 0 }, maxConcurrentJobs: { type: "integer", minimum: 0 }, queueDepth: { type: "integer", minimum: 0 }, retryAfterSeconds: { type: "integer", minimum: 0 } }, ["projectPath", "runId", "snapshotId", "toolId", "state", "activeJobs", "maxConcurrentJobs", "queueDepth", "retryAfterSeconds"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_route_feedback",
    description: "Compile an empirical route-regret proxy and proposed future-route model knowledge patches from evidence-backed execution telemetry; never mutates the approved current route.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), reportId: stringSchema(), minimumSamples: { type: "integer", minimum: 2 } }, ["projectPath", "runId", "reportId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_review_model_knowledge_patch",
    description: "Accept or reject a proposed future-route knowledge patch after Codex request_user_input confirmation; accepted knowledge is scoped, permissioned, expiring, and cannot mutate the current approved route.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), interactionRequestId: stringSchema(), patchId: stringSchema(), decision: { enum: ["accept", "reject"], type: "string" }, scope: { enum: ["project", "workspace"], type: "string" }, authority: { enum: ["project_user", "workspace_admin"], type: "string" }, confirmedBy: { enum: ["request_user_input"], type: "string" }, note: stringSchema(), expiresAt: stringSchema() }, ["projectPath", "runId", "interactionRequestId", "patchId", "decision", "scope", "authority", "confirmedBy", "note", "expiresAt"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_revoke_model_knowledge_patch",
    description: "Revoke previously accepted model-routing knowledge after Codex request_user_input confirmation without changing historical evidence.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), interactionRequestId: stringSchema(), patchId: stringSchema(), confirmedBy: { enum: ["request_user_input"], type: "string" }, note: stringSchema() }, ["projectPath", "runId", "interactionRequestId", "patchId", "confirmedBy", "note"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_benchmark_suite",
    description: "Register a repeatable Video Agent benchmark suite with routed capabilities, production fixtures, programmatic verifiers, expert rubric dimensions, and cost/latency limits.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), suiteId: stringSchema(), version: stringSchema(), taskFamily: stringSchema(), capabilityIds: { type: "array", items: stringSchema() }, fixtures: { type: "array", minItems: 1, items: objectSchema({ fixtureId: stringSchema(), objective: stringSchema(), inputArtifactRefs: { type: "array", items: stringSchema() }, expectedArtifactRefs: { type: "array", minItems: 1, items: stringSchema() }, programmaticChecks: { type: "array", minItems: 1, items: stringSchema() }, expertRubric: { type: "array", minItems: 1, items: objectSchema({ dimensionId: stringSchema(), weight: { type: "number", exclusiveMinimum: 0 }, minimumScore: { type: "number", minimum: 0, maximum: 1 } }, ["dimensionId", "weight", "minimumScore"]) }, maxCost: { type: "number", minimum: 0 }, maxLatencyMs: { type: "number", minimum: 0 } }, ["fixtureId", "objective", "expectedArtifactRefs", "programmaticChecks", "expertRubric", "maxCost", "maxLatencyMs"]) } }, ["projectPath", "runId", "suiteId", "version", "taskFamily", "capabilityIds", "fixtures"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_list_benchmark_verifiers",
    description: "List the fixed, non-shell benchmark verifiers that the Director X plugin can execute against registered project artifacts.",
    inputSchema: objectSchema({}),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_list_benchmark_fixture_templates",
    description: "List rights-safe Director X templates for repurpose, sequencing, repair, and assembly post-production benchmarks.",
    inputSchema: objectSchema({}), annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_instantiate_benchmark_template",
    description: "Instantiate a rights-safe Repurpose, Sequencing, Repair, or Assembly template as a registered benchmark suite using routed capabilities and registered input artifacts.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), familyId: { enum: ["repurpose", "sequencing", "repair", "assembly"], type: "string" }, suiteId: stringSchema(), version: stringSchema(), fixtureId: stringSchema(), objective: stringSchema(), inputBindings: { type: "array", minItems: 1, items: objectSchema({ slot: stringSchema(), artifactRef: stringSchema(), rightsStatus: { enum: ["user_uploaded", "licensed", "public_domain", "not_applicable"], type: "string" }, rightsEvidenceRef: stringSchema() }, ["slot", "artifactRef", "rightsStatus"]) }, maxCost: { type: "number", minimum: 0 }, maxLatencyMs: { type: "number", minimum: 0 } }, ["projectPath", "runId", "familyId", "suiteId", "version", "inputBindings", "maxCost", "maxLatencyMs"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_plan_benchmark_schedule",
    description: "Plan all fixture/repeat cells up front with deterministic shared seeds, concurrency, and a hard total-cost ceiling so failed or weak rollouts cannot be omitted.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), scheduleId: stringSchema(), suiteId: stringSchema(), repeatsPerFixture: { type: "integer", minimum: 1, maximum: 20 }, baseSeed: { type: "integer", minimum: 0 }, maxConcurrency: { type: "integer", minimum: 1, maximum: 8 }, maxTotalCost: { type: "number", minimum: 0 } }, ["projectPath", "runId", "scheduleId", "suiteId", "repeatsPerFixture", "baseSeed", "maxConcurrency", "maxTotalCost"]), annotations: writeAnnotations()
  },
  {
    name: "directorx_claim_benchmark_job",
    description: "Claim the next pending benchmark cell in fixed schedule order while enforcing concurrency.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), scheduleId: stringSchema() }, ["projectPath", "runId", "scheduleId"]), annotations: writeAnnotations()
  },
  {
    name: "directorx_update_benchmark_job",
    description: "Finalize one active benchmark cell; success requires its durable trial and failures remain scored instead of disappearing.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), scheduleId: stringSchema(), jobId: stringSchema(), status: { enum: ["succeeded", "failed", "cancelled"], type: "string" }, trialId: stringSchema(), errorCode: stringSchema() }, ["projectPath", "runId", "scheduleId", "jobId", "status"]), annotations: writeAnnotations()
  },
  {
    name: "directorx_cancel_benchmark_schedule",
    description: "Cancel pending benchmark cells without silently terminating already-running provider work.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), scheduleId: stringSchema() }, ["projectPath", "runId", "scheduleId"]), annotations: writeAnnotations()
  },
  {
    name: "directorx_execute_benchmark_verifiers",
    description: "Execute every declared fixture check through the plugin's built-in verifier registry and persist a non-forgeable evidence receipt.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), suiteId: stringSchema(), fixtureId: stringSchema(), receiptId: stringSchema(), checks: { type: "array", minItems: 1, items: objectSchema({ checkId: stringSchema(), verifierId: stringSchema(), artifactRef: stringSchema(), parameters: { type: "object" } }, ["checkId", "verifierId", "artifactRef"]) } }, ["projectPath", "runId", "suiteId", "fixtureId", "receiptId", "checks"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_benchmark_trial",
    description: "Record one lineage-backed benchmark trial with verifier evidence, expert-rubric evidence, cost, latency, and fail-closed acceptance.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), trialId: stringSchema(), suiteId: stringSchema(), fixtureId: stringSchema(), lineageBindingIds: { type: "array", minItems: 1, items: stringSchema() }, outputArtifactRefs: { type: "array", minItems: 1, items: stringSchema() }, verifierReceiptId: stringSchema(), rubricScores: { type: "array", items: objectSchema({ dimensionId: stringSchema(), score: { type: "number", minimum: 0, maximum: 1 }, evidenceRefs: { type: "array", minItems: 1, items: stringSchema() } }, ["dimensionId", "score", "evidenceRefs"]) }, actualCost: { type: "number", minimum: 0 }, latencyMs: { type: "number", minimum: 0 } }, ["projectPath", "runId", "trialId", "suiteId", "fixtureId", "lineageBindingIds", "outputArtifactRefs", "verifierReceiptId", "rubricScores", "actualCost", "latencyMs"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_benchmark_report",
    description: "Compile repeated Video Agent trials into pass rate, quality, cost, latency, and an explicit baseline regression gate without changing the approved production route.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), suiteId: stringSchema(), reportId: stringSchema(), minimumTrials: { type: "integer", minimum: 1 }, regressionTolerance: { type: "number", minimum: 0, maximum: 1 }, maxConfidenceWidth: { type: "number", exclusiveMinimum: 0, maximum: 1 }, baselineId: stringSchema() }, ["projectPath", "runId", "suiteId", "reportId", "minimumTrials", "regressionTolerance", "maxConfidenceWidth"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_export_observability_trace",
    description: "Export low-sensitive Director X execution and benchmark telemetry as OTLP JSON-compatible resourceSpans without prompts, model content, or credentials.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), pluginVersion: stringSchema() }, ["projectPath", "runId", "pluginVersion"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_get_benchmark_baselines",
    description: "Read the project-scoped active benchmark baselines and immutable revision history shared across Director X Runs.",
    inputSchema: objectSchema({ projectPath: stringSchema() }, ["projectPath"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_promote_benchmark_baseline",
    description: "Promote a sufficiently precise non-regressed benchmark report into the project baseline store after Codex request_user_input confirmation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), interactionRequestId: stringSchema(), reportId: stringSchema(), confirmedBy: { enum: ["request_user_input"], type: "string" }, note: stringSchema() }, ["projectPath", "runId", "interactionRequestId", "reportId", "confirmedBy", "note"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_revoke_benchmark_baseline",
    description: "Revoke an active project benchmark baseline after Codex request_user_input confirmation while preserving its revision history.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), interactionRequestId: stringSchema(), suiteId: stringSchema(), confirmedBy: { enum: ["request_user_input"], type: "string" }, note: stringSchema() }, ["projectPath", "runId", "interactionRequestId", "suiteId", "confirmedBy", "note"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_claim_proof_map",
    description: "Compile script claims into an evidence-gated claim-to-proof map. Factual claims require visible or audible proof, named shots, and durable source evidence before Script may complete.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      mapId: stringSchema(),
      scriptArtifactRef: { type: "string" },
      claims: {
        type: "array",
        minItems: 1,
        items: objectSchema({
          claimId: stringSchema(),
          claimType: { enum: ["factual", "vision", "opinion"], type: "string" },
          text: stringSchema(),
          lineIds: { type: "array", items: stringSchema() },
          disclosure: { type: "string" },
          proofItems: {
            type: "array",
            items: objectSchema({
              shotId: stringSchema(),
              proofType: stringSchema(),
              visualEvidence: stringSchema(),
              sourceEvidenceRefs: { type: "array", items: stringSchema() }
            }, ["shotId", "proofType", "visualEvidence", "sourceEvidenceRefs"])
          }
        }, ["claimId", "claimType", "text", "lineIds", "proofItems"])
      }
    }, ["projectPath", "runId", "mapId", "claims"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_shot_grounding_plan",
    description: "Compile the mandatory per-shot research and visual-grounding plan. Named entities, logos, products, people, landmarks, exact text, factual claims, continuity-sensitive shots, user assets, and weak-model routes become explicit source, rights, quality, and fallback tasks bound to the real shotlist hash.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      planId: stringSchema(),
      sequenceId: stringSchema(),
      shots: {
        type: "array",
        minItems: 1,
        items: objectSchema({
          shotId: stringSchema(),
          order: { type: "integer", minimum: 1 },
          purpose: stringSchema(),
          visualDescription: stringSchema(),
          durationSeconds: { type: "number", exclusiveMinimum: 0 },
          generationMode: { type: "string" },
          modelTier: { enum: ["weak", "standard", "strong"], type: "string" },
          namedEntities: {
            type: "array",
            items: objectSchema({
              entityId: stringSchema(),
              name: stringSchema(),
              kind: { enum: ["logo", "product", "person", "landmark", "location", "action", "style", "foreign_text", "interface", "fact"], type: "string" }
            }, ["entityId", "name", "kind"])
          },
          exactText: { type: "array", items: stringSchema() },
          factualClaimIds: { type: "array", items: stringSchema() },
          userAssetRefs: { type: "array", items: stringSchema() },
          continuitySensitive: { type: "boolean" }
        }, ["shotId", "purpose", "durationSeconds"])
      }
    }, ["projectPath", "runId", "planId", "sequenceId", "shots"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_finalize_shot_grounding",
    description: "Finalize per-shot grounding only from registered evidence. Reference-only media may inform transfer rules; generation anchors and delivery assets require local files, compatible rights, and a ready DX-Asset-Manager quality audit.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      planId: stringSchema(),
      reportId: stringSchema(),
      resolutions: {
        type: "array",
        items: objectSchema({
          taskId: stringSchema(),
          status: { enum: ["resolved", "fallback_generated", "blocked"], type: "string" },
          assetRefs: { type: "array", items: stringSchema() },
          evidenceRefs: { type: "array", items: stringSchema() },
          transferRule: stringSchema(),
          rightsUse: { enum: ["fact_only", "reference_only", "generation_anchor", "delivery_asset"], type: "string" },
          notes: { type: "string" }
        }, ["taskId", "status", "assetRefs", "evidenceRefs", "transferRule", "rightsUse"])
      }
    }, ["projectPath", "runId", "planId", "reportId", "resolutions"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_visual_prompt_pack",
    description: "Compile model-specific, modality-isolated image/video prompts only after a ready per-shot grounding report. Text-to-image, image editing, text-to-video, image-to-video, and first/last-frame video each enforce their own inputs, audio responsibilities, exact-text policy, authorized generation anchors, and repair targets.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      packId: stringSchema(),
      directorContractRef: { type: "string" },
      claimProofMapRef: { type: "string" },
      routes: {
        type: "array",
        minItems: 1,
        items: objectSchema({
          routeId: stringSchema(),
          providerId: stringSchema(),
          modelId: stringSchema(),
          mode: { enum: ["text_to_image", "image_edit", "text_to_video", "image_to_video", "first_last_frame_video", "video_extension"], type: "string" },
          officialDocUrl: stringSchema(),
          researchedAt: { type: "string" },
          modelVersion: { type: "string" },
          negativePromptPolicy: { enum: ["positive_constraints", "separate_negative_prompt", "inline_prohibitions"], type: "string" },
          supportsFirstFrame: { type: "boolean" },
          supportsLastFrame: { type: "boolean" },
          supportsNegativePrompt: { type: "boolean" },
          supportsExactText: { type: "boolean" },
          supportsAudio: { type: "boolean" },
          allowMultiRoleReferences: { type: "boolean" }
        }, ["routeId", "providerId", "modelId", "mode", "officialDocUrl", "negativePromptPolicy"])
      },
      shots: {
        type: "array",
        minItems: 1,
        items: objectSchema({
          shotId: stringSchema(),
          routeId: stringSchema(),
          purpose: stringSchema(),
          durationSeconds: { type: "number", exclusiveMinimum: 0 },
          subject: stringSchema(),
          action: stringSchema(),
          setting: stringSchema(),
          camera: stringSchema(),
          lighting: stringSchema(),
          composition: stringSchema(),
          style: stringSchema(),
          motion: { type: "string" },
          viewerChange: { type: "string" },
          screenDirection: { enum: ["left_to_right", "right_to_left", "toward_camera", "away_camera", "neutral"], type: "string" },
          lightingDirection: { type: "string" },
          cameraMovement: objectSchema({
            type: stringSchema(),
            motivation: stringSchema(),
            vector: { type: "string" },
            speed: { type: "string" },
            easing: { type: "string" }
          }, ["type", "motivation"]),
          actionBeats: { type: "array", items: objectSchema({ atSeconds: { type: "number", minimum: 0 }, action: stringSchema() }, ["atSeconds", "action"]) },
          startState: { type: "object" },
          endState: { anyOf: [{ type: "string" }, { type: "object" }] },
          transitionPath: { type: "string" },
          pathFeasibility: { enum: ["pass", "bridge_required", "split_required"], type: "string" },
          editInstruction: { type: "string" },
          firstFrameRef: { type: "string" },
          lastFrameRef: { type: "string" },
          referenceAssetRefs: { type: "array", items: stringSchema() },
          referenceBindings: { type: "array", items: objectSchema({
            assetRef: stringSchema(), role: { enum: ["identity", "product_geometry", "layout", "pose", "style", "palette", "lighting"], type: "string" },
            preserve: { type: "array", items: stringSchema() }, mutable: { type: "array", items: stringSchema() }
          }, ["assetRef", "role"]) },
          continuityKeys: { type: "array", items: stringSchema() },
          negativeConstraints: { type: "array", items: stringSchema() },
          exactText: { type: "array", items: stringSchema() },
          reviewCriteria: { type: "array", items: stringSchema() },
          audioResponsibility: objectSchema({
            speech: { enum: ["provider", "external_or_none"], type: "string" },
            music: { enum: ["provider", "external_or_none"], type: "string" },
            ambience: { enum: ["provider", "provider_optional", "external_or_none"], type: "string" }
          })
        }, ["shotId", "routeId", "purpose", "durationSeconds", "subject", "action", "setting", "camera", "lighting", "composition", "style"])
      }
    }, ["projectPath", "runId", "packId", "routes", "shots"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_subagent",
    description: "Bind a Codex-spawned host agent to its canonical DX-prefixed Director X production identity. Native dx_* roles preserve the host nickname; built-in compatibility hosts retain their raw nickname only as trace metadata.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), roleId: stringSchema(), displayName: stringSchema(), hostAgentId: stringSchema(), hostNickname: stringSchema(), stage: stringSchema(), mission: stringSchema(), inputArtifactRefs: { type: "array", items: stringSchema() }, outputArtifactRefs: { type: "array", items: stringSchema() }, status: { enum: ["pending", "running", "blocked", "complete", "failed"], type: "string" } }, ["projectPath", "runId", "roleId", "displayName", "hostAgentId", "hostNickname", "stage", "mission"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_plan_production_complexity",
    description: "Choose a quick, standard, or complex Director X execution profile from real duration, shot, continuity, reference, modality, and delivery constraints. Speed settings never weaken approvals, pricing evidence, Director.md, or final full-frame audit.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), durationSeconds: { type: "number", exclusiveMinimum: 0 },
      shotCount: { type: "integer", minimum: 1, maximum: 500 }, segmentCount: { type: "integer", minimum: 1, maximum: 500 },
      referenceVideoCount: { type: "integer", minimum: 0, maximum: 100 }, modalities: { type: "array", minItems: 1, items: { enum: ["image", "video", "voice", "music", "screen", "avatar", "live_action"], type: "string" } },
      characterContinuity: { type: "boolean" }, deliveryTier: { enum: ["preview", "review", "publish"], type: "string" }
    }, ["projectPath", "runId", "durationSeconds", "shotCount", "modalities", "characterContinuity", "deliveryTier"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_prepare_fast_start_intake",
    description: "Preferred atomic minimum-Intake compiler. After Goal, run-mode confirmation, and any required native Intake answer, select the pipeline and durably write/register intake confirmation, intent resolution, Director.md, its contract, project brief, delivery promise, and complexity plan in one Run update. Budget and provider approvals remain separate hard gates.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), pipelineId: stringSchema(), interactionRequestId: { type: "string" },
      intake: objectSchema({
        decisions: { type: "array", minItems: 6, items: objectSchema({ field: { enum: ["objective", "audience", "platform", "duration", "production_route", "asset_readiness"], type: "string" }, value: stringSchema(), source: { enum: ["brief", "user", "safe_inference"], type: "string" }, rationale: stringSchema() }, ["field", "value", "source", "rationale"]) },
        questionsAsked: { type: "array", items: stringSchema() }, userAnswers: { type: "array", items: stringSchema() }
      }, ["decisions", "questionsAsked", "userAnswers"]),
      resolution: objectSchema({
        clarity: { enum: ["clear", "clarified"], type: "string" }, rawIntent: stringSchema(), resolvedIntent: stringSchema(), directorPrompt: stringSchema(),
        questionsAsked: { type: "array", items: stringSchema() }, userAnswers: { type: "array", items: stringSchema() }, safeInferences: { type: "array", items: stringSchema() }, unresolvedRisks: { type: "array", items: stringSchema() }
      }, ["clarity", "rawIntent", "resolvedIntent", "directorPrompt", "questionsAsked", "userAnswers", "safeInferences", "unresolvedRisks"]),
      director: objectSchema({
        title: stringSchema(), logline: stringSchema(), audience: stringSchema(), platform: stringSchema(), duration: stringSchema(), aspectRatio: stringSchema(), objective: stringSchema(),
        directorInterpretation: stringSchema(), hook: stringSchema(), beatProgression: stringSchema(), visualLanguage: stringSchema(), cameraGrammar: stringSchema(), composition: stringSchema(), lightingColor: stringSchema(), performanceDirection: stringSchema(), audioDirection: stringSchema(), musicDirection: stringSchema(), editRhythm: stringSchema(), promptStrategy: stringSchema(), researchPlan: stringSchema(),
        styleThesis: { type: "string" }, worldBehavior: { type: "string" }, textureMaterial: { type: "string" }, typographyGraphics: { type: "string" }, temporalGrammar: { type: "string" },
        continuityAnchors: { type: "array", items: stringSchema() }, negativeRules: { type: "array", items: stringSchema() }, reviewCriteria: { type: "array", items: stringSchema() }, approvalBoundaries: { type: "array", items: stringSchema() }
      }, ["title", "logline", "audience", "platform", "duration", "aspectRatio", "objective", "directorInterpretation", "hook", "beatProgression", "visualLanguage", "cameraGrammar", "composition", "lightingColor", "performanceDirection", "audioDirection", "musicDirection", "editRhythm", "promptStrategy", "researchPlan", "continuityAnchors", "negativeRules", "reviewCriteria", "approvalBoundaries"]),
      production: objectSchema({
        videoType: stringSchema(), budgetCap: objectSchema({ currency: stringSchema(), amount: { type: "number", minimum: 0 } }, ["currency", "amount"]), durationSeconds: { type: "number", exclusiveMinimum: 0 }, qualityTarget: stringSchema(),
        shotCount: { type: "integer", minimum: 1, maximum: 500 }, segmentCount: { type: "integer", minimum: 1, maximum: 500 }, referenceVideoCount: { type: "integer", minimum: 0, maximum: 100 },
        modalities: { type: "array", minItems: 1, items: { enum: ["image", "video", "voice", "music", "screen", "avatar", "live_action"], type: "string" } }, characterContinuity: { type: "boolean" }, deliveryTier: { enum: ["preview", "review", "publish"], type: "string" }
      }, ["videoType", "budgetCap", "durationSeconds", "qualityTarget", "shotCount", "modalities", "characterContinuity", "deliveryTier"]),
      delivery: objectSchema({
        promise: stringSchema(), primaryViewerOutcome: stringSchema(), minimumFinalScore: { type: "number", minimum: 0, maximum: 1 }, minimumShotScore: { type: "number", minimum: 0, maximum: 1 },
        requiredArtifacts: { type: "array", minItems: 1, items: stringSchema() }, requiredTracks: { type: "array", minItems: 1, items: stringSchema() }
      }, ["promise", "primaryViewerOutcome", "minimumFinalScore", "minimumShotScore", "requiredArtifacts", "requiredTracks"])
    }, ["projectPath", "runId", "pipelineId", "intake", "resolution", "director", "production", "delivery"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_get_fast_start_status",
    description: "Return the minimum production blockers and the five-minute creative-output SLA without requiring deferred governance artifacts.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema() }, ["projectPath", "runId"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_begin_reference_research",
    description: "Start the reference-first production lane after minimum Intake. This begins authorized reference download, audio extraction, video understanding, asset search, and first-script work without waiting for paid provider or Key approvals; those remain hard gates for Generation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema() }, ["projectPath", "runId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_get_recovery_action",
    description: "Return only the blocked operation, root cause, corrected example, unique resume action, and artifact-preservation guarantee.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema() }, ["projectPath", "runId"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_begin_creative_work",
    description: "Complete minimal Intake and immediately enter Research once Goal, essential routes, budget, consent, and required Intake artifacts are ready. Deferred governance moves to Generation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema() }, ["projectPath", "runId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_query_director_knowledge",
    description: "Retrieve evidence-grounded filmmaking tutorials, official model guidance, camera grammar, and deterministic rendering practices from the bundled Director X knowledge library. Returns transfer rules and rights boundaries, never source media for reuse.",
    inputSchema: objectSchema({
      projectPath: { type: "string" },
      text: { type: "string" },
      topics: { type: "array", items: stringSchema() },
      modelModes: { type: "array", items: stringSchema() },
      shotFunctions: { type: "array", items: stringSchema() },
      limit: { type: "integer", minimum: 1, maximum: 20 }
    }),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_query_cinematic_references",
    description: "Retrieve rights-bounded finished-film, behind-the-scenes, tutorial, and Remotion showcase references by video type, platform, shot function, or composition technique. Returns transferable structure and shot/audio grammar only; timecoded replication still requires native consent and bounded local ingest.",
    inputSchema: objectSchema({
      text: { type: "string" },
      videoTypes: { type: "array", items: stringSchema() },
      platforms: { type: "array", items: stringSchema() },
      shotFunctions: { type: "array", items: stringSchema() },
      remotionTechniques: { type: "array", items: stringSchema() },
      limit: { type: "integer", minimum: 1, maximum: 12 }
    }),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_compile_cinematic_reference_selection",
    description: "Compile selected rights-bounded film references into a durable research document whose transfer rules bind Director.md, script, shot planning, audio grammar, and Remotion composition without importing source media.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      selectionId: stringSchema(),
      videoType: stringSchema(),
      platform: { type: "string" },
      selectedReferenceIds: { type: "array", minItems: 1, maxItems: 12, items: stringSchema() },
      requiredShotFunctions: { type: "array", minItems: 1, items: stringSchema() },
      remotionRequired: { type: "boolean" }
    }, ["projectPath", "runId", "selectionId", "videoType", "selectedReferenceIds", "requiredShotFunctions", "remotionRequired"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_reference_learning_candidate",
    description: "Compile DX-reviewed, timecoded, all-frame reference evidence into an originality-safe directing knowledge candidate. The result remains awaiting native approval and cannot reuse source media.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), candidateId: stringSchema(), referenceId: stringSchema(), title: stringSchema(),
      reviewerId: { const: "DX-Reference-Analyst", type: "string" },
      topics: { type: "array", minItems: 1, items: stringSchema() },
      modelModes: { type: "array", items: stringSchema() },
      shotFunctions: { type: "array", minItems: 1, items: stringSchema() },
      blockedReuse: { type: "array", minItems: 1, items: stringSchema() },
      antiPatterns: { type: "array", items: stringSchema() },
      observations: { type: "array", minItems: 1, items: objectSchema({
        principleId: stringSchema(), startSeconds: { type: "number", minimum: 0 }, endSeconds: { type: "number", exclusiveMinimum: 0 },
        evidenceFrameIndices: { type: "array", minItems: 2, items: { type: "integer", minimum: 0 } },
        claim: stringSchema(), transferRule: stringSchema(), originalityRule: stringSchema(),
        appliesTo: { type: "array", minItems: 1, items: stringSchema() }
      }, ["principleId", "startSeconds", "endSeconds", "evidenceFrameIndices", "claim", "transferRule", "originalityRule", "appliesTo"]) }
    }, ["projectPath", "runId", "candidateId", "referenceId", "title", "reviewerId", "topics", "shotFunctions", "blockedReuse", "observations"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_promote_reference_learning",
    description: "Promote an approved reference-learning candidate into the project Director knowledge library only after the matching Codex request_user_input knowledge decision.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), candidateId: stringSchema(), interactionRequestId: stringSchema(),
      confirmedBy: { const: "request_user_input", type: "string" }
    }, ["projectPath", "runId", "candidateId", "interactionRequestId", "confirmedBy"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_plan_production_team",
    description: "RECOMMENDED Director X delegation path. Compile the registered execution graph and production-complexity profile into a bounded canonical DX production team, then return directly executable concurrent spawn_agent host actions. This removes hand-authored task arrays and blocks overstaffed or fake-parallel plans.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), planId: stringSchema(), objective: stringSchema(), availableAgentTypes: { type: "array", minItems: 1, items: stringSchema() }, hostConcurrencyLimit: { type: "integer", minimum: 2, maximum: 32 },
      stages: { type: "array", minItems: 1, items: { enum: ["intake", "research", "script", "storyboard", "generation", "edit", "review", "delivery"], type: "string" } },
      currency: { type: "string", minLength: 3, maxLength: 8 }
    }, ["projectPath", "runId", "planId", "objective", "availableAgentTypes"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_plan_parallel_subagents",
    description: "MANDATORY before Director X delegation. Compile dependency-layered parallel work into the current Codex spawn_agent contract: typed agent_type hosts or task_name/fork_turns collaboration hosts. Preserve canonical DX identities, bounded prompts, artifact ownership, and synchronization barriers.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), planId: stringSchema(), objective: stringSchema(), availableAgentTypes: { type: "array", minItems: 1, items: stringSchema() }, hostConcurrencyLimit: { type: "integer", minimum: 2, maximum: 32 },
      tasks: { type: "array", minItems: 2, items: objectSchema({
        taskId: stringSchema(), roleId: stringSchema(), stage: stringSchema(), mission: stringSchema(),
        inputArtifactRefs: { type: "array", items: stringSchema() }, outputArtifactRefs: { type: "array", minItems: 1, items: stringSchema() }, dependsOnTaskIds: { type: "array", items: stringSchema() },
        allowedTools: { type: "array", minItems: 1, items: stringSchema() }, restrictedTools: { type: "array", items: stringSchema() },
        stopCondition: stringSchema(), escalationTriggers: { type: "array", minItems: 1, items: stringSchema() },
        maxAttempts: { type: "integer", minimum: 1 }, maxCost: { type: "number", minimum: 0 }, currency: stringSchema(), approvalBoundary: stringSchema()
      }, ["taskId", "roleId", "stage", "mission", "inputArtifactRefs", "outputArtifactRefs", "dependsOnTaskIds", "allowedTools", "restrictedTools", "stopCondition", "escalationTriggers", "maxAttempts", "maxCost", "currency", "approvalBoundary"]) }
    }, ["projectPath", "runId", "planId", "objective", "availableAgentTypes", "tasks"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_update_subagent",
    description: "Update a registered DX-prefixed subagent status and artifact handoff evidence.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), displayName: stringSchema(), status: { enum: ["pending", "running", "blocked", "complete", "failed"], type: "string" }, detail: stringSchema(), outputArtifactRefs: { type: "array", items: stringSchema() }, hostRelease: objectSchema({ hostAgentId: stringSchema(), closedBy: { const: "close_agent", type: "string" }, hostCloseStatus: { const: "closed", type: "string" } }, ["hostAgentId", "closedBy", "hostCloseStatus"]) }, ["projectPath", "runId", "displayName", "status", "detail"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_confirm_subagent_host_closed",
    description: "Confirm that Codex close_agent released a terminal DX subagent host. The canonical DX production identity remains stable even when Codex retains an ordinal host nickname in session history.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), displayName: stringSchema(), hostAgentId: stringSchema(), closedBy: { const: "close_agent", type: "string" }, hostCloseStatus: { const: "closed", type: "string" } }, ["projectPath", "runId", "displayName", "hostAgentId", "closedBy", "hostCloseStatus"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_configure_run_mode",
    description: "Persist the user-confirmed Director X autonomy mode: guided autonomy, per-stage approval, or full automation within hard approval gates.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), mode: { enum: RUN_MODES, type: "string" }, confirmedBy: { enum: ["request_user_input"], type: "string" }, interactionRequestId: stringSchema() }, ["projectPath", "runId", "mode", "confirmedBy", "interactionRequestId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_approve_stage",
    description: "Record a Codex request_user_input approval for one pipeline stage when the Run uses stage-approval mode.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), stageId: stringSchema(), confirmedBy: { enum: ["request_user_input"], type: "string" }, interactionRequestId: stringSchema(), note: stringSchema() }, ["projectPath", "runId", "stageId", "confirmedBy", "interactionRequestId", "note"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_checkpoint_run",
    description: "Write a durable checkpoint_replay.json snapshot for partial progress, approval wait, recovery, or a significant non-stage operation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), reason: stringSchema(), detail: stringSchema() }, ["projectPath", "runId", "reason", "detail"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_recover_run",
    description: "Clear a deterministic Director X recovery gate after writing a durable checkpoint, so the corrected failed operation can be retried without creating a replacement Run.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), recoveryAction: { enum: ["write_checkpoint_and_retry", "retry_corrected_arguments"], type: "string" }, detail: stringSchema() }, ["projectPath", "runId", "recoveryAction", "detail"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_resume_run",
    description: "Resume a durable Director X Run from its latest checkpoint and return the exact stage, blockers, approvals, artifacts, and event cursor.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema() }, ["projectPath", "runId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_select_pipeline",
    description: "Select exactly one production pipeline for a durable Director X run before production work begins.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), pipelineId: stringSchema() }, ["projectPath", "runId", "pipelineId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_execution_graph",
    description: "Register or revise a capability-filtered acyclic execution graph that maps resolved video intent to DX agents, tools, review gates, artifact handoffs, and canvas progress.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), graph: objectSchema({ graphId: stringSchema(), revision: { type: "integer", minimum: 1 }, supersedesGraphId: { type: "string" }, intentSummary: stringSchema(), selectedCapabilities: { type: "array", minItems: 1, items: stringSchema() }, nodes: { type: "array", minItems: 1, items: objectSchema({ nodeId: stringSchema(), kind: { enum: ["agent", "tool", "review", "approval"], type: "string" }, stage: stringSchema(), label: stringSchema(), owner: stringSchema(), capability: stringSchema(), dependsOn: { type: "array", items: stringSchema() }, inputArtifactRefs: { type: "array", items: stringSchema() }, outputArtifactRefs: { type: "array", items: stringSchema() }, config: { type: "object" } }, ["nodeId", "kind", "stage", "label", "owner", "capability", "dependsOn", "inputArtifactRefs", "outputArtifactRefs"]) } }, ["graphId", "revision", "intentSummary", "selectedCapabilities", "nodes"]) }, ["projectPath", "runId", "graph"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_transition_execution_node",
    description: "Transition one execution-graph node with dependency enforcement and registered output-artifact evidence.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), nodeId: stringSchema(), status: { enum: ["running", "blocked", "failed", "complete"], type: "string" }, detail: stringSchema(), evidenceRefs: { type: "array", items: stringSchema() } }, ["projectPath", "runId", "nodeId", "status", "detail", "evidenceRefs"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_transition_stage",
    description: "Begin, block, fail, or complete a pipeline stage with ordering, approval, and evidence enforcement.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), stageId: stringSchema(),
      action: { enum: ["begin", "block", "fail", "complete"], type: "string" },
      detail: stringSchema(), evidenceRefs: { type: "array", items: stringSchema() }
    }, ["projectPath", "runId", "stageId", "action", "detail"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_bind_goal",
    description: "Bind an already-created Codex Goal ID to a Director X production run.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), codexGoalId: stringSchema() }, ["projectPath", "runId", "codexGoalId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_confirm_intake",
    description: "Record the required production decisions after asking the user all strategy-changing questions. Platform, production route, and asset readiness cannot be silently inferred.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), interactionRequestId: stringSchema(), intake: objectSchema({
      decisions: { type: "array", minItems: 6, items: objectSchema({ field: { enum: ["objective", "audience", "platform", "duration", "production_route", "asset_readiness"], type: "string" }, value: stringSchema(), source: { enum: ["brief", "user", "safe_inference"], type: "string" }, rationale: stringSchema() }, ["field", "value", "source", "rationale"]) },
      questionsAsked: { type: "array", items: stringSchema() }, userAnswers: { type: "array", items: stringSchema() }
    }, ["decisions", "questionsAsked", "userAnswers"]) }, ["projectPath", "runId", "intake"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_intent_resolution",
    description: "Persist the ambiguity assessment, necessary user answers, safe inferences, and director-polished task prompt before production starts.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), interactionRequestId: stringSchema(), resolution: objectSchema({
      clarity: { enum: ["clear", "clarified"], type: "string" }, rawIntent: stringSchema(), resolvedIntent: stringSchema(), directorPrompt: stringSchema(),
      questionsAsked: { type: "array", items: stringSchema() }, userAnswers: { type: "array", items: stringSchema() }, safeInferences: { type: "array", items: stringSchema() }, unresolvedRisks: { type: "array", items: stringSchema() }
    }, ["clarity", "rawIntent", "resolvedIntent", "directorPrompt", "questionsAsked", "userAnswers", "safeInferences", "unresolvedRisks"]) }, ["projectPath", "runId", "resolution"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_write_director_document",
    description: "Generate or update the project-level Director.md source of truth. For reference-replication, call only after the authorized video/audio bundle and replication plan are complete; bind the replacement strategy, shot blueprint, continuity, audio, and review rules.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), director: objectSchema({
      title: stringSchema(), logline: stringSchema(), audience: stringSchema(), platform: stringSchema(), duration: stringSchema(), aspectRatio: stringSchema(), objective: stringSchema(),
      directorInterpretation: stringSchema(), hook: stringSchema(), beatProgression: stringSchema(), visualLanguage: stringSchema(), cameraGrammar: stringSchema(), composition: stringSchema(), lightingColor: stringSchema(), performanceDirection: stringSchema(), audioDirection: stringSchema(), musicDirection: stringSchema(), editRhythm: stringSchema(), promptStrategy: stringSchema(), researchPlan: stringSchema(),
      styleThesis: { type: "string" }, worldBehavior: { type: "string" }, textureMaterial: { type: "string" }, typographyGraphics: { type: "string" }, temporalGrammar: { type: "string" },
      continuityAnchors: { type: "array", items: stringSchema() }, negativeRules: { type: "array", items: stringSchema() }, reviewCriteria: { type: "array", items: stringSchema() }, approvalBoundaries: { type: "array", items: stringSchema() }
    }, ["title", "logline", "audience", "platform", "duration", "aspectRatio", "objective", "directorInterpretation", "hook", "beatProgression", "visualLanguage", "cameraGrammar", "composition", "lightingColor", "performanceDirection", "audioDirection", "musicDirection", "editRhythm", "promptStrategy", "researchPlan", "continuityAnchors", "negativeRules", "reviewCriteria", "approvalBoundaries"]) }, ["projectPath", "runId", "director"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_asset_search_plan",
    description: "Before web research, register an official-first search plan that explicitly covers public-domain and licensed image/video libraries, source scopes, quality thresholds, rights preferences, and stop conditions. The host must then execute real search/open actions.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), plan: objectSchema({ planId: stringSchema(), objective: stringSchema(), requiredAssetTypes: { type: "array", minItems: 1, items: { type: "string", enum: ["company_logo", "product_interface", "product_image", "landmark", "office", "team", "stock_image", "stock_video", "reference_video", "audio_reference", "background_music", "sound_effect"] } }, sourcePriority: { type: "array", minItems: 3, items: { type: "string", enum: ["official", "authoritative", "public_domain", "licensed_stock", "platform", "community"] } }, queries: { type: "array", minItems: 1, items: objectSchema({ queryId: stringSchema(), query: stringSchema(), assetType: { type: "string", enum: ["company_logo", "product_interface", "product_image", "landmark", "office", "team", "stock_image", "stock_video", "reference_video", "audio_reference", "background_music", "sound_effect"] }, sourceScopes: { type: "array", minItems: 1, items: { type: "string", enum: ["official", "authoritative", "public_domain", "licensed_stock", "platform", "community"] } }, purpose: stringSchema() }, ["queryId", "query", "assetType", "sourceScopes", "purpose"]) }, selectionCriteria: objectSchema({ minimumRelevance: { type: "number", minimum: 0, maximum: 1 }, minimumVisualQuality: { type: "number", minimum: 0, maximum: 1 }, minimumWidth: { type: "integer", minimum: 1 }, minimumHeight: { type: "integer", minimum: 1 }, rightsPreference: { type: "array", minItems: 1, items: stringSchema() } }, ["minimumRelevance", "minimumVisualQuality", "minimumWidth", "minimumHeight", "rightsPreference"]), stopConditions: { type: "array", minItems: 1, items: stringSchema() } }, ["planId", "objective", "requiredAssetTypes", "sourcePriority", "queries", "selectionCriteria", "stopConditions"]) }, ["projectPath", "runId", "plan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_reference_download_consent",
    description: "Record the user's scoped request_user_input decision before any yt-dlp reference download. This is an authorization gate, not a rights grant.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), interactionRequestId: stringSchema(), consent: objectSchema({
      decision: { enum: ["authorized", "declined"], type: "string" }, confirmationMethod: { enum: ["request_user_input"], type: "string" }, purpose: { enum: ["local_reference_analysis"], type: "string" },
      referenceIds: { type: "array", minItems: 1, items: stringSchema() }, sourceUrls: { type: "array", minItems: 1, items: stringSchema() }, retentionPolicy: stringSchema(), userFacingNotice: stringSchema()
    }, ["decision", "confirmationMethod", "purpose", "referenceIds", "sourceUrls", "retentionPolicy", "userFacingNotice"]) }, ["projectPath", "runId", "interactionRequestId", "consent"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_ingest_reference_video",
    description: "Use yt-dlp, FFprobe, and FFmpeg to ingest an explicitly authorized reference section or complete video, extract every decoded frame plus audio, and verify frame-count parity. Reference media is never a delivery asset without separate reuse rights.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), url: stringSchema(), referenceId: stringSchema(), downloadAuthorized: { type: "boolean" }, rightsStatus: { enum: ["user_owned", "licensed", "public_domain", "reference_only"], type: "string" }, fullReference: { type: "boolean" }, startSeconds: { type: "number", minimum: 0 }, maxSeconds: { type: "number", minimum: 3, maximum: 3600 }, maxFrames: { type: "integer", minimum: 90, maximum: 3600 }, timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 } }, ["projectPath", "runId", "url", "referenceId", "downloadAuthorized", "rightsStatus"]),
    annotations: { ...writeAnnotations(), openWorldHint: true }
  },
  {
    name: "directorx_read_video",
    description: "Read a project-contained local video or an already authorized reference clip with adaptive keyframe, scene, transcript-cue, or exhaustive full-frame evidence. Produces timestamped frames, a contact sheet, transcript evidence, and durable Run/canvas artifacts. URL sources must first pass the reference-download consent and ingest tools.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), readId: stringSchema(),
      videoPath: { type: "string" }, sourceArtifactRef: { type: "string" },
      transcriptPath: { type: "string" }, transcriptArtifactRef: { type: "string" },
      profile: { type: "string", enum: VIDEO_READ_PROFILES },
      startSeconds: { type: "number", minimum: 0 }, endSeconds: { type: "number", exclusiveMinimum: 0 },
      cueTimestamps: { type: "array", maxItems: 100, items: { type: "number", minimum: 0 } },
      fps: { type: "number", exclusiveMinimum: 0, maximum: 2 },
      maxFrames: { type: "integer", minimum: 0, maximum: 3600 }, resolution: { type: "integer", minimum: 160, maximum: 1920 },
      deduplicate: { type: "boolean" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 }
    }, ["projectPath", "runId", "readId", "profile"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_reference_replication_plan",
    description: "Convert one fully extracted reference into an evidence-bound, originality-safe shot blueprint and exact tool route for recreating its function, pacing, camera language, audio energy, and edit structure.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), planId: stringSchema(), referenceId: stringSchema(), reviewerId: { const: "DX-Reference-Analyst", type: "string" }, reuseAuthorized: { type: "boolean" },
      target: objectSchema({ title: stringSchema(), durationSeconds: { type: "number", exclusiveMinimum: 0 }, aspectRatio: stringSchema(), platform: stringSchema(), objective: stringSchema() }, ["title", "durationSeconds", "aspectRatio", "platform", "objective"]),
      analysis: { type: "object" },
      adaptation: { type: "object" },
      shots: { type: "array", minItems: 1, items: { type: "object" } }
    }, ["projectPath", "runId", "planId", "referenceId", "reviewerId", "target", "analysis", "adaptation", "shots"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_web_research",
    description: "Verify and persist real current web research. Requires host search/open execution receipts, then performs an independent bounded HTTPS fetch and content hash for every source page.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), research: objectSchema({
      queries: { type: "array", minItems: 1, items: stringSchema() },
      executions: { type: "array", minItems: 2, items: objectSchema({ executionId: stringSchema(), tool: { enum: ["web.search_query", "web.open", "browser.search", "browser.open"], type: "string" }, action: { enum: ["search", "open"], type: "string" }, query: { type: "string" }, executedAt: stringSchema(), sourceIds: { type: "array", minItems: 1, items: stringSchema() } }, ["executionId", "tool", "action", "executedAt", "sourceIds"]) },
      sources: { type: "array", minItems: 1, items: objectSchema({ id: stringSchema(), url: stringSchema(), title: stringSchema(), sourceType: { enum: ["official", "authoritative", "licensed_stock", "public_domain", "editorial", "social", "reference"], type: "string" }, retrievedAt: stringSchema(), relevance: stringSchema(), rightsStatus: { enum: ["commercial_ok", "attribution", "reference_only", "unknown", "blocked"], type: "string" }, intendedUse: stringSchema(), licenseEvidence: { type: "string" }, previewUri: { type: "string" } }, ["id", "url", "title", "sourceType", "retrievedAt", "relevance", "rightsStatus", "intendedUse"]) },
      summary: stringSchema()
    }, ["queries", "executions", "sources", "summary"]) }, ["projectPath", "runId", "research"]),
    annotations: { ...writeAnnotations(), openWorldHint: true }
  },
  {
    name: "directorx_record_provider_api_research",
    description: "Persist a separate, non-clobbering official API documentation research receipt for one custom image/video provider. Uses the same search/open/source contract as web research and independently verifies every source URL.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), research: { type: "object" } }, ["projectPath", "runId", "research"]),
    annotations: { ...writeAnnotations(), openWorldHint: true }
  },
  {
    name: "directorx_record_reference_video_assessment",
    description: "Record whether external reference video is required, optional, or unnecessary and why before generation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), assessment: objectSchema({ decision: { enum: ["required", "optional", "not_needed"], type: "string" }, rationale: stringSchema(), searchQueries: { type: "array", items: stringSchema() }, selectedSourceIds: { type: "array", items: stringSchema() }, transferTargets: { type: "array", items: stringSchema() } }, ["decision", "rationale", "searchQueries", "selectedSourceIds", "transferTargets"]) }, ["projectPath", "runId", "assessment"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_media_evidence_index",
    description: "Register a source-hashed, rational-timebase hierarchy of multimodal video moments, observations, evidence refs, and analyzer lineage for shared Agent retrieval.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), index: objectSchema({ indexId: stringSchema(), source: objectSchema({ assetId: stringSchema(), uri: stringSchema(), sha256: stringSchema(), duration: objectSchema({ value: { type: "integer", minimum: 1 }, rate: { type: "integer", minimum: 1 } }, ["value", "rate"]) }, ["assetId", "uri", "sha256", "duration"]), timebase: objectSchema({ rate: objectSchema({ num: { type: "integer", minimum: 1 }, den: { type: "integer", minimum: 1 } }, ["num", "den"]), startTimecode: stringSchema() }, ["rate"]), levels: { type: "array", minItems: 1, items: objectSchema({ level: { enum: ["program", "sequence", "scene", "shot", "moment"], type: "string" }, nodes: { type: "array", items: objectSchema({ nodeId: stringSchema(), parentId: { type: "string" }, range: objectSchema({ start: objectSchema({ value: { type: "integer", minimum: 0 }, rate: { type: "integer", minimum: 1 } }, ["value", "rate"]), duration: objectSchema({ value: { type: "integer", minimum: 1 }, rate: { type: "integer", minimum: 1 } }, ["value", "rate"]) }, ["start", "duration"]), modalities: { type: "array", minItems: 1, items: stringSchema() }, observations: { type: "array", items: { type: "object" } }, evidenceRefs: { type: "array", items: stringSchema() }, embeddingRefs: { type: "array", items: stringSchema() } }, ["nodeId", "range", "modalities", "observations", "evidenceRefs"]) } }, ["level", "nodes"]) }, analyzers: { type: "array", minItems: 1, items: { type: "object" } } }, ["indexId", "source", "timebase", "levels", "analyzers"]) }, ["projectPath", "runId", "index"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_video_query_plan",
    description: "Register a bounded multimodal video evidence query with explicit information need, strategy, rights/shot constraints, budgets, and acceptance thresholds.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), plan: objectSchema({ queryId: stringSchema(), indexId: stringSchema(), question: stringSchema(), constraints: { type: "object" }, strategy: { type: "array", minItems: 1, items: stringSchema() }, budget: objectSchema({ maxRounds: { type: "integer", minimum: 1, maximum: 20 }, maxFrames: { type: "integer", minimum: 1, maximum: 500 }, maxDecodeSeconds: { type: "number", exclusiveMinimum: 0, maximum: 3600 }, maxCost: { type: "number", minimum: 0 } }, ["maxRounds", "maxFrames", "maxDecodeSeconds", "maxCost"]), acceptance: objectSchema({ minEvidenceCoverage: { type: "number", minimum: 0, maximum: 1 }, minTopScore: { type: "number", minimum: 0, maximum: 1 } }, ["minEvidenceCoverage", "minTopScore"]) }, ["queryId", "indexId", "question", "constraints", "strategy", "budget", "acceptance"]) }, ["projectPath", "runId", "plan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_search_video_evidence",
    description: "Run a bounded deterministic search over a registered video evidence index and persist ranked timestamped candidates for later multimodal inspection and retrieval-trace selection. This never turns a candidate into a production claim by itself.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), queryId: stringSchema(), searchId: stringSchema(), query: stringSchema(), constraints: { type: "object" }, level: { enum: ["program", "sequence", "scene", "shot", "moment"], type: "string" }, startSeconds: { type: "number", minimum: 0 }, endSeconds: { type: "number", exclusiveMinimum: 0 }, maxResults: { type: "integer", minimum: 1, maximum: 50 } }, ["projectPath", "runId", "queryId", "searchId", "query"]),
    annotations: { ...writeAnnotations(), readOnlyHint: false }
  },
  {
    name: "directorx_materialize_evidence_clip",
    description: "Materialize one selected retrieval-trace moment as a bounded, playable review-only clip. The source hash, selected node, rights state, time range, and receipt are preserved; the derivative is never delivery-eligible.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), sourceArtifactRef: stringSchema(), queryId: stringSchema(), nodeId: stringSchema(), clipId: stringSchema(), paddingSeconds: { type: "number", minimum: 0, maximum: 5 }, timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 } }, ["projectPath", "runId", "sourceArtifactRef", "queryId", "nodeId", "clipId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_video_retrieval_trace",
    description: "Record every bounded retrieval round, inspected evidence, cost/coverage delta, selected/rejected moments, conflicts, and an explicit stop reason.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), trace: objectSchema({ queryId: stringSchema(), rounds: { type: "array", minItems: 1, items: { type: "object" } }, selectedNodeIds: { type: "array", items: stringSchema() }, rejectedNodeIds: { type: "array", items: stringSchema() }, conflicts: { type: "array", items: { type: "object" } }, stopReason: { enum: ["evidence_sufficient", "budget_exhausted", "no_new_evidence", "user_decision_required"], type: "string" } }, ["queryId", "rounds", "selectedNodeIds", "rejectedNodeIds", "conflicts", "stopReason"]) }, ["projectPath", "runId", "trace"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_finalize_evidence_bundle",
    description: "Bind a production claim to selected source moments, evidence refs, contradictions, limitations, coverage, and rights status for downstream shots or edits.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), bundle: objectSchema({ bundleId: stringSchema(), queryId: stringSchema(), claim: stringSchema(), support: { type: "array", minItems: 1, items: { type: "object" } }, contradictions: { type: "array", items: { type: "object" } }, coverage: { type: "number", minimum: 0, maximum: 1 }, limitations: { type: "array", items: stringSchema() }, rightsStatus: stringSchema() }, ["bundleId", "queryId", "claim", "support", "contradictions", "coverage", "limitations", "rightsStatus"]) }, ["projectPath", "runId", "bundle"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_create_review_session",
    description: "Create one revisioned Review Session shared by media playback, A/B comparison, audio tracks, captions, waveform, markers, and canvas evidence navigation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), session: objectSchema({ reviewSessionId: stringSchema(), activeArtifactRef: stringSchema(), activeRevisionId: stringSchema(), projectRate: { type: "integer", minimum: 1, maximum: 120000 }, compareMode: { type: "string", enum: reviewCompareModes }, compareArtifactRefs: { type: "array", items: stringSchema() }, selectedAudioTrackIds: { type: "array", items: stringSchema() }, selectedCaptionTrackIds: { type: "array", items: stringSchema() } }, ["reviewSessionId", "activeArtifactRef", "activeRevisionId", "projectRate", "compareMode"]) }, ["projectPath", "runId", "session"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_update_review_transport",
    description: "Update the single optimistic-concurrency Review Transport used by every canvas media projection; this changes review runtime state, not production approval.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), update: objectSchema({ reviewSessionId: stringSchema(), expectedRevision: { type: "integer", minimum: 1 }, playhead: rationalTimeSchema(), playing: { type: "boolean" }, playbackRate: { type: "number", exclusiveMinimum: 0, maximum: 16 }, direction: { type: "integer", enum: [-1, 1] }, loopRange: { anyOf: [timeRangeSchema(), { type: "null" }] }, activeArtifactRef: { type: "string" }, compareMode: { type: "string", enum: reviewCompareModes }, compareArtifactRefs: { type: "array", items: stringSchema() } }, ["reviewSessionId", "expectedRevision", "playhead", "playing", "playbackRate", "direction"]) }, ["projectPath", "runId", "update"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_timeline_revision",
    description: "Register an immutable canonical timeline baseline or child revision with a verified content hash before planning edits.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), revision: objectSchema({ revisionId: stringSchema(), timelineId: stringSchema(), revision: { type: "integer", minimum: 0 }, parentRevisionId: { type: ["string", "null"] }, contentHash: stringSchema(), timeline: { type: "object" }, createdAt: stringSchema() }, ["revisionId", "timelineId", "revision", "parentRevisionId", "contentHash", "timeline", "createdAt"]) }, ["projectPath", "runId", "revision"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_export_timeline_interchange",
    description: "Export one registered canonical Revision through the executable lossless Director X JSON adapter, independently re-import it, and persist manifest, relink, loss, and round-trip evidence. OTIO/FCPXML/EDL are never claimed without their own executable adapter.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), revisionId: stringSchema() }, ["projectPath", "runId", "revisionId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_edit_intent",
    description: "Resolve an editing request against a versioned base timeline before any timeline mutation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), intent: objectSchema({ intentId: stringSchema(), baseTimelineRef: stringSchema(), baseRevision: { type: "integer", minimum: 0 }, baseContentHash: stringSchema(), explicitGoals: { type: "array", minItems: 1, items: stringSchema() }, inferredConstraints: { type: "array", items: stringSchema() }, requestedOperations: { type: "array", minItems: 1, items: { type: "string", enum: editOperations } }, risks: { type: "array", items: stringSchema() } }, ["intentId", "baseTimelineRef", "baseRevision", "baseContentHash", "explicitGoals", "inferredConstraints", "requestedOperations"]) }, ["projectPath", "runId", "intent"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_edit_graph",
    description: "Compile a sparse acyclic edit-tool graph with rational affected ranges and explicit artifact handoffs.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), graph: objectSchema({ graphId: stringSchema(), intentId: stringSchema(), baseTimelineRef: stringSchema(), baseRevision: { type: "integer", minimum: 0 }, nodes: { type: "array", minItems: 1, items: objectSchema({ nodeId: stringSchema(), operation: { type: "string", enum: editOperations }, dependsOn: { type: "array", items: stringSchema() }, inputArtifactRefs: { type: "array", minItems: 1, items: stringSchema() }, outputArtifactRefs: { type: "array", minItems: 1, items: stringSchema() }, affectedRanges: { type: "array", minItems: 1, items: timeRangeSchema() } }, ["nodeId", "operation", "dependsOn", "inputArtifactRefs", "outputArtifactRefs", "affectedRanges"]) } }, ["graphId", "intentId", "baseTimelineRef", "baseRevision", "nodes"]) }, ["projectPath", "runId", "graph"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_timeline_patch",
    description: "Register a dry-run timeline diff. Material narrative, duration, aspect, music, rights, or manual-edit changes remain blocked for Codex approval.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), patch: objectSchema({ patchId: stringSchema(), graphId: stringSchema(), timelineId: stringSchema(), baseTimelineRef: stringSchema(), baseRevision: { type: "integer", minimum: 0 }, baseContentHash: stringSchema(), targetRevision: { type: "integer", minimum: 1 }, summary: stringSchema(), materialChanges: { type: "array", items: { type: "string", enum: materialEditChanges } }, repairLineage: objectSchema({ reviewId: stringSchema(), reviewerEvidenceRef: stringSchema(), frameAuditRef: { const: "frame_audit_report.json", type: "string" }, repairPlanRef: { const: "frame_audit_repair_plan.json", type: "string" }, sourceMediaArtifactRef: stringSchema(), sourceMediaSha256: stringSchema(), findingIds: { type: "array", minItems: 1, items: stringSchema() } }, ["reviewId", "reviewerEvidenceRef", "frameAuditRef", "repairPlanRef", "sourceMediaArtifactRef", "sourceMediaSha256", "findingIds"]), operations: { type: "array", minItems: 1, items: objectSchema({ operationId: stringSchema(), nodeId: stringSchema(), operation: { type: "string", enum: editOperations }, clipId: stringSchema(), path: stringSchema(), value: { type: "object" }, affectedRanges: { type: "array", minItems: 1, items: timeRangeSchema() }, evidenceRefs: { type: "array", minItems: 1, items: stringSchema() }, repairFindingIds: { type: "array", minItems: 1, items: stringSchema() }, reversible: { type: "boolean" } }, ["operationId", "nodeId", "operation", "clipId", "path", "value", "affectedRanges", "evidenceRefs", "reversible"]) } }, ["patchId", "graphId", "timelineId", "baseTimelineRef", "baseRevision", "baseContentHash", "targetRevision", "summary", "materialChanges", "operations"]) }, ["projectPath", "runId", "patch"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_create_timeline_preview",
    description: "Issue a short-lived single-use preview token bound to the exact patch digest, base revision, content hash, and author session before approval or commit.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), authorSessionId: stringSchema(), ttlSeconds: { type: "integer", minimum: 30, maximum: 3600 } }, ["projectPath", "runId", "authorSessionId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_commit_timeline_patch",
    description: "Commit an approved, reversible timeline patch and persist an edit receipt; never overwrite the source timeline artifact.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), interactionRequestId: stringSchema(), patchId: stringSchema(), previewId: stringSchema(), previewToken: stringSchema(), authorSessionId: stringSchema(), confirmedBy: { type: "string", enum: ["request_user_input", "not_required"] }, approvalNote: { type: "string" } }, ["projectPath", "runId", "patchId", "previewId", "previewToken", "authorSessionId", "confirmedBy"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_start_opencut_editor",
    description: "After the user chooses manual editing through Codex request_user_input, start the loopback-only Director X Cut service derived from OpenCut Classic, create an immutable canonical timeline, and return the exact in-app Browser action.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), interactionRequestId: stringSchema(), confirmedBy: { const: "request_user_input", type: "string" }, editAccepted: { const: true, type: "boolean" },
      sourceArtifactRef: stringSchema(), durationSeconds: { type: "number", exclusiveMinimum: 0, maximum: 43200 }, fps: { type: "integer", minimum: 1, maximum: 120 },
      canvasSize: { type: "object", additionalProperties: false, properties: { width: { type: "integer", minimum: 16, maximum: 16384 }, height: { type: "integer", minimum: 16, maximum: 16384 } }, required: ["width", "height"] }
    }, ["projectPath", "runId", "interactionRequestId", "confirmedBy", "editAccepted", "sourceArtifactRef", "durationSeconds", "fps"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_get_opencut_editor_status",
    description: "Inspect the current Director X Cut decision, loopback service, OpenCut-derived session, source binding, draft, and post-render requirements.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema() }, ["projectPath", "runId"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_propose_evidence_rough_cut",
    description: "Ask the canonical DX-Editor subagent to convert registered silence or inactivity evidence into a reversible Director X Cut draft. This never commits the timeline and always requires the later native edit_change approval.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), editorSessionId: stringSchema(), proposalId: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,120}$" }, owner: { const: "DX-Editor", type: "string" }, summary: { type: "string" },
      keepBeforeSeconds: { type: "number", minimum: 0, maximum: 10 }, keepAfterSeconds: { type: "number", minimum: 0, maximum: 10 }, minimumCutSeconds: { type: "number", minimum: 0, maximum: 10 },
      inactiveRanges: { type: "array", minItems: 1, maxItems: 48, items: objectSchema({ startSeconds: { type: "number", minimum: 0 }, endSeconds: { type: "number", exclusiveMinimum: 0 }, reason: { type: "string" }, evidenceRefs: { type: "array", minItems: 1, maxItems: 16, items: stringSchema() } }, ["startSeconds", "endSeconds", "evidenceRefs"]) }
    }, ["projectPath", "runId", "editorSessionId", "proposalId", "owner", "inactiveRanges"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_import_opencut_edit_result",
    description: "Import the saved Director X Cut draft as a dry-run canonical timeline patch, create a short-lived preview grant, and return a required Codex request_user_input approval before commit.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), editorSessionId: stringSchema(), ttlSeconds: { type: "integer", minimum: 30, maximum: 3600 } }, ["projectPath", "runId", "editorSessionId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_asset",
    description: "Register a production or reference asset with source, rights, use, fallback, and optional real preview URI for the canvas.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), asset: objectSchema({ id: stringSchema(), type: { enum: ["image", "video", "audio", "font", "logo", "document", "reference_frame"], type: "string" }, label: stringSchema(), sourceUrl: stringSchema(), localPath: { type: "string" }, previewUri: { type: "string" }, rightsStatus: { enum: ["project_generated", "user_owned", "licensed", "public_domain", "attribution", "reference_only", "unknown", "blocked"], type: "string" }, intendedUse: stringSchema(), licenseEvidence: { type: "string" }, attribution: { type: "string" }, fallback: stringSchema(), stage: stringSchema(), technicalRequirements: { type: "object" } }, ["id", "type", "label", "sourceUrl", "rightsStatus", "intendedUse", "fallback", "stage"]) }, ["projectPath", "runId", "asset"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_acquire_web_image_asset",
    description: "Download a selected public HTTPS image (such as an official company logo, product UI, or landmark), verify its raster bytes, save it inside the Run, persist provenance/rights evidence, and register a real canvas asset. Search-result thumbnails and authenticated URLs are rejected.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), assetId: stringSchema(), category: { type: "string", enum: WEB_IMAGE_CATEGORIES }, label: stringSchema(),
      sourceType: { type: "string", enum: ["official", "authoritative", "licensed_stock", "public_domain", "editorial", "social", "reference"] },
      sourcePageUrl: stringSchema(), sourceImageUrl: stringSchema(),
      rightsStatus: { type: "string", enum: ["licensed", "public_domain", "attribution", "reference_only", "unknown", "blocked"] },
      intendedUse: stringSchema(), licenseEvidence: { type: "string" }, attribution: { type: "string" }, fallback: stringSchema(), interactionRequestId: { type: "string" }
    }, ["projectPath", "runId", "assetId", "category", "label", "sourceType", "sourcePageUrl", "sourceImageUrl", "rightsStatus", "intendedUse", "fallback"]),
    annotations: { ...writeAnnotations(), openWorldHint: true }
  },
  {
    name: "directorx_audit_asset_quality",
    description: "Probe a downloaded image/video, verify resolution, duration, aspect, audio and rights scope, require a structured DX-Asset-Manager relevance/composition/artifact review, and persist a blocking quality report before the asset can enter research or generation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), assetRef: stringSchema(), useMode: { type: "string", enum: ["delivery", "reference_analysis"] }, reviewerId: { type: "string", const: "DX-Asset-Manager" }, requirements: objectSchema({ minimumWidth: { type: "integer", minimum: 1 }, minimumHeight: { type: "integer", minimum: 1 }, minimumDurationSeconds: { type: "number", exclusiveMinimum: 0 }, maximumDurationSeconds: { type: "number", exclusiveMinimum: 0 }, targetAspectRatio: { type: "number", exclusiveMinimum: 0 }, aspectTolerance: { type: "number", minimum: 0, maximum: 2 }, requireAudio: { type: "boolean" }, minimumScore: { type: "number", minimum: 0, maximum: 1 } }), directorReview: objectSchema({ relevanceScore: { type: "number", minimum: 0, maximum: 1 }, visualQualityScore: { type: "number", minimum: 0, maximum: 1 }, compositionScore: { type: "number", minimum: 0, maximum: 1 }, artifactRisk: { type: "string", enum: ["none", "low", "medium", "high", "blocked"] }, observations: { type: "array", minItems: 1, items: stringSchema() }, approvedForUse: { type: "boolean" } }, ["relevanceScore", "visualQualityScore", "compositionScore", "artifactRisk", "observations", "approvedForUse"]) }, ["projectPath", "runId", "assetRef", "useMode", "reviewerId", "requirements", "directorReview"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_audit_visual_asset_coverage",
    description: "Gate research on locally saved visual assets. Verify required categories such as company_logo, product_interface, product_image, or landmark and persist visual_asset_coverage.json.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(),
      requirements: { type: "array", minItems: 1, items: objectSchema({ category: { type: "string", enum: WEB_IMAGE_CATEGORIES }, minimumCount: { type: "integer", minimum: 1 }, allowReferenceOnly: { type: "boolean" }, rationale: stringSchema() }, ["category", "minimumCount", "allowReferenceOnly", "rationale"]) }
    }, ["projectPath", "runId", "requirements"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_validate_research_package",
    description: "Validate the complete research package without mutation, returning every missing field plus a Director-bound template in one call.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), package: { type: "object" } }, ["projectPath", "runId", "package"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_finalize_research",
    description: "Compile recorded web sources, assets, rights, reference assessment, and analysis into the complete research-stage artifact package.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), package: objectSchema({ researchQuestions: { type: "array", minItems: 1, items: stringSchema() }, sourcePolicy: stringSchema(), handoffRules: { type: "array", minItems: 1, items: stringSchema() }, transferablePatterns: { type: "array", minItems: 1, items: { type: "object" } }, blockedReuse: { type: "array", items: stringSchema() }, factualFindings: { type: "array", minItems: 1, items: { type: "object" } }, referenceLearning: { type: "object" }, sourcePriority: { type: "array", minItems: 1, items: stringSchema() }, rightsPolicy: stringSchema(), readinessSummary: { type: "object" }, rightsReleaseGate: { type: "object" }, stylePlaybook: { type: "object" } }, ["researchQuestions", "sourcePolicy", "handoffRules", "transferablePatterns", "blockedReuse", "factualFindings", "referenceLearning", "sourcePriority", "rightsPolicy", "readinessSummary", "rightsReleaseGate", "stylePlaybook"]) }, ["projectPath", "runId", "package"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_artifact",
    description: "Verify and register an existing project file as stage evidence using a workspace-contained path, size, SHA-256 hash, canvas visibility, and typed source-artifact relationships.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), artifactRef: stringSchema(), path: stringSchema(), stage: stringSchema(), mediaKind: { enum: ["document", "image", "video", "audio", "archive"], type: "string" }, metadata: { type: "object" } }, ["projectPath", "runId", "artifactRef", "path", "stage", "mediaKind"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_get_stage_requirements",
    description: "Return the complete stage contract, all registered and missing outputs, approvals, ordering blockers, and begin/complete readiness before mutation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), stageId: stringSchema() }, ["projectPath", "runId", "stageId"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_register_stage_package",
    description: "Hash and register up to 64 stage artifacts atomically, then optionally complete the stage in the same call when the full contract is satisfied.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), stageId: stringSchema(),
      artifacts: { type: "array", minItems: 1, maxItems: 64, items: objectSchema({ artifactRef: stringSchema(), path: stringSchema(), mediaKind: { enum: ["document", "image", "video", "audio", "archive"], type: "string" }, metadata: { type: "object" } }, ["artifactRef", "path", "mediaKind"]) },
      completeStage: { type: "boolean" }, detail: { type: "string" }
    }, ["projectPath", "runId", "stageId", "artifacts"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_layered_collage_plan",
    description: "Register a configurable background/rear/primary/foreground collage workflow with motion roles, extraction, TTS, four-layer audio, Remotion, and QA checkpoints.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), plan: objectSchema({
      workflowId: stringSchema(), title: stringSchema(), aspectRatio: stringSchema(), fps: { type: "number", exclusiveMinimum: 0 }, generationRoute: { type: "object" }, extractionRoute: { type: "object" }, ttsRoute: { type: "object" }, voiceTimingPolicy: stringSchema(), stagingPolicy: { type: "object" }, backgroundMotion: { type: "object" }, roleMotion: { type: "object" },
      scenes: { type: "array", minItems: 1, items: objectSchema({ sceneId: stringSchema(), durationSeconds: { type: "number", exclusiveMinimum: 0 }, narrativePurpose: stringSchema(), layers: { type: "array", minItems: 4, items: { type: "object" } } }, ["sceneId", "durationSeconds", "narrativePurpose", "layers"]) },
      audioLayers: { type: "array", minItems: 4, items: { type: "object" } }, composition: { type: "object" }
    }, ["workflowId", "title", "aspectRatio", "fps", "generationRoute", "extractionRoute", "ttsRoute", "voiceTimingPolicy", "stagingPolicy", "backgroundMotion", "roleMotion", "scenes", "audioLayers", "composition"]) }, ["projectPath", "runId", "plan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_extract_chroma_layers",
    description: "Crop a project-contained generated character sheet and remove a configured solid key color with FFmpeg, producing real transparent PNG layer assets for the canvas.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), sourcePath: stringSchema(), keyColor: stringSchema(), similarity: { type: "number", minimum: 0, maximum: 1 }, blend: { type: "number", minimum: 0, maximum: 1 }, layers: { type: "array", minItems: 1, items: objectSchema({ layerId: stringSchema(), label: stringSchema(), x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 }, width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 }, outputPath: stringSchema(), sceneId: stringSchema(), role: stringSchema(), zIndex: { type: "number" } }, ["layerId", "label", "x", "y", "width", "height", "outputPath", "sceneId", "role", "zIndex"]) } }, ["projectPath", "runId", "sourcePath", "keyColor", "layers"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_review_layered_collage_phase",
    description: "Record an evidence-backed static-layout, motion/audio, or final-media quality gate for the layered-collage pipeline. Static layout and motion/audio must pass before Remotion render.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), phase: { enum: ["static_layout", "motion_audio", "final_media"], type: "string" }, status: { enum: ["passed", "failed"], type: "string" }, checks: { type: "array", minItems: 1, items: objectSchema({ id: stringSchema(), status: { enum: ["pass", "fail"], type: "string" }, observation: stringSchema() }, ["id", "status", "observation"]) }, evidenceRefs: { type: "array", minItems: 1, items: stringSchema() }, note: stringSchema() }, ["projectPath", "runId", "phase", "status", "checks", "evidenceRefs"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_camera_continuity_graph",
    description: "Compile a provider-neutral multi-camera dependency graph, first/last-frame tasks, eligible reference candidates, and safe parallel execution waves. Rights, asset-quality, future-frame leakage, and provider continuity capabilities are hard constraints.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      plan: objectSchema({
        graphId: stringSchema(),
        sequenceId: stringSchema(),
        maxParallelism: { type: "integer", minimum: 1, maximum: 16 },
        maxReferencesPerFrame: { type: "integer", minimum: 1, maximum: 16 },
        strictReferenceCoverage: { type: "boolean" },
        providerEnvelope: objectSchema({
          supportsFirstFrame: { type: "boolean" },
          supportsLastFrame: { type: "boolean" },
          supportsTransitionVideo: { type: "boolean" },
          maxReferenceImages: { type: "integer", minimum: 1, maximum: 16 }
        }, ["supportsFirstFrame", "supportsLastFrame", "supportsTransitionVideo", "maxReferenceImages"]),
        shots: {
          type: "array",
          minItems: 2,
          items: objectSchema({
            shotId: stringSchema(),
            requestId: stringSchema(),
            cameraId: stringSchema(),
            sceneId: stringSchema(),
            durationSeconds: { type: "number", exclusiveMinimum: 0 },
            variation: { enum: ["none", "small", "medium", "large"], type: "string" },
            lastFramePolicy: { enum: ["auto", "required", "forbidden"], type: "string" },
            firstFrameAssetRef: stringSchema(),
            lastFrameAssetRef: { type: "string" },
            targetDescription: stringSchema(),
            entityIds: { type: "array", items: stringSchema() },
            environmentKeys: { type: "array", items: stringSchema() },
            styleKeys: { type: "array", items: stringSchema() },
            parentShotId: { type: "string" },
            parentFrameRole: { enum: ["first", "last"], type: "string" },
            handoffStrategy: { enum: ["reuse", "reference_recompose", "transition_extract"], type: "string" }
          }, ["shotId", "requestId", "cameraId", "sceneId", "durationSeconds", "variation", "firstFrameAssetRef", "targetDescription", "entityIds", "environmentKeys", "styleKeys"])
        },
        references: {
          type: "array",
          items: objectSchema({
            assetRef: stringSchema(),
            kind: stringSchema(),
            sourceShotId: { type: "string" },
            cameraId: { type: "string" },
            sceneId: { type: "string" },
            entityIds: { type: "array", items: stringSchema() },
            environmentKeys: { type: "array", items: stringSchema() },
            styleKeys: { type: "array", items: stringSchema() },
            rightsStatus: { enum: ["owned", "licensed", "public_domain", "generated", "approved_reference_only", "unknown"], type: "string" },
            qualityStatus: { enum: ["passed", "approved", "failed", "pending"], type: "string" },
            rightsEvidenceRef: { type: "string" },
            qualityEvidenceRef: { type: "string" }
          }, ["assetRef", "kind", "entityIds", "environmentKeys", "styleKeys", "rightsStatus", "qualityStatus"])
        }
      }, ["graphId", "sequenceId", "providerEnvelope", "shots", "references"])
    }, ["projectPath", "runId", "plan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_scene_coverage_plan",
    description: "Compile the real shotlist into a director-grade scene coverage and cinematography contract: geography, action, reaction, proof, blocking, focal length, camera position, composition depth, lighting continuity, generated-video handles, fallbacks, setup groups, and execution waves.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      plan: objectSchema({
        planId: stringSchema(),
        sequenceId: stringSchema(),
        targetDurationSeconds: { type: "number", exclusiveMinimum: 0 },
        qualityThreshold: { type: "number", minimum: 60, maximum: 95 },
        knowledgeEntryIds: { type: "array", items: stringSchema() },
        scenes: {
          type: "array",
          minItems: 1,
          items: objectSchema({
            sceneId: stringSchema(),
            purpose: stringSchema(),
            axisId: stringSchema(),
            axisType: { enum: AXIS_TYPES, type: "string" },
            defaultScreenDirection: stringSchema(),
            requiresGeography: { type: "boolean" },
            requiresAction: { type: "boolean" },
            requiresReaction: { type: "boolean" },
            requiresProof: { type: "boolean" },
            primarySubjectIds: { type: "array", items: stringSchema() }
          }, ["sceneId", "purpose", "axisId", "axisType", "defaultScreenDirection"])
        },
        shots: {
          type: "array",
          minItems: 2,
          items: objectSchema({
            shotId: stringSchema(),
            order: { type: "integer", minimum: 1 },
            sceneId: stringSchema(),
            beatId: stringSchema(),
            purpose: stringSchema(),
            coverageRole: { enum: SCENE_COVERAGE_ROLES, type: "string" },
            durationSeconds: { type: "number", exclusiveMinimum: 0 },
            mediaMode: { enum: MEDIA_MODES, type: "string" },
            shotSize: stringSchema(),
            lensMm: { type: "number", minimum: 8, maximum: 300 },
            lensIntent: { enum: LENS_INTENTS, type: "string" },
            cameraSide: { enum: CAMERA_SIDES, type: "string" },
            cameraHeight: { enum: CAMERA_HEIGHTS, type: "string" },
            cameraAzimuthDegrees: { type: "number", minimum: -180, maximum: 180 },
            cameraDistanceMeters: { type: "number", exclusiveMinimum: 0 },
            movement: stringSchema(),
            movementMotivation: { type: "string" },
            blocking: {
              type: "array",
              items: objectSchema({
                subjectId: stringSchema(),
                startRegion: { enum: FRAME_REGIONS, type: "string" },
                endRegion: { enum: FRAME_REGIONS, type: "string" },
                facing: { enum: FACING_DIRECTIONS, type: "string" },
                screenDirection: stringSchema(),
                actionKey: stringSchema(),
                actionPhaseIn: stringSchema(),
                actionPhaseOut: stringSchema(),
                motivation: stringSchema()
              }, ["subjectId", "startRegion", "endRegion", "facing", "screenDirection", "actionKey", "actionPhaseIn", "actionPhaseOut", "motivation"])
            },
            composition: objectSchema({
              foreground: { type: "string" },
              midground: { type: "string" },
              background: { type: "string" },
              leadRoom: { type: "number", minimum: 0, maximum: 1 },
              headroom: { type: "number", minimum: 0, maximum: 1 },
              negativeSpace: { type: "number", minimum: 0, maximum: 1 },
              negativeSpacePurpose: { enum: NEGATIVE_SPACE_PURPOSES, type: "string" },
              focusStrategy: { enum: FOCUS_STRATEGIES, type: "string" }
            }),
            lighting: objectSchema({
              keyDirection: { enum: LIGHT_DIRECTIONS, type: "string" },
              colorTemperatureK: { type: "number", minimum: 1500, maximum: 12000 },
              contrastRatio: { type: "number", minimum: 1, maximum: 64 }
            }, ["keyDirection", "colorTemperatureK"]),
            lightingReset: { type: "boolean" },
            handles: objectSchema({
              headSeconds: { type: "number", minimum: 0 },
              tailSeconds: { type: "number", minimum: 0 }
            }, ["headSeconds", "tailSeconds"]),
            transitionCritical: { type: "boolean" },
            fallbackShotId: { type: "string" }
          }, ["shotId", "order", "sceneId", "beatId", "purpose", "coverageRole", "durationSeconds", "mediaMode", "shotSize", "lensMm", "lensIntent", "cameraSide", "cameraHeight", "cameraAzimuthDegrees", "cameraDistanceMeters", "movement", "blocking", "composition", "lighting", "handles"])
        }
      }, ["planId", "sequenceId", "targetDurationSeconds", "scenes", "shots"])
    }, ["projectPath", "runId", "plan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_transition_language_plan",
    description: "Compile Director.md and ordered shot semantics into an executable transition plan covering action/emotion/eyeline/graphic matches, J/L audio bridges, renderer recipes, fallbacks, and per-boundary review criteria.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      plan: objectSchema({
        planId: stringSchema(),
        sequenceId: stringSchema(),
        fps: { type: "integer", minimum: 1, maximum: 120 },
        renderer: { enum: ["remotion", "hyperframes", "directorx-cut-ffmpeg"], type: "string" },
        shots: {
          type: "array",
          minItems: 2,
          items: objectSchema({
            shotId: stringSchema(),
            purpose: stringSchema(),
            shotSize: stringSchema(),
            durationSeconds: { type: "number", exclusiveMinimum: 0 },
            sceneId: stringSchema(),
            locationKey: stringSchema(),
            timeKey: stringSchema(),
            screenDirection: { enum: ["left_to_right", "right_to_left", "toward_camera", "away_camera", "neutral"], type: "string" },
            eyeTraceRegion: { enum: ["upper_left", "upper_center", "upper_right", "center_left", "center", "center_right", "lower_left", "lower_center", "lower_right"], type: "string" },
            motionVector: { enum: ["left", "right", "up", "down", "in", "out", "static"], type: "string" },
            actionKey: stringSchema(),
            actionPhaseIn: { enum: ["idle", "begin", "middle", "complete"], type: "string" },
            actionPhaseOut: { enum: ["idle", "begin", "middle", "complete"], type: "string" },
            emotionIn: stringSchema(),
            emotionOut: stringSchema(),
            energyIn: { type: "number", minimum: 0, maximum: 1 },
            energyOut: { type: "number", minimum: 0, maximum: 1 },
            subjectIds: { type: "array", items: stringSchema() },
            graphicMatchKey: stringSchema(),
            audio: objectSchema({
              dialogueAtStart: { type: "boolean" },
              dialogueAtEnd: { type: "boolean" },
              ambienceKey: stringSchema()
            })
          }, ["shotId", "durationSeconds"])
        },
        overrides: {
          type: "array",
          items: objectSchema({
            fromShotId: stringSchema(),
            toShotId: stringSchema(),
            directorMethod: { enum: DIRECTOR_TRANSITION_METHODS, type: "string" },
            rationale: stringSchema(),
            cutTrigger: stringSchema(),
            durationSeconds: { type: "number", minimum: 0, maximum: 2 },
            actionOverlapSeconds: { type: "number", minimum: 0.05, maximum: 0.8 },
            easing: { enum: ["linear", "ease_in", "ease_out", "ease_in_out", "spring"], type: "string" },
            audioBridge: objectSchema({
              kind: { enum: ["none", "j_cut", "l_cut", "room_tone", "music_hit"], type: "string" },
              leadSeconds: { type: "number", minimum: 0 },
              tailSeconds: { type: "number", minimum: 0 },
              overlapSeconds: { type: "number", minimum: 0 }
            }, ["kind"])
          }, ["fromShotId", "toShotId", "directorMethod"])
        },
        preferences: objectSchema({
          maximumTransitionSeconds: { type: "number", minimum: 0.2, maximum: 2 },
          preferInvisibleCuts: { type: "boolean" },
          allowShader: { type: "boolean" }
        })
      }, ["planId", "sequenceId", "fps", "renderer", "shots"])
    }, ["projectPath", "runId", "plan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_review_shot_sequence",
    description: "Review the final ordered storyboard as a director: narrative function, scene coverage, shot-scale and movement variation, axis/eyeline/action continuity, duration and information rhythm, emotional arc, motivated camera movement, and evidence-backed intentional rule breaks.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      review: objectSchema({
        reviewId: stringSchema(),
        sequenceId: stringSchema(),
        targetDurationSeconds: { type: "number", exclusiveMinimum: 0 },
        qualityThreshold: { type: "number", minimum: 50, maximum: 95 },
        requireCta: { type: "boolean" },
        requireProof: { type: "boolean" },
        knowledgeEntryIds: { type: "array", items: stringSchema() },
        targetEmotionalArc: {
          type: "array",
          items: objectSchema({
            beatId: stringSchema(),
            targetEnergy: { type: "number", minimum: 0, maximum: 1 }
          }, ["beatId", "targetEnergy"])
        },
        shots: {
          type: "array",
          minItems: 2,
          items: objectSchema({
            shotId: stringSchema(),
            order: { type: "integer", minimum: 1 },
            beatId: stringSchema(),
            sceneId: stringSchema(),
            purpose: stringSchema(),
            function: { enum: SHOT_SEQUENCE_FUNCTIONS, type: "string" },
            durationSeconds: { type: "number", exclusiveMinimum: 0 },
            shotSize: { enum: SHOT_SEQUENCE_SIZES, type: "string" },
            movement: { enum: SHOT_SEQUENCE_MOVEMENTS, type: "string" },
            movementMotivation: { type: "string" },
            screenDirection: { enum: ["left_to_right", "right_to_left", "toward_camera", "away_camera", "neutral"], type: "string" },
            eyelineDirection: { enum: ["camera_left", "camera_right", "center", "up", "down"], type: "string" },
            primarySubjectId: { type: "string" },
            subjectIds: { type: "array", items: stringSchema() },
            actionKey: { type: "string" },
            actionPhase: { enum: ["idle", "setup", "initiation", "midpoint", "impact", "reaction", "resolution"], type: "string" },
            emotionalEnergy: { type: "number", minimum: 0, maximum: 1 },
            informationLoad: { type: "number", minimum: 0, maximum: 1 },
            captionUnits: { type: "integer", minimum: 0 },
            cameraAngleDegrees: { type: "number", minimum: -180, maximum: 180 },
            establishesSpace: { type: "boolean" },
            crossesAxisVisibly: { type: "boolean" }
          }, ["shotId", "order", "beatId", "sceneId", "purpose", "function", "durationSeconds", "shotSize", "movement", "actionPhase", "emotionalEnergy", "informationLoad", "captionUnits"])
        },
        intentionalExceptions: {
          type: "array",
          items: objectSchema({
            ruleId: stringSchema(),
            shotIds: { type: "array", minItems: 1, items: stringSchema() },
            reason: stringSchema(),
            evidenceRefs: { type: "array", minItems: 1, items: stringSchema() }
          }, ["ruleId", "shotIds", "reason", "evidenceRefs"])
        }
      }, ["reviewId", "sequenceId", "targetDurationSeconds", "shots"])
    }, ["projectPath", "runId", "review"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_review_camera_references",
    description: "Require DX-Reference-Analyst to multimodally approve reference choices for every camera-graph first/last frame before video generation. Forced continuity anchors cannot be removed.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      graphId: stringSchema(),
      reviewerId: { const: "DX-Reference-Analyst", type: "string" },
      reviewedAt: { type: "string" },
      reviews: {
        type: "array",
        minItems: 1,
        items: objectSchema({
          targetId: stringSchema(),
          selectedAssetRefs: { type: "array", items: stringSchema() },
          reason: stringSchema(),
          evidenceRefs: { type: "array", minItems: 1, items: stringSchema() }
        }, ["targetId", "selectedAssetRefs", "reason", "evidenceRefs"])
      }
    }, ["projectPath", "runId", "graphId", "reviewerId", "reviews"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_segment_continuity_plan",
    description: "Register first/last-frame anchors for every generated video segment. In a multi-segment chain, each segment must consume the previous approved end frame and use keyframes-to-video generation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), plan: objectSchema({
      sequenceId: stringSchema(), minimumSsim: { type: "number", minimum: 0.4, maximum: 1 },
      segments: { type: "array", minItems: 1, items: objectSchema({ segmentId: stringSchema(), requestId: stringSchema(), previousSegmentId: { type: "string" }, durationSeconds: { type: "number", exclusiveMinimum: 0 }, startFrameAssetRef: stringSchema(), endFrameAssetRef: stringSchema(), storyBeat: { type: "string" }, handoff: { type: "object" } }, ["segmentId", "requestId", "durationSeconds", "startFrameAssetRef", "endFrameAssetRef"]) }
    }, ["sequenceId", "segments"]) }, ["projectPath", "runId", "plan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_extract_segment_boundary_frames",
    description: "Use local FFmpeg to extract the real decoded first and last frame from one selected generated segment, hash both PNGs, and expose them on the canvas.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), segmentId: stringSchema(), videoArtifactRef: stringSchema(), timeoutMs: { type: "integer", minimum: 1000, maximum: 300000 } }, ["projectPath", "runId", "segmentId", "videoArtifactRef"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_audit_segment_continuity",
    description: "Compare every real end/start boundary with FFmpeg SSIM and combine it with evidence-backed subject, camera, motion, environment, and audio checks. A blocked report prevents render.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), minimumSsim: { type: "number", minimum: 0.4, maximum: 1 }, reviews: { type: "array", minItems: 1, items: objectSchema({ fromSegmentId: stringSchema(), toSegmentId: stringSchema(), subjectContinuity: { enum: ["passed", "failed"], type: "string" }, cameraContinuity: { enum: ["passed", "failed"], type: "string" }, motionContinuity: { enum: ["passed", "failed"], type: "string" }, environmentContinuity: { enum: ["passed", "failed"], type: "string" }, audioContinuity: { enum: ["passed", "failed"], type: "string" }, evidenceRefs: { type: "array", minItems: 1, items: stringSchema() }, notes: stringSchema() }, ["fromSegmentId", "toSegmentId", "subjectContinuity", "cameraContinuity", "motionContinuity", "environmentContinuity", "audioContinuity", "evidenceRefs", "notes"]) }, timeoutMs: { type: "integer", minimum: 1000, maximum: 300000 } }, ["projectPath", "runId", "reviews"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_segment_stitch_plan",
    description: "Bind ordered selected videos, passed boundary evidence, visual transition method, and audio bridge into the immutable multi-segment render plan.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), stitchPlan: objectSchema({ sequenceId: stringSchema(), clips: { type: "array", minItems: 1, items: { type: "object" } }, transitions: { type: "array", items: { type: "object" } }, renderStrategy: stringSchema() }, ["sequenceId", "clips", "transitions", "renderStrategy"]) }, ["projectPath", "runId", "stitchPlan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_longform_plan",
    description: "Register an ordered short-clip generation plan whose next segment consumes the previous segment's approved end-frame asset.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), plan: objectSchema({
      longformId: stringSchema(), targetDurationSeconds: { type: "number", exclusiveMinimum: 0 }, continuityStrategy: stringSchema(),
      segments: { type: "array", minItems: 2, items: objectSchema({ segmentId: stringSchema(), previousSegmentId: { type: "string" }, generationRequestId: stringSchema(), durationSeconds: { type: "number", exclusiveMinimum: 0 }, inputStartFrameAssetId: { type: "string" }, outputEndFrameAssetId: stringSchema(), storyBeat: stringSchema(), handoff: { type: "object" } }, ["segmentId", "generationRequestId", "durationSeconds", "outputEndFrameAssetId", "storyBeat"]) }
    }, ["longformId", "targetDurationSeconds", "continuityStrategy", "segments"]) }, ["projectPath", "runId", "plan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_longform_stitch_plan",
    description: "Register the ordered selected clips and reviewed boundary decisions used by Remotion/FFmpeg to assemble the long-form master.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), stitchPlan: objectSchema({
      longformId: stringSchema(), clips: { type: "array", minItems: 2, items: { type: "object" } }, transitions: { type: "array", minItems: 1, items: { type: "object" } }, audioContinuity: { type: "object" }, renderStrategy: stringSchema()
    }, ["longformId", "clips", "transitions", "audioContinuity", "renderStrategy"]) }, ["projectPath", "runId", "stitchPlan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_probe_provider_capability",
    description: "Persist a fresh evidence-backed runtime capability probe before routing paid generation to a provider/model.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), providerId: stringSchema(), modelId: stringSchema(), status: { enum: ["available", "degraded", "unavailable"], type: "string" }, capabilities: { type: "array", minItems: 1, items: stringSchema() }, limits: { type: "object" }, evidence: stringSchema(), credentialReady: { type: "boolean" }, expiresAt: { type: "string" } }, ["projectPath", "runId", "providerId", "modelId", "status", "capabilities", "evidence", "credentialReady"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_list_media_providers",
    description: "List the built-in mainstream image/video provider catalog, distinguishing first-party direct APIs from fal/Replicate gateways. Use this before asking the user to choose an image or video model.",
    inputSchema: objectSchema({ mediaType: { enum: ["image", "video"], type: "string" }, mode: { enum: ["text_to_image", "image_to_image", "text_to_video", "image_to_video", "keyframes_to_video", "reference_to_video", "video_extension"], type: "string" } }),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_get_media_provider_setup",
    description: "Validate one built-in provider/model/mode choice and return its native key-confirmation question, secure canvas injection action, official docs, capability limits, polling interval, and current-session credential readiness without exposing a secret. The model must route key confirmation through directorx_create_and_ask_native_question; secrets only enter through the secure canvas field.",
    inputSchema: objectSchema({ providerId: stringSchema(), modelId: stringSchema(), mode: { enum: ["text_to_image", "image_to_image", "text_to_video", "image_to_video", "keyframes_to_video", "reference_to_video", "video_extension"], type: "string" } }, ["providerId", "modelId", "mode"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_get_custom_media_provider_intake",
    description: "Return the mandatory native provider/model questions and official-doc research contract for an image/video model not already present in the verified Director X catalog.",
    inputSchema: objectSchema({ mediaType: { enum: ["image", "video"], type: "string" } }, ["mediaType"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_register_custom_media_provider_adapter",
    description: "Register one exact user-approved image/video provider and model as a constrained declarative HTTPS JSON adapter after Codex has searched and opened verified official API docs. Arbitrary code, shell execution, private origins, and secret persistence are rejected.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), interactionRequestId: stringSchema(),
      adapter: { type: "object" }
    }, ["projectPath", "runId", "interactionRequestId", "adapter"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_get_custom_media_provider_setup",
    description: "Reload a Run-scoped custom media adapter and return its native API-key confirmation, secure canvas injection action, official evidence, and current-session readiness.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), providerId: stringSchema(), modelId: stringSchema(), mode: { enum: ["text_to_image", "image_to_image", "text_to_video", "image_to_video", "keyframes_to_video", "reference_to_video", "video_extension"], type: "string" } }, ["projectPath", "runId", "providerId", "modelId", "mode"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_get_mosi_voice_setup",
    description: "Return the preferred MOSI speech setup, official key-creation/docs links, exact model/credential IDs, and session-only secret policy before voice generation.",
    inputSchema: objectSchema({ modelId: { type: "string" }, voiceId: { type: "string" } }),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_get_music_route_setup",
    description: "Return the native background-music choice, video-native audio fallback gate, and rights-safe search contract.",
    inputSchema: objectSchema({}),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_list_music_libraries",
    description: "List Director X music libraries with official license links, platform scope, attribution rules, and known cautions.",
    inputSchema: objectSchema({}),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_list_model_pricing",
    description: "List dated official pricing snapshots bundled for exact image, video, voice, or music models.",
    inputSchema: objectSchema({ providerId: { type: "string" }, modelId: { type: "string" }, mediaType: { enum: ["image", "video", "voice", "music"], type: "string" } }),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_quote_model_cost",
    description: "Calculate a model cost from current official pricing evidence. Missing, stale, or unmatched pricing fails closed.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), providerId: stringSchema(), modelId: stringSchema(), mediaType: { enum: ["image", "video", "voice", "music"], type: "string" },
      usage: objectSchema({
        imageCount: { type: "integer", minimum: 0 }, outputCount: { type: "integer", minimum: 0 }, durationSeconds: { type: "number", minimum: 0 },
        requestCount: { type: "integer", minimum: 0 }, characterCount: { type: "integer", minimum: 0 }, quality: { type: "string" },
        resolution: { type: "string" }, size: { type: "string" }, generateAudio: { type: "boolean" }
      })
    }, ["projectPath", "runId", "providerId", "modelId", "mediaType", "usage"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_register_model_pricing",
    description: "Persist refreshed model pricing only after Codex has searched and opened the matching provider's official pricing documentation.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(),
      evidence: objectSchema({
        pricingId: stringSchema(), providerId: stringSchema(), modelId: stringSchema(), mediaType: { enum: ["image", "video", "voice", "music"], type: "string" },
        currency: { type: "string", pattern: "^[A-Z]{3}$" }, sourceUrl: stringSchema(), sourceTitle: stringSchema(), verifiedAt: stringSchema(),
        maxAgeDays: { type: "integer", minimum: 1, maximum: 180 },
        rates: { type: "array", minItems: 1, items: objectSchema({
          metric: { enum: ["per_image", "per_second", "per_request", "per_character", "per_1k_characters"], type: "string" },
          unitPrice: { type: "number", minimum: 0 }, conditions: { type: "object" }, note: { type: "string" }
        }, ["metric", "unitPrice"]) }
      }, ["pricingId", "providerId", "modelId", "mediaType", "currency", "sourceUrl", "sourceTitle", "verifiedAt", "rates"])
    }, ["projectPath", "runId", "evidence"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_audit_music_asset",
    description: "Audit one local background-music file for exact track rights, commercial synchronization permission, Content ID evidence, audio quality, and edit fit before it may enter the final mix.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), assetId: stringSchema(), localPath: stringSchema(), reviewerId: { const: "DX-Asset-Manager", type: "string" },
      source: objectSchema({ libraryId: stringSchema(), trackPageUrl: { type: "string" }, trackTitle: stringSchema(), artist: stringSchema(), downloadUrl: { type: "string" } }, ["libraryId", "trackTitle", "artist"]),
      rights: objectSchema({
        licenseId: stringSchema(), licenseUrl: stringSchema(), commercialUse: { type: "boolean" }, synchronizationAllowed: { type: "boolean" },
        attributionRequired: { type: "boolean" }, attributionText: { type: "string" }, proofRef: stringSchema(),
        contentIdRisk: { enum: ["none", "possible", "known"], type: "string" }, contentIdProofAvailable: { type: "boolean" }, platformScope: stringSchema()
      }, ["licenseId", "licenseUrl", "commercialUse", "synchronizationAllowed", "attributionRequired", "proofRef", "contentIdRisk", "platformScope"]),
      creativeReview: objectSchema({
        relevanceScore: { type: "number", minimum: 0, maximum: 1 }, editFitScore: { type: "number", minimum: 0, maximum: 1 },
        audioQualityScore: { type: "number", minimum: 0, maximum: 1 }, approvedForUse: { type: "boolean" },
        observations: { type: "array", minItems: 1, items: stringSchema() }
      }, ["relevanceScore", "editFitScore", "audioQualityScore", "approvedForUse", "observations"]),
      requirements: { type: "object" }
    }, ["projectPath", "runId", "assetId", "localPath", "reviewerId", "source", "rights", "creativeReview"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_audio_responsibility_plan",
    description: "Bind video, TTS, music, ambience, and SFX responsibilities so video-native speech or music cannot override approved independent audio tracks.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(),
      plan: objectSchema({
        planId: stringSchema(),
        video: objectSchema({ providerId: stringSchema(), modelId: stringSchema(), nativeAudio: { type: "boolean" } }, ["providerId", "modelId", "nativeAudio"]),
        voice: objectSchema({ enabled: { type: "boolean" }, configured: { type: "boolean" }, providerId: { type: "string" }, modelId: { type: "string" } }, ["enabled"]),
        music: objectSchema({ route: { enum: ["local_file", "rights_safe_library", "generated_music", "none", "video_native_fallback"], type: "string" }, assetRef: { type: "string" }, libraryId: { type: "string" }, providerId: { type: "string" }, modelId: { type: "string" }, configured: { type: "boolean" } }, ["route"]),
        nativeFallbackApproved: { type: "boolean" }, confirmedBy: { const: "request_user_input", type: "string" }
      }, ["planId", "video", "voice", "music", "confirmedBy"])
    }, ["projectPath", "runId", "plan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_generation_plan",
    description: "Register provider-approved, provider-agnostic generation requests with per-shot attempt, cost, quality, continuity, and repair limits.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), plan: objectSchema({
      generationRequestId: stringSchema(), currency: stringSchema(), providerId: stringSchema(), modelId: stringSchema(), credentialRef: { type: "string" },
      requests: { type: "array", minItems: 1, items: objectSchema({ requestId: stringSchema(), shotId: stringSchema(), mode: { enum: ["image", "text_to_video", "image_to_video", "keyframes_to_video", "reference_to_video", "transition_clip", "video_extension", "video_to_video_edit", "avatar_lipsync", "screen_demo"], type: "string" }, durationSeconds: { type: "number", minimum: 0 }, promptLayers: { type: "object" }, negativeConstraints: { type: "array", items: stringSchema() }, providerParameters: { type: "object" }, inputAnchorAssets: { type: "array", items: stringSchema() }, outputAnchorAssets: { type: "array", items: stringSchema() }, carryForwardRules: { type: "array", items: stringSchema() }, cameraGraphNodeId: { type: "string" }, referenceTargetIds: { type: "array", items: stringSchema() }, reviewCriteria: { type: "array", minItems: 1, items: stringSchema() }, repairPrompts: { type: "array", items: stringSchema() }, maxAttempts: { type: "integer", minimum: 1 }, maxCost: { type: "number", exclusiveMinimum: 0 }, attemptCostCap: { type: "number", exclusiveMinimum: 0 }, qualityThreshold: { type: "number", minimum: 0, maximum: 1 } }, ["requestId", "shotId", "mode", "durationSeconds", "promptLayers", "negativeConstraints", "providerParameters", "inputAnchorAssets", "outputAnchorAssets", "carryForwardRules", "reviewCriteria", "repairPrompts", "maxAttempts", "maxCost", "attemptCostCap", "qualityThreshold"]) }
    }, ["generationRequestId", "currency", "providerId", "modelId", "requests"]) }, ["projectPath", "runId", "plan"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_prompt_bound_generation_plan",
    description: "Compile generation_request.json directly from the currently verified visual_prompt_pack.json so the reviewed prompt, provider mode, parameters, anchors, and first paid attempt cannot drift during handoff.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), generationRequestId: stringSchema(), currency: stringSchema(), routeId: stringSchema(), promptPackSha256: { type: "string", pattern: "^[A-Fa-f0-9]{64}$" }, credentialRef: { type: "string" },
      requests: { type: "array", minItems: 1, items: objectSchema({
        requestId: stringSchema(), shotId: stringSchema(), providerParameters: { type: "object" }, outputAnchorAssets: { type: "array", items: stringSchema() }, cameraGraphNodeId: { type: "string" }, referenceTargetIds: { type: "array", items: stringSchema() },
        maxAttempts: { type: "integer", minimum: 1 }, maxCost: { type: "number", exclusiveMinimum: 0 }, attemptCostCap: { type: "number", exclusiveMinimum: 0 }, qualityThreshold: { type: "number", minimum: 0, maximum: 1 }
      }, ["requestId", "shotId", "providerParameters", "outputAnchorAssets", "maxAttempts", "maxCost", "attemptCostCap", "qualityThreshold"]) }
    }, ["projectPath", "runId", "generationRequestId", "currency", "routeId", "promptPackSha256", "requests"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_begin_generation_attempt",
    description: "Open one auditable generation attempt using a fresh cost quote calculated from official provider pricing, never a caller-supplied estimate.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), requestId: stringSchema(), attemptId: stringSchema(), prompt: stringSchema(), providerOptions: { type: "object" },
      pricingUsage: objectSchema({
        imageCount: { type: "integer", minimum: 0 }, outputCount: { type: "integer", minimum: 0 }, durationSeconds: { type: "number", minimum: 0 },
        requestCount: { type: "integer", minimum: 0 }, characterCount: { type: "integer", minimum: 0 }, quality: { type: "string" },
        resolution: { type: "string" }, size: { type: "string" }, generateAudio: { type: "boolean" }
      })
    }, ["projectPath", "runId", "requestId", "attemptId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_build_waveform_pyramid",
    description: "Probe real media, decode it in bounded chunks, and persist a multiresolution min/max waveform pyramid for scalable long-video review.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), mediaPath: stringSchema(), waveformId: stringSchema(), chunkDurationSeconds: { type: "number", minimum: 5, maximum: 300 }, basePixelWidth: { type: "integer", minimum: 64, maximum: 4096 }, sampleRate: { type: "integer", minimum: 1000, maximum: 48000 }, timeoutMs: { type: "integer", minimum: 1000, maximum: 300000 } }, ["projectPath", "runId", "mediaPath", "waveformId", "chunkDurationSeconds", "basePixelWidth", "sampleRate"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_get_waveform_window",
    description: "Read a bounded waveform viewport from a persisted pyramid and automatically choose a suitable resolution level.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), waveformId: stringSchema(), startSeconds: { type: "number", minimum: 0 }, durationSeconds: { type: "number", exclusiveMinimum: 0 }, pixelWidth: { type: "integer", minimum: 64, maximum: 4096 } }, ["projectPath", "runId", "waveformId", "startSeconds", "durationSeconds", "pixelWidth"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_analyze_media_waveform",
    description: "Use local FFmpeg to decode a bounded media window and persist normalized min/max waveform evidence for the A/V review timeline.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), mediaPath: stringSchema(), waveformId: stringSchema(), trackId: stringSchema(), role: stringSchema(), startSeconds: { type: "number", minimum: 0 }, durationSeconds: { type: "number", exclusiveMinimum: 0 }, sampleRate: { type: "integer", minimum: 1000, maximum: 48000 }, pixelWidth: { type: "integer", minimum: 64, maximum: 4096 }, timeoutMs: { type: "integer", minimum: 1000, maximum: 300000 } }, ["projectPath", "runId", "mediaPath", "waveformId", "trackId", "role", "startSeconds", "durationSeconds", "sampleRate", "pixelWidth"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_import_caption_track",
    description: "Parse a project-contained WebVTT or SRT file into a durable RationalTime caption track for A/V review and subtitle synchronization.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), captionPath: stringSchema(), trackId: stringSchema(), language: stringSchema() }, ["projectPath", "runId", "captionPath", "trackId", "language"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_av_review_timeline",
    description: "Register a synchronized review timeline of shot boundaries, subtitle cues, normalized audio waveform peaks, and evidence-backed markers for the canvas.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), timeline: objectSchema({ timelineId: stringSchema(), revisionId: stringSchema(), mediaArtifactRef: stringSchema(), projectRate: rationalTimeSchema(), duration: rationalTimeSchema(), shots: { type: "array", items: objectSchema({ id: stringSchema(), range: timeRangeSchema(), label: stringSchema() }, ["id", "range", "label"]) }, subtitles: { type: "array", items: objectSchema({ id: stringSchema(), range: timeRangeSchema(), text: stringSchema(), speaker: { type: "string" } }, ["id", "range", "text"]) }, audioTracks: { type: "array", items: objectSchema({ id: stringSchema(), role: stringSchema(), waveformId: { type: "string" }, waveformWindow: objectSchema({ range: timeRangeSchema(), level: { type: "integer", minimum: 0 }, samplesPerPoint: { type: "number", exclusiveMinimum: 0 }, pixelWidth: { type: "integer", minimum: 1 }, peaks: { type: "array", maxItems: 8192, items: { type: "number", minimum: -1, maximum: 1 } } }, ["range", "level", "samplesPerPoint", "pixelWidth", "peaks"]), loudnessLufs: { type: "number" }, truePeakDbtp: { type: "number" } }, ["id", "role", "waveformWindow"]) }, markers: { type: "array", items: objectSchema({ id: stringSchema(), range: timeRangeSchema(), kind: { enum: ["defect", "evidence", "music_hit", "approval", "note"], type: "string" }, label: stringSchema(), evidenceRefs: { type: "array", minItems: 1, items: stringSchema() }, severity: { enum: ["info", "minor", "major", "critical"], type: "string" } }, ["id", "range", "kind", "label", "evidenceRefs"]) } }, ["timelineId", "revisionId", "mediaArtifactRef", "projectRate", "duration", "shots", "subtitles", "audioTracks", "markers"]) }, ["projectPath", "runId", "timeline"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_negotiate_task_transport",
    description: "Negotiate MCP Tasks from host-advertised capabilities, or persist an explicit durable provider-job polling fallback when unsupported.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), protocolVersion: stringSchema(), protocolGeneration: { enum: ["tasks_2025_11_25", "tasks_extension"], type: "string" }, capabilitySource: { enum: ["initialize", "request_meta", "none"], type: "string" }, requestCapabilities: { type: "object" }, behaviorProbe: { enum: ["not_run", "passed", "failed"], type: "string" }, hostBuild: stringSchema() }, ["projectPath", "runId", "protocolVersion", "protocolGeneration", "capabilitySource", "requestCapabilities", "behaviorProbe", "hostBuild"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_submit_provider_job",
    description: "Bind an asynchronous provider job to an active attempt with a stable idempotency key; repeated submissions return the existing job.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), requestId: stringSchema(), attemptId: stringSchema(), providerJobId: stringSchema(), idempotencyKey: stringSchema() }, ["projectPath", "runId", "requestId", "attemptId", "providerJobId", "idempotencyKey"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_submit_media_generation",
    description: "Submit a real image/video generation request to the exact user-approved provider/model for an active bounded attempt, using only a current-session credential. Automatically downloads synchronous results into the project and never persists the API key.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), requestId: stringSchema(), attemptId: stringSchema(), candidateId: stringSchema(), idempotencyKey: stringSchema(), accountedCost: { type: "number", minimum: 0 },
      negativePrompt: { type: "string" }, aspectRatio: { type: "string" }, size: { type: "string" }, resolution: { type: "string" }, durationSeconds: { type: "number", minimum: 0 },
      imagePaths: { type: "array", items: stringSchema() }, imageUrls: { type: "array", items: stringSchema() }, endImagePath: { type: "string" }, endImageUrl: { type: "string" }, videoPath: { type: "string" }, videoUrl: { type: "string" },
      outputCount: { type: "integer", minimum: 1, maximum: 8 }, generateAudio: { type: "boolean" }, providerOptions: { type: "object" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 300000 }
    }, ["projectPath", "runId", "requestId", "attemptId", "candidateId", "idempotencyKey"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_poll_media_generation",
    description: "Poll one Director X-submitted provider job once, persist monotonic progress, and immediately download a completed image/video into the project canvas for review. The host may call this repeatedly at the provider's recommended interval.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), providerJobId: stringSchema(), timeoutMs: { type: "integer", minimum: 1000, maximum: 300000 } }, ["projectPath", "runId", "providerJobId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_update_provider_job",
    description: "Poll and persist a provider job state, monotonic progress, input request, result reference, or stable failure without duplicating paid work.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), providerJobId: stringSchema(), interactionRequestId: stringSchema(), status: { enum: ["queued", "running", "input_required", "succeeded", "failed", "cancel_requested", "cancelled"], type: "string" }, progress: { type: "number", minimum: 0, maximum: 1 }, inputRequest: { type: "object" }, resultRef: { type: "string" }, error: { type: "object" } }, ["projectPath", "runId", "providerJobId", "status", "progress"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_cancel_provider_job",
    description: "Record a cooperative cancellation request while preserving the distinction between requested and terminal cancellation.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), providerJobId: stringSchema() }, ["projectPath", "runId", "providerJobId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_generation_candidate",
    description: "Register a real generated image or video candidate, its provider cost, and its project-contained media file for canvas review.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), requestId: stringSchema(), attemptId: stringSchema(), candidateId: stringSchema(), localPath: stringSchema(), mediaType: { enum: ["image", "video"], type: "string" }, actualCost: { type: "number", minimum: 0 }, providerResultId: stringSchema(), providerJobId: { type: "string" } }, ["projectPath", "runId", "requestId", "attemptId", "candidateId", "localPath", "mediaType", "actualCost", "providerResultId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_generate_mosi_voiceover",
    description: "Generate a real voiceover with the session-only MOSI credential, persist playable audio and an auditable secret-free receipt, and show it on the canvas.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), text: stringSchema(), voiceId: stringSchema(), outputPath: stringSchema(), model: { type: "string" }, responseFormat: { enum: ["mp3", "wav", "aac", "flac", "opus"], type: "string" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 300000 } }, ["projectPath", "runId", "text", "voiceId", "outputPath"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_generate_local_moss_tts_nano_voiceover",
    description: "Generate a real local voiceover through an already configured MOSS-TTS-Nano CLI, persist playable WAV audio and a secret-free receipt, and show it on the canvas without an API key.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), text: stringSchema(), promptSpeechPath: stringSchema(), promptSpeechRightsApproved: { type: "boolean" }, outputPath: stringSchema(), voiceId: { type: "string" },
      backend: { enum: ["onnx", "pytorch"], type: "string" }, executionProvider: { enum: ["cpu", "cuda"], type: "string" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 1800000 }
    }, ["projectPath", "runId", "text", "promptSpeechPath", "promptSpeechRightsApproved", "outputPath"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_diagnose_setup",
    description: "Read-only, profile-aware Director X setup diagnosis. It performs no paid provider calls, returns no credential values, and may issue one bounded repair plan for explicit Codex request_user_input approval.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), profile: { enum: PLUGIN_HEALTH_PROFILES, type: "string" }, sourceKind: { enum: ["local", "url"], type: "string" },
      transcriptionRequested: { type: "boolean" }, expectedPluginVersion: { type: "string" }, providerId: { type: "string" },
      availableAgentTypes: { type: "array", items: stringSchema() }, hostToolNames: { type: "array", items: stringSchema() }, hostSkillNames: { type: "array", items: stringSchema() }
    }, ["projectPath", "profile"]),
    outputSchema: pluginHealthEnvelopeSchema(),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_repair_setup",
    description: "Execute exactly one plugin-owned setup repair from a fresh project-scoped diagnosis plan. Requires explicit request_user_input acceptance; external shell/package-manager instructions are never executed by this tool.",
    inputSchema: objectSchema({ projectPath: stringSchema(), repairPlanId: stringSchema(), confirmedBy: { const: "request_user_input", type: "string" }, repairAccepted: { const: true, type: "boolean" } }, ["projectPath", "repairPlanId", "confirmedBy", "repairAccepted"]),
    outputSchema: pluginRepairEnvelopeSchema(),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_get_builtin_media_runtime",
    description: "Inspect the Director X built-in Remotion, HyperFrames, and Whisper runtime without exposing implementation noise to the user.",
    inputSchema: objectSchema({}),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_install_builtin_media_runtime",
    description: "Idempotently prepare the user-scoped Director X Remotion, HyperFrames, and Whisper runtime when a marketplace-only plugin install has not prepared it yet.",
    inputSchema: objectSchema({}),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_transcribe_media_with_whisper",
    description: "Transcribe a project-contained audio or video file with the built-in local Whisper runtime, including word timestamps by default, then register the transcript on the production canvas.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), mediaPath: stringSchema(), outputPath: stringSchema(), sourceArtifactRef: { type: "string" },
      model: { enum: ["tiny", "base", "small", "medium", "large-v3", "distil-large-v3"], type: "string" },
      language: { type: "string" }, device: { enum: ["auto", "cpu", "cuda"], type: "string" }, computeType: { type: "string" },
      wordTimestamps: { type: "boolean" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 1800000 }
    }, ["projectPath", "runId", "mediaPath", "outputPath"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_register_render_quality_contract",
    description: "Validate and persist the pre-render narration pace, subtitle coverage, visual boundaries, natural transitions, and selected motion renderer. Rendering is blocked until this contract is ready.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), renderer: { enum: ["remotion", "hyperframes", "directorx-cut-ffmpeg"], type: "string" },
      durationSeconds: { type: "number", exclusiveMinimum: 0 }, intentionalOutroSeconds: { type: "number", minimum: 0, maximum: 10 },
      narration: objectSchema({ startSeconds: { type: "number", minimum: 0 }, endSeconds: { type: "number", exclusiveMinimum: 0 }, text: stringSchema(), language: { enum: ["zh", "en", "mixed"], type: "string" } }, ["startSeconds", "endSeconds", "text", "language"]),
      captions: { type: "array", minItems: 1, items: objectSchema({ startSeconds: { type: "number", minimum: 0 }, endSeconds: { type: "number", exclusiveMinimum: 0 }, text: stringSchema() }, ["startSeconds", "endSeconds", "text"]) },
      visualClips: { type: "array", minItems: 1, items: objectSchema({ clipId: stringSchema(), kind: { enum: ["image", "still", "video", "motion_graphic", "screen"], type: "string" }, startSeconds: { type: "number", minimum: 0 }, endSeconds: { type: "number", exclusiveMinimum: 0 } }, ["clipId", "kind", "startSeconds", "endSeconds"]) },
      transitions: { type: "array", items: objectSchema({
        fromClipId: stringSchema(),
        toClipId: stringSchema(),
        kind: { enum: ["cut", "crossfade", "dip_to_black", "fade_through_color", "slide", "wipe", "zoom_blur", "match_cut", "whip_pan", "shader"], type: "string" },
        directorMethod: { enum: DIRECTOR_TRANSITION_METHODS, type: "string" },
        transitionBoundaryId: { type: "string" },
        durationSeconds: { type: "number", minimum: 0, maximum: 2 },
        rationale: { type: "string" },
        cutTrigger: { type: "string" },
        outgoingHandleSeconds: { type: "number", minimum: 0, maximum: 5 },
        incomingHandleSeconds: { type: "number", minimum: 0, maximum: 5 },
        outgoingFrameRef: { type: "string" },
        incomingFrameRef: { type: "string" },
        bridgeFrameRef: { type: "string" },
        easing: { enum: ["linear", "ease_in", "ease_out", "ease_in_out", "spring"], type: "string" },
        runtimeAdapterId: { type: "string" },
        audioBridge: objectSchema({
          kind: { enum: ["none", "j_cut", "l_cut", "room_tone", "music_hit"], type: "string" },
          leadSeconds: { type: "number", minimum: 0, maximum: 2 },
          tailSeconds: { type: "number", minimum: 0, maximum: 2 },
          overlapSeconds: { type: "number", minimum: 0, maximum: 2 }
        }, ["kind"])
      }, ["fromClipId", "toClipId", "kind", "durationSeconds"]) }
    }, ["projectPath", "runId", "renderer", "durationSeconds", "narration", "captions", "visualClips", "transitions"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_remotion_render_projection",
    description: "Compile the registered semantic timeline, render quality contract, and Director transition plan into the only approved DirectorXTimeline props file. Call this after render-quality approval and before Remotion render.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), width: { type: "integer", minimum: 240, maximum: 7680 }, height: { type: "integer", minimum: 240, maximum: 7680 }, throughColor: { type: "string" },
      mediaBindings: { type: "array", minItems: 1, items: objectSchema({
        clipId: stringSchema(), kind: { enum: ["image", "still", "video", "motion_graphic", "screen"], type: "string" }, src: stringSchema(), fit: { enum: ["contain", "cover"], type: "string" }, muted: { type: "boolean" }, title: { type: "string" }, body: { type: "string" }, backgroundColor: { type: "string" }, accentColor: { type: "string" }
      }, ["clipId", "kind", "src"]) },
      timelineAudioBindings: { type: "array", items: objectSchema({ clipId: stringSchema(), artifactRef: stringSchema(), src: stringSchema(), startFromFrame: { type: "integer", minimum: 0 }, volume: { type: "number", minimum: 0, maximum: 4 } }, ["clipId", "artifactRef", "src"]) },
      captionBindings: { type: "array", items: objectSchema({ clipId: stringSchema(), position: { enum: ["lower_third", "center", "top"], type: "string" }, maxLines: { type: "integer", minimum: 1, maximum: 3 }, emphasisTokens: { type: "array", items: stringSchema() } }, ["clipId"]) },
      audioBridgeBindings: { type: "array", items: objectSchema({ boundaryId: stringSchema(), src: stringSchema(), startFromFrame: { type: "integer", minimum: 0 }, durationInFrames: { type: "integer", minimum: 1 }, volume: { type: "number", minimum: 0, maximum: 4 } }, ["boundaryId", "src"]) }
    }, ["projectPath", "runId", "width", "height", "mediaBindings"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_render_remotion_video",
    description: "Render a real Remotion composition with the built-in Director X runtime and shell-free argv execution, persist execution evidence, and register the playable video on the canvas.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), renderCwd: { type: "string" }, entryPoint: stringSchema(), compositionId: stringSchema(), outputPath: stringSchema(), propsPath: { type: "string" }, codec: { enum: ["h264", "h265", "vp8", "vp9", "prores"], type: "string" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 1800000 } }, ["projectPath", "runId", "entryPoint", "compositionId", "outputPath"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_render_hyperframes_video",
    description: "Render a real HTML/CSS HyperFrames composition with the built-in Director X runtime, persist execution evidence, and register the playable video on the canvas.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), renderCwd: { type: "string" }, compositionPath: stringSchema(), outputPath: stringSchema(),
      continuityBindingPath: { type: "string" }, requireAudio: { type: "boolean" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 1800000 }
    }, ["projectPath", "runId", "compositionPath", "outputPath"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_render_opencut_timeline",
    description: "Render the exact committed Director X Cut canonical timeline with shell-free FFmpeg argv, including trim/order, normalized crop, adjacent transitions, gain, and bounded audio ducking; persist plan and execution evidence before full-frame review.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), outputPath: stringSchema(), timeoutMs: { type: "integer", minimum: 1000, maximum: 1800000 } }, ["projectPath", "runId", "outputPath"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_verify_final_media",
    description: "Probe the rendered final video, decode every frame, persist PTS/VFR frame identity and bounded evidence frames, and run tier-aware visual, audio, rights, and placeholder gates. DX-Quality-Reviewer evidence and final user approval remain separate.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), finalVideoPath: stringSchema(), requireAudio: { type: "boolean" },
      visualReview: stringSchema(), audioReview: stringSchema(), rightsStatus: { enum: ["project_generated", "user_owned", "licensed", "public_domain"], type: "string" },
      deliveryTier: { enum: DELIVERY_TIERS, type: "string" }, visualContinuityMode: { enum: ["multi_shot", "single_take"], type: "string" }, singleTakeApprovalRef: { type: "string" },
      mockComponents: { type: "array", items: stringSchema() }, timeoutMs: { type: "integer", minimum: 1000, maximum: 900000 }
    }, ["projectPath", "runId", "finalVideoPath", "visualReview", "audioReview", "rightsStatus", "deliveryTier"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_final_review_evidence",
    description: "Require the canonical DX-Quality-Reviewer to disposition every frame-audit finding against registered evidence, bind the exact media SHA-256, and separate technical quality, reviewer judgment, repair, and final user approval.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(),
      review: objectSchema({
        reviewId: stringSchema(), reviewerId: { const: finalReviewReviewerId, type: "string" }, mediaArtifactRef: stringSchema(), mediaSha256: stringSchema(),
        frameAuditRef: { const: "frame_audit_report.json", type: "string" }, repairPlanRef: { const: "frame_audit_repair_plan.json", type: "string" },
        decision: { enum: finalReviewDecisions, type: "string" }, summary: stringSchema(),
        dispositions: { type: "array", items: objectSchema({
          findingId: stringSchema(), status: { enum: finalReviewDispositions, type: "string" }, reason: stringSchema(),
          evidenceRefs: { type: "array", minItems: 1, maxItems: 24, items: stringSchema() }
        }, ["findingId", "status", "reason", "evidenceRefs"]) }
      }, ["reviewId", "reviewerId", "mediaArtifactRef", "mediaSha256", "frameAuditRef", "repairPlanRef", "decision", "summary", "dispositions"])
    }, ["projectPath", "runId", "review"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_scene_coverage_review",
    description: "Require the canonical DX-Quality-Reviewer to inspect identity-bound first/middle/last evidence for every planned shot and disposition camera, blocking, composition, lighting, movement, edit fit, fallback, and narrative coverage without waiving technical blockers.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(),
      review: objectSchema({
        reviewId: stringSchema(), reviewerId: { const: sceneCoverageReviewerId, type: "string" },
        decision: { enum: sceneCoverageReviewDecisions, type: "string" }, summary: stringSchema(),
        dispositions: { type: "array", minItems: 1, items: objectSchema({
          taskId: stringSchema(), status: { enum: sceneCoverageReviewStatuses, type: "string" }, reason: stringSchema(),
          evidenceRefs: { type: "array", minItems: 1, maxItems: 24, items: stringSchema() }
        }, ["taskId", "status", "reason", "evidenceRefs"]) }
      }, ["reviewId", "reviewerId", "decision", "summary", "dispositions"])
    }, ["projectPath", "runId", "review"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_score_reference_replication",
    description: "Compare an audited final video against its downloaded reference video/audio, persist a difference-mode conformance report, and decide pass_export, needs_edit, or regenerate. Regeneration is the default when pacing, camera, motion, audio, structure, or originality falls below the score floor.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), reportId: stringSchema(), referenceId: stringSchema(), reviewerId: { const: "DX-Quality-Reviewer", type: "string" }, outputArtifactRef: stringSchema(), outputMediaSha256: { type: "string" },
      scores: objectSchema(Object.fromEntries(REPLICATION_DIMENSIONS.map((dimension) => [dimension, { type: "number", minimum: 0, maximum: 1 }])), REPLICATION_DIMENSIONS),
      minimumScore: { type: "number", minimum: 0, maximum: 1 }, decision: { enum: ["pass_export", "needs_edit", "regenerate"], type: "string" }, rationale: stringSchema(), evidenceRefs: { type: "array", minItems: 1, items: stringSchema() }, auditRefs: { type: "array", items: stringSchema() }, differenceMethod: { type: "string" }
    }, ["projectPath", "runId", "reportId", "referenceId", "reviewerId", "outputArtifactRef", "scores", "decision", "rationale", "evidenceRefs"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_review_generation_candidate",
    description: "Score a candidate with specialized intrinsic, continuity, motion, edit and A/V dimensions; video decisions require timecoded evidence and cannot hide a critical defect behind one average.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), requestId: stringSchema(), candidateId: stringSchema(), scores: objectSchema({ promptMatch: { type: "number", minimum: 0, maximum: 1 }, visualQuality: { type: "number", minimum: 0, maximum: 1 }, continuity: { type: "number", minimum: 0, maximum: 1 }, motion: { type: "number", minimum: 0, maximum: 1 }, editFit: { type: "number", minimum: 0, maximum: 1 }, worldConsistency: { type: "number", minimum: 0, maximum: 1 }, actionCompleteness: { type: "number", minimum: 0, maximum: 1 }, audioVisualSync: { type: "number", minimum: 0, maximum: 1 } }, ["promptMatch", "visualQuality", "continuity", "motion", "editFit"]), evidence: { type: "array", items: objectSchema({ timeSeconds: { type: "number", minimum: 0 }, endTimeSeconds: { type: "number", minimum: 0 }, frameRef: stringSchema(), dimension: stringSchema(), observation: stringSchema() }, ["timeSeconds", "frameRef", "dimension", "observation"]) }, defects: { type: "array", items: objectSchema({ code: stringSchema(), severity: { enum: ["info", "minor", "major", "critical"], type: "string" }, timeSeconds: { type: "number", minimum: 0 }, description: stringSchema(), repairAction: stringSchema() }, ["code", "severity", "timeSeconds", "description", "repairAction"]) }, decision: { enum: ["accept", "retry", "reroute", "add_reference", "split", "simplify", "request_approval", "terminate"], type: "string" }, reason: stringSchema(), failureType: { type: "string" }, promptDelta: { type: "string" } }, ["projectPath", "runId", "requestId", "candidateId", "scores", "evidence", "defects", "decision", "reason"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_compile_generation_repair",
    description: "Compile one evidence-bound generation repair from a reviewed candidate. The plan changes exactly one controllable prompt, reference, provider-parameter, shot-structure, or deterministic-edit variable; it stops or requests approval when the route, rights, attempts, or budget cannot support another draw.",
    inputSchema: objectSchema({
      projectPath: stringSchema(), runId: stringSchema(), repairId: stringSchema(), requestId: stringSchema(), candidateId: stringSchema(),
      primaryDefect: { enum: generationRepairDefectTypes, type: "string" },
      evidenceRefs: { type: "array", items: stringSchema() }, preserveDimensions: { type: "array", items: stringSchema() }
    }, ["projectPath", "runId", "repairId", "requestId", "candidateId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_select_generation_candidate",
    description: "Select an accepted candidate for downstream editing and update the canvas lineage and selected-clips artifact.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), requestId: stringSchema(), candidateId: stringSchema() }, ["projectPath", "runId", "requestId", "candidateId"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_create_repair_branch",
    description: "Plan a scoped, versioned repair branch from a reviewed candidate without modifying the source media.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), repairId: stringSchema(), sourceCandidateId: stringSchema(), defectCodes: { type: "array", minItems: 1, items: stringSchema() }, repairActions: { type: "array", minItems: 1, items: stringSchema() }, scope: objectSchema({ startSeconds: { type: "number", minimum: 0 }, endSeconds: { type: "number", minimum: 0 }, region: { type: "object" } }, ["startSeconds", "endSeconds"]) }, ["projectPath", "runId", "repairId", "sourceCandidateId", "defectCodes", "repairActions", "scope"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_complete_repair_branch",
    description: "Register a real repaired media file as a new candidate with source lineage and budget accounting; source overwrite is rejected.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), repairId: stringSchema(), outputCandidateId: stringSchema(), localPath: stringSchema(), mediaType: { enum: ["image", "video"], type: "string" }, actualCost: { type: "number", minimum: 0 }, providerResultId: { type: "string" } }, ["projectPath", "runId", "repairId", "outputCandidateId", "localPath", "mediaType", "actualCost"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_decision",
    description: "Persist an approved provider, model, budget, delivery promise, or candidate decision. Raw credentials are rejected.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), kind: { enum: ["budget", "image_model", "video_model", "voice_model", "music_strategy", "music_asset_selection", "music_route", "provider", "delivery", "candidate"], type: "string" }, interactionRequestId: stringSchema(), value: { type: "object" } }, ["projectPath", "runId", "kind", "interactionRequestId", "value"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_record_event",
    description: "Record evidence-backed progress around Codex-native or connected production work.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema(), type: stringSchema(), stage: stringSchema(), detail: stringSchema() }, ["projectPath", "runId", "type", "stage", "detail"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_upsert_canvas_object",
    description: "Create or update a real production object on the Director X canvas and optionally connect it to upstream objects.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      object: objectSchema({
        id: stringSchema(),
        type: { enum: ["brief", "document", "artifact", "image", "video", "audio", "shot", "decision"], type: "string" },
        label: stringSchema(),
        detail: { type: "string" },
        stage: stringSchema(),
        status: { enum: ["pending", "active", "blocked", "complete", "failed"], type: "string" },
        previewUri: { type: "string" },
        artifactRef: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        metadata: { type: "object" }
      }, ["id", "type", "label", "stage", "status"]),
      sourceIds: { type: "array", items: stringSchema() }
    }, ["projectPath", "runId", "object"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_update_canvas_review_note",
    description: "Acknowledge or resolve a user-authored canvas review note. Resolving requires registered repair or review evidence and never converts the note into an approval.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      noteId: stringSchema(),
      action: { enum: ["acknowledge", "resolve"], type: "string" },
      owner: { type: "string" },
      resolutionSummary: { type: "string" },
      evidenceRefs: { type: "array", items: stringSchema() }
    }, ["projectPath", "runId", "noteId", "action"]),
    annotations: writeAnnotations()
  },
  {
    name: "directorx_open_canvas",
    description: "Return the standalone Director X browser-canvas URL for a durable run. Navigate this URL with the Codex in-app Browser.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema() }, ["projectPath", "runId"]),
    annotations: readOnlyAnnotations()
  },
  {
    name: "directorx_open_inline_canvas",
    description: "Fallback only for an existing Run after its side Browser was previously opened and a later Browser initialization or connection attempt genuinely failed. Preflight never permits inline fallback.",
    inputSchema: objectSchema({
      projectPath: stringSchema(),
      runId: stringSchema(),
      fallbackReason: { type: "string", enum: INLINE_FALLBACK_REASONS },
      failureDetail: { type: "string", minLength: 8, maxLength: 1000 }
    }, ["projectPath", "runId", "fallbackReason", "failureDetail"]),
    annotations: readOnlyAnnotations(),
    _meta: canvasMeta("Opening fallback Director X canvas…", "Fallback Director X canvas ready")
  },
  {
    name: "directorx_get_run_snapshot",
    description: "MANDATORY on every resumed Director X turn. Read the durable Run, rebind active canvas/editor side-Browser surfaces, and return an ordered Codex-native resume action plan.",
    inputSchema: objectSchema({ projectPath: stringSchema(), runId: stringSchema() }, ["projectPath", "runId"]),
    annotations: readOnlyAnnotations(),
    _meta: { ui: { visibility: ["model", "app"] } }
  },
  {
    name: "directorx_set_session_credential",
    description: "Inject a provider API key into the current Director X MCP process only. This app-only tool never returns or persists the key.",
    inputSchema: objectSchema({ providerId: stringSchema(), envName: stringSchema(), apiKey: stringSchema() }, ["providerId", "envName", "apiKey"]),
    annotations: writeAnnotations(),
    _meta: { ui: { visibility: ["app"] } }
  }
];

const tools = assertDirectorXToolSafetyPolicy(applyToolContracts(rawTools));

for (const tool of tools) {
  const title = friendlyToolTitle(tool.name);
  tool.annotations = { ...(tool.annotations ?? {}), title };
  tool._meta = {
    ...(tool._meta ?? {}),
    "openai/toolInvocation/invoking": tool._meta?.["openai/toolInvocation/invoking"] ?? `${title}…`,
    "openai/toolInvocation/invoked": tool._meta?.["openai/toolInvocation/invoked"] ?? `${title}完成`
  };
}

const toolRegistry = createToolRegistry({ definitions: tools, invoke: callTool });

async function callTool(name, args) {
  return await withToolFailureGuard(name, args, () => executeTool(name, args));
}

async function executeTool(name, args) {
  if (name !== "directorx_set_session_credential") assertSecretFree(args);
  if (name === "directorx_diagnose_setup") return await diagnoseSetup(args);
  if (name === "directorx_repair_setup") return await repairSetup(args);
  if (name === "directorx_get_builtin_media_runtime") return await inspectMediaRuntime();
  if (name === "directorx_install_builtin_media_runtime") return await installDirectorXMediaRuntime();
  if (name === "directorx_list_pipelines") return { pipelines: PIPELINE_CATALOG };
  if (name === "directorx_query_director_knowledge") {
    const bundled = await loadBundledDirectorKnowledge();
    const project = args.projectPath ? await readProjectDirectorKnowledge(args.projectPath) : null;
    return queryDirectorKnowledge(mergeDirectorKnowledgeLibraries(bundled, project), args);
  }
  if (name === "directorx_query_cinematic_references") {
    return queryCinematicReferences(await loadBundledCinematicReferences(), args);
  }
  if (name === "directorx_compile_cinematic_reference_selection") {
    const current = await readRun(args);
    requirePipelineStage(current, "research", "Cinematic reference selection");
    const selection = compileCinematicReferenceSelection(await loadBundledCinematicReferences(), args);
    const written = await writeCinematicReferenceSelection({ ...args, selection });
    const selectionRecord = await inspectArtifact({
      ...args,
      artifactRef: written.selection.artifactRef,
      path: written.selection.path,
      stage: "research",
      mediaKind: "document",
      metadata: {
        internal: true,
        selectionId: selection.selectionId,
        sourceArtifactRefs: ["Director.md", "research_plan.json"].filter((ref) => current.artifacts?.[ref])
      }
    });
    const summaryRecord = await inspectArtifact({
      ...args,
      artifactRef: written.summary.artifactRef,
      path: written.summary.path,
      stage: "research",
      mediaKind: "document",
      metadata: {
        canvasEssential: true,
        selectionId: selection.selectionId,
        sourceArtifactRefs: [selectionRecord.artifactRef]
      }
    });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      run.cinematicReferenceSelection = selection;
      run.artifacts ??= {};
      run.artifacts[selectionRecord.artifactRef] = selectionRecord;
      run.artifacts[summaryRecord.artifactRef] = summaryRecord;
      run.events.push(event(run, "cinematic.references.selected", "research", `${selection.selectedReferences.length} references · ${selection.status}`));
      return run;
    } }), args);
  }
  if (name === "directorx_list_media_providers") return { schemaVersion: "1.0", catalogRevision: "2026-07-15", providers: listMediaProviders(args) };
  if (name === "directorx_get_media_provider_setup") return mediaProviderSetup(args.providerId, args.modelId, args.mode, mediaCredentialConfigured(args.providerId));
  if (name === "directorx_get_custom_media_provider_intake") return customProviderIntake(args.mediaType);
  if (name === "directorx_get_custom_media_provider_setup") {
    const run = await readRun(args);
    hydrateCustomMediaProviderAdapters(run.providerAdapters);
    const adapter = getCustomMediaProviderAdapter(args.providerId);
    if (adapter.model.modelId !== args.modelId || !adapter.model.modes.includes(args.mode)) throw new Error(`${args.providerId}/${args.modelId} is not registered for ${args.mode}.`);
    return customProviderSetup(adapter, mediaCredentialConfigured(args.providerId));
  }
  if (name === "directorx_get_mosi_voice_setup") return mosiVoiceSetup(args);
  if (name === "directorx_get_music_route_setup") return musicRouteSetup();
  if (name === "directorx_list_music_libraries") return { schemaVersion: "1.0", libraries: listMusicLibraries() };
  if (name === "directorx_list_model_pricing") return { schemaVersion: "1.0", catalogRevision: "2026-07-16", pricing: listModelPricing(args) };
  if (name === "directorx_quote_model_cost") {
    const run = await readRun(args);
    return quoteModelCost({ ...args, pricingEvidence: run.pricingEvidence });
  }
  if (name === "directorx_register_model_pricing") {
    const current = await readRun(args);
    assertOfficialPricingResearchEvidence(current, args.evidence);
    const holder = { pricingEvidence: structuredClone(current.pricingEvidence ?? []) };
    const evidence = registerModelPricing(holder, args.evidence);
    const written = await writeModelPricingEvidence({ ...args, evidence });
    const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: current.stage, mediaKind: "document", metadata: { internal: true, owner: "DX-Model-Router", sourceArtifactRefs: ["provider_api_research_receipt.json"], providerId: evidence.providerId, modelId: evidence.modelId } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      assertOfficialPricingResearchEvidence(run, args.evidence);
      registerModelPricing(run, args.evidence);
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      run.events.push(event(run, "pricing.official.registered", run.stage, `${evidence.providerId}/${evidence.modelId} · ${evidence.currency}`));
      return run;
    } })), args);
  }
  if (name === "directorx_audit_music_asset") {
    const current = await readRun(args);
    const artifactRef = `music:${args.assetId}`;
    const mediaRecord = await inspectArtifact({
      ...args, artifactRef, path: args.localPath, stage: "research", mediaKind: "audio",
      metadata: { canvasEssential: true, sourceUrl: args.source.trackPageUrl, rightsStatus: "pending_audit", trackTitle: args.source.trackTitle, artist: args.source.artist }
    });
    const report = await auditMusicAsset({ ...args, artifactRef });
    const written = await writeMusicAudit({ ...args, report });
    const auditRecords = {};
    for (const result of Object.values(written)) auditRecords[result.artifactRef] = await inspectArtifact({ ...args, artifactRef: result.artifactRef, path: result.path, stage: "research", mediaKind: "document", metadata: { internal: result.artifactRef !== "music_asset_plan.json", canvasEssential: result.artifactRef === "music_asset_plan.json", owner: "DX-Asset-Manager", sourceArtifactRefs: [artifactRef] } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      const music = registerMusicAudit(run, report);
      mediaRecord.metadata = { ...(mediaRecord.metadata ?? {}), rightsStatus: music.rightsStatus, musicAuditId: report.auditId };
      run.artifacts ??= {};
      run.artifacts[artifactRef] = mediaRecord;
      Object.assign(run.artifacts, auditRecords);
      upsertExecutionCanvasNode(run, { id: `music:${args.assetId}`, type: "audio", label: args.source.trackTitle, detail: `${args.source.artist} · ${report.status === "ready" ? "授权与音质检查通过" : "暂不可使用"}`, stage: "research", status: report.status === "ready" ? "complete" : "blocked", artifactRef, previewUri: mediaRecord.relativePath, metadata: { sourceArtifactRefs: Object.keys(auditRecords), libraryId: args.source.libraryId } }, "research:asset-search");
      run.events.push(event(run, `music.asset.${report.status}`, "research", `${args.source.trackTitle} · ${report.technical.durationSeconds}s`));
      return run;
    } })), args);
  }
  if (name === "directorx_register_audio_responsibility_plan") {
    const current = await readRun(args);
    assertAudioPlanMatchesDecisions(current, args.plan);
    const holder = structuredClone(current);
    const plan = compileAudioResponsibilityPlan(holder, args.plan);
    const written = await writeAudioResponsibilityPlan({ ...args, plan });
    const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: "intake", mediaKind: "document", metadata: { canvasEssential: true, owner: "DX-Editor", sourceArtifactRefs: ["Director.md", "budget_plan.json"] } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      assertAudioPlanMatchesDecisions(run, args.plan);
      compileAudioResponsibilityPlan(run, args.plan);
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      upsertExecutionCanvasNode(run, { id: "audio:responsibility", type: "document", label: "声音分工", detail: audioPlanSummary(plan), stage: "intake", status: "complete", artifactRef: record.artifactRef, metadata: { sourceArtifactRefs: ["Director.md", "budget_plan.json"] } }, "stage:intake");
      run.events.push(event(run, "audio.responsibility.registered", "intake", audioPlanSummary(plan)));
      return run;
    } })), args);
  }
  if (name === "directorx_list_subagent_roles") return { namingPattern: "DX-xxxxx", roles: DX_SUBAGENT_CATALOG.map((role) => ({ ...role, identityInstruction: dxIdentityInstruction(role.displayName) })) };
  if (name === "directorx_get_subagent_naming_status") return await inspectCodexAgentRoles(args.projectPath, { availableAgentTypes: args.availableAgentTypes });
  if (name === "directorx_install_subagent_roles") {
    const preflight = await getOrRecoverPreflightSession(args.projectPath, args.preflightId);
    if (!preflight || preflight.projectPath !== args.projectPath) throw new Error("DX role installation requires the matching Director X preflight.");
    if (args.confirmedBy !== "request_user_input" || args.interactionRequestId !== preflight.roleInstallInteractionRequestId || args.roleInstallAccepted !== true) throw new Error("DX role installation must use the preflight request_user_input interaction and an explicit acceptance.");
    return await installCodexAgentRoles(args.projectPath);
  }
  if (name === "directorx_list_video_capabilities") return { schemaVersion: "1.0", capabilities: VIDEO_CAPABILITY_CATALOG };
  if (name === "directorx_list_benchmark_verifiers") return { schemaVersion: "1.0", verifiers: BENCHMARK_VERIFIER_CATALOG };
  if (name === "directorx_get_benchmark_baselines") return await readBaselineStore(args.projectPath);
  if (name === "directorx_list_benchmark_fixture_templates") return { schemaVersion: "1.0", templates: BENCHMARK_FIXTURE_TEMPLATES };
  if (name === "directorx_capability_preflight") {
    const subagentNamingStatus = await inspectCodexAgentRoles(args.projectPath, { availableAgentTypes: args.availableAgentTypes });
    const hostCapabilities = detectCodexHostCapabilities({ toolNames: args.hostToolNames ?? [], skillNames: args.hostSkillNames ?? [], availableAgentTypes: args.availableAgentTypes });
    const setupHealth = await diagnosePluginHealth({ projectPath: args.projectPath, profile: "planning_only", sourceKind: "local", hostToolNames: args.hostToolNames, hostSkillNames: args.hostSkillNames, availableAgentTypes: args.availableAgentTypes });
    const invalidAgentTypeEvidence = !subagentNamingStatus.agentTypeEvidence.valid;
    const { browserCanvasUrl, sessionId: preflightId, canvasService } = await createBrowserSession({ projectPath: args.projectPath, outcome: args.outcome });
    const goalInteractionRequestId = `dxq-goal-${preflightId}`;
    const roleInstallInteractionRequestId = `dxq-role-${preflightId}`;
    const goalQuestions = [{ header: "制作模式", id: "enter_directorx_goal", question: "是否进入 Director X Goal 并持续制作到可播放成片？", options: [{ label: "进入制作 (Recommended)", description: "创建 Codex Goal、保持画布和生产状态，持续推进到成片。" }, { label: "暂不进入", description: "不创建制作 Run，也不启动生成或下载。" }] }];
    const roleInstallQuestions = [{ header: "DX 子智能体", id: "install_dx_roles", question: "当前用户尚未安装完整的 DX 子智能体。是否安装一次并供所有项目使用？", options: [{ label: "安装到当前用户 (Recommended)", description: "非破坏性写入 ~/.codex/agents；重新打开 Codex 后所有项目均可使用 DX 命名角色。" }, { label: "暂不安装", description: "不创建 Director X Goal，也不以普通代理替代 DX 子智能体。" }] }];
    const goalInteraction = { requestId: goalInteractionRequestId, kind: "goal_entry", questions: goalQuestions, status: "pending", interactionSurface: "codex_request_user_input" };
    const roleInstallInteraction = { requestId: roleInstallInteractionRequestId, kind: "role_install", questions: roleInstallQuestions, status: "pending", interactionSurface: "codex_request_user_input" };
    const preflightSession = preflightSessions.get(preflightId);
    Object.assign(preflightSession, { subagentNamingStatus, hostCapabilities, setupHealthSummary: summarizeSetupHealth(setupHealth), subagentSessionReady: subagentNamingStatus.sessionReady, invalidAgentTypeEvidence, goalInteractionRequestId, roleInstallInteractionRequestId, goalInteraction, roleInstallInteraction });
    await savePreflightSession(preflightId, preflightSession);
    const bootTransaction = projectPreflightBootTransaction(preflightId, projectPreflightSession(preflightId, preflightSession));
    return {
      mode: "Director X Goal",
      conversationExperience: DIRECTORX_CONVERSATION_POLICY,
      hostMechanism: "Codex Goal",
      requestUserInput: { required: true, fallback: null },
      requiredApprovals: ["goal_entry", "production_budget", "image_provider_and_model", "video_provider_and_model", "voice_provider_model_and_voice", "background_music_strategy"],
      credentialPolicy: "Collect keys only through the browser-canvas password field, inject them into the current MCP process, and persist only credential references.",
      canvasUri: CANVAS_URI,
      browserCanvasUrl,
      preflightId,
      canvasService,
      canvasMustOpenBeforeRun: true,
      preferredSurface: "codex_in_app_browser",
      canvasTabKey: `directorx:${preflightId}`,
      requiredHostSurface: "iab",
      requiredVisibility: true,
      hostAction: { type: "open_url", url: browserCanvasUrl, browser: "iab", visibility: true, persistence: "handoff", requiredBefore: "directorx_get_preflight_status" },
      hostActionInstructions: ["Use browser:control-in-app-browser. Browser may be Skill-backed and absent from direct ALL_TOOLS names; an empty name search is not an unavailable capability.", "Claim an existing Director X canvas tab or create an IAB tab and navigate it to browserCanvasUrl.", "Call the Browser visibility capability with true.", "As the final Browser action of this turn, call browser.tabs.finalize({keep:[{tab,status:'handoff'}]})."],
      canvasTurnEndAction: { type: "browser_tabs_finalize", keepStatus: "handoff", required: true, deliverableOnlyAfterFinalDelivery: true },
      nextHostInteraction: null,
      bootTransaction,
      afterCanvasOpen: { type: "mcp_tool", tool: "directorx_get_preflight_status", required: true, arguments: { projectPath: args.projectPath, preflightId } },
      status: "awaiting_canvas_open",
      subagentNamingStatus,
      hostCapabilities,
      setupHealth: summarizeSetupHealth(setupHealth),
      requiredAgentTypes: subagentNamingStatus.unroutableRoleIds,
      stage: "intake",
      goal: { displayMode: "Director X Goal", outcome: args.outcome },
      events: [{ sequence: 1, type: "preflight.canvas_service.ready", stage: "intake", detail: "Director X canvas service is ready; open the side Browser before Goal confirmation." }]
    };
  }
  if (name === "directorx_get_preflight_status") {
    const preflight = await getOrRecoverPreflightSession(args.projectPath, args.preflightId);
    if (!preflight || preflight.projectPath !== args.projectPath) throw new Error("Unknown or mismatched Director X preflight.");
    return await preflightStatusPayload(preflight, args.preflightId);
  }
  if (name === "directorx_create_run") {
    const preflight = await getOrRecoverPreflightSession(args.projectPath, args.preflightId);
    if (!preflight || preflight.projectPath !== args.projectPath || preflight.outcome !== args.outcome) throw new Error("Run creation requires the matching Director X capability preflight.");
    if (!preflight.canvasOpenedAt || preflight.surface !== "browser") throw new Error("Open the Director X side Browser canvas before creating the production Run.");
    if (preflight.hostCapabilities?.productionReadiness?.mayCreateRun !== true) {
      throw new Error(`Director X cannot create a production Run because the current Codex host is missing required capabilities: ${preflight.hostCapabilities.productionReadiness.blockers.join(", ")}. Refresh the host inventory after enabling Goal, request_user_input, agent dispatch, and durable execution support.`);
    }
    if (!preflight.subagentSessionReady) throw new Error(`Director X cannot create a Goal Run until the current Codex session can route every production role through a custom dx_* or built-in Codex agent: ${preflight.subagentNamingStatus?.unroutableRoleIds?.join(", ") ?? "unknown roles"}.`);
    if (args.confirmedBy !== "request_user_input" || args.goalInteractionRequestId !== preflight.goalInteractionRequestId || args.goalAccepted !== true) throw new Error("Director X Goal entry must be confirmed through the preflight request_user_input interaction.");
    if (preflight.goalInteraction?.status !== "resolved" || !String(preflight.goalInteraction.answers?.enter_directorx_goal ?? "").startsWith("进入制作")) {
      throw new Error(`Resolve the Director X Goal entry through directorx_resolve_user_interaction with runId preflight:${args.preflightId} before creating the Run.`);
    }
    const createdRun = await createRun(args);
    const run = await updateRun({ ...args, runId: createdRun.runId, mutate(current) {
      current.hostCapabilities = preflight.hostCapabilities ?? null;
      current.events.push(event(current, "host.capabilities.negotiated", "intake", preflight.hostCapabilities?.observed ? `${preflight.hostCapabilities.observedToolCount} Codex host tools observed` : "Codex host inventory not supplied; capability-specific checks remain unknown"));
      return current;
    } });
    preflight.runId = run.runId;
    preflight.codexGoalId = args.codexGoalId ?? null;
    await savePreflightSession(args.preflightId, preflight);
    canvasSurfaceHost.bind("canvas", args.preflightId, { projectPath: args.projectPath, runId: run.runId }, { rotateClaim: true });
    return await withBrowserCanvas(publicSnapshot(run), args);
  }
  if (["directorx_request_user_interaction", "directorx_create_and_ask_native_question"].includes(name)) {
    requireNativeGoalBound(await readRun(args), "Director X Intake and production questions");
    let interaction;
    const snapshot = await updateRun({ ...args, mutate(run) {
      interaction = requestNativeInteraction(run, args);
      if (!interaction.deduplicated) run.events.push(event(run, "interaction.requested", run.stage, `${interaction.request.kind} · ${interaction.request.requestId}`));
      return run;
    } });
    if (name === "directorx_create_and_ask_native_question") {
      interaction = { ...interaction, ...compilePendingInteractionBatch({ projectPath: args.projectPath, runId: args.runId, requests: [interaction.request] }) };
    }
    return { ...(await withBrowserCanvas(publicSnapshot(snapshot), args)), interaction };
  }
  if (name === "directorx_resolve_user_interaction") {
    if (args.runId.startsWith("preflight:")) {
      const preflightId = args.runId.slice("preflight:".length);
      const preflight = await getOrRecoverPreflightSession(args.projectPath, preflightId);
      if (!preflight || preflight.projectPath !== args.projectPath) throw new Error("Unknown or mismatched Director X preflight interaction.");
      if (!preflight.canvasOpenedAt || preflight.surface !== "browser") throw new Error("Open the Director X side Browser canvas before resolving any preflight interaction.");
      const pending = [preflight.goalInteraction, preflight.roleInstallInteraction].filter(Boolean).find((item) => item.requestId === args.requestId);
      if (!pending) throw new Error(`Unknown pending preflight interaction: ${args.requestId}`);
      const interactionRun = { runId: args.runId, interactions: { pending: [pending], history: [] } };
      const resolvedInteraction = resolveNativeInteraction(interactionRun, args);
      if (resolvedInteraction.kind === "goal_entry") preflight.goalInteraction = resolvedInteraction;
      else preflight.roleInstallInteraction = resolvedInteraction;
      await savePreflightSession(preflightId, preflight);
      return { preflightId, resolvedInteraction, bootTransaction: projectPreflightBootTransaction(preflightId, preflight) };
    }
    let resolved;
    const snapshot = await updateRun({ ...args, mutate(run) {
      const wasPending = run.interactions?.pending?.some((item) => item.requestId === args.requestId);
      resolved = resolveNativeInteraction(run, args);
      if (resolved.kind === "post_production_edit") recordPostProductionEditDecision(run, resolved);
      if (resolved.kind === "edit_change") resumeOpenCutEditorAfterDecline(run, resolved);
      if (wasPending) run.events.push(event(run, "interaction.resolved", run.stage, `${resolved.kind} · ${resolved.requestId}`));
      return run;
    } });
    return { ...(await withBrowserCanvas(publicSnapshot(snapshot), args)), resolvedInteraction: resolved };
  }
  if (name === "directorx_plan_capability_route") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const route = planCapabilityRoute(run, args);
      const written = await writeCapabilityRoute({ ...args, route });
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "intake" });
      run.events.push(event(run, "capability.route.planned", "intake", `${route.capabilities.length} capabilities · ${route.requiredToolClasses.length} tool classes · ${route.status}`));
      return run;
    } })), args);
  }
  if (name === "directorx_register_tool_inventory") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      registerToolInventory(run, args);
      const written = await writeToolRoutingArtifacts({ ...args, toolInventory: run.toolInventory });
      run.artifacts["tool_inventory.json"] = artifactRecord({ ...written["tool_inventory.json"], stage: "intake" });
      run.events.push(event(run, "tool.inventory.registered", "intake", `${run.toolInventory.tools.length} tools · ${run.toolInventory.hostBuild ?? "unknown host"}`));
      return run;
    } })), args);
  }
  if (name === "directorx_plan_tool_route") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      planToolRoute(run, args);
      const written = await writeToolRoutingArtifacts({ ...args, capabilityExecutionPlan: run.capabilityExecutionPlan });
      run.artifacts["capability_execution_plan.json"] = artifactRecord({ ...written["capability_execution_plan.json"], stage: "intake" });
      run.events.push(event(run, "tool.route.planned", "intake", `${run.capabilityExecutionPlan.status} · ${run.capabilityExecutionPlan.recommendedStrategy ?? "no route"}`));
      return run;
    } })), args);
  }
  if (name === "directorx_bind_execution_lineage") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const binding = bindExecutionLineage(run, args);
      const written = await writeLineageArtifacts({ ...args, productionLineage: run.productionLineage });
      run.artifacts["production_lineage.json"] = artifactRecord({ ...written["production_lineage.json"], stage: stageForCapability(binding.activity.capabilityId) });
      run.events.push(event(run, "execution.lineage.bound", stageForCapability(binding.activity.capabilityId), `${binding.activity.dxAgent} · ${binding.activity.providerId}/${binding.activity.modelId}@${binding.activity.modelVersion}`));
      return run;
    } })), args);
  }
  if (name === "directorx_record_tool_execution") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const record = recordToolExecution(run, args);
      const written = await writeRouteFeedbackArtifacts({ ...args, executionTelemetry: run.executionTelemetry });
      run.artifacts["execution_telemetry.json"] = artifactRecord({ ...written["execution_telemetry.json"], stage: stageForCapability(record.capabilityId) });
      run.events.push(event(run, "tool.execution.recorded", stageForCapability(record.capabilityId), `${record.toolId} · ${record.status} · ${record.latencyMs}ms`));
      return run;
    } })), args);
  }
  if (name === "directorx_record_provider_capacity") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const snapshot = recordProviderCapacity(run, args);
      const written = await writeRouteFeedbackArtifacts({ ...args, providerCapacity: run.providerCapacity });
      run.artifacts["provider_capacity_snapshot.json"] = artifactRecord({ ...written["provider_capacity_snapshot.json"], stage: "generation" });
      run.events.push(event(run, "provider.capacity.recorded", "generation", `${snapshot.toolId} · ${snapshot.state} · queue ${snapshot.queueDepth}`));
      return run;
    } })), args);
  }
  if (name === "directorx_compile_route_feedback") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      compileRouteFeedback(run, args);
      const written = await writeRouteFeedbackArtifacts({ ...args, routeFeedback: run.routeFeedback, modelKnowledgePatch: run.modelKnowledgePatch });
      run.artifacts["route_regret_report.json"] = artifactRecord({ ...written["route_regret_report.json"], stage: "review" });
      run.artifacts["model_knowledge_patch.json"] = artifactRecord({ ...written["model_knowledge_patch.json"], stage: "review" });
      run.events.push(event(run, "route.feedback.compiled", "review", `${run.routeFeedback.samples.length} samples · ${run.modelKnowledgePatch.status}`));
      return run;
    } })), args);
  }
  if (name === "directorx_review_model_knowledge_patch") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      requireResolvedInteraction(run, args.interactionRequestId, "knowledge");
      const decision = reviewKnowledgePatch(run, args);
      const written = await writeLineageArtifacts({ ...args, knowledgeDecisions: run.knowledgeDecisions, acceptedModelKnowledge: run.acceptedModelKnowledge });
      run.artifacts["knowledge_decisions.json"] = artifactRecord({ ...written["knowledge_decisions.json"], stage: "review" });
      run.artifacts["accepted_model_knowledge.json"] = artifactRecord({ ...written["accepted_model_knowledge.json"], stage: "review" });
      run.events.push(event(run, `model.knowledge.${decision.status}`, "review", `${decision.patchId} · ${decision.scope} · expires ${decision.expiresAt}`));
      return run;
    } })), args);
  }
  if (name === "directorx_revoke_model_knowledge_patch") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      requireResolvedInteraction(run, args.interactionRequestId, "knowledge");
      const decision = revokeKnowledgePatch(run, args);
      const written = await writeLineageArtifacts({ ...args, knowledgeDecisions: run.knowledgeDecisions, acceptedModelKnowledge: run.acceptedModelKnowledge });
      run.artifacts["knowledge_decisions.json"] = artifactRecord({ ...written["knowledge_decisions.json"], stage: "review" });
      run.artifacts["accepted_model_knowledge.json"] = artifactRecord({ ...written["accepted_model_knowledge.json"], stage: "review" });
      run.events.push(event(run, "model.knowledge.revoked", "review", `${decision.patchId} · ${args.note}`));
      return run;
    } })), args);
  }
  if (name === "directorx_register_benchmark_suite") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const suite = registerBenchmarkSuite(run, args); const written = await writeBenchmarkArtifacts({ ...args, benchmarkSuites: run.benchmarkSuites });
      run.artifacts["benchmark_suite.json"] = artifactRecord({ ...written["benchmark_suite.json"], stage: "review" }); run.events.push(event(run, "benchmark.suite.registered", "review", `${suite.suiteId}@${suite.version} · ${suite.fixtures.length} fixtures`)); return run;
    } })), args);
  }
  if (name === "directorx_instantiate_benchmark_template") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const suiteInput = instantiateBenchmarkTemplate(run, args); const suite = registerBenchmarkSuite(run, suiteInput); const written = await writeBenchmarkArtifacts({ ...args, benchmarkSuites: run.benchmarkSuites });
      run.artifacts["benchmark_suite.json"] = artifactRecord({ ...written["benchmark_suite.json"], stage: "review" }); run.events.push(event(run, "benchmark.template.instantiated", "review", `${args.familyId} · ${suite.suiteId}@${suite.version}`)); return run;
    } })), args);
  }
  if (name === "directorx_plan_benchmark_schedule") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) { const schedule = planBenchmarkSchedule(run, args); const written = await writeBenchmarkSchedule({ ...args, benchmarkSchedules: run.benchmarkSchedules }); run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "review" }); run.events.push(event(run, "benchmark.schedule.planned", "review", `${schedule.jobs.length} cells · ${schedule.estimatedTotalCost} max estimate`)); return run; } })), args);
  }
  if (name === "directorx_claim_benchmark_job") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) { const job = claimBenchmarkJob(run, args); const written = await writeBenchmarkSchedule({ ...args, benchmarkSchedules: run.benchmarkSchedules }); run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "review" }); run.events.push(event(run, "benchmark.job.claimed", "review", `${job.jobId} · seed ${job.seed}`)); return run; } })), args);
  }
  if (name === "directorx_update_benchmark_job") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) { const job = updateBenchmarkJob(run, args); const written = await writeBenchmarkSchedule({ ...args, benchmarkSchedules: run.benchmarkSchedules }); run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "review" }); run.events.push(event(run, `benchmark.job.${job.status}`, "review", `${job.jobId}${job.errorCode ? ` · ${job.errorCode}` : ""}`)); return run; } })), args);
  }
  if (name === "directorx_cancel_benchmark_schedule") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) { const schedule = cancelBenchmarkSchedule(run, args); const written = await writeBenchmarkSchedule({ ...args, benchmarkSchedules: run.benchmarkSchedules }); run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "review" }); run.events.push(event(run, "benchmark.schedule.cancel_requested", "review", `${schedule.scheduleId} · ${schedule.status}`)); return run; } })), args);
  }
  if (name === "directorx_execute_benchmark_verifiers") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const receipt = await executeBenchmarkVerifiers(run, args); const written = await writeBenchmarkArtifacts({ ...args, benchmarkVerifierReceipts: run.benchmarkVerifierReceipts });
      run.artifacts["benchmark_verifier_receipt.json"] = artifactRecord({ ...written["benchmark_verifier_receipt.json"], stage: "review" }); run.events.push(event(run, `benchmark.verifiers.${receipt.status}`, "review", `${receipt.fixtureId} · ${receipt.results.filter((item) => item.passed).length}/${receipt.results.length} checks`)); return run;
    } })), args);
  }
  if (name === "directorx_record_benchmark_trial") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const trial = recordBenchmarkTrial(run, args); const written = await writeBenchmarkArtifacts({ ...args, benchmarkTrials: run.benchmarkTrials });
      run.artifacts["benchmark_trials.json"] = artifactRecord({ ...written["benchmark_trials.json"], stage: "review" }); run.events.push(event(run, `benchmark.trial.${trial.status}`, "review", `${trial.fixtureId} · Q${trial.weightedScore} · ${trial.latencyMs}ms`)); return run;
    } })), args);
  }
  if (name === "directorx_compile_benchmark_report") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      let baseline = null; if (args.baselineId) { const store = await readBaselineStore(args.projectPath), active = store.activeBySuite[args.suiteId]; if (!active || active.baselineId !== args.baselineId) throw new Error("Benchmark comparison requires the active project baseline ID."); baseline = { reportId: active.baselineId, passRate: active.passRate, meanScore: active.meanScore }; }
      const report = compileBenchmarkReport(run, { ...args, baseline }); const written = await writeBenchmarkArtifacts({ ...args, report });
      run.artifacts["benchmark_report.json"] = artifactRecord({ ...written["benchmark_report.json"], stage: "review" }); run.events.push(event(run, `benchmark.report.${report.status}`, "review", `${report.suiteId} · pass ${report.passRate} · Q${report.meanScore}`)); return run;
    } })), args);
  }
  if (name === "directorx_export_observability_trace") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const trace = compileOtlpTrace(run, args); const written = await writeGovernanceArtifacts({ ...args, trace }); run.artifacts["agent_trace_otlp.json"] = artifactRecord({ ...written["agent_trace_otlp.json"], stage: "review" }); run.events.push(event(run, "observability.trace.exported", "review", `${run.observabilityTrace.spanCount} low-sensitive spans`)); return run;
    } })), args);
  }
  if (name === "directorx_promote_benchmark_baseline") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      requireResolvedInteraction(run, args.interactionRequestId, "knowledge");
      const baseline = await promoteBenchmarkBaseline(run, args); const written = await writeGovernanceArtifacts({ ...args, decisions: run.benchmarkBaselineDecisions }); run.artifacts["benchmark_baseline_decisions.json"] = artifactRecord({ ...written["benchmark_baseline_decisions.json"], stage: "review" }); run.events.push(event(run, "benchmark.baseline.promoted", "review", `${baseline.suiteId} · ${baseline.baselineId}`)); return run;
    } })), args);
  }
  if (name === "directorx_revoke_benchmark_baseline") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      requireResolvedInteraction(run, args.interactionRequestId, "knowledge");
      const baseline = await revokeBenchmarkBaseline(run, args); const written = await writeGovernanceArtifacts({ ...args, decisions: run.benchmarkBaselineDecisions }); run.artifacts["benchmark_baseline_decisions.json"] = artifactRecord({ ...written["benchmark_baseline_decisions.json"], stage: "review" }); run.events.push(event(run, "benchmark.baseline.revoked", "review", `${baseline.suiteId} · ${baseline.baselineId}`)); return run;
    } })), args);
  }
  if (name === "directorx_register_execution_graph") {
    const current = await readRun(args);
    if (!current.pipeline) throw new Error("Select a Director X pipeline before registering its execution graph.");
    const graphInput = normalizeExecutionGraph(args.graph);
    const graph = registerExecutionGraph(current, graphInput);
    const written = await writeExecutionGraph({ ...args, graph });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      registerExecutionGraph(run, graphInput);
      run.artifacts ??= {}; run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "intake" });
      run.events.push(event(run, graphInput.supersedesGraphId ? "execution.graph.replanned" : "execution.graph.registered", "intake", `${graphInput.graphId} · ${graphInput.nodes.length} nodes · ${graphInput.selectedCapabilities.length} capabilities`));
      return run;
    } })), args);
  }
  if (name === "directorx_transition_execution_node") {
    const current = await readRun(args);
    transitionExecutionNode(current, args);
    const written = await writeExecutionGraph({ ...args, graph: current.executionGraph });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      const node = transitionExecutionNode(run, args);
      run.artifacts ??= {}; run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: node.stage });
      run.events.push(event(run, `execution.node.${args.status}`, node.stage, `${node.nodeId} · ${args.detail}`));
      return run;
    } })), args);
  }
  if (name === "directorx_prepare_goal_completion") {
    let postProductionEditInteraction = null;
    let deliveryInteraction = null;
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      const completion = evaluateRunCompletion(run);
      run.completionCheck = { ...completion, checkedAt: new Date().toISOString() };
      run.status = completion.ready ? "ready_to_complete" : "production_in_progress";
      const eventType = completion.ready ? "goal.completion.ready" : "goal.completion.blocked";
      const detail = completion.ready ? `Final video ready: ${completion.finalVideoArtifactRef}` : completion.blockers.join(", ");
      const previous = run.events.at(-1);
      if (previous?.type !== eventType || previous?.detail !== detail) run.events.push(event(run, eventType, completion.nextAction.stage, detail));
      const editDecision = run.openCutEditor?.decision?.status ?? null;
      if (run.finalMediaReview?.passed && !editDecision) postProductionEditInteraction = requestNativeInteraction(run, {
        kind: "post_production_edit",
        reason: "成片已通过质量检查，需要用户决定是否进入 Director X Cut 做手工剪辑；该选择不能由 Agent 代答。",
        questions: [{ header: "成片剪辑", id: "post_production_edit", question: "是否需要进入 Director X Cut 对当前成片做手工剪辑？", options: [{ label: "进入剪辑 (Recommended)", description: "启动仅本机可访问的剪辑服务，在 Codex 侧边栏完成分割、修剪、重排和音量调整。" }, { label: "直接交付", description: "跳过手工剪辑，继续最终交付确认。" }] }]
      });
      const editorComplete = editDecision === "skipped" || run.openCutEditor?.sessions?.[run.openCutEditor?.activeSessionId]?.status === "completed";
      const deliveryPending = run.finalMediaReview?.passed && editorComplete && run.approvals?.some((approval) => approval.kind === "delivery" && approval.status !== "approved");
      if (deliveryPending) deliveryInteraction = requestNativeInteraction(run, {
        kind: "delivery",
        reason: "成片已通过全帧与音频质量门，需要用户审看并决定是否正式交付。",
        questions: [{ header: "交付确认", id: "delivery_decision", question: `是否接受已验证的 ${run.finalMediaReview.deliveryTier} 成片并完成交付？`, options: [{ label: "确认交付 (Recommended)", description: "接受当前质量层级并完成 Director X Goal。" }, { label: "需要修改", description: "保持 Goal 进行中并进入明确的修改与复审流程。" }] }]
      });
      return run;
    } })), args).then((response) => ({ ...response, postProductionEditInteraction, deliveryInteraction }));
  }
  if (name === "directorx_record_intent_resolution") {
    assertIntakeReady(await readRun(args));
    const written = await writeIntentResolution(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      if (args.resolution.clarity === "clarified" || args.resolution.questionsAsked.length || args.resolution.userAnswers.length) requireResolvedInteraction(run, args.interactionRequestId, "intake");
      run.intentResolution = { ...args.resolution, artifactRef: written.artifactRef, path: written.path };
      run.artifacts ??= {};
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "intake" });
      run.events.push(event(run, "intent.resolved", "intake", `Intent ${args.resolution.clarity}; director prompt recorded`));
      return run;
    } })), args);
  }
  if (name === "directorx_register_media_evidence_index") {
    const current = await readRun(args); const index = registerMediaEvidenceIndex(current, args.index); const written = await writeMediaEvidenceArtifacts({ ...args, index });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) { const stored = registerMediaEvidenceIndex(run, args.index); run.artifacts ??= {}; for (const record of Object.values(written)) run.artifacts[record.artifactRef] = artifactRecord({ ...record, stage: "research" }); run.events.push(event(run, "media.evidence.indexed", "research", `${stored.indexId} · ${stored.levels.flatMap((level) => level.nodes).length} moments`)); return run; } })), args);
  }
  if (name === "directorx_register_video_query_plan") {
    const current = await readRun(args); const query = registerVideoQueryPlan(current, args.plan); const written = await writeMediaEvidenceArtifacts({ ...args, query });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) { registerVideoQueryPlan(run, args.plan); run.artifacts ??= {}; for (const record of Object.values(written)) run.artifacts[record.artifactRef] = artifactRecord({ ...record, stage: "research" }); run.events.push(event(run, "video.query.planned", "research", `${args.plan.queryId} · ${args.plan.question}`)); return run; } })), args);
  }
  if (name === "directorx_search_video_evidence") {
    const current = await readRun(args);
    const query = current.videoEvidenceQueries?.[args.queryId];
    if (!query) throw new Error(`Register video query ${args.queryId} before searching.`);
    const index = current.mediaEvidenceIndexes?.[query.plan.indexId];
    if (!index) throw new Error(`Evidence index ${query.plan.indexId} is not registered.`);
    const result = searchMediaEvidence(index, { ...args, constraints: { ...(query.plan.constraints ?? {}), ...(args.constraints ?? {}) } });
    const searchRecord = { searchId: args.searchId, queryId: args.queryId, result };
    const written = await writeMediaEvidenceArtifacts({ ...args, search: searchRecord });
    const searchArtifact = Object.values(written)[0];
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      const record = recordVideoEvidenceSearch(run, searchRecord);
      run.artifacts ??= {};
      run.artifacts[searchArtifact.artifactRef] = artifactRecord({ ...searchArtifact, stage: "research", metadata: { owner: "DX-Reference-Analyst", canvasEssential: true, queryId: args.queryId, indexId: query.plan.indexId } });
      upsertExecutionCanvasNode(run, { id: `evidence-search:${args.searchId}`, type: "artifact", label: `检索候选 · ${args.query}`, detail: `${result.candidates.length} 个候选 · 第 ${record.round} 轮 · 仅索引匹配`, stage: "research", status: result.candidates.length ? "complete" : "blocked", artifactRef: searchArtifact.artifactRef, metadata: { owner: "DX-Reference-Analyst", queryId: args.queryId, indexId: query.plan.indexId, candidateCount: result.candidates.length, limitations: result.limitations } }, `evidence-query:${args.queryId}`);
      run.events.push(event(run, "video.evidence.searched", "research", `${args.queryId} · ${result.candidates.length} candidate(s) · round ${record.round}`));
      return run;
    } })), args);
  }
  if (name === "directorx_materialize_evidence_clip") {
    const current = await readRun(args);
    const query = current.videoEvidenceQueries?.[args.queryId];
    if (!query?.trace) throw new Error(`Record a retrieval trace for ${args.queryId} before materializing an evidence clip.`);
    if (!(query.trace.selectedNodeIds ?? []).includes(args.nodeId)) throw new Error(`Evidence node ${args.nodeId} must be selected in the retrieval trace before materializing a clip.`);
    const index = current.mediaEvidenceIndexes?.[query.plan.indexId];
    if (!index) throw new Error(`Evidence index ${query.plan.indexId} is not registered.`);
    const sourceRecord = current.artifacts?.[args.sourceArtifactRef];
    if (!sourceRecord?.path || sourceRecord.mediaKind !== "video") throw new Error(`Evidence source artifact must be a registered video: ${args.sourceArtifactRef}`);
    if (sourceRecord.sha256 !== index.source.sha256) throw new Error("Evidence source artifact does not match the registered index hash.");
    const node = index.levels.flatMap((level) => level.nodes.map((item) => ({ ...item, level: level.level }))).find((item) => item.nodeId === args.nodeId);
    if (!node) throw new Error(`Evidence node is not registered: ${args.nodeId}`);
    const clipArtifactRef = `video-evidence-clip:${args.clipId}`;
    const receiptArtifactRef = `${clipArtifactRef}:receipt`;
    if (current.evidenceClips?.some((clip) => clip.clipId === args.clipId)) throw new Error(`Evidence clip already exists: ${args.clipId}`);
    const sourceDurationSeconds = Number(index.source.duration.value) / Number(index.source.duration.rate);
    const paddingSeconds = Number(args.paddingSeconds ?? 0);
    const startSeconds = Math.max(0, Number(node.range.start.value) / Number(node.range.start.rate) - paddingSeconds);
    const nodeEndSeconds = Number(node.range.start.value) / Number(node.range.start.rate) + Number(node.range.duration.value) / Number(node.range.duration.rate);
    const endSeconds = Math.min(sourceDurationSeconds, nodeEndSeconds + paddingSeconds);
    const rightsStatus = sourceRecord.metadata?.rightsStatus ?? (sourceRecord.metadata?.referenceOnly ? "reference_only" : "unknown");
    const result = await materializeEvidenceClip({
      ...args,
      sourcePath: sourceRecord.path,
      sourceSha256: sourceRecord.sha256,
      sourceDurationSeconds,
      indexId: query.plan.indexId,
      startSeconds,
      endSeconds,
      sourceArtifactRef: args.sourceArtifactRef,
      outputArtifactRef: clipArtifactRef,
      evidenceRefs: node.evidenceRefs,
      rightsStatus,
      retrievalTraceRef: `video-retrieval-trace:${args.queryId}`
    });
    const clipRecord = await inspectArtifact({ ...args, artifactRef: clipArtifactRef, path: result.outputPath, stage: "research", mediaKind: "video", metadata: { canvasEssential: true, referenceOnly: true, reviewOnly: true, deliveryEligible: false, rightsStatus, queryId: args.queryId, nodeId: args.nodeId, startSeconds, endSeconds, durationSeconds: result.durationSeconds, sourceArtifactRefs: [args.sourceArtifactRef], receiptArtifactRef } });
    const receiptRecord = await inspectArtifact({ ...args, artifactRef: receiptArtifactRef, path: result.receiptPath, stage: "research", mediaKind: "document", metadata: { internal: true, referenceOnly: true, reviewOnly: true, sourceArtifactRefs: [args.sourceArtifactRef, clipArtifactRef], queryId: args.queryId, nodeId: args.nodeId } });
    const response = await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.evidenceClips ??= [];
      run.evidenceClips.push({ clipId: args.clipId, artifactRef: clipArtifactRef, receiptArtifactRef, queryId: args.queryId, nodeId: args.nodeId, startSeconds, endSeconds, durationSeconds: result.durationSeconds, rightsStatus, deliveryEligible: false, status: "ready_for_human_review" });
      run.artifacts ??= {};
      run.artifacts[clipArtifactRef] = clipRecord;
      run.artifacts[receiptArtifactRef] = receiptRecord;
      upsertExecutionCanvasNode(run, { id: `evidence-clip:${args.clipId}`, type: "artifact", label: `证据片段 · ${args.nodeId}`, detail: `${startSeconds.toFixed(2)}–${endSeconds.toFixed(2)}s · 仅供审看 · 不进入交付`, stage: "research", status: "complete", artifactRef: clipArtifactRef, metadata: { canvasEssential: true, referenceOnly: true, reviewOnly: true, deliveryEligible: false, rightsStatus, queryId: args.queryId, nodeId: args.nodeId, sourceArtifactRefs: [args.sourceArtifactRef], receiptArtifactRef } }, `evidence-query:${args.queryId}`);
      run.events.push(event(run, "video.evidence.clip_materialized", "research", `${args.queryId} · ${args.nodeId} · ${result.durationSeconds}s review-only clip`));
      return run;
    } })), args);
    return { ...response, evidenceClip: { clipId: args.clipId, artifactRef: clipArtifactRef, receiptArtifactRef, outputPath: result.outputPath, receiptPath: result.receiptPath, durationSeconds: result.durationSeconds, deliveryEligible: false } };
  }
  if (name === "directorx_record_video_retrieval_trace") {
    const current = await readRun(args); const query = recordVideoRetrievalTrace(current, args.trace); const written = await writeMediaEvidenceArtifacts({ ...args, query });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) { recordVideoRetrievalTrace(run, args.trace); run.artifacts ??= {}; for (const record of Object.values(written)) run.artifacts[record.artifactRef] = artifactRecord({ ...record, stage: "research" }); run.events.push(event(run, "video.retrieval.stopped", "research", `${args.trace.queryId} · ${args.trace.stopReason}`)); return run; } })), args);
  }
  if (name === "directorx_finalize_evidence_bundle") {
    const current = await readRun(args); const bundle = finalizeEvidenceBundle(current, args.bundle); const query = current.videoEvidenceQueries[args.bundle.queryId]; const written = await writeMediaEvidenceArtifacts({ ...args, query });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) { finalizeEvidenceBundle(run, args.bundle); run.artifacts ??= {}; for (const record of Object.values(written)) run.artifacts[record.artifactRef] = artifactRecord({ ...record, stage: "research" }); run.events.push(event(run, "evidence.bundle.finalized", "research", `${bundle.bundleId} · coverage ${bundle.coverage}`)); return run; } })), args);
  }
  if (name === "directorx_register_timeline_revision") return await mutateEditSession(args, (run) => registerTimelineRevision(run, args.revision), "timeline.revision.registered", args.revision.revisionId);
  if (name === "directorx_export_timeline_interchange") {
    const current = await readRun(args);
    const revision = current.editSession?.revisions?.[args.revisionId];
    if (!revision) throw new Error(`Unknown canonical timeline revision: ${args.revisionId}`);
    const bundle = await writeDirectorXTimelineInterchange({ projectPath: args.projectPath, runId: args.runId, revision, artifacts: current.artifacts });
    const records = {};
    for (const result of Object.values(bundle.written)) records[result.artifactRef] = await inspectArtifact({ ...args, artifactRef: result.artifactRef, path: result.path, stage: "edit", mediaKind: "document", metadata: { canvasEssential: result.artifactRef === "timeline_interchange.dx.json", sourceArtifactRefs: ["timeline_revision.json", ...bundle.document.mediaBindings.map((binding) => binding.artifactRef).filter(Boolean)], interchangeId: bundle.document.interchangeId, format: bundle.document.format } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.artifacts ??= {};
      Object.assign(run.artifacts, records);
      run.timelineInterchange = { documentArtifactRef: "timeline_interchange.dx.json", manifestArtifactRef: "timeline_interchange_manifest.json", lossReportArtifactRef: "timeline_interchange_loss_report.json", roundtripArtifactRef: "roundtrip_validation.json", revisionId: args.revisionId, format: bundle.document.format, status: bundle.roundtrip.status, handoffReady: bundle.manifest.handoffReady };
      upsertExecutionCanvasNode(run, { id: `timeline-interchange:${args.revisionId}`, type: "artifact", label: "剪辑时间线交换包", detail: `${bundle.document.format} · round trip ${bundle.roundtrip.status} · media relink ${bundle.roundtrip.mediaRelinkReady ? "ready" : "required"}`, stage: "edit", status: bundle.roundtrip.status === "passed" ? "complete" : "blocked", artifactRef: "timeline_interchange.dx.json", metadata: { canvasEssential: true, sourceArtifactRefs: ["timeline_revision.json"], relatedArtifactRefs: ["timeline_interchange_manifest.json", "timeline_interchange_loss_report.json", "roundtrip_validation.json"], revisionId: args.revisionId, format: bundle.document.format, handoffReady: bundle.manifest.handoffReady } }, "stage:edit");
      run.events.push(event(run, "timeline.interchange.exported", "edit", `${args.revisionId} · ${bundle.roundtrip.status} · relink ${bundle.roundtrip.mediaRelinkReady ? "ready" : "required"}`));
      return run;
    } })), args);
  }
  if (name === "directorx_create_review_session") return await mutateReviewSession(args, (run) => createReviewSession(run, args.session), "review.session.created", args.session.reviewSessionId);
  if (name === "directorx_update_review_transport") return await mutateReviewSession(args, (run) => updateReviewTransport(run, args.update), "review.transport.updated", `${args.update.reviewSessionId} · r${args.update.expectedRevision + 1}`);
  if (name === "directorx_register_edit_intent") return await mutateEditSession(args, (run) => registerEditIntent(run, args.intent), "edit.intent.registered", args.intent.intentId);
  if (name === "directorx_compile_edit_graph") return await mutateEditSession(args, (run) => compileEditGraph(run, args.graph), "edit.graph.compiled", `${args.graph.graphId} · ${args.graph.nodes.length} nodes`);
  if (name === "directorx_register_timeline_patch") return await mutateEditSession(args, (run) => registerTimelinePatch(run, args.patch), "timeline.patch.dry_run", `${args.patch.patchId} · ${args.patch.operations.length} operations`);
  if (name === "directorx_create_timeline_preview") return await mutateEditSession(args, (run) => createPatchPreview(run, args), "timeline.patch.previewed", args.authorSessionId, (result) => ({ previewId: result.preview.previewId, previewToken: result.previewToken, expiresAt: result.preview.expiresAt, patchDigest: result.preview.patchDigest }));
  if (name === "directorx_commit_timeline_patch") return await mutateEditSession(args, (run) => {
    if (run.editSession?.patch?.requiresUserApproval) {
      const approval = requireResolvedInteraction(run, args.interactionRequestId, "edit_change");
      const answer = Object.values(approval.answers ?? {}).map(String).join(" ");
      if (/返回|拒绝|继续调整|不提交/i.test(answer) || !/提交|确认|批准|同意|commit|approve/i.test(answer)) throw new Error("The request_user_input answer did not approve committing this edit patch.");
    }
    const patch = commitTimelinePatch(run, args);
    markOpenCutEditCommitted(run, args.patchId);
    return patch;
  }, "timeline.patch.committed", args.patchId);
  if (name === "directorx_start_opencut_editor") {
    const current = await readRun(args);
    const source = current.artifacts?.[args.sourceArtifactRef];
    if (!source?.path) throw new Error("Director X Cut source media is unavailable.");
    const sourceDetails = await resolveWorkspaceMediaFile(args.projectPath, source.path);
    if (sourceDetails.size <= 0) throw new Error("Director X Cut source media must be a non-empty file.");
    let editorSession;
    let snapshot = await updateRun({ ...args, mutate(run) {
      requireResolvedInteraction(run, args.interactionRequestId, "post_production_edit");
      editorSession = createOpenCutEditorSession(run, args);
      markOpenCutServiceRunning(run, editorSession.editorSessionId);
      run.events.push(event(run, "opencut.editor.started", "edit", `${editorSession.editorSessionId} · ${args.sourceArtifactRef}`));
      return run;
    } });
    const written = await writeOpenCutEditorArtifacts({ projectPath: args.projectPath, runId: args.runId, session: snapshot.openCutEditor.sessions[editorSession.editorSessionId] });
    const records = {};
    for (const result of Object.values(written)) records[result.artifactRef] = await inspectArtifact({ ...args, artifactRef: result.artifactRef, path: result.path, stage: "edit", mediaKind: "document", metadata: { canvasEssential: result.artifactRef === "opencut_project.json", sourceArtifactRefs: [args.sourceArtifactRef], editorSessionId: editorSession.editorSessionId, upstreamCommit: editorSession.engine.commit } });
    snapshot = await updateRun({ ...args, mutate(run) {
      run.artifacts ??= {}; Object.assign(run.artifacts, records);
      upsertOpenCutCanvasNode(run, run.openCutEditor.sessions[editorSession.editorSessionId]);
      return run;
    } });
    const canvasResponse = await withBrowserCanvas(publicSnapshot(snapshot), args);
    const editorBinding = await bindOpenCutEditorBrowser(snapshot, args, canvasResponse.browserCanvasUrl);
    return {
      ...canvasResponse,
      editor: getOpenCutEditorStatus(snapshot),
      ...editorBinding
    };
  }
  if (name === "directorx_get_opencut_editor_status") {
    const run = await readRun(args);
    const activeId = run.openCutEditor?.activeSessionId;
    const active = activeId ? run.openCutEditor.sessions?.[activeId] : null;
    if (!active || ["completed", "cancelled", "failed"].includes(active.status)) return { ...getOpenCutEditorStatus(run), editorUrl: null, editorHostAction: null, editorTurnEndAction: null };
    const canvasResponse = await withBrowserCanvas(publicSnapshot(run), args);
    return { ...getOpenCutEditorStatus(run), browserCanvasUrl: canvasResponse.browserCanvasUrl, ...(await bindOpenCutEditorBrowser(run, args, canvasResponse.browserCanvasUrl)) };
  }
  if (name === "directorx_propose_evidence_rough_cut") {
    let result;
    let snapshot = await updateRun({ ...args, mutate(run) {
      result = proposeEvidenceRoughCut(run, args);
      run.events.push(event(run, "opencut.rough_cut.proposed", "edit", `${args.proposalId} · ${result.proposal.removedDurationSeconds.toFixed(2)}s removed · ${result.proposal.operationCount} operations`));
      return run;
    } });
    const proposalWritten = await writeEvidenceRoughCutArtifact({ projectPath: args.projectPath, runId: args.runId, proposal: result.proposal });
    const editorWritten = await writeOpenCutEditorArtifacts({ projectPath: args.projectPath, runId: args.runId, session: snapshot.openCutEditor.sessions[args.editorSessionId] });
    const records = {};
    records[proposalWritten.artifactRef] = await inspectArtifact({ ...args, ...proposalWritten, stage: "edit", mediaKind: "document", metadata: { canvasEssential: true, owner: "DX-Editor", proposalId: args.proposalId, editorSessionId: args.editorSessionId, sourceArtifactRefs: [result.proposal.sourceArtifactRef, "opencut_project.json", ...result.proposal.evidenceRefs] } });
    for (const written of Object.values(editorWritten)) records[written.artifactRef] = await inspectArtifact({ ...args, ...written, stage: "edit", mediaKind: "document", metadata: { canvasEssential: ["opencut_project.json", "opencut_edit_result.json"].includes(written.artifactRef), editorSessionId: args.editorSessionId, sourceArtifactRefs: [result.proposal.sourceArtifactRef, proposalWritten.artifactRef] } });
    snapshot = await updateRun({ ...args, mutate(run) {
      run.artifacts ??= {};
      Object.assign(run.artifacts, records);
      const proposal = run.roughCutProposals[args.proposalId];
      upsertOpenCutCanvasNode(run, run.openCutEditor.sessions[args.editorSessionId]);
      upsertExecutionCanvasNode(run, {
        id: `rough-cut:${args.proposalId}`,
        type: "artifact",
        label: "DX-Editor · 证据粗剪草稿",
        detail: `移除 ${proposal.removedDurationSeconds.toFixed(2)}s · ${proposal.operationCount} 项可逆操作 · 等待原生确认`,
        stage: "edit",
        status: "active",
        artifactRef: proposalWritten.artifactRef,
        metadata: { owner: "DX-Editor", proposalId: args.proposalId, editorSessionId: args.editorSessionId, requiresNativeApproval: true, sourceArtifactRefs: [proposal.sourceArtifactRef, ...proposal.evidenceRefs] }
      }, `editor:opencut:${args.editorSessionId}`);
      return run;
    } });
    const canvasResponse = await withBrowserCanvas(publicSnapshot(snapshot), args);
    return {
      ...canvasResponse,
      editor: getOpenCutEditorStatus(snapshot),
      roughCutProposal: result.proposal,
      proposalArtifactRef: proposalWritten.artifactRef,
      nextTool: "directorx_import_opencut_edit_result",
      ...(await bindOpenCutEditorBrowser(snapshot, args, canvasResponse.browserCanvasUrl))
    };
  }
  if (name === "directorx_import_opencut_edit_result") {
    let imported;
    let editInteraction;
    let snapshot = await updateRun({ ...args, mutate(run) {
      imported = importOpenCutEditorDraft(run, args);
      editInteraction = requestNativeInteraction(run, {
        kind: "edit_change",
        gateKey: `opencut:${args.editorSessionId}:${imported.patch.patchId}`,
        reason: `Director X Cut 已生成 ${imported.patch.operations.length} 项时间线修改，提交后必须重渲染并重新执行全帧质量审查。`,
        questions: [{ header: "剪辑提交", id: "manual_edit_commit", question: `是否提交“${imported.patch.summary}”并进入重渲染？`, options: [{ label: "提交并重渲染 (Recommended)", description: "提交当前可回滚补丁，随后重渲染并重新进行全帧与音频审查。" }, { label: "返回继续调整", description: "不提交补丁，返回 Director X Cut 继续修改。" }] }]
      });
      run.events.push(event(run, "opencut.draft.imported", "edit", `${args.editorSessionId} · ${imported.patch.operations.length} operations`));
      if (!editInteraction.deduplicated) run.events.push(event(run, "interaction.requested", "edit", `${editInteraction.request.kind} · ${editInteraction.request.requestId}`));
      return run;
    } });
    const editorWritten = await writeOpenCutEditorArtifacts({ projectPath: args.projectPath, runId: args.runId, session: snapshot.openCutEditor.sessions[args.editorSessionId] });
    const editWritten = await writeEditArtifacts({ projectPath: args.projectPath, runId: args.runId, editSession: snapshot.editSession });
    const records = {};
    for (const result of [...Object.values(editorWritten), ...Object.values(editWritten)]) records[result.artifactRef] = await inspectArtifact({ ...args, artifactRef: result.artifactRef, path: result.path, stage: "edit", mediaKind: "document", metadata: { canvasEssential: ["opencut_project.json", "opencut_edit_result.json", "timeline_patch.json"].includes(result.artifactRef), sourceArtifactRefs: [snapshot.openCutEditor.sessions[args.editorSessionId].sourceArtifactRef], editorSessionId: args.editorSessionId } });
    snapshot = await updateRun({ ...args, mutate(run) { run.artifacts ??= {}; Object.assign(run.artifacts, records); upsertOpenCutCanvasNode(run, run.openCutEditor.sessions[args.editorSessionId]); return run; } });
    const response = await withBrowserCanvas(publicSnapshot(snapshot), args);
    return { ...response, editor: getOpenCutEditorStatus(snapshot), patchPreview: { patchId: imported.patch.patchId, previewId: imported.preview.previewId, previewToken: imported.previewToken, expiresAt: imported.preview.expiresAt }, editInteraction };
  }
  if (name === "directorx_confirm_intake") {
    const written = await writeIntakeConfirmation(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      if (args.intake.questionsAsked.length || args.intake.userAnswers.length) requireResolvedInteraction(run, args.interactionRequestId, "intake");
      confirmIntake(run, args.intake);
      run.artifacts ??= {};
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "intake" });
      run.events.push(event(run, "intake.confirmed", "intake", `${args.intake.decisions.length} production decisions · ${args.intake.questionsAsked.length} answered questions`));
      return run;
    } })), args);
  }
  if (name === "directorx_write_director_document") {
    const current = await readRun(args);
    if (current.pipeline?.id === "reference-replication") {
      const required = ["reference_media_bundle.json", "reference_replication_plan.json", "reference_shot_blueprint.json"];
      const missing = required.filter((artifactRef) => !current.artifacts?.[artifactRef]);
      if (missing.length) throw new Error(`Reference-replication Director.md must follow video understanding and the replication plan. Missing: ${missing.join(", ")}`);
    }
    const written = await writeDirectorDocument(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      const stage = run.pipeline?.id === "reference-replication" ? "research" : "intake";
      run.directorDocument = written;
      run.artifacts ??= {};
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage });
      run.artifacts[written.contractArtifactRef] = artifactRecord({ artifactRef: written.contractArtifactRef, path: written.contractPath, fingerprint: written.fingerprint, stage });
      run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } };
      const node = { id: "document:director", type: "document", label: "Director.md", detail: args.director.logline, stage, status: "complete", artifactRef: "Director.md", metadata: { path: written.path, contractRef: written.contractArtifactRef, fingerprint: written.fingerprint }, updatedAt: new Date().toISOString() };
      const index = run.canvas.nodes.findIndex((item) => item.id === node.id); if (index >= 0) run.canvas.nodes[index] = node; else run.canvas.nodes.push(node);
      run.events.push(event(run, "director.document.written", stage, written.path));
      return run;
    } })), args);
  }
  if (name === "directorx_register_layered_collage_plan") {
    const current = await readRun(args);
    if (current.pipeline?.id !== "layered-collage") throw new Error("Select the layered-collage pipeline before registering its production plan.");
    const written = await writeLayeredCollagePlan(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.layeredCollagePlan = args.plan;
      run.artifacts ??= {};
      const stages = { "audio_layer_plan.json": "script", "layered_composition_config.json": "edit" };
      for (const result of Object.values(written)) run.artifacts[result.artifactRef] = artifactRecord({ ...result, stage: stages[result.artifactRef] ?? "storyboard" });
      run.events.push(event(run, "layered.collage.plan.registered", "storyboard", `${args.plan.scenes.length} scene(s) · ${args.plan.scenes.flatMap((scene) => scene.layers).length} layers`));
      return run;
    } })), args);
  }
  if (name === "directorx_extract_chroma_layers") {
    const current = await readRun(args);
    if (current.pipeline?.id !== "layered-collage") throw new Error("Chroma layer extraction requires the layered-collage pipeline.");
    const extracted = await extractChromaLayers(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.assets ??= [];
      run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } };
      for (const output of extracted.outputs) {
        const config = args.layers.find((layer) => layer.layerId === output.layerId);
        const asset = { id: output.layerId, type: "image", label: config.label, sourceUrl: args.sourcePath, localPath: output.outputPath, previewUri: output.outputPath, rightsStatus: "project_generated", intendedUse: `layered collage ${config.role}`, fallback: "regenerate or adjust crop/key settings", stage: "generation", technicalRequirements: { alpha: true, crop: output.crop, sha256: output.sha256, sceneId: config.sceneId, role: config.role, zIndex: config.zIndex }, registeredAt: new Date().toISOString() };
        const existing = run.assets.findIndex((item) => item.id === asset.id); if (existing >= 0) run.assets[existing] = asset; else run.assets.push(asset);
        const node = { id: `asset:${asset.id}`, type: "image", label: asset.label, detail: `${config.role} · z${config.zIndex} · transparent PNG`, stage: "generation", status: "complete", previewUri: asset.previewUri, artifactRef: asset.localPath, metadata: asset.technicalRequirements, updatedAt: new Date().toISOString() };
        const nodeIndex = run.canvas.nodes.findIndex((item) => item.id === node.id); if (nodeIndex >= 0) run.canvas.nodes[nodeIndex] = node; else run.canvas.nodes.push(node);
      }
      run.events.push(event(run, "layered.assets.extracted", "generation", `${extracted.outputs.length} transparent PNG layers`));
      return run;
    } })), args);
  }
  if (name === "directorx_review_layered_collage_phase") {
    const current = await readRun(args);
    if (current.pipeline?.id !== "layered-collage") throw new Error("Layered collage review requires the layered-collage pipeline.");
    const written = await writeLayeredCollageReview(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.layeredCollageReviews ??= {};
      run.layeredCollageReviews[args.phase] = written.report;
      run.artifacts ??= {};
      const stage = args.phase === "static_layout" ? "storyboard" : args.phase === "motion_audio" ? "edit" : "review";
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage });
      run.events.push(event(run, `layered.review.${args.phase}`, stage, `${args.status} · ${args.checks.length} checks`));
      return run;
    } })), args);
  }
  if (name === "directorx_compile_camera_continuity_graph") {
    const compiled = compileCameraContinuityPlan(args.plan);
    const written = await writeCameraContinuityArtifacts({ ...args, ...compiled });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.cameraContinuityGraph = compiled.graph;
      run.cameraReferenceSelectionPlan = compiled.referencePlan;
      run.artifacts ??= {};
      for (const result of Object.values(written)) {
        run.artifacts[result.artifactRef] = artifactRecord({
          ...result,
          stage: "storyboard",
          metadata: {
            canvasEssential: false,
            internal: true,
            sourceArtifactRefs: ["shotlist.json", "keyframe_storyboard.json", "continuity_plan.json"]
          }
        });
      }
      run.events.push(event(run, "camera.continuity.compiled", "storyboard", `${compiled.graph.shots.length} shots · ${compiled.graph.cameras.length} cameras · ${compiled.graph.executionWaves.length} execution waves`));
      return run;
    } })), args);
  }
  if (name === "directorx_compile_scene_coverage_plan") {
    const current = await readRun(args);
    requirePipelineStage(current, "storyboard", "Scene coverage planning");
    const registeredShotlist = current.artifacts?.["shotlist.json"];
    if (!registeredShotlist?.path) throw new Error("Register the real shotlist.json before compiling scene coverage.");
    const verifiedShotlistRecord = await inspectArtifact({
      ...args,
      artifactRef: "shotlist.json",
      path: registeredShotlist.path,
      stage: registeredShotlist.stage ?? "storyboard",
      mediaKind: "document",
      metadata: registeredShotlist.metadata ?? {}
    });
    if (registeredShotlist.sha256 && registeredShotlist.sha256 !== verifiedShotlistRecord.sha256) {
      throw new Error("Registered shotlist.json changed after registration. Re-register it before scene coverage planning.");
    }
    let shotlist;
    try {
      shotlist = JSON.parse(await readFile(verifiedShotlistRecord.path, "utf8"));
    } catch {
      throw new Error("Registered shotlist.json must be valid JSON.");
    }
    const plan = bindSceneCoveragePlanToShotlist(
      compileSceneCoveragePlan(args.plan),
      { artifactRef: "shotlist.json", sha256: verifiedShotlistRecord.sha256, shotlist }
    );
    const written = await writeSceneCoveragePlan({ ...args, plan });
    const planRecord = await inspectArtifact({
      ...args,
      artifactRef: written.plan.artifactRef,
      path: written.plan.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: {
        internal: true,
        owner: "DX-Shot-Planner",
        sourceArtifactRefs: ["Director.md", "shotlist.json", "continuity_plan.json"].filter((ref) => ref === "shotlist.json" || current.artifacts?.[ref]),
        sequenceId: plan.sequenceId,
        overallScore: plan.overallScore,
        shotlistSha256: plan.sourceBinding.sha256
      }
    });
    const summaryRecord = await inspectArtifact({
      ...args,
      artifactRef: written.summary.artifactRef,
      path: written.summary.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: {
        canvasEssential: true,
        owner: "DX-Shot-Planner",
        sourceArtifactRefs: [planRecord.artifactRef],
        sequenceId: plan.sequenceId,
        overallScore: plan.overallScore
      }
    });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      run.sceneCoveragePlan = plan;
      run.artifacts ??= {};
      run.artifacts["shotlist.json"] = verifiedShotlistRecord;
      run.artifacts[planRecord.artifactRef] = planRecord;
      run.artifacts[summaryRecord.artifactRef] = summaryRecord;
      upsertExecutionCanvasNode(run, {
        id: `scene-coverage:${plan.sequenceId}`,
        type: "document",
        label: "场景覆盖与摄影执行",
        detail: `${plan.metrics.sceneCount} 个场景 · ${plan.metrics.shotCount} 个镜头 · ${plan.metrics.setupCount} 个摄影设置`,
        stage: "storyboard",
        status: plan.status === "ready" ? "complete" : "blocked",
        artifactRef: summaryRecord.artifactRef,
        metadata: {
          canvasEssential: true,
          sourceArtifactRefs: [planRecord.artifactRef],
          dimensions: plan.dimensions,
          setupGroups: plan.setupGroups.map((group) => ({ setupId: group.setupId, shotIds: group.shotIds })),
          blockerCodes: plan.blockers.map((item) => item.code),
          warningCodes: plan.warnings.map((item) => item.code)
        }
      }, "stage:storyboard");
      run.events.push(event(run, `storyboard.scene_coverage.${plan.status}`, "storyboard", `${plan.metrics.sceneCount} scenes · ${plan.metrics.setupCount} setups · score ${plan.overallScore}`));
      return run;
    } }), args);
  }
  if (name === "directorx_compile_transition_language_plan") {
    const current = await readRun(args);
    requirePipelineStage(current, "storyboard", "Transition language planning");
    if (current.sceneCoveragePlan?.status !== "ready") throw new Error("Compile a ready scene_coverage_plan.json before transition language planning.");
    if (current.sceneCoveragePlan.sequenceId !== args.plan.sequenceId) throw new Error("Scene coverage and transition language must use the same sequenceId.");
    const plan = compileTransitionLanguagePlan(args.plan);
    const written = await writeTransitionLanguagePlan({ ...args, plan });
    const planRecord = await inspectArtifact({
      ...args,
      artifactRef: written.plan.artifactRef,
      path: written.plan.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: {
        internal: true,
        sourceArtifactRefs: ["Director.md", "shotlist.json", "keyframe_storyboard.json", "continuity_plan.json"].filter((ref) => current.artifacts?.[ref]),
        renderer: plan.renderer,
        sequenceId: plan.sequenceId
      }
    });
    const summaryRecord = await inspectArtifact({
      ...args,
      artifactRef: written.summary.artifactRef,
      path: written.summary.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: {
        canvasEssential: true,
        sourceArtifactRefs: [planRecord.artifactRef],
        renderer: plan.renderer,
        sequenceId: plan.sequenceId
      }
    });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      run.transitionLanguagePlan = plan;
      run.artifacts ??= {};
      run.artifacts[planRecord.artifactRef] = planRecord;
      run.artifacts[summaryRecord.artifactRef] = summaryRecord;
      upsertExecutionCanvasNode(run, {
        id: `transitions:${plan.sequenceId}`,
        type: "document",
        label: "导演转场与镜头衔接",
        detail: `${plan.boundaries.length} 个镜头边界 · ${plan.metrics.audioBridgeCount} 个声音桥 · ${plan.renderer}`,
        stage: "storyboard",
        status: plan.status === "ready" ? "complete" : "blocked",
        artifactRef: summaryRecord.artifactRef,
        metadata: {
          canvasEssential: true,
          sourceArtifactRefs: [planRecord.artifactRef],
          blockers: plan.blockers,
          methods: plan.boundaries.map((boundary) => boundary.directorMethod)
        }
      }, "stage:storyboard");
      run.events.push(event(run, `transition.language.${plan.status}`, "storyboard", `${plan.boundaries.length} boundaries · ${plan.renderer}`));
      return run;
    } }), args);
  }
  if (name === "directorx_review_shot_sequence") {
    const current = await readRun(args);
    requirePipelineStage(current, "storyboard", "Shot sequence review");
    if (current.sceneCoveragePlan?.status !== "ready") throw new Error("Compile a ready scene_coverage_plan.json before reviewing the shot sequence.");
    if (current.sceneCoveragePlan.sequenceId !== args.review.sequenceId) throw new Error("Scene coverage and shot sequence review must use the same sequenceId.");
    const registeredShotlist = current.artifacts?.["shotlist.json"];
    if (!registeredShotlist?.path) throw new Error("Register the real shotlist.json before reviewing the shot sequence.");
    const verifiedShotlistRecord = await inspectArtifact({
      ...args,
      artifactRef: "shotlist.json",
      path: registeredShotlist.path,
      stage: registeredShotlist.stage ?? "storyboard",
      mediaKind: "document",
      metadata: registeredShotlist.metadata ?? {}
    });
    if (registeredShotlist.sha256 && registeredShotlist.sha256 !== verifiedShotlistRecord.sha256) {
      throw new Error("Registered shotlist.json changed after registration. Re-register it before sequence review.");
    }
    let shotlist;
    try {
      shotlist = JSON.parse(await readFile(verifiedShotlistRecord.path, "utf8"));
    } catch {
      throw new Error("Registered shotlist.json must be valid JSON.");
    }
    const review = bindShotSequenceReviewToShotlist(
      reviewShotSequence(args.review, current.transitionLanguagePlan),
      { artifactRef: "shotlist.json", sha256: verifiedShotlistRecord.sha256, shotlist }
    );
    const written = await writeShotSequenceReview({ ...args, review });
    const reviewRecord = await inspectArtifact({
      ...args,
      artifactRef: written.review.artifactRef,
      path: written.review.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: {
        internal: true,
        owner: "DX-Shot-Planner",
        sourceArtifactRefs: ["Director.md", "shotlist.json", "continuity_plan.json", "transition_language_plan.json"].filter((ref) => current.artifacts?.[ref]),
        sequenceId: review.sequenceId,
        overallScore: review.overallScore,
        shotlistSha256: review.sourceBinding.sha256
      }
    });
    const summaryRecord = await inspectArtifact({
      ...args,
      artifactRef: written.summary.artifactRef,
      path: written.summary.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: {
        canvasEssential: true,
        owner: "DX-Shot-Planner",
        sourceArtifactRefs: [reviewRecord.artifactRef, "transition_language_plan.md"].filter((ref) => ref === reviewRecord.artifactRef || current.artifacts?.[ref]),
        sequenceId: review.sequenceId,
        overallScore: review.overallScore
      }
    });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      run.shotSequenceReview = review;
      run.artifacts ??= {};
      run.artifacts["shotlist.json"] = verifiedShotlistRecord;
      run.artifacts[reviewRecord.artifactRef] = reviewRecord;
      run.artifacts[summaryRecord.artifactRef] = summaryRecord;
      upsertExecutionCanvasNode(run, {
        id: `shot-sequence:${review.sequenceId}`,
        type: "document",
        label: "导演级镜头序列审查",
        detail: `${review.shotOrder.length} 个镜头 · ${review.overallScore} 分 · ${review.blockers.length} 个阻塞项`,
        stage: "storyboard",
        status: review.status === "ready" ? "complete" : "blocked",
        artifactRef: summaryRecord.artifactRef,
        metadata: {
          canvasEssential: true,
          sourceArtifactRefs: summaryRecord.metadata.sourceArtifactRefs,
          dimensions: review.dimensions,
          blockerCodes: review.blockers.map((item) => item.code),
          warningCodes: review.warnings.map((item) => item.code)
        }
      }, "stage:storyboard");
      run.events.push(event(run, `storyboard.sequence_review.${review.status}`, "storyboard", `${review.shotOrder.length} shots · score ${review.overallScore}`));
      return run;
    } }), args);
  }
  if (name === "directorx_review_camera_references") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const reviewed = reviewCameraReferences(run.cameraContinuityGraph, run.cameraReferenceSelectionPlan, args);
      run.cameraContinuityGraph = reviewed.graph;
      run.cameraReferenceSelectionPlan = reviewed.referencePlan;
      const written = await writeCameraContinuityArtifacts({ ...args, ...reviewed });
      run.artifacts ??= {};
      for (const result of Object.values(written)) {
        run.artifacts[result.artifactRef] = artifactRecord({
          ...result,
          stage: "storyboard",
          metadata: {
            canvasEssential: false,
            internal: true,
            sourceArtifactRefs: ["shotlist.json", "keyframe_storyboard.json", "continuity_plan.json"],
            reviewerId: args.reviewerId
          }
        });
      }
      run.events.push(event(run, "camera.references.approved", "storyboard", `${reviewed.referencePlan.targets.length} first/last-frame targets · ${args.reviewerId}`));
      return run;
    } })), args);
  }
  if (name === "directorx_register_segment_continuity_plan") {
    const written = await writeSegmentContinuityPlan(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.segmentContinuityPlan = args.plan;
      run.segmentBoundaryFrames = {};
      run.boundaryContinuityReport = null;
      run.segmentStitchPlan = null;
      run.artifacts ??= {};
      for (const result of Object.values(written)) run.artifacts[result.artifactRef] = artifactRecord({ ...result, stage: "storyboard", metadata: { canvasEssential: true, sourceArtifactRefs: ["keyframe_storyboard.json", "continuity_plan.json"] } });
      run.events.push(event(run, "segment.continuity.planned", "storyboard", `${args.plan.segments.length} segment(s) · first/last-frame chain`));
      return run;
    } })), args);
  }
  if (name === "directorx_extract_segment_boundary_frames") {
    const current = await readRun(args);
    const receipt = await extractSegmentBoundaryFrames(args, current);
    const first = await inspectArtifact({ ...args, artifactRef: receipt.firstFrame.artifactRef, path: receipt.firstFrame.path, stage: "generation", mediaKind: "image", metadata: { canvasEssential: true, boundaryRole: "first", segmentId: receipt.segmentId, timeSeconds: receipt.firstFrame.timeSeconds, sourceArtifactRefs: [receipt.videoArtifactRef] } });
    const last = await inspectArtifact({ ...args, artifactRef: receipt.lastFrame.artifactRef, path: receipt.lastFrame.path, stage: "generation", mediaKind: "image", metadata: { canvasEssential: true, boundaryRole: "last", segmentId: receipt.segmentId, timeSeconds: receipt.lastFrame.timeSeconds, sourceArtifactRefs: [receipt.videoArtifactRef] } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      run.segmentBoundaryFrames ??= {};
      run.segmentBoundaryFrames[receipt.segmentId] = receipt;
      const index = await writeSegmentBoundaryIndex({ ...args, frames: run.segmentBoundaryFrames, segmentOrder: run.segmentContinuityPlan.segments.map((segment) => segment.segmentId) });
      const indexRecord = await inspectArtifact({ ...args, artifactRef: index.artifactRef, path: index.path, stage: "generation", mediaKind: "document", metadata: { canvasEssential: true, sourceArtifactRefs: Object.values(run.segmentBoundaryFrames).map((item) => item.videoArtifactRef) } });
      run.artifacts ??= {};
      run.artifacts[first.artifactRef] = first;
      run.artifacts[last.artifactRef] = last;
      run.artifacts[indexRecord.artifactRef] = indexRecord;
      run.events.push(event(run, "segment.boundaries.extracted", "generation", `${receipt.segmentId} · decoded first/last frames`));
      return run;
    } })), args);
  }
  if (name === "directorx_audit_segment_continuity") {
    const current = await readRun(args);
    const report = await auditSegmentContinuity(args, current);
    const written = await writeBoundaryContinuityReport({ ...args, report });
    const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: "review", mediaKind: "document", metadata: { canvasEssential: true, sourceArtifactRefs: ["segment_boundary_frames.json", "frame_handoff_manifest.json"] } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.boundaryContinuityReport = report;
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      run.events.push(event(run, `segment.continuity.${report.status}`, "review", `${report.boundaries.length} audited boundary(ies)`));
      return run;
    } })), args);
  }
  if (name === "directorx_register_segment_stitch_plan") {
    const current = await readRun(args);
    const written = await writeSegmentStitchPlan(args, current);
    const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: "edit", mediaKind: "document", metadata: { canvasEssential: true, sourceArtifactRefs: ["boundary_continuity_report.json", ...args.stitchPlan.clips.map((clip) => clip.videoArtifactRef)] } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.segmentStitchPlan = args.stitchPlan;
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      run.events.push(event(run, "segment.stitch.registered", "edit", `${args.stitchPlan.clips.length} audited clips`));
      return run;
    } })), args);
  }
  if (name === "directorx_register_longform_plan") {
    const current = await readRun(args);
    if (current.pipeline?.id !== "longform") throw new Error("Select the longform pipeline before registering a long-form plan.");
    const written = await writeLongformPlan(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.longformPlan = args.plan;
      run.artifacts ??= {};
      for (const result of Object.values(written)) run.artifacts[result.artifactRef] = artifactRecord({ ...result, stage: "storyboard" });
      run.events.push(event(run, "longform.plan.registered", "storyboard", `${args.plan.segments.length} linked segments`));
      return run;
    } })), args);
  }
  if (name === "directorx_register_longform_stitch_plan") {
    const run = await readRun(args);
    const written = await writeLongformStitchPlan({ ...args, run });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(next) {
      next.longformStitchPlan = args.stitchPlan;
      next.artifacts ??= {};
      next.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "edit" });
      next.events.push(event(next, "longform.stitch.registered", "edit", `${args.stitchPlan.clips.length} selected clips`));
      return next;
    } })), args);
  }
  if (name === "directorx_register_asset_search_plan") {
    const current = await readRun(args);
    if (!current.directorDocument && current.pipeline?.id !== "reference-replication") throw new Error("Generate Director.md before registering the asset search plan.");
    const plan = registerAssetSearchPlan(current, args.plan);
    const written = await writeAssetSearchPlan({ ...args, plan });
    const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: "research", mediaKind: "document", metadata: { canvasEssential: true, owner: "DX-Asset-Manager", sourceArtifactRefs: current.directorDocument ? ["Director.md"] : [] } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.assetSearchPlan = plan; run.artifacts ??= {}; run.artifacts[record.artifactRef] = record;
      upsertExecutionCanvasNode(run, { id: "research:asset-search", type: "artifact", label: "公开素材检索计划", detail: `${plan.queries.length} queries · ${plan.requiredAssetTypes.length} roles · official first`, stage: "research", status: "active", artifactRef: record.artifactRef, metadata: { owner: "DX-Asset-Manager", sourcePriority: plan.sourcePriority, sourceArtifactRefs: run.directorDocument ? ["Director.md"] : [] } }, "stage:research");
      run.events.push(event(run, "asset.search.plan.registered", "research", `${plan.queries.length} queries · ${plan.sourcePriority.join(" > ")}`)); return run;
    } })), args);
  }
  if (name === "directorx_record_reference_download_consent") {
    const written = await writeReferenceDownloadConsent(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      requireResolvedInteraction(run, args.interactionRequestId, "reference_download");
      run.referenceDownloadConsent = args.consent;
      run.artifacts ??= {};
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "research" });
      run.events.push(event(run, `reference.download.${args.consent.decision}`, "research", `${args.consent.referenceIds.length} scoped reference(s)`));
      return run;
    } })), args);
  }
  if (name === "directorx_ingest_reference_video") {
    const run = await readRun(args);
    assertReferenceDownloadAuthorized({ consent: run.referenceDownloadConsent, referenceId: args.referenceId, url: args.url });
    const ingested = await ingestReferenceVideo(args);
    const clipArtifactRef = `reference:${ingested.referenceId}:video`;
    const receiptArtifactRef = `reference:${ingested.referenceId}:receipt`;
    const fullFrameManifestArtifactRef = `reference:${ingested.referenceId}:full-frame-manifest`;
    const contactSheetArtifactRef = `reference:${ingested.referenceId}:contact-sheet`;
    const audioArtifactRef = `reference:${ingested.referenceId}:audio`;
    const researchSources = ["web_research_receipt.json", "reference_video_assessment.json"].filter((artifactRef) => run.artifacts?.[artifactRef]);
    const clipRecord = await inspectArtifact({
      ...args, artifactRef: clipArtifactRef, path: ingested.clipPath, stage: "research", mediaKind: "video",
      metadata: { canvasEssential: true, referenceOnly: true, sourceUrl: args.url, rightsStatus: ingested.rightsStatus, sourceArtifactRefs: researchSources }
    });
    const receiptRecord = await inspectArtifact({
      ...args, artifactRef: receiptArtifactRef, path: ingested.receiptPath, stage: "research", mediaKind: "document",
      metadata: { internal: true, referenceOnly: true, sourceArtifactRefs: [clipArtifactRef] }
    });
    const manifestRecord = await inspectArtifact({
      ...args, artifactRef: fullFrameManifestArtifactRef, path: ingested.frameManifestPath, stage: "research", mediaKind: "document",
      metadata: { internal: true, referenceOnly: true, sourceArtifactRefs: [clipArtifactRef], fullFrameCoverage: ingested.fullFrameCoverage }
    });
    const identityRecord = await inspectArtifact({
      ...args, artifactRef: ingested.frameIdentityArtifactRef, path: ingested.frameIdentityPath, stage: "research", mediaKind: "document",
      metadata: { internal: true, referenceOnly: true, sourceArtifactRefs: [clipArtifactRef, fullFrameManifestArtifactRef] }
    });
    const contactSheetRecord = await inspectArtifact({
      ...args, artifactRef: contactSheetArtifactRef, path: ingested.contactSheetPath, stage: "research", mediaKind: "image",
      metadata: { canvasEssential: true, referenceOnly: true, sourceArtifactRefs: [clipArtifactRef, fullFrameManifestArtifactRef] }
    });
    const audioRecord = ingested.audioPath ? await inspectArtifact({
      ...args, artifactRef: audioArtifactRef, path: ingested.audioPath, stage: "research", mediaKind: "audio",
      metadata: { canvasEssential: true, referenceOnly: true, sourceArtifactRefs: [clipArtifactRef], rightsStatus: ingested.rightsStatus }
    }) : null;
    const mediaBundle = {
      schemaVersion: "1.0",
      referenceId: ingested.referenceId,
      sourceUrl: args.url,
      rightsStatus: ingested.rightsStatus,
      videoArtifactRef: clipArtifactRef,
      audioArtifactRef: audioRecord?.artifactRef ?? null,
      contactSheetArtifactRef,
      fullFrameManifestArtifactRef,
      frameIdentityArtifactRef: ingested.frameIdentityArtifactRef,
      frameCount: ingested.framePaths.length,
      fullFrameCoverage: ingested.fullFrameCoverage,
      analysisSection: ingested.analysisSection,
      understandingRoute: ["yt-dlp", "FFprobe", "FFmpeg", "directorx_read_video", "DX-Reference-Analyst"]
    };
    const mediaBundlePath = await writeExecutionReceipt(args.projectPath, args.runId, "reference_media_bundle.json", mediaBundle);
    const mediaBundleRecord = await inspectArtifact({ ...args, artifactRef: "reference_media_bundle.json", path: mediaBundlePath, stage: "research", mediaKind: "document", metadata: { canvasEssential: true, referenceOnly: true, sourceArtifactRefs: [clipArtifactRef, audioArtifactRef, fullFrameManifestArtifactRef, ingested.frameIdentityArtifactRef].filter(Boolean) } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.references ??= [];
      const reference = {
        referenceId: ingested.referenceId,
        receiptPath: ingested.receiptPath,
        frameCount: ingested.framePaths.length,
        fullFrameCoverage: ingested.fullFrameCoverage,
        rightsStatus: ingested.rightsStatus,
        sourceUrl: args.url,
        analysisSection: ingested.analysisSection,
        clipArtifactRef,
        receiptArtifactRef,
        fullFrameManifestArtifactRef,
        frameIdentityArtifactRef: ingested.frameIdentityArtifactRef,
        contactSheetArtifactRef,
        audioArtifactRef: audioRecord?.artifactRef ?? null
      };
      const referenceIndex = run.references.findIndex((item) => item.referenceId === reference.referenceId);
      if (referenceIndex >= 0) run.references[referenceIndex] = reference;
      else run.references.push(reference);
      run.artifacts ??= {};
      run.artifacts[clipRecord.artifactRef] = clipRecord;
      run.artifacts[receiptRecord.artifactRef] = receiptRecord;
      run.artifacts[manifestRecord.artifactRef] = manifestRecord;
      run.artifacts[identityRecord.artifactRef] = identityRecord;
      run.artifacts[contactSheetRecord.artifactRef] = contactSheetRecord;
      if (audioRecord) run.artifacts[audioRecord.artifactRef] = audioRecord;
      run.artifacts[mediaBundleRecord.artifactRef] = mediaBundleRecord;
      upsertExecutionCanvasNode(run, { id: `reference-bundle:${ingested.referenceId}`, type: "artifact", label: "参考片视频·音频理解包", detail: `${ingested.framePaths.length} 全帧 · ${audioRecord ? "音频已提取" : "无音频"} · 等待复刻分析`, stage: "research", status: "complete", artifactRef: mediaBundleRecord.artifactRef, previewUri: contactSheetRecord.path, metadata: { sourceArtifactRefs: [clipArtifactRef, audioArtifactRef, contactSheetArtifactRef, fullFrameManifestArtifactRef].filter(Boolean), referenceOnly: true } }, "stage:research");
      run.events.push(event(run, "reference.video.ingested", "research", `${ingested.referenceId} · ${ingested.framePaths.length} / ${ingested.fullFrameCoverage.identityFrameCount} decoded frames`));
      return run;
    } })), args);
  }
  if (name === "directorx_read_video") {
    const current = await readRun(args);
    const sourceRecord = args.sourceArtifactRef ? current.artifacts?.[args.sourceArtifactRef] : null;
    if (args.sourceArtifactRef && !sourceRecord) throw new Error(`Video source artifact is not registered: ${args.sourceArtifactRef}`);
    if (sourceRecord && sourceRecord.mediaKind !== "video") throw new Error("Video source artifact must have mediaKind=video.");
    if (!sourceRecord && !args.videoPath) throw new Error("Provide sourceArtifactRef or a project-contained videoPath.");
    const transcriptRecord = args.transcriptArtifactRef ? current.artifacts?.[args.transcriptArtifactRef] : null;
    if (args.transcriptArtifactRef && !transcriptRecord) throw new Error(`Transcript artifact is not registered: ${args.transcriptArtifactRef}`);
    const videoPath = sourceRecord?.path ?? args.videoPath;
    const transcriptPath = transcriptRecord?.path ?? args.transcriptPath;
    const result = await readVideoEvidence({ ...args, videoPath, transcriptPath });
    const stage = current.stage ?? "research";
    const sourceArtifactRef = sourceRecord?.artifactRef ?? `video-read:${result.readId}:source`;
    const inheritedReferenceOnly = sourceRecord?.metadata?.referenceOnly === true;
    const records = {};
    if (!sourceRecord) records[sourceArtifactRef] = await inspectArtifact({
      ...args, artifactRef: sourceArtifactRef, path: videoPath, stage, mediaKind: "video",
      metadata: { canvasEssential: true, owner: "DX-Reference-Analyst", sourceArtifactRefs: [] }
    });
    const receiptArtifactRef = `video-read:${result.readId}:receipt`;
    const manifestArtifactRef = `video-read:${result.readId}:manifest`;
    const contactSheetArtifactRef = result.contactSheetPath ? `video-read:${result.readId}:contact-sheet` : null;
    const transcriptArtifactRef = result.transcriptPath ? `video-read:${result.readId}:transcript` : null;
    records[receiptArtifactRef] = await inspectArtifact({ ...args, artifactRef: receiptArtifactRef, path: result.receiptPath, stage, mediaKind: "document", metadata: { internal: true, referenceOnly: inheritedReferenceOnly, owner: "DX-Reference-Analyst", sourceArtifactRefs: [sourceArtifactRef] } });
    records[manifestArtifactRef] = await inspectArtifact({ ...args, artifactRef: manifestArtifactRef, path: result.manifestPath, stage, mediaKind: "document", metadata: { internal: true, referenceOnly: inheritedReferenceOnly, owner: "DX-Reference-Analyst", profile: result.plan.profile, sourceArtifactRefs: [sourceArtifactRef] } });
    if (contactSheetArtifactRef) records[contactSheetArtifactRef] = await inspectArtifact({ ...args, artifactRef: contactSheetArtifactRef, path: result.contactSheetPath, stage, mediaKind: "image", metadata: { canvasEssential: true, referenceOnly: inheritedReferenceOnly, owner: "DX-Reference-Analyst", profile: result.plan.profile, sourceArtifactRefs: [sourceArtifactRef, manifestArtifactRef] } });
    if (transcriptArtifactRef) records[transcriptArtifactRef] = await inspectArtifact({ ...args, artifactRef: transcriptArtifactRef, path: result.transcriptPath, stage, mediaKind: "document", metadata: { canvasEssential: true, referenceOnly: inheritedReferenceOnly, owner: "DX-Reference-Analyst", segmentCount: result.transcript?.segments.length ?? 0, sourceArtifactRefs: [sourceArtifactRef, args.transcriptArtifactRef].filter(Boolean) } });
    if (result.frameIdentityPath && result.frameIdentityArtifactRef) records[result.frameIdentityArtifactRef] = await inspectArtifact({ ...args, artifactRef: result.frameIdentityArtifactRef, path: result.frameIdentityPath, stage, mediaKind: "document", metadata: { internal: true, referenceOnly: inheritedReferenceOnly, owner: "DX-Reference-Analyst", sourceArtifactRefs: [sourceArtifactRef, manifestArtifactRef], fullFrameCoverage: result.fullFrameCoverage } });
    const previewCount = Math.min(12, result.frames.length);
    const previewIndices = previewCount === 0 ? [] : previewCount === 1 ? [0] : Array.from({ length: previewCount }, (_, index) => Math.round(index * (result.frames.length - 1) / (previewCount - 1)));
    const frameArtifactRefs = [];
    for (const frameIndex of [...new Set(previewIndices)]) {
      const frame = result.frames[frameIndex];
      const artifactRef = `video-read:${result.readId}:frame:${String(frame.frameIndex + 1).padStart(4, "0")}`;
      records[artifactRef] = await inspectArtifact({ ...args, artifactRef, path: frame.path, stage, mediaKind: "image", metadata: { canvasEssential: true, referenceOnly: inheritedReferenceOnly, owner: "DX-Reference-Analyst", timestampSeconds: frame.timestampSeconds, selectionReason: frame.reason, pinned: frame.pinned, sourceArtifactRefs: [sourceArtifactRef, manifestArtifactRef] } });
      frameArtifactRefs.push(artifactRef);
    }
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.videoReads ??= [];
      const videoRead = { readId: result.readId, profile: result.plan.profile, sourceArtifactRef, receiptArtifactRef, manifestArtifactRef, contactSheetArtifactRef, transcriptArtifactRef, frameArtifactRefs, frameCount: result.frames.length, coverage: result.coverage, fullFrameCoverage: result.fullFrameCoverage, status: result.status };
      const existingIndex = run.videoReads.findIndex((item) => item.readId === videoRead.readId);
      if (existingIndex >= 0) run.videoReads[existingIndex] = videoRead;
      else run.videoReads.push(videoRead);
      run.artifacts ??= {};
      Object.assign(run.artifacts, records);
      upsertExecutionCanvasNode(run, { id: `video-read:${result.readId}`, type: "artifact", label: "视频阅读证据", detail: `${result.plan.profile} · ${result.frames.length} 帧${result.transcript ? ` · ${result.transcript.segments.length} 段字幕` : ""}${result.coverage.sparseScan ? " · 建议聚焦复读" : ""}`, stage, status: "complete", artifactRef: contactSheetArtifactRef ?? transcriptArtifactRef ?? manifestArtifactRef, metadata: { owner: "DX-Reference-Analyst", profile: result.plan.profile, coverage: result.coverage, sourceArtifactRefs: [sourceArtifactRef], frameArtifactRefs } }, `stage:${stage}`);
      run.events.push(event(run, "video.read.completed", stage, `${result.readId} · ${result.plan.profile} · ${result.frames.length} evidence frame(s)`));
      return run;
    } })), args);
  }
  if (name === "directorx_compile_reference_replication_plan") {
    const current = await readRun(args);
    const input = {
      planId: args.planId,
      referenceId: args.referenceId,
      reviewerId: args.reviewerId,
      reuseAuthorized: args.reuseAuthorized,
      target: args.target,
      analysis: args.analysis,
      adaptation: args.adaptation,
      shots: args.shots
    };
    const holder = structuredClone(current);
    const plan = compileReferenceReplicationPlan(holder, input);
    const written = await writeReferenceReplicationPlan({ ...args, plan });
    const records = {};
    for (const result of Object.values(written)) records[result.artifactRef] = await inspectArtifact({
      ...args,
      artifactRef: result.artifactRef,
      path: result.path,
      stage: "research",
      mediaKind: "document",
      metadata: { canvasEssential: result.artifactRef !== "reference_tool_route.json", internal: result.artifactRef === "reference_tool_route.json", owner: "DX-Reference-Analyst", sourceArtifactRefs: [plan.sourceEvidence.clipArtifactRef, plan.sourceEvidence.fullFrameManifestArtifactRef, plan.sourceEvidence.frameIdentityArtifactRef] }
    });
    const snapshot = await updateRun({ ...args, mutate(run) {
      const registered = compileReferenceReplicationPlan(run, input);
      run.artifacts ??= {};
      Object.assign(run.artifacts, records);
      upsertExecutionCanvasNode(run, { id: `reference-replication:${registered.planId}`, type: "document", label: "参考片复刻蓝图", detail: `${registered.execution.shots.length} 镜头 · ${registered.execution.totalDurationSeconds}s · ${registered.adaptationMode === "structure_and_directing_language_only" ? "仅迁移导演语言" : "已授权素材复刻"}`, stage: "research", status: "complete", artifactRef: "reference_replication_plan.json", metadata: { owner: "DX-Reference-Analyst", sourceArtifactRefs: [registered.sourceEvidence.clipArtifactRef, registered.sourceEvidence.fullFrameManifestArtifactRef, registered.sourceEvidence.frameIdentityArtifactRef] } }, "stage:research");
      run.events.push(event(run, "reference.replication.planned", "research", `${registered.referenceId} · ${registered.execution.shots.length} executable shot(s)`));
      return run;
    } });
    const response = await withBrowserCanvas(publicSnapshot(snapshot), args);
    return { ...response, nextRequiredAction: snapshot.pipeline?.id === "reference-replication" ? "directorx_write_director_document" : null, nextActionReason: snapshot.pipeline?.id === "reference-replication" ? "参考片视频、音频和复刻镜头蓝图已完成；先生成绑定替换策略与分镜继承规则的 Director.md，再进入脚本和分镜。" : null };
  }
  if (name === "directorx_compile_reference_learning_candidate") {
    const current = await readRun(args);
    requireNativeGoalBound(current, "Reference learning");
    const candidate = compileReferenceLearningCandidate(current, args);
    const written = await writeReferenceLearningCandidate({ ...args, candidate });
    const record = await inspectArtifact({
      ...args, artifactRef: written.artifactRef, path: written.path, stage: "research", mediaKind: "document",
      metadata: { canvasEssential: true, owner: "DX-Reference-Analyst", referenceOnly: true, sourceArtifactRefs: Object.values(candidate.evidence).filter((value) => typeof value === "string") }
    });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      run.referenceLearningCandidates ??= {};
      if (run.referenceLearningCandidates[candidate.candidateId]) throw new Error("Reference learning candidate already exists.");
      run.referenceLearningCandidates[candidate.candidateId] = candidate;
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      upsertExecutionCanvasNode(run, { id: `reference-learning:${candidate.candidateId}`, type: "document", label: "参考片导演知识候选", detail: `${candidate.principles.length} 条可迁移规律 · 等待 Codex 原生确认`, stage: "research", status: "active", artifactRef: record.artifactRef, metadata: { owner: candidate.reviewerId, referenceOnly: true, sourceArtifactRefs: record.metadata.sourceArtifactRefs } }, "stage:research");
      run.events.push(event(run, "reference.learning.candidate_ready", "research", `${candidate.referenceId} · ${candidate.principles.length} evidence-grounded principles`));
      return run;
    } }), args);
  }
  if (name === "directorx_promote_reference_learning") {
    const current = await readRun(args);
    const resolved = requireResolvedInteraction(current, args.interactionRequestId, "knowledge");
    const holder = structuredClone(current);
    const candidate = promoteReferenceLearningCandidate(holder, args, resolved);
    const projectKnowledge = await writePromotedProjectKnowledge({ projectPath: args.projectPath, candidate });
    const record = await inspectArtifact({
      ...args, artifactRef: projectKnowledge.artifactRef, path: projectKnowledge.path, stage: "research", mediaKind: "document",
      metadata: { internal: true, owner: "DX-Reference-Analyst", referenceOnly: true, sourceArtifactRefs: [`reference_learning_candidate.${candidate.candidateId}.json`] }
    });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      const interaction = requireResolvedInteraction(run, args.interactionRequestId, "knowledge");
      const promoted = promoteReferenceLearningCandidate(run, args, interaction);
      run.projectDirectorKnowledge = projectKnowledge.value;
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      upsertExecutionCanvasNode(run, { id: `reference-learning:${promoted.candidateId}`, type: "document", label: "参考片导演知识", detail: `${promoted.principles.length} 条规律 · 已加入项目知识库`, stage: "research", status: "complete", artifactRef: record.artifactRef, metadata: { owner: promoted.reviewerId, referenceOnly: true, sourceArtifactRefs: record.metadata.sourceArtifactRefs } }, "stage:research");
      run.events.push(event(run, "reference.learning.promoted", "research", `${promoted.candidateId} · project scope`));
      return run;
    } }), args);
  }
  if (name === "directorx_record_web_research") {
    const current = await readRun(args);
    if (current.researchAssetPolicy?.requireSearchPlan === true && !current.assetSearchPlan) throw new Error("Register asset_search_plan.json before recording web research.");
    const written = await writeWebResearch(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.webResearch = written.research;
      run.artifacts ??= {};
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "research" });
      run.events.push(event(run, "research.web.recorded", "research", `${args.research.sources.length} sources recorded`));
      return run;
    } })), args);
  }
  if (name === "directorx_record_provider_api_research") {
    const written = await writeWebResearch(args, { artifactRef: "provider_api_research_receipt.json" });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.providerApiResearch = written.research;
      run.artifacts ??= {};
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: run.stage });
      run.events.push(event(run, "provider.api.research.recorded", run.stage, `${args.research.sources.length} official API source(s)`));
      return run;
    } })), args);
  }
  if (name === "directorx_register_custom_media_provider_adapter") {
    const current = await readRun(args);
    requireResolvedInteraction(current, args.interactionRequestId, "provider_input");
    const adapter = registerCustomMediaProviderAdapter(args.adapter);
    assertCustomProviderResearchEvidence(current, adapter);
    const written = await writeCustomMediaProviderAdapter({ ...args, adapter });
    const record = await inspectArtifact({
      ...args,
      artifactRef: written.artifactRef,
      path: written.path,
      stage: current.stage,
      mediaKind: "document",
      metadata: {
        canvasEssential: true,
        owner: "DX-Model-Router",
        providerId: adapter.providerId,
        modelId: adapter.model.modelId,
        sourceArtifactRefs: ["provider_api_research_receipt.json"]
      }
    });
    const snapshot = await updateRun({ ...args, mutate(run) {
      requireResolvedInteraction(run, args.interactionRequestId, "provider_input");
      assertCustomProviderResearchEvidence(run, adapter);
      run.providerAdapters ??= {};
      run.providerAdapters[adapter.providerId] = adapter;
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      upsertExecutionCanvasNode(run, {
        id: `provider-adapter:${adapter.providerId}`,
        type: "document",
        label: `${adapter.displayName} · ${adapter.model.modelId}`,
        detail: `官方 API 文档适配 · ${adapter.api.protocol}`,
        stage: run.stage,
        status: "complete",
        artifactRef: record.artifactRef,
        metadata: {
          owner: "DX-Model-Router",
          providerId: adapter.providerId,
          modelId: adapter.model.modelId,
          sourceArtifactRefs: ["provider_api_research_receipt.json"]
        }
      }, `stage:${run.stage}`);
      run.events.push(event(run, "provider.adapter.registered", run.stage, `${adapter.providerId}/${adapter.model.modelId} · official docs verified`));
      return run;
    } });
    return {
      ...(await withBrowserCanvas(publicSnapshot(snapshot), args)),
      providerSetup: customProviderSetup(adapter, mediaCredentialConfigured(adapter.providerId))
    };
  }
  if (name === "directorx_record_reference_video_assessment") {
    const written = await writeReferenceVideoAssessment(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.referenceVideoAssessment = args.assessment;
      run.artifacts ??= {};
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "research" });
      run.events.push(event(run, "reference.video.assessed", "research", `${args.assessment.decision} · ${args.assessment.rationale}`));
      return run;
    } })), args);
  }
  if (name === "directorx_register_asset") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      const asset = { ...args.asset, registeredAt: new Date().toISOString() };
      run.assets ??= [];
      const assetIndex = run.assets.findIndex((item) => item.id === asset.id); if (assetIndex >= 0) run.assets[assetIndex] = asset; else run.assets.push(asset);
      run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } };
      const nodeType = ["reference_frame", "logo"].includes(asset.type) ? "image" : asset.type === "font" ? "artifact" : asset.type;
      const node = { id: `asset:${asset.id}`, type: nodeType, label: asset.label, detail: `${asset.intendedUse} · ${asset.rightsStatus}`, stage: asset.stage, status: ["unknown", "blocked"].includes(asset.rightsStatus) ? "blocked" : "complete", previewUri: asset.previewUri ?? asset.localPath, artifactRef: asset.localPath, metadata: { sourceUrl: asset.sourceUrl, rightsStatus: asset.rightsStatus, licenseEvidence: asset.licenseEvidence, attribution: asset.attribution, fallback: asset.fallback, canvasEssential: asset.type === "document" }, updatedAt: new Date().toISOString() };
      const nodeIndex = run.canvas.nodes.findIndex((item) => item.id === node.id); if (nodeIndex >= 0) run.canvas.nodes[nodeIndex] = node; else run.canvas.nodes.push(node);
      run.events.push(event(run, "asset.registered", asset.stage, `${asset.label} · ${asset.rightsStatus}`));
      return run;
    } })), args);
  }
  if (name === "directorx_acquire_web_image_asset") {
    const current = await readRun(args);
    requirePipelineStage(current, "research", "Web image acquisition");
    const downloadAuthorization = requireWebAssetDownloadAuthorization(current, args);
    const acquired = await acquireWebImageAsset({ ...args, downloadAuthorization });
    const imageSourceRefs = current.artifacts?.["web_research_receipt.json"] ? ["web_research_receipt.json"] : [];
    const imageRecord = await inspectArtifact({ ...args, artifactRef: acquired.imageArtifact.artifactRef, path: acquired.imageArtifact.path, stage: "research", mediaKind: "image", metadata: { canvasEssential: true, sourceArtifactRefs: imageSourceRefs, acquisitionReceiptRef: acquired.receiptArtifact.artifactRef, sourcePageUrl: acquired.asset.sourceUrl, sourceImageUrl: acquired.asset.sourceImageUrl, rightsStatus: acquired.asset.rightsStatus } });
    const receiptRecord = await inspectArtifact({ ...args, artifactRef: acquired.receiptArtifact.artifactRef, path: acquired.receiptArtifact.path, stage: "research", mediaKind: "document", metadata: { internal: true, sourceArtifactRefs: [imageRecord.artifactRef] } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.assets ??= [];
      const assetIndex = run.assets.findIndex((item) => item.id === acquired.asset.id);
      if (assetIndex >= 0) run.assets[assetIndex] = acquired.asset; else run.assets.push(acquired.asset);
      run.webImageAcquisitions ??= [];
      const receiptIndex = run.webImageAcquisitions.findIndex((item) => item.assetId === acquired.receipt.assetId);
      if (receiptIndex >= 0) run.webImageAcquisitions[receiptIndex] = acquired.receipt; else run.webImageAcquisitions.push(acquired.receipt);
      run.artifacts ??= {};
      run.artifacts[imageRecord.artifactRef] = imageRecord;
      run.artifacts[receiptRecord.artifactRef] = receiptRecord;
      run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } };
      const blocked = ["unknown", "blocked"].includes(acquired.asset.rightsStatus);
      const node = {
        id: `asset:${acquired.asset.id}`, type: "image", label: acquired.asset.label,
        detail: `${acquired.asset.technicalRequirements.category} · ${acquired.asset.technicalRequirements.width}×${acquired.asset.technicalRequirements.height} · ${acquired.asset.rightsStatus}`,
        stage: "research", status: blocked ? "blocked" : "complete", previewUri: acquired.asset.previewUri, artifactRef: imageRecord.artifactRef,
        metadata: { category: acquired.asset.technicalRequirements.category, sourceType: acquired.asset.technicalRequirements.sourceType, sourcePageUrl: acquired.asset.sourceUrl, sourceImageUrl: acquired.asset.sourceImageUrl, rightsStatus: acquired.asset.rightsStatus, licenseEvidence: acquired.asset.licenseEvidence, attribution: acquired.asset.attribution, fallback: acquired.asset.fallback, sha256: imageRecord.sha256, canvasEssential: true },
        updatedAt: new Date().toISOString()
      };
      const nodeIndex = run.canvas.nodes.findIndex((item) => item.id === node.id);
      if (nodeIndex >= 0) run.canvas.nodes[nodeIndex] = node; else run.canvas.nodes.push(node);
      run.events.push(event(run, "asset.web_image.acquired", "research", `${acquired.asset.label} · ${acquired.asset.technicalRequirements.category} · ${acquired.asset.rightsStatus}`));
      return run;
    } })), args);
  }
  if (name === "directorx_audit_asset_quality") {
    const current = await readRun(args);
    const report = await auditAssetQuality(current, args);
    const written = await writeAssetQualityAudit({ ...args, report });
    const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: "research", mediaKind: "document", metadata: { owner: "DX-Asset-Manager", status: report.status, sourceArtifactRefs: [report.artifactRef].filter(Boolean) } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.assetQualityAudits ??= {}; run.assetQualityAudits[report.auditId] = report; run.artifacts ??= {}; run.artifacts[record.artifactRef] = record;
      const sourceNode = (run.canvas?.nodes ?? []).find((node) => node.id === `asset:${args.assetRef}` || node.artifactRef === report.artifactRef);
      upsertExecutionCanvasNode(run, { id: `asset-quality:${safeCanvasId(args.assetRef)}`, type: "decision", label: `素材质量 · ${args.assetRef}`, detail: `${report.status} · ${report.technical.width}×${report.technical.height} · relevance ${report.directorReview.relevanceScore.toFixed(2)} · visual ${report.directorReview.visualQualityScore.toFixed(2)}`, stage: "research", status: report.status === "ready" ? "complete" : "blocked", artifactRef: record.artifactRef, metadata: { owner: "DX-Asset-Manager", useMode: report.useMode, rightsStatus: report.rightsStatus, blockers: report.blockers, sourceArtifactRefs: [report.artifactRef].filter(Boolean) } }, sourceNode?.id ?? "stage:research");
      run.events.push(event(run, `asset.quality.${report.status}`, "research", `${args.assetRef} · ${report.blockers.join(", ") || "passed"}`)); return run;
    } })), args);
  }
  if (name === "directorx_audit_visual_asset_coverage") {
    const current = await readRun(args);
    const report = await auditVisualAssetCoverage(current, args);
    const written = await writeVisualAssetCoverage({ ...args, report });
    const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: "research", mediaKind: "document" });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.visualAssetCoverage = report;
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      run.events.push(event(run, `asset.visual_coverage.${report.status}`, "research", report.status === "ready" ? `${report.acquiredVisualAssetCount} local visual assets cover the research brief` : `Missing visual categories: ${report.missingCategories.join(", ")}`));
      return run;
    } })), args);
  }
  if (name === "directorx_validate_research_package") {
    const run = await readRun(args);
    return { ...validateResearchPackage(run, args.package), template: buildResearchPackageTemplate(run) };
  }
  if (name === "directorx_finalize_research") {
    const run = await readRun(args);
    assertStageParallelDispatchStarted(run, "research");
    const written = await writeResearchPackage({ ...args, run });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {};
      for (const result of Object.values(written)) next.artifacts[result.artifactRef] = artifactRecord({ ...result, stage: "research" });
      next.events.push(event(next, "research.package.finalized", "research", `${Object.keys(written).length} research artifacts registered`));
      return next;
    } })), args);
  }
  if (name === "directorx_register_artifact") {
    const current = await readRun(args);
    assertStageParallelDispatchStarted(current, args.stage, args.artifactRef);
    const record = await inspectArtifact(args);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      run.events.push(event(run, "artifact.registered", args.stage, `${record.artifactRef} · ${record.sizeBytes} bytes`));
      return run;
    } })), args);
  }
  if (name === "directorx_get_stage_requirements") return getStageRequirements(await readRun(args), args.stageId);
  if (name === "directorx_register_stage_package") {
    const current = await readRun(args);
    assertStageParallelDispatchStarted(current, args.stageId);
    if (args.completeStage) assertStageParallelismObserved(current, args.stageId);
    const records = await inspectStagePackage(args);
    const preview = getStageRequirements(current, args.stageId, records.map((record) => record.artifactRef));
    if (args.completeStage && !preview.canComplete) throw new Error(`Stage package is incomplete:\n- ${preview.missingOutputs.join("\n- ")}`);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      assertStageParallelDispatchStarted(run, args.stageId);
      if (args.completeStage) assertStageParallelismObserved(run, args.stageId);
      const latest = getStageRequirements(run, args.stageId, records.map((record) => record.artifactRef));
      if (args.completeStage && !latest.canComplete) throw new Error(`Stage package is incomplete:\n- ${latest.missingOutputs.join("\n- ")}`);
      run.artifacts ??= {};
      for (const record of records) run.artifacts[record.artifactRef] = record;
      run.events.push(event(run, "stage.package.registered", args.stageId, `${records.length} artifacts · ${records.reduce((sum, record) => sum + record.sizeBytes, 0)} bytes`));
      if (args.completeStage) {
        assertStageQualityGates(run, args.stageId);
        const evidenceRefs = latest.requiredOutputs;
        run.pipeline = transitionPipelineStage(run.pipeline, run.approvals, { stageId: args.stageId, action: "complete", detail: args.detail ?? `Registered and completed ${args.stageId} package.`, evidenceRefs });
        run.stage = args.stageId;
        run.events.push(event(run, "stage.complete", args.stageId, args.detail ?? `Registered and completed ${args.stageId} package.`));
        const checkpoint = await appendRunCheckpoint({ ...args, run, reason: "stage.complete", detail: args.detail ?? `Registered and completed ${args.stageId} package.` });
        run.artifacts[checkpoint.artifactRef] = artifactRecord({ ...checkpoint, stage: args.stageId });
      }
      return run;
    } })), args);
  }
  if (name === "directorx_register_generation_plan") {
    return await mutateGeneration(args, (run) => registerGenerationPlan(run, args.plan), "generation.plan.registered", `${args.plan.requests.length} bounded requests · ${args.plan.providerId}/${args.plan.modelId}`);
  }
  if (name === "directorx_register_prompt_bound_generation_plan") {
    const current = await readRun(args);
    const stored = current.artifacts?.["visual_prompt_pack.json"];
    if (!stored?.path) throw new Error("Register and verify visual_prompt_pack.json before binding generation work.");
    const verified = await inspectArtifact({ ...args, artifactRef: "visual_prompt_pack.json", path: stored.path, stage: "storyboard", mediaKind: "document", metadata: stored.metadata });
    if (verified.sha256 !== args.promptPackSha256) throw new Error("visual_prompt_pack.json changed after the supplied SHA-256 was reviewed; re-read the prompt pack before generation.");
    const bindingInput = { ...args, promptPackSha256: verified.sha256 };
    const plan = compilePromptBoundGenerationPlan(current, bindingInput);
    return await mutateGeneration(args, (run) => {
      const livePlan = compilePromptBoundGenerationPlan(run, bindingInput);
      registerGenerationPlan(run, livePlan);
      upsertExecutionCanvasNode(run, {
        id: `generation-binding:${livePlan.generationRequestId}`,
        type: "artifact",
        label: "提示词已绑定生成",
        detail: `${livePlan.requests.length} 个镜头 · ${livePlan.providerId}/${livePlan.modelId}`,
        stage: "generation",
        status: "complete",
        artifactRef: "generation_request.json",
        metadata: { canvasEssential: true, sourceArtifactRefs: ["visual_prompt_pack.json"], bindingSha256: livePlan.bindingSha256, promptPackSha256: verified.sha256, routeId: args.routeId }
      }, "storyboard:visual-prompts");
      return run;
    }, "generation.prompt_pack.bound", `${plan.requests.length} bound requests · ${plan.bindingSha256}`);
  }
  if (name === "directorx_begin_generation_attempt") {
    return await mutateGeneration(args, (run) => {
      beginGenerationAttempt(run, args);
      const request = run.generation.requests.find((item) => item.requestId === args.requestId);
      const attempt = run.generation.attempts.find((item) => item.attemptId === args.attemptId);
      upsertExecutionCanvasNode(run, { id: `attempt:${args.attemptId}`, type: "artifact", label: `${request.shotId} · 正在生成`, detail: `${run.generation.providerId}/${run.generation.modelId} · 官方估价 ${run.generation.currency} ${attempt.estimatedCost}`, stage: "generation", status: "active", metadata: { requestId: args.requestId, attemptId: args.attemptId, prompt: attempt.prompt, pricingQuoteId: attempt.pricingQuote.quoteId, pricingSourceUrl: attempt.pricingQuote.sourceUrl } }, `shot:${request.shotId}`);
      return run;
    }, "generation.attempt.started", `${args.requestId} · ${args.attemptId} · official price quote`);
  }
  if (name === "directorx_record_generation_candidate") {
    const candidateArtifactRef = `candidate:${args.candidateId}`;
    const current = await readRun(args);
    const mediaRecord = await inspectArtifact({ ...args, artifactRef: candidateArtifactRef, path: args.localPath, stage: "generation", mediaKind: args.mediaType, metadata: generationArtifactMetadata(current, args.requestId) });
    return await mutateGeneration(args, (run) => {
      recordGenerationCandidate(run, { ...args, assetRef: candidateArtifactRef, previewUri: mediaRecord.relativePath });
      run.artifacts[candidateArtifactRef] = mediaRecord;
      const attemptNode = run.canvas.nodes.find((item) => item.id === `attempt:${args.attemptId}`);
      if (attemptNode) { attemptNode.status = "complete"; attemptNode.detail = `生成完成 · 候选 ${args.candidateId}`; attemptNode.updatedAt = new Date().toISOString(); }
      upsertCandidateCanvasNode(run, args, mediaRecord, "awaiting_review");
      return run;
    }, "generation.candidate.recorded", `${args.candidateId} · cost ${args.actualCost}`);
  }
  if (name === "directorx_submit_provider_job") {
    return await mutateGeneration(args, (run) => {
      const result = submitProviderJob(run, args);
      upsertExecutionCanvasNode(run, { id: `job:${result.job.providerJobId}`, type: "artifact", label: `Provider Job · ${result.job.providerJobId}`, detail: `${result.job.status} · 0%`, stage: "generation", status: "active", artifactRef: "provider_jobs.json", metadata: result.job }, `attempt:${args.attemptId}`);
      return run;
    }, "provider.job.submitted", `${args.providerJobId} · ${args.idempotencyKey}`);
  }
  if (name === "directorx_submit_media_generation") return await executeDirectMediaSubmission(args);
  if (name === "directorx_poll_media_generation") return await executeDirectMediaPoll(args);
  if (name === "directorx_negotiate_task_transport") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      const transport = negotiateTaskTransport(run, args); const written = await writeTaskTransport({ ...args, taskTransport: transport });
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "generation" });
      upsertExecutionCanvasNode(run, { id: "task:transport", type: "artifact", label: "后台任务传输", detail: transport.transport === "mcp_tasks" ? `MCP Tasks · ${transport.protocolVersion}` : `Provider polling fallback · ${transport.fallbackReason}`, stage: "generation", status: transport.transport === "mcp_tasks" ? "complete" : "blocked", artifactRef: written.artifactRef, metadata: transport }, "stage:generation");
      run.events.push(event(run, "task.transport.negotiated", "generation", transport.transport)); return run;
    } })), args);
  }
  if (name === "directorx_register_av_review_timeline") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      const timeline = registerAvReviewTimeline(run, args.timeline); const written = await writeAvReviewTimeline({ ...args, timeline });
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "review" });
      upsertExecutionCanvasNode(run, { id: `timeline:${timeline.timelineId}`, type: "artifact", label: "音视频审片时间轴", detail: `${timeline.durationSeconds}s · ${timeline.shots.length} 镜头 · ${timeline.subtitles.length} 字幕 · ${timeline.markers.length} 标记`, stage: "review", status: "complete", artifactRef: written.artifactRef, metadata: { mediaArtifactRef: timeline.mediaArtifactRef, audioTrackCount: timeline.audioTracks.length } }, "stage:review");
      run.events.push(event(run, "av.timeline.registered", "review", `${timeline.timelineId} · ${timeline.markers.length} markers`)); return run;
    } })), args);
  }
  if (name === "directorx_analyze_media_waveform") {
    const result = await analyzeMediaWaveform(args);
    const value = { schemaVersion: "1.0", waveformId: args.waveformId, trackId: args.trackId, role: args.role, sourcePath: args.mediaPath, window: { range: { start: { value: Math.round(result.startSeconds * 1000), rate: 1000 }, duration: { value: Math.round(result.durationSeconds * 1000), rate: 1000 } }, level: 0, samplesPerPoint: result.samplesPerPoint, pixelWidth: result.pixelWidth, peaks: result.peaks, peakEncoding: result.peakEncoding }, analysis: { sampleRate: result.sampleRate, sampleCount: result.sampleCount, command: result.command, args: result.args } };
    const path = await writeExecutionReceipt(args.projectPath, args.runId, `waveform_window_${args.waveformId}.json`, value);
    const artifactRef = `waveform_window_${args.waveformId}.json`; const record = await inspectArtifact({ ...args, artifactRef, path, stage: "review", mediaKind: "document" });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) { run.waveformWindows ??= {}; run.waveformWindows[args.waveformId] = value; run.artifacts[artifactRef] = record; upsertExecutionCanvasNode(run, { id: `waveform:${args.waveformId}`, type: "artifact", label: `波形窗口 · ${args.role}`, detail: `${result.durationSeconds}s · ${result.peaks.length / 2} min/max points`, stage: "review", status: "complete", artifactRef, metadata: { trackId: args.trackId, sampleRate: result.sampleRate, samplesPerPoint: result.samplesPerPoint, peakEncoding: result.peakEncoding } }, "stage:review"); run.events.push(event(run, "waveform.window.analyzed", "review", `${args.waveformId} · ${result.peaks.length / 2} points`)); return run; } })), args);
  }
  if (name === "directorx_build_waveform_pyramid") {
    const media = await inspectMediaDelivery({ projectPath: args.projectPath, finalVideoPath: args.mediaPath, requireAudio: true, timeoutMs: args.timeoutMs });
    const built = await buildWaveformPyramid({ ...args, durationSeconds: media.durationSeconds });
    const record = await inspectArtifact({ ...args, artifactRef: built.artifactRef, path: built.path, stage: "review", mediaKind: "document" });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) { run.waveformPyramids ??= {}; run.waveformPyramids[args.waveformId] = built.index; run.artifacts[built.artifactRef] = record; upsertExecutionCanvasNode(run, { id: `waveform-pyramid:${args.waveformId}`, type: "artifact", label: "长视频波形金字塔", detail: `${media.durationSeconds.toFixed(2)}s · ${built.index.chunks.length} chunks · 4 levels`, stage: "review", status: "complete", artifactRef: built.artifactRef, metadata: { waveformId: args.waveformId, sourcePath: args.mediaPath, chunkDurationSeconds: args.chunkDurationSeconds, basePixelWidth: args.basePixelWidth } }, "stage:review"); run.events.push(event(run, "waveform.pyramid.built", "review", `${args.waveformId} · ${built.index.chunks.length} chunks`)); return run; } })), args);
  }
  if (name === "directorx_get_waveform_window") return await getWaveformWindow(args);
  if (name === "directorx_import_caption_track") {
    const track = await importCaptionTrack(args); const artifactRef = `caption_track_${args.trackId}.json`; const path = await writeExecutionReceipt(args.projectPath, args.runId, artifactRef, track); const record = await inspectArtifact({ ...args, artifactRef, path, stage: "review", mediaKind: "document" });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) { run.captionTracks ??= {}; run.captionTracks[args.trackId] = track; run.artifacts[artifactRef] = record; upsertExecutionCanvasNode(run, { id: `captions:${args.trackId}`, type: "artifact", label: `字幕轨 · ${args.language}`, detail: `${track.cues.length} cues · ${track.sourceFormat.toUpperCase()}`, stage: "review", status: "complete", artifactRef, metadata: { language: args.language, sourcePath: args.captionPath, cueCount: track.cues.length } }, "stage:review"); run.events.push(event(run, "caption.track.imported", "review", `${args.trackId} · ${track.cues.length} cues`)); return run; } })), args);
  }
  if (name === "directorx_update_provider_job") {
    return await mutateGeneration(args, (run) => {
      const current = run.generation?.providerJobs?.find((job) => job.providerJobId === args.providerJobId);
      if (!current) throw new Error(`Unknown provider job: ${args.providerJobId}`);
      let update = args;
      if (args.status === "input_required") {
        const interaction = requestNativeInteraction(run, {
          kind: "provider_input",
          gateKey: `provider-job:${args.providerJobId}`,
          reason: args.inputRequest?.instruction ?? "外部媒体供应商需要用户补充输入后才能继续。",
          questions: [{ header: "供应商输入", id: "provider_input_decision", question: args.inputRequest?.instruction ?? "请选择如何处理供应商要求的补充输入。", options: [{ label: "补充信息 (Recommended)", description: "通过 Codex 的回答区域提供所需信息并继续当前幂等任务。" }, { label: "取消任务", description: "停止当前供应商任务并保留已有证据。" }] }]
        });
        update = { ...args, inputRequest: { ...args.inputRequest, interactionRequestId: interaction.request.requestId } };
      } else if (current.status === "input_required") {
        requireResolvedInteraction(run, args.interactionRequestId ?? current.inputRequest?.interactionRequestId, "provider_input");
      }
      const job = updateProviderJob(run, update); updateProviderJobNode(run, job); return run;
    }, `provider.job.${args.status}`, `${args.providerJobId} · ${Math.round(args.progress * 100)}%`);
  }
  if (name === "directorx_cancel_provider_job") {
    return await mutateGeneration(args, (run) => {
      const job = requestProviderJobCancellation(run, args.providerJobId); updateProviderJobNode(run, job); return run;
    }, "provider.job.cancel_requested", args.providerJobId);
  }
  if (name === "directorx_probe_provider_capability") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      const snapshot = recordProviderCapabilityProbe(run, args);
      const written = await writeProviderCapabilitySnapshot({ ...args, snapshots: run.providerCapabilities });
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "generation" });
      run.events.push(event(run, "provider.capability.probed", "generation", `${snapshot.providerId}/${snapshot.modelId} · ${snapshot.status}`));
      return run;
    } })), args);
  }
  if (name === "directorx_generate_mosi_voiceover") {
    const run = await readRun(args);
    requireExecutionApproval(run, "MOSI TTS", ["budget", "voice_model"]);
    requirePipelineStage(run, "generation", "MOSI TTS");
    const providerId = [...credentialStatus.entries()].find(([, status]) => status.configured && status.envName === "MOSS_API_KEY")?.[0];
    const resolvedProviderId = providerId ?? "mosi.tts";
    const resolvedModelId = args.model ?? "moss-tts";
    requireApprovedModelRoute(run, "voice_model", { providerId: resolvedProviderId, modelId: resolvedModelId }, "MOSI TTS");
    if (run.audioResponsibilityPlan?.voice?.owner !== "tts" || run.audioResponsibilityPlan.voice.providerId !== resolvedProviderId || run.audioResponsibilityPlan.voice.modelId !== resolvedModelId) throw new Error("MOSI TTS generation must match audio_responsibility_plan.json.");
    const pricingQuote = quoteModelCost({ providerId: resolvedProviderId, modelId: resolvedModelId, mediaType: "voice", usage: { characterCount: [...args.text].length }, pricingEvidence: run.pricingEvidence });
    const approvedBudget = [...(run.decisions ?? [])].reverse().find((decision) => decision.kind === "budget")?.value;
    assertQuoteApprovedByBudget(approvedBudget, pricingQuote);
    const result = await executeMosiTts(args, { providerId });
    const receiptPath = await writeExecutionReceipt(args.projectPath, args.runId, "moss_tts_execution_receipt.json", {
      providerId: result.providerId, modelId: result.modelId, voiceId: result.voiceId, responseFormat: result.responseFormat,
      outputPath: result.outputPath, byteLength: result.byteLength, estimatedCost: pricingQuote.amount, actualCost: pricingQuote.amount, pricingQuote,
      credentialRef: "session-env:MOSS_API_KEY"
    });
    const audio = await inspectArtifact({ ...args, artifactRef: "voiceover.audio", path: result.outputPath, stage: "generation", mediaKind: "audio", metadata: { canvasEssential: true, sourceArtifactRefs: ["script_or_outline.json", "audio_cue_sheet.json"], providerId: result.providerId, modelId: result.modelId, voiceId: result.voiceId } });
    const receipt = await inspectArtifact({ ...args, artifactRef: "moss_tts_execution_receipt.json", path: receiptPath, stage: "generation", mediaKind: "document" });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {}; next.artifacts[audio.artifactRef] = audio; next.artifacts[receipt.artifactRef] = receipt;
      const isMock = result.providerId.endsWith(".mock");
      upsertExecutionCanvasNode(next, { id: "audio:voiceover", type: "audio", label: isMock ? "MOSS TTS 配音（协议 Mock）" : "MOSS TTS 配音", detail: `${result.providerId} · ${result.modelId} · ${result.voiceId} · ${pricingQuote.currency} ${pricingQuote.amount}`, stage: "generation", status: "complete", previewUri: audio.relativePath, artifactRef: audio.artifactRef, metadata: { providerId: result.providerId, modelId: result.modelId, executionMode: isMock ? "protocol_mock" : "provider", estimatedCost: pricingQuote.amount, actualCost: pricingQuote.amount, pricingQuoteId: pricingQuote.quoteId, pricingSourceUrl: pricingQuote.sourceUrl, sourceArtifactRefs: ["script_or_outline.json", "audio_cue_sheet.json", "audio_responsibility_plan.json"] } }, "stage:generation");
      next.events.push(event(next, "tts.generated", "generation", `${audio.relativePath} · ${pricingQuote.currency} ${pricingQuote.amount}`)); return next;
    } })), args);
  }
  if (name === "directorx_generate_local_moss_tts_nano_voiceover") {
    const run = await readRun(args);
    const providerId = "openmoss.moss-tts-nano.local";
    const modelId = "moss-tts-nano";
    requireExecutionApproval(run, "local MOSS-TTS-Nano", ["budget", "voice_model"]);
    requirePipelineStage(run, "generation", "local MOSS-TTS-Nano");
    requireApprovedModelRoute(run, "voice_model", { providerId, modelId }, "local MOSS-TTS-Nano");
    if (run.audioResponsibilityPlan?.voice?.owner !== "tts" || run.audioResponsibilityPlan.voice.providerId !== providerId || run.audioResponsibilityPlan.voice.modelId !== modelId) throw new Error("Local MOSS-TTS-Nano generation must match audio_responsibility_plan.json.");
    const result = await executeMossTtsNano(args);
    const receiptPath = await writeExecutionReceipt(args.projectPath, args.runId, "moss_tts_nano_execution_receipt.json", {
      providerId, modelId, voiceId: result.voiceId, responseFormat: result.responseFormat, outputPath: result.outputPath,
      byteLength: result.byteLength, estimatedCost: 0, actualCost: 0, costBasis: "local_runtime", command: result.command, argv: result.args, executionMode: result.executionMode
    });
    const audio = await inspectArtifact({ ...args, artifactRef: "voiceover.audio", path: result.outputPath, stage: "generation", mediaKind: "audio", metadata: { canvasEssential: true, sourceArtifactRefs: ["script_or_outline.json", "audio_cue_sheet.json"], providerId, modelId, voiceId: result.voiceId } });
    const receipt = await inspectArtifact({ ...args, artifactRef: "moss_tts_nano_execution_receipt.json", path: receiptPath, stage: "generation", mediaKind: "document" });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {}; next.artifacts[audio.artifactRef] = audio; next.artifacts[receipt.artifactRef] = receipt;
      upsertExecutionCanvasNode(next, { id: "audio:voiceover", type: "audio", label: "MOSS-TTS-Nano 本地配音", detail: `${providerId} · ${modelId} · local`, stage: "generation", status: "complete", previewUri: audio.relativePath, artifactRef: audio.artifactRef, metadata: { providerId, modelId, executionMode: "local_cli", estimatedCost: 0, actualCost: 0, sourceArtifactRefs: ["script_or_outline.json", "audio_cue_sheet.json", "audio_responsibility_plan.json"] } }, "stage:generation");
      next.events.push(event(next, "tts.generated", "generation", `${audio.relativePath} · local MOSS-TTS-Nano`)); return next;
    } })), args);
  }
  if (name === "directorx_transcribe_media_with_whisper") {
    const run = await readRun(args);
    const result = await executeWhisperTranscription(args);
    const receiptPath = await writeExecutionReceipt(args.projectPath, args.runId, "whisper_execution_receipt.json", {
      mediaPath: result.mediaPath,
      outputPath: result.outputPath,
      model: result.transcript.model,
      language: result.transcript.language,
      segmentCount: result.transcript.segments.length,
      command: result.command,
      args: result.args,
      exitCode: result.exitCode,
      runtime: result.runtime,
      runtimeRelease: result.runtimeRelease
    });
    const sourceArtifactRefs = [args.sourceArtifactRef].filter(Boolean);
    const transcript = await inspectArtifact({ ...args, artifactRef: "whisper_transcript.json", path: result.outputPath, stage: run.stage, mediaKind: "document", metadata: { canvasEssential: true, sourceArtifactRefs, provider: result.transcript.provider, model: result.transcript.model, language: result.transcript.language } });
    const receipt = await inspectArtifact({ ...args, artifactRef: "whisper_execution_receipt.json", path: receiptPath, stage: run.stage, mediaKind: "document", metadata: { internal: true, sourceArtifactRefs: [transcript.artifactRef] } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {};
      next.artifacts[transcript.artifactRef] = transcript;
      next.artifacts[receipt.artifactRef] = receipt;
      upsertExecutionCanvasNode(next, { id: "audio:whisper-transcript", type: "document", label: "Whisper 字幕转写", detail: `${result.transcript.model} · ${result.transcript.language} · ${result.transcript.segments.length} 段`, stage: run.stage, status: "complete", artifactRef: transcript.artifactRef, metadata: { sourceArtifactRefs, provider: result.transcript.provider, wordTimestamps: args.wordTimestamps !== false } }, `stage:${run.stage}`);
      next.events.push(event(next, "transcript.whisper.completed", run.stage, `${result.transcript.segments.length} segments · ${result.transcript.language}`));
      return next;
    } })), args);
  }
  if (name === "directorx_register_render_quality_contract") {
    const run = await readRun(args);
    requirePipelineStage(run, "edit", "Render quality planning");
    const contract = compileRenderQualityContract({
      ...args,
      transitionLanguagePlan: run.transitionLanguagePlan,
      requireDirectorPlan: args.visualClips.length > 1
    });
    const path = await writeExecutionReceipt(args.projectPath, args.runId, "render_quality_contract.json", contract);
    const record = await inspectArtifact({ ...args, artifactRef: "render_quality_contract.json", path, stage: "edit", mediaKind: "document", metadata: { internal: true, renderer: contract.renderer, sourceArtifactRefs: ["semantic_timeline.json", "audio_cue_sheet.json", "transition_language_plan.json"].filter((ref) => run.artifacts?.[ref]) } });
    return await withRunResumeActions(await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {};
      next.artifacts[record.artifactRef] = record;
      next.renderQualityContract = contract;
      next.events.push(event(next, `render.quality_contract.${contract.status}`, "edit", contract.status === "ready" ? `${contract.renderer} · narration, captions, and ${contract.metrics.transitionCoverage.boundaries} visual boundaries ready` : contract.blockers.join(", ")));
      return next;
    } }), args);
  }
  if (name === "directorx_compile_remotion_render_projection") {
    const run = await readRun(args);
    requirePipelineStage(run, "edit", "Remotion render projection");
    assertRenderQualityReady(run, "remotion");
    const semanticTimeline = await readJsonArtifact(run, "semantic_timeline.json");
    if (!semanticTimeline) throw new Error("Register a readable semantic_timeline.json before compiling the Remotion projection.");
    const timelineRecord = run.artifacts?.["semantic_timeline.json"];
    const qualityRecord = run.artifacts?.["render_quality_contract.json"];
    if (!timelineRecord?.sha256 || !qualityRecord?.sha256) throw new Error("Canonical Remotion projection requires SHA-bound semantic timeline and render quality artifacts.");
    const timelineAudioBindings = await resolveRemotionTimelineAudioBindings(run, args);
    const projection = compileRemotionRenderProjection({
      semanticTimeline,
      semanticTimelineSha256: timelineRecord.sha256,
      renderQualityContract: run.renderQualityContract,
      renderQualityContractSha256: qualityRecord.sha256,
      transitionLanguagePlanSha256: run.artifacts?.["transition_language_plan.json"]?.sha256 ?? null,
      audioCueSheetSha256: run.artifacts?.["audio_cue_sheet.json"]?.sha256 ?? null,
      mediaBindings: args.mediaBindings,
      timelineAudioBindings,
      captionBindings: args.captionBindings ?? [],
      audioBridgeBindings: args.audioBridgeBindings ?? [],
      width: args.width,
      height: args.height,
      throughColor: args.throughColor
    });
    const path = await writeExecutionReceipt(args.projectPath, args.runId, "remotion_render_props.json", projection.props);
    const record = await inspectArtifact({
      ...args,
      artifactRef: "remotion_render_props.json",
      path,
      stage: "edit",
      mediaKind: "document",
      metadata: {
        internal: true,
        projectionFingerprint: projection.projectionFingerprint,
        propsFingerprint: projection.propsFingerprint,
        sourceArtifactRefs: ["semantic_timeline.json", "render_quality_contract.json", "transition_language_plan.json", "audio_cue_sheet.json", ...timelineAudioBindings.map((binding) => binding.sourceArtifactRef)].filter((ref) => run.artifacts?.[ref])
      }
    });
    return await withRunResumeActions(await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {};
      next.artifacts[record.artifactRef] = record;
      next.remotionRenderProjection = { ...projection, propsPath: record.relativePath };
      next.events.push(event(next, "render.remotion_projection.ready", "edit", `${projection.sceneCount} scenes · ${projection.boundaryCount} boundaries · ${projection.timelineAudioTrackCount} audio tracks · ${projection.captionCount} captions · canonical timeline bound`));
      return next;
    } }), args);
  }
  if (name === "directorx_render_opencut_timeline") {
    const run = await readRun(args);
    requireExecutionApproval(run, "Director X Cut render", ["budget"]);
    const activeSession = run.openCutEditor?.activeSessionId ? run.openCutEditor.sessions?.[run.openCutEditor.activeSessionId] : null;
    if (!activeSession || activeSession.status !== "render_required") throw new Error("Director X Cut render requires a committed manual edit.");
    const sourceRecord = run.artifacts?.[activeSession.sourceArtifactRef];
    if (!sourceRecord) throw new Error("Director X Cut render source artifact is no longer registered.");
    const sourceArchiveRef = `opencut_source/${activeSession.editorSessionId}.video`;
    const result = await executeOpenCutRender({ ...args, run });
    const media = await inspectMediaDelivery({ ...args, finalVideoPath: result.outputPath, requireAudio: true });
    const planPath = await writeExecutionReceipt(args.projectPath, args.runId, "opencut_render_plan.json", result.plan);
    const receiptPath = await writeExecutionReceipt(args.projectPath, args.runId, "opencut_render_receipt.json", { editorSessionId: result.plan.editorSessionId, patchId: result.plan.patchId, revisionId: result.plan.revisionId, sourceContentHash: result.plan.sourceContentHash, outputPath: result.outputPath, command: result.execution.command, args: result.execution.args, exitCode: result.execution.exitCode, stdoutTail: result.execution.stdout.slice(-4000), stderrTail: result.execution.stderr.slice(-4000) });
    const renderReportPath = await writeExecutionReceipt(args.projectPath, args.runId, "render_report.json", { schemaVersion: "1.0", renderer: "directorx-cut-ffmpeg", finalVideoPath: media.videoPath, durationSeconds: media.durationSeconds, expectedDurationSeconds: result.plan.expectedDurationSeconds, sizeBytes: media.sizeBytes, formatName: media.formatName, videoStreams: media.videoStreams, audioStreams: media.audioStreams, mediaIntegrity: media.mediaIntegrity, probe: { command: media.command, args: media.args }, planRef: "opencut_render_plan.json", receiptRef: "opencut_render_receipt.json", passed: true });
    const sourceRefs = [sourceArchiveRef, "timeline_revision.json", "timeline_patch.json", "opencut_render_plan.json"];
    const video = await inspectArtifact({ ...args, artifactRef: "delivery.video", path: result.outputPath, stage: "delivery", mediaKind: "video", metadata: { canvasEssential: true, sourceArtifactRefs: sourceRefs, renderer: "directorx-cut-ffmpeg", patchId: result.plan.patchId, revisionId: result.plan.revisionId } });
    const plan = await inspectArtifact({ ...args, artifactRef: "opencut_render_plan.json", path: planPath, stage: "edit", mediaKind: "document", metadata: { sourceArtifactRefs: [sourceArchiveRef, "timeline_revision.json", "timeline_patch.json"] } });
    const receipt = await inspectArtifact({ ...args, artifactRef: "opencut_render_receipt.json", path: receiptPath, stage: "edit", mediaKind: "document", metadata: { sourceArtifactRefs: [plan.artifactRef] } });
    const renderReport = await inspectArtifact({ ...args, artifactRef: "render_report.json", path: renderReportPath, stage: "edit", mediaKind: "document", metadata: { sourceArtifactRefs: [video.artifactRef, plan.artifactRef, receipt.artifactRef] } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {};
      next.artifacts[sourceArchiveRef] ??= { ...structuredClone(sourceRecord), artifactRef: sourceArchiveRef, metadata: { ...(sourceRecord.metadata ?? {}), current: false, immutableEditSource: true, editorSessionId: activeSession.editorSessionId, supersededBy: video.artifactRef } };
      Object.assign(next.artifacts, { [video.artifactRef]: video, [plan.artifactRef]: plan, [receipt.artifactRef]: receipt, [renderReport.artifactRef]: renderReport });
      markOpenCutEditRendered(next, { finalVideoArtifactRef: video.artifactRef, finalVideoPath: video.path, sha256: video.sha256 });
      upsertExecutionCanvasNode(next, { id: "video:delivery", type: "video", label: "Director X Cut 成片", detail: `${result.plan.clipCount} clips · ${result.plan.transitions.length} transitions · ${media.durationSeconds.toFixed(2)}s`, stage: "edit", status: "complete", previewUri: video.relativePath, artifactRef: video.artifactRef, metadata: { renderer: "directorx-cut-ffmpeg", patchId: result.plan.patchId, revisionId: result.plan.revisionId, renderReportRef: renderReport.artifactRef, sourceArtifactRefs: sourceRefs } }, "stage:edit");
      upsertOpenCutCanvasNode(next, next.openCutEditor.sessions[next.openCutEditor.activeSessionId]);
      next.events.push(event(next, "opencut.render.completed", "edit", `${video.relativePath} · ${media.durationSeconds.toFixed(2)}s`));
      return next;
    } })), args);
  }
  if (name === "directorx_render_remotion_video") {
    const run = await readRun(args);
    requireExecutionApproval(run, "Remotion render", ["budget"]);
    assertRenderQualityReady(run, "remotion");
    const manualEditor = run.openCutEditor?.sessions?.[run.openCutEditor?.activeSessionId];
    if (manualEditor?.status === "render_required") {
      if (!run.pipeline) throw new Error("Director X Cut rerender requires an active production pipeline.");
    } else requirePipelineStage(run, "edit", "Remotion render");
    const remotionProjection = await assertRenderPropsBindRemotionProjection(run, args);
    const segmentContinuity = await assertRenderPropsBindSegmentStitch(run, args);
    const transitionExecution = await assertRenderPropsBindTransitionExecution(run, args);
    if (run.pipeline?.id === "layered-collage") {
      for (const phase of ["static_layout", "motion_audio"]) if (run.layeredCollageReviews?.[phase]?.status !== "passed") throw new Error(`Layered collage Remotion render requires a passed ${phase} review.`);
    }
    const result = await executeRemotionRender(args);
    const media = await inspectMediaDelivery({ ...args, finalVideoPath: result.outputPath, requireAudio: true });
    const receiptPath = await writeExecutionReceipt(args.projectPath, args.runId, "remotion_execution_receipt.json", {
      compositionId: result.compositionId, entryPoint: result.entryPoint, renderCwd: result.renderCwd, outputPath: result.outputPath,
      command: result.command, args: result.args, exitCode: result.exitCode,
      stdoutTail: result.stdout.slice(-4000), stderrTail: result.stderr.slice(-4000)
    });
    const renderReportPath = await writeExecutionReceipt(args.projectPath, args.runId, "render_report.json", {
      schemaVersion: "1.0", finalVideoPath: media.videoPath, durationSeconds: media.durationSeconds, sizeBytes: media.sizeBytes,
      formatName: media.formatName, videoStreams: media.videoStreams, audioStreams: media.audioStreams,
      probe: { command: media.command, args: media.args }, remotionProjection, segmentContinuity, transitionExecution, passed: true
    });
    const video = await inspectArtifact({ ...args, artifactRef: "delivery.video", path: result.outputPath, stage: "delivery", mediaKind: "video" });
    const receipt = await inspectArtifact({ ...args, artifactRef: "remotion_execution_receipt.json", path: receiptPath, stage: "delivery", mediaKind: "document" });
    const renderReport = await inspectArtifact({
      ...args,
      artifactRef: "render_report.json",
      path: renderReportPath,
      stage: "edit",
      mediaKind: "document",
      metadata: {
        remotionProjection,
        segmentContinuity,
        transitionExecution,
        sourceArtifactRefs: [
          "remotion_render_props.json",
          ...(segmentContinuity.required ? ["segment_stitch_plan.json", "boundary_continuity_report.json"] : []),
          ...(transitionExecution.required ? ["transition_language_plan.json", "render_quality_contract.json"] : [])
        ]
      }
    });
    const snapshot = await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {}; next.artifacts[video.artifactRef] = video; next.artifacts[receipt.artifactRef] = receipt; next.artifacts[renderReport.artifactRef] = renderReport;
      markOpenCutEditRendered(next, { finalVideoArtifactRef: video.artifactRef, finalVideoPath: video.path, sha256: video.sha256 });
      next.postRenderGate = { status: "full_frame_audit_required", mediaArtifactRef: video.artifactRef, mediaPath: video.path, mediaSha256: video.sha256, renderer: "remotion", requiredTool: "directorx_verify_final_media", createdAt: new Date().toISOString() };
      const sourceArtifactRefs = [...new Set([...(next.generation?.candidates ?? []).filter((candidate) => candidate.status === "selected").map((candidate) => candidate.assetRef), next.artifacts?.["voiceover.audio"] ? "voiceover.audio" : null, next.artifacts?.["semantic_timeline.json"] ? "semantic_timeline.json" : null, "remotion_render_props.json", segmentContinuity.required ? "segment_stitch_plan.json" : null].filter(Boolean))];
      video.metadata = { ...(video.metadata ?? {}), canvasEssential: true, sourceArtifactRefs };
      upsertExecutionCanvasNode(next, { id: "video:delivery", type: "video", label: "Remotion 成片", detail: `${result.compositionId} · ${media.durationSeconds.toFixed(2)}s · ${media.videoStreams[0].codec_name} + ${media.audioStreams[0].codec_name}`, stage: "edit", status: "complete", previewUri: video.relativePath, artifactRef: video.artifactRef, metadata: { compositionId: result.compositionId, entryPoint: result.entryPoint, renderReportRef: renderReport.artifactRef, sourceArtifactRefs, remotionProjection, segmentContinuity, transitionExecution } }, "stage:edit");
      if (next.openCutEditor?.activeSessionId) upsertOpenCutCanvasNode(next, next.openCutEditor.sessions[next.openCutEditor.activeSessionId]);
      next.events.push(event(next, "render.completed", "delivery", video.relativePath)); return next;
    } });
    return await withPostRenderAuditGate(snapshot, args);
  }
  if (name === "directorx_render_hyperframes_video") {
    const run = await readRun(args);
    requireExecutionApproval(run, "HyperFrames render", ["budget"]);
    requirePipelineStage(run, "edit", "HyperFrames render");
    assertRenderQualityReady(run, "hyperframes");
    const segmentContinuity = await assertRenderPropsBindSegmentStitch(run, { projectPath: args.projectPath, propsPath: args.continuityBindingPath });
    const transitionExecution = await assertRenderPropsBindTransitionExecution(run, { projectPath: args.projectPath, propsPath: args.continuityBindingPath });
    const result = await executeHyperframesRender(args);
    const media = await inspectMediaDelivery({ ...args, finalVideoPath: result.outputPath, requireAudio: args.requireAudio !== false });
    const receiptPath = await writeExecutionReceipt(args.projectPath, args.runId, "hyperframes_execution_receipt.json", {
      compositionPath: result.compositionPath, renderCwd: result.renderCwd, outputPath: result.outputPath,
      command: result.command, args: result.args, exitCode: result.exitCode, runtime: result.runtime, runtimeRelease: result.runtimeRelease,
      stdoutTail: result.stdout.slice(-4000), stderrTail: result.stderr.slice(-4000)
    });
    const renderReportPath = await writeExecutionReceipt(args.projectPath, args.runId, "render_report.json", {
      schemaVersion: "1.0", renderer: "hyperframes", finalVideoPath: media.videoPath, durationSeconds: media.durationSeconds, sizeBytes: media.sizeBytes,
      formatName: media.formatName, videoStreams: media.videoStreams, audioStreams: media.audioStreams,
      probe: { command: media.command, args: media.args }, segmentContinuity, transitionExecution, passed: true
    });
    const sourceArtifactRefs = [...new Set([...(run.generation?.candidates ?? []).filter((candidate) => candidate.status === "selected").map((candidate) => candidate.assetRef), run.artifacts?.["voiceover.audio"] ? "voiceover.audio" : null, run.artifacts?.["semantic_timeline.json"] ? "semantic_timeline.json" : null, segmentContinuity.required ? "segment_stitch_plan.json" : null].filter(Boolean))];
    const video = await inspectArtifact({ ...args, artifactRef: "delivery.video", path: result.outputPath, stage: "delivery", mediaKind: "video", metadata: { canvasEssential: true, renderer: "hyperframes", sourceArtifactRefs } });
    const receipt = await inspectArtifact({ ...args, artifactRef: "hyperframes_execution_receipt.json", path: receiptPath, stage: "edit", mediaKind: "document", metadata: { internal: true, sourceArtifactRefs: [video.artifactRef] } });
    const renderReport = await inspectArtifact({
      ...args,
      artifactRef: "render_report.json",
      path: renderReportPath,
      stage: "edit",
      mediaKind: "document",
      metadata: {
        renderer: "hyperframes",
        segmentContinuity,
        transitionExecution,
        sourceArtifactRefs: [
          video.artifactRef,
          ...(segmentContinuity.required ? ["segment_stitch_plan.json", "boundary_continuity_report.json"] : []),
          ...(transitionExecution.required ? ["transition_language_plan.json", "render_quality_contract.json"] : [])
        ]
      }
    });
    const snapshot = await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {};
      Object.assign(next.artifacts, { [video.artifactRef]: video, [receipt.artifactRef]: receipt, [renderReport.artifactRef]: renderReport });
      markOpenCutEditRendered(next, { finalVideoArtifactRef: video.artifactRef, finalVideoPath: video.path, sha256: video.sha256 });
      next.postRenderGate = { status: "full_frame_audit_required", mediaArtifactRef: video.artifactRef, mediaPath: video.path, mediaSha256: video.sha256, renderer: "hyperframes", requiredTool: "directorx_verify_final_media", createdAt: new Date().toISOString() };
      upsertExecutionCanvasNode(next, { id: "video:delivery", type: "video", label: "HyperFrames 成片", detail: `${media.durationSeconds.toFixed(2)}s · ${media.videoStreams[0].codec_name}${media.audioStreams[0] ? ` + ${media.audioStreams[0].codec_name}` : ""}`, stage: "edit", status: "complete", previewUri: video.relativePath, artifactRef: video.artifactRef, metadata: { renderer: "hyperframes", compositionPath: result.compositionPath, renderReportRef: renderReport.artifactRef, sourceArtifactRefs, segmentContinuity, transitionExecution } }, "stage:edit");
      next.events.push(event(next, "render.hyperframes.completed", "edit", video.relativePath));
      return next;
    } });
    return await withPostRenderAuditGate(snapshot, args);
  }
  if (name === "directorx_verify_final_media") {
    const run = await readRun(args);
    requireExecutionApproval(run, "Final media verification", ["budget"]);
    const manualEditor = run.openCutEditor?.sessions?.[run.openCutEditor?.activeSessionId];
    if (manualEditor?.status === "render_required") throw new Error("Render the committed Director X Cut timeline before running final-media review.");
    requirePipelineStage(run, "review", "Final media verification");
    const preservedSegmentContinuity = preserveSegmentContinuityRenderEvidence(run);
    const segmentContinuity = preservedSegmentContinuity.verification;
    const segmentContinuityBinding = preservedSegmentContinuity.binding;
    const preservedTransitionExecution = preserveTransitionExecutionRenderEvidence(run);
    const transitionExecution = preservedTransitionExecution.verification;
    const transitionExecutionBinding = preservedTransitionExecution.binding;
    const semanticTimeline = await readJsonArtifact(run, "semantic_timeline.json");
    if (!run.sceneCoveragePlan || !semanticTimeline) throw new Error("Final media verification requires scene_coverage_plan.json and semantic_timeline.json.");
    const result = await inspectMediaDelivery(args);
    const mockComponents = args.mockComponents ?? [];
    let quality = await analyzeFinalMediaQuality({ run, media: result, deliveryTier: args.deliveryTier, mockComponents, rightsStatus: args.rightsStatus, visualContinuityMode: args.visualContinuityMode ?? "multi_shot", singleTakeApprovalRef: args.singleTakeApprovalRef ?? null, timeoutMs: args.timeoutMs });
    const deliveryMediaRecord = await inspectArtifact({ ...args, artifactRef: "delivery.video", path: result.videoPath, stage: "delivery", mediaKind: "video", metadata: { canvasEssential: true, deliveryTier: args.deliveryTier, finalMedia: true } });
    quality = { ...quality, mediaArtifactRef: "delivery.video", mediaSha256: deliveryMediaRecord.sha256 };
    const sceneEvidenceFrameIndices = sceneCoverageEvidenceFrameIndices({ plan: run.sceneCoveragePlan, timeline: semanticTimeline, fps: quality.frameAudit?.fps ?? 30, frameCount: quality.frameAudit?.auditedFrameCount });
    const frameIdentity = await collectFrameIdentityEvidence({
      projectPath: args.projectPath,
      runId: args.runId,
      videoPath: result.videoPath,
      sourceMediaSha256: deliveryMediaRecord.sha256,
      stream: result.videoStreams[0],
      auditedFrameCount: quality.frameAudit?.auditedFrameCount ?? null,
      captureFrameIndices: [...new Set([...frameEvidenceCaptureIndices(quality.frameAudit), ...sceneEvidenceFrameIndices])],
      timeoutMs: args.timeoutMs
    });
    quality = updateQualityFrameAudit(quality, attachFrameIdentityToAudit(quality.frameAudit, frameIdentity));
    let sceneCoverageConformance = compileSceneCoverageConformance({
      plan: run.sceneCoveragePlan,
      timeline: semanticTimeline,
      frameAudit: quality.frameAudit,
      frameIdentity,
      mediaArtifactRef: "delivery.video",
      mediaSha256: deliveryMediaRecord.sha256,
      mediaDurationsByRef: artifactMediaDurations(run),
      finalDurationSeconds: result.durationSeconds,
      fps: quality.frameAudit?.fps ?? 30
    });
    const sceneCoverageEvidence = await extractSceneCoverageEvidence({ projectPath: args.projectPath, runId: args.runId, videoPath: result.videoPath, report: sceneCoverageConformance, frameIdentity, timeoutMs: args.timeoutMs });
    sceneCoverageConformance = attachSceneCoverageEvidence(sceneCoverageConformance, sceneCoverageEvidence);
    const sceneCoverageWritten = await writeSceneCoverageConformance({ ...args, report: sceneCoverageConformance });
    let frameAuditRepairPlan = await buildFrameAuditRepairPlan({ run, frameAudit: quality.frameAudit, mediaArtifactRef: "delivery.video", mediaSha256: deliveryMediaRecord.sha256, durationSeconds: result.durationSeconds });
    const frameEvidence = await extractFrameAuditEvidence({ projectPath: args.projectPath, runId: args.runId, videoPath: result.videoPath, repairPlan: frameAuditRepairPlan, frameIdentity, fps: quality.frameAudit?.fps ?? 30, timeoutMs: args.timeoutMs });
    frameAuditRepairPlan = attachFrameEvidenceToRepairPlan(frameAuditRepairPlan, frameEvidence);
    const reviewTimeline = mergeFrameAuditIntoReviewTimeline({ existingTimeline: run.avReviewTimeline ?? null, repairPlan: frameAuditRepairPlan, durationSeconds: result.durationSeconds, fps: quality.frameAudit?.fps ?? 30, mediaArtifactRef: "delivery.video" });
    const reportValues = {
      "render_report.json": { schemaVersion: "1.0", finalVideoArtifactRef: "delivery.video", finalVideoSha256: deliveryMediaRecord.sha256, finalVideoPath: result.videoPath, durationSeconds: result.durationSeconds, sizeBytes: result.sizeBytes, formatName: result.formatName, videoStreams: result.videoStreams, audioStreams: result.audioStreams, mediaIntegrity: result.mediaIntegrity, probe: { command: result.command, args: result.args }, segmentContinuity, segmentContinuityBinding, transitionExecution, transitionExecutionBinding, technicalPlaybackPassed: true, qualityGatePassed: false, frameAuditRef: "frame_audit_report.json", frameIdentityRef: "frame_identity.jsonl", frameAuditRepairPlanRef: "frame_audit_repair_plan.json", reviewerEvidenceRef: null, deliveryTier: args.deliveryTier },
      "frame_audit_report.json": { ...quality.frameAudit, mediaArtifactRef: "delivery.video", mediaSha256: deliveryMediaRecord.sha256, mediaIntegrity: result.mediaIntegrity, deliveryTier: args.deliveryTier, finalVideoPath: result.videoPath },
      "frame_audit_repair_plan.json": frameAuditRepairPlan,
      "av_review_timeline.json": reviewTimeline,
      "final_review.json": { schemaVersion: "1.1", mediaArtifactRef: "delivery.video", mediaSha256: deliveryMediaRecord.sha256, visualReview: args.visualReview, audioReview: args.audioReview, rightsStatus: args.rightsStatus, technicalPlaybackPassed: true, deliveryTier: args.deliveryTier, mockComponents, qualityGate: quality, frameAuditRepairPlanRef: "frame_audit_repair_plan.json", reviewerEvidenceRef: null, reviewerStatus: "required", approvedForUserReview: false, finalUserApproval: "pending" },
      "delivery_manifest.json": { schemaVersion: "1.1", finalVideoArtifactRef: "delivery.video", finalVideoSha256: deliveryMediaRecord.sha256, finalVideoPath: result.videoPath, durationSeconds: result.durationSeconds, rightsStatus: args.rightsStatus, deliveryTier: args.deliveryTier, mockComponents, qualityGatePassed: false, frameAuditRepairPlanRef: "frame_audit_repair_plan.json", reviewerEvidenceRef: null, deliveryStatus: quality.status === "repair_required" ? "quality_blocked" : "reviewer_evidence_required" }
    };
    const records = { "delivery.video": deliveryMediaRecord };
    for (const [shotId, evidence] of Object.entries(sceneCoverageEvidence)) for (const frame of evidence) records[frame.artifactRef] = await inspectArtifact({
      ...args,
      artifactRef: frame.artifactRef,
      path: frame.path,
      stage: "review",
      mediaKind: "image",
      metadata: { canvasEssential: true, owner: sceneCoverageReviewerId, shotId, role: frame.role, frameIndex: frame.frameIndex, decodeOrdinal: frame.decodeOrdinal, bestEffortTimestampTicks: frame.bestEffortTimestampTicks, ptsTimeSeconds: frame.ptsTimeSeconds, timeBase: frame.timeBase, streamIndex: frame.streamIndex, sourceMediaSha256: frame.sourceMediaSha256, extractionMode: frame.extractionMode, identityVerified: frame.identityVerified, sourceArtifactRefs: ["delivery.video", "scene_coverage_conformance_report.json", "frame_identity.jsonl"] }
    });
    for (const result of Object.values(sceneCoverageWritten)) records[result.artifactRef] = await inspectArtifact({
      ...args,
      artifactRef: result.artifactRef,
      path: result.path,
      stage: "review",
      mediaKind: "document",
      metadata: {
        internal: result.artifactRef.endsWith(".json"),
        canvasEssential: result.artifactRef === "scene_coverage_conformance_report.md",
        owner: sceneCoverageReviewerId,
        status: sceneCoverageConformance.status,
        sourceArtifactRefs: ["delivery.video", "scene_coverage_plan.json", "semantic_timeline.json", "frame_audit_report.json", "frame_identity.jsonl"]
      }
    });
    records[frameIdentity.artifactRef] = await inspectArtifact({ ...args, artifactRef: frameIdentity.artifactRef, path: frameIdentity.path, stage: "review", mediaKind: "document", metadata: { internal: true, sourceArtifactRefs: ["delivery.video"], frameCount: frameIdentity.frameCount, streamTimeBase: frameIdentity.streamTimeBase, variableFrameRateDetected: frameIdentity.variableFrameRateDetected } });
    for (const [findingId, frames] of Object.entries(frameEvidence)) for (const frame of frames) if (!records[frame.artifactRef]) records[frame.artifactRef] = await inspectArtifact({ ...args, artifactRef: frame.artifactRef, path: frame.path, stage: "review", mediaKind: "image", metadata: { canvasEssential: true, sourceArtifactRefs: ["delivery.video", "frame_audit_report.json", "frame_audit_repair_plan.json"], findingId, role: frame.role, frameIndex: frame.frameIndex, decodeOrdinal: frame.decodeOrdinal, sourceMediaSha256: frame.sourceMediaSha256, streamIndex: frame.streamIndex, timeBase: frame.timeBase, bestEffortTimestampTicks: frame.bestEffortTimestampTicks, presentationTimestamp: frame.presentationTimestamp, ptsTimeSeconds: frame.ptsTimeSeconds, extractionMode: frame.extractionMode, extractionReceipt: frame.extractionReceipt, identityVerified: frame.identityVerified } });
    for (const [artifactRef, value] of Object.entries(reportValues)) {
      const path = await writeExecutionReceipt(args.projectPath, args.runId, artifactRef, value);
      records[artifactRef] = await inspectArtifact({
        ...args,
        artifactRef,
        path,
        stage: artifactRef === "render_report.json" ? "edit" : ["frame_audit_report.json", "frame_audit_repair_plan.json", "av_review_timeline.json", "final_review.json"].includes(artifactRef) ? "review" : "delivery",
        mediaKind: "document",
        metadata: artifactRef === "render_report.json"
          ? {
              ...preservedSegmentContinuity.artifactMetadata,
              ...preservedTransitionExecution.artifactMetadata,
              sourceArtifactRefs: [...new Set([
                ...(preservedSegmentContinuity.artifactMetadata?.sourceArtifactRefs ?? []),
                ...(preservedTransitionExecution.artifactMetadata?.sourceArtifactRefs ?? []),
                "delivery.video",
                "frame_audit_report.json",
                "frame_identity.jsonl",
                "frame_audit_repair_plan.json"
              ])]
            }
          : artifactRef === "frame_audit_report.json"
            ? { internal: true, sourceArtifactRefs: ["delivery.video", "frame_identity.jsonl"], auditedFrameCount: quality.frameAudit?.auditedFrameCount }
          : artifactRef === "frame_audit_repair_plan.json"
            ? { sourceArtifactRefs: ["frame_audit_report.json", "frame_identity.jsonl", ...Object.values(frameEvidence).flat().map((frame) => frame.artifactRef), frameAuditRepairPlan.sourceTimelineRef].filter(Boolean), findingCount: frameAuditRepairPlan.findings.length }
            : artifactRef === "av_review_timeline.json"
              ? { internal: true, sourceArtifactRefs: ["frame_audit_report.json", "frame_identity.jsonl", "frame_audit_repair_plan.json"], markerCount: reviewTimeline.markers.length }
              : undefined
      });
    }
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {};
      delete next.artifacts["final_review_evidence.json"];
      next.finalReviewEvidence = null;
      Object.assign(next.artifacts, records);
      next.postRenderGate = { ...(next.postRenderGate ?? {}), status: "full_frame_audit_complete", mediaArtifactRef: "delivery.video", mediaPath: result.videoPath, mediaSha256: deliveryMediaRecord.sha256, completedAt: new Date().toISOString(), auditArtifactRef: "frame_audit_report.json", frameIdentityRef: frameIdentity.artifactRef };
      next.finalMediaReview = quality;
      next.deliveryManifest = reportValues["delivery_manifest.json"];
      next.frameAuditRepairPlan = frameAuditRepairPlan;
      next.sceneCoverageConformanceReport = sceneCoverageConformance;
      registerAvReviewTimeline(next, reviewTimeline);
      markOpenCutEditReviewed(next, { finalVideoArtifactRef: "delivery.video", finalVideoPath: result.videoPath, passed: false });
      upsertExecutionCanvasNode(next, { id: "review:final-media", type: "artifact", label: "最终媒体验收", detail: `${args.deliveryTier} · ${quality.status} · 等待 DX-Quality-Reviewer · PTS ${frameIdentity.frameCount} 帧 · 全帧 ${quality.frameAudit?.auditedFrameCount ?? 0}/${quality.frameAudit?.expectedFrameCount ?? "?"} · ${quality.visual.uniqueVisualClusters}/${quality.visual.expectedVisualClusters} visual clusters · ${quality.audio?.integratedLufs ?? "n/a"} LUFS${mockComponents.length ? ` · Mock: ${mockComponents.join(", ")}` : ""}`, stage: "review", status: quality.status === "repair_required" ? "blocked" : "active", artifactRef: "final_review.json", metadata: { rightsStatus: args.rightsStatus, deliveryTier: args.deliveryTier, qualityGate: quality, frameAuditRef: "frame_audit_report.json", frameIdentityRef: "frame_identity.jsonl", frameAuditRepairPlanRef: "frame_audit_repair_plan.json", reviewerStatus: "required", finalUserApproval: "pending" } }, "video:delivery");
      upsertExecutionCanvasNode(next, { id: "review:frame-audit-repair", type: "decision", label: "全帧证据与导演处置", detail: `${frameAuditRepairPlan.findings.length} findings · ${frameAuditRepairPlan.evidenceFrameCount ?? 0} evidence frames · ${frameAuditRepairPlan.mappedFindingCount} mapped to clips · ${frameAuditRepairPlan.status}`, stage: "review", status: frameAuditRepairPlan.status === "rerender_required" ? "blocked" : "active", artifactRef: "frame_audit_repair_plan.json", metadata: { findingCount: frameAuditRepairPlan.findings.length, evidenceFrameCount: frameAuditRepairPlan.evidenceFrameCount ?? 0, mappedFindingCount: frameAuditRepairPlan.mappedFindingCount, sourceTimelineRef: frameAuditRepairPlan.sourceTimelineRef, sourceArtifactRefs: ["frame_audit_report.json", "frame_identity.jsonl", frameAuditRepairPlan.sourceTimelineRef].filter(Boolean) } }, "review:final-media");
      upsertExecutionCanvasNode(next, { id: "review:scene-coverage-conformance", type: "decision", label: "导演镜头成片回查", detail: `${sceneCoverageConformance.shots.length} shots · ${sceneCoverageConformance.technicalBlockers.length} technical blockers · ${sceneCoverageConformance.status}`, stage: "review", status: sceneCoverageConformance.status === "awaiting_multimodal_review" ? "active" : "blocked", artifactRef: "scene_coverage_conformance_report.md", metadata: { owner: sceneCoverageReviewerId, reportId: sceneCoverageConformance.reportId, shotOrder: sceneCoverageConformance.shotOrder, technicalBlockerCodes: sceneCoverageConformance.technicalBlockers.map((item) => item.code), sourceArtifactRefs: sceneCoverageConformance.sourceRefs } }, "review:final-media");
      upsertExecutionCanvasNode(next, { id: `timeline:${reviewTimeline.timelineId}`, type: "artifact", label: "全帧审片时间轴", detail: `${result.durationSeconds.toFixed(2)}s · ${reviewTimeline.shots.length} clips · ${reviewTimeline.markers.length} evidence markers`, stage: "review", status: "complete", artifactRef: "av_review_timeline.json", metadata: { mediaArtifactRef: reviewTimeline.mediaArtifactRef, sourceArtifactRefs: ["frame_audit_report.json", "frame_audit_repair_plan.json"] } }, "review:frame-audit-repair");
      const deliveryNode = next.canvas.nodes.find((node) => node.id === "video:delivery");
      if (deliveryNode) deliveryNode.metadata = { ...(deliveryNode.metadata ?? {}), defects: frameAuditRepairPlan.findings.map((finding) => ({ code: finding.code, timeSeconds: finding.startSeconds, durationSeconds: finding.durationSeconds, description: `${finding.label}${finding.clipId ? ` · ${finding.clipId}` : ""} · ${finding.repairAction}`, evidenceRefs: finding.evidenceRefs, detectorDisposition: finding.detectorDisposition })), frameAuditRef: "frame_audit_report.json", frameIdentityRef: "frame_identity.jsonl", frameAuditRepairPlanRef: "frame_audit_repair_plan.json" };
      if (next.openCutEditor?.activeSessionId) upsertOpenCutCanvasNode(next, next.openCutEditor.sessions[next.openCutEditor.activeSessionId]);
      next.events.push(event(next, quality.status === "repair_required" ? "delivery.media.quality_failed" : "delivery.media.audit_ready", "review", quality.status === "repair_required" ? quality.blockers.join(", ") : `${result.durationSeconds.toFixed(2)}s · ${frameIdentity.frameCount} PTS identities · ${frameAuditRepairPlan.findings.length} findings · awaiting DX-Quality-Reviewer`));
      return next;
    } })), args);
  }
  if (name === "directorx_record_scene_coverage_review") {
    const current = await readRun(args);
    const reviewed = recordSceneCoverageConformanceReview(current.sceneCoverageConformanceReport, args.review, Object.keys(current.artifacts ?? {}));
    const written = await writeSceneCoverageConformance({ ...args, report: reviewed.report, evidence: reviewed.evidence });
    const records = {};
    for (const result of Object.values(written)) records[result.artifactRef] = await inspectArtifact({
      ...args,
      artifactRef: result.artifactRef,
      path: result.path,
      stage: "review",
      mediaKind: "document",
      metadata: {
        internal: result.artifactRef.endsWith(".json"),
        canvasEssential: ["scene_coverage_conformance_report.md", reviewed.evidence.artifactRef].includes(result.artifactRef),
        owner: sceneCoverageReviewerId,
        reviewId: reviewed.evidence.reviewId,
        decision: reviewed.evidence.decision,
        sourceArtifactRefs: ["delivery.video", "scene_coverage_plan.json", "semantic_timeline.json", "frame_audit_report.json", "frame_identity.jsonl", ...reviewed.evidence.dispositions.flatMap((item) => item.evidenceRefs)]
      }
    });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {};
      Object.assign(next.artifacts, records);
      next.sceneCoverageConformanceReport = reviewed.report;
      upsertExecutionCanvasNode(next, { id: "review:scene-coverage-conformance", type: "decision", label: "导演镜头成片回查", detail: `${reviewed.report.shots.length} shots · ${reviewed.evidence.decision} · ${reviewed.evidence.reviewerId}`, stage: "review", status: reviewed.report.status === "conformant" ? "complete" : "blocked", artifactRef: reviewed.evidence.artifactRef, metadata: { owner: reviewed.evidence.reviewerId, reportId: reviewed.report.reportId, reviewId: reviewed.evidence.reviewId, decision: reviewed.evidence.decision, unresolvedTaskIds: reviewed.evidence.unresolvedTaskIds, sourceArtifactRefs: ["scene_coverage_conformance_report.json", ...reviewed.evidence.dispositions.flatMap((item) => item.evidenceRefs)] } }, "review:final-media");
      next.events.push(event(next, reviewed.report.status === "conformant" ? "review.scene_coverage.conformant" : "review.scene_coverage.repair_required", "review", `${reviewed.evidence.reviewId} · ${reviewed.evidence.decision} · ${reviewed.evidence.unresolvedTaskIds.length} unresolved`));
      return next;
    } })), args);
  }
  if (name === "directorx_record_final_review_evidence") {
    const current = await readRun(args);
    const bundle = buildFinalReviewEvidence(current, args.review);
    const versionedReviewRef = bundle.evidence.versionedArtifactRef;
    const existingRenderReport = await readJsonArtifact(current, "render_report.json") ?? {};
    const reportValues = {
      "frame_audit_report.json": bundle.quality.frameAudit,
      "frame_audit_repair_plan.json": bundle.repairPlan,
      ...(bundle.timeline ? { "av_review_timeline.json": bundle.timeline } : {}),
      "final_review_evidence.json": bundle.evidence,
      [versionedReviewRef]: bundle.evidence,
      "final_review.json": bundle.finalReview,
      "delivery_manifest.json": bundle.deliveryManifest,
      "render_report.json": { ...existingRenderReport, qualityGatePassed: bundle.quality.passed, reviewerEvidenceRef: versionedReviewRef, finalReviewId: bundle.evidence.reviewId }
    };
    const records = {};
    for (const [artifactRef, value] of Object.entries(reportValues)) {
      const path = await writeExecutionReceipt(args.projectPath, args.runId, artifactRef, value);
      records[artifactRef] = await inspectArtifact({
        ...args,
        artifactRef,
        path,
        stage: artifactRef === "render_report.json" ? "edit" : artifactRef === "delivery_manifest.json" ? "delivery" : "review",
        mediaKind: "document",
        metadata: {
          internal: ["frame_audit_report.json", "av_review_timeline.json"].includes(artifactRef),
          canvasEssential: ["final_review.json", versionedReviewRef].includes(artifactRef),
          sourceArtifactRefs: [...new Set(["delivery.video", "frame_audit_report.json", "frame_identity.jsonl", "frame_audit_repair_plan.json", ...(["final_review_evidence.json", versionedReviewRef].includes(artifactRef) ? bundle.evidence.dispositions.flatMap((item) => item.evidenceRefs) : [])].filter((ref) => ref !== artifactRef))],
          reviewId: bundle.evidence.reviewId,
          reviewerId: bundle.evidence.reviewerId,
          decision: bundle.evidence.decision
        }
      });
    }
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(next) {
      next.artifacts ??= {};
      Object.assign(next.artifacts, records);
      next.finalReviewEvidence = bundle.evidence;
      next.finalMediaReview = bundle.quality;
      next.deliveryManifest = bundle.deliveryManifest;
      next.frameAuditRepairPlan = bundle.repairPlan;
      if (bundle.timeline) registerAvReviewTimeline(next, bundle.timeline);
      markOpenCutEditReviewed(next, { finalVideoArtifactRef: args.review.mediaArtifactRef, finalVideoPath: next.artifacts?.[args.review.mediaArtifactRef]?.path, passed: bundle.finalReview.approvedForUserReview });
      upsertExecutionCanvasNode(next, { id: "review:final-media", type: "artifact", label: "最终媒体验收", detail: `${bundle.quality.deliveryTier} · ${bundle.evidence.decision} · ${bundle.evidence.inspectedFindingIds.length} findings inspected · ${bundle.evidence.reviewerId}`, stage: "review", status: bundle.finalReview.approvedForUserReview ? "complete" : "blocked", artifactRef: "final_review.json", metadata: { qualityGate: bundle.quality, frameAuditRef: "frame_audit_report.json", frameIdentityRef: "frame_identity.jsonl", frameAuditRepairPlanRef: "frame_audit_repair_plan.json", reviewerEvidenceRef: versionedReviewRef, reviewId: bundle.evidence.reviewId, reviewerId: bundle.evidence.reviewerId, decision: bundle.evidence.decision, finalUserApproval: "pending" } }, "video:delivery");
      upsertExecutionCanvasNode(next, { id: "review:frame-audit-repair", type: "decision", label: "全帧证据与导演处置", detail: `${bundle.repairPlan.findings.length} findings · ${bundle.repairPlan.evidenceFrameCount ?? 0} evidence frames · ${bundle.evidence.decision}`, stage: "review", status: bundle.evidence.decision === "accept" ? "complete" : "blocked", artifactRef: versionedReviewRef, metadata: { reviewId: bundle.evidence.reviewId, reviewerId: bundle.evidence.reviewerId, decision: bundle.evidence.decision, unresolvedFindingIds: bundle.evidence.unresolvedFindingIds, sourceArtifactRefs: ["frame_audit_report.json", "frame_identity.jsonl", "frame_audit_repair_plan.json"] } }, "review:final-media");
      const deliveryNode = next.canvas.nodes.find((node) => node.id === "video:delivery");
      if (deliveryNode) deliveryNode.metadata = { ...(deliveryNode.metadata ?? {}), defects: bundle.repairPlan.findings.map((finding) => ({ code: finding.code, timeSeconds: finding.startSeconds, durationSeconds: finding.durationSeconds, description: `${finding.label} · ${finding.detectorDisposition} · ${finding.dispositionReason}`, evidenceRefs: finding.evidenceRefs, detectorDisposition: finding.detectorDisposition, reviewId: finding.reviewId })), reviewerEvidenceRef: versionedReviewRef };
      next.events.push(event(next, bundle.finalReview.approvedForUserReview ? "delivery.media.review_accepted" : "delivery.media.repair_required", "review", `${bundle.evidence.reviewId} · ${bundle.evidence.decision} · ${bundle.evidence.unresolvedFindingIds.length} unresolved`));
      return next;
    } })), args);
  }
  if (name === "directorx_score_reference_replication") {
    const current = await readRun(args);
    const report = compileReferenceReplicationReview(current, args);
    const written = await writeReferenceReplicationReview({ ...args, report });
    const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: "review", mediaKind: "document", metadata: { canvasEssential: true, owner: "DX-Quality-Reviewer", sourceArtifactRefs: [report.source.videoArtifactRef, report.source.audioArtifactRef, report.output.artifactRef, ...report.auditRefs].filter(Boolean), comparisonMode: "difference", weightedScore: report.weightedScore, decision: report.decision, recommendation: report.recommendation } });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      run.replicationConformanceReport = report;
      upsertExecutionCanvasNode(run, { id: `replication-review:${report.reportId}`, type: "decision", label: "复刻差异审计", detail: `${report.decision} · ${report.weightedScore.toFixed(2)} · ${report.weakDimensions.length ? `弱项 ${report.weakDimensions.join("、")}` : "通过评分线"}`, stage: "review", status: report.decision === "pass_export" ? "complete" : "blocked", artifactRef: record.artifactRef, metadata: { comparisonMode: "difference", sourceArtifactRefs: report.comparison.compareArtifactRefs, weightedScore: report.weightedScore, minimumScore: report.minimumScore, recommendation: report.recommendation, nextAction: report.nextAction } }, "review:final-media");
      run.events.push(event(run, report.decision === "pass_export" ? "review.replication.pass_export" : "review.replication.regenerate", "review", `${report.reportId} · ${report.weightedScore} · ${report.decision}`));
      return run;
    } })), args);
  }
  if (name === "directorx_review_generation_candidate") {
    return await mutateGeneration(args, (run) => {
      reviewGenerationCandidate(run, args);
      const candidate = run.generation.candidates.find((item) => item.candidateId === args.candidateId);
      const node = run.canvas.nodes.find((item) => item.id === `candidate:${args.candidateId}`);
      if (node) { node.status = args.decision === "accept" ? "complete" : args.decision === "terminate" ? "failed" : "blocked"; node.detail = `${args.decision} · ${candidate.qualityScore.toFixed(2)} · ${args.reason}`; node.metadata = { ...node.metadata, scores: args.scores, evidence: args.evidence ?? [], defects: args.defects ?? [], criticalFloor: candidate.criticalFloor, decision: args.decision, failureType: args.failureType, promptDelta: args.promptDelta }; }
      return run;
    }, "generation.candidate.reviewed", `${args.candidateId} · ${args.decision}`);
  }
  if (name === "directorx_compile_generation_repair") {
    const current = await readRun(args);
    const plan = compileGenerationRepairPlan(current, args);
    const written = await writeGenerationRepairArtifacts({ ...args, plan });
    const jsonRecord = await inspectArtifact({ ...args, artifactRef: written.json.artifactRef, path: written.json.path, stage: "generation", mediaKind: "document", metadata: { internal: true, sourceArtifactRefs: [`candidate:${args.candidateId}`, "shot_review_report.json"] } });
    const summaryRecord = await inspectArtifact({ ...args, artifactRef: written.summary.artifactRef, path: written.summary.path, stage: "generation", mediaKind: "document", metadata: { canvasEssential: true, sourceArtifactRefs: [`candidate:${args.candidateId}`, written.json.artifactRef] } });
    const snapshot = await updateRun({ ...args, mutate(run) {
      const candidate = run.generation?.candidates?.find((item) => item.candidateId === args.candidateId && item.requestId === args.requestId);
      if (!candidate || candidate.reviewedAt !== plan.sourceReview.reviewedAt || candidate.decision !== plan.sourceReview.decision) throw new Error("Candidate review changed while the generation repair plan was being compiled; compile again from the latest review.");
      run.generationRepairs ??= {};
      if (run.generationRepairs[plan.repairId]) throw new Error(`Duplicate generation repair plan: ${plan.repairId}`);
      run.generationRepairs[plan.repairId] = plan;
      candidate.repairPlanIds = [...new Set([...(candidate.repairPlanIds ?? []), plan.repairId])];
      run.artifacts ??= {};
      run.artifacts[jsonRecord.artifactRef] = jsonRecord;
      run.artifacts[summaryRecord.artifactRef] = summaryRecord;
      upsertExecutionCanvasNode(run, {
        id: `generation-repair:${plan.repairId}`, type: "artifact", label: `生成修复 · ${plan.shotId}`,
        detail: `${plan.diagnosis.primaryDefect} · 只改 ${plan.repair.controlVariable} · ${plan.execution.disposition}`,
        stage: "generation", status: plan.execution.disposition === "request_approval" ? "blocked" : "complete",
        artifactRef: summaryRecord.artifactRef,
        metadata: { repairId: plan.repairId, sourceCandidateId: plan.sourceCandidateId, action: plan.repair.action, controlVariable: plan.repair.controlVariable, nextTool: plan.execution.nextTool, requiresNativeApproval: plan.execution.requiresNativeApproval, sourceArtifactRefs: [`candidate:${args.candidateId}`, jsonRecord.artifactRef] }
      }, `candidate:${args.candidateId}`);
      run.events.push(event(run, "generation.repair.compiled", "generation", `${plan.repairId} · ${plan.repair.action} · ${plan.repair.controlVariable}`));
      return run;
    } });
    return await withBrowserCanvas(publicSnapshot(snapshot), args);
  }
  if (name === "directorx_select_generation_candidate") {
    return await mutateGeneration(args, (run) => {
      selectGenerationCandidate(run, args);
      const node = run.canvas.nodes.find((item) => item.id === `candidate:${args.candidateId}`);
      if (node) { node.status = "complete"; node.detail = `已选入剪辑 · ${node.detail}`; node.metadata = { ...node.metadata, selected: true }; }
      return run;
    }, "generation.candidate.selected", `${args.candidateId} selected for edit`);
  }
  if (name === "directorx_create_repair_branch") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      const branch = createRepairBranch(run, args); const written = await writeRepairBranches({ ...args, repairs: run.repairs });
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "review" });
      upsertExecutionCanvasNode(run, { id: `repair:${branch.repairId}`, type: "artifact", label: `局部修复 · ${branch.repairId}`, detail: `${branch.defectCodes.join(", ")} · ${branch.scope.startSeconds}-${branch.scope.endSeconds}s`, stage: "review", status: "active", artifactRef: written.artifactRef, metadata: branch }, `candidate:${branch.sourceCandidateId}`);
      run.events.push(event(run, "repair.branch.created", "review", `${branch.repairId} from ${branch.sourceCandidateId}`)); return run;
    } })), args);
  }
  if (name === "directorx_complete_repair_branch") {
    const artifactRef = `candidate:${args.outputCandidateId}`;
    const media = await inspectArtifact({ ...args, artifactRef, path: args.localPath, stage: "generation", mediaKind: args.mediaType });
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      const branch = completeRepairBranch(run, { ...args, outputAssetRef: artifactRef, previewUri: media.relativePath });
      run.artifacts[artifactRef] = media; const written = await writeRepairBranches({ ...args, repairs: run.repairs }); run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "review" });
      const repairNode = run.canvas.nodes.find((item) => item.id === `repair:${branch.repairId}`); if (repairNode) { repairNode.status = "complete"; repairNode.detail = `修复完成 · ${branch.outputCandidateId}`; repairNode.metadata = branch; }
      upsertCandidateCanvasNode(run, { requestId: run.generation.candidates.find((item) => item.candidateId === args.outputCandidateId).requestId, attemptId: `repair:${branch.repairId}`, candidateId: args.outputCandidateId, mediaType: args.mediaType, actualCost: args.actualCost, providerResultId: args.providerResultId }, media, "awaiting_review");
      const lineageEdge = { id: `repair-output:${branch.repairId}:${args.outputCandidateId}`, source: `repair:${branch.repairId}`, target: `candidate:${args.outputCandidateId}`, kind: "repair_output" }; if (!run.canvas.edges.some((item) => item.id === lineageEdge.id)) run.canvas.edges.push(lineageEdge);
      run.events.push(event(run, "repair.branch.completed", "review", `${branch.repairId} -> ${branch.outputCandidateId}`)); return run;
    } })), args);
  }
  if (name === "directorx_configure_run_mode") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      requireResolvedInteraction(run, args.interactionRequestId, "run_mode");
      configureRunMode(run, args);
      run.events.push(event(run, "run.mode.configured", "intake", args.mode));
      const written = await appendRunCheckpoint({ ...args, run, reason: "run.mode.configured", detail: args.mode });
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: "intake" });
      return run;
    } })), args);
  }
  if (name === "directorx_approve_stage") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      requireResolvedInteraction(run, args.interactionRequestId, "stage_approval");
      approveStage(run, args);
      run.events.push(event(run, "stage.approval.recorded", args.stageId, args.note));
      const written = await appendRunCheckpoint({ ...args, run, reason: "stage.approval", detail: `${args.stageId} · ${args.note}` });
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: args.stageId });
      return run;
    } })), args);
  }
  if (name === "directorx_recover_run") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const gate = run.recoveryGate;
      if (gate?.status !== "blocked") return run;
      const written = await appendRunCheckpoint({
        ...args,
        run,
        reason: "recovery.requested",
        detail: args.detail
      });
      run.artifacts ??= {};
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: run.stage });
      run.events.push(event(run, "run.recovery.requested", run.stage, `${args.recoveryAction} · ${gate.toolName}`));
      run.recoveryGate = null;
      return run;
    } })), args);
  }
  if (name === "directorx_checkpoint_run") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      const written = await appendRunCheckpoint({ ...args, run });
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: run.stage });
      run.events.push(event(run, "checkpoint.written", run.stage, `${written.checkpoint.checkpointId} · ${args.reason}`));
      return run;
    } })), args);
  }
  if (name === "directorx_resume_run") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      if (!run.checkpoints?.length) throw new Error("This Run has no durable checkpoint to resume from.");
      run.status = run.status === "complete" ? "complete" : "production_in_progress";
      const latest = run.checkpoints.at(-1);
      run.events.push(event(run, "run.resumed", latest.stage, `Resumed from ${latest.checkpointId} at event ${latest.eventCursor}`));
      const written = await appendRunCheckpoint({ ...args, run, reason: "run.resumed", detail: latest.checkpointId });
      run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: run.stage });
      return run;
    } })), args);
  }
  if (name === "directorx_prepare_fast_start_intake") {
    const snapshot = await updateRun({ ...args, mutate: async (run) => {
      if (!run.goal?.boundAt) throw new Error("Bind the native Codex Goal before preparing fast-start Intake.");
      if (!run.runMode?.mode) throw new Error("Confirm the Director X run mode through Codex request_user_input before preparing fast-start Intake.");
      if (run.stage !== "intake") throw new Error("Fast-start Intake can only be prepared while the Run is in Intake.");
      const selected = createPipelineRunState(args.pipelineId);
      if (run.pipeline && run.pipeline.id !== selected.id) throw new Error("The Run already has a different pipeline. Record user approval before replacing it.");
      const existingIntakeArtifacts = selected.stages.find((stage) => stage.id === "intake").requiredOutputs.filter((artifactRef) => run.artifacts?.[artifactRef]);
      if (existingIntakeArtifacts.length) throw new Error(`Fast-start Intake will not overwrite existing production promises: ${existingIntakeArtifacts.join(", ")}`);
      const needsIntakeInteraction = args.intake.questionsAsked.length || args.intake.userAnswers.length || args.resolution.clarity === "clarified" || args.resolution.questionsAsked.length || args.resolution.userAnswers.length;
      if (needsIntakeInteraction) requireResolvedInteraction(run, args.interactionRequestId, "intake");
      confirmIntake(run, args.intake);
      const platform = run.intakeGate.decisions.find((decision) => decision.field === "platform")?.value?.trim();
      const productionRoute = run.intakeGate.decisions.find((decision) => decision.field === "production_route")?.value?.trim();
      if (args.director.platform.trim() !== platform) throw new Error("Director platform must match the confirmed Intake platform.");

      const intakeWritten = await writeIntakeConfirmation(args);
      const intentWritten = await writeIntentResolution(args);
      const isReferenceReplication = args.pipelineId === "reference-replication";
      const directorWritten = isReferenceReplication ? null : await writeDirectorDocument(args);
      const briefWritten = await writeProjectBrief({ ...args, brief: {
        videoType: args.production.videoType,
        targetPlatform: platform,
        budgetCap: args.production.budgetCap,
        durationSeconds: args.production.durationSeconds,
        qualityTarget: args.production.qualityTarget,
        runMode: run.runMode.mode
      } });
      const deliveryWritten = await writeDeliveryPromise({ ...args, brief: briefWritten.artifact, delivery: { ...args.delivery, primaryProductionPath: productionRoute } });
      const complexity = planProductionComplexity(args.production);
      const complexityPath = await writeExecutionReceipt(args.projectPath, args.runId, "production_complexity_plan.json", complexity);
      const records = await Promise.all([
        inspectArtifact({ ...args, artifactRef: intakeWritten.artifactRef, path: intakeWritten.path, stage: "intake", mediaKind: "document" }),
        inspectArtifact({ ...args, artifactRef: intentWritten.artifactRef, path: intentWritten.path, stage: "intake", mediaKind: "document" }),
        ...(directorWritten ? [
          inspectArtifact({ ...args, artifactRef: directorWritten.artifactRef, path: directorWritten.path, stage: "intake", mediaKind: "document", metadata: { canvasEssential: true, contractRef: directorWritten.contractArtifactRef, fingerprint: directorWritten.fingerprint } }),
          inspectArtifact({ ...args, artifactRef: directorWritten.contractArtifactRef, path: directorWritten.contractPath, stage: "intake", mediaKind: "document", metadata: { fingerprint: directorWritten.fingerprint } })
        ] : []),
        inspectArtifact({ ...args, artifactRef: briefWritten.artifactRef, path: briefWritten.path, stage: "intake", mediaKind: "document" }),
        inspectArtifact({ ...args, artifactRef: deliveryWritten.artifactRef, path: deliveryWritten.path, stage: "intake", mediaKind: "document" }),
        inspectArtifact({ ...args, artifactRef: "production_complexity_plan.json", path: complexityPath, stage: "intake", mediaKind: "document", metadata: { internal: true, profile: complexity.profile } })
      ]);

      run.pipeline = run.pipeline ?? selected;
      run.intentResolution = { ...args.resolution, artifactRef: intentWritten.artifactRef, path: intentWritten.path };
      if (directorWritten) run.directorDocument = directorWritten;
      run.projectBrief = briefWritten.artifact;
      run.deliveryPromise = deliveryWritten.artifact;
      run.productionComplexityPlan = complexity;
      run.artifacts ??= {};
      for (const record of records) run.artifacts[record.artifactRef] = record;
      run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } };
      if (directorWritten) {
        const node = { id: "document:director", type: "document", label: "Director.md", detail: args.director.logline, stage: "intake", status: "complete", artifactRef: "Director.md", metadata: { path: directorWritten.path, contractRef: directorWritten.contractArtifactRef, fingerprint: directorWritten.fingerprint }, updatedAt: new Date().toISOString() };
        const nodeIndex = run.canvas.nodes.findIndex((item) => item.id === node.id);
        if (nodeIndex >= 0) run.canvas.nodes[nodeIndex] = node; else run.canvas.nodes.push(node);
      }
      run.events.push(event(run, "fast_start.intake.prepared", "intake", `${selected.id} · ${complexity.profile} · ${directorWritten ? "7" : "6"} required artifacts; Director.md deferred until reference planning`));
      return run;
    } });
    const response = await withBrowserCanvas(publicSnapshot(snapshot), args);
    return { ...response, readiness: evaluateFastStartReadiness(snapshot) };
  }
  if (name === "directorx_select_pipeline") {
    const selected = createPipelineRunState(args.pipelineId);
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      if (run.pipeline && run.pipeline.id !== selected.id) throw new Error("The run already has a pipeline. Record user approval before replacing it.");
      run.pipeline = selected;
      run.events.push(event(run, "pipeline.selected", "intake", `${selected.label} pipeline selected`));
      return run;
    } })), args);
  }
  if (name === "directorx_plan_production_complexity") {
    const plan = planProductionComplexity(args);
    const path = await writeExecutionReceipt(args.projectPath, args.runId, "production_complexity_plan.json", plan);
    const record = await inspectArtifact({ ...args, artifactRef: "production_complexity_plan.json", path, stage: "intake", mediaKind: "document", metadata: { internal: true, profile: plan.profile, sourceArtifactRefs: ["project_brief.json", "delivery_promise.json"].filter((ref) => Boolean(ref)) } });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      run.productionComplexityPlan = plan;
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      run.events.push(event(run, "production.complexity.planned", "intake", `${plan.profile} · max DX concurrency ${plan.settings.maxConcurrency} · ${plan.settings.reviewMode}`));
      return run;
    } }), args);
  }
  if (name === "directorx_get_fast_start_status") {
    const run = await readRun(args);
    return { readiness: evaluateFastStartReadiness(run), researchReadiness: evaluateReferenceResearchReadiness(run), creativeProgressSla: evaluateCreativeProgressSla(run) };
  }
  if (name === "directorx_get_recovery_action") {
    const run = await readRun(args);
    return { recovery: run.recoveryGate?.recovery ?? projectRecoveryAction(run.recoveryGate ?? {}) };
  }
  if (name === "directorx_begin_creative_work") {
    const current = await readRun(args);
    if (current.stage === "research" && current.fastStart?.status === "reference_research_started") {
      return await withRunResumeActions(current, args);
    }
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      const fastStart = beginCreativeWork(run);
      assertRunModeAllowsStage(run, "research", "begin");
      const intake = run.pipeline.stages.find((stage) => stage.id === "intake");
      const evidenceRefs = intake.requiredOutputs;
      run.pipeline = transitionPipelineStage(run.pipeline, run.approvals, { stageId: "intake", action: "complete", detail: "Minimum Intake complete; deferred governance moved to Generation.", evidenceRefs });
      run.pipeline = transitionPipelineStage(run.pipeline, run.approvals, { stageId: "research", action: "begin", detail: "Fast-start research, reference analysis, asset search, and scripting can run in parallel." });
      run.stage = "research";
      run.status = "production_in_progress";
      run.events.push(event(run, "fast_start.ready", "research", `Creative asset SLA ${fastStart.creativeAssetSlaMinutes} minutes`));
      run.events.push(event(run, "stage.complete", "intake", "Minimum Intake complete"));
      run.events.push(event(run, "stage.active", "research", "Creative work started"));
      return run;
    } }), args);
  }
  if (name === "directorx_begin_reference_research") {
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      const fastStart = beginReferenceResearch(run);
      run.events.push(event(run, "reference.research.started", "research", `Reference-first lane started · generation blockers ${fastStart.generationBlockers.join(", ") || "none"}`));
      return run;
    } }), args);
  }
  if (name === "directorx_plan_production_team") {
    const current = await readRun(args);
    if (!current.executionGraph) throw new Error("Register execution_graph.json before planning the DX production team.");
    if (!current.productionComplexityPlan) throw new Error("Call directorx_plan_production_complexity before planning the DX production team.");
    const installation = assertCanInstallSubagentPlan(current, args.planId);
    if (installation.status === "existing_plan") return await withRunResumeActions(current, args);
    const tasks = compileExecutionGraphSubagentTasks(current, args);
    const plan = planParallelSubagents(current, { ...args, tasks });
    const snapshot = await updateRun({ ...args, async mutate(run) {
      run.subagentOrchestrationPlan = plan;
      await persistSubagentOrchestrationArtifacts(run, args);
      run.events.push(event(run, "subagent.production_team.compiled", "intake", `${plan.tasks.length} canonical DX tasks compiled from execution_graph.json · ${plan.batches.length} dependency batches · max concurrency ${plan.maxConcurrency}`));
      return run;
    } });
    return await withRunResumeActions(snapshot, args);
  }
  if (name === "directorx_plan_parallel_subagents") {
    const current = await readRun(args);
    if (!current.executionGraph) throw new Error("Register execution_graph.json before planning DX subagent dispatch.");
    const installation = assertCanInstallSubagentPlan(current, args.planId);
    if (installation.status === "existing_plan") return await withRunResumeActions(current, args);
    const plan = planParallelSubagents(current, args);
    const snapshot = await updateRun({ ...args, async mutate(run) {
      run.subagentOrchestrationPlan = plan;
      await persistSubagentOrchestrationArtifacts(run, args);
      run.events.push(event(run, "subagent.parallel_plan.registered", "intake", `${plan.tasks.length} DX tasks · ${plan.batches.length} dependency batches · max concurrency ${plan.maxConcurrency}`));
      return run;
    } });
    return await withRunResumeActions(snapshot, args);
  }
  if (name === "directorx_compile_claim_proof_map") {
    const current = await readRun(args);
    requireNativeGoalBound(current, "Claim-to-proof compilation");
    assertStageParallelDispatchStarted(current, "script", "claim_to_proof_map.json");
    const value = compileClaimProofMap(args);
    const written = await writeDirectorGenerationArtifact({ ...args, artifactRef: "claim_to_proof_map.json", value });
    const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: "script", mediaKind: "document", metadata: { canvasEssential: true, owner: "DX-Director", sourceArtifactRefs: [args.scriptArtifactRef ?? "script_or_outline.json"] } });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      run.claimProofMap = value;
      run.artifacts ??= {};
      run.artifacts[record.artifactRef] = record;
      upsertExecutionCanvasNode(run, { id: "script:claim-proof", type: "document", label: "主张与证明", detail: `${value.claims.length} 项主张 · ${value.proofShotIds.length} 个证明镜头`, stage: "script", status: "complete", artifactRef: record.artifactRef, metadata: { sourceArtifactRefs: record.metadata.sourceArtifactRefs } }, "stage:script");
      run.events.push(event(run, "script.claim_proof.ready", "script", `${value.factualClaimCount} factual claims verified`));
      return run;
    } }), args);
  }
  if (name === "directorx_compile_shot_grounding_plan") {
    const current = await readRun(args);
    requireNativeGoalBound(current, "Shot grounding planning");
    requirePipelineStage(current, "storyboard", "Shot grounding planning");
    const registeredShotlist = current.artifacts?.["shotlist.json"];
    if (!registeredShotlist?.path) throw new Error("Register the real shotlist.json before compiling per-shot grounding.");
    const verifiedShotlistRecord = await inspectArtifact({
      ...args,
      artifactRef: "shotlist.json",
      path: registeredShotlist.path,
      stage: registeredShotlist.stage ?? "storyboard",
      mediaKind: "document",
      metadata: registeredShotlist.metadata ?? {}
    });
    if (registeredShotlist.sha256 && registeredShotlist.sha256 !== verifiedShotlistRecord.sha256) {
      throw new Error("Registered shotlist.json changed after registration. Re-register it before per-shot grounding.");
    }
    let shotlist;
    try {
      shotlist = JSON.parse(await readFile(verifiedShotlistRecord.path, "utf8"));
    } catch {
      throw new Error("Registered shotlist.json must be valid JSON.");
    }
    const plan = bindShotGroundingPlanToShotlist(compileShotGroundingPlan(args), {
      artifactRef: verifiedShotlistRecord.artifactRef,
      sha256: verifiedShotlistRecord.sha256,
      shotlist
    });
    const written = await writeShotGroundingArtifacts({ ...args, plan });
    const planRecord = await inspectArtifact({
      ...args,
      artifactRef: written.plan.artifactRef,
      path: written.plan.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: {
        internal: true,
        owner: "DX-Reference-Analyst",
        sourceArtifactRefs: ["shotlist.json", "claim_to_proof_map.json", "asset_manifest.json"].filter((ref) => current.artifacts?.[ref]),
        shotlistSha256: verifiedShotlistRecord.sha256,
        sequenceId: plan.sequenceId
      }
    });
    const summaryRecord = await inspectArtifact({
      ...args,
      artifactRef: written.planSummary.artifactRef,
      path: written.planSummary.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: {
        canvasEssential: true,
        owner: "DX-Reference-Analyst",
        sourceArtifactRefs: [planRecord.artifactRef],
        sequenceId: plan.sequenceId
      }
    });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      run.shotGroundingPlan = plan;
      run.shotGroundingReport = null;
      run.artifacts ??= {};
      run.artifacts["shotlist.json"] = verifiedShotlistRecord;
      run.artifacts[planRecord.artifactRef] = planRecord;
      run.artifacts[summaryRecord.artifactRef] = summaryRecord;
      upsertExecutionCanvasNode(run, {
        id: `shot-grounding-plan:${plan.sequenceId}`,
        type: "document",
        label: "逐镜头素材与事实检索计划",
        detail: `${plan.shots.length} 个镜头 · ${plan.taskCount} 项检索/验证任务 · ${plan.decision}`,
        stage: "storyboard",
        status: plan.status === "ready" ? "complete" : "active",
        artifactRef: summaryRecord.artifactRef,
        metadata: {
          canvasEssential: true,
          sourceArtifactRefs: summaryRecord.metadata.sourceArtifactRefs,
          planArtifactRef: planRecord.artifactRef,
          shotlistSha256: verifiedShotlistRecord.sha256,
          taskCount: plan.taskCount
        }
      }, "stage:storyboard");
      run.events.push(event(run, "storyboard.shot_grounding.planned", "storyboard", `${plan.taskCount} per-shot research tasks`));
      return run;
    } }), args);
  }
  if (name === "directorx_finalize_shot_grounding") {
    const current = await readRun(args);
    requireNativeGoalBound(current, "Shot grounding finalization");
    requirePipelineStage(current, "storyboard", "Shot grounding finalization");
    const report = finalizeShotGrounding(current, args);
    const written = await writeShotGroundingArtifacts({ ...args, report });
    const assetArtifactRefs = report.authorizedGenerationAnchorRefs.map((assetRef) =>
      (current.assets ?? []).find((asset) => [asset.id, asset.artifactRef].includes(assetRef))?.artifactRef
    ).filter(Boolean);
    const sourceArtifactRefs = [...new Set(["shot_grounding_plan.json", ...report.evidenceRefs, ...assetArtifactRefs].filter((ref) => current.artifacts?.[ref]))];
    const reportRecord = await inspectArtifact({
      ...args,
      artifactRef: written.report.artifactRef,
      path: written.report.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: {
        internal: true,
        owner: "DX-Asset-Manager",
        sourceArtifactRefs,
        shotlistSha256: report.sourceBinding.sha256,
        sequenceId: report.sequenceId,
        authorizedGenerationAnchorRefs: report.authorizedGenerationAnchorRefs
      }
    });
    const summaryRecord = await inspectArtifact({
      ...args,
      artifactRef: written.reportSummary.artifactRef,
      path: written.reportSummary.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: {
        canvasEssential: true,
        owner: "DX-Asset-Manager",
        sourceArtifactRefs: [reportRecord.artifactRef, ...sourceArtifactRefs],
        sequenceId: report.sequenceId
      }
    });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      run.shotGroundingReport = report;
      run.artifacts ??= {};
      run.artifacts[reportRecord.artifactRef] = reportRecord;
      run.artifacts[summaryRecord.artifactRef] = summaryRecord;
      upsertExecutionCanvasNode(run, {
        id: `shot-grounding-report:${report.sequenceId}`,
        type: "document",
        label: "逐镜头素材与事实完成报告",
        detail: `${report.shots.length} 个镜头 · ${report.authorizedGenerationAnchorRefs.length} 个可生成锚点 · ${report.status}`,
        stage: "storyboard",
        status: report.status === "ready" ? "complete" : "blocked",
        artifactRef: summaryRecord.artifactRef,
        metadata: {
          canvasEssential: true,
          sourceArtifactRefs: summaryRecord.metadata.sourceArtifactRefs,
          reportArtifactRef: reportRecord.artifactRef,
          evidenceRefs: report.evidenceRefs,
          authorizedGenerationAnchorRefs: report.authorizedGenerationAnchorRefs
        }
      }, `shot-grounding-plan:${report.sequenceId}`);
      run.events.push(event(run, `storyboard.shot_grounding.${report.status}`, "storyboard", `${report.authorizedGenerationAnchorRefs.length} authorized generation anchors`));
      return run;
    } }), args);
  }
  if (name === "directorx_compile_visual_prompt_pack") {
    const current = await readRun(args);
    requireNativeGoalBound(current, "Visual prompt compilation");
    if (!current.artifacts?.["claim_to_proof_map.json"]) throw new Error("Compile claim_to_proof_map.json before visual prompts.");
    if (current.sceneCoveragePlan?.status !== "ready" || current.sceneCoveragePlan?.sourceBinding?.status !== "ready") {
      throw new Error("Compile a ready scene_coverage_plan.json bound to the real shotlist before visual prompts.");
    }
    if (current.shotSequenceReview?.status !== "ready" || current.shotSequenceReview?.sourceBinding?.status !== "ready") {
      throw new Error("Compile a ready shot_sequence_review.json bound to the real shotlist before visual prompts.");
    }
    if (current.shotGroundingReport?.status !== "ready" || current.shotGroundingReport?.sourceBinding?.status !== "ready") {
      throw new Error("Finalize a ready shot_grounding_report.json bound to the real shotlist before visual prompts.");
    }
    const shotlistRecord = current.artifacts?.["shotlist.json"];
    const sceneCoverageRecord = current.artifacts?.["scene_coverage_plan.json"];
    const sequenceReviewRecord = current.artifacts?.["shot_sequence_review.json"];
    const groundingReportRecord = current.artifacts?.["shot_grounding_report.json"];
    if (!shotlistRecord?.path || !sceneCoverageRecord?.path || !sequenceReviewRecord?.path || !groundingReportRecord?.path) throw new Error("Visual prompts require registered shotlist.json, scene_coverage_plan.json, shot_sequence_review.json, and shot_grounding_report.json artifacts.");
    const verifiedShotlistRecord = await inspectArtifact({
      ...args,
      artifactRef: "shotlist.json",
      path: shotlistRecord.path,
      stage: shotlistRecord.stage ?? "storyboard",
      mediaKind: "document",
      metadata: shotlistRecord.metadata ?? {}
    });
    const verifiedSceneCoverageRecord = await inspectArtifact({
      ...args,
      artifactRef: "scene_coverage_plan.json",
      path: sceneCoverageRecord.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: sceneCoverageRecord.metadata ?? {}
    });
    const verifiedSequenceReviewRecord = await inspectArtifact({
      ...args,
      artifactRef: "shot_sequence_review.json",
      path: sequenceReviewRecord.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: sequenceReviewRecord.metadata ?? {}
    });
    const verifiedGroundingReportRecord = await inspectArtifact({
      ...args,
      artifactRef: "shot_grounding_report.json",
      path: groundingReportRecord.path,
      stage: "storyboard",
      mediaKind: "document",
      metadata: groundingReportRecord.metadata ?? {}
    });
    if ((shotlistRecord.sha256 && shotlistRecord.sha256 !== verifiedShotlistRecord.sha256)
      || (sceneCoverageRecord.sha256 && sceneCoverageRecord.sha256 !== verifiedSceneCoverageRecord.sha256)
      || (sequenceReviewRecord.sha256 && sequenceReviewRecord.sha256 !== verifiedSequenceReviewRecord.sha256)
      || (groundingReportRecord.sha256 && groundingReportRecord.sha256 !== verifiedGroundingReportRecord.sha256)) {
      throw new Error("Storyboard evidence changed after review. Re-run scene coverage, shot sequence, and grounding reviews before visual prompts.");
    }
    if (current.sceneCoveragePlan.sourceBinding.sha256 !== verifiedShotlistRecord.sha256) throw new Error("Scene coverage no longer matches the registered shotlist. Recompile scene_coverage_plan.json.");
    if (current.sceneCoveragePlan.sequenceId !== current.shotSequenceReview.sequenceId || current.sceneCoveragePlan.sequenceId !== current.shotGroundingReport.sequenceId) {
      throw new Error("Scene coverage, shot sequence review, and shot grounding must use the same sequenceId.");
    }
    assertStageParallelDispatchStarted(current, "storyboard", "visual_prompt_pack.json");
    const sequenceBound = bindVisualPromptPackToShotSequence(compileVisualPromptPack(args), current.shotSequenceReview, {
      shotlistArtifactRef: verifiedShotlistRecord.artifactRef,
      shotlistSha256: verifiedShotlistRecord.sha256,
      reviewArtifactRef: verifiedSequenceReviewRecord.artifactRef,
      reviewSha256: verifiedSequenceReviewRecord.sha256
    });
    const groundedValue = bindVisualPromptPackToGroundingReport(sequenceBound, current.shotGroundingReport, {
      groundingArtifactRef: verifiedGroundingReportRecord.artifactRef,
      groundingSha256: verifiedGroundingReportRecord.sha256
    });
    const value = {
      ...groundedValue,
      sceneCoverageBinding: {
        artifactRef: verifiedSceneCoverageRecord.artifactRef,
        sha256: verifiedSceneCoverageRecord.sha256,
        sequenceId: current.sceneCoveragePlan.sequenceId,
        shotlistSha256: current.sceneCoveragePlan.sourceBinding.sha256,
        status: "ready"
      }
    };
    const written = await writeDirectorGenerationArtifact({ ...args, artifactRef: "visual_prompt_pack.json", value });
    const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: "storyboard", mediaKind: "document", metadata: { canvasEssential: true, owner: "DX-Shot-Planner", sourceArtifactRefs: [args.directorContractRef ?? "director_contract.json", args.claimProofMapRef ?? "claim_to_proof_map.json", "shotlist.json", "scene_coverage_plan.json", "shot_sequence_review.json", "shot_grounding_report.json", "keyframe_storyboard.json"], shotlistSha256: verifiedShotlistRecord.sha256, sceneCoveragePlanSha256: verifiedSceneCoverageRecord.sha256, shotSequenceReviewSha256: verifiedSequenceReviewRecord.sha256, shotGroundingReportSha256: verifiedGroundingReportRecord.sha256 } });
    const summaryWritten = await writeVisualPromptPackSummary({ ...args, pack: value });
    const summaryRecord = await inspectArtifact({ ...args, artifactRef: summaryWritten.artifactRef, path: summaryWritten.path, stage: "storyboard", mediaKind: "document", metadata: { canvasEssential: true, owner: "DX-Shot-Planner", sourceArtifactRefs: [record.artifactRef, "shot_grounding_report.md"].filter((ref) => ref === record.artifactRef || current.artifacts?.[ref]) } });
    return await withRunResumeActions(await updateRun({ ...args, mutate(run) {
      run.visualPromptPack = value;
      run.artifacts ??= {};
      run.artifacts["shotlist.json"] = verifiedShotlistRecord;
      run.artifacts["scene_coverage_plan.json"] = verifiedSceneCoverageRecord;
      run.artifacts["shot_sequence_review.json"] = verifiedSequenceReviewRecord;
      run.artifacts["shot_grounding_report.json"] = verifiedGroundingReportRecord;
      run.artifacts[record.artifactRef] = record;
      run.artifacts[summaryRecord.artifactRef] = summaryRecord;
      upsertExecutionCanvasNode(run, { id: "storyboard:visual-prompts", type: "document", label: "模型执行提示词", detail: `${value.prompts.length} 个镜头 · ${value.routes.length} 条模型路线`, stage: "storyboard", status: "complete", artifactRef: summaryRecord.artifactRef, metadata: { canvasEssential: true, sourceArtifactRefs: summaryRecord.metadata.sourceArtifactRefs, promptPackArtifactRef: record.artifactRef } }, `shot-grounding-report:${current.shotGroundingReport.sequenceId}`);
      run.events.push(event(run, "storyboard.visual_prompts.ready", "storyboard", `${value.prompts.length} modality-isolated prompts`));
      return run;
    } }), args);
  }
  if (name === "directorx_register_subagent") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      registerDxSubagent(run, args);
      await persistSubagentOrchestrationArtifacts(run, args);
      upsertSubagentCanvasNode(run, args.displayName);
      run.events.push(event(run, "subagent.registered", args.stage, `${args.displayName} · host ${args.hostAgentId}`));
      return run;
    } })), args);
  }
  if (name === "directorx_update_subagent") {
    const snapshot = await updateRun({ ...args, mutate: async (run) => {
      updateDxSubagent(run, args);
      await persistSubagentOrchestrationArtifacts(run, args);
      upsertSubagentCanvasNode(run, args.displayName);
      run.events.push(event(run, `subagent.${args.status}`, run.subagents.find((item) => item.displayName === args.displayName).stage, `${args.displayName} · ${args.detail}`));
      return run;
    } });
    const response = await withBrowserCanvas(publicSnapshot(snapshot), args);
    const agent = snapshot.subagents.find((item) => item.displayName === args.displayName);
    return agent?.hostLifecycle === "release_required" ? {
      ...response,
      subagentHostAction: {
        type: "host_tool",
        tool: "close_agent",
        required: true,
        arguments: { target: agent.hostAgentId },
        reason: `Release the terminal ${agent.displayName} host process while preserving its canonical Director X production identity.`,
        afterClose: { tool: "directorx_confirm_subagent_host_closed", arguments: { projectPath: args.projectPath, runId: args.runId, displayName: agent.displayName, hostAgentId: agent.hostAgentId, closedBy: "close_agent", hostCloseStatus: "closed" } }
      }
    } : response;
  }
  if (name === "directorx_confirm_subagent_host_closed") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate: async (run) => {
      confirmDxSubagentHostClosed(run, args);
      await persistSubagentOrchestrationArtifacts(run, args);
      upsertSubagentCanvasNode(run, args.displayName);
      const agent = run.subagents.find((item) => item.displayName === args.displayName);
      run.events.push(event(run, "subagent.host.released", agent.stage, `${agent.displayName} · host ${agent.hostAgentId}`));
      return run;
    } })), args);
  }
  if (name === "directorx_transition_stage") {
    const snapshot = await updateRun({ ...args, mutate(run) {
      if (!run.pipeline) throw new Error("Select a Director X pipeline before starting production stages.");
      assertRunModeAllowsStage(run, args.stageId, args.action);
      if (args.action === "complete") {
        const unregistered = missingRegisteredArtifacts(run.pipeline, args.stageId, run.artifacts);
        if (unregistered.length) throw new Error(`Register real stage artifacts before completion: ${unregistered.join(", ")}`);
        const incompleteDxTasks = (run.subagentOrchestrationPlan?.tasks ?? []).filter((task) => task.stage === args.stageId && (task.status !== "complete" || (task.hostReleaseRequired === true && task.hostLifecycle !== "released")));
        if (incompleteDxTasks.length) throw new Error(`Complete planned DX handoffs and release their Codex hosts before ${args.stageId}: ${incompleteDxTasks.map((task) => `${task.displayName}:${task.status}/${task.hostLifecycle ?? "unknown"}`).join(", ")}`);
        assertStageParallelismObserved(run, args.stageId);
        assertStageQualityGates(run, args.stageId);
      }
      run.pipeline = transitionPipelineStage(run.pipeline, run.approvals, args);
      const status = run.pipeline.stageStates[args.stageId].status;
      run.stage = args.stageId;
      run.events.push(event(run, `stage.${status}`, args.stageId, args.detail));
      return appendRunCheckpoint({ ...args, run, reason: `stage.${status}`, detail: args.detail }).then((written) => { run.artifacts[written.artifactRef] = artifactRecord({ ...written, stage: args.stageId }); return run; });
    } });
    return await withRunResumeActions(snapshot, args);
  }
  if (name === "directorx_bind_goal") {
    const snapshot = await updateRun({ ...args, mutate(run) {
      if (run.goal.codexGoalId && run.goal.codexGoalId !== args.codexGoalId) throw new Error(`Run is already bound to a different Codex Goal: ${run.goal.codexGoalId}`);
      run.goal.codexGoalId = args.codexGoalId;
      if (!run.goal.boundAt) {
        run.goal.boundAt = new Date().toISOString();
        run.events.push(event(run, "goal.bound", "intake", `Bound Codex Goal ${args.codexGoalId}`));
      }
      if (run.status === "awaiting_goal_binding") run.status = "awaiting_approval";
      return run;
    } });
    const preflightBinding = canvasSurfaceHost.findCanvasByRun(args.projectPath, args.runId);
    if (preflightBinding) {
      const [preflightId] = preflightBinding;
      const preflight = preflightSessions.get(preflightId);
      if (preflight) {
        preflight.codexGoalId = args.codexGoalId;
        preflight.goalBoundAt = snapshot.goal.boundAt;
        await savePreflightSession(preflightId, preflight);
      }
    }
    return await withBrowserCanvas(publicSnapshot(snapshot), args);
  }
  if (name === "directorx_record_decision") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      const interactionKind = args.kind === "provider" ? "provider_input" : args.kind;
      requireResolvedInteraction(run, args.interactionRequestId, [interactionKind, "intake"]);
      let decisionValue = args.value;
      if (args.kind === "budget") decisionValue = validateOfficialBudget(args.value, run.pricingEvidence);
      if (["image_model", "video_model", "voice_model"].includes(args.kind)) {
        const notUsed = decisionValue.notUsed === true || decisionValue.not_used === true;
        const providerId = decisionValue.providerId ?? decisionValue.provider_id;
        const modelId = decisionValue.modelId ?? decisionValue.model_id;
        if (!notUsed && (!providerId || !modelId)) throw new Error(`${args.kind} requires an exact providerId and modelId, or notUsed=true.`);
        if (!notUsed) assertProviderCredentialReadyForDecision(args.kind, providerId, modelId);
      }
      if (["music_strategy", "music_route"].includes(args.kind)) validateMusicStrategyDecision(decisionValue);
      if (args.kind === "music_asset_selection") validateMusicAssetSelectionDecision(run, decisionValue);
      if (args.kind === "delivery") {
        if (!run.finalMediaReview?.passed) throw new Error("Final delivery cannot be approved until the tier-aware media quality gate passes.");
        if (decisionValue.acceptedTier !== run.finalMediaReview.deliveryTier) throw new Error(`Delivery approval must explicitly accept the verified ${run.finalMediaReview.deliveryTier} tier.`);
      }
      run.decisions.push({ id: randomUUID(), kind: args.kind, value: decisionValue, approvedAt: new Date().toISOString() });
      const approvalKind = args.kind === "music_route" ? "music_strategy" : args.kind;
      const gate = run.approvals.find((item) => item.kind === approvalKind);
      if (gate) gate.status = "approved";
      run.events.push(event(run, "decision.approved", run.stage, `${args.kind} approved`));
      const productionApprovalsReady = ["budget", "image_model", "video_model", "voice_model"].every((kind) => run.approvals.some((item) => item.kind === kind && item.status === "approved"));
      if (productionApprovalsReady && args.kind !== "delivery") run.status = "production_in_progress";
      return run;
    } })), args);
  }
  if (name === "directorx_record_event") {
    return publicSnapshot(await updateRun({ ...args, mutate(run) { run.stage = args.stage; run.events.push(event(run, args.type, args.stage, args.detail)); return run; } }));
  }
  if (name === "directorx_upsert_canvas_object") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, mutate(run) {
      run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } };
      const node = { ...args.object, updatedAt: new Date().toISOString() };
      const existingIndex = run.canvas.nodes.findIndex((item) => item.id === node.id);
      if (existingIndex >= 0) run.canvas.nodes[existingIndex] = { ...run.canvas.nodes[existingIndex], ...node };
      else run.canvas.nodes.push(node);
      for (const source of args.sourceIds ?? []) {
        const edge = { id: `object-edge:${source}:${node.id}`, source, target: node.id, kind: "dependency" };
        const edgeIndex = run.canvas.edges.findIndex((item) => item.id === edge.id);
        if (edgeIndex >= 0) run.canvas.edges[edgeIndex] = edge;
        else run.canvas.edges.push(edge);
      }
      run.stage = node.stage;
      run.events.push(event(run, "canvas.object.upserted", node.stage, `${node.label} · ${node.status}`));
      return run;
    } })), args);
  }
  if (name === "directorx_update_canvas_review_note") {
    return await withBrowserCanvas(publicSnapshot(await updateRun({ ...args, async mutate(run) {
      const note = args.action === "acknowledge"
        ? acknowledgeCanvasReviewNote(run, { noteId: args.noteId, owner: args.owner })
        : resolveCanvasReviewNote(run, { noteId: args.noteId, resolutionSummary: args.resolutionSummary, evidenceRefs: args.evidenceRefs });
      const written = await writeCanvasReviewNotesArtifact({ ...args, notes: run.canvasReviewNotes });
      run.artifacts ??= {};
      run.artifacts[written.artifactRef] = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: "review", mediaKind: "document", metadata: { internal: true, userAuthored: true, noteCount: run.canvasReviewNotes.length } });
      run.events.push(event(run, `canvas.review_note.${note.status}`, "review", `${note.noteId} · ${note.targetArtifactRef}${note.timeSeconds == null ? "" : ` · ${note.timeSeconds}s`}`));
      return run;
    } })), args);
  }
  if (name === "directorx_open_canvas") return await withRunResumeActions(await readRun(args), args);
  if (name === "directorx_open_inline_canvas") {
    if (!args.runId) throw new Error("directorx_open_inline_canvas requires an existing durable runId; Director X preflight must use the side Browser canvas.");
    if (!INLINE_FALLBACK_REASONS.includes(args.fallbackReason) || !String(args.failureDetail ?? "").trim()) {
      throw new Error("Inline canvas fallback requires browser-unavailable evidence with fallbackReason and failureDetail after a real Browser attempt.");
    }
    return { ...(publicSnapshot(await readRun(args))), surface: "inline_fallback", fallbackEvidence: { reason: args.fallbackReason, failureDetail: args.failureDetail.trim(), recordedAt: new Date().toISOString() } };
  }
  if (name === "directorx_get_run_snapshot") return await withRunResumeActions(await readRun(args), args);
  if (name === "directorx_set_session_credential") {
    if (!ENV_NAME_PATTERN.test(args.envName)) throw new Error("envName must be an uppercase environment variable name.");
    if (typeof args.apiKey !== "string" || args.apiKey.length < 8) throw new Error("The API key is missing or too short.");
    const expectedEnv = expectedCredentialEnv(args.providerId);
    if (args.envName !== expectedEnv) throw new Error(`${args.providerId} credentials must use ${expectedEnv}; arbitrary environment-variable injection is not allowed.`);
    process.env[args.envName] = args.apiKey;
    credentialStatus.set(args.providerId, { envName: args.envName, configured: true, configuredAt: new Date().toISOString() });
    return {
      providerId: args.providerId,
      credentialRef: `session-env:${args.envName}`,
      configured: true,
      persisted: false,
      expires: "when the Director X MCP process exits"
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function event(run, type, stage, detail) {
  return { id: randomUUID(), sequence: (run.events.at(-1)?.sequence ?? 0) + 1, type, stage, at: new Date().toISOString(), detail };
}

async function mutateGeneration(args, mutate, eventType, detail) {
  let snapshot = await updateRun({ ...args, mutate(run) {
    const next = mutate(run);
    next.stage = "generation";
    const previous = next.events.at(-1);
    if (previous?.type !== eventType || previous?.detail !== detail) next.events.push(event(next, eventType, "generation", detail));
    return next;
  } });
  const written = await writeGenerationArtifacts({ projectPath: args.projectPath, runId: args.runId, generation: snapshot.generation });
  const records = {};
  for (const result of Object.values(written)) records[result.artifactRef] = await inspectArtifact({ ...args, artifactRef: result.artifactRef, path: result.path, stage: "generation", mediaKind: "document" });
  snapshot = await updateRun({ ...args, mutate(run) { run.artifacts ??= {}; Object.assign(run.artifacts, records); return run; } });
  return await withBrowserCanvas(publicSnapshot(snapshot), args);
}

async function executeDirectMediaSubmission(args) {
  const current = await readRun(args);
  hydrateCustomMediaProviderAdapters(current.providerAdapters);
  const existing = current.generation?.providerJobs?.find((job) => job.idempotencyKey === args.idempotencyKey);
  if (existing) {
    if (existing.requestId !== args.requestId || existing.attemptId !== args.attemptId) throw new Error("Idempotency key already belongs to another generation attempt.");
    return await withBrowserCanvas(publicSnapshot(current), args);
  }

  const context = requireDirectMediaContext(current, args, "Media generation submission");
  const credential = resolveMediaCredential(context.providerId, credentialStatus);
  const providerInput = await buildDirectMediaInput(args, context);
  const normalized = await submitMediaGeneration(providerInput, { credential: credential.value, timeoutMs: args.timeoutMs });
  let materialized;
  let mediaRecord;
  if (normalized.status === "succeeded") {
    const asset = await resolveGeneratedMedia(normalized, { credential: credential.value, timeoutMs: args.timeoutMs });
    materialized = await writeGeneratedMedia({ projectPath: args.projectPath, runId: args.runId, candidateId: args.candidateId, mediaType: context.mediaType, asset });
    mediaRecord = await inspectArtifact({ ...args, artifactRef: `candidate:${args.candidateId}`, path: materialized.path, stage: "generation", mediaKind: context.mediaType, metadata: generationArtifactMetadata(current, args.requestId) });
  }

  const durable = durableMediaJob(normalized);
  return await mutateGeneration(args, (run) => {
    const fresh = requireDirectMediaContext(run, args, "Media generation submission");
    const submitted = submitProviderJob(run, {
      ...args,
      providerJobId: normalized.providerJobId,
      providerId: fresh.providerId,
      modelId: fresh.modelId,
      mediaType: fresh.mediaType,
      mode: fresh.mode,
      candidateId: args.candidateId,
      accountedCost: fresh.attempt.estimatedCost,
      providerState: durable.providerState,
      resultUrls: durable.resultUrls,
      credentialRef: credential.credentialRef
    });
    upsertExecutionCanvasNode(run, {
      id: `job:${submitted.job.providerJobId}`,
      type: "artifact",
      label: `${fresh.providerId} · ${fresh.modelId}`,
      detail: "submitted · 0%",
      stage: "generation",
      status: "active",
      artifactRef: "provider_jobs.json",
      metadata: { ...submitted.job }
    }, `attempt:${args.attemptId}`);
    reconcileDirectProviderJob(run, submitted.job, durable, mediaRecord, materialized);
    return run;
  }, `provider.media.${durable.status}`, `${context.providerId}/${context.modelId} · ${normalized.providerJobId}`);
}

async function executeDirectMediaPoll(args) {
  const current = await readRun(args);
  hydrateCustomMediaProviderAdapters(current.providerAdapters);
  const stored = current.generation?.providerJobs?.find((job) => job.providerJobId === args.providerJobId);
  if (!stored) throw new Error(`Unknown provider job: ${args.providerJobId}`);
  if (!stored.providerId || !stored.modelId || !stored.candidateId) throw new Error("This job was registered manually and has no executable Director X media-provider route.");
  if (["succeeded", "failed", "cancelled"].includes(stored.status)) return await withBrowserCanvas(publicSnapshot(current), args);
  const context = requireDirectMediaContext(current, { ...args, requestId: stored.requestId, attemptId: stored.attemptId, directMode: stored.mode }, "Media generation polling");
  const credential = resolveMediaCredential(stored.providerId, credentialStatus);
  const normalized = await pollMediaGeneration(stored, { credential: credential.value, timeoutMs: args.timeoutMs });
  let materialized;
  let mediaRecord;
  if (normalized.status === "succeeded") {
    const asset = await resolveGeneratedMedia(normalized, { credential: credential.value, timeoutMs: args.timeoutMs });
    materialized = await writeGeneratedMedia({ projectPath: args.projectPath, runId: args.runId, candidateId: stored.candidateId, mediaType: stored.mediaType, asset });
    mediaRecord = await inspectArtifact({ ...args, artifactRef: `candidate:${stored.candidateId}`, path: materialized.path, stage: "generation", mediaKind: stored.mediaType, metadata: generationArtifactMetadata(current, stored.requestId) });
  }
  const durable = durableMediaJob(normalized);
  return await mutateGeneration({ ...args, requestId: stored.requestId, attemptId: stored.attemptId }, (run) => {
    requireDirectMediaContext(run, { ...args, requestId: stored.requestId, attemptId: stored.attemptId, directMode: stored.mode }, "Media generation polling");
    const job = run.generation.providerJobs.find((item) => item.providerJobId === args.providerJobId);
    reconcileDirectProviderJob(run, job, durable, mediaRecord, materialized);
    return run;
  }, `provider.media.${durable.status}`, `${context.providerId}/${context.modelId} · ${Math.round(Math.max(stored.progress, durable.progress) * 100)}%`);
}

function reconcileDirectProviderJob(run, job, durable, mediaRecord, materialized) {
  const status = durable.status;
  if (job.status === "input_required" && status !== "input_required") requireResolvedInteraction(run, job.inputRequest?.interactionRequestId, "provider_input");
  const progress = Math.max(job.progress ?? 0, durable.progress ?? 0);
  const update = {
    providerJobId: job.providerJobId,
    status,
    progress: status === "succeeded" ? 1 : progress,
    providerState: durable.providerState,
    resultUrls: durable.resultUrls
  };
  if (status === "input_required") {
    const instruction = "The provider requires additional input. Confirm the missing provider requirement before resuming.";
    const interaction = requestNativeInteraction(run, {
      kind: "provider_input",
      gateKey: `provider-job:${job.providerJobId}`,
      reason: instruction,
      questions: [{ header: "供应商输入", id: "provider_input_decision", question: "请选择如何处理供应商要求的补充输入。", options: [{ label: "补充信息 (Recommended)", description: "通过 Codex 回答区域提供所需信息并继续当前幂等任务。" }, { label: "取消任务", description: "停止当前供应商任务并保留已有证据。" }] }]
    });
    update.inputRequest = { instruction, interactionRequestId: interaction.request.requestId };
  }
  if (status === "failed") update.error = durable.error ?? { code: "provider_failed", message: "Provider generation failed." };
  if (status === "succeeded") update.resultRef = `candidate:${job.candidateId}`;
  updateProviderJob(run, update);
  updateProviderJobNode(run, job);

  if (status !== "succeeded") return;
  if (!mediaRecord || !materialized) throw new Error("A succeeded provider job must have downloaded project media before reconciliation.");
  recordGenerationCandidate(run, {
    requestId: job.requestId,
    attemptId: job.attemptId,
    candidateId: job.candidateId,
    assetRef: mediaRecord.artifactRef,
    previewUri: mediaRecord.relativePath,
    mediaType: job.mediaType,
    actualCost: job.accountedCost,
    providerResultId: job.providerJobId,
    providerJobId: job.providerJobId
  });
  run.artifacts[mediaRecord.artifactRef] = mediaRecord;
  const attemptNode = run.canvas.nodes.find((item) => item.id === `attempt:${job.attemptId}`);
  if (attemptNode) { attemptNode.status = "complete"; attemptNode.detail = `生成完成 · 候选 ${job.candidateId}`; attemptNode.updatedAt = new Date().toISOString(); }
  upsertCandidateCanvasNode(run, {
    requestId: job.requestId,
    attemptId: job.attemptId,
    candidateId: job.candidateId,
    mediaType: job.mediaType,
    actualCost: job.accountedCost,
    providerResultId: job.providerJobId
  }, mediaRecord, "awaiting_review");
}

function requireDirectMediaContext(run, args, label) {
  if (!run.generation) throw new Error(`${label} requires a registered generation plan.`);
  const request = run.generation.requests.find((item) => item.requestId === args.requestId);
  if (!request) throw new Error(`Unknown generation request: ${args.requestId}`);
  const attempt = run.generation.attempts.find((item) => item.requestId === args.requestId && item.attemptId === args.attemptId);
  if (!attempt || attempt.status !== "running") throw new Error(`${label} requires an active generation attempt.`);
  if (args.accountedCost != null && Number(args.accountedCost) !== Number(attempt.estimatedCost)) throw new Error("Provider submission cost must match the official Director X pricing quote for this attempt.");
  const mode = args.directMode ?? request.providerMode ?? directProviderMode(request.mode, Boolean(args.imagePaths?.length || args.imageUrls?.length));
  const mediaType = mode === "text_to_image" || mode === "image_to_image" ? "image" : "video";
  const approvalKind = mediaType === "image" ? "image_model" : "video_model";
  requireExecutionApproval(run, label, ["budget", approvalKind]);
  requirePipelineStage(run, "generation", label);
  requireApprovedModelRoute(run, approvalKind, { providerId: run.generation.providerId, modelId: run.generation.modelId }, label);
  return { run, request, attempt, providerId: run.generation.providerId, modelId: run.generation.modelId, mode, mediaType };
}

async function buildDirectMediaInput(args, context) {
  assertPromptBoundSubmission(context.request, args);
  const imageUrls = [...(args.imageUrls ?? []).map(assertApprovedMediaUrl)];
  for (const path of args.imagePaths ?? []) imageUrls.push(await projectMediaDataUri(args.projectPath, path, "image"));
  const endImageUrl = args.endImagePath ? await projectMediaDataUri(args.projectPath, args.endImagePath, "image") : args.endImageUrl ? assertApprovedMediaUrl(args.endImageUrl) : undefined;
  const videoUrl = args.videoPath ? await projectMediaDataUri(args.projectPath, args.videoPath, "video") : args.videoUrl ? assertApprovedMediaUrl(args.videoUrl) : undefined;
  if (context.mode === "keyframes_to_video" && (!imageUrls[0] || !endImageUrl)) throw new Error("keyframes_to_video requires both the approved start frame and approved end frame in the provider request.");
  const requestOptions = context.request.providerParameters ?? {};
  const mediaInput = {
    mediaType: context.mediaType,
    providerId: context.providerId,
    modelId: context.modelId,
    mode: context.mode,
    prompt: context.attempt.prompt,
    negativePrompt: (args.negativePrompt ?? (context.request.negativeConstraints ?? []).join(", ")) || undefined,
    aspectRatio: args.aspectRatio ?? requestOptions.aspectRatio ?? requestOptions.aspect_ratio,
    size: args.size ?? requestOptions.size,
    resolution: args.resolution ?? requestOptions.resolution,
    durationSeconds: args.durationSeconds ?? context.request.durationSeconds,
    imageUrls,
    endImageUrl,
    videoUrl,
    outputCount: args.outputCount ?? requestOptions.outputCount ?? requestOptions.n,
    generateAudio: args.generateAudio ?? requestOptions.generateAudio ?? requestOptions.generate_audio,
    providerOptions: { ...(context.attempt.providerOptions ?? {}), ...requestOptions, ...(args.providerOptions ?? {}) },
    allowUnlistedModel: true,
    idempotencyKey: args.idempotencyKey,
    attemptId: args.attemptId
  };
  return applyAudioResponsibilityToMediaInput(context.run, mediaInput);
}

function directProviderMode(mode, hasImageInput) {
  if (mode === "image") return hasImageInput ? "image_to_image" : "text_to_image";
  if (mode === "transition_clip") return "keyframes_to_video";
  if (["text_to_video", "image_to_video", "keyframes_to_video", "reference_to_video", "video_extension"].includes(mode)) return mode;
  throw new Error(`The direct media-provider gateway does not execute generation mode ${mode}.`);
}

function mediaCredentialConfigured(providerId) {
  try { resolveMediaCredential(providerId, credentialStatus); return true; } catch { return false; }
}

function assertProviderCredentialReadyForDecision(kind, providerId, modelId) {
  if (kind === "voice_model" && providerId === "openmoss.moss-tts-nano.local" && modelId === "moss-tts-nano") return;
  if (mediaCredentialConfigured(providerId)) return;
  throw new Error(`${kind} ${providerId}/${modelId} requires its API Key to be confirmed through Codex request_user_input and injected through the secure Director X canvas credential field before production can continue.`);
}

function assertApprovedMediaUrl(value) {
  if (typeof value !== "string") throw new Error("Media input URL must be a string.");
  if (value.startsWith("data:image/") || value.startsWith("data:video/")) {
    if (Buffer.byteLength(value) > 70 * 1024 * 1024) throw new Error("Inline media input exceeds 70 MB.");
    return value;
  }
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Provider media input URLs must use HTTPS or a data URI.");
  return value;
}

async function projectMediaDataUri(projectPath, path, mediaType) {
  const details = await resolveWorkspaceMediaFile(projectPath, path);
  const limit = mediaType === "image" ? 20 * 1024 * 1024 : 50 * 1024 * 1024;
  if (details.size <= 0 || details.size > limit) throw new Error(`Provider ${mediaType} input must be a non-empty project file no larger than ${limit / 1024 / 1024} MB.`);
  const mimeType = inputMimeType(details.path, mediaType);
  return `data:${mimeType};base64,${(await readFile(details.path)).toString("base64")}`;
}

function inputMimeType(path, mediaType) {
  const extension = extname(path).toLowerCase();
  const values = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
  const mimeType = values[extension];
  if (!mimeType || !mimeType.startsWith(`${mediaType}/`)) throw new Error(`Unsupported ${mediaType} provider input format: ${extension || "unknown"}.`);
  return mimeType;
}

async function mutateEditSession(args, mutate, eventType, detail, projectResult = null) {
  let mutationResult;
  let snapshot = await updateRun({ ...args, mutate(run) {
    const activeManualSession = run.openCutEditor?.sessions?.[run.openCutEditor?.activeSessionId];
    const manualEditActive = activeManualSession && !["completed", "cancelled", "failed"].includes(activeManualSession.status);
    if (!run.pipeline || (run.stage !== "edit" && !manualEditActive)) throw new Error("Edit intent and timeline patches require the active edit stage or an approved Director X Cut session.");
    mutationResult = mutate(run); run.events.push(event(run, eventType, "edit", detail)); return run;
  } });
  const written = await writeEditArtifacts({ projectPath: args.projectPath, runId: args.runId, editSession: snapshot.editSession });
  const records = {};
  for (const result of Object.values(written)) records[result.artifactRef] = await inspectArtifact({ ...args, artifactRef: result.artifactRef, path: result.path, stage: "edit", mediaKind: "document" });
  snapshot = await updateRun({ ...args, mutate(run) { run.artifacts ??= {}; Object.assign(run.artifacts, records); return run; } });
  const response = await withBrowserCanvas(publicSnapshot(snapshot), args);
  return projectResult ? { ...response, ...projectResult(mutationResult) } : response;
}

async function mutateReviewSession(args, mutate, eventType, detail) {
  let snapshot = await updateRun({ ...args, mutate(run) { mutate(run); run.events.push(event(run, eventType, run.stage, detail)); return run; } });
  const written = await writeReviewSession({ projectPath: args.projectPath, runId: args.runId, reviewSession: snapshot.reviewSession });
  const record = await inspectArtifact({ ...args, artifactRef: written.artifactRef, path: written.path, stage: snapshot.stage, mediaKind: "document" });
  snapshot = await updateRun({ ...args, mutate(run) { run.artifacts ??= {}; run.artifacts[record.artifactRef] = record; return run; } });
  return await withBrowserCanvas(publicSnapshot(snapshot), args);
}

function upsertCandidateCanvasNode(run, args, mediaRecord, status) {
  run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } };
  const request = run.generation.requests.find((item) => item.requestId === args.requestId);
  const candidate = run.generation.candidates.find((item) => item.candidateId === args.candidateId);
  const node = { id: `candidate:${args.candidateId}`, type: args.mediaType, label: `${request.shotId} · 候选 ${args.candidateId}`, detail: `等待导演审核 · ${run.generation.currency} ${args.actualCost}`, stage: "generation", status, previewUri: mediaRecord.relativePath, artifactRef: mediaRecord.artifactRef, metadata: { requestId: args.requestId, attemptId: args.attemptId, providerResultId: args.providerResultId, providerId: run.generation.providerId, modelId: run.generation.modelId, cost: args.actualCost, currency: run.generation.currency, repairLineage: candidate?.repairLineage ?? null, ...generationArtifactMetadata(run, args.requestId) }, updatedAt: new Date().toISOString() };
  const index = run.canvas.nodes.findIndex((item) => item.id === node.id);
  if (index >= 0) run.canvas.nodes[index] = node; else run.canvas.nodes.push(node);
  for (const source of [`stage:generation`, `shot:${request.shotId}`]) {
    const edge = { id: `candidate-edge:${source}:${node.id}`, source, target: node.id, kind: "candidate" };
    if (!run.canvas.edges.some((item) => item.id === edge.id)) run.canvas.edges.push(edge);
  }
}

function generationArtifactMetadata(run, requestId) {
  const request = run.generation?.requests?.find((item) => item.requestId === requestId);
  return {
    canvasEssential: true,
    requestId,
    shotId: request?.shotId ?? null,
    sourceArtifactRefs: [...new Set(["Director.md", "generation_request.json", "keyframe_storyboard.json", ...(request?.inputAnchorAssets ?? [])].filter(Boolean))],
    outputAnchorAssets: request?.outputAnchorAssets ?? [],
    carryForwardRules: request?.carryForwardRules ?? [],
    audioResponsibilityPlanId: run.audioResponsibilityPlan?.planId ?? null,
    nativeAudioDisposition: run.audioResponsibilityPlan?.video?.nativeAudioDisposition ?? null,
    useProviderAudioInFinalMix: run.audioResponsibilityPlan?.video?.generateAudio === true
  };
}

function updateProviderJobNode(run, job) {
  const node = run.canvas.nodes.find((item) => item.id === `job:${job.providerJobId}`);
  if (!node) throw new Error(`Provider job canvas node is missing: ${job.providerJobId}`);
  node.status = job.status === "succeeded" ? "complete" : ["failed", "cancelled"].includes(job.status) ? "failed" : job.status === "input_required" ? "blocked" : "active";
  node.detail = `${job.status} · ${Math.round(job.progress * 100)}%${job.inputRequest ? " · 等待输入" : ""}`;
  node.metadata = { ...job }; node.updatedAt = new Date().toISOString();
}

function upsertExecutionCanvasNode(run, node, sourceId) {
  run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } };
  const value = { ...node, updatedAt: new Date().toISOString() };
  const index = run.canvas.nodes.findIndex((item) => item.id === value.id);
  if (index >= 0) run.canvas.nodes[index] = value; else run.canvas.nodes.push(value);
  const edge = { id: `execution-edge:${sourceId}:${value.id}`, source: sourceId, target: value.id, kind: "execution" };
  if (!run.canvas.edges.some((item) => item.id === edge.id)) run.canvas.edges.push(edge);
}

function upsertOpenCutCanvasNode(run, session) {
  run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } };
  const status = session.status === "completed" ? "complete" : session.status === "failed" ? "failed" : ["awaiting_patch_approval", "render_required"].includes(session.status) ? "blocked" : "active";
  const node = {
    id: `editor:opencut:${session.editorSessionId}`,
    type: "artifact",
    label: "Director X Cut · 手工剪辑",
    detail: `${session.status} · OpenCut Classic ${session.engine.commit.slice(0, 8)} · source ${session.sourceArtifactRef}`,
    stage: "edit",
    status,
    artifactRef: session.draft ? "opencut_edit_result.json" : "opencut_project.json",
    metadata: { editorSessionId: session.editorSessionId, sourceArtifactRefs: [session.sourceArtifactRef, "opencut_project.json"], upstreamRepository: session.engine.repository, upstreamCommit: session.engine.commit, license: session.engine.license, forcedOutputWatermark: false, patchId: session.patchId, renderedArtifactRef: session.renderedArtifactRef ?? null },
    updatedAt: new Date().toISOString()
  };
  const index = run.canvas.nodes.findIndex((item) => item.id === node.id);
  if (index >= 0) run.canvas.nodes[index] = node; else run.canvas.nodes.push(node);
  const edge = { id: `opencut-edge:stage:edit:${node.id}`, source: "stage:edit", target: node.id, kind: "edit" };
  if (!run.canvas.edges.some((item) => item.id === edge.id)) run.canvas.edges.push(edge);
}

function safeCanvasId(value) { return String(value ?? "asset").replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 120); }

function requireNativeGoalBound(run, label) {
  if (!run.goal?.codexGoalId || !run.goal?.boundAt) {
    throw new Error(`Bind the native Codex Goal with directorx_bind_goal before ${label}.`);
  }
}

function requireExecutionApproval(run, label, kinds) {
  for (const kind of kinds) {
    if (!run.approvals?.some((approval) => approval.kind === kind && approval.status === "approved")) throw new Error(`${label} requires an approved ${kind} decision.`);
  }
}

function requireApprovedModelRoute(run, kind, route, label) {
  const decision = [...(run.decisions ?? [])].reverse().find((item) => item.kind === kind)?.value;
  if (!decision) throw new Error(`${label} requires a recorded ${kind} decision from Codex request_user_input.`);
  if (decision.notUsed === true || decision.not_used === true) throw new Error(`${label} cannot run because ${kind} was confirmed as not used.`);
  const approvedProvider = decision.providerId ?? decision.provider_id;
  const approvedModel = decision.modelId ?? decision.model_id;
  if (approvedProvider && approvedProvider !== route.providerId) throw new Error(`${label} provider ${route.providerId} does not match approved ${approvedProvider}.`);
  if (approvedModel && approvedModel !== route.modelId) throw new Error(`${label} model ${route.modelId} does not match approved ${approvedModel}.`);
}

function requirePipelineStage(run, stageId, label) {
  if (!run.pipeline) throw new Error(`${label} requires a selected Director X pipeline.`);
  const status = run.pipeline.stageStates?.[stageId]?.status;
  if (!["active", "complete"].includes(status)) throw new Error(`${label} requires pipeline stage ${stageId} to be active or complete; current status is ${status ?? "missing"}.`);
}

function assertStageQualityGates(run, stageId) {
  if (stageId !== "storyboard") return;
  if (run.sceneCoveragePlan?.status !== "ready") throw new Error("Storyboard completion requires a ready scene_coverage_plan.json.");
  if (run.transitionLanguagePlan?.status !== "ready") throw new Error("Storyboard completion requires a ready transition_language_plan.json.");
  if (run.shotSequenceReview?.status !== "ready") throw new Error("Storyboard completion requires a ready shot_sequence_review.json.");
}

function upsertSubagentCanvasNode(run, displayName) {
  const agent = run.subagents.find((item) => item.displayName === displayName);
  run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } };
  const node = { id: `agent:${agent.displayName}`, type: "agent", label: agent.displayName, detail: agent.detail ?? agent.mission, stage: agent.stage, status: agent.status === "running" ? "active" : agent.status, metadata: { roleId: agent.roleId, hostAgentId: agent.hostAgentId, hostIdentityStatus: agent.hostNicknameMode, hostLifecycle: agent.hostLifecycle, hostReleasedAt: agent.hostReleasedAt, inputArtifactRefs: agent.inputArtifactRefs, outputArtifactRefs: agent.outputArtifactRefs }, updatedAt: agent.updatedAt };
  const index = run.canvas.nodes.findIndex((item) => item.id === node.id);
  if (index >= 0) run.canvas.nodes[index] = node; else run.canvas.nodes.push(node);
  const edge = { id: `agent-stage:${agent.stage}:${agent.displayName}`, source: `stage:${agent.stage}`, target: node.id, kind: "ownership" };
  if (!run.canvas.edges.some((item) => item.id === edge.id)) run.canvas.edges.push(edge);
}

async function persistSubagentOrchestrationArtifacts(run, args) {
  if (!run.subagentOrchestrationPlan) return;
  run.artifacts ??= {};
  const written = await Promise.all([
    writeParallelSubagentPlan({ ...args, plan: run.subagentOrchestrationPlan }),
    writeParallelSubagentDispatchEvidence({ ...args, plan: run.subagentOrchestrationPlan })
  ]);
  for (const artifact of written) run.artifacts[artifact.artifactRef] = await inspectArtifact({ ...args, artifactRef: artifact.artifactRef, path: artifact.path, stage: "intake", mediaKind: "document", metadata: { canvasEssential: false, diagnosticsSurface: "activity" } });
}

async function diagnoseSetup(args) {
  const context = {
    projectPath: args.projectPath,
    profile: args.profile,
    sourceKind: args.sourceKind ?? "local",
    transcriptionRequested: args.transcriptionRequested === true,
    expectedPluginVersion: args.expectedPluginVersion,
    availableAgentTypes: args.availableAgentTypes ?? [],
    hostToolNames: args.hostToolNames ?? [],
    hostSkillNames: args.hostSkillNames ?? [],
    providerCredentialConfigured: args.providerId ? credentialStatus.get(args.providerId)?.configured === true : false
  };
  const health = await diagnosePluginHealth(context);
  const repairPlan = setupRepairRegistry.issue({ projectPath: args.projectPath, health, context });
  return {
    health,
    repairPlan,
    userFacingSummary: {
      status: health.status,
      suggestedUpdate: health.ready
        ? health.smokeTestEligible ? "Director X 本地链路已就绪，可以生成一个两秒零 Key 测试片验证播放。" : "Director X 当前配置满足所选工作模式。"
        : health.nextAction?.label ?? `Director X 仍有 ${health.blockers.length} 项必要配置未就绪。`
    }
  };
}

async function repairSetup(args) {
  return await setupRepairRegistry.execute({ planId: args.repairPlanId, projectPath: args.projectPath, confirmedBy: args.confirmedBy, repairAccepted: args.repairAccepted }, {
    async install_managed_runtime({ context }) {
      const installed = await installDirectorXMediaRuntime();
      return { actionId: "install_managed_runtime", installed, postRepairHealth: await diagnosePluginHealth(context) };
    },
    async install_dx_roles({ context }) {
      const installed = await installCodexAgentRoles(args.projectPath);
      return { actionId: "install_dx_roles", installed, postRepairHealth: await diagnosePluginHealth(context) };
    },
    async run_zero_key_smoke_test({ context }) {
      const smokeProof = await runPluginSmokeTest({ projectPath: args.projectPath });
      await attachSetupSmokeToPreflights(args.projectPath, smokeProof);
      return { actionId: "run_zero_key_smoke_test", smokeProof, postRepairHealth: await diagnosePluginHealth(context) };
    }
  });
}

async function attachSetupSmokeToPreflights(projectPath, smokeProof) {
  const normalizedProjectPath = resolve(projectPath);
  for (const [preflightId, state] of preflightSessions) {
    if (resolve(state.projectPath) !== normalizedProjectPath || state.runId) continue;
    await savePreflightSession(preflightId, { ...state, setupSmokeReceipt: smokeProof });
  }
}

function summarizeSetupHealth(health) {
  return { healthId: health.healthId, profile: health.profile, status: health.status, ready: health.ready, blockers: health.blockers, unverified: health.unverified, nextAction: health.nextAction };
}

function objectSchema(properties, required = []) { return { type: "object", additionalProperties: false, properties, required }; }
function stringSchema() { return { type: "string", minLength: 1 }; }
function looseObjectSchema() { return { type: "object", additionalProperties: true, properties: {} }; }
function nullableLooseObjectSchema() { return { anyOf: [looseObjectSchema(), { type: "null" }] }; }
function pluginHealthEnvelopeSchema() {
  return objectSchema({
    health: looseObjectSchema(),
    repairPlan: nullableLooseObjectSchema(),
    userFacingSummary: objectSchema({ status: stringSchema(), suggestedUpdate: stringSchema() }, ["status", "suggestedUpdate"])
  }, ["health", "repairPlan", "userFacingSummary"]);
}
function pluginRepairEnvelopeSchema() {
  return objectSchema({
    schemaVersion: stringSchema(), plan: looseObjectSchema(), execution: looseObjectSchema(), verificationRequired: { type: "boolean" }, security: looseObjectSchema()
  }, ["schemaVersion", "plan", "execution", "verificationRequired", "security"]);
}
function nativeQuestionSchema() {
  return objectSchema({
    header: stringSchema(),
    id: stringSchema(),
    question: stringSchema(),
    options: { type: "array", minItems: 2, maxItems: 3, items: objectSchema({ label: stringSchema(), description: stringSchema() }, ["label", "description"]) }
  }, ["header", "id", "question", "options"]);
}
function rationalTimeSchema() { return objectSchema({ value: { type: "number", minimum: 0 }, rate: { type: "number", exclusiveMinimum: 0 } }, ["value", "rate"]); }
function stageForCapability(capabilityId) { return capabilityId.startsWith("review.") ? "review" : capabilityId.startsWith("delivery.") ? "delivery" : capabilityId.startsWith("script.") ? "script" : capabilityId.startsWith("storyboard.") || capabilityId.startsWith("continuity.") ? "storyboard" : capabilityId.startsWith("reference.") ? "research" : capabilityId.startsWith("video.") && !["video.text_to_video", "video.image_to_video", "video.first_last_frame", "video.extend"].includes(capabilityId) ? "edit" : capabilityId.startsWith("audio.") || capabilityId.startsWith("subtitle.") ? "edit" : "generation"; }
function timeRangeSchema() { return objectSchema({ start: rationalTimeSchema(), duration: rationalTimeSchema() }, ["start", "duration"]); }
function readOnlyAnnotations() { return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }; }
function writeAnnotations() { return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }; }
function canvasMeta(invoking, invoked) {
  return {
    ui: { resourceUri: CANVAS_URI, visibility: ["model", "app"] },
    "openai/outputTemplate": CANVAS_URI,
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked
  };
}

async function createBrowserSession({ projectPath, outcome, runId, sessionId = randomUUID(), recoveredState = null }) {
  const { origin, startedAt } = await canvasSurfaceHost.start();
  const resolvedRunId = runId ?? recoveredState?.runId ?? null;
  canvasSurfaceHost.bind("canvas", sessionId, { projectPath, runId: resolvedRunId }, { rotateClaim: true });
  if (!resolvedRunId || recoveredState) {
    preflightSessions.set(sessionId, {
      ...(recoveredState ?? {}),
      projectPath,
      outcome,
      runId: resolvedRunId,
      createdAt: recoveredState?.createdAt ?? new Date().toISOString(),
      recoveredFromDisk: recoveredState !== null,
      recoveryCount: Number(recoveredState?.recoveryCount ?? 0) + (recoveredState ? 1 : 0)
    });
  }
  return {
    sessionId,
    browserCanvasUrl: canvasSurfaceHost.url("canvas", sessionId, { origin }),
    canvasService: { status: "ready", origin, startedAt }
  };
}

async function getOrRecoverPreflightSession(projectPath, preflightId) {
  const active = preflightSessions.get(preflightId);
  if (active) {
    try { return projectPreflightSession(preflightId, active); }
    catch (error) {
      if (error?.statusCode !== 404) throw error;
      await createBrowserSession({ projectPath, outcome: active.outcome, runId: active.runId, sessionId: preflightId, recoveredState: active });
      return projectPreflightSession(preflightId, preflightSessions.get(preflightId));
    }
  }
  const recovered = await readPreflightTransaction(projectPath, preflightId);
  if (!recovered) return null;
  await createBrowserSession({
    projectPath,
    outcome: recovered.outcome,
    runId: recovered.runId,
    sessionId: preflightId,
    recoveredState: recovered
  });
  const session = projectPreflightSession(preflightId, preflightSessions.get(preflightId));
  await savePreflightSession(preflightId, session);
  return session;
}

function projectPreflightSession(preflightId, state) {
  const binding = canvasSurfaceHost.lookup("canvas", preflightId);
  return {
    ...state,
    canvasOpenedAt: binding.canvasOpenedAt,
    hostClaimedAt: binding.hostClaimedAt,
    documentServedAt: binding.documentServedAt,
    lastSeenAt: binding.lastSeenAt,
    visibilityState: binding.visibilityState,
    heartbeatCount: binding.heartbeatCount,
    lastEvent: binding.lastEvent,
    surface: binding.hostClaimedAt ? "browser" : null
  };
}

async function savePreflightSession(preflightId, state) {
  const durableState = durablePreflightState(state);
  preflightSessions.set(preflightId, durableState);
  await persistPreflightTransaction(preflightId, durableState);
}

function durablePreflightState(state) {
  const {
    canvasOpenedAt: _canvasOpenedAt,
    hostClaimedAt: _hostClaimedAt,
    documentServedAt: _documentServedAt,
    lastSeenAt: _lastSeenAt,
    visibilityState: _visibilityState,
    heartbeatCount: _heartbeatCount,
    lastEvent: _lastEvent,
    surface: _surface,
    ...durable
  } = state ?? {};
  return durable;
}

async function preflightStatusPayload(preflight, preflightId) {
  const { origin, startedAt } = await canvasSurfaceHost.start();
  const browserCanvasUrl = canvasSurfaceHost.url("canvas", preflightId, { origin });
  const canvasSurfaceHealth = canvasSurfaceHost.health(preflight);
  const base = {
    preflightId,
    browserCanvasUrl,
    subagentNamingStatus: preflight.subagentNamingStatus,
    hostCapabilities: preflight.hostCapabilities ?? null,
    canvasService: { status: "ready", origin, startedAt },
    preferredSurface: "codex_in_app_browser",
    canvasTabKey: `directorx:${preflightId}`,
    canvasSurfaceHealth,
    hostAction: { type: "open_url", url: browserCanvasUrl, browser: "iab", visibility: true, persistence: "handoff", requiredBefore: "directorx_get_preflight_status" },
    afterCanvasOpen: { type: "mcp_tool", tool: "directorx_get_preflight_status", required: true, arguments: { projectPath: preflight.projectPath, preflightId } },
    bootTransaction: projectPreflightBootTransaction(preflightId, preflight)
  };
  if (!preflight.canvasOpenedAt || preflight.surface !== "browser") {
    return { ...base, status: "awaiting_canvas_open", nextHostInteraction: null };
  }
  const goalChoice = String(preflight.goalInteraction?.answers?.enter_directorx_goal ?? "");
  const goalAccepted = preflight.goalInteraction?.status === "resolved" && goalChoice.startsWith("进入制作");
  const goalDeclined = preflight.goalInteraction?.status === "resolved" && !goalAccepted;
  const hostCapabilityBlocked = preflight.hostCapabilities?.productionReadiness?.mayCreateRun !== true;
  const nextHostInteraction = preflight.runId || goalAccepted || goalDeclined ? null : preflight.invalidAgentTypeEvidence ? {
    request: null,
    hostAction: {
      type: "retry_preflight",
      required: true,
      tool: "directorx_capability_preflight",
      sourceTool: "spawn_agent",
      sourceField: "agent_type",
      extractionPath: "inputSchema.properties.agent_type.enum",
      reason: "availableAgentTypes must contain spawn_agent agent_type enum values, or collaboration_task when spawn_agent exposes task_name/fork_turns/message without agent_type; never pass host tool names."
    }
  } : hostCapabilityBlocked ? {
    request: null,
    hostAction: {
      type: "repair_host_capabilities",
      required: true,
      blockers: preflight.hostCapabilities.productionReadiness.blockers,
      guidance: {
        native_goal: "Expose Codex create_goal, get_goal, and update_goal before entering Director X Goal mode.",
        native_interaction: "Enable request_user_input for the current Codex mode; Director X will not replace it with chat questions.",
        agent_dispatch: "Reread the current spawn_agent schema and pass its agent_type enum, or collaboration_task for the task_name/fork_turns/message host.",
        durable_loop: "Expose Goal lifecycle plus exec or wait support so the production turn can checkpoint and resume.",
        side_browser: "Load browser:control-in-app-browser; direct tool-name absence alone is not proof that the Browser skill is unavailable."
      }
    }
  } : preflight.subagentNamingStatus.sessionReady ? {
    request: preflight.goalInteraction,
    hostAction: { type: "host_tool", tool: "request_user_input", required: true, requestId: preflight.goalInteractionRequestId, arguments: { questions: preflight.goalInteraction.questions } }
  } : !preflight.subagentNamingStatus.diskReady ? {
    request: preflight.roleInstallInteraction,
    hostAction: { type: "host_tool", tool: "request_user_input", required: true, requestId: preflight.roleInstallInteractionRequestId, arguments: { questions: preflight.roleInstallInteraction.questions } }
  } : {
    request: null,
    hostAction: { type: "restart_codex", required: true, reason: "Codex does not hot-load custom agent types into an already-created task. User-scoped DX roles are installed; reopen Codex once to rebuild spawn_agent." }
  };
  const status = preflightLifecycleStatus(preflight, { goalAccepted, goalDeclined });
  const goalBootProtocol = compileDirectorXGoalBootProtocol({
    projectPath: preflight.projectPath,
    outcome: preflight.outcome,
    preflightId,
    goalInteractionRequestId: preflight.goalInteractionRequestId,
    questions: preflight.goalInteraction.questions,
    goalAccepted
  });
  return {
    ...base,
    status,
    nextHostInteraction,
    bootTransaction: projectPreflightBootTransaction(preflightId, preflight),
    goalLifecycle: {
      afterAcceptance: goalBootProtocol.afterAcceptance,
      hostAction: goalAccepted ? goalBootProtocol.createGoalAction : goalBootProtocol.requestUserInputAction,
      requiredBeforeIntake: true
    }
  };
}

function preflightLifecycleStatus(preflight, { goalAccepted, goalDeclined }) {
  if (preflight.runId) return "awaiting_goal_binding";
  if (goalDeclined) return "goal_declined";
  if (preflight.invalidAgentTypeEvidence) return "invalid_agent_type_evidence";
  if (preflight.hostCapabilities?.productionReadiness?.mayCreateRun !== true) return "host_capability_blocked";
  if (goalAccepted) return "awaiting_goal_creation";
  if (preflight.subagentNamingStatus.sessionReady) return "awaiting_goal_confirmation";
  if (!preflight.subagentNamingStatus.diskReady) return "awaiting_agent_bootstrap";
  return "restart_required";
}

async function withBrowserCanvas(snapshot, args) {
  const runId = args.runId ?? snapshot.runId;
  let binding = canvasSurfaceHost.findCanvasByRun(args.projectPath, runId);
  if (!binding) {
    const created = await createBrowserSession({ projectPath: args.projectPath, outcome: snapshot.goal?.outcome ?? "Director X production", runId });
    binding = [created.sessionId, canvasSurfaceHost.lookup("canvas", created.sessionId)];
  }
  const [canvasSessionId, canvasSession] = binding;
  const { origin } = await canvasSurfaceHost.start();
  const browserCanvasUrl = canvasSurfaceHost.url("canvas", canvasSessionId, { origin });
  const canvasTabKey = `directorx:${runId}`;
  const nativeInteractionBatch = compilePendingInteractionBatch({
    projectPath: args.projectPath,
    runId,
    requests: snapshot.interactions?.pending ?? []
  });
  const nativeInteraction = nativeInteractionBatch ? {
    request: nativeInteractionBatch.request,
    requests: nativeInteractionBatch.requests,
    requestBatch: {
      requestId: nativeInteractionBatch.requestId,
      sourceRequestIds: nativeInteractionBatch.sourceRequestIds,
      questionCount: nativeInteractionBatch.questionCount,
      batchPolicy: nativeInteractionBatch.batchPolicy
    },
    hostAction: nativeInteractionBatch.hostAction
  } : null;
  return {
    ...snapshot,
    browserCanvasUrl,
    canvasSessionId,
    canvasSurfaceHealth: canvasSurfaceHost.health(canvasSession),
    preferredSurface: "codex_in_app_browser",
    canvasTabKey,
    canvasHostAction: { type: "in_app_browser", action: "open_or_claim", tabKey: canvasTabKey, url: browserCanvasUrl, visibility: true, required: true },
    canvasTurnEndAction: { type: "browser_tabs_finalize", tabKey: canvasTabKey, keepStatus: snapshot.status === "complete" ? "deliverable" : "handoff", required: true },
    nextHostInteraction: nativeInteraction ?? goalBindingAction(snapshot, args)
  };
}

function goalBindingAction(snapshot, args) {
  if (snapshot.goal?.boundAt) return null;
  const runId = args.runId ?? snapshot.runId;
  const nextTool = {
    type: "mcp_tool",
    tool: "directorx_bind_goal",
    required: true,
    arguments: {
      projectPath: args.projectPath,
      runId,
      codexGoalId: snapshot.goal?.codexGoalId ?? "$create_goal.result.goal.threadId"
    }
  };
  if (snapshot.goal?.codexGoalId) return { request: null, hostAction: null, nextTool };
  return {
    request: null,
    hostAction: {
      type: "host_tool",
      tool: "create_goal",
      required: true,
      arguments: { objective: snapshot.goal?.terminalOutcome ?? snapshot.goal?.outcome }
    },
    nextTool
  };
}

async function withRunResumeActions(run, args) {
  const snapshot = publicSnapshot(run);
  const canvasBinding = await withBrowserCanvas(snapshot, args);
  const editorBinding = await bindOpenCutEditorBrowser(run, args, canvasBinding.browserCanvasUrl);
  return {
    ...canvasBinding,
    ...editorBinding,
    resumeActionPlan: buildRunResumeActionPlan(snapshot, {
      projectPath: args.projectPath,
      canvasBinding,
      editorBinding
    })
  };
}

async function withPostRenderAuditGate(run, args) {
  const response = await withRunResumeActions(run, args);
  return {
    ...response,
    postRenderGate: run.postRenderGate,
    requiredNextSequence: [
      {
        order: 1,
        tool: "directorx_register_stage_package",
        reason: "Complete the edit package, including render_quality_contract.json and render_report.json."
      },
      {
        order: 2,
        tool: "directorx_transition_stage",
        arguments: { projectPath: args.projectPath, runId: args.runId, stageId: "review", action: "begin", detail: "Begin mandatory full-frame review." }
      },
      {
        order: 3,
        tool: "directorx_verify_final_media",
        arguments: { projectPath: args.projectPath, runId: args.runId, finalVideoPath: run.postRenderGate?.mediaPath },
        reason: "Decode and inspect every final frame before any delivery claim."
      }
    ],
    userFacingSummary: {
      ...(response.userFacingSummary ?? {}),
      suggestedUpdate: "预览片已渲染，正在逐帧检查画面、声音和字幕；检查完成前不会进入交付。"
    }
  };
}

async function bindOpenCutEditorBrowser(run, args, canvasUrl) {
  const editorSessionId = run.openCutEditor?.activeSessionId;
  const session = editorSessionId ? run.openCutEditor.sessions?.[editorSessionId] : null;
  if (!session || ["completed", "cancelled", "failed"].includes(session.status)) return { editorUrl: null, editorHostAction: null, editorTurnEndAction: null };
  const resolvedCanvasUrl = canvasUrl ?? (await withBrowserCanvas(publicSnapshot(run), args)).browserCanvasUrl;
  const { origin } = await canvasSurfaceHost.start();
  const editorTabKey = `directorx-cut:${args.runId}`;
  const binding = canvasSurfaceHost.bind("editor", editorSessionId, { projectPath: args.projectPath, runId: args.runId, canvasUrl: resolvedCanvasUrl });
  const editorUrl = canvasSurfaceHost.url("editor", editorSessionId, { origin });
  return {
    editorUrl,
    editorSessionId,
    editorTabKey,
    editorSurfaceHealth: canvasSurfaceHost.health(binding),
    editorHostAction: { type: "in_app_browser", action: "open_or_claim", tabKey: editorTabKey, url: editorUrl, visibility: true, required: true },
    editorTurnEndAction: { type: "browser_tabs_finalize", tabKey: editorTabKey, keepStatus: "handoff", required: true }
  };
}

async function handleCanvasRequest(request, response) {
  try {
    const { origin } = await canvasSurfaceHost.start();
    const url = new URL(request.url ?? "/", origin);
    if (request.method === "GET" && url.pathname === "/directorx/opencut-editor.js") {
      return send(response, 200, await readFile(new URL("../app/opencut-editor.js", import.meta.url), "utf8"), "text/javascript; charset=utf-8");
    }
    if (request.method === "POST" && url.pathname === "/directorx/api/surface-heartbeat") {
      const body = await readJsonBody(request, 8 * 1024);
      const { health } = canvasSurfaceHost.observe(body.surface, body.session, { claimToken: body.claimToken, visibility: body.visibility, event: body.event ?? "heartbeat" });
      const preflightState = body.surface === "canvas" && body.event === "boot" ? preflightSessions.get(body.session) : null;
      if (preflightState?.goalInteractionRequestId) await savePreflightSession(body.session, projectPreflightSession(body.session, preflightState));
      return json(response, 200, { surface: body.surface, health });
    }
    if (request.method === "GET" && url.pathname === "/directorx/editor") {
      const editorSessionId = url.searchParams.get("session");
      const claimToken = url.searchParams.get("claim");
      canvasSurfaceHost.lookup("editor", editorSessionId, { claimToken, requireClaim: true });
      canvasSurfaceHost.markDocumentServed("editor", editorSessionId);
      canvasSurfaceHost.observe("editor", editorSessionId, { claimToken, visibility: "visible", event: "document_open" });
      return send(response, 200, await readFile(new URL("../app/opencut-editor.html", import.meta.url), "utf8"), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/directorx/api/editor-state") {
      const editorSessionId = url.searchParams.get("session");
      const editorSession = requireSurfaceClaim(request, url, "editor", editorSessionId);
      const editorSurfaceHealth = canvasSurfaceHost.observe("editor", editorSessionId, { claimToken: surfaceClaimToken(request, url), visibility: url.searchParams.get("visibility") ?? editorSession.visibilityState, event: "state_poll" }).health;
      const run = await readRun(editorSession.scope);
      return json(response, 200, { ...buildOpenCutEditorBootstrap(run, editorSessionId), canvasUrl: editorSession.scope.canvasUrl, editorSurfaceHealth });
    }
    if (request.method === "GET" && url.pathname === "/directorx/api/editor-waveform") {
      const editorSessionId = url.searchParams.get("session");
      const editorSession = requireSurfaceClaim(request, url, "editor", editorSessionId);
      const run = await readRun(editorSession.scope);
      const descriptor = openCutEditorWaveformDescriptor(run, editorSessionId);
      if (descriptor.mode !== "viewport_pyramid") return json(response, 404, { error: "This Director X Cut session has no viewport waveform pyramid." });
      if (url.searchParams.get("waveformId") !== descriptor.waveformId) return json(response, 403, { error: "The requested waveform is not bound to this Director X Cut source." });
      const result = await getWaveformWindow({ projectPath: editorSession.scope.projectPath, runId: editorSession.scope.runId, waveformId: descriptor.waveformId, startSeconds: Number(url.searchParams.get("start")), durationSeconds: Number(url.searchParams.get("duration")), pixelWidth: Number(url.searchParams.get("pixelWidth")) });
      return json(response, 200, result);
    }
    if (request.method === "GET" && url.pathname === "/directorx/api/editor-media") {
      const editorSessionId = url.searchParams.get("session");
      const editorSession = requireSurfaceClaim(request, url, "editor", editorSessionId);
      const run = await readRun(editorSession.scope);
      const active = run.openCutEditor?.sessions?.[editorSessionId];
      const source = run.artifacts?.[active?.sourceArtifactRef];
      if (!source?.path) return json(response, 404, { error: "Director X Cut source media is unavailable." });
      const details = await resolveWorkspaceMediaFile(editorSession.scope.projectPath, source.path);
      return await canvasSurfaceHost.streamMedia(request, response, details.path, details.size);
    }
    if (request.method === "POST" && url.pathname === "/directorx/api/editor-draft") {
      const body = await readJsonBody(request, 512 * 1024);
      const editorSession = requireSurfaceClaim(request, url, "editor", body.session);
      if (body.editorSessionId !== body.session) return json(response, 404, { error: "Unknown or mismatched Director X Cut browser session." });
      let draft;
      let snapshot = await updateRun({ ...editorSession.scope, mutate(run) {
        draft = saveOpenCutEditorDraft(run, body);
        run.events.push(event(run, "opencut.draft.saved", "edit", `${body.editorSessionId} · ${draft.operations.length} operations`));
        return run;
      } });
      const written = await writeOpenCutEditorArtifacts({ projectPath: editorSession.scope.projectPath, runId: editorSession.scope.runId, session: snapshot.openCutEditor.sessions[body.editorSessionId] });
      const records = {};
      for (const result of Object.values(written)) records[result.artifactRef] = await inspectArtifact({ ...editorSession.scope, artifactRef: result.artifactRef, path: result.path, stage: "edit", mediaKind: "document", metadata: { canvasEssential: ["opencut_project.json", "opencut_edit_result.json"].includes(result.artifactRef), sourceArtifactRefs: [snapshot.openCutEditor.sessions[body.editorSessionId].sourceArtifactRef], editorSessionId: body.editorSessionId } });
      snapshot = await updateRun({ ...editorSession.scope, mutate(run) { run.artifacts ??= {}; Object.assign(run.artifacts, records); upsertOpenCutCanvasNode(run, run.openCutEditor.sessions[body.editorSessionId]); return run; } });
      return json(response, 200, { draftId: draft.draftId, operationCount: draft.operations.length, status: draft.status, nextTool: "directorx_import_opencut_edit_result", canvasUrl: editorSession.scope.canvasUrl });
    }
    if (request.method === "GET" && url.pathname === "/directorx/canvas") {
      const sessionId = url.searchParams.get("session");
      requireSurfaceClaim(request, url, "canvas", sessionId);
      canvasSurfaceHost.markDocumentServed("canvas", sessionId);
      return send(response, 200, await readFile(new URL("../app/browser-canvas.html", import.meta.url), "utf8"), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/directorx/api/state") {
      const sessionId = url.searchParams.get("session");
      const session = requireSurfaceClaim(request, url, "canvas", sessionId);
      const canvasSurfaceHealth = session.hostClaimedAt
        ? canvasSurfaceHost.observe("canvas", sessionId, { claimToken: surfaceClaimToken(request, url), visibility: url.searchParams.get("visibility") ?? session.visibilityState, event: "state_poll" }).health
        : canvasSurfaceHost.health(session);
      if (session.scope.runId) {
        const snapshot = publicSnapshot(await readRun(session.scope));
        return json(response, 200, { ...snapshot, productionCanvas: projectCanvas(snapshot), canvasSurfaceHealth });
      }
      const preflight = preflightSessions.get(sessionId);
      if (!preflight) return json(response, 404, { error: "Unknown or expired Director X preflight session." });
      const smoke = preflight.setupSmokeReceipt;
      const snapshot = {
        status: preflight.subagentSessionReady === false ? "awaiting_agent_bootstrap" : "awaiting_goal_confirmation",
        stage: "intake",
        goal: { displayMode: "Director X Goal", outcome: preflight.outcome },
        approvals: [
          ...(preflight.subagentSessionReady === false ? [{ kind: "role_install", status: "pending" }] : []),
          { kind: "goal_entry", status: "pending" },
          { kind: "budget", status: "pending" },
          { kind: "image_model", status: "pending" },
          { kind: "video_model", status: "pending" },
          { kind: "voice_model", status: "pending" },
          { kind: "music_strategy", status: "pending" }
        ],
        setupHealth: preflight.setupHealthSummary ?? null,
        artifacts: smoke ? {
          "setup.smoke.video": { path: smoke.media.clipPath, mediaKind: "video", stage: "intake", sha256: smoke.media.clipSha256, metadata: { canvasEssential: true, diagnosticsSurface: "setup", label: smoke.label, durationSeconds: smoke.media.durationSeconds } },
          "setup.smoke.thumbnail": { path: smoke.media.thumbnailPath, mediaKind: "image", stage: "intake", sha256: smoke.media.thumbnailSha256, metadata: { canvasEssential: true, diagnosticsSurface: "setup", label: `${smoke.label} preview`, sourceArtifactRefs: ["setup.smoke.video"] } }
        } : {},
        events: [
          { sequence: 1, type: preflight.subagentSessionReady === false ? "preflight.agent_bootstrap_required" : "preflight.ready", stage: "intake", detail: preflight.subagentSessionReady === false ? `No compatible Codex host agent is available for: ${preflight.subagentNamingStatus?.unroutableRoleIds?.join(", ")}` : preflight.subagentNamingStatus?.sessionMode === "builtin_compatibility" ? "Director X is ready for Goal confirmation using built-in Codex hosts with canonical DX production identities." : "Director X is ready for Goal confirmation." },
          ...(smoke ? [{ sequence: 2, type: "setup.smoke.passed", stage: "intake", detail: `${smoke.label} · ${smoke.media.durationSeconds}s · zero provider budget` }] : [])
        ]
      };
      return json(response, 200, { ...snapshot, productionCanvas: projectCanvas(snapshot), canvasSurfaceHealth });
    }
    if (request.method === "POST" && url.pathname === "/directorx/api/canvas-ui-state") {
      const body = await readJsonBody(request, 16 * 1024);
      const session = requireSurfaceClaim(request, url, "canvas", body.session);
      if (!session.scope.runId) return json(response, 404, { error: "Unknown or unbound Director X browser session." });
      const uiState = normalizeCanvasUiState(body.uiState);
      await updateRun({ ...session.scope, mutate(run) { run.canvas ??= { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: .72 } }; run.canvas.uiState = uiState; return run; } });
      return json(response, 200, { status: "persisted", updatedAt: uiState.updatedAt });
    }
    if (request.method === "POST" && url.pathname === "/directorx/api/review-note") {
      const body = await readJsonBody(request, 8 * 1024);
      const session = requireSurfaceClaim(request, url, "canvas", body.session);
      if (!session.scope.runId) return json(response, 404, { error: "Canvas review notes require a durable Director X Run." });
      let created;
      let isNew = false;
      try {
        await updateRun({ ...session.scope, async mutate(run) {
          const previousCount = run.canvasReviewNotes?.length ?? 0;
          created = recordCanvasReviewNote(run, body.note);
          isNew = run.canvasReviewNotes.length > previousCount;
          const written = await writeCanvasReviewNotesArtifact({ ...session.scope, notes: run.canvasReviewNotes });
          run.artifacts ??= {};
          run.artifacts[written.artifactRef] = await inspectArtifact({ ...session.scope, artifactRef: written.artifactRef, path: written.path, stage: "review", mediaKind: "document", metadata: { internal: true, userAuthored: true, noteCount: run.canvasReviewNotes.length } });
          if (isNew) run.events.push(event(run, "canvas.review_note.created", "review", `${created.noteId} · ${created.targetArtifactRef}${created.timeSeconds == null ? "" : ` · ${created.timeSeconds}s`}`));
          return run;
        } });
      } catch (error) {
        throw new CanvasSurfaceHostError(400, error instanceof Error ? error.message : String(error));
      }
      return json(response, isNew ? 201 : 200, { note: created, status: isNew ? "recorded" : "unchanged", isApproval: false, canSatisfyGate: false });
    }
    if (request.method === "GET" && url.pathname === "/directorx/api/media") {
      const session = requireSurfaceClaim(request, url, "canvas", url.searchParams.get("session"));
      const details = await resolveWorkspaceMediaFile(session.scope.projectPath, url.searchParams.get("path") ?? "");
      return await canvasSurfaceHost.streamMedia(request, response, details.path, details.size);
    }
    if (request.method === "GET" && url.pathname === "/directorx/api/waveform") {
      const session = requireSurfaceClaim(request, url, "canvas", url.searchParams.get("session"));
      if (!session.scope.runId) return json(response, 404, { error: "Unknown or unbound Director X browser session." });
      const result = await getWaveformWindow({ ...session.scope, waveformId: url.searchParams.get("waveformId"), startSeconds: Number(url.searchParams.get("start")), durationSeconds: Number(url.searchParams.get("duration")), pixelWidth: Number(url.searchParams.get("pixelWidth")) });
      return json(response, 200, result);
    }
    if (request.method === "POST" && url.pathname === "/directorx/api/credential") {
      const body = await readJsonBody(request);
      const session = requireSurfaceClaim(request, url, "canvas", body.session);
      if (session.scope.runId) hydrateCustomMediaProviderAdapters((await readRun(session.scope)).providerAdapters);
      try { return json(response, 200, setSessionCredential(body)); }
      catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
    }
    if (request.method === "GET" && url.pathname === "/directorx/api/credential-status") {
      const session = requireSurfaceClaim(request, url, "canvas", url.searchParams.get("session"));
      return json(response, 200, {
        credentials: [...credentialStatus.entries()].map(([providerId, status]) => ({ providerId, ...status })),
        availableCredentials: await credentialOptionsForSession(session.scope)
      });
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, error?.statusCode ?? 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

function requireSurfaceClaim(request, url, surface, sessionId) {
  return canvasSurfaceHost.lookup(surface, sessionId, { claimToken: surfaceClaimToken(request, url), requireClaim: true });
}

function surfaceClaimToken(request, url) {
  const header = request.headers["x-directorx-claim"];
  return url.searchParams.get("claim") ?? (Array.isArray(header) ? header[0] : header) ?? null;
}

function mosiVoiceSetup(args = {}) {
  const keyCreationUrl = "https://platform.mosi.cn";
  const credentialConfigured = Boolean([...credentialStatus.values()].find((status) => status.configured && status.envName === "MOSS_API_KEY") || process.env.MOSS_API_KEY);
  const focusCredentialPanel = { type: "focus_canvas_credential", providerId: "mosi.tts", envName: "MOSS_API_KEY", persistence: "handoff", secretPolicy: "session_only_not_persisted" };
  return {
    schemaVersion: "1.0",
    providerId: "mosi.tts",
    displayName: "MOSI Speech / MOSS-TTS",
    recommendedForDirectorXAudio: true,
    modelId: args.modelId ?? "moss-tts",
    voiceId: args.voiceId ?? null,
    defaultSelection: { providerId: "mosi.tts", modelId: "moss-tts", recommended: true },
    selectionQuestion: {
      header: "配音模型",
      id: "voice_model",
      question: "选择本项目的语音生成模型。",
      options: [
        { label: "MOSS-TTS (Recommended)", description: "Director X 默认语音路线；中文与多模态视频制作优先，Key 可在 platform.mosi.cn 创建。" },
        { label: "MOSS-TTS-Nano (Local)", description: "使用已在本机配置好的 OpenMOSS MOSS-TTS-Nano CLI，不需要平台 API Key。" },
        { label: "其他 TTS / 不使用配音", description: "继续确认其他精确模型，或明确本项目不需要旁白与角色语音。" }
      ]
    },
    localSetup: {
      providerId: "openmoss.moss-tts-nano.local",
      modelId: "moss-tts-nano",
      repositoryUrl: "https://github.com/OpenMOSS/MOSS-TTS-Nano",
      command: process.env.MOSS_TTS_NANO_COMMAND ?? "moss-tts-nano",
      commandEnv: "MOSS_TTS_NANO_COMMAND",
      generationTool: "directorx_generate_local_moss_tts_nano_voiceover",
      credentialRequired: false,
      requiredInputs: ["text", "promptSpeechPath", "promptSpeechRightsApproved", "outputPath"],
      outputFormat: "wav"
    },
    keySetupRequired: !credentialConfigured,
    keySetupInteraction: {
      kind: "provider_input",
      gateKey: "mosi-tts-key-setup",
      reason: "MOSS-TTS 已选中，但当前 Director X MCP 会话尚未配置 MOSS_API_KEY。",
      questions: [{
        header: "MOSI API Key",
        id: "mosi_key_setup",
        question: "是否前往 MOSI 开放平台获取你的 TTS API Key？",
        options: [
          { label: "前往 MOSI 开放平台 (Recommended)", description: "在侧边 Browser 新标签打开 platform.mosi.cn，创建 Key 后回到 Director X 画布安全注入。" },
          { label: "我已有 Key", description: "直接回到 Director X 画布凭证面板输入，Key 仅注入当前 MCP 会话且不会保存。" },
          { label: "暂不配置", description: "保留 MOSS-TTS 选择，但暂停依赖语音生成的阶段。" }
        ]
      }]
    },
    keySetupAnswerActions: {
      "前往 MOSI 开放平台 (Recommended)": [
        { type: "open_url", url: keyCreationUrl, browser: "iab", target: "new_tab", visibility: true, persistence: "handoff", keepProductionCanvas: true },
        { ...focusCredentialPanel, after: "api_key_created" }
      ],
      "我已有 Key": [focusCredentialPanel],
      "暂不配置": [{ type: "block_dependent_stage", capability: "tts", reason: "MOSS_API_KEY is not configured." }]
    },
    keyCreationUrl,
    docsUrl: "https://platform.mosi.cn/docs/getting-started/overview/",
    apiBaseUrl: "https://api.mosi.cn/v1",
    credentialEnv: "MOSS_API_KEY",
    credentialConfigured,
    credentialPolicy: "session_only_not_persisted",
    requiredInteraction: { kind: "voice_model", surface: "codex_request_user_input", fields: ["providerId", "modelId", "voiceId", "budget"] },
    userGuidance: "先把 selectionQuestion 原样交给 Codex request_user_input，默认推荐 MOSS-TTS。选中后若 keySetupRequired=true，必须用 keySetupInteraction 创建并执行原生提示框；只有用户选择前往时才执行对应 Browser 动作。Key 只能在 Director X 画布密码框注入，插件不保存，MCP 进程退出即失效。"
  };
}

function assertOfficialPricingResearchEvidence(run, evidence) {
  const sources = run.providerApiResearch?.sources ?? [];
  const target = new URL(evidence.sourceUrl);
  const matched = sources.some((source) => {
    try {
      const candidate = new URL(source.url ?? source.sourceUrl);
      return candidate.hostname === target.hostname && (source.sourceType === "official" || source.type === "official" || source.authority === "primary");
    } catch { return false; }
  });
  if (!matched) throw new Error("Register model pricing only after provider_api_research_receipt.json contains the opened official pricing page.");
}

function validateMusicStrategyDecision(value = {}) {
  const route = value.route ?? value.musicRoute ?? value.music_route;
  if (!["local_file", "rights_safe_library", "generated_music", "none", "video_native_fallback"].includes(route)) throw new Error("music_strategy requires one supported background-music route.");
  if (route === "video_native_fallback" && value.nativeFallbackApproved !== true && value.native_fallback_approved !== true) throw new Error("video_native_fallback requires explicit nativeFallbackApproved=true.");
}

function validateMusicAssetSelectionDecision(run, value = {}) {
  const strategy = [...(run.decisions ?? [])].reverse().find((decision) => ["music_strategy", "music_route"].includes(decision.kind))?.value ?? {};
  validateMusicStrategyDecision(strategy);
  const route = strategy.route ?? strategy.musicRoute ?? strategy.music_route;
  if (["local_file", "rights_safe_library"].includes(route)) {
    const assetRef = value.assetRef ?? value.asset_ref;
    if (!assetRef) throw new Error(`${route} requires a selected local music assetRef after search and audit.`);
    const selected = (run.musicAssets ?? []).find((asset) => [asset.assetId, asset.artifactRef].includes(assetRef) && asset.status === "ready");
    if (!selected) throw new Error("music_asset_selection requires a passing local rights and quality audit from DX-Asset-Manager.");
  }
  if (route === "generated_music" && (!(value.providerId ?? value.provider_id) || !(value.modelId ?? value.model_id))) throw new Error("generated_music asset selection requires an exact providerId and modelId.");
  if (["none", "video_native_fallback"].includes(route)) throw new Error(`${route} does not accept a separate music asset selection.`);
}

function assertAudioPlanMatchesDecisions(run, plan) {
  if (plan.confirmedBy !== "request_user_input") throw new Error("Audio responsibility planning requires Codex request_user_input confirmation.");
  for (const kind of ["budget", "video_model", "voice_model", "music_strategy"]) {
    if (!run.approvals?.some((approval) => approval.kind === kind && approval.status === "approved")) throw new Error(`Approve ${kind} before registering the audio responsibility plan.`);
  }
  const decisions = [...(run.decisions ?? [])].reverse();
  const video = decisions.find((decision) => decision.kind === "video_model")?.value ?? {};
  if ((video.providerId ?? video.provider_id) !== plan.video.providerId || (video.modelId ?? video.model_id) !== plan.video.modelId) throw new Error("Audio plan video route must match the exact user-approved video provider/model.");
  const voice = decisions.find((decision) => decision.kind === "voice_model")?.value ?? {};
  const voiceNotUsed = voice.notUsed === true || voice.not_used === true;
  if (voiceNotUsed !== (plan.voice.enabled !== true)) throw new Error("Audio plan voice responsibility must match the user-approved voice decision.");
  if (!voiceNotUsed && ((voice.providerId ?? voice.provider_id) !== plan.voice.providerId || (voice.modelId ?? voice.model_id) !== plan.voice.modelId)) throw new Error("Audio plan TTS route must match the exact user-approved voice provider/model.");
  const music = decisions.find((decision) => ["music_strategy", "music_route"].includes(decision.kind))?.value ?? {};
  validateMusicStrategyDecision(music);
  const approvedRoute = music.route ?? music.musicRoute ?? music.music_route;
  if (approvedRoute !== plan.music.route) throw new Error("Audio plan music route must match the user-approved background-music decision.");
  const selection = decisions.find((decision) => decision.kind === "music_asset_selection")?.value ?? {};
  if (["local_file", "rights_safe_library", "generated_music"].includes(approvedRoute)) validateMusicAssetSelectionDecision(run, selection);
  const approvedAsset = selection.assetRef ?? selection.asset_ref ?? music.assetRef ?? music.asset_ref;
  if (approvedAsset && approvedAsset !== plan.music.assetRef) throw new Error("Audio plan music asset must match the user-approved local track.");
}

function audioPlanSummary(plan) {
  const voice = plan.voice.owner === "tts" ? "独立配音" : plan.voice.owner === "video_model" ? "视频原生配音" : "无配音";
  const music = plan.music.owner === "licensed_asset" || plan.music.owner === "local_asset" ? "独立配乐" : plan.music.owner === "music_model" ? "音乐模型" : plan.music.owner === "video_model" ? "视频原生配乐" : "无配乐";
  return `${voice} · ${music} · 视频原生音频${plan.video.generateAudio ? "开启" : "关闭"}`;
}

function setSessionCredential(args) {
  if (!ENV_NAME_PATTERN.test(args.envName)) throw new Error("envName must be an uppercase environment variable name.");
  if (typeof args.apiKey !== "string" || args.apiKey.length < 8) throw new Error("The API key is missing or too short.");
  const expectedEnv = expectedCredentialEnv(args.providerId);
  if (args.envName !== expectedEnv) throw new Error(`${args.providerId} credentials must use ${expectedEnv}; arbitrary environment-variable injection is not allowed.`);
  process.env[args.envName] = args.apiKey;
  credentialStatus.set(args.providerId, { envName: args.envName, configured: true, configuredAt: new Date().toISOString() });
  return { providerId: args.providerId, credentialRef: `session-env:${args.envName}`, configured: true, persisted: false, expires: "when the Director X MCP process exits" };
}

function expectedCredentialEnv(providerId) {
  if (providerId === "mosi.tts") return "MOSS_API_KEY";
  return getMediaProvider(providerId).credentialEnv;
}

async function credentialOptionsForSession(scope) {
  const options = new Map([["mosi.tts", { providerId: "mosi.tts", displayName: "MOSI Speech / MOSS-TTS", envName: "MOSS_API_KEY", recommended: true }]]);
  if (!scope.runId) return [...options.values()];
  const run = await readRun(scope);
  hydrateCustomMediaProviderAdapters(run.providerAdapters);
  const selected = new Set([
    ...(run.decisions ?? []).map((decision) => decision.value?.providerId ?? decision.value?.provider_id),
    run.generation?.providerId,
    ...Object.keys(run.providerAdapters ?? {})
  ].filter(Boolean));
  for (const providerId of selected) {
    if (providerId === "mosi.tts") continue;
    try {
      const profile = getMediaProvider(providerId);
      options.set(providerId, {
        providerId,
        displayName: profile.displayName,
        envName: profile.credentialEnv,
        recommended: false,
        custom: Boolean(profile.customAdapter)
      });
    } catch {}
  }
  return [...options.values()];
}

function assertCustomProviderResearchEvidence(run, adapter) {
  const research = run.providerApiResearch;
  if (!research?.executions?.some((item) => item.action === "search") || !research.executions.some((item) => item.action === "open")) throw new Error("Custom provider adaptation requires recorded Codex web search and official-source open actions.");
  const verifiedSources = new Map((research.sources ?? [])
    .filter((source) => ["official", "authoritative"].includes(source.sourceType) && source.verification?.status === "verified")
    .map((source) => [source.id, source]));
  for (const evidence of adapter.docs.sources) {
    const source = verifiedSources.get(evidence.sourceId);
    if (!source || source.url !== evidence.url) throw new Error(`Custom provider documentation evidence ${evidence.sourceId} must match a plugin-verified official web research source.`);
  }
}

async function readJsonArtifact(run, artifactRef) {
  const path = run.artifacts?.[artifactRef]?.path;
  if (!path) return null;
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return null; }
}

async function resolveRemotionTimelineAudioBindings(run, args) {
  return await Promise.all((args.timelineAudioBindings ?? []).map(async (binding, index) => {
    const artifactRef = String(binding.artifactRef ?? "").trim();
    const artifact = run.artifacts?.[artifactRef];
    if (!artifact || artifact.mediaKind !== "audio" || !artifact.sha256) {
      throw new Error(`timelineAudioBindings[${index}] must reference a registered audio artifact.`);
    }
    const relativePath = String(artifact.relativePath ?? "").replaceAll("\\", "/");
    const publicMarker = "/public/";
    const publicIndex = relativePath.lastIndexOf(publicMarker);
    const expectedStaticSource = publicIndex >= 0
      ? relativePath.slice(publicIndex + publicMarker.length)
      : relativePath.startsWith("public/") ? relativePath.slice("public/".length) : null;
    if (!expectedStaticSource || expectedStaticSource !== binding.src) {
      throw new Error(`timelineAudioBindings[${index}] src must match its registered file under a Remotion public directory.`);
    }
    const probe = await inspectAudioSource({ projectPath: args.projectPath, audioPath: artifact.path ?? artifact.relativePath, timeoutMs: args.timeoutMs });
    return {
      ...binding,
      sourceArtifactRef: artifactRef,
      sourceSha256: artifact.sha256,
      sourceDurationSeconds: probe.durationSeconds
    };
  }));
}

function artifactMediaDurations(run) {
  return Object.fromEntries(Object.entries(run.artifacts ?? {}).flatMap(([artifactRef, artifact]) => {
    const candidates = [
      artifact?.durationSeconds,
      artifact?.metadata?.durationSeconds,
      artifact?.metadata?.duration_seconds,
      artifact?.metadata?.mediaProbe?.durationSeconds,
      artifact?.metadata?.probe?.durationSeconds
    ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
    return candidates.length ? [[artifactRef, candidates[0]]] : [];
  }));
}

async function readJsonBody(request, maxBytes = 64 * 1024) {
  let body = "";
  let receivedBytes = 0;
  for await (const chunk of request) {
    receivedBytes += chunk.length;
    if (receivedBytes > maxBytes) throw new CanvasSurfaceHostError(413, "Request body is too large.");
    body += chunk.toString("utf8");
  }
  try { return JSON.parse(body || "{}"); }
  catch { throw new CanvasSurfaceHostError(400, "Request body must be valid JSON."); }
}

function send(response, status, body, contentType) {
  response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; media-src 'self' https:; frame-ancestors 'none'" });
  response.end(body);
}

function json(response, status, value) { return send(response, status, JSON.stringify(value), "application/json; charset=utf-8"); }

async function handle(message) {
  const id = message.id ?? null;
  if (message.method === "notifications/initialized") return;
  if (message.method === "initialize") return respond(id, { protocolVersion: "2025-11-05", serverInfo: { name: "directorx-production", version: "0.1.0" }, instructions: `${SERVER_INSTRUCTIONS} ${SCENE_CONFORMANCE_INSTRUCTIONS} ${FAILURE_POLICY_INSTRUCTIONS}`, capabilities: { tools: { listChanged: false }, resources: { listChanged: false } } });
  if (message.method === "tools/list") return respond(id, { tools: toolRegistry.list() });
  if (message.method === "tools/call") {
    try {
      const result = await toolRegistry.call(message.params?.name, message.params?.arguments ?? {});
      return respond(id, { content: [{ type: "text", text: conciseToolResult(message.params?.name ?? "", result) }], structuredContent: result });
  } catch (error) {
      const failure = toolFailurePayload(error);
      return respond(id, {
        isError: true,
        content: [{ type: "text", text: failure?.userFacingMessage ?? (error instanceof Error ? error.message : String(error)) }],
        ...(failure ? { structuredContent: { error: failure } } : {})
      });
    }
  }
  if (message.method === "resources/list") return respond(id, { resources: [{ uri: CANVAS_URI, name: "Director X Production Canvas", mimeType: "text/html;profile=mcp-app" }] });
  if (message.method === "resources/templates/list") return respond(id, { resourceTemplates: [{
    uriTemplate: ARTIFACT_RESOURCE_URI_TEMPLATE,
    name: "Director X Run Artifact",
    description: "Read one SHA-verified artifact registered in a specific Director X Run. Text is limited to 2 MiB and binary previews to 16 MiB; larger media remains on the side Browser canvas."
  }] });
  if (message.method === "resources/read") {
    try {
      if (message.params?.uri === CANVAS_URI) {
        const html = await readFile(new URL("../app/canvas.html", import.meta.url), "utf8");
        return respond(id, { contents: [{ uri: CANVAS_URI, mimeType: "text/html;profile=mcp-app", text: html, _meta: { ui: { prefersBorder: false } } }] });
      }
      const content = await readArtifactResource({ uri: message.params?.uri, readRun });
      return respond(id, { contents: [content] });
    } catch (resourceError) {
      return error(id, -32002, resourceError instanceof Error ? resourceError.message : "Director X resource read failed.");
    }
  }
  return error(id, -32601, `Unsupported method: ${message.method}`);
}

function respond(id, result) { return { jsonrpc: "2.0", id, result }; }
function error(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

let buffer = "";
stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    void handle(message).then((response) => response && write(response));
  }
});
stdin.resume();
stdin.on("end", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

let shutdownPromise = null;
function shutdown(exitCode) {
  shutdownPromise ??= canvasSurfaceHost.close().catch(() => {}).finally(() => process.exit(exitCode));
  return shutdownPromise;
}

function write(message) {
  stdout.write(`${JSON.stringify(message)}\n`);
}
