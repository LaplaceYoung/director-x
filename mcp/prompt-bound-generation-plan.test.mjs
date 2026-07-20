import assert from "node:assert/strict";
import test from "node:test";
import { assertInitialPromptBinding, assertPromptBoundSubmission, compilePromptBoundGenerationPlan, hashValue, hydrateInitialPromptBinding } from "./prompt-bound-generation-plan.mjs";

function fixture() {
  const pack = {
    status: "ready", packId: "pack-1",
    routes: [{ routeId: "image-route", providerId: "black-forest-labs", modelId: "flux-2-pro", mode: "text_to_image" }],
    prompts: [{
      shotId: "S01", routeId: "image-route", mode: "text_to_image", purpose: "hero", durationSeconds: 1,
      positivePrompt: "A precise product hero image.", negativePrompt: null,
      referenceInputs: { firstFrameRef: null, lastFrameRef: null, referenceAssetRefs: ["asset:product"] },
      continuityKeys: ["product geometry"], generationStrategy: { promptDialect: "flux2_subject_first_positive_constraints" },
      executionContract: null, audioResponsibility: { speech: "external_or_none" }, reviewCriteria: ["geometry"], repairTargets: ["identity"]
    }]
  };
  const sha256 = hashValue(pack);
  return { visualPromptPack: pack, artifacts: { "visual_prompt_pack.json": { sha256 } }, sha256 };
}

function input(sha256) {
  return {
    generationRequestId: "GEN-1", currency: "USD", routeId: "image-route", promptPackSha256: sha256,
    requests: [{ requestId: "REQ-1", shotId: "S01", providerParameters: { size: "1024x1024" }, outputAnchorAssets: ["hero-image"], maxAttempts: 2, maxCost: 1, attemptCostCap: 0.5, qualityThreshold: 0.8 }]
  };
}

test("compiles generation requests directly from a verified visual prompt pack", () => {
  const run = fixture();
  const plan = compilePromptBoundGenerationPlan(run, input(run.sha256));
  assert.equal(plan.providerId, "black-forest-labs");
  assert.equal(plan.requests[0].mode, "image");
  assert.equal(plan.requests[0].providerMode, "text_to_image");
  assert.equal(plan.requests[0].promptLayers.positivePrompt, "A precise product hero image.");
  assert.deepEqual(plan.requests[0].inputAnchorAssets, ["asset:product"]);
  assert.equal(plan.requests[0].promptBinding.promptPackSha256, run.sha256);
  assert.match(plan.bindingSha256, /^[a-f0-9]{64}$/);
});

test("requires exact route coverage and current prompt-pack identity", () => {
  const run = fixture();
  assert.throws(() => compilePromptBoundGenerationPlan(run, { ...input(run.sha256), promptPackSha256: "0".repeat(64) }), /changed after verification/);
  assert.throws(() => compilePromptBoundGenerationPlan(run, { ...input(run.sha256), requests: [] }), /cover every and only shot/);
});

test("blocks initial prompt and provider-option drift", () => {
  const run = fixture();
  const request = compilePromptBoundGenerationPlan(run, input(run.sha256)).requests[0];
  request.attemptCount = 0;
  assert.doesNotThrow(() => assertInitialPromptBinding(request, { prompt: "A precise product hero image.", providerOptions: { size: "1024x1024" } }));
  assert.throws(() => assertInitialPromptBinding(request, { prompt: "A different image.", providerOptions: { size: "1024x1024" } }), /exactly match/);
  assert.throws(() => assertInitialPromptBinding(request, { prompt: "A precise product hero image.", providerOptions: { size: "2048x2048" } }), /provider options/);
  assert.throws(() => assertInitialPromptBinding(request, { prompt: "A precise product hero image.", providerOptions: { size: "1024x1024" }, pricingUsage: { size: "2048x2048" } }), /pricingUsage.size/);
  assert.throws(() => assertInitialPromptBinding(request, { prompt: "A precise product hero image.", providerOptions: { size: "1024x1024" }, pricingUsage: { imageCount: 0 } }), /pricingUsage.imageCount/);
  assert.deepEqual(hydrateInitialPromptBinding(request, {}), { prompt: "A precise product hero image.", providerOptions: { size: "1024x1024" }, pricingUsage: {} });
});

test("blocks provider submission overrides on the first bound attempt", () => {
  const run = fixture();
  const request = compilePromptBoundGenerationPlan(run, input(run.sha256)).requests[0];
  request.attemptCount = 1;
  assert.doesNotThrow(() => assertPromptBoundSubmission(request, {}));
  assert.throws(() => assertPromptBoundSubmission(request, { durationSeconds: 2 }), /duration drifts/);
  assert.throws(() => assertPromptBoundSubmission(request, { providerOptions: { seed: 2 } }), /cannot be overridden/);
  assert.throws(() => assertPromptBoundSubmission(request, { size: "2048x2048" }), /Prompt-bound size/);
});
