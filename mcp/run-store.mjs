import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { completionPolicy } from "./completion-policy.mjs";
import { buildUserFacingRunSummary } from "./conversation-ux.mjs";
import { appendRunCheckpoint } from "./run-control.mjs";
import { evaluateCreativeProgressSla } from "./fast-start-policy.mjs";

const SECRET_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|private[_-]?key)/i;
const writeQueues = new Map();
const RUNTIME_INSTANCE_ID = process.env.DIRECTORX_RUNTIME_INSTANCE_ID || randomUUID();
const RUNTIME_LEASE_ENABLED = !process.env.NODE_TEST_CONTEXT;

export function assertSecretFree(value, path = "payload") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_PATTERN.test(key)) throw new Error(`Secrets are not accepted in ${path}.${key}; use a credential reference.`);
    assertSecretFree(nested, `${path}.${key}`);
  }
}

function statePath(projectPath, runId) {
  return join(resolve(projectPath), ".directorx", "plugin-runs", `${runId}.json`);
}

async function writeAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function serialize(path, operation) {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  writeQueues.set(path, current);
  try {
    return await current;
  } finally {
    if (writeQueues.get(path) === current) writeQueues.delete(path);
  }
}

export async function createRun({ projectPath, outcome, codexGoalId = null }) {
  if (!projectPath) throw new Error("projectPath is required.");
  if (!outcome) throw new Error("outcome is required.");
  const now = new Date().toISOString();
  const run = {
    schemaVersion: "1.0",
    runId: `dx-${randomUUID()}`,
    goal: { codexGoalId, boundAt: null, displayMode: "Director X Goal", outcome, terminalOutcome: `Deliver a playable final video for: ${outcome}` },
    completionPolicy,
    status: "awaiting_goal_binding",
    stage: "intake",
    pipeline: null,
    capabilityRoute: null,
    toolInventory: null,
    hostCapabilities: null,
    capabilityExecutionPlan: null,
    executionTelemetry: null,
    providerCapacity: {},
    providerAdapters: {},
    routeFeedback: null,
    modelKnowledgePatch: null,
    productionLineage: {},
    knowledgeDecisions: [],
    acceptedModelKnowledge: null,
    benchmarkSuites: {},
    benchmarkVerifierReceipts: {},
    benchmarkTrials: [],
    benchmarkReports: {},
    benchmarkSchedules: {},
    benchmarkBaselineDecisions: [],
    observabilityTrace: null,
    runMode: null,
    stageApprovals: {},
    checkpoints: [],
    providerCapabilities: {},
    repairs: [],
    taskTransport: null,
    avReviewTimeline: null,
    waveformWindows: {},
    waveformPyramids: {},
    captionTracks: {},
    editSession: null,
    editHistory: [],
    openCutEditor: null,
    roughCutProposals: {},
    timelineInterchange: null,
    reviewSession: null,
    finalMediaReview: null,
    frameAuditRepairPlan: null,
    sceneCoverageConformanceReport: null,
    finalReviewEvidence: null,
    canvasReviewNotes: [],
    interactions: { pending: [], history: [] },
    toolFailureLedger: {},
    recoveryGate: null,
    fastStart: null,
    runtimeLease: RUNTIME_LEASE_ENABLED ? { instanceId: RUNTIME_INSTANCE_ID, pid: process.pid, heartbeatAt: now } : null,
    decisions: [],
    intakeGate: null,
    intentResolution: null,
    directorDocument: null,
    references: [],
    referenceReplicationPlans: {},
    referenceLearningCandidates: {},
    projectDirectorKnowledge: null,
    cinematicReferenceSelection: null,
    webResearch: null,
    providerApiResearch: null,
    pricingEvidence: [],
    audioResponsibilityPlan: null,
    musicAssets: [],
    musicAssetAudits: {},
    referenceVideoAssessment: null,
    researchAssetPolicy: { requireSearchPlan: true, requireLocalVisuals: true, requireCoverageAudit: true, requireQualityAudit: true },
    assetSearchPlan: null,
    assetQualityAudits: {},
    webImageAcquisitions: [],
    visualAssetCoverage: null,
    assets: [],
    shotGroundingPlan: null,
    shotGroundingReport: null,
    sceneCoveragePlan: null,
    cameraContinuityGraph: null,
    cameraReferenceSelectionPlan: null,
    orchestrationPolicy: { canonicalDxRequired: true, parallelWhenIndependent: true, minimumParallelTasks: 2 },
    subagentOrchestrationPlan: null,
    subagents: [],
    artifacts: {},
    events: [{ id: randomUUID(), sequence: 1, type: "run.created", stage: "intake", at: now, detail: outcome }],
    approvals: [
      { id: "production-budget", kind: "budget", status: "pending" },
      { id: "image-model", kind: "image_model", status: "pending" },
      { id: "video-model", kind: "video_model", status: "pending" },
      { id: "voice-model", kind: "voice_model", status: "pending" },
      { id: "music-strategy", kind: "music_strategy", status: "pending" },
      { id: "final-delivery", kind: "delivery", status: "pending" }
    ],
    canvas: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } },
    createdAt: now,
    updatedAt: now
  };
  const initialCheckpoint = await appendRunCheckpoint({
    projectPath,
    runId: run.runId,
    run,
    reason: "run.created",
    detail: outcome
  });
  run.artifacts[initialCheckpoint.artifactRef] = {
    artifactRef: initialCheckpoint.artifactRef,
    path: initialCheckpoint.path,
    kind: "document",
    stage: "intake",
    registeredAt: now
  };
  await writeAtomic(statePath(projectPath, run.runId), run);
  return run;
}

export async function readRun({ projectPath, runId }) {
  if (!projectPath || !runId) throw new Error("projectPath and runId are required.");
  return normalizeApprovalSchema(JSON.parse(await readFile(statePath(projectPath, runId), "utf8")));
}

function normalizeApprovalSchema(run) {
  run.approvals ??= [];
  run.researchAssetPolicy = { requireSearchPlan: true, requireLocalVisuals: true, requireCoverageAudit: true, requireQualityAudit: true, ...(run.researchAssetPolicy ?? {}) };
  run.assetQualityAudits ??= {};
  run.referenceReplicationPlans ??= {};
  run.referenceLearningCandidates ??= {};
  run.projectDirectorKnowledge ??= null;
  run.cinematicReferenceSelection ??= null;
  run.pricingEvidence ??= [];
  run.audioResponsibilityPlan ??= null;
  run.musicAssets ??= [];
  run.musicAssetAudits ??= {};
  run.shotGroundingPlan ??= null;
  run.shotGroundingReport ??= null;
  run.interactions ??= { pending: [], history: [] };
  run.interactions.pending ??= [];
  run.interactions.history ??= [];
  run.toolFailureLedger ??= {};
  run.recoveryGate ??= null;
  run.fastStart ??= null;
  run.runtimeLease ??= null;
  const legacyIndex = run.approvals.findIndex((approval) => approval.kind === "model");
  if (legacyIndex >= 0) {
    run.approvals.splice(legacyIndex, 1,
      { id: "image-model", kind: "image_model", status: "pending" },
      { id: "video-model", kind: "video_model", status: "pending" },
      { id: "voice-model", kind: "voice_model", status: "pending" });
  }
  const legacyMusicApproval = run.approvals.find((approval) => approval.kind === "music_route");
  if (legacyMusicApproval && !run.approvals.some((approval) => approval.kind === "music_strategy")) {
    legacyMusicApproval.id = "music-strategy";
    legacyMusicApproval.kind = "music_strategy";
  }
  if (!run.approvals.some((approval) => approval.kind === "music_strategy")) {
    const deliveryIndex = run.approvals.findIndex((approval) => approval.kind === "delivery");
    const voiceIndex = run.approvals.findIndex((approval) => approval.kind === "voice_model");
    const insertAt = deliveryIndex >= 0 ? deliveryIndex : voiceIndex >= 0 ? voiceIndex + 1 : run.approvals.length;
    run.approvals.splice(insertAt, 0, { id: "music-strategy", kind: "music_strategy", status: "pending" });
  }
  return run;
}

export async function updateRun({ projectPath, runId, mutate }) {
  const path = statePath(projectPath, runId);
  return serialize(path, async () => {
    const run = await readRun({ projectPath, runId });
    if (RUNTIME_LEASE_ENABLED) claimRuntimeLease(run);
    const next = await mutate(structuredClone(run));
    if (RUNTIME_LEASE_ENABLED) next.runtimeLease = { instanceId: RUNTIME_INSTANCE_ID, pid: process.pid, heartbeatAt: new Date().toISOString() };
    assertSecretFree(next);
    next.updatedAt = new Date().toISOString();
    await writeAtomic(path, next);
    return next;
  });
}

function claimRuntimeLease(run) {
  const lease = run.runtimeLease;
  if (!lease || lease.instanceId === RUNTIME_INSTANCE_ID) return;
  if (processIsAlive(lease.pid)) throw new Error(`Director X Run is owned by another active MCP runtime (pid ${lease.pid}). Reuse the existing runtime instead of starting an auxiliary process.`);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

export function publicSnapshot(run) {
  return {
    runId: run.runId,
    goal: run.goal,
    completionPolicy: run.completionPolicy,
    status: run.status,
    stage: run.stage,
    pipeline: run.pipeline ?? null,
    capabilityRoute: run.capabilityRoute ?? null,
    toolInventory: run.toolInventory ?? null,
    hostCapabilities: run.hostCapabilities ?? null,
    capabilityExecutionPlan: run.capabilityExecutionPlan ?? null,
    executionTelemetry: run.executionTelemetry ?? null,
    providerCapacity: run.providerCapacity ?? {},
    providerAdapters: run.providerAdapters ?? {},
    routeFeedback: run.routeFeedback ?? null,
    modelKnowledgePatch: run.modelKnowledgePatch ?? null,
    productionLineage: run.productionLineage ?? {},
    knowledgeDecisions: run.knowledgeDecisions ?? [],
    acceptedModelKnowledge: run.acceptedModelKnowledge ?? null,
    benchmarkSuites: run.benchmarkSuites ?? {},
    benchmarkVerifierReceipts: run.benchmarkVerifierReceipts ?? {},
    benchmarkTrials: run.benchmarkTrials ?? [],
    benchmarkReports: run.benchmarkReports ?? {},
    benchmarkSchedules: run.benchmarkSchedules ?? {},
    benchmarkBaselineDecisions: run.benchmarkBaselineDecisions ?? [],
    observabilityTrace: run.observabilityTrace ?? null,
    runMode: run.runMode ?? null,
    stageApprovals: run.stageApprovals ?? {},
    checkpoints: run.checkpoints ?? [],
    providerCapabilities: run.providerCapabilities ?? {},
    repairs: run.repairs ?? [],
    taskTransport: run.taskTransport ?? null,
    executionGraph: run.executionGraph ?? null,
    mediaEvidenceIndexes: run.mediaEvidenceIndexes ?? {},
    videoEvidenceQueries: run.videoEvidenceQueries ?? {},
    editSession: run.editSession ?? null,
    editHistory: run.editHistory ?? [],
    openCutEditor: run.openCutEditor ?? null,
    roughCutProposals: run.roughCutProposals ?? {},
    timelineInterchange: run.timelineInterchange ?? null,
    reviewSession: run.reviewSession ?? null,
    finalMediaReview: run.finalMediaReview ?? null,
    frameAuditRepairPlan: run.frameAuditRepairPlan ?? null,
    sceneCoverageConformanceReport: run.sceneCoverageConformanceReport ?? null,
    finalReviewEvidence: run.finalReviewEvidence ?? null,
    canvasReviewNotes: run.canvasReviewNotes ?? [],
    referenceLearningCandidates: run.referenceLearningCandidates ?? {},
    projectDirectorKnowledge: run.projectDirectorKnowledge ?? null,
    interactions: run.interactions ?? { pending: [], history: [] },
    toolFailureLedger: run.toolFailureLedger ?? {},
    recoveryGate: run.recoveryGate ?? null,
    fastStart: run.fastStart ?? null,
    creativeProgressSla: evaluateCreativeProgressSla(run),
    avReviewTimeline: run.avReviewTimeline ?? null,
    waveformWindows: run.waveformWindows ?? {},
    waveformPyramids: run.waveformPyramids ?? {},
    captionTracks: run.captionTracks ?? {},
    layeredCollagePlan: run.layeredCollagePlan ?? null,
    layeredCollageReviews: run.layeredCollageReviews ?? {},
    cameraContinuityGraph: run.cameraContinuityGraph ?? null,
    cameraReferenceSelectionPlan: run.cameraReferenceSelectionPlan ?? null,
    approvals: run.approvals,
    decisions: run.decisions,
    intakeGate: run.intakeGate ?? null,
    intentResolution: run.intentResolution ?? null,
    directorDocument: run.directorDocument ?? null,
    references: run.references ?? [],
    referenceReplicationPlans: run.referenceReplicationPlans ?? {},
    webResearch: run.webResearch ?? null,
    providerApiResearch: run.providerApiResearch ?? null,
    pricingEvidence: run.pricingEvidence ?? [],
    audioResponsibilityPlan: run.audioResponsibilityPlan ?? null,
    musicAssets: run.musicAssets ?? [],
    musicAssetAudits: run.musicAssetAudits ?? {},
    referenceVideoAssessment: run.referenceVideoAssessment ?? null,
    researchAssetPolicy: run.researchAssetPolicy ?? null,
    assetSearchPlan: run.assetSearchPlan ?? null,
    assetQualityAudits: run.assetQualityAudits ?? {},
    webImageAcquisitions: run.webImageAcquisitions ?? [],
    visualAssetCoverage: run.visualAssetCoverage ?? null,
    assets: run.assets ?? [],
    shotGroundingPlan: run.shotGroundingPlan ?? null,
    shotGroundingReport: run.shotGroundingReport ?? null,
    sceneCoveragePlan: run.sceneCoveragePlan ?? null,
    productionComplexityPlan: run.productionComplexityPlan ?? null,
    orchestrationPolicy: run.orchestrationPolicy ?? null,
    subagentOrchestrationPlan: publicSubagentPlan(run.subagentOrchestrationPlan),
    subagents: (run.subagents ?? []).map(publicSubagentRecord),
    generation: run.generation ?? null,
    completionCheck: run.completionCheck ?? null,
    artifacts: run.artifacts ?? {},
    userFacingSummary: buildUserFacingRunSummary(run),
    latestSequence: run.events.at(-1)?.sequence ?? 0,
    events: run.events.slice(-50),
    canvas: run.canvas ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } },
    updatedAt: run.updatedAt
  };
}

function publicSubagentPlan(plan) {
  if (!plan) return null;
  return { ...plan, tasks: (plan.tasks ?? []).map(publicSubagentRecord) };
}

function publicSubagentRecord(record) {
  const { hostNickname: _hostNickname, ...safe } = record;
  return safe;
}
