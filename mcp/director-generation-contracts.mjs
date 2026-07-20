import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const CLAIM_TYPES = new Set(["factual", "vision", "opinion"]);
const GENERATION_MODES = new Set(["text_to_image", "image_edit", "text_to_video", "image_to_video", "first_last_frame_video", "video_extension"]);
const NEGATIVE_POLICIES = new Set(["positive_constraints", "separate_negative_prompt", "inline_prohibitions"]);

export function compileClaimProofMap(input, now = new Date().toISOString()) {
  if (!input?.mapId?.trim()) throw new Error("claim proof map requires mapId.");
  if (!Array.isArray(input.claims) || !input.claims.length) throw new Error("claim proof map requires at least one claim.");
  const claimIds = new Set();
  const claims = input.claims.map((claim) => {
    if (!claim?.claimId?.trim() || claimIds.has(claim.claimId)) throw new Error("claimId must be present and unique.");
    claimIds.add(claim.claimId);
    if (!CLAIM_TYPES.has(claim.claimType)) throw new Error(`${claim.claimId} has unsupported claimType.`);
    if (!claim.text?.trim()) throw new Error(`${claim.claimId} requires claim text.`);
    const proofItems = Array.isArray(claim.proofItems) ? claim.proofItems : [];
    if (claim.claimType === "factual" && !proofItems.length) throw new Error(`Factual claim ${claim.claimId} requires visible or audible proof.`);
    const normalizedProof = proofItems.map((proof, index) => {
      if (!proof?.shotId?.trim() || !proof?.visualEvidence?.trim() || !proof?.proofType?.trim()) {
        throw new Error(`${claim.claimId} proof ${index + 1} requires shotId, proofType, and visualEvidence.`);
      }
      const sourceEvidenceRefs = uniqueStrings(proof.sourceEvidenceRefs);
      if (claim.claimType === "factual" && !sourceEvidenceRefs.length) {
        throw new Error(`Factual claim ${claim.claimId} proof ${index + 1} requires source evidence.`);
      }
      return { ...proof, sourceEvidenceRefs };
    });
    if (claim.claimType !== "factual" && !proofItems.length && !claim.disclosure?.trim()) {
      throw new Error(`${claim.claimId} requires proof or an explicit vision/opinion disclosure.`);
    }
    return {
      claimId: claim.claimId,
      claimType: claim.claimType,
      text: claim.text.trim(),
      lineIds: uniqueStrings(claim.lineIds),
      proofItems: normalizedProof,
      disclosure: claim.disclosure?.trim() ?? null,
      reviewStatus: "ready"
    };
  });
  return {
    schemaVersion: "1.0",
    mapId: input.mapId,
    scriptArtifactRef: input.scriptArtifactRef ?? "script_or_outline.json",
    status: "ready",
    claims,
    factualClaimCount: claims.filter((claim) => claim.claimType === "factual").length,
    proofShotIds: [...new Set(claims.flatMap((claim) => claim.proofItems.map((proof) => proof.shotId)))],
    createdAt: now
  };
}

export function compileVisualPromptPack(input, now = new Date().toISOString()) {
  if (!input?.packId?.trim()) throw new Error("visual prompt pack requires packId.");
  if (!Array.isArray(input.routes) || !input.routes.length) throw new Error("visual prompt pack requires provider routes.");
  if (!Array.isArray(input.shots) || !input.shots.length) throw new Error("visual prompt pack requires shots.");
  const routes = new Map();
  for (const route of input.routes) {
    if (!route?.routeId?.trim() || routes.has(route.routeId)) throw new Error("routeId must be present and unique.");
    if (!GENERATION_MODES.has(route.mode)) throw new Error(`${route.routeId} has unsupported generation mode.`);
    if (!route.providerId?.trim() || !route.modelId?.trim()) throw new Error(`${route.routeId} requires providerId and modelId.`);
    if (!NEGATIVE_POLICIES.has(route.negativePromptPolicy)) throw new Error(`${route.routeId} requires a supported negativePromptPolicy.`);
    if (!isHttpsUrl(route.officialDocUrl)) throw new Error(`${route.routeId} requires an official HTTPS model document URL.`);
    routes.set(route.routeId, {
      routeId: route.routeId,
      providerId: route.providerId,
      modelId: route.modelId,
      mode: route.mode,
      officialDocUrl: route.officialDocUrl,
      researchedAt: route.researchedAt ?? now,
      modelVersion: route.modelVersion?.trim() ?? null,
      negativePromptPolicy: route.negativePromptPolicy,
      supportsFirstFrame: route.supportsFirstFrame === true,
      supportsLastFrame: route.supportsLastFrame === true,
      supportsNegativePrompt: route.supportsNegativePrompt === true,
      supportsExactText: route.supportsExactText === true,
      supportsAudio: route.supportsAudio === true
    });
  }
  const shotIds = new Set();
  const prompts = input.shots.map((shot) => {
    if (!shot?.shotId?.trim() || shotIds.has(shot.shotId)) throw new Error("shotId must be present and unique.");
    shotIds.add(shot.shotId);
    const route = routes.get(shot.routeId);
    if (!route) throw new Error(`${shot.shotId} references unknown route ${shot.routeId}.`);
    requireText(shot, ["purpose", "subject", "action", "setting", "camera", "lighting", "composition", "style"]);
    if (!Number.isFinite(shot.durationSeconds) || shot.durationSeconds <= 0) throw new Error(`${shot.shotId} requires a positive durationSeconds.`);
    assertModeInputs(shot, route);
    const positivePrompt = buildPositivePrompt(shot, route);
    const negativeConstraints = uniqueStrings(shot.negativeConstraints);
    const negativePrompt = route.negativePromptPolicy === "separate_negative_prompt" ? negativeConstraints.join(", ") : null;
    const exactTextRequired = uniqueStrings(shot.exactText).length > 0;
    return {
      shotId: shot.shotId,
      routeId: route.routeId,
      providerId: route.providerId,
      modelId: route.modelId,
      mode: route.mode,
      purpose: shot.purpose,
      durationSeconds: shot.durationSeconds,
      positivePrompt: appendInlineConstraints(positivePrompt, negativeConstraints, route.negativePromptPolicy),
      negativePrompt,
      referenceInputs: {
        firstFrameRef: shot.firstFrameRef ?? null,
        lastFrameRef: shot.lastFrameRef ?? null,
        referenceAssetRefs: uniqueStrings(shot.referenceAssetRefs)
      },
      continuityKeys: uniqueStrings(shot.continuityKeys),
      exactText: uniqueStrings(shot.exactText),
      renderOverlayRequired: exactTextRequired && !route.supportsExactText,
      audioResponsibility: normalizeAudioResponsibility(shot.audioResponsibility, route),
      executionContract: compileShotExecutionContract(shot, route),
      reviewCriteria: uniqueStrings(shot.reviewCriteria),
      repairTargets: buildRepairTargets(shot, route)
    };
  });
  return {
    schemaVersion: "1.0",
    packId: input.packId,
    directorContractRef: input.directorContractRef ?? "director_contract.json",
    claimProofMapRef: input.claimProofMapRef ?? "claim_to_proof_map.json",
    status: "ready",
    routes: [...routes.values()],
    prompts,
    modalityIsolation: true,
    createdAt: now
  };
}

export function bindVisualPromptPackToShotSequence(pack, review, {
  shotlistArtifactRef = "shotlist.json",
  shotlistSha256,
  reviewArtifactRef = "shot_sequence_review.json",
  reviewSha256
}) {
  if (!pack?.packId || !Array.isArray(pack.prompts)) throw new Error("A compiled visual prompt pack is required.");
  if (review?.status !== "ready" || review?.sourceBinding?.status !== "ready" || !Array.isArray(review.shotContract)) {
    throw new Error("Visual prompts require a ready shot sequence review bound to the real shotlist.");
  }
  for (const [name, value] of [["shotlistSha256", shotlistSha256], ["reviewSha256", reviewSha256]]) {
    if (!/^[a-f0-9]{64}$/i.test(String(value ?? ""))) throw new Error(`${name} must be a verified SHA-256.`);
  }
  if (review.sourceBinding.sha256 !== String(shotlistSha256).toLowerCase()) {
    throw new Error("Shot sequence review no longer matches the registered shotlist hash.");
  }
  const promptOrder = pack.prompts.map((prompt) => prompt.shotId);
  if (JSON.stringify(promptOrder) !== JSON.stringify(review.shotOrder)) {
    throw new Error("Visual prompt shots must exactly match the approved shot sequence order.");
  }
  const expectedById = new Map(review.shotContract.map((shot) => [shot.shotId, shot]));
  for (const prompt of pack.prompts) {
    const expected = expectedById.get(prompt.shotId);
    if (!expected) throw new Error(`Visual prompt ${prompt.shotId} is absent from the approved shot sequence.`);
    if (Math.abs(prompt.durationSeconds - expected.durationSeconds) > 0.001) {
      throw new Error(`Visual prompt ${prompt.shotId} duration drifts from shot_sequence_review.json.`);
    }
    if (normalizeText(prompt.purpose) !== normalizeText(expected.purpose)) {
      throw new Error(`Visual prompt ${prompt.shotId} purpose drifts from shot_sequence_review.json.`);
    }
  }
  return {
    ...structuredClone(pack),
    sourceBindings: {
      shotlist: {
        artifactRef: shotlistArtifactRef,
        sha256: String(shotlistSha256).toLowerCase()
      },
      shotSequenceReview: {
        artifactRef: reviewArtifactRef,
        sha256: String(reviewSha256).toLowerCase(),
        reviewId: review.reviewId,
        sequenceId: review.sequenceId
      }
    }
  };
}

export function bindVisualPromptPackToGroundingReport(pack, report, {
  groundingArtifactRef = "shot_grounding_report.json",
  groundingSha256
}) {
  if (!pack?.packId || !Array.isArray(pack.prompts)) throw new Error("A compiled visual prompt pack is required.");
  if (report?.status !== "ready" || report?.sourceBinding?.status !== "ready" || !Array.isArray(report.shots)) {
    throw new Error("Visual prompts require a ready shot grounding report bound to the real shotlist.");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(groundingSha256 ?? ""))) throw new Error("groundingSha256 must be a verified SHA-256.");
  if (pack.sourceBindings?.shotlist?.sha256 !== report.sourceBinding.sha256) {
    throw new Error("Shot grounding report no longer matches the visual prompt shotlist binding.");
  }
  const groundingByShot = new Map(report.shots.map((shot) => [shot.shotId, shot]));
  const prompts = pack.prompts.map((prompt) => {
    const grounding = groundingByShot.get(prompt.shotId);
    if (!grounding || grounding.status !== "ready") throw new Error(`Visual prompt ${prompt.shotId} lacks ready per-shot grounding.`);
    const authorized = new Set(grounding.authorizedGenerationAnchorRefs ?? []);
    const unauthorized = (prompt.referenceInputs?.referenceAssetRefs ?? []).filter((ref) => !authorized.has(ref));
    if (unauthorized.length) throw new Error(`Visual prompt ${prompt.shotId} uses unauthorized grounding anchors: ${unauthorized.join(", ")}.`);
    return {
      ...structuredClone(prompt),
      grounding: {
        reportArtifactRef: groundingArtifactRef,
        evidenceRefs: uniqueStrings(grounding.evidenceRefs),
        authorizedGenerationAnchorRefs: [...authorized],
        transferRules: uniqueStrings(grounding.transferRules)
      }
    };
  });
  return {
    ...structuredClone(pack),
    prompts,
    sourceBindings: {
      ...(pack.sourceBindings ?? {}),
      shotGrounding: {
        artifactRef: groundingArtifactRef,
        sha256: String(groundingSha256).toLowerCase(),
        reportId: report.reportId,
        planId: report.planId
      }
    }
  };
}

export async function writeDirectorGenerationArtifact({ projectPath, runId, artifactRef, value }) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Director X run ID.");
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const path = join(directory, artifactRef);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef, path };
}

export async function writeVisualPromptPackSummary({ projectPath, runId, pack }) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Director X run ID.");
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const artifactRef = "visual_prompt_pack.md";
  const path = join(directory, artifactRef);
  const rows = pack.prompts.map((prompt) =>
    `| ${prompt.shotId} | ${prompt.mode} | ${prompt.providerId} / ${prompt.modelId} | ${prompt.purpose} | ${(prompt.grounding?.authorizedGenerationAnchorRefs ?? []).join(", ") || "-"} |`
  ).join("\n");
  const markdown = `# 模型执行提示词\n\n- 提示词包：${pack.packId}\n- 镜头数：${pack.prompts.length}\n- Grounding：${pack.sourceBindings?.shotGrounding?.reportId ?? "未绑定"}\n\n| 镜头 | 模式 | 模型 | 目的 | 已授权生成锚点 |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
  await writeFile(path, markdown, { encoding: "utf8", mode: 0o600 });
  return { artifactRef, path };
}

function assertModeInputs(shot, route) {
  if (["image_to_video", "first_last_frame_video", "video_extension"].includes(route.mode) && !shot.firstFrameRef?.trim()) {
    throw new Error(`${shot.shotId} ${route.mode} requires firstFrameRef.`);
  }
  if (route.mode === "first_last_frame_video" && !shot.lastFrameRef?.trim()) {
    throw new Error(`${shot.shotId} first_last_frame_video requires lastFrameRef.`);
  }
  if (["image_to_video", "first_last_frame_video", "video_extension"].includes(route.mode) && !route.supportsFirstFrame) {
    throw new Error(`${shot.shotId} requires provider evidence for first-frame control.`);
  }
  if (route.mode === "first_last_frame_video" && !route.supportsLastFrame) {
    throw new Error(`${shot.shotId} requires provider evidence for last-frame control.`);
  }
  if (["text_to_video", "image_to_video", "first_last_frame_video", "video_extension"].includes(route.mode) && !shot.motion?.trim()) {
    throw new Error(`${shot.shotId} ${route.mode} requires observable motion.`);
  }
  if (route.mode === "image_edit" && !shot.editInstruction?.trim()) {
    throw new Error(`${shot.shotId} image_edit requires editInstruction.`);
  }
  if (route.negativePromptPolicy === "separate_negative_prompt" && !route.supportsNegativePrompt) {
    throw new Error(`${shot.shotId} route declares a separate negative prompt without provider capability evidence.`);
  }
  if (["text_to_video", "image_to_video", "first_last_frame_video", "video_extension"].includes(route.mode)) {
    requireText(shot, ["viewerChange", "screenDirection", "lightingDirection"]);
    if (!shot.cameraMovement?.type?.trim() || !shot.cameraMovement?.motivation?.trim()) {
      throw new Error(`${shot.shotId} video generation requires cameraMovement.type and cameraMovement.motivation.`);
    }
    if (!Array.isArray(shot.actionBeats) || shot.actionBeats.length < 2) {
      throw new Error(`${shot.shotId} video generation requires at least two timed actionBeats.`);
    }
    let previousAtSeconds = -1;
    for (const [index, beat] of shot.actionBeats.entries()) {
      const atSeconds = Number(beat?.atSeconds);
      if (!Number.isFinite(atSeconds) || atSeconds < 0 || atSeconds > shot.durationSeconds || atSeconds <= previousAtSeconds) {
        throw new Error(`${shot.shotId} actionBeats[${index}] must be strictly ordered inside the shot duration.`);
      }
      if (!String(beat?.action ?? "").trim()) throw new Error(`${shot.shotId} actionBeats[${index}] requires an observable action.`);
      previousAtSeconds = atSeconds;
    }
  }
  if (route.mode === "first_last_frame_video") {
    for (const field of ["startState", "endState"]) {
      if (!shot[field] || typeof shot[field] !== "object" || Array.isArray(shot[field]) || !Object.keys(shot[field]).length) {
        throw new Error(`${shot.shotId} first_last_frame_video requires a non-empty ${field}.`);
      }
    }
    if (!shot.transitionPath?.trim()) throw new Error(`${shot.shotId} first_last_frame_video requires transitionPath.`);
    if (shot.pathFeasibility !== "pass") {
      throw new Error(`${shot.shotId} first_last_frame_video path must pass feasibility review before generation.`);
    }
  }
}

function buildPositivePrompt(shot, route) {
  if (route.mode === "text_to_image") {
    return `${shot.purpose}. ${shot.subject} ${shot.action}. ${shot.setting}. ${shot.camera}; ${shot.composition}. ${shot.lighting}. ${shot.style}.`;
  }
  if (route.mode === "image_edit") {
    return `${shot.editInstruction}. Preserve ${uniqueStrings(shot.continuityKeys).join(", ") || "subject identity and composition"}. ${shot.lighting}. ${shot.style}.`;
  }
  if (route.mode === "text_to_video") {
    return `Single continuous shot. Shot function: ${shot.purpose}. Viewer change: ${shot.viewerChange}. Camera: ${shot.camera}; ${cameraMovementPrompt(shot.cameraMovement)}. Subject action: ${shot.subject} ${shot.action}. Timed beats: ${actionBeatPrompt(shot.actionBeats)}. Setting: ${shot.setting}. Scene motion: ${shot.motion}. Continuity: screen direction ${shot.screenDirection}; key light from ${shot.lightingDirection}; preserve ${uniqueStrings(shot.continuityKeys).join(", ") || "identity and spatial continuity"}. ${shot.lighting}. ${shot.style}. End state: ${statePrompt(shot.endState) || "stable edit-ready composition"}. No in-shot cut or action restart.`;
  }
  if (route.mode === "image_to_video") {
    return `The input frame already defines appearance, composition, lighting, and style. ${cameraMovementPrompt(shot.cameraMovement)}. Subject motion: ${shot.action}. Timed beats: ${actionBeatPrompt(shot.actionBeats)}. Scene motion: ${shot.motion}. Preserve screen direction ${shot.screenDirection}, key light from ${shot.lightingDirection}, and ${uniqueStrings(shot.continuityKeys).join(", ") || "identity and spatial layout"}. End state: ${statePrompt(shot.endState) || "stable edit-ready composition"}. No in-shot cut or action restart.`;
  }
  if (route.mode === "video_extension") {
    return `Continue from the registered tail frame without resetting action phase or camera momentum. ${shot.camera}. ${shot.subject} ${shot.action}. ${shot.motion}. Preserve ${uniqueStrings(shot.continuityKeys).join(", ") || "identity, screen direction, lighting, motion energy, and audio bed"}. End state: ${shot.endState ?? "stable edit-ready composition"}.`;
  }
  return `Move continuously from the registered first frame to the registered last frame in one unbroken shot. Path: ${shot.transitionPath}. Camera path: ${cameraMovementPrompt(shot.cameraMovement)}. Subject action: ${shot.action}. Timed beats: ${actionBeatPrompt(shot.actionBeats)}. Start state: ${statePrompt(shot.startState)}. End state: ${statePrompt(shot.endState)}. Preserve screen direction ${shot.screenDirection}, key light from ${shot.lightingDirection}, and ${uniqueStrings(shot.continuityKeys).join(", ") || "identity, wardrobe, props, product geometry, and spatial continuity"}. Do not restart the action, teleport, morph, or cut. If the path cannot be completed naturally, fail instead of changing either boundary state.`;
}

function compileShotExecutionContract(shot, route) {
  if (!["text_to_video", "image_to_video", "first_last_frame_video", "video_extension"].includes(route.mode)) return null;
  return {
    viewerChange: shot.viewerChange,
    cameraMovement: structuredClone(shot.cameraMovement),
    actionBeats: structuredClone(shot.actionBeats),
    screenDirection: shot.screenDirection,
    lightingDirection: shot.lightingDirection,
    startState: shot.startState ? structuredClone(shot.startState) : null,
    endState: shot.endState && typeof shot.endState === "object" ? structuredClone(shot.endState) : shot.endState ?? null,
    transitionPath: shot.transitionPath?.trim() ?? null,
    pathFeasibility: shot.pathFeasibility ?? null,
    providerCapability: {
      providerId: route.providerId,
      modelId: route.modelId,
      modelVersion: route.modelVersion,
      researchedAt: route.researchedAt,
      supportsFirstFrame: route.supportsFirstFrame,
      supportsLastFrame: route.supportsLastFrame,
      supportsNegativePrompt: route.supportsNegativePrompt
    }
  };
}

function cameraMovementPrompt(value) {
  return `${value.type} camera movement motivated by ${value.motivation}${value.vector ? `, moving ${value.vector}` : ""}${value.speed ? ` at ${value.speed} speed` : ""}${value.easing ? ` with ${value.easing} easing` : ""}`;
}

function actionBeatPrompt(values) {
  return values.map((beat) => `${Number(beat.atSeconds).toFixed(2)}s ${String(beat.action).trim()}`).join("; ");
}

function statePrompt(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return Object.entries(value).map(([key, item]) => `${key}=${Array.isArray(item) ? item.join("/") : String(item)}`).join(", ");
}

function appendInlineConstraints(prompt, constraints, policy) {
  if (!constraints.length || policy === "separate_negative_prompt") return prompt;
  if (policy === "positive_constraints") return `${prompt} Required result: ${constraints.map(positiveConstraint).join("; ")}.`;
  return `${prompt} Prohibitions: ${constraints.join("; ")}.`;
}

function positiveConstraint(value) {
  const normalized = value.replace(/^no\s+/i, "").replace(/^avoid\s+/i, "");
  return `keep the result free of ${normalized}`;
}

function normalizeAudioResponsibility(value = {}, route) {
  const speech = value.speech ?? "external_or_none";
  const music = value.music ?? "external_or_none";
  const ambience = value.ambience ?? (route.supportsAudio ? "provider_optional" : "external_or_none");
  if (speech === "provider" && !route.supportsAudio) throw new Error(`${route.routeId} cannot own speech because the route does not support audio.`);
  if (music === "provider" && !route.supportsAudio) throw new Error(`${route.routeId} cannot own music because the route does not support audio.`);
  return { speech, music, ambience };
}

function buildRepairTargets(shot, route) {
  const targets = ["prompt_match", "composition", "identity", "lighting"];
  if (route.mode.includes("video")) targets.push("motion", "physics", "ending_state");
  if (route.mode === "first_last_frame_video") targets.push("first_frame_match", "last_frame_match");
  if (uniqueStrings(shot.exactText).length) targets.push("text_overlay");
  return targets;
}

function requireText(value, fields) {
  for (const field of fields) if (!value?.[field]?.trim()) throw new Error(`${value?.shotId ?? "shot"}.${field} is required.`);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
