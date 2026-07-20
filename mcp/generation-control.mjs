import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertProviderCapability } from "./provider-capabilities.mjs";
import { providerJobArtifact } from "./provider-jobs.mjs";
import { assertGenerationPlanUsesBoundaryFrames } from "./segment-continuity.mjs";
import { assertGenerationAnchorsAudited } from "./asset-retrieval.mjs";
import { assertGenerationPlanUsesCameraContinuity } from "./camera-continuity-graph.mjs";
import { assertQuoteApprovedByBudget, quoteModelCost } from "./pricing-catalog.mjs";
import { assertInitialPromptBinding, hydrateInitialPromptBinding } from "./prompt-bound-generation-plan.mjs";

const REVIEW_DECISIONS = new Set(["accept", "retry", "reroute", "add_reference", "split", "simplify", "request_approval", "terminate"]);

export function registerGenerationPlan(run, plan) {
  requireApproved(run, "budget");
  const modelKind = generationModelKind(plan.requests ?? []);
  requireApproved(run, modelKind);
  requireActivePipelineStage(run, "generation");
  requireConfirmedRoute(run, plan, modelKind);
  assertProviderCapability(run, plan);
  if (!run.directorDocument) throw new Error("Generate Director.md before registering generation work.");
  if (!run.artifacts?.["research_plan.json"]) throw new Error("Finalize research before registering generation work.");
  if (!plan.requests?.length) throw new Error("At least one generation request is required.");
  assertGenerationPlanUsesCameraContinuity(run, plan);
  assertGenerationPlanUsesBoundaryFrames(run, plan);
  assertGenerationAnchorsAudited(run, plan.requests);

  const requestIds = new Set();
  const complexityAttemptCap = run.productionComplexityPlan?.settings?.candidateCapPerShot;
  for (const request of plan.requests) {
    if (requestIds.has(request.requestId)) throw new Error(`Duplicate generation request: ${request.requestId}`);
    requestIds.add(request.requestId);
    assertPositive(request.maxAttempts, `${request.requestId}.maxAttempts`);
    if (Number.isInteger(complexityAttemptCap) && request.maxAttempts > complexityAttemptCap) {
      throw new Error(`${request.requestId}.maxAttempts exceeds the ${run.productionComplexityPlan.profile} production complexity cap of ${complexityAttemptCap}; reclassify the production instead of silently expanding the draw loop.`);
    }
    assertPositive(request.maxCost, `${request.requestId}.maxCost`);
    assertPositive(request.attemptCostCap, `${request.requestId}.attemptCostCap`);
    assertScore(request.qualityThreshold, `${request.requestId}.qualityThreshold`);
    if (request.attemptCostCap > request.maxCost) throw new Error(`${request.requestId}.attemptCostCap cannot exceed maxCost.`);
  }

  run.generation = {
    generationRequestId: plan.generationRequestId,
    currency: plan.currency,
    providerId: plan.providerId,
    modelId: plan.modelId,
    credentialRef: plan.credentialRef ?? null,
    sourcePromptPackBinding: plan.sourcePromptPackBinding ?? null,
    bindingSha256: plan.bindingSha256 ?? null,
    requests: plan.requests.map((request) => ({ ...request, status: "planned", spent: 0, attemptCount: 0, selectedCandidateId: null })),
    attempts: [],
    candidates: [],
    totalEstimatedCost: 0,
    totalActualCost: 0,
    createdAt: new Date().toISOString()
  };
  return run;
}

function requireActivePipelineStage(run, stageId) {
  if (!run.pipeline) throw new Error(`Select a Director X pipeline before beginning ${stageId}.`);
  const status = run.pipeline.stageStates?.[stageId]?.status;
  if (status !== "active") throw new Error(`Pipeline stage ${stageId} must be active before generation work begins; current status is ${status ?? "missing"}.`);
}

export function beginGenerationAttempt(run, input) {
  const generation = requireGeneration(run);
  const request = findRequest(generation, input.requestId);
  const resolvedInput = hydrateInitialPromptBinding(request, input);
  if (!resolvedInput.prompt?.trim()) throw new Error("Generation attempts require a prompt.");
  if (!resolvedInput.providerOptions || typeof resolvedInput.providerOptions !== "object" || Array.isArray(resolvedInput.providerOptions)) throw new Error("Generation attempts require providerOptions.");
  assertInitialPromptBinding(request, resolvedInput);
  if (request.selectedCandidateId) throw new Error(`${input.requestId} already has a selected candidate.`);
  if (request.attemptCount >= request.maxAttempts) throw new Error(`${input.requestId} reached its maximum attempt count.`);
  const mediaType = request.mode === "image" ? "image" : "video";
  const pricingUsage = {
    ...(resolvedInput.pricingUsage ?? {}),
    durationSeconds: resolvedInput.pricingUsage?.durationSeconds ?? request.durationSeconds,
    outputCount: resolvedInput.pricingUsage?.outputCount ?? resolvedInput.providerOptions?.outputCount ?? resolvedInput.providerOptions?.n ?? 1,
    quality: resolvedInput.pricingUsage?.quality ?? resolvedInput.providerOptions?.quality,
    resolution: resolvedInput.pricingUsage?.resolution ?? resolvedInput.providerOptions?.resolution ?? resolvedInput.providerOptions?.size,
    generateAudio: resolvedInput.pricingUsage?.generateAudio ?? resolvedInput.providerOptions?.generateAudio ?? resolvedInput.providerOptions?.generate_audio ?? false
  };
  const pricingQuote = quoteModelCost({
    providerId: generation.providerId,
    modelId: generation.modelId,
    mediaType,
    usage: pricingUsage,
    pricingEvidence: run.pricingEvidence
  });
  if (pricingQuote.currency !== generation.currency) throw new Error(`Generation plan currency ${generation.currency} does not match official pricing currency ${pricingQuote.currency}.`);
  const estimatedCost = pricingQuote.amount;
  const approvedBudget = [...(run.decisions ?? [])].reverse().find((decision) => decision.kind === "budget")?.value;
  assertQuoteApprovedByBudget(approvedBudget, pricingQuote);
  if (approvedBudget?.basis === "official_quotes") {
    if (approvedBudget.currency !== pricingQuote.currency) throw new Error("The official model quote currency does not match the approved project budget.");
    if (generation.totalEstimatedCost + estimatedCost > approvedBudget.cap) throw new Error("The official model quote exceeds the remaining approved project budget.");
  }
  if (estimatedCost > request.attemptCostCap) throw new Error(`Official price quote exceeds the per-attempt cap for ${input.requestId}.`);
  if (request.spent + estimatedCost > request.maxCost) throw new Error(`Official price quote exceeds the remaining shot budget for ${input.requestId}.`);
  if (generation.attempts.some((attempt) => attempt.attemptId === input.attemptId)) throw new Error(`Duplicate attempt: ${input.attemptId}`);

  request.attemptCount += 1;
  request.status = "generating";
  generation.totalEstimatedCost += estimatedCost;
  generation.attempts.push({
    requestId: input.requestId,
    attemptId: input.attemptId,
    estimatedCost,
    pricingQuote,
    prompt: resolvedInput.prompt,
    providerOptions: resolvedInput.providerOptions,
    attemptNo: request.attemptCount,
    status: "running",
    actualCost: null,
    candidateIds: [],
    startedAt: new Date().toISOString(),
    completedAt: null
  });
  return run;
}

export function recordGenerationCandidate(run, input) {
  const generation = requireGeneration(run);
  const request = findRequest(generation, input.requestId);
  const attempt = generation.attempts.find((item) => item.attemptId === input.attemptId && item.requestId === input.requestId);
  if (!attempt) throw new Error(`Unknown attempt ${input.attemptId} for ${input.requestId}.`);
  if (attempt.status !== "running") throw new Error(`Attempt ${input.attemptId} is not running.`);
  if (input.providerJobId) {
    const job = generation.providerJobs?.find((item) => item.providerJobId === input.providerJobId && item.attemptId === input.attemptId);
    if (!job || job.status !== "succeeded") throw new Error("Reconcile the provider job to succeeded before recording its candidate.");
  }
  if (generation.candidates.some((candidate) => candidate.candidateId === input.candidateId)) throw new Error(`Duplicate candidate: ${input.candidateId}`);
  assertPositive(input.actualCost, "actualCost", true);
  if (input.actualCost > request.attemptCostCap) throw new Error(`Actual cost exceeds the per-attempt cap for ${input.requestId}; request approval before recording it.`);
  if (request.spent + input.actualCost > request.maxCost) throw new Error(`Actual cost exceeds the shot budget for ${input.requestId}; request approval before recording it.`);

  request.spent += input.actualCost;
  request.status = "awaiting_review";
  generation.totalActualCost += input.actualCost;
  attempt.actualCost = input.actualCost;
  attempt.status = "completed";
  attempt.completedAt = new Date().toISOString();
  attempt.candidateIds.push(input.candidateId);
  generation.candidates.push({
    requestId: input.requestId,
    attemptId: input.attemptId,
    candidateId: input.candidateId,
    assetRef: input.assetRef,
    previewUri: input.previewUri,
    mediaType: input.mediaType,
    actualCost: input.actualCost,
    providerResultId: input.providerResultId ?? null,
    providerJobId: input.providerJobId ?? null,
    status: "awaiting_review",
    scores: null,
    decision: null,
    reviewReason: null,
    reviewedAt: null,
    selectedAt: null
  });
  return run;
}

export function reviewGenerationCandidate(run, input) {
  const generation = requireGeneration(run);
  const request = findRequest(generation, input.requestId);
  const candidate = generation.candidates.find((item) => item.candidateId === input.candidateId && item.requestId === input.requestId);
  if (!candidate) throw new Error(`Unknown candidate ${input.candidateId} for ${input.requestId}.`);
  if (!REVIEW_DECISIONS.has(input.decision)) throw new Error(`Unsupported review decision: ${input.decision}`);
  for (const [name, score] of Object.entries(input.scores)) assertScore(score, name);
  const evidence = input.evidence ?? [];
  if (candidate.mediaType === "video" && evidence.length === 0) throw new Error("Video review requires timecoded evidence frames or intervals.");
  for (const item of evidence) {
    if (!Number.isFinite(item.timeSeconds) || item.timeSeconds < 0) throw new Error("Review evidence timeSeconds must be zero or greater.");
    if (!item.dimension || !item.observation || !item.frameRef) throw new Error("Review evidence requires dimension, observation, and frameRef.");
  }
  const criticalDimensions = candidate.mediaType === "video" ? ["promptMatch", "visualQuality", "continuity", "motion", "editFit", "worldConsistency", "actionCompleteness"] : Object.keys(input.scores);
  const missingDimensions = criticalDimensions.filter((name) => !Number.isFinite(input.scores[name]));
  if (missingDimensions.length) throw new Error(`Review is missing critical dimensions: ${missingDimensions.join(", ")}.`);
  const qualityScore = average(criticalDimensions.map((name) => input.scores[name]));
  const criticalFloor = Math.min(...criticalDimensions.map((name) => input.scores[name]));
  if (input.decision === "accept" && qualityScore < request.qualityThreshold) {
    throw new Error(`Candidate quality ${qualityScore.toFixed(3)} is below threshold ${request.qualityThreshold}; use retry, reroute, simplify, or request_approval.`);
  }
  if (input.decision === "accept" && criticalFloor < 0.5) throw new Error(`Candidate has a critical dimension below 0.5; repair or reroute instead of averaging the defect away.`);

  candidate.scores = input.scores;
  candidate.qualityScore = qualityScore;
  candidate.criticalFloor = criticalFloor;
  candidate.evidence = evidence;
  candidate.defects = input.defects ?? [];
  candidate.decision = input.decision;
  candidate.reviewReason = input.reason;
  candidate.failureType = input.failureType ?? null;
  candidate.promptDelta = input.promptDelta ?? null;
  candidate.status = input.decision === "accept" ? "accepted" : input.decision === "terminate" ? "rejected" : "needs_action";
  candidate.reviewedAt = new Date().toISOString();
  request.status = input.decision === "accept" ? "reviewed" : input.decision === "terminate" ? "stopped" : input.decision;
  return run;
}

export function selectGenerationCandidate(run, input) {
  const generation = requireGeneration(run);
  const request = findRequest(generation, input.requestId);
  const candidate = generation.candidates.find((item) => item.candidateId === input.candidateId && item.requestId === input.requestId);
  if (!candidate) throw new Error(`Unknown candidate ${input.candidateId} for ${input.requestId}.`);
  if (candidate.decision !== "accept") throw new Error("Only a reviewed and accepted candidate can be selected.");
  for (const item of generation.candidates.filter((entry) => entry.requestId === input.requestId)) {
    if (item.candidateId !== input.candidateId && item.status === "selected") item.status = "accepted";
  }
  candidate.status = "selected";
  candidate.selectedAt = new Date().toISOString();
  request.selectedCandidateId = input.candidateId;
  request.status = "selected";
  return run;
}

export async function writeGenerationArtifacts({ projectPath, runId, generation }) {
  const dir = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(dir, { recursive: true });
  const artifacts = generationArtifactValues(runId, generation);
  const results = {};
  for (const [artifactRef, value] of Object.entries(artifacts)) {
    const path = join(dir, artifactRef);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    results[artifactRef] = { artifactRef, path };
  }
  return results;
}

export function generationArtifactValues(runId, generation) {
  const source = runId;
  return {
    "provider_jobs.json": providerJobArtifact(runId, generation),
    "generation_request.json": {
      generation_request_id: generation.generationRequestId,
      source_artifact_run_id: source,
      provider_agnostic_requests: generation.requests.map((request) => ({
        request_id: request.requestId, shot_id: request.shotId, mode: request.mode, duration_seconds: request.durationSeconds,
        prompt_layers: request.promptLayers, negative_constraints: request.negativeConstraints, provider_parameters: request.providerParameters,
        provider_mode: request.providerMode ?? null, prompt_binding: request.promptBinding ?? null,
        camera_graph_node_id: request.cameraGraphNodeId ?? null, reference_target_ids: request.referenceTargetIds ?? []
      })),
      source_prompt_pack_binding: generation.sourcePromptPackBinding ?? null,
      binding_sha256: generation.bindingSha256 ?? null,
      sequence_continuity: generation.requests.map((request) => ({ shot_id: request.shotId, input_anchor_assets: request.inputAnchorAssets, output_anchor_assets: request.outputAnchorAssets, carry_forward_rules: request.carryForwardRules })),
      prompt_pack: generation.requests.map((request) => ({ request_id: request.requestId, review_criteria: request.reviewCriteria, repair_prompts: request.repairPrompts })),
      review_rubric: { score_range: [0, 1], dimensions: ["prompt_match", "visual_quality", "continuity", "motion", "edit_fit", "world_consistency", "action_completeness", "audio_visual_sync"], acceptance: "mean threshold plus every critical dimension >= 0.5", evidence_required_for_video: true }
    },
    "attempt_log.json": {
      attempts: generation.attempts.map((attempt) => {
        const candidate = generation.candidates.find((item) => item.attemptId === attempt.attemptId);
        const request = generation.requests.find((item) => item.requestId === attempt.requestId);
        return { attempt_no: attempt.attemptNo, request_id: attempt.requestId, shot_id: request.shotId, provider_id: generation.providerId, model_id: generation.modelId, pricing_quote_id: attempt.pricingQuote?.quoteId ?? null, pricing_source_url: attempt.pricingQuote?.sourceUrl ?? null, pricing_verified_at: attempt.pricingQuote?.verifiedAt ?? null, quality_score: candidate?.qualityScore ?? 0, threshold: request.qualityThreshold, cost_estimate: attempt.estimatedCost, cost_actual: attempt.actualCost ?? 0, failure_type: candidate?.failureType ?? null, decision: candidate?.decision ?? attempt.status, candidate_ids: attempt.candidateIds };
      })
    },
    "shot_review_report.json": {
      reviews: generation.candidates.filter((candidate) => candidate.reviewedAt).map((candidate) => ({ candidate_id: candidate.candidateId, shot_id: generation.requests.find((item) => item.requestId === candidate.requestId).shotId, quality_score: candidate.qualityScore, critical_floor: candidate.criticalFloor, scores: candidate.scores, evidence: candidate.evidence ?? [], defects: candidate.defects ?? [], budget_impact: candidate.actualCost, decision: candidate.decision, reason: candidate.reviewReason, prompt_delta: candidate.promptDelta }))
    },
    "selected_clips.json": {
      clips: generation.candidates.filter((candidate) => candidate.status === "selected").map((candidate) => ({ shot_id: generation.requests.find((item) => item.requestId === candidate.requestId).shotId, candidate_id: candidate.candidateId, asset_ref: candidate.assetRef, selected_reason: candidate.reviewReason, source_attempt: candidate.attemptId, review_score: candidate.qualityScore }))
    }
  };
}

function requireApproved(run, kind) {
  if (run.approvals?.find((approval) => approval.kind === kind)?.status !== "approved") throw new Error(`User approval required for ${kind} before generation planning.`);
}
function requireConfirmedRoute(run, plan, modelKind) {
  const decisions = [...(run.decisions ?? [])].reverse();
  const modelDecision = decisions.find((decision) => decision.kind === modelKind)?.value ?? {};
  if (modelDecision.notUsed === true || modelDecision.not_used === true) throw new Error(`${modelKind} was confirmed as not used; approve a concrete provider and model before registering this plan.`);
  const providerDecision = decisions.find((decision) => decision.kind === "provider")?.value ?? {};
  const approvedModel = modelDecision.modelId ?? modelDecision.model_id;
  const approvedProvider = modelDecision.providerId ?? modelDecision.provider_id ?? providerDecision.providerId ?? providerDecision.provider_id;
  if (!approvedModel || !approvedProvider) throw new Error(`${modelKind} requires a confirmed exact providerId and modelId before generation planning.`);
  if (approvedModel && approvedModel !== plan.modelId) throw new Error(`Generation model ${plan.modelId} does not match the user-approved model ${approvedModel}.`);
  if (approvedProvider && approvedProvider !== plan.providerId) throw new Error(`Generation provider ${plan.providerId} does not match the user-approved provider ${approvedProvider}.`);
}
function generationModelKind(requests) {
  const kinds = new Set(requests.map((request) => request.mode === "image" ? "image_model" : "video_model"));
  if (kinds.size !== 1) throw new Error("Split image and video generation into separate modality-specific plans with independently approved models.");
  return [...kinds][0];
}
function requireGeneration(run) { if (!run.generation) throw new Error("Register a generation plan first."); return run.generation; }
function findRequest(generation, requestId) { const request = generation.requests.find((item) => item.requestId === requestId); if (!request) throw new Error(`Unknown generation request: ${requestId}`); return request; }
function assertPositive(value, label, allowZero = false) { if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${label} must be ${allowZero ? "zero or greater" : "greater than zero"}.`); }
function assertScore(value, label) { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1.`); }
function average(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
