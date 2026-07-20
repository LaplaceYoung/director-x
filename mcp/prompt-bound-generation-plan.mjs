import { createHash } from "node:crypto";

export function compilePromptBoundGenerationPlan(run, input) {
  const pack = run?.visualPromptPack;
  if (!pack || pack.status !== "ready" || !Array.isArray(pack.prompts) || !Array.isArray(pack.routes)) {
    throw new Error("Compile a ready visual_prompt_pack.json before binding generation work.");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(input.promptPackSha256 ?? ""))) throw new Error("promptPackSha256 must be a verified SHA-256.");
  const artifact = run.artifacts?.["visual_prompt_pack.json"];
  if (!artifact?.sha256 || artifact.sha256 !== input.promptPackSha256) throw new Error("visual_prompt_pack.json changed after verification; recompile the generation binding.");
  const route = pack.routes.find((item) => item.routeId === input.routeId);
  if (!route) throw new Error(`Unknown visual prompt route: ${input.routeId}`);
  const prompts = pack.prompts.filter((prompt) => prompt.routeId === route.routeId);
  if (!prompts.length) throw new Error(`Visual prompt route ${route.routeId} has no shots.`);
  const budgets = new Map((input.requests ?? []).map((request) => [request.shotId, request]));
  if (budgets.size !== prompts.length || prompts.some((prompt) => !budgets.has(prompt.shotId))) {
    throw new Error("Prompt-bound generation budgets must cover every and only shot on the selected route.");
  }
  const requestIds = new Set();
  const requests = prompts.map((prompt) => {
    const budget = budgets.get(prompt.shotId);
    if (!budget?.requestId?.trim() || requestIds.has(budget.requestId)) throw new Error("Every prompt-bound request requires a unique requestId.");
    requestIds.add(budget.requestId);
    const providerMode = providerModeFor(prompt.mode);
    const providerParameters = structuredClone(budget.providerParameters ?? {});
    const negativePrompt = prompt.negativePrompt ?? null;
    return {
      requestId: budget.requestId,
      shotId: prompt.shotId,
      mode: generationModeFor(prompt.mode),
      providerMode,
      durationSeconds: prompt.durationSeconds,
      promptLayers: {
        purpose: prompt.purpose,
        positivePrompt: prompt.positivePrompt,
        promptDialect: prompt.generationStrategy?.promptDialect ?? "directorx_generic_mode_isolated",
        executionContract: prompt.executionContract ?? null,
        audioResponsibility: prompt.audioResponsibility ?? null
      },
      negativeConstraints: negativePrompt ? [negativePrompt] : [],
      providerParameters,
      inputAnchorAssets: uniqueStrings([
        prompt.referenceInputs?.firstFrameRef,
        prompt.referenceInputs?.lastFrameRef,
        ...(prompt.referenceInputs?.referenceAssetRefs ?? [])
      ]),
      outputAnchorAssets: uniqueStrings(budget.outputAnchorAssets),
      carryForwardRules: uniqueStrings(prompt.continuityKeys),
      cameraGraphNodeId: budget.cameraGraphNodeId ?? null,
      referenceTargetIds: uniqueStrings(budget.referenceTargetIds),
      reviewCriteria: uniqueStrings(prompt.reviewCriteria),
      repairPrompts: uniqueStrings(prompt.repairTargets),
      maxAttempts: budget.maxAttempts,
      maxCost: budget.maxCost,
      attemptCostCap: budget.attemptCostCap,
      qualityThreshold: budget.qualityThreshold,
      promptBinding: {
        packId: pack.packId,
        routeId: route.routeId,
        promptPackArtifactRef: "visual_prompt_pack.json",
        promptPackSha256: input.promptPackSha256,
        positivePromptSha256: hashValue(prompt.positivePrompt),
        negativePromptSha256: hashValue(negativePrompt ?? ""),
        providerParametersSha256: hashValue(providerParameters),
        immutableInitialAttempt: true
      }
    };
  });
  const plan = {
    generationRequestId: input.generationRequestId,
    currency: input.currency,
    providerId: route.providerId,
    modelId: route.modelId,
    credentialRef: input.credentialRef ?? null,
    sourcePromptPackBinding: {
      artifactRef: "visual_prompt_pack.json",
      sha256: input.promptPackSha256,
      packId: pack.packId,
      routeId: route.routeId,
      providerId: route.providerId,
      modelId: route.modelId,
      mode: route.mode,
      promptCount: prompts.length
    },
    requests
  };
  return { ...plan, bindingSha256: hashValue(plan) };
}

export function assertInitialPromptBinding(request, input) {
  const binding = request?.promptBinding;
  if (!binding?.immutableInitialAttempt || Number(request.attemptCount ?? 0) !== 0) return;
  if (hashValue(input.prompt) !== binding.positivePromptSha256) throw new Error("Initial generation prompt must exactly match the verified visual prompt pack.");
  if (hashValue(input.providerOptions ?? {}) !== binding.providerParametersSha256) throw new Error("Initial provider options must exactly match the prompt-bound generation request.");
  assertPricingUsageMatchesRequest(request, input.pricingUsage ?? {});
}

export function hydrateInitialPromptBinding(request, input = {}) {
  const binding = request?.promptBinding;
  if (!binding?.immutableInitialAttempt || Number(request.attemptCount ?? 0) !== 0) return input;
  return {
    ...input,
    prompt: input.prompt ?? request.promptLayers?.positivePrompt,
    providerOptions: input.providerOptions ?? structuredClone(request.providerParameters ?? {}),
    pricingUsage: input.pricingUsage ?? {}
  };
}

export function assertPromptBoundSubmission(request, input = {}) {
  const binding = request?.promptBinding;
  if (!binding?.immutableInitialAttempt || Number(request.attemptCount ?? 0) > 1) return;
  if (input.negativePrompt != null && hashValue(input.negativePrompt) !== binding.negativePromptSha256) {
    throw new Error("Provider submission negativePrompt drifts from the verified visual prompt pack.");
  }
  if (input.durationSeconds != null && Number(input.durationSeconds) !== Number(request.durationSeconds)) {
    throw new Error("Provider submission duration drifts from the prompt-bound generation request.");
  }
  if (input.directMode != null && input.directMode !== request.providerMode) {
    throw new Error("Provider submission mode drifts from the prompt-bound generation request.");
  }
  if (input.providerOptions && Object.keys(input.providerOptions).length) {
    throw new Error("Prompt-bound provider options come from the verified generation request and cannot be overridden at submission time.");
  }
  for (const field of ["aspectRatio", "size", "resolution", "outputCount", "generateAudio"]) {
    if (input[field] != null) throw new Error(`Prompt-bound ${field} comes from the verified generation request and cannot be overridden at submission time.`);
  }
}

export function hashValue(value) {
  const normalized = typeof value === "string" ? value : stableJson(value);
  return createHash("sha256").update(normalized).digest("hex");
}

function generationModeFor(mode) {
  if (["text_to_image", "image_edit"].includes(mode)) return "image";
  if (mode === "first_last_frame_video") return "keyframes_to_video";
  return mode;
}

function providerModeFor(mode) {
  if (mode === "image_edit") return "image_to_image";
  if (mode === "first_last_frame_video") return "keyframes_to_video";
  return mode;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function assertPricingUsageMatchesRequest(request, usage) {
  const parameters = request.providerParameters ?? {};
  const expected = {
    imageCount: parameters.outputCount ?? parameters.n ?? 1,
    requestCount: 1,
    durationSeconds: request.durationSeconds,
    outputCount: parameters.outputCount ?? parameters.n ?? 1,
    quality: parameters.quality,
    resolution: parameters.resolution ?? parameters.size,
    size: parameters.size,
    generateAudio: parameters.generateAudio ?? parameters.generate_audio
  };
  for (const [field, value] of Object.entries(usage)) {
    if (value == null || expected[field] == null) continue;
    if (String(value) !== String(expected[field])) throw new Error(`Initial pricingUsage.${field} must match the prompt-bound generation request.`);
  }
}
