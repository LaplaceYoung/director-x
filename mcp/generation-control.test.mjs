import test from "node:test";
import assert from "node:assert/strict";
import { beginGenerationAttempt, generationArtifactValues, recordGenerationCandidate, registerGenerationPlan, reviewGenerationCandidate, selectGenerationCandidate } from "./generation-control.mjs";
import { quoteModelCost } from "./pricing-catalog.mjs";

function run() {
  const pricingQuote = quoteModelCost({ providerId: "openai", modelId: "gpt-image-1.5", mediaType: "image", usage: { outputCount: 1, quality: "high", resolution: "1024x1024" } });
  return { runId: "dx-test", approvals: [{ kind: "budget", status: "approved" }, { kind: "image_model", status: "approved" }, { kind: "video_model", status: "approved" }, { kind: "voice_model", status: "approved" }, { kind: "music_route", status: "approved" }], decisions: [{ kind: "budget", value: { basis: "official_quotes", currency: "USD", cap: 2, routes: [{ providerId: "openai", modelId: "gpt-image-1.5", mediaType: "image", plannedCalls: 2, pricingQuote }] } }, { kind: "image_model", value: { providerId: "openai", modelId: "gpt-image-1.5" } }, { kind: "video_model", value: { providerId: "openai", modelId: "gpt-image-1.5" } }, { kind: "voice_model", value: { providerId: "mosi.tts", modelId: "moss-tts" } }, { kind: "music_route", value: { route: "none" } }], providerCapabilities: { "openai:gpt-image-1.5": { providerId: "openai", modelId: "gpt-image-1.5", status: "available", capabilities: ["image", "image_to_video"], evidence: "provider capability", probedAt: new Date().toISOString() } }, directorDocument: {}, artifacts: { "research_plan.json": {} }, pipeline: { stageStates: { generation: { status: "active" } } } };
}

function plan() {
  return { generationRequestId: "GEN-1", currency: "USD", providerId: "openai", modelId: "gpt-image-1.5", credentialRef: null, requests: [{ requestId: "REQ-1", shotId: "S01", mode: "image", durationSeconds: 0, promptLayers: { subject: "product" }, negativeConstraints: ["text artifacts"], providerParameters: {}, inputAnchorAssets: [], outputAnchorAssets: [], carryForwardRules: ["preserve product"], reviewCriteria: ["product geometry"], repairPrompts: ["restore geometry"], maxAttempts: 2, maxCost: 1, attemptCostCap: .3, qualityThreshold: 0.8 }] };
}

test("runs a bounded generation candidate through review and selection", () => {
  const state = registerGenerationPlan(run(), plan());
  beginGenerationAttempt(state, { requestId: "REQ-1", attemptId: "ATT-1", pricingUsage: { outputCount: 1, quality: "high", resolution: "1024x1024" }, prompt: "hero product", providerOptions: {} });
  recordGenerationCandidate(state, { requestId: "REQ-1", attemptId: "ATT-1", candidateId: "CAN-1", assetRef: "candidate.png", previewUri: "candidate.png", mediaType: "image", actualCost: .133 });
  reviewGenerationCandidate(state, { requestId: "REQ-1", candidateId: "CAN-1", scores: { promptMatch: .9, visualQuality: .9, continuity: .8, motion: .8, editFit: .85 }, decision: "accept", reason: "Meets the hero-shot bar", failureType: null, promptDelta: null });
  selectGenerationCandidate(state, { requestId: "REQ-1", candidateId: "CAN-1" });
  assert.equal(state.generation.requests[0].status, "selected");
  assert.equal(state.generation.totalActualCost, .133);
  const artifacts = generationArtifactValues("dx-test", state.generation);
  assert.equal(artifacts["selected_clips.json"].clips[0].asset_ref, "candidate.png");
  assert.equal(artifacts["attempt_log.json"].attempts[0].decision, "accept");
});

test("blocks attempts that exceed shot caps", () => {
  const state = registerGenerationPlan(run(), plan());
  state.generation.requests[0].attemptCostCap = .1;
  assert.throws(() => beginGenerationAttempt(state, { requestId: "REQ-1", attemptId: "ATT-1", pricingUsage: { outputCount: 1, quality: "high", resolution: "1024x1024" }, prompt: "x", providerOptions: {} }), /per-attempt cap/);
});

test("enforces the complexity draw-loop cap instead of treating it as advisory", () => {
  const state = run();
  state.productionComplexityPlan = { profile: "quick", settings: { candidateCapPerShot: 2 } };
  const overplanned = plan();
  overplanned.requests[0].maxAttempts = 3;
  assert.throws(() => registerGenerationPlan(state, overplanned), /quick production complexity cap of 2/);
  overplanned.requests[0].maxAttempts = 2;
  assert.doesNotThrow(() => registerGenerationPlan(state, overplanned));
});

test("blocks an unapproved provider or model route", () => {
  const changed = plan(); changed.modelId = "other-model";
  assert.throws(() => registerGenerationPlan(run(), changed), /does not match the user-approved model/);
});

test("requires the modality-specific model decision before generation", () => {
  const imageRun = run();
  imageRun.approvals.find((item) => item.kind === "image_model").status = "pending";
  assert.throws(() => registerGenerationPlan(imageRun, plan()), /image_model/);
  const videoRun = run();
  videoRun.approvals.find((item) => item.kind === "video_model").status = "pending";
  const videoPlan = plan(); videoPlan.requests[0].mode = "image_to_video";
  assert.throws(() => registerGenerationPlan(videoRun, videoPlan), /video_model/);
  const missingDecision = run();
  missingDecision.decisions = missingDecision.decisions.filter((item) => item.kind !== "image_model");
  assert.throws(() => registerGenerationPlan(missingDecision, plan()), /confirmed exact providerId and modelId/);
});

test("prefers the modality-specific provider over a stale generic provider decision", () => {
  const state = run();
  state.decisions.push({ kind: "provider", value: { providerId: "legacy-provider" } });
  assert.doesNotThrow(() => registerGenerationPlan(state, plan()));
});

test("blocks generation before a pipeline reaches the active generation stage", () => {
  const state = run(); state.pipeline = null;
  assert.throws(() => registerGenerationPlan(state, plan()), /Select a Director X pipeline/);
  state.pipeline = { stageStates: { generation: { status: "pending" } } };
  assert.throws(() => registerGenerationPlan(state, plan()), /must be active/);
});

test("does not accept a candidate below its quality threshold", () => {
  const state = registerGenerationPlan(run(), plan());
  beginGenerationAttempt(state, { requestId: "REQ-1", attemptId: "ATT-1", pricingUsage: { outputCount: 1, quality: "high", resolution: "1024x1024" }, prompt: "x", providerOptions: {} });
  recordGenerationCandidate(state, { requestId: "REQ-1", attemptId: "ATT-1", candidateId: "CAN-1", assetRef: "candidate.png", previewUri: "candidate.png", mediaType: "image", actualCost: .133 });
  assert.throws(() => reviewGenerationCandidate(state, { requestId: "REQ-1", candidateId: "CAN-1", scores: { promptMatch: .5, visualQuality: .5, continuity: .5, motion: .5, editFit: .5 }, decision: "accept", reason: "", failureType: "provider_weakness", promptDelta: "simplify" }), /below threshold/);
});

test("requires timecoded evidence and critical video dimensions", () => {
  const videoPlan = plan();
  videoPlan.requests[0].mode = "image_to_video";
  videoPlan.modelId = "sora-2";
  videoPlan.requests[0].durationSeconds = 4;
  videoPlan.requests[0].attemptCostCap = .5;
  const stateRun = run();
  stateRun.decisions.find((item) => item.kind === "video_model").value = { providerId: "openai", modelId: "sora-2" };
  const videoQuote = quoteModelCost({ providerId: "openai", modelId: "sora-2", mediaType: "video", usage: { durationSeconds: 4, resolution: "720p", generateAudio: true } });
  stateRun.decisions.find((item) => item.kind === "budget").value = { basis: "official_quotes", currency: "USD", cap: 2, routes: [{ providerId: "openai", modelId: "sora-2", mediaType: "video", plannedCalls: 1, pricingQuote: videoQuote }] };
  stateRun.providerCapabilities["openai:sora-2"] = { providerId: "openai", modelId: "sora-2", status: "available", capabilities: ["image_to_video"], evidence: "provider capability", probedAt: new Date().toISOString() };
  const state = registerGenerationPlan(stateRun, videoPlan);
  beginGenerationAttempt(state, { requestId: "REQ-1", attemptId: "ATT-1", pricingUsage: { durationSeconds: 4, resolution: "720p", generateAudio: true }, prompt: "x", providerOptions: {} });
  recordGenerationCandidate(state, { requestId: "REQ-1", attemptId: "ATT-1", candidateId: "CAN-1", assetRef: "candidate.mp4", previewUri: "candidate.mp4", mediaType: "video", actualCost: .4 });
  const scores = { promptMatch: .9, visualQuality: .9, continuity: .9, motion: .9, editFit: .9, worldConsistency: .9, actionCompleteness: .9, audioVisualSync: .8 };
  assert.throws(() => reviewGenerationCandidate(state, { requestId: "REQ-1", candidateId: "CAN-1", scores, evidence: [], defects: [], decision: "accept", reason: "looks good" }), /timecoded evidence/);
  scores.actionCompleteness = .4;
  assert.throws(() => reviewGenerationCandidate(state, { requestId: "REQ-1", candidateId: "CAN-1", scores, evidence: [{ timeSeconds: 1.2, frameRef: "frame-0012.jpg", dimension: "actionCompleteness", observation: "gesture stops early" }], defects: [], decision: "accept", reason: "average is high" }), /critical dimension/);
});
