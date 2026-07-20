import test from "node:test";
import assert from "node:assert/strict";
import { bindVisualPromptPackToGroundingReport, bindVisualPromptPackToShotSequence, compileClaimProofMap, compileVisualPromptPack } from "./director-generation-contracts.mjs";

test("requires evidence-backed proof for factual script claims", () => {
  assert.throws(() => compileClaimProofMap({
    mapId: "claims",
    claims: [{ claimId: "c1", claimType: "factual", text: "Deploys in three minutes", lineIds: ["l1"], proofItems: [] }]
  }), /requires visible or audible proof/);
  const map = compileClaimProofMap({
    mapId: "claims",
    claims: [{
      claimId: "c1", claimType: "factual", text: "Deploys in three minutes", lineIds: ["l1"],
      proofItems: [{ shotId: "s2", proofType: "screen_recording", visualEvidence: "Continuous setup timer", sourceEvidenceRefs: ["product-demo.mov"] }]
    }, {
      claimId: "c2", claimType: "vision", text: "A more natural interface", lineIds: ["l2"], proofItems: [],
      disclosure: "Brand vision, not a measured performance claim."
    }]
  }, "2026-07-16T03:00:00.000Z");
  assert.equal(map.status, "ready");
  assert.equal(map.factualClaimCount, 1);
  assert.deepEqual(map.proofShotIds, ["s2"]);
});

test("compiles modality-specific prompts instead of one universal template", () => {
  const pack = compileVisualPromptPack({
    packId: "visuals",
    routes: [
      { routeId: "image", providerId: "openai", modelId: "gpt-image", mode: "text_to_image", officialDocUrl: "https://example.com/image", negativePromptPolicy: "positive_constraints", supportsExactText: false, supportsAudio: false },
      { routeId: "video", providerId: "runway", modelId: "gen4", mode: "image_to_video", officialDocUrl: "https://example.com/video", negativePromptPolicy: "separate_negative_prompt", supportsFirstFrame: true, supportsNegativePrompt: true, supportsExactText: false, supportsAudio: false },
      { routeId: "bridge", providerId: "google", modelId: "veo", mode: "first_last_frame_video", officialDocUrl: "https://example.com/veo", negativePromptPolicy: "inline_prohibitions", supportsFirstFrame: true, supportsLastFrame: true, supportsExactText: false, supportsAudio: true }
    ],
    shots: [
      shot({ shotId: "s1", routeId: "image", exactText: ["MOSI"], negativeConstraints: ["no generated text"] }),
      shot({ shotId: "s2", routeId: "video", firstFrameRef: "kf-s2-first", motion: "Cloud reflections travel across the glass from left to right." }),
      shot({ shotId: "s3", routeId: "bridge", firstFrameRef: "kf-s3-first", lastFrameRef: "kf-s3-last", motion: "A smooth 90 degree arc joins both registered camera poses.", startState: { actionPhase: "turn_begins", screenPosition: "right_third" }, endState: { actionPhase: "turn_complete", screenPosition: "center" }, transitionPath: "Continue the turn while the camera arcs clockwise to the registered end pose.", pathFeasibility: "pass", audioResponsibility: { speech: "external_or_none", music: "external_or_none", ambience: "provider_optional" } })
    ]
  }, "2026-07-16T03:00:00.000Z");
  assert.equal(pack.modalityIsolation, true);
  assert.equal(pack.routes[0].promptDialect, "openai_gpt_image_edit_fidelity");
  assert.equal(pack.routes[1].promptDialect, "runway_positive_motion");
  assert.equal(pack.routes[2].promptDialect, "google_veo_cinematic_components");
  assert.match(pack.prompts[0].positivePrompt, /Required result/);
  assert.equal(pack.prompts[0].renderOverlayRequired, true);
  assert.match(pack.prompts[1].positivePrompt, /^The input frame already defines appearance/);
  assert.match(pack.prompts[1].positivePrompt, /camera movement motivated by reveal/);
  assert.equal(pack.prompts[1].negativePrompt, "motion jitter");
  assert.match(pack.prompts[2].positivePrompt, /registered first frame.*registered last frame/);
  assert.match(pack.prompts[2].positivePrompt, /Path: Continue the turn/);
  assert.equal(pack.prompts[2].executionContract.pathFeasibility, "pass");
  assert.ok(pack.prompts[2].repairTargets.includes("last_frame_match"));
  assert.equal(pack.prompts[1].generationStrategy.referenceSemantics, "first_frame_defines_appearance_prompt_defines_motion");
});

test("compiles subject-first FLUX prompts with positive constraints and typed reference roles", () => {
  const pack = compileVisualPromptPack({
    packId: "flux-product",
    routes: [{ routeId: "flux", providerId: "bfl", modelId: "flux-2-pro", mode: "text_to_image", officialDocUrl: "https://docs.bfl.ai/guides/prompting_guide_flux2", negativePromptPolicy: "positive_constraints", supportsExactText: false }],
    shots: [shot({
      shotId: "flux-1", routeId: "flux", negativeConstraints: ["no generated text", "no blur"],
      referenceBindings: [{ assetRef: "product-front.png", role: "product_geometry", preserve: ["silhouette", "port positions"], mutable: ["background", "lighting"] }]
    })]
  });
  const prompt = pack.prompts[0];
  assert.match(prompt.positivePrompt, /^A silver desktop device wakes from sleep/);
  assert.match(prompt.positivePrompt, /product-front\.png controls product_geometry/);
  assert.match(prompt.positivePrompt, /typography reserved for the deterministic overlay layer/);
  assert.match(prompt.positivePrompt, /sharp focus with clearly resolved edges/);
  assert.doesNotMatch(prompt.positivePrompt, /keep the result free of/);
  assert.equal(prompt.referenceInputs.roleStatus, "typed");
  assert.deepEqual(prompt.referenceInputs.referenceAssetRefs, ["product-front.png"]);
  assert.equal(prompt.generationStrategy.promptDialect, "flux2_subject_first_positive_constraints");
});

test("rejects conflicting reference control roles without provider evidence", () => {
  assert.throws(() => compileVisualPromptPack({
    packId: "conflicting-refs",
    routes: [{ routeId: "image", providerId: "openai", modelId: "gpt-image", mode: "text_to_image", officialDocUrl: "https://example.com/image", negativePromptPolicy: "positive_constraints" }],
    shots: [shot({ referenceBindings: [{ assetRef: "person.png", role: "identity" }, { assetRef: "person.png", role: "style" }] })]
  }), /multiple control roles/);
});

test("rejects video modes without their required frame and motion inputs", () => {
  assert.throws(() => compileVisualPromptPack({
    packId: "invalid",
    routes: [{ routeId: "video", providerId: "runway", modelId: "gen4", mode: "image_to_video", officialDocUrl: "https://example.com", negativePromptPolicy: "positive_constraints", supportsFirstFrame: true }],
    shots: [shot({ shotId: "s1", routeId: "video", firstFrameRef: undefined, motion: undefined })]
  }), /requires firstFrameRef/);
});

test("compiles video extension as a continuity-specific mode", () => {
  const pack = compileVisualPromptPack({
    packId: "extension",
    routes: [{
      routeId: "extend",
      providerId: "google",
      modelId: "veo",
      mode: "video_extension",
      officialDocUrl: "https://example.com/veo-extension",
      negativePromptPolicy: "positive_constraints",
      supportsFirstFrame: true,
      supportsExactText: false,
      supportsAudio: true
    }],
    shots: [shot({
      shotId: "s4",
      routeId: "extend",
      firstFrameRef: "s3-tail-frame",
      motion: "Continue the left-to-right camera drift while the indicator finishes its travel."
    })]
  });
  assert.equal(pack.prompts[0].mode, "video_extension");
  assert.match(pack.prompts[0].positivePrompt, /Continue from the registered tail frame/);
  assert.equal(pack.prompts[0].referenceInputs.firstFrameRef, "s3-tail-frame");
  assert.ok(pack.prompts[0].repairTargets.includes("motion"));
});

test("blocks first-last generation without a feasible path or observed provider capability", () => {
  const input = {
    packId: "blocked-path",
    routes: [{ routeId: "bridge", providerId: "google", modelId: "veo", mode: "first_last_frame_video", officialDocUrl: "https://example.com/veo", negativePromptPolicy: "inline_prohibitions", supportsFirstFrame: true, supportsLastFrame: false }],
    shots: [shot({ shotId: "s3", routeId: "bridge", firstFrameRef: "first", lastFrameRef: "last", startState: { actionPhase: "start" }, endState: { actionPhase: "end" }, transitionPath: "Cross the room.", pathFeasibility: "bridge_required" })]
  };
  assert.throws(() => compileVisualPromptPack(input), /last-frame control/);
  input.routes[0].supportsLastFrame = true;
  assert.throws(() => compileVisualPromptPack(input), /must pass feasibility review/);
});

test("blocks unordered or out-of-range video action beats", () => {
  const input = {
    packId: "bad-beats",
    routes: [{ routeId: "video", providerId: "runway", modelId: "gen4", mode: "image_to_video", officialDocUrl: "https://example.com/video", negativePromptPolicy: "positive_constraints", supportsFirstFrame: true }],
    shots: [shot({ shotId: "s2", routeId: "video", firstFrameRef: "first", actionBeats: [{ atSeconds: 3, action: "turns" }, { atSeconds: 2, action: "stops" }] })]
  };
  assert.throws(() => compileVisualPromptPack(input), /strictly ordered/);
});

test("binds visual prompts to the exact reviewed shot order, purpose, duration, and hashes", () => {
  const inputShots = [
    shot({ shotId: "s1", routeId: "image", purpose: "Opening proof", durationSeconds: 4 }),
    shot({ shotId: "s2", routeId: "image", purpose: "Product payoff", durationSeconds: 5 })
  ];
  const pack = compileVisualPromptPack({
    packId: "bound-visuals",
    routes: [{ routeId: "image", providerId: "openai", modelId: "gpt-image", mode: "text_to_image", officialDocUrl: "https://example.com/image", negativePromptPolicy: "positive_constraints" }],
    shots: inputShots
  });
  const bound = bindVisualPromptPackToShotSequence(pack, sequenceReview(inputShots), {
    shotlistSha256: "a".repeat(64),
    reviewSha256: "b".repeat(64)
  });
  assert.equal(bound.sourceBindings.shotlist.sha256, "a".repeat(64));
  assert.equal(bound.sourceBindings.shotSequenceReview.reviewId, "review-1");
});

test("rejects a prompt pack that reorders or rewrites the approved shots", () => {
  const inputShots = [
    shot({ shotId: "s1", routeId: "image", purpose: "Opening proof", durationSeconds: 4 }),
    shot({ shotId: "s2", routeId: "image", purpose: "Product payoff", durationSeconds: 5 })
  ];
  const pack = compileVisualPromptPack({
    packId: "drifted-visuals",
    routes: [{ routeId: "image", providerId: "openai", modelId: "gpt-image", mode: "text_to_image", officialDocUrl: "https://example.com/image", negativePromptPolicy: "positive_constraints" }],
    shots: [...inputShots].reverse()
  });
  assert.throws(() => bindVisualPromptPackToShotSequence(pack, sequenceReview(inputShots), {
    shotlistSha256: "a".repeat(64),
    reviewSha256: "b".repeat(64)
  }), /exactly match.*order/);
});

test("binds only per-shot authorized grounding assets into visual prompts", () => {
  const inputShots = [
    shot({ shotId: "s1", routeId: "image", purpose: "Opening proof", durationSeconds: 4, referenceAssetRefs: ["logo"] }),
    shot({ shotId: "s2", routeId: "image", purpose: "Product payoff", durationSeconds: 5 })
  ];
  const pack = bindVisualPromptPackToShotSequence(compileVisualPromptPack({
    packId: "grounded-visuals",
    routes: [{ routeId: "image", providerId: "openai", modelId: "gpt-image", mode: "text_to_image", officialDocUrl: "https://example.com/image", negativePromptPolicy: "positive_constraints" }],
    shots: inputShots
  }), sequenceReview(inputShots), {
    shotlistSha256: "a".repeat(64),
    reviewSha256: "b".repeat(64)
  });
  const report = {
    reportId: "grounding-report-1",
    planId: "grounding-plan-1",
    status: "ready",
    sourceBinding: { status: "ready", sha256: "a".repeat(64) },
    shots: [
      { shotId: "s1", status: "ready", evidenceRefs: ["logo-receipt.json"], authorizedGenerationAnchorRefs: ["logo"], transferRules: ["Preserve official logo geometry."] },
      { shotId: "s2", status: "ready", evidenceRefs: ["product-page.json"], authorizedGenerationAnchorRefs: [], transferRules: ["Use fact only."] }
    ]
  };
  const bound = bindVisualPromptPackToGroundingReport(pack, report, { groundingSha256: "c".repeat(64) });
  assert.equal(bound.sourceBindings.shotGrounding.reportId, "grounding-report-1");
  assert.deepEqual(bound.prompts[0].grounding.authorizedGenerationAnchorRefs, ["logo"]);
  assert.deepEqual(bound.prompts[1].grounding.evidenceRefs, ["product-page.json"]);
  const unauthorized = structuredClone(pack);
  unauthorized.prompts[0].referenceInputs.referenceAssetRefs = ["unapproved"];
  assert.throws(() => bindVisualPromptPackToGroundingReport(unauthorized, report, {
    groundingSha256: "c".repeat(64)
  }), /unauthorized grounding anchors/);
});

function shot(overrides = {}) {
  return {
    shotId: "s1",
    routeId: "image",
    purpose: "Product proof",
    durationSeconds: 5,
    subject: "A silver desktop device",
    action: "wakes from sleep",
    setting: "in a restrained Shanghai design studio",
    camera: "Slow dolly in",
    lighting: "Cool daylight with a warm edge reflection",
    composition: "product on the right third with title-safe negative space",
    style: "photoreal premium commercial",
    motion: "The indicator light travels from back to front.",
    viewerChange: "The viewer understands the product action and its consequence.",
    screenDirection: "left_to_right",
    lightingDirection: "camera_left",
    cameraMovement: { type: "push_in", motivation: "reveal", vector: "toward", speed: "slow", easing: "ease_in_out" },
    actionBeats: [{ atSeconds: 0, action: "indicator wakes" }, { atSeconds: 4, action: "indicator reaches the front edge" }],
    endState: "front hero angle",
    continuityKeys: ["product geometry", "screen direction"],
    negativeConstraints: ["motion jitter"],
    exactText: [],
    reviewCriteria: ["product geometry remains stable"],
    ...overrides
  };
}

function sequenceReview(shots) {
  return {
    reviewId: "review-1",
    sequenceId: "sequence-1",
    status: "ready",
    shotOrder: shots.map((item) => item.shotId),
    shotContract: shots.map((item, index) => ({
      shotId: item.shotId,
      order: index + 1,
      purpose: item.purpose,
      durationSeconds: item.durationSeconds
    })),
    sourceBinding: { status: "ready", artifactRef: "shotlist.json", sha256: "a".repeat(64) }
  };
}
