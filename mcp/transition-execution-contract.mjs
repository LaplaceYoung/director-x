import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const CUT_KINDS = new Set(["cut", "match_cut"]);
const OVERLAP_KINDS = new Set([
  "crossfade",
  "dip_to_black",
  "fade_through_color",
  "slide",
  "wipe",
  "zoom_blur",
  "whip_pan",
  "shader"
]);
const AUDIO_BRIDGES = new Set(["none", "j_cut", "l_cut", "room_tone", "music_hit"]);
const CUSTOM_REMOTION_KINDS = new Set(["zoom_blur", "whip_pan", "shader", "dip_to_black", "fade_through_color"]);
const DIRECTORX_REMOTION_RUNTIME_ID = "directorx-remotion-runtime-v1";
const DIRECTORX_TIMELINE_COMPOSITION_ID = "DirectorXTimeline";

export function compileTransitionExecutionContract({
  renderer,
  durationSeconds,
  visualClips,
  transitions,
  transitionLanguagePlan,
  required = false
}) {
  const fps = positiveInteger(transitionLanguagePlan?.fps ?? 30, "transitionLanguagePlan.fps");
  const clips = normalizeClips(visualClips ?? []);
  const rendered = normalizeTransitions(transitions ?? []);
  const blockers = [];
  const warnings = [];
  const expectedBoundaries = Math.max(0, clips.length - 1);

  if (!expectedBoundaries) {
    return result({
      renderer,
      fps,
      required,
      plan: transitionLanguagePlan,
      boundaries: [],
      blockers,
      warnings
    });
  }
  if (!transitionLanguagePlan) {
    if (required) blockers.push("transition_execution_plan_missing");
    else warnings.push("transition_execution_plan_not_bound");
    return result({
      renderer,
      fps,
      required,
      plan: transitionLanguagePlan,
      boundaries: [],
      blockers,
      warnings
    });
  }
  if (transitionLanguagePlan.status !== "ready") blockers.push(`transition_execution_plan_${transitionLanguagePlan.status ?? "invalid"}`);
  if (transitionLanguagePlan.renderer && transitionLanguagePlan.renderer !== renderer) {
    blockers.push(`transition_execution_renderer_mismatch:${transitionLanguagePlan.renderer}!=${renderer}`);
  }
  const planned = new Map((transitionLanguagePlan.boundaries ?? []).map((boundary) => [
    boundary.boundaryId ?? `${boundary.fromShotId}->${boundary.toShotId}`,
    boundary
  ]));
  const renderedByClipBoundary = new Map(rendered.map((transition) => [
    `${transition.fromClipId}->${transition.toClipId}`,
    transition
  ]));
  const boundaries = [];
  const frameToleranceSeconds = (1 / fps) + 0.001;
  if (planned.size !== (transitionLanguagePlan.boundaries ?? []).length) blockers.push("transition_execution_duplicate_director_boundary");
  if (planned.size !== expectedBoundaries) blockers.push(`transition_execution_plan_boundary_count:${planned.size}!=${expectedBoundaries}`);
  if (renderedByClipBoundary.size !== rendered.length) blockers.push("transition_execution_duplicate_rendered_boundary");
  if (renderedByClipBoundary.size !== expectedBoundaries) blockers.push(`transition_execution_rendered_boundary_count:${renderedByClipBoundary.size}!=${expectedBoundaries}`);

  for (let index = 0; index < clips.length - 1; index += 1) {
    const from = clips[index];
    const to = clips[index + 1];
    const clipBoundaryId = `${from.clipId}->${to.clipId}`;
    const actual = renderedByClipBoundary.get(clipBoundaryId);
    if (!actual) {
      blockers.push(`transition_execution_missing:${clipBoundaryId}`);
      continue;
    }
    const boundaryId = actual.transitionBoundaryId || clipBoundaryId;
    const expected = planned.get(boundaryId);
    if (!expected) {
      blockers.push(`transition_execution_director_boundary_missing:${boundaryId}`);
      continue;
    }
    const durationFrames = nonNegativeInteger(
      expected.durationFrames ?? Math.round(Number(expected.durationSeconds ?? 0) * fps),
      `${boundaryId}.durationFrames`
    );
    const expectedDurationSeconds = round(durationFrames / fps);
    const actualDurationSeconds = round(actual.durationSeconds);
    const observedOverlapSeconds = round(Math.max(0, from.endSeconds - to.startSeconds));
    const observedGapSeconds = round(Math.max(0, to.startSeconds - from.endSeconds));
    const overlapRequired = OVERLAP_KINDS.has(expected.renderKind);
    const expectedOverlapSeconds = overlapRequired ? expectedDurationSeconds : 0;
    const transitionStartFrame = Math.round(to.startSeconds * fps);
    const transitionEndFrame = Math.round(from.endSeconds * fps);
    const cutFrame = overlapRequired
      ? transitionStartFrame + Math.floor(durationFrames / 2)
      : transitionStartFrame;
    const actionOverlapSeconds = round(Number(expected.actionOverlapSeconds ?? 0));
    const minimumHandleSeconds = round(Math.max(expectedOverlapSeconds, actionOverlapSeconds));
    const boundaryBlockers = [];
    const boundaryWarnings = [];

    for (const [field, present] of [
      ["directorMethod", Boolean(expected.directorMethod)],
      ["renderKind", Boolean(expected.renderKind)],
      ["cutTrigger", Boolean(expected.cutTrigger)],
      ["rationale", Boolean(String(expected.rationale ?? "").trim())],
      ["audioBridge", Boolean(expected.audioBridge?.kind)],
      ["boundaryFrames", Boolean(expected.boundaryFrames && typeof expected.boundaryFrames === "object")],
      ["rendererRecipe", Boolean(expected.rendererRecipe && typeof expected.rendererRecipe === "object")],
      ["easing", Boolean(expected.easing)],
      ["reviewCriteria", Array.isArray(expected.reviewCriteria) && expected.reviewCriteria.length > 0]
    ]) {
      if (!present) boundaryBlockers.push(`director_boundary_field_missing:${field}`);
    }
    if (expected.renderKind !== actual.kind) boundaryBlockers.push(`render_kind:${expected.renderKind}!=${actual.kind}`);
    if (expected.directorMethod && actual.directorMethod !== expected.directorMethod) {
      boundaryBlockers.push(`director_method:${expected.directorMethod}!=${actual.directorMethod || "missing"}`);
    }
    if (Math.abs(expectedDurationSeconds - actualDurationSeconds) > frameToleranceSeconds) {
      boundaryBlockers.push(`duration:${expectedDurationSeconds}!=${actualDurationSeconds}`);
    }
    if (observedGapSeconds > frameToleranceSeconds) boundaryBlockers.push(`visual_gap:${observedGapSeconds}`);
    if (Math.abs(observedOverlapSeconds - expectedOverlapSeconds) > frameToleranceSeconds) {
      boundaryBlockers.push(`timeline_overlap:${expectedOverlapSeconds}!=${observedOverlapSeconds}`);
    }
    if (CUT_KINDS.has(expected.renderKind) && actualDurationSeconds !== 0) {
      boundaryBlockers.push(`cut_duration_must_be_zero:${actualDurationSeconds}`);
    }
    if (overlapRequired && durationFrames < 1) boundaryBlockers.push("overlap_transition_requires_positive_frames");
    if (durationFrames > Math.round(Math.min(from.durationSeconds, to.durationSeconds) * fps)) {
      boundaryBlockers.push("transition_longer_than_adjacent_clip");
    }
    if (renderer === "remotion" && CUSTOM_REMOTION_KINDS.has(expected.renderKind) && !actual.runtimeAdapterId) {
      boundaryBlockers.push(`runtime_adapter_missing:${expected.renderKind}`);
    }
    if (expected.easing && actual.easing !== expected.easing) {
      boundaryBlockers.push(`easing:${expected.easing}!=${actual.easing || "missing"}`);
    }
    if (expected.cutTrigger && actual.cutTrigger !== expected.cutTrigger) {
      boundaryBlockers.push(`cut_trigger:${expected.cutTrigger}!=${actual.cutTrigger || "missing"}`);
    }

    const boundaryFrames = expected.boundaryFrames ?? {};
    const outgoingHandleSeconds = round(Number(actual.outgoingHandleSeconds ?? observedOverlapSeconds));
    const incomingHandleSeconds = round(Number(actual.incomingHandleSeconds ?? observedOverlapSeconds));
    if (from.kind === "video" && minimumHandleSeconds > 0 && outgoingHandleSeconds + frameToleranceSeconds < minimumHandleSeconds) {
      boundaryBlockers.push(`outgoing_handle:${outgoingHandleSeconds}<${minimumHandleSeconds}`);
    }
    if (to.kind === "video" && minimumHandleSeconds > 0 && incomingHandleSeconds + frameToleranceSeconds < minimumHandleSeconds) {
      boundaryBlockers.push(`incoming_handle:${incomingHandleSeconds}<${minimumHandleSeconds}`);
    }
    if (boundaryFrames.outgoingRequired && !actual.outgoingFrameRef) boundaryBlockers.push("outgoing_boundary_frame_missing");
    if (boundaryFrames.incomingRequired && !actual.incomingFrameRef) boundaryBlockers.push("incoming_boundary_frame_missing");
    if (boundaryFrames.bridgeFrameRequired && !actual.bridgeFrameRef) boundaryBlockers.push("bridge_frame_missing");

    const audio = compareAudioBridge(expected.audioBridge, actual.audioBridge, frameToleranceSeconds, fps);
    boundaryBlockers.push(...audio.blockers);
    boundaryWarnings.push(...audio.warnings);
    const rendererInstruction = compileRendererInstruction({
      renderer,
      boundaryId,
      expected,
      durationFrames,
      runtimeAdapterId: actual.runtimeAdapterId,
      audioBridge: audio.actual
    });
    boundaries.push({
      boundaryId,
      clipBoundaryId,
      fromClipId: from.clipId,
      toClipId: to.clipId,
      directorMethod: expected.directorMethod,
      renderKind: expected.renderKind,
      cutTrigger: expected.cutTrigger ?? null,
      durationFrames,
      durationSeconds: expectedDurationSeconds,
      transitionStartFrame,
      transitionEndFrame,
      cutFrame,
      expectedTimelineOverlapSeconds: expectedOverlapSeconds,
      observedTimelineOverlapSeconds: observedOverlapSeconds,
      observedTimelineGapSeconds: observedGapSeconds,
      actionOverlapSeconds,
      minimumHandleSeconds,
      outgoingHandleSeconds,
      incomingHandleSeconds,
      outgoingFrameRef: actual.outgoingFrameRef ?? null,
      incomingFrameRef: actual.incomingFrameRef ?? null,
      bridgeFrameRef: actual.bridgeFrameRef ?? null,
      runtimeAdapterId: actual.runtimeAdapterId ?? null,
      easing: expected.easing,
      audioBridge: audio.actual,
      rendererInstruction,
      reviewCriteria: [...new Set(expected.reviewCriteria ?? [])],
      blockers: boundaryBlockers,
      warnings: boundaryWarnings
    });
    blockers.push(...boundaryBlockers.map((code) => `${boundaryId}:${code}`));
    warnings.push(...boundaryWarnings.map((code) => `${boundaryId}:${code}`));
  }

  const coverage = timelineCoverage(clips, Number(durationSeconds), fps);
  blockers.push(...coverage.blockers);
  warnings.push(...coverage.warnings);
  return result({
    renderer,
    fps,
    required,
    plan: transitionLanguagePlan,
    boundaries,
    blockers,
    warnings,
    coverage
  });
}

export async function assertRenderPropsBindTransitionExecution(run, { projectPath, propsPath, compositionId }) {
  const contract = run?.renderQualityContract?.transitionExecution;
  if (!contract || contract.required !== true || contract.expectedBoundaryCount === 0) {
    return { required: false, status: "not_required", renderPropsBinding: "not_required" };
  }
  if (contract.status !== "ready") throw new Error("Render is blocked: transition execution contract is not ready.");
  if (!String(propsPath ?? "").trim()) {
    throw new Error("Render is blocked: propsPath must bind the approved Director transition execution contract.");
  }
  const absolutePath = containedPath(projectPath, propsPath);
  const details = await stat(absolutePath);
  if (!details.isFile() || details.size <= 0 || details.size > 1024 * 1024) {
    throw new Error("Transition-bound render props must be a non-empty JSON file no larger than 1 MB.");
  }
  const bytes = await readFile(absolutePath);
  let props;
  try {
    props = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Transition-bound render props must contain valid JSON.");
  }
  const binding = props.directorxTransitionExecution ?? props.directorx?.transitionExecution;
  if (!binding || binding.contractFingerprint !== contract.contractFingerprint) {
    throw new Error("Render props do not bind the current Director transition execution fingerprint.");
  }
  if (binding.planId !== contract.planId || binding.sequenceId !== contract.sequenceId) {
    throw new Error("Render props transition plan identity does not match the current Director contract.");
  }
  const expectedBinding = createTransitionExecutionRenderBinding(contract);
  const expectedBoundaryIds = expectedBinding.boundaryIds;
  if (
    !Array.isArray(binding.boundaryIds)
    || binding.boundaryIds.length !== expectedBoundaryIds.length
    || binding.boundaryIds.some((boundaryId, index) => boundaryId !== expectedBoundaryIds[index])
  ) {
    throw new Error("Render props must preserve the exact approved Director boundary order.");
  }
  if (stableJson(binding.boundaries) !== stableJson(expectedBinding.boundaries)) {
    throw new Error("Render props transition runtime instructions drifted from the approved Director contract.");
  }
  if (contract.renderer === "remotion") {
    if (String(compositionId ?? "") !== DIRECTORX_TIMELINE_COMPOSITION_ID) {
      throw new Error(`Render is blocked: Director transition execution requires the ${DIRECTORX_TIMELINE_COMPOSITION_ID} composition.`);
    }
    if (
      props.directorxRuntime?.runtimeId !== DIRECTORX_REMOTION_RUNTIME_ID
      || props.directorxRuntime?.compositionId !== DIRECTORX_TIMELINE_COMPOSITION_ID
    ) {
      throw new Error("Render props do not bind the approved Director X Remotion runtime and composition.");
    }
    assertRemotionAudioBridgeTracks(expectedBinding.boundaries, props.directorxAudioTracks ?? []);
  }
  if (binding.runtimeFingerprint !== expectedBinding.runtimeFingerprint) {
    throw new Error("Render props do not bind the current Director transition runtime fingerprint.");
  }
  return {
    required: true,
    status: "passed",
    renderPropsBinding: "passed",
    contractFingerprint: contract.contractFingerprint,
    planId: contract.planId,
    sequenceId: contract.sequenceId,
    boundaryIds: expectedBoundaryIds,
    runtimeFingerprint: expectedBinding.runtimeFingerprint,
    runtimeId: contract.renderer === "remotion" ? DIRECTORX_REMOTION_RUNTIME_ID : null,
    compositionId: contract.renderer === "remotion" ? DIRECTORX_TIMELINE_COMPOSITION_ID : null,
    propsPath: relative(resolve(projectPath), absolutePath),
    propsSha256: createHash("sha256").update(bytes).digest("hex")
  };
}

export function preserveTransitionExecutionRenderEvidence(run) {
  const contract = run?.renderQualityContract?.transitionExecution;
  if (!contract || contract.required !== true || contract.expectedBoundaryCount === 0) {
    return {
      verification: { required: false, status: "not_required", renderEvidence: "not_required" },
      binding: null,
      artifactMetadata: {}
    };
  }
  if (contract.status !== "ready") throw new Error("Final verification is blocked: transition execution contract is not ready.");
  const binding = run.artifacts?.["render_report.json"]?.metadata?.transitionExecution;
  if (
    binding?.status !== "passed"
    || binding?.renderPropsBinding !== "passed"
    || binding?.contractFingerprint !== contract.contractFingerprint
    || binding?.runtimeFingerprint !== contract.renderBinding?.runtimeFingerprint
    || (contract.renderer === "remotion" && (
      binding?.runtimeId !== DIRECTORX_REMOTION_RUNTIME_ID
      || binding?.compositionId !== DIRECTORX_TIMELINE_COMPOSITION_ID
    ))
    || !/^[a-f0-9]{64}$/.test(String(binding.propsSha256 ?? ""))
  ) {
    throw new Error("Final verification is blocked: render_report.json lacks a validated Director transition props binding.");
  }
  const expectedBoundaryIds = contract.boundaries.map((boundary) => boundary.boundaryId);
  if (
    !Array.isArray(binding.boundaryIds)
    || binding.boundaryIds.length !== expectedBoundaryIds.length
    || binding.boundaryIds.some((boundaryId, index) => boundaryId !== expectedBoundaryIds[index])
  ) {
    throw new Error("Final verification is blocked: rendered Director boundary order drifted from the approved contract.");
  }
  const verification = {
    required: true,
    status: "passed",
    renderEvidence: "passed",
    contractFingerprint: contract.contractFingerprint,
    runtimeFingerprint: binding.runtimeFingerprint,
    propsSha256: binding.propsSha256,
    boundaryCount: expectedBoundaryIds.length
  };
  return {
    verification,
    binding: structuredClone(binding),
    artifactMetadata: {
      transitionExecution: structuredClone(binding),
      sourceArtifactRefs: ["transition_language_plan.json", "render_quality_contract.json"]
    }
  };
}

function result({ renderer, fps, required, plan, boundaries, blockers, warnings, coverage = null }) {
  const normalizedBlockers = [...new Set(blockers)];
  const normalizedWarnings = [...new Set(warnings)];
  const fingerprintPayload = {
    planId: plan?.planId ?? null,
    sequenceId: plan?.sequenceId ?? null,
    renderer,
    fps,
    boundaries: boundaries.map((boundary) => ({
      boundaryId: boundary.boundaryId,
      clipBoundaryId: boundary.clipBoundaryId,
      directorMethod: boundary.directorMethod,
      renderKind: boundary.renderKind,
      cutTrigger: boundary.cutTrigger,
      durationFrames: boundary.durationFrames,
      transitionStartFrame: boundary.transitionStartFrame,
      transitionEndFrame: boundary.transitionEndFrame,
      cutFrame: boundary.cutFrame,
      expectedTimelineOverlapSeconds: boundary.expectedTimelineOverlapSeconds,
      actionOverlapSeconds: boundary.actionOverlapSeconds,
      minimumHandleSeconds: boundary.minimumHandleSeconds,
      outgoingFrameRef: boundary.outgoingFrameRef,
      incomingFrameRef: boundary.incomingFrameRef,
      bridgeFrameRef: boundary.bridgeFrameRef,
      runtimeAdapterId: boundary.runtimeAdapterId,
      easing: boundary.easing,
      audioBridge: boundary.audioBridge,
      rendererInstruction: boundary.rendererInstruction
    }))
  };
  const contract = {
    schemaVersion: "1.0",
    status: normalizedBlockers.length ? "blocked" : "ready",
    required,
    planId: plan?.planId ?? null,
    sequenceId: plan?.sequenceId ?? null,
    renderer,
    fps,
    expectedBoundaryCount: plan?.boundaries?.length ?? Math.max(0, (plan?.shotOrder?.length ?? 0) - 1),
    boundBoundaryCount: boundaries.length,
    coverage,
    boundaries,
    contractFingerprint: sha256(fingerprintPayload),
    blockers: normalizedBlockers,
    warnings: normalizedWarnings
  };
  contract.renderBinding = createTransitionExecutionRenderBinding(contract);
  return contract;
}

export function createTransitionExecutionRenderBinding(contract) {
  const boundaries = (contract?.boundaries ?? []).map((boundary) => ({
    boundaryId: boundary.boundaryId,
    clipBoundaryId: boundary.clipBoundaryId,
    fromClipId: boundary.fromClipId,
    toClipId: boundary.toClipId,
    directorMethod: boundary.directorMethod,
    renderKind: boundary.renderKind,
    cutTrigger: boundary.cutTrigger,
    durationFrames: boundary.durationFrames,
    transitionStartFrame: boundary.transitionStartFrame,
    transitionEndFrame: boundary.transitionEndFrame,
    cutFrame: boundary.cutFrame,
    runtimeAdapterId: boundary.runtimeAdapterId,
    easing: boundary.easing,
    audioBridge: boundary.audioBridge,
    rendererInstruction: boundary.rendererInstruction
  }));
  const payload = {
    schemaVersion: "1.0",
    contractFingerprint: contract?.contractFingerprint ?? null,
    planId: contract?.planId ?? null,
    sequenceId: contract?.sequenceId ?? null,
    boundaryIds: boundaries.map((boundary) => boundary.boundaryId),
    boundaries
  };
  return {
    ...payload,
    runtimeFingerprint: sha256(payload)
  };
}

function assertRemotionAudioBridgeTracks(boundaries, tracks) {
  if (!Array.isArray(tracks)) throw new Error("Director X Remotion audio tracks must be an array.");
  for (const boundary of boundaries) {
    const audio = boundary.rendererInstruction?.audio ?? { kind: "none" };
    if (audio.kind === "none") continue;
    const track = tracks.find((item) => item?.boundaryId === boundary.boundaryId && item?.bridgeKind === audio.kind);
    if (!track) throw new Error(`Render props lack the ${audio.kind} audio track for ${boundary.boundaryId}.`);
    const fromFrame = nonNegativeInteger(track.fromFrame, `${boundary.boundaryId}.audioTrack.fromFrame`);
    const durationInFrames = positiveInteger(track.durationInFrames, `${boundary.boundaryId}.audioTrack.durationInFrames`);
    const endFrame = fromFrame + durationInFrames;
    if (!String(track.src ?? "").trim()) throw new Error(`${boundary.boundaryId} audio bridge track requires src.`);
    if (audio.kind === "j_cut" && fromFrame !== boundary.cutFrame + audio.offsetFrames) {
      throw new Error(`${boundary.boundaryId} J-cut audio must start at the approved lead frame.`);
    }
    if (audio.kind === "l_cut" && endFrame !== boundary.cutFrame + audio.tailFrames) {
      throw new Error(`${boundary.boundaryId} L-cut audio must end at the approved tail frame.`);
    }
    if (audio.kind === "room_tone") {
      const expectedStart = boundary.cutFrame - Math.floor(audio.overlapFrames / 2);
      if (fromFrame !== expectedStart || durationInFrames !== audio.overlapFrames) {
        throw new Error(`${boundary.boundaryId} room-tone track does not match the approved overlap window.`);
      }
    }
    if (audio.kind === "music_hit" && !(fromFrame <= boundary.cutFrame && endFrame > boundary.cutFrame)) {
      throw new Error(`${boundary.boundaryId} music-hit track must cover the approved cut frame.`);
    }
  }
}

function compileRendererInstruction({ renderer, boundaryId, expected, durationFrames, runtimeAdapterId, audioBridge }) {
  const overlap = !CUT_KINDS.has(expected.renderKind);
  const timing = durationFrames === 0
    ? { kind: "none", durationInFrames: 0, easing: null }
    : { kind: expected.easing === "spring" ? "spring" : "linear", durationInFrames: durationFrames, easing: expected.easing };
  if (renderer === "remotion") {
    return {
      engine: "remotion",
      component: overlap ? "TransitionSeries.Transition" : null,
      operation: overlap ? "transition" : "sequence_boundary",
      presentation: remotionPresentation(expected.renderKind),
      runtimeAdapterId: runtimeAdapterId || null,
      timing,
      shortensTimelineByFrames: overlap ? durationFrames : 0,
      boundaryId,
      audio: audioInstruction(audioBridge)
    };
  }
  if (renderer === "hyperframes") {
    return {
      engine: "hyperframes",
      operation: expected.renderKind,
      durationInFrames: durationFrames,
      overlapFrames: overlap ? durationFrames : 0,
      boundaryId,
      audio: audioInstruction(audioBridge)
    };
  }
  return {
    engine: "ffmpeg",
    operation: expected.rendererRecipe?.operation ?? (overlap ? "xfade" : "concat"),
    transition: expected.rendererRecipe?.transition ?? null,
    durationInFrames: durationFrames,
    overlapFrames: overlap ? durationFrames : 0,
    boundaryId,
    audio: audioInstruction(audioBridge)
  };
}

function audioInstruction(bridge) {
  if (!bridge || bridge.kind === "none") return { kind: "none", offsetFrames: 0, tailFrames: 0, overlapFrames: 0 };
  return {
    kind: bridge.kind,
    offsetFrames: bridge.kind === "j_cut" ? -bridge.leadFrames : 0,
    tailFrames: bridge.kind === "l_cut" ? bridge.tailFrames : 0,
    overlapFrames: bridge.kind === "room_tone" ? bridge.overlapFrames : 0
  };
}

function compareAudioBridge(expectedValue, actualValue, toleranceSeconds, fps) {
  const expected = normalizeAudioBridge(expectedValue, fps);
  const actual = normalizeAudioBridge(actualValue, fps);
  const blockers = [];
  const warnings = [];
  if (expected.kind !== actual.kind) blockers.push(`audio_bridge_kind:${expected.kind}!=${actual.kind}`);
  for (const field of ["leadSeconds", "tailSeconds", "overlapSeconds"]) {
    if (Math.abs(expected[field] - actual[field]) > toleranceSeconds) blockers.push(`audio_bridge_${field}:${expected[field]}!=${actual[field]}`);
  }
  return { expected, actual, blockers, warnings };
}

function normalizeAudioBridge(value, fps) {
  const kind = String(value?.kind ?? "none");
  if (!AUDIO_BRIDGES.has(kind)) throw new Error(`Unsupported transition audio bridge: ${kind}`);
  const leadSeconds = kind === "j_cut" ? nonNegativeNumber(value?.leadSeconds ?? 0, "audioBridge.leadSeconds") : 0;
  const tailSeconds = kind === "l_cut" ? nonNegativeNumber(value?.tailSeconds ?? 0, "audioBridge.tailSeconds") : 0;
  const overlapSeconds = kind === "room_tone" ? nonNegativeNumber(value?.overlapSeconds ?? 0, "audioBridge.overlapSeconds") : 0;
  return {
    kind,
    leadSeconds: round(leadSeconds),
    tailSeconds: round(tailSeconds),
    overlapSeconds: round(overlapSeconds),
    leadFrames: Math.round(leadSeconds * fps),
    tailFrames: Math.round(tailSeconds * fps),
    overlapFrames: Math.round(overlapSeconds * fps)
  };
}

function normalizeClips(values) {
  if (!Array.isArray(values)) throw new Error("visualClips must be an array.");
  const clips = values.map((value, index) => {
    const clipId = String(value?.clipId ?? "").trim();
    if (!clipId) throw new Error(`visualClips[${index}].clipId is required.`);
    const startSeconds = nonNegativeNumber(value.startSeconds, `visualClips[${index}].startSeconds`);
    const endSeconds = nonNegativeNumber(value.endSeconds, `visualClips[${index}].endSeconds`);
    if (endSeconds <= startSeconds) throw new Error(`visualClips[${index}] must have positive duration.`);
    return {
      ...structuredClone(value),
      clipId,
      kind: String(value.kind ?? "video"),
      startSeconds,
      endSeconds,
      durationSeconds: round(endSeconds - startSeconds)
    };
  });
  if (new Set(clips.map((clip) => clip.clipId)).size !== clips.length) throw new Error("visualClips must use unique clipId values.");
  return clips.sort((left, right) => left.startSeconds - right.startSeconds || left.clipId.localeCompare(right.clipId));
}

function normalizeTransitions(values) {
  if (!Array.isArray(values)) throw new Error("transitions must be an array.");
  return values.map((value, index) => ({
    ...structuredClone(value),
    fromClipId: requiredString(value.fromClipId, `transitions[${index}].fromClipId`),
    toClipId: requiredString(value.toClipId, `transitions[${index}].toClipId`),
    transitionBoundaryId: String(value.transitionBoundaryId ?? "").trim(),
    kind: requiredString(value.kind, `transitions[${index}].kind`),
    directorMethod: String(value.directorMethod ?? "").trim(),
    cutTrigger: String(value.cutTrigger ?? "").trim(),
    easing: String(value.easing ?? "").trim(),
    runtimeAdapterId: String(value.runtimeAdapterId ?? "").trim(),
    durationSeconds: nonNegativeNumber(value.durationSeconds ?? 0, `transitions[${index}].durationSeconds`),
    outgoingHandleSeconds: nonNegativeNumber(value.outgoingHandleSeconds ?? 0, `transitions[${index}].outgoingHandleSeconds`),
    incomingHandleSeconds: nonNegativeNumber(value.incomingHandleSeconds ?? 0, `transitions[${index}].incomingHandleSeconds`)
  }));
}

function remotionPresentation(renderKind) {
  if (renderKind === "crossfade") return "fade";
  if (renderKind === "slide") return "slide";
  if (renderKind === "wipe") return "wipe";
  if (CUT_KINDS.has(renderKind)) return null;
  return `custom:${renderKind}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function timelineCoverage(clips, durationSeconds, fps) {
  const blockers = [];
  const warnings = [];
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !clips.length) return { status: "not_checked", blockers, warnings };
  const tolerance = (1 / fps) + 0.001;
  if (clips[0].startSeconds > tolerance) blockers.push(`visual_timeline_lead_gap:${round(clips[0].startSeconds)}`);
  if (Math.abs(clips.at(-1).endSeconds - durationSeconds) > tolerance) {
    blockers.push(`visual_timeline_end:${round(clips.at(-1).endSeconds)}!=${round(durationSeconds)}`);
  }
  return {
    status: blockers.length ? "blocked" : "ready",
    startSeconds: clips[0].startSeconds,
    endSeconds: clips.at(-1).endSeconds,
    durationSeconds: round(durationSeconds),
    blockers,
    warnings
  };
}

function containedPath(projectPath, path) {
  const root = resolve(projectPath);
  const absolute = resolve(root, path);
  const relation = relative(root, absolute);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Execution paths must stay inside the project workspace.");
  return absolute;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requiredString(value, field) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${field} is required.`);
  return result;
}

function nonNegativeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number.`);
  return number;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${field} must be a positive integer.`);
  return number;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${field} must be a non-negative integer.`);
  return number;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
