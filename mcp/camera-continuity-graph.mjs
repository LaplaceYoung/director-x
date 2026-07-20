import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const VARIATIONS = new Set(["none", "small", "medium", "large"]);
const LAST_FRAME_POLICIES = new Set(["auto", "required", "forbidden"]);
const HANDOFF_STRATEGIES = new Set(["reuse", "reference_recompose", "transition_extract"]);
const FRAME_ROLES = new Set(["first", "last"]);
const ALLOWED_RIGHTS = new Set(["owned", "licensed", "public_domain", "generated", "approved_reference_only"]);
const ALLOWED_QUALITY = new Set(["passed", "approved"]);
const REVIEWER_ID = "DX-Reference-Analyst";

export function compileCameraContinuityPlan(input) {
  validatePlanInput(input);
  const maxReferences = input.maxReferencesPerFrame ?? input.providerEnvelope.maxReferenceImages ?? 8;
  if (!Number.isInteger(maxReferences) || maxReferences < 1 || maxReferences > 16) {
    throw new Error("maxReferencesPerFrame must be an integer between 1 and 16.");
  }
  const strictReferenceCoverage = input.strictReferenceCoverage === true;
  const shots = input.shots.map((shot, order) => normalizeShot(shot, order));
  const shotsById = new Map(shots.map((shot) => [shot.shotId, shot]));
  const lastByCamera = new Map();

  for (const shot of shots) {
    if (shot.order === 0) {
      if (shot.parentShotId) throw new Error("The first shot cannot declare parentShotId.");
      shot.handoffStrategy = null;
      shot.parentFrameRole = null;
      shot.parentShotId = null;
    } else {
      const previous = shots[shot.order - 1];
      const previousSameCamera = lastByCamera.get(shot.cameraId);
      shot.parentShotId ??= previousSameCamera?.shotId ?? previous.shotId;
      const parent = shotsById.get(shot.parentShotId);
      if (!parent) throw new Error(`${shot.shotId} references unknown parent shot ${shot.parentShotId}.`);
      if (parent.order >= shot.order) throw new Error(`${shot.shotId} must depend on an earlier parent shot.`);
      shot.parentFrameRole ??= "last";
      if (!FRAME_ROLES.has(shot.parentFrameRole)) throw new Error(`${shot.shotId}.parentFrameRole must be first or last.`);
      shot.handoffStrategy ??= parent.cameraId === shot.cameraId ? "reuse" : "reference_recompose";
      if (!HANDOFF_STRATEGIES.has(shot.handoffStrategy)) throw new Error(`${shot.shotId} has an unsupported handoffStrategy.`);
      if (shot.handoffStrategy === "transition_extract" && input.providerEnvelope.supportsTransitionVideo !== true) {
        throw new Error(`${shot.shotId} requires transition_extract, but the selected provider envelope does not support transition video.`);
      }
    }
    lastByCamera.set(shot.cameraId, shot);
  }

  const requiredLastFrames = new Set(
    shots
      .filter((shot) => shot.lastFramePolicy === "required" || ["medium", "large"].includes(shot.variation))
      .map((shot) => shot.shotId)
  );
  for (const shot of shots.slice(1)) {
    if (shot.parentFrameRole === "last") requiredLastFrames.add(shot.parentShotId);
  }
  for (const shot of shots) {
    shot.lastFrameRequired = requiredLastFrames.has(shot.shotId);
    if (shot.lastFramePolicy === "forbidden" && shot.lastFrameRequired) {
      throw new Error(`${shot.shotId} forbids a last frame but downstream continuity depends on it.`);
    }
    if (shot.lastFrameRequired && !shot.lastFrameAssetRef) {
      throw new Error(`${shot.shotId} needs lastFrameAssetRef because its end frame is continuity-critical.`);
    }
  }
  if (shots.some((shot) => shot.lastFrameRequired) && input.providerEnvelope.supportsLastFrame !== true) {
    throw new Error("The camera graph requires first/last-frame video generation, but the selected provider envelope does not support last frames.");
  }

  const taskNodes = [];
  const taskEdges = [];
  const shotRecords = [];
  for (const shot of shots) {
    const firstNodeId = frameNodeId(shot.shotId, "first");
    const parent = shot.parentShotId ? shotsById.get(shot.parentShotId) : null;
    const parentNodeId = parent ? frameNodeId(parent.shotId, shot.parentFrameRole) : null;
    const parentAssetRef = parent ? frameAssetRef(parent, shot.parentFrameRole) : null;
    let firstOperation = "generate_frame";
    let firstDependencies = [];

    if (parent) {
      firstDependencies = [parentNodeId];
      if (shot.handoffStrategy === "reuse") {
        if (shot.firstFrameAssetRef !== parentAssetRef) {
          throw new Error(`${shot.shotId} uses reuse handoff, so firstFrameAssetRef must equal ${parentAssetRef}.`);
        }
        firstOperation = "reuse_frame";
      } else if (shot.handoffStrategy === "transition_extract") {
        firstOperation = "transition_extract";
      } else {
        firstOperation = "reference_recompose";
      }
    }

    taskNodes.push(taskNode({
      nodeId: firstNodeId,
      shot,
      taskType: "frame",
      operation: firstOperation,
      frameRole: "first",
      outputAssetRefs: [shot.firstFrameAssetRef],
      dependsOn: firstDependencies
    }));
    for (const dependency of firstDependencies) taskEdges.push(taskEdge(dependency, firstNodeId, "frame_handoff"));

    const lastNodeId = shot.lastFrameRequired ? frameNodeId(shot.shotId, "last") : null;
    if (lastNodeId) {
      taskNodes.push(taskNode({
        nodeId: lastNodeId,
        shot,
        taskType: "frame",
        operation: "generate_frame",
        frameRole: "last",
        outputAssetRefs: [shot.lastFrameAssetRef],
        dependsOn: [firstNodeId]
      }));
      taskEdges.push(taskEdge(firstNodeId, lastNodeId, "intra_shot_continuity"));
    }

    const clipNodeId = `clip:${shot.shotId}`;
    const clipDependencies = [firstNodeId, ...(lastNodeId ? [lastNodeId] : [])];
    taskNodes.push(taskNode({
      nodeId: clipNodeId,
      shot,
      taskType: "clip",
      operation: "generate_clip",
      outputAssetRefs: [`candidate-set:${shot.requestId}`],
      dependsOn: clipDependencies
    }));
    for (const dependency of clipDependencies) taskEdges.push(taskEdge(dependency, clipNodeId, "generation_input"));

    shotRecords.push({
      shotId: shot.shotId,
      requestId: shot.requestId,
      order: shot.order,
      cameraId: shot.cameraId,
      sceneId: shot.sceneId,
      durationSeconds: shot.durationSeconds,
      variation: shot.variation,
      targetDescription: shot.targetDescription,
      entityIds: shot.entityIds,
      environmentKeys: shot.environmentKeys,
      styleKeys: shot.styleKeys,
      parentShotId: shot.parentShotId,
      parentFrameRole: shot.parentFrameRole,
      handoffStrategy: shot.handoffStrategy,
      firstFrameAssetRef: shot.firstFrameAssetRef,
      lastFrameAssetRef: shot.lastFrameAssetRef,
      lastFrameRequired: shot.lastFrameRequired,
      taskNodeIds: {
        firstFrame: firstNodeId,
        lastFrame: lastNodeId,
        clip: clipNodeId
      },
      referenceTargetIds: [
        referenceTargetId(shot.shotId, "first"),
        ...(lastNodeId ? [referenceTargetId(shot.shotId, "last")] : [])
      ]
    });
  }

  const executionWaves = buildExecutionWaves(taskNodes, input.maxParallelism ?? 4);
  const referencePlan = buildReferenceSelectionPlan({
    graphId: input.graphId,
    sequenceId: input.sequenceId,
    shots,
    shotsById,
    references: input.references,
    maxReferences,
    strictReferenceCoverage
  });
  const cameras = [...new Set(shots.map((shot) => shot.cameraId))].map((cameraId, row) => ({
    cameraId,
    row,
    shotIds: shots.filter((shot) => shot.cameraId === cameraId).map((shot) => shot.shotId)
  }));

  const graph = {
    schemaVersion: "1.0",
    graphId: input.graphId,
    sequenceId: input.sequenceId,
    status: "awaiting_reference_review",
    compiler: "directorx-camera-continuity-v1",
    providerEnvelope: input.providerEnvelope,
    policy: {
      noFutureReferenceLeakage: true,
      rightsEligibilityRequired: true,
      qualityAuditRequired: true,
      multimodalReviewerRequired: true,
      reviewerId: REVIEWER_ID,
      maxReferencesPerFrame: maxReferences,
      strictReferenceCoverage
    },
    cameras,
    shots: shotRecords,
    nodes: taskNodes,
    edges: taskEdges,
    executionWaves
  };
  return { graph, referencePlan };
}

export function reviewCameraReferences(graph, referencePlan, input) {
  if (!graph || !referencePlan) throw new Error("Compile the camera continuity graph before reference review.");
  if (input.graphId !== graph.graphId || referencePlan.graphId !== graph.graphId) throw new Error("Reference review graphId does not match the active camera graph.");
  if (input.reviewerId !== REVIEWER_ID) throw new Error(`Camera reference review must be completed by ${REVIEWER_ID}.`);
  if (!Array.isArray(input.reviews) || input.reviews.length !== referencePlan.targets.length) {
    throw new Error("Reference review must cover every first/last-frame target exactly once.");
  }
  const reviewsByTarget = new Map();
  for (const review of input.reviews) {
    if (reviewsByTarget.has(review.targetId)) throw new Error(`Duplicate camera reference review target: ${review.targetId}`);
    reviewsByTarget.set(review.targetId, review);
  }

  for (const target of referencePlan.targets) {
    const review = reviewsByTarget.get(target.targetId);
    if (!review) throw new Error(`Missing camera reference review for ${target.targetId}.`);
    if (!String(review.reason ?? "").trim() || !Array.isArray(review.evidenceRefs) || !review.evidenceRefs.length) {
      throw new Error(`${target.targetId} review requires a reason and multimodal evidenceRefs.`);
    }
    const candidateByRef = new Map(target.candidates.map((candidate) => [candidate.assetRef, candidate]));
    const selectedAssetRefs = [...new Set(review.selectedAssetRefs ?? [])];
    if (selectedAssetRefs.length > referencePlan.maxReferencesPerFrame) {
      throw new Error(`${target.targetId} selected more than ${referencePlan.maxReferencesPerFrame} references.`);
    }
    for (const assetRef of selectedAssetRefs) {
      if (!candidateByRef.has(assetRef)) throw new Error(`${target.targetId} selected ineligible or unknown reference ${assetRef}.`);
    }
    for (const forcedAssetRef of target.forcedAssetRefs) {
      if (!selectedAssetRefs.includes(forcedAssetRef)) throw new Error(`${target.targetId} must retain continuity anchor ${forcedAssetRef}.`);
    }
    const selected = selectedAssetRefs.map((assetRef) => candidateByRef.get(assetRef));
    const coverage = referenceCoverage(target.requirements, selected);
    if (target.strictReferenceCoverage && coverage.missingEntityIds.length) {
      throw new Error(`${target.targetId} is missing approved references for entities: ${coverage.missingEntityIds.join(", ")}.`);
    }
    target.status = "approved";
    target.selectedAssetRefs = selectedAssetRefs;
    target.coverage = coverage;
    target.review = {
      reviewerId: input.reviewerId,
      reason: review.reason,
      evidenceRefs: review.evidenceRefs,
      reviewedAt: input.reviewedAt ?? new Date().toISOString()
    };
  }
  graph.status = "ready";
  graph.referenceReview = {
    reviewerId: input.reviewerId,
    targetCount: referencePlan.targets.length,
    reviewedAt: input.reviewedAt ?? new Date().toISOString()
  };
  referencePlan.status = "approved";
  referencePlan.reviewedAt = graph.referenceReview.reviewedAt;
  return { graph, referencePlan };
}

export function assertGenerationPlanUsesCameraContinuity(run, generationPlan) {
  const graph = run.cameraContinuityGraph;
  if (!graph) return;
  if (graph.status !== "ready" || run.cameraReferenceSelectionPlan?.status !== "approved") {
    throw new Error("Camera continuity graph and DX-Reference-Analyst review must be ready before video generation planning.");
  }
  const requests = new Map((generationPlan?.requests ?? []).map((request) => [request.shotId, request]));
  if (requests.size !== graph.shots.length) throw new Error("The video generation plan must contain exactly one request for every camera-graph shot.");
  for (const shot of graph.shots) {
    const request = requests.get(shot.shotId);
    if (!request || request.requestId !== shot.requestId) throw new Error(`${shot.shotId} must bind generation request ${shot.requestId}.`);
    if (request.cameraGraphNodeId !== shot.taskNodeIds.clip) throw new Error(`${shot.shotId} must bind cameraGraphNodeId ${shot.taskNodeIds.clip}.`);
    if (!sameSet(request.referenceTargetIds ?? [], shot.referenceTargetIds)) {
      throw new Error(`${shot.shotId} must bind every approved first/last-frame reference target.`);
    }
    if (!(request.inputAnchorAssets ?? []).includes(shot.firstFrameAssetRef)) {
      throw new Error(`${shot.shotId} is missing approved first-frame anchor ${shot.firstFrameAssetRef}.`);
    }
    if (shot.lastFrameRequired) {
      if (request.mode !== "keyframes_to_video") throw new Error(`${shot.shotId} requires keyframes_to_video because the camera graph requires its last frame.`);
      if (!(request.outputAnchorAssets ?? []).includes(shot.lastFrameAssetRef)) {
        throw new Error(`${shot.shotId} is missing approved last-frame anchor ${shot.lastFrameAssetRef}.`);
      }
    } else if (!["image_to_video", "keyframes_to_video"].includes(request.mode)) {
      throw new Error(`${shot.shotId} must use image_to_video or keyframes_to_video with its approved first frame.`);
    }
  }
}

export async function writeCameraContinuityArtifacts({ projectPath, runId, graph, referencePlan }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const documents = {
    "camera_dependency_graph.json": { ...graph, runId },
    "reference_selection_plan.json": { ...referencePlan, runId }
  };
  const written = {};
  for (const [artifactRef, value] of Object.entries(documents)) {
    const path = join(directory, artifactRef);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    written[artifactRef] = { artifactRef, path };
  }
  return written;
}

function validatePlanInput(input) {
  if (!SAFE_ID.test(input?.graphId ?? "") || !SAFE_ID.test(input?.sequenceId ?? "")) throw new Error("Camera continuity requires safe graphId and sequenceId values.");
  if (!Array.isArray(input?.shots) || input.shots.length < 2) throw new Error("Camera continuity requires at least two ordered shots.");
  if (!Array.isArray(input?.references)) throw new Error("Camera continuity references must be an array.");
  const envelope = input.providerEnvelope;
  if (!envelope || envelope.supportsFirstFrame !== true) throw new Error("The selected provider envelope must support first-frame video generation.");
  if (!Number.isInteger(input.maxParallelism ?? 4) || (input.maxParallelism ?? 4) < 1 || (input.maxParallelism ?? 4) > 16) {
    throw new Error("maxParallelism must be an integer between 1 and 16.");
  }
  const shotIds = new Set();
  const requestIds = new Set();
  for (const shot of input.shots) {
    if (!SAFE_ID.test(shot?.shotId ?? "") || shotIds.has(shot.shotId)) throw new Error("Every camera-graph shot needs a unique safe shotId.");
    if (!SAFE_ID.test(shot?.requestId ?? "") || requestIds.has(shot.requestId)) throw new Error("Every camera-graph shot needs a unique safe requestId.");
    shotIds.add(shot.shotId);
    requestIds.add(shot.requestId);
  }
  const assetRefs = new Set();
  for (const reference of input.references) {
    if (!String(reference?.assetRef ?? "").trim() || assetRefs.has(reference.assetRef)) throw new Error("Every reference needs a unique assetRef.");
    assetRefs.add(reference.assetRef);
  }
}

function normalizeShot(shot, order) {
  if (!SAFE_ID.test(shot.cameraId ?? "") || !SAFE_ID.test(shot.sceneId ?? "")) throw new Error(`${shot.shotId} needs safe cameraId and sceneId values.`);
  if (!(shot.durationSeconds > 0)) throw new Error(`${shot.shotId}.durationSeconds must be greater than zero.`);
  if (!VARIATIONS.has(shot.variation)) throw new Error(`${shot.shotId}.variation must be none, small, medium, or large.`);
  if (!LAST_FRAME_POLICIES.has(shot.lastFramePolicy ?? "auto")) throw new Error(`${shot.shotId}.lastFramePolicy is unsupported.`);
  if (!String(shot.firstFrameAssetRef ?? "").trim()) throw new Error(`${shot.shotId} needs firstFrameAssetRef.`);
  if (!String(shot.targetDescription ?? "").trim()) throw new Error(`${shot.shotId} needs targetDescription.`);
  return {
    ...shot,
    order,
    entityIds: uniqueStrings(shot.entityIds),
    environmentKeys: uniqueStrings(shot.environmentKeys),
    styleKeys: uniqueStrings(shot.styleKeys),
    lastFramePolicy: shot.lastFramePolicy ?? "auto",
    parentShotId: shot.parentShotId ?? null,
    parentFrameRole: shot.parentFrameRole ?? null,
    handoffStrategy: shot.handoffStrategy ?? null,
    lastFrameAssetRef: shot.lastFrameAssetRef ?? null
  };
}

function buildReferenceSelectionPlan({ graphId, sequenceId, shots, shotsById, references, maxReferences, strictReferenceCoverage }) {
  const normalizedReferences = references.map((reference) => normalizeReference(reference, shotsById));
  const targets = [];
  for (const shot of shots) {
    targets.push(buildReferenceTarget({ shot, frameRole: "first", shotsById, references: normalizedReferences, maxReferences, strictReferenceCoverage }));
    if (shot.lastFrameRequired) targets.push(buildReferenceTarget({ shot, frameRole: "last", shotsById, references: normalizedReferences, maxReferences, strictReferenceCoverage }));
  }
  return {
    schemaVersion: "1.0",
    graphId,
    sequenceId,
    status: "awaiting_multimodal_review",
    reviewerId: REVIEWER_ID,
    maxReferencesPerFrame: maxReferences,
    eligibilityPolicy: {
      rightsStatuses: [...ALLOWED_RIGHTS],
      qualityStatuses: [...ALLOWED_QUALITY],
      futureShotReferencesForbidden: true
    },
    targets
  };
}

function normalizeReference(reference, shotsById) {
  const sourceShot = reference.sourceShotId ? shotsById.get(reference.sourceShotId) : null;
  if (reference.sourceShotId && !sourceShot) throw new Error(`${reference.assetRef} references unknown sourceShotId ${reference.sourceShotId}.`);
  return {
    assetRef: reference.assetRef,
    kind: reference.kind ?? "reference",
    sourceShotId: reference.sourceShotId ?? null,
    sourceOrder: sourceShot?.order ?? -1,
    cameraId: reference.cameraId ?? sourceShot?.cameraId ?? null,
    sceneId: reference.sceneId ?? sourceShot?.sceneId ?? null,
    entityIds: uniqueStrings(reference.entityIds),
    environmentKeys: uniqueStrings(reference.environmentKeys),
    styleKeys: uniqueStrings(reference.styleKeys),
    rightsStatus: reference.rightsStatus,
    qualityStatus: reference.qualityStatus,
    rightsEvidenceRef: reference.rightsEvidenceRef ?? null,
    qualityEvidenceRef: reference.qualityEvidenceRef ?? null
  };
}

function buildReferenceTarget({ shot, frameRole, shotsById, references, maxReferences, strictReferenceCoverage }) {
  const forced = [];
  if (frameRole === "first" && shot.parentShotId) {
    const parent = shotsById.get(shot.parentShotId);
    forced.push(continuityAnchor(frameAssetRef(parent, shot.parentFrameRole), parent, shot.parentFrameRole));
  }
  if (frameRole === "last") forced.push(continuityAnchor(shot.firstFrameAssetRef, shot, "first"));

  const eligible = references
    .filter((reference) => ALLOWED_RIGHTS.has(reference.rightsStatus) && ALLOWED_QUALITY.has(reference.qualityStatus))
    .filter((reference) => reference.sourceOrder < 0 || reference.sourceOrder <= shot.order)
    .map((reference) => scoreReference(reference, shot))
    .filter((reference) => reference.score > 0)
    .sort((a, b) => b.score - a.score || b.sourceOrder - a.sourceOrder || a.assetRef.localeCompare(b.assetRef));
  const candidates = deduplicateReferences([...forced, ...eligible]).slice(0, Math.max(maxReferences * 2, maxReferences));
  const recommendedAssetRefs = candidates.slice(0, maxReferences).map((candidate) => candidate.assetRef);
  return {
    targetId: referenceTargetId(shot.shotId, frameRole),
    shotId: shot.shotId,
    frameRole,
    status: "awaiting_multimodal_review",
    strictReferenceCoverage,
    requirements: {
      targetDescription: shot.targetDescription,
      cameraId: shot.cameraId,
      sceneId: shot.sceneId,
      entityIds: shot.entityIds,
      environmentKeys: shot.environmentKeys,
      styleKeys: shot.styleKeys
    },
    forcedAssetRefs: forced.map((reference) => reference.assetRef),
    candidates,
    recommendedAssetRefs,
    selectedAssetRefs: [],
    coverage: referenceCoverage({
      entityIds: shot.entityIds,
      environmentKeys: shot.environmentKeys,
      styleKeys: shot.styleKeys
    }, candidates.filter((candidate) => recommendedAssetRefs.includes(candidate.assetRef))),
    review: null
  };
}

function scoreReference(reference, shot) {
  const entityCoverage = coverageRatio(shot.entityIds, reference.entityIds);
  const environmentCoverage = coverageRatio(shot.environmentKeys, reference.environmentKeys);
  const styleCoverage = coverageRatio(shot.styleKeys, reference.styleKeys);
  const sameCamera = reference.cameraId && reference.cameraId === shot.cameraId ? 0.25 : 0;
  const sameScene = reference.sceneId && reference.sceneId === shot.sceneId ? 0.18 : 0;
  const recency = reference.sourceOrder < 0 ? 0 : Math.max(0, 0.08 - Math.max(0, shot.order - reference.sourceOrder) * 0.015);
  const portrait = reference.kind === "character_portrait" && entityCoverage > 0 ? 0.05 : 0;
  const score = Math.min(1, sameCamera + sameScene + entityCoverage * 0.28 + environmentCoverage * 0.1 + styleCoverage * 0.06 + recency + portrait);
  const reasons = [];
  if (sameCamera) reasons.push("same_camera");
  if (sameScene) reasons.push("same_scene");
  if (entityCoverage) reasons.push(`entity_coverage:${entityCoverage.toFixed(2)}`);
  if (environmentCoverage) reasons.push(`environment_coverage:${environmentCoverage.toFixed(2)}`);
  if (styleCoverage) reasons.push(`style_coverage:${styleCoverage.toFixed(2)}`);
  if (recency) reasons.push("recent_prior_frame");
  if (portrait) reasons.push("character_portrait");
  return { ...reference, score: Number(score.toFixed(4)), reasons, forced: false };
}

function continuityAnchor(assetRef, sourceShot, frameRole) {
  return {
    assetRef,
    kind: "continuity_anchor",
    sourceShotId: sourceShot.shotId,
    sourceOrder: sourceShot.order,
    cameraId: sourceShot.cameraId,
    sceneId: sourceShot.sceneId,
    entityIds: sourceShot.entityIds,
    environmentKeys: sourceShot.environmentKeys,
    styleKeys: sourceShot.styleKeys,
    rightsStatus: "generated",
    qualityStatus: "passed",
    rightsEvidenceRef: "camera_dependency_graph.json",
    qualityEvidenceRef: "camera_dependency_graph.json",
    score: 1,
    reasons: [`forced_${frameRole}_frame_handoff`],
    forced: true
  };
}

function referenceCoverage(requirements, selected) {
  const coveredEntities = new Set(selected.flatMap((reference) => reference.entityIds ?? []));
  const coveredEnvironments = new Set(selected.flatMap((reference) => reference.environmentKeys ?? []));
  const coveredStyles = new Set(selected.flatMap((reference) => reference.styleKeys ?? []));
  return {
    entityCoverage: coverageRatio(requirements.entityIds, [...coveredEntities]),
    environmentCoverage: coverageRatio(requirements.environmentKeys, [...coveredEnvironments]),
    styleCoverage: coverageRatio(requirements.styleKeys, [...coveredStyles]),
    missingEntityIds: requirements.entityIds.filter((id) => !coveredEntities.has(id)),
    missingEnvironmentKeys: requirements.environmentKeys.filter((key) => !coveredEnvironments.has(key)),
    missingStyleKeys: requirements.styleKeys.filter((key) => !coveredStyles.has(key))
  };
}

function buildExecutionWaves(nodes, maxParallelism) {
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  for (const node of nodes) {
    for (const dependency of node.dependsOn) if (!nodeById.has(dependency)) throw new Error(`${node.nodeId} depends on missing task ${dependency}.`);
  }
  const remaining = new Set(nodeById.keys());
  const completed = new Set();
  const waves = [];
  while (remaining.size) {
    const ready = [...remaining].filter((nodeId) => nodeById.get(nodeId).dependsOn.every((dependency) => completed.has(dependency))).sort();
    if (!ready.length) throw new Error("Camera continuity task graph contains a cycle.");
    for (let index = 0; index < ready.length; index += maxParallelism) {
      const taskNodeIds = ready.slice(index, index + maxParallelism);
      waves.push({ wave: waves.length + 1, taskNodeIds, parallel: taskNodeIds.length > 1 });
      for (const nodeId of taskNodeIds) {
        remaining.delete(nodeId);
        completed.add(nodeId);
      }
    }
  }
  return waves;
}

function taskNode({ nodeId, shot, taskType, operation, frameRole = null, outputAssetRefs, dependsOn }) {
  return {
    nodeId,
    taskType,
    operation,
    shotId: shot.shotId,
    requestId: shot.requestId,
    cameraId: shot.cameraId,
    sceneId: shot.sceneId,
    frameRole,
    dependsOn,
    outputAssetRefs,
    owner: taskType === "clip" ? "DX-Provider-Operator" : "DX-Visual-Designer",
    status: "pending"
  };
}

function taskEdge(source, target, kind) {
  return { edgeId: `${kind}:${source}:${target}`, source, target, kind };
}

function frameNodeId(shotId, frameRole) {
  return `frame:${shotId}:${frameRole}`;
}

function referenceTargetId(shotId, frameRole) {
  return `reference:${shotId}:${frameRole}`;
}

function frameAssetRef(shot, frameRole) {
  const value = frameRole === "first" ? shot.firstFrameAssetRef : shot.lastFrameAssetRef;
  if (!value) throw new Error(`${shot.shotId} does not define a ${frameRole} frame asset.`);
  return value;
}

function coverageRatio(required, available) {
  if (!required?.length) return 1;
  const values = new Set(available ?? []);
  return required.filter((value) => values.has(value)).length / required.length;
}

function deduplicateReferences(references) {
  const seen = new Set();
  return references.filter((reference) => {
    if (seen.has(reference.assetRef)) return false;
    seen.add(reference.assetRef);
    return true;
  });
}

function uniqueStrings(values = []) {
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}
