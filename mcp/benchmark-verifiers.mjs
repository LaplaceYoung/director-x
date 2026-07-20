import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { inspectMediaDelivery } from "./media-execution.mjs";

export const BENCHMARK_VERIFIER_CATALOG = [
  verifier("artifact_registered", "Confirm an artifact exists in durable Run state."), verifier("sha256_registered", "Confirm an artifact has a durable SHA-256 identity."), verifier("media_playable", "Probe a playable video stream."), verifier("audio_present", "Require an audio stream."), verifier("duration_range", "Check minSeconds/maxSeconds."), verifier("resolution_min", "Check minWidth/minHeight."), verifier("file_size_max", "Check maxBytes."),
  verifier("timeline_clip_order", "Verify the declared clip order in a project-contained semantic timeline."),
  verifier("subtitle_timing_integrity", "Verify ordered positive subtitle cues inside the declared media duration, with an optional overlap limit."),
  verifier("audio_loudness_range", "Verify measured integrated loudness and true peak from an audio analysis report against fixture thresholds."),
  verifier("camera_graph_integrity", "Verify an acyclic multi-camera graph, complete topological execution waves, and first/last-frame task ownership."),
  verifier("reference_plan_integrity", "Verify every camera-frame target has an approved DX multimodal review and only eligible forced-preserving references."),
  verifier("cinematic_reference_binding", "Verify selected film exemplars remain reference-only and bind evidence-located rules to required production consumers."),
  verifier("shot_sequence_artistry", "Verify a ready Director sequence review meets narrative, variation, continuity, rhythm, emotional-arc, and movement-motivation thresholds."),
  verifier("transition_plan_integrity", "Verify every adjacent shot boundary has a motivated Director method, executable renderer recipe, fallback, audio decision, and review criteria."),
  verifier("render_creative_contract", "Verify a Remotion or HyperFrames render contract covers narration, captions, every visual boundary, and the approved Director transition plan."),
  verifier("visual_prompt_mode_coverage", "Verify video prompt routes remain modality-isolated and carry required motion and first/last-frame inputs per generation mode."),
  verifier("script_duration_structure", "Verify 15, 30, and 60 second script variants preserve one proposition, visible proof, CTA, and non-repetitive beat escalation.")
];

export async function executeBenchmarkVerifiers(run, input, options = {}) {
  const suite = run.benchmarkSuites?.[input.suiteId], fixture = suite?.fixtures.find((item) => item.fixtureId === input.fixtureId);
  if (!fixture || !input.receiptId || !input.checks?.length) throw new Error("Verifier execution requires a registered fixture, receipt ID, and checks.");
  const declared = new Set(fixture.programmaticChecks), catalog = new Set(BENCHMARK_VERIFIER_CATALOG.map((item) => item.verifierId)), results = [], probeCache = new Map();
  for (const check of input.checks) {
    if (!declared.has(check.checkId) || !catalog.has(check.verifierId)) throw new Error(`Undeclared or unknown verifier: ${check.checkId}/${check.verifierId}`);
    const artifact = run.artifacts?.[check.artifactRef]; if (!artifact) throw new Error(`Verifier artifact is not registered: ${check.artifactRef}`);
    const startedAt = new Date().toISOString(); let passed = false, observed = {};
    try {
      if (check.verifierId === "artifact_registered") passed = true;
      else if (check.verifierId === "sha256_registered") passed = /^(sha256:)?[a-f0-9]{64}$/i.test(artifact.sha256 ?? "");
      else if (check.verifierId === "file_size_max") { const details = await stat(artifact.path); observed.sizeBytes = details.size; passed = details.isFile() && details.size <= positive(check.parameters?.maxBytes, "maxBytes"); }
      else if (["timeline_clip_order", "subtitle_timing_integrity", "audio_loudness_range", "camera_graph_integrity", "reference_plan_integrity", "cinematic_reference_binding", "shot_sequence_artistry", "transition_plan_integrity", "render_creative_contract", "visual_prompt_mode_coverage", "script_duration_structure"].includes(check.verifierId)) {
        const document = await readProjectJson(input.projectPath, artifact.path);
        ({ passed, observed } = executeJsonVerifier(check, document));
      }
      else {
        let probe = probeCache.get(check.artifactRef); if (!probe) { probe = await (options.inspectMedia ?? inspectMediaDelivery)({ projectPath: input.projectPath, finalVideoPath: artifact.path, requireAudio: false }); probeCache.set(check.artifactRef, probe); }
        observed = { durationSeconds: probe.durationSeconds, videoStreams: probe.videoStreams.length, audioStreams: probe.audioStreams.length, width: probe.videoStreams[0]?.width ?? 0, height: probe.videoStreams[0]?.height ?? 0 };
        if (check.verifierId === "media_playable") passed = observed.videoStreams > 0 && observed.durationSeconds > 0;
        if (check.verifierId === "audio_present") passed = observed.audioStreams > 0;
        if (check.verifierId === "duration_range") passed = observed.durationSeconds >= nonnegative(check.parameters?.minSeconds ?? 0, "minSeconds") && observed.durationSeconds <= positive(check.parameters?.maxSeconds, "maxSeconds");
        if (check.verifierId === "resolution_min") passed = observed.width >= positive(check.parameters?.minWidth, "minWidth") && observed.height >= positive(check.parameters?.minHeight, "minHeight");
      }
    } catch (error) { observed = { errorType: error.name ?? "Error", errorMessage: String(error.message ?? error).slice(0, 500) }; passed = false; }
    results.push({ checkId: check.checkId, verifierId: check.verifierId, artifactRef: check.artifactRef, passed, observed, startedAt, completedAt: new Date().toISOString(), evidenceRefs: [`benchmark_verifier_receipt.json#${input.receiptId}/${check.checkId}`] });
  }
  for (const checkId of declared) if (!results.some((item) => item.checkId === checkId)) throw new Error(`Declared verifier was not executed: ${checkId}`);
  const receipt = { schemaVersion: "1.0", receiptId: input.receiptId, suiteId: input.suiteId, suiteVersion: suite.version, fixtureId: input.fixtureId, executor: "directorx_plugin", permissionBoundary: "builtin_verifiers_only", results, status: results.every((item) => item.passed) ? "passed" : "failed", completedAt: new Date().toISOString() };
  run.benchmarkVerifierReceipts ??= {}; if (run.benchmarkVerifierReceipts[input.receiptId]) throw new Error(`Duplicate verifier receipt: ${input.receiptId}`); run.benchmarkVerifierReceipts[input.receiptId] = receipt; return receipt;
}

function verifier(verifierId, purpose) { return { verifierId, purpose, permissions: ["read_project_artifact"], arbitraryCommand: false }; }
function executeJsonVerifier(check, document) {
  if (check.verifierId === "camera_graph_integrity") return verifyCameraGraph(document, check.parameters ?? {});
  if (check.verifierId === "reference_plan_integrity") return verifyReferencePlan(document, check.parameters ?? {});
  if (check.verifierId === "cinematic_reference_binding") return verifyCinematicReferenceBinding(document, check.parameters ?? {});
  if (check.verifierId === "shot_sequence_artistry") return verifyShotSequenceArtistry(document, check.parameters ?? {});
  if (check.verifierId === "transition_plan_integrity") return verifyTransitionPlan(document, check.parameters ?? {});
  if (check.verifierId === "render_creative_contract") return verifyRenderCreativeContract(document, check.parameters ?? {});
  if (check.verifierId === "visual_prompt_mode_coverage") return verifyVisualPromptModes(document, check.parameters ?? {});
  if (check.verifierId === "script_duration_structure") return verifyScriptDurationStructure(document, check.parameters ?? {});
  if (check.verifierId === "timeline_clip_order") {
    const expected = stringArray(check.parameters?.expectedClipIds, "expectedClipIds");
    const tracks = Array.isArray(document.tracks) ? document.tracks : Array.isArray(document.timeline?.tracks) ? document.timeline.tracks : [];
    const selected = check.parameters?.trackId ? tracks.filter((track) => track.track_id === check.parameters.trackId || track.id === check.parameters.trackId) : check.parameters?.trackType ? tracks.filter((track) => track.track_type === check.parameters.trackType || track.type === check.parameters.trackType) : tracks;
    const actual = selected.flatMap((track) => (track.clips ?? []).map((clip) => clip.clip_id ?? clip.clipId ?? clip.id).filter(Boolean));
    return { passed: sameArray(actual, expected), observed: { expectedClipIds: expected, actualClipIds: actual, selectedTrackCount: selected.length } };
  }
  if (check.verifierId === "subtitle_timing_integrity") {
    const cues = Array.isArray(document.cues) ? document.cues : Array.isArray(document.subtitles) ? document.subtitles : [];
    const maxDurationSeconds = positive(check.parameters?.maxDurationSeconds, "maxDurationSeconds");
    const maxOverlapSeconds = nonnegative(check.parameters?.maxOverlapSeconds ?? 0, "maxOverlapSeconds");
    let previousStart = -Infinity, previousEnd = 0, maximumOverlap = 0, invalidCueCount = 0;
    for (const cue of cues) {
      const start = rationalSeconds(cue.range?.start), duration = rationalSeconds(cue.range?.duration), end = start + duration;
      if (!Number.isFinite(start) || !Number.isFinite(duration) || start < previousStart || duration <= 0 || end > maxDurationSeconds) invalidCueCount += 1;
      maximumOverlap = Math.max(maximumOverlap, Math.max(0, previousEnd - start)); previousStart = start; previousEnd = Math.max(previousEnd, end);
    }
    return { passed: cues.length > 0 && invalidCueCount === 0 && maximumOverlap <= maxOverlapSeconds, observed: { cueCount: cues.length, invalidCueCount, maximumOverlapSeconds: round(maximumOverlap), maxOverlapSeconds, maxDurationSeconds } };
  }
  const analyses = Array.isArray(document.analyses) ? document.analyses : [];
  const selected = check.parameters?.assetId ? analyses.filter((item) => item.asset_id === check.parameters.assetId || item.assetId === check.parameters.assetId) : analyses;
  const minLufs = finite(check.parameters?.minIntegratedLufs, "minIntegratedLufs"), maxLufs = finite(check.parameters?.maxIntegratedLufs, "maxIntegratedLufs"), maxTruePeak = finite(check.parameters?.maxTruePeakDbtp, "maxTruePeakDbtp");
  if (minLufs > maxLufs) throw new Error("minIntegratedLufs must not exceed maxIntegratedLufs.");
  const measurements = selected.map((item) => ({ assetId: item.asset_id ?? item.assetId, integratedLufs: Number(item.integrated_loudness_lufs ?? item.integratedLufs), truePeakDbtp: Number(item.true_peak_dbtp ?? item.truePeakDbtp) }));
  return { passed: measurements.length > 0 && measurements.every((item) => Number.isFinite(item.integratedLufs) && Number.isFinite(item.truePeakDbtp) && item.integratedLufs >= minLufs && item.integratedLufs <= maxLufs && item.truePeakDbtp <= maxTruePeak), observed: { measurements, minIntegratedLufs: minLufs, maxIntegratedLufs: maxLufs, maxTruePeakDbtp: maxTruePeak } };
}
function verifyCameraGraph(document, parameters) {
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const shots = Array.isArray(document.shots) ? document.shots : [];
  const cameras = Array.isArray(document.cameras) ? document.cameras : [];
  const waves = Array.isArray(document.executionWaves) ? document.executionWaves : [];
  const nodeIds = nodes.map((node) => node.nodeId);
  const uniqueNodeIds = new Set(nodeIds);
  const waveByNode = new Map();
  let duplicateWaveNodeCount = 0;
  for (const wave of waves) for (const nodeId of wave.taskNodeIds ?? []) {
    if (waveByNode.has(nodeId)) duplicateWaveNodeCount += 1;
    waveByNode.set(nodeId, wave.wave);
  }
  const missingDependencies = [];
  const nonTopologicalDependencies = [];
  for (const node of nodes) for (const dependency of node.dependsOn ?? []) {
    if (!uniqueNodeIds.has(dependency)) missingDependencies.push(`${node.nodeId}<-${dependency}`);
    else if (!Number.isFinite(waveByNode.get(dependency)) || !Number.isFinite(waveByNode.get(node.nodeId)) || waveByNode.get(dependency) >= waveByNode.get(node.nodeId)) nonTopologicalDependencies.push(`${node.nodeId}<-${dependency}`);
  }
  const shotBindingsValid = shots.every((shot) => {
    const ids = [shot.taskNodeIds?.firstFrame, shot.taskNodeIds?.clip, ...(shot.taskNodeIds?.lastFrame ? [shot.taskNodeIds.lastFrame] : [])];
    return ids.every((nodeId) => uniqueNodeIds.has(nodeId)) && (!shot.lastFrameRequired || Boolean(shot.taskNodeIds?.lastFrame && shot.lastFrameAssetRef));
  });
  const minimumShots = Number(parameters.minimumShots ?? 2);
  const minimumCameras = Number(parameters.minimumCameras ?? 1);
  const passed = document.status === "ready" && shots.length >= minimumShots && cameras.length >= minimumCameras && uniqueNodeIds.size === nodes.length && waveByNode.size === nodes.length && duplicateWaveNodeCount === 0 && missingDependencies.length === 0 && nonTopologicalDependencies.length === 0 && shotBindingsValid;
  return { passed, observed: { status: document.status, shotCount: shots.length, cameraCount: cameras.length, nodeCount: nodes.length, waveCount: waves.length, scheduledNodeCount: waveByNode.size, duplicateNodeIdCount: nodes.length - uniqueNodeIds.size, duplicateWaveNodeCount, missingDependencies, nonTopologicalDependencies, shotBindingsValid, minimumShots, minimumCameras } };
}
function verifyReferencePlan(document, parameters) {
  const targets = Array.isArray(document.targets) ? document.targets : [];
  const maximumReferences = Number(parameters.maximumReferences ?? document.maxReferencesPerFrame ?? 8);
  const rightsStatuses = new Set(document.eligibilityPolicy?.rightsStatuses ?? []);
  const qualityStatuses = new Set(document.eligibilityPolicy?.qualityStatuses ?? []);
  const failures = [];
  for (const target of targets) {
    const selected = [...new Set(target.selectedAssetRefs ?? [])];
    const candidates = new Map((target.candidates ?? []).map((candidate) => [candidate.assetRef, candidate]));
    if (target.status !== "approved" || target.review?.reviewerId !== "DX-Reference-Analyst" || !(target.review?.evidenceRefs ?? []).length) failures.push(`${target.targetId}:review`);
    if (selected.length > maximumReferences) failures.push(`${target.targetId}:max_references`);
    if ((target.forcedAssetRefs ?? []).some((assetRef) => !selected.includes(assetRef))) failures.push(`${target.targetId}:forced_anchor`);
    if (selected.some((assetRef) => !candidates.has(assetRef))) failures.push(`${target.targetId}:unknown_reference`);
    if (selected.some((assetRef) => !rightsStatuses.has(candidates.get(assetRef)?.rightsStatus) || !qualityStatuses.has(candidates.get(assetRef)?.qualityStatus))) failures.push(`${target.targetId}:eligibility`);
    if (target.strictReferenceCoverage && (target.coverage?.missingEntityIds ?? []).length) failures.push(`${target.targetId}:entity_coverage`);
  }
  return { passed: document.status === "approved" && targets.length > 0 && failures.length === 0, observed: { status: document.status, targetCount: targets.length, maximumReferences, failures } };
}

function verifyCinematicReferenceBinding(document, parameters) {
  const selected = Array.isArray(document.selectedReferences) ? document.selectedReferences : [];
  const bindings = Array.isArray(document.bindings) ? document.bindings : [];
  const requiredTargets = stringArray(parameters.requiredTargets ?? ["shot_planning"], "requiredTargets");
  const minimumReferences = positive(parameters.minimumReferences ?? 1, "minimumReferences");
  const unsafeReferences = selected.filter((entry) =>
    entry.rights?.scope !== "reference_only"
    || entry.rights?.deliveryReuseAllowed !== false
    || entry.rights?.localAnalysisRequiresConsent !== true
    || !(entry.rights?.blockedReuse ?? []).length
  ).map((entry) => entry.referenceId);
  const incompleteBindings = bindings.filter((binding) =>
    !binding.referenceId
    || !binding.ruleId
    || !String(binding.instruction ?? "").trim()
    || !String(binding.evidenceLocator ?? "").trim()
    || !(binding.targets ?? []).length
  ).map((binding) => binding.ruleId ?? "unknown");
  const coveredTargets = [...new Set(bindings.flatMap((binding) => binding.targets ?? []))];
  const missingTargets = requiredTargets.filter((target) => !coveredTargets.includes(target));
  const passed = document.status === "ready"
    && selected.length >= minimumReferences
    && unsafeReferences.length === 0
    && incompleteBindings.length === 0
    && missingTargets.length === 0;
  return {
    passed,
    observed: {
      status: document.status,
      selectedReferenceCount: selected.length,
      minimumReferences,
      coveredTargets,
      missingTargets,
      unsafeReferences,
      incompleteBindings
    }
  };
}

function verifyShotSequenceArtistry(document, parameters) {
  const dimensions = document.dimensions ?? {};
  const metrics = document.metrics ?? {};
  const shotContract = Array.isArray(document.shotContract) ? document.shotContract : [];
  const requiredFunctions = stringArray(parameters.requiredFunctions ?? ["hook", "proof", "cta"], "requiredFunctions");
  const functions = [...new Set(shotContract.map((shot) => shot.function).filter(Boolean))];
  const missingFunctions = requiredFunctions.filter((item) => !functions.includes(item));
  const minimumOverallScore = positive(parameters.minimumOverallScore ?? 75, "minimumOverallScore");
  const minimumDimensionScore = positive(parameters.minimumDimensionScore ?? 65, "minimumDimensionScore");
  const requiredDimensions = ["narrativeFunction", "coverage", "visualVariation", "continuity", "rhythm", "emotionalArc", "movementMotivation"];
  const weakDimensions = requiredDimensions.filter((key) => !Number.isFinite(Number(dimensions[key])) || Number(dimensions[key]) < minimumDimensionScore);
  const minimumShotSizes = positive(parameters.minimumDistinctShotSizes ?? 2, "minimumDistinctShotSizes");
  const minimumMovements = positive(parameters.minimumDistinctMovements ?? 2, "minimumDistinctMovements");
  const minimumEnergyRange = nonnegative(parameters.minimumEmotionalEnergyRange ?? 0.2, "minimumEmotionalEnergyRange");
  const passed = document.status === "ready"
    && Number(document.overallScore) >= minimumOverallScore
    && !(document.blockers ?? []).length
    && shotContract.length >= 2
    && missingFunctions.length === 0
    && weakDimensions.length === 0
    && Number(metrics.distinctShotSizes) >= minimumShotSizes
    && Number(metrics.distinctMovements) >= minimumMovements
    && Number(metrics.emotionalEnergyRange) >= minimumEnergyRange
    && Number(metrics.adjacencyRevisionCount) === 0;
  return {
    passed,
    observed: {
      status: document.status,
      overallScore: Number(document.overallScore),
      minimumOverallScore,
      weakDimensions,
      functions,
      missingFunctions,
      distinctShotSizes: Number(metrics.distinctShotSizes),
      distinctMovements: Number(metrics.distinctMovements),
      emotionalEnergyRange: Number(metrics.emotionalEnergyRange),
      adjacencyRevisionCount: Number(metrics.adjacencyRevisionCount)
    }
  };
}

function verifyTransitionPlan(document, parameters) {
  const boundaries = Array.isArray(document.boundaries) ? document.boundaries : [];
  const expectedBoundaryCount = Number(parameters.expectedBoundaryCount ?? boundaries.length);
  const minimumAudioBridges = nonnegative(parameters.minimumAudioBridges ?? 0, "minimumAudioBridges");
  const incomplete = boundaries.filter((boundary) =>
    !boundary.boundaryId
    || !boundary.directorMethod
    || !boundary.renderKind
    || !String(boundary.rationale ?? "").trim()
    || !String(boundary.cutTrigger ?? "").trim()
    || !boundary.rendererRecipe
    || !boundary.fallback
    || !(boundary.reviewCriteria ?? []).length
    || !boundary.audioBridge?.kind
  ).map((boundary) => boundary.boundaryId ?? "unknown");
  const audioBridgeCount = boundaries.filter((boundary) => boundary.audioBridge?.kind !== "none").length;
  const passed = document.status === "ready"
    && !(document.blockers ?? []).length
    && boundaries.length === expectedBoundaryCount
    && incomplete.length === 0
    && audioBridgeCount >= minimumAudioBridges;
  return {
    passed,
    observed: {
      status: document.status,
      boundaryCount: boundaries.length,
      expectedBoundaryCount,
      audioBridgeCount,
      minimumAudioBridges,
      incomplete
    }
  };
}

function verifyRenderCreativeContract(document, parameters) {
  const metrics = document.metrics ?? {};
  const captionCoverage = metrics.captionCoverage ?? {};
  const transitionCoverage = metrics.transitionCoverage ?? {};
  const planBinding = metrics.transitionPlanBinding ?? {};
  const allowedRenderers = stringArray(parameters.allowedRenderers ?? ["remotion", "hyperframes"], "allowedRenderers");
  const minimumCaptionCoverage = finite(parameters.minimumCaptionCoverage ?? 0.92, "minimumCaptionCoverage");
  const maximumDirectCutRatio = finite(parameters.maximumDirectCutRatio ?? 0.35, "maximumDirectCutRatio");
  const requireDirectorPlan = parameters.requireDirectorPlan !== false;
  const passed = document.status === "ready"
    && allowedRenderers.includes(document.renderer)
    && !(document.blockers ?? []).length
    && captionCoverage.passed === true
    && Number(captionCoverage.coverageRatio) >= minimumCaptionCoverage
    && transitionCoverage.passed === true
    && Number(transitionCoverage.directCutRatio) <= maximumDirectCutRatio
    && (!requireDirectorPlan || planBinding.passed === true);
  return {
    passed,
    observed: {
      status: document.status,
      renderer: document.renderer,
      allowedRenderers,
      captionCoverageRatio: Number(captionCoverage.coverageRatio),
      minimumCaptionCoverage,
      transitionBoundaryCount: Number(transitionCoverage.boundaries),
      directCutRatio: Number(transitionCoverage.directCutRatio),
      maximumDirectCutRatio,
      directorPlanRequired: requireDirectorPlan,
      directorPlanPassed: planBinding.passed === true
    }
  };
}

function verifyVisualPromptModes(document, parameters) {
  const routes = Array.isArray(document.routes) ? document.routes : [];
  const prompts = Array.isArray(document.prompts) ? document.prompts : [];
  const requiredModes = stringArray(parameters.requiredModes ?? ["text_to_video", "image_to_video", "first_last_frame_video", "video_extension"], "requiredModes");
  const routeById = new Map(routes.map((route) => [route.routeId, route]));
  const coveredModes = [...new Set(prompts.map((prompt) => prompt.mode))];
  const missingModes = requiredModes.filter((mode) => !coveredModes.includes(mode));
  const invalidPrompts = [];
  for (const prompt of prompts) {
    const route = routeById.get(prompt.routeId);
    if (!route || route.mode !== prompt.mode || !String(prompt.positivePrompt ?? "").trim()) {
      invalidPrompts.push(`${prompt.shotId}:route`);
      continue;
    }
    if (["text_to_video", "image_to_video", "first_last_frame_video", "video_extension"].includes(prompt.mode) && !(prompt.repairTargets ?? []).includes("motion")) invalidPrompts.push(`${prompt.shotId}:motion`);
    if (["image_to_video", "first_last_frame_video", "video_extension"].includes(prompt.mode) && !prompt.referenceInputs?.firstFrameRef) invalidPrompts.push(`${prompt.shotId}:first_frame`);
    if (prompt.mode === "first_last_frame_video" && !prompt.referenceInputs?.lastFrameRef) invalidPrompts.push(`${prompt.shotId}:last_frame`);
    if (prompt.mode === "video_extension" && !/continue|continu/i.test(prompt.positivePrompt)) invalidPrompts.push(`${prompt.shotId}:extension_intent`);
  }
  const passed = document.status === "ready"
    && document.modalityIsolation === true
    && routes.length > 0
    && prompts.length > 0
    && missingModes.length === 0
    && invalidPrompts.length === 0;
  return { passed, observed: { status: document.status, modalityIsolation: document.modalityIsolation, routeCount: routes.length, promptCount: prompts.length, coveredModes, missingModes, invalidPrompts } };
}

function verifyScriptDurationStructure(document, parameters) {
  const variants = Array.isArray(document.variants) ? document.variants : [];
  const requiredDurations = numberArray(parameters.requiredDurations ?? [15, 30, 60], "requiredDurations");
  const byDuration = new Map(variants.map((variant) => [Number(variant.durationSeconds), variant]));
  const missingDurations = requiredDurations.filter((duration) => !byDuration.has(duration));
  const propositionIds = new Set();
  const invalidVariants = [];
  for (const duration of requiredDurations) {
    const variant = byDuration.get(duration);
    if (!variant) continue;
    const beats = Array.isArray(variant.beats) ? variant.beats : [];
    const totalBeatSeconds = beats.reduce((sum, beat) => sum + Number(beat.durationSeconds ?? 0), 0);
    if (!String(variant.propositionId ?? "").trim()) invalidVariants.push(`${duration}:proposition`);
    else propositionIds.add(variant.propositionId);
    if (!String(variant.proofEvent ?? "").trim()) invalidVariants.push(`${duration}:proof`);
    if (!String(variant.cta ?? "").trim()) invalidVariants.push(`${duration}:cta`);
    if (!beats.length || beats.some((beat) => !String(beat.function ?? "").trim() || !String(beat.visibleAction ?? "").trim() || Number(beat.durationSeconds) <= 0)) invalidVariants.push(`${duration}:beats`);
    if (Math.abs(totalBeatSeconds - duration) > Math.max(0.25, duration * 0.01)) invalidVariants.push(`${duration}:timing`);
    if (duration === 15 && beats.length > Number(parameters.maximum15SecondBeats ?? 4)) invalidVariants.push(`${duration}:density`);
    if (duration === 60 && new Set(beats.map((beat) => beat.visibleAction)).size < Number(parameters.minimum60SecondDistinctActions ?? 5)) invalidVariants.push(`${duration}:escalation`);
  }
  const passed = document.status === "ready"
    && missingDurations.length === 0
    && propositionIds.size === 1
    && invalidVariants.length === 0;
  return { passed, observed: { status: document.status, variantCount: variants.length, requiredDurations, missingDurations, propositionIds: [...propositionIds], invalidVariants } };
}

async function readProjectJson(projectPath, path) { const root = resolve(projectPath), absolute = resolve(root, path), relation = relative(root, absolute); if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Verifier JSON artifact must stay inside the project workspace."); const details = await stat(absolute); if (!details.isFile() || details.size <= 0 || details.size > 10_000_000) throw new Error("Verifier JSON artifact must be a non-empty file no larger than 10 MB."); return JSON.parse(await readFile(absolute, "utf8")); }
function rationalSeconds(time) { return Number(time?.value) / Number(time?.rate); }
function stringArray(value, name) { if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string" || !item)) throw new Error(`${name} must be a non-empty string array.`); return value; }
function numberArray(value, name) { if (!Array.isArray(value) || !value.length || value.some((item) => !Number.isFinite(Number(item)) || Number(item) <= 0)) throw new Error(`${name} must be a non-empty positive number array.`); return value.map(Number); }
function sameArray(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function finite(value, name) { const number = Number(value); if (!Number.isFinite(number)) throw new Error(`${name} must be finite.`); return number; }
function round(value) { return Math.round(value * 10000) / 10000; }
function positive(value, name) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive.`); return number; }
function nonnegative(value, name) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be nonnegative.`); return number; }
