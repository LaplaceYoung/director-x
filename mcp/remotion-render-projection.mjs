import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createTransitionExecutionRenderBinding } from "./transition-execution-contract.mjs";

const RUNTIME_ID = "directorx-remotion-runtime-v1";
const COMPOSITION_ID = "DirectorXTimeline";
const VISUAL_TRACK_TYPES = new Set(["video", "visual"]);
const VISUAL_KINDS = new Set(["image", "still", "video", "motion_graphic", "screen"]);
const AUDIO_TRACK_TYPES = new Set(["dialogue", "voiceover", "narration", "music", "sfx", "ambience"]);
const CAPTION_TRACK_TYPES = new Set(["captions", "caption", "subtitles", "subtitle"]);

export function compileRemotionRenderProjection({
  semanticTimeline,
  semanticTimelineSha256,
  renderQualityContract,
  renderQualityContractSha256,
  transitionLanguagePlanSha256 = null,
  audioCueSheetSha256 = null,
  mediaBindings,
  timelineAudioBindings = [],
  captionBindings = [],
  audioBridgeBindings = [],
  width,
  height,
  throughColor = "#000000"
}) {
  if (!semanticTimeline || typeof semanticTimeline !== "object") throw new Error("semantic_timeline.json is required.");
  if (!renderQualityContract || typeof renderQualityContract !== "object") throw new Error("render_quality_contract.json is required.");
  if (renderQualityContract.status !== "ready" || renderQualityContract.renderer !== "remotion") {
    throw new Error("Remotion projection requires a ready Remotion render quality contract.");
  }
  const execution = renderQualityContract.transitionExecution;
  if (!execution || execution.status !== "ready") throw new Error("Remotion projection requires a ready transition execution contract.");
  const fps = positiveInteger(execution.fps, "transitionExecution.fps");
  const durationSeconds = positiveNumber(renderQualityContract.durationSeconds, "renderQualityContract.durationSeconds");
  const visualClips = timelineVisualClips(semanticTimeline);
  assertCanonicalVisualTiming(visualClips, renderQualityContract.visualClips ?? [], fps, durationSeconds);
  const audioClips = timelineAudioClips(semanticTimeline, durationSeconds);
  const captionClips = timelineCaptionClips(semanticTimeline, renderQualityContract.captions ?? [], fps, durationSeconds);
  const bindingByClip = new Map(normalizeMediaBindings(mediaBindings).map((binding) => [binding.clipId, binding]));
  const beatsByShot = new Map((semanticTimeline.beats ?? []).map((beat) => [String(beat.shot_id ?? beat.shotId ?? ""), beat]));
  const scenes = visualClips.map((clip) => {
    const binding = bindingByClip.get(clip.clipId);
    if (!binding) throw new Error(`Media binding missing for canonical visual clip ${clip.clipId}.`);
    const beat = beatsByShot.get(clip.shotId) ?? null;
    return {
      id: clip.clipId,
      fromFrame: Math.round(clip.startSeconds * fps),
      durationInFrames: Math.round((clip.endSeconds - clip.startSeconds) * fps),
      title: binding.title || stringValue(beat?.title) || stringValue(beat?.intent) || undefined,
      body: binding.body || stringValue(beat?.body) || undefined,
      backgroundColor: binding.backgroundColor || undefined,
      accentColor: binding.accentColor || undefined,
      media: {
        kind: binding.kind === "video" ? "video" : "image",
        src: binding.src,
        fit: binding.fit,
        muted: binding.kind === "video" ? binding.muted : undefined
      }
    };
  });
  if (bindingByClip.size !== scenes.length) throw new Error("Media bindings must match canonical visual clips exactly; extra bindings are not allowed.");
  const transitionBinding = createTransitionExecutionRenderBinding(execution);
  const directorxAudioTracks = compileAudioBridgeTracks(transitionBinding.boundaries, audioBridgeBindings, fps);
  const directorxTimelineAudioTracks = compileTimelineAudioTracks(audioClips, timelineAudioBindings, renderQualityContract.narration, fps);
  const directorxCaptions = compileCaptionCues(captionClips, captionBindings, semanticTimeline.platform_safe_area, fps);
  const sourceBinding = {
    semanticTimelineId: String(semanticTimeline.semantic_timeline_id ?? semanticTimeline.timelineId ?? ""),
    semanticTimelineSha256: requiredSha256(semanticTimelineSha256, "semanticTimelineSha256"),
    renderQualityContractSha256: requiredSha256(renderQualityContractSha256, "renderQualityContractSha256"),
    transitionLanguagePlanSha256: optionalSha256(transitionLanguagePlanSha256, "transitionLanguagePlanSha256"),
    audioCueSheetSha256: audioClips.length ? requiredSha256(audioCueSheetSha256, "audioCueSheetSha256") : optionalSha256(audioCueSheetSha256, "audioCueSheetSha256"),
    transitionContractFingerprint: execution.contractFingerprint,
    transitionRuntimeFingerprint: transitionBinding.runtimeFingerprint
  };
  const projectionPayload = {
    sourceBinding,
    composition: {
      durationInFrames: Math.round(durationSeconds * fps),
      fps,
      width: positiveInteger(width, "width"),
      height: positiveInteger(height, "height")
    },
    scenes,
    directorxAudioTracks,
    directorxTimelineAudioTracks,
    directorxCaptions,
    directorxTransitionExecution: transitionBinding,
    throughColor
  };
  const projectionFingerprint = sha256(projectionPayload);
  const props = JSON.parse(JSON.stringify({
    composition: projectionPayload.composition,
    directorxRuntime: { runtimeId: RUNTIME_ID, compositionId: COMPOSITION_ID },
    directorxProjection: {
      schemaVersion: "1.0",
      projectionFingerprint,
      sourceBinding
    },
    directorxTransitionExecution: transitionBinding,
    directorxAudioTracks,
    directorxTimelineAudioTracks,
    directorxCaptions,
    scenes,
    throughColor
  }));
  return {
    schemaVersion: "1.0",
    status: "ready",
    projectionId: `remotion-projection:${projectionFingerprint.slice(0, 16)}`,
    projectionFingerprint,
    propsFingerprint: sha256(props),
    sourceBinding,
    compositionId: COMPOSITION_ID,
    runtimeId: RUNTIME_ID,
    sceneCount: scenes.length,
    boundaryCount: transitionBinding.boundaries.length,
    audioBridgeTrackCount: directorxAudioTracks.length,
    timelineAudioTrackCount: directorxTimelineAudioTracks.length,
    captionCount: directorxCaptions.length,
    props
  };
}

export async function assertRenderPropsBindRemotionProjection(run, { projectPath, propsPath, compositionId }) {
  const projection = run?.remotionRenderProjection;
  if (!projection || projection.status !== "ready") throw new Error("Render is blocked: compile the canonical Remotion render projection first.");
  if (compositionId !== COMPOSITION_ID) throw new Error(`Render is blocked: canonical projection requires ${COMPOSITION_ID}.`);
  if (!String(propsPath ?? "").trim()) throw new Error("Render is blocked: propsPath must reference the canonical Remotion projection.");
  const absolutePath = containedPath(projectPath, propsPath);
  const details = await stat(absolutePath);
  if (!details.isFile() || details.size <= 0 || details.size > 2 * 1024 * 1024) throw new Error("Canonical Remotion props must be a non-empty JSON file no larger than 2 MB.");
  const bytes = await readFile(absolutePath);
  const props = JSON.parse(bytes.toString("utf8"));
  if (props.directorxProjection?.projectionFingerprint !== projection.projectionFingerprint) {
    throw new Error("Render props do not bind the current canonical Remotion projection fingerprint.");
  }
  if (sha256(props) !== projection.propsFingerprint) throw new Error("Render props drifted from the compiled canonical Remotion projection.");
  await assertCurrentAudioSourceArtifacts(run, props.directorxTimelineAudioTracks ?? [], projectPath);
  const currentTimelineSha = run.artifacts?.["semantic_timeline.json"]?.sha256;
  const currentQualitySha = run.artifacts?.["render_quality_contract.json"]?.sha256;
  const currentTransitionSha = run.artifacts?.["transition_language_plan.json"]?.sha256 ?? null;
  const currentAudioCueSha = run.artifacts?.["audio_cue_sheet.json"]?.sha256 ?? null;
  if (projection.sourceBinding.semanticTimelineSha256 !== currentTimelineSha) throw new Error("Canonical Remotion projection is stale: semantic timeline changed.");
  if (projection.sourceBinding.renderQualityContractSha256 !== currentQualitySha) throw new Error("Canonical Remotion projection is stale: render quality contract changed.");
  if (projection.sourceBinding.transitionLanguagePlanSha256 !== currentTransitionSha) throw new Error("Canonical Remotion projection is stale: transition language plan changed.");
  if (projection.sourceBinding.audioCueSheetSha256 !== currentAudioCueSha) throw new Error("Canonical Remotion projection is stale: audio cue sheet changed.");
  return {
    required: true,
    status: "passed",
    projectionFingerprint: projection.projectionFingerprint,
    propsFingerprint: projection.propsFingerprint,
    sourceBinding: structuredClone(projection.sourceBinding),
    propsPath: relative(resolve(projectPath), absolutePath),
    propsSha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function timelineVisualClips(timeline) {
  const tracks = Array.isArray(timeline.tracks) ? timeline.tracks : [];
  const visualTracks = tracks.filter((track) => VISUAL_TRACK_TYPES.has(String(track.track_type ?? track.trackType ?? "")));
  if (visualTracks.length !== 1) throw new Error(`semantic_timeline.json must contain exactly one canonical visual track; found ${visualTracks.length}.`);
  const clips = visualTracks[0].clips;
  if (!Array.isArray(clips) || clips.length === 0) throw new Error("Canonical visual track must contain clips.");
  return clips.map((clip, index) => {
    const clipId = requiredString(clip.clip_id ?? clip.clipId, `visual clip ${index}.clip_id`);
    const startSeconds = nonNegativeNumber(clip.start_seconds ?? clip.startSeconds, `${clipId}.start_seconds`);
    const endSeconds = positiveNumber(clip.end_seconds ?? clip.endSeconds, `${clipId}.end_seconds`);
    if (endSeconds <= startSeconds) throw new Error(`${clipId} must have positive duration.`);
    return {
      clipId,
      shotId: String(clip.shot_id ?? clip.shotId ?? clipId),
      startSeconds,
      endSeconds
    };
  }).sort((left, right) => left.startSeconds - right.startSeconds || left.clipId.localeCompare(right.clipId));
}

function timelineAudioClips(timeline, durationSeconds) {
  const result = [];
  for (const track of Array.isArray(timeline.tracks) ? timeline.tracks : []) {
    const trackType = String(track.track_type ?? track.trackType ?? "");
    if (!AUDIO_TRACK_TYPES.has(trackType)) continue;
    for (const [index, clip] of (track.clips ?? []).entries()) {
      const clipId = requiredString(clip.clip_id ?? clip.clipId, `${trackType} clip ${index}.clip_id`);
      const startSeconds = nonNegativeNumber(clip.start_seconds ?? clip.startSeconds, `${clipId}.start_seconds`);
      const endSeconds = positiveNumber(clip.end_seconds ?? clip.endSeconds, `${clipId}.end_seconds`);
      if (endSeconds <= startSeconds || endSeconds > durationSeconds + 0.05) throw new Error(`${clipId} has invalid canonical audio timing.`);
      const volumeEnvelope = normalizeCanonicalVolumeEnvelope(clip.volume_envelope ?? clip.volumeEnvelope ?? [], clipId, startSeconds, endSeconds);
      result.push({ clipId, kind: normalizeAudioKind(trackType), startSeconds, endSeconds, volumeEnvelope });
    }
  }
  return result.sort((left, right) => left.startSeconds - right.startSeconds || left.clipId.localeCompare(right.clipId));
}

function timelineCaptionClips(timeline, approvedCaptions, fps, durationSeconds) {
  const captionTracks = (Array.isArray(timeline.tracks) ? timeline.tracks : []).filter((track) => CAPTION_TRACK_TYPES.has(String(track.track_type ?? track.trackType ?? "")));
  if (!approvedCaptions.length) {
    if (captionTracks.some((track) => (track.clips ?? []).length)) throw new Error("Canonical caption track exists but render quality contract has no approved captions.");
    return [];
  }
  if (captionTracks.length !== 1) throw new Error(`semantic_timeline.json must contain exactly one canonical caption track; found ${captionTracks.length}.`);
  const clips = captionTracks[0].clips ?? [];
  if (clips.length !== approvedCaptions.length) throw new Error("Canonical caption count must match the approved render quality captions.");
  const tolerance = (1 / fps) + 0.001;
  return clips.map((clip, index) => {
    const clipId = requiredString(clip.clip_id ?? clip.clipId, `caption clip ${index}.clip_id`);
    const startSeconds = nonNegativeNumber(clip.start_seconds ?? clip.startSeconds, `${clipId}.start_seconds`);
    const endSeconds = positiveNumber(clip.end_seconds ?? clip.endSeconds, `${clipId}.end_seconds`);
    if (endSeconds <= startSeconds || endSeconds > durationSeconds + tolerance) throw new Error(`${clipId} has invalid canonical caption timing.`);
    const approved = approvedCaptions[index];
    if (Math.abs(startSeconds - Number(approved.startSeconds)) > tolerance || Math.abs(endSeconds - Number(approved.endSeconds)) > tolerance) throw new Error(`Canonical caption timing drifted for ${clipId}.`);
    const canonicalText = stringValue(clip.text);
    const approvedText = requiredString(approved.text, `approved caption ${index}.text`);
    if (canonicalText && canonicalText !== approvedText) throw new Error(`Canonical caption text drifted for ${clipId}.`);
    return { clipId, startSeconds, endSeconds, text: canonicalText || approvedText };
  });
}

function assertCanonicalVisualTiming(canonical, approved, fps, durationSeconds) {
  if (!Array.isArray(approved) || approved.length !== canonical.length) throw new Error("Render quality visual clips must match the canonical timeline clip count.");
  const tolerance = (1 / fps) + 0.001;
  for (let index = 0; index < canonical.length; index += 1) {
    const expected = canonical[index];
    const actual = approved[index];
    if (String(actual.clipId) !== expected.clipId) throw new Error(`Canonical visual order drifted at index ${index}: ${expected.clipId} != ${actual.clipId}.`);
    if (Math.abs(Number(actual.startSeconds) - expected.startSeconds) > tolerance || Math.abs(Number(actual.endSeconds) - expected.endSeconds) > tolerance) {
      throw new Error(`Canonical visual timing drifted for ${expected.clipId}.`);
    }
  }
  if (Math.abs(canonical.at(-1).endSeconds - durationSeconds) > tolerance) throw new Error("Canonical visual timeline duration does not match the render quality contract.");
}

function normalizeMediaBindings(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("mediaBindings must contain one local binding per canonical visual clip.");
  const result = values.map((value, index) => {
    const clipId = requiredString(value.clipId, `mediaBindings[${index}].clipId`);
    const kind = requiredString(value.kind, `mediaBindings[${index}].kind`);
    if (!VISUAL_KINDS.has(kind)) throw new Error(`Unsupported media binding kind: ${kind}`);
    const src = localStaticSource(value.src, `mediaBindings[${index}].src`);
    return {
      ...structuredClone(value),
      clipId,
      kind,
      src,
      fit: value.fit === "contain" ? "contain" : "cover",
      muted: value.muted !== false
    };
  });
  if (new Set(result.map((binding) => binding.clipId)).size !== result.length) throw new Error("mediaBindings clipId values must be unique.");
  return result;
}

function compileTimelineAudioTracks(clips, values, narration, fps) {
  if (!Array.isArray(values)) throw new Error("timelineAudioBindings must be an array.");
  const bindings = new Map(values.map((value, index) => {
    const clipId = requiredString(value.clipId, `timelineAudioBindings[${index}].clipId`);
    return [clipId, {
      ...structuredClone(value),
      clipId,
      src: localStaticSource(value.src, `timelineAudioBindings[${index}].src`),
      sourceArtifactRef: requiredString(value.sourceArtifactRef, `timelineAudioBindings[${index}].sourceArtifactRef`),
      sourceSha256: requiredSha256(value.sourceSha256, `timelineAudioBindings[${index}].sourceSha256`),
      sourceDurationSeconds: positiveNumber(value.sourceDurationSeconds, `timelineAudioBindings[${index}].sourceDurationSeconds`)
    }];
  }));
  if (bindings.size !== values.length) throw new Error("timelineAudioBindings clipId values must be unique.");
  const tracks = clips.map((clip) => {
    const binding = bindings.get(clip.clipId);
    if (!binding) throw new Error(`Timeline audio binding missing for ${clip.clipId}.`);
    bindings.delete(clip.clipId);
    const startFromFrame = nonNegativeInteger(binding.startFromFrame ?? 0, `${clip.clipId}.startFromFrame`);
    const durationInFrames = Math.round((clip.endSeconds - clip.startSeconds) * fps);
    const requiredSourceDurationSeconds = (startFromFrame + durationInFrames) / fps;
    if (binding.sourceDurationSeconds + Math.max(0.05, 1 / fps) < requiredSourceDurationSeconds) {
      throw new Error(`${clip.clipId} source audio ends before its canonical timeline window.`);
    }
    return {
      id: clip.clipId,
      kind: clip.kind,
      fromFrame: Math.round(clip.startSeconds * fps),
      durationInFrames,
      src: binding.src,
      sourceArtifactRef: binding.sourceArtifactRef,
      sourceSha256: binding.sourceSha256,
      sourceDurationSeconds: binding.sourceDurationSeconds,
      startFromFrame,
      volume: boundedNumber(binding.volume ?? 1, 0, 4, `${clip.clipId}.volume`),
      volumeEnvelope: clip.volumeEnvelope.map((range) => ({
        fromFrame: Math.round(range.startSeconds * fps),
        toFrame: Math.round(range.endSeconds * fps),
        volume: range.volume
      }))
    };
  });
  if (bindings.size) throw new Error(`Timeline audio bindings contain unknown clips: ${[...bindings.keys()].join(", ")}.`);
  assertNarrationAudioCoverage(clips.filter((clip) => clip.kind === "dialogue"), narration, fps);
  return tracks;
}

async function assertCurrentAudioSourceArtifacts(run, tracks, projectPath) {
  for (const track of tracks) {
    const record = run.artifacts?.[track.sourceArtifactRef];
    if (!record || record.mediaKind !== "audio") throw new Error(`Canonical Remotion audio source is not a registered audio artifact: ${track.sourceArtifactRef}.`);
    if (record.sha256 !== track.sourceSha256) throw new Error(`Canonical Remotion audio source record changed: ${track.sourceArtifactRef}.`);
    const bytes = await readFile(containedPath(projectPath, record.path ?? record.relativePath));
    const currentSha256 = createHash("sha256").update(bytes).digest("hex");
    if (currentSha256 !== track.sourceSha256) throw new Error(`Canonical Remotion audio source file changed: ${track.sourceArtifactRef}.`);
  }
}

function compileCaptionCues(clips, values, safeArea, fps) {
  if (!Array.isArray(values)) throw new Error("captionBindings must be an array.");
  const bindings = new Map(values.map((value, index) => {
    const clipId = requiredString(value.clipId, `captionBindings[${index}].clipId`);
    return [clipId, { ...structuredClone(value), clipId }];
  }));
  if (bindings.size !== values.length) throw new Error("captionBindings clipId values must be unique.");
  const defaultPosition = normalizeCaptionPosition(safeArea?.subtitle_region ?? safeArea?.subtitleRegion ?? "lower_third");
  const captions = clips.map((clip) => {
    const binding = bindings.get(clip.clipId) ?? {};
    bindings.delete(clip.clipId);
    return {
      id: clip.clipId,
      fromFrame: Math.round(clip.startSeconds * fps),
      durationInFrames: Math.round((clip.endSeconds - clip.startSeconds) * fps),
      text: clip.text,
      position: normalizeCaptionPosition(binding.position ?? defaultPosition),
      maxLines: positiveInteger(binding.maxLines ?? 2, `${clip.clipId}.maxLines`),
      emphasisTokens: normalizeStringArray(binding.emphasisTokens ?? [], `${clip.clipId}.emphasisTokens`)
    };
  });
  if (bindings.size) throw new Error(`Caption bindings contain unknown clips: ${[...bindings.keys()].join(", ")}.`);
  return captions;
}

function normalizeCanonicalVolumeEnvelope(values, clipId, clipStart, clipEnd) {
  if (!Array.isArray(values)) throw new Error(`${clipId}.volume_envelope must be an array.`);
  return values.map((range, index) => {
    const startSeconds = nonNegativeNumber(range.start_seconds ?? range.startSeconds, `${clipId}.volume_envelope[${index}].start_seconds`);
    const endSeconds = positiveNumber(range.end_seconds ?? range.endSeconds, `${clipId}.volume_envelope[${index}].end_seconds`);
    if (startSeconds < clipStart || endSeconds > clipEnd || endSeconds <= startSeconds) throw new Error(`${clipId}.volume_envelope[${index}] must stay inside the canonical clip.`);
    return { startSeconds, endSeconds, volume: boundedNumber(range.volume, 0, 4, `${clipId}.volume_envelope[${index}].volume`) };
  }).sort((left, right) => left.startSeconds - right.startSeconds);
}

function assertNarrationAudioCoverage(dialogueClips, narration, fps) {
  if (!narration?.text) return;
  if (!dialogueClips.length) throw new Error("Canonical timeline must bind a dialogue/voiceover track for approved narration.");
  const tolerance = (1 / fps) + 0.05;
  const ordered = [...dialogueClips].sort((left, right) => left.startSeconds - right.startSeconds);
  if (ordered[0].startSeconds - Number(narration.startSeconds) > tolerance) throw new Error("Canonical dialogue audio starts after the approved narration.");
  if (Number(narration.endSeconds) - ordered.at(-1).endSeconds > tolerance) throw new Error("Canonical dialogue audio ends before the approved narration.");
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].startSeconds - ordered[index - 1].endSeconds > 0.25) throw new Error("Canonical dialogue audio contains an unapproved narration gap.");
  }
}

function normalizeAudioKind(trackType) { return ["dialogue", "voiceover", "narration"].includes(trackType) ? "dialogue" : trackType; }
function normalizeCaptionPosition(value) { const position = String(value ?? "").replaceAll("-", "_"); if (["lower_third", "center", "top"].includes(position)) return position; throw new Error(`Unsupported caption position: ${value}`); }
function normalizeStringArray(values, field) { if (!Array.isArray(values)) throw new Error(`${field} must be an array.`); return values.map((value, index) => requiredString(value, `${field}[${index}]`)); }

function compileAudioBridgeTracks(boundaries, values, fps) {
  if (!Array.isArray(values)) throw new Error("audioBridgeBindings must be an array.");
  const bindings = new Map(values.map((value, index) => {
    const boundaryId = requiredString(value.boundaryId, `audioBridgeBindings[${index}].boundaryId`);
    return [boundaryId, { ...structuredClone(value), boundaryId, src: localStaticSource(value.src, `audioBridgeBindings[${index}].src`) }];
  }));
  const tracks = [];
  for (const boundary of boundaries) {
    const audio = boundary.rendererInstruction?.audio ?? { kind: "none" };
    const binding = bindings.get(boundary.boundaryId);
    if (audio.kind === "none") {
      if (binding) throw new Error(`Unexpected audio bridge binding for ${boundary.boundaryId}.`);
      continue;
    }
    if (!binding) throw new Error(`Audio bridge binding missing for ${boundary.boundaryId}.`);
    let fromFrame;
    let durationInFrames;
    if (audio.kind === "j_cut") {
      fromFrame = boundary.cutFrame + audio.offsetFrames;
      durationInFrames = Math.max(1, -audio.offsetFrames);
    } else if (audio.kind === "l_cut") {
      fromFrame = boundary.cutFrame;
      durationInFrames = Math.max(1, audio.tailFrames);
    } else if (audio.kind === "room_tone") {
      fromFrame = boundary.cutFrame - Math.floor(audio.overlapFrames / 2);
      durationInFrames = Math.max(1, audio.overlapFrames);
    } else {
      durationInFrames = positiveInteger(binding.durationInFrames ?? Math.round(fps * 0.5), `${boundary.boundaryId}.durationInFrames`);
      fromFrame = boundary.cutFrame - Math.floor(durationInFrames / 2);
    }
    tracks.push({
      boundaryId: boundary.boundaryId,
      bridgeKind: audio.kind,
      fromFrame: Math.max(0, fromFrame),
      durationInFrames,
      src: binding.src,
      startFromFrame: nonNegativeInteger(binding.startFromFrame ?? 0, `${boundary.boundaryId}.startFromFrame`),
      volume: boundedNumber(binding.volume ?? 1, 0, 4, `${boundary.boundaryId}.volume`)
    });
    bindings.delete(boundary.boundaryId);
  }
  if (bindings.size) throw new Error(`Audio bridge bindings contain unknown boundaries: ${[...bindings.keys()].join(", ")}.`);
  return tracks;
}

function localStaticSource(value, field) {
  const src = requiredString(value, field).replaceAll("\\", "/");
  if (/^[a-z]+:\/\//i.test(src) || src.startsWith("/") || src.split("/").includes("..")) throw new Error(`${field} must be a staticFile-relative local path.`);
  return src;
}

function requiredSha256(value, field) {
  const result = String(value ?? "");
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${field} must be a sha256 digest.`);
  return result;
}

function optionalSha256(value, field) {
  if (value === null || value === undefined || value === "") return null;
  return requiredSha256(value, field);
}

function requiredString(value, field) { const result = String(value ?? "").trim(); if (!result) throw new Error(`${field} is required.`); return result; }
function stringValue(value) { const result = String(value ?? "").trim(); return result || ""; }
function positiveNumber(value, field) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive.`); return number; }
function nonNegativeNumber(value, field) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be non-negative.`); return number; }
function positiveInteger(value, field) { const number = Number(value); if (!Number.isInteger(number) || number <= 0) throw new Error(`${field} must be a positive integer.`); return number; }
function nonNegativeInteger(value, field) { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new Error(`${field} must be a non-negative integer.`); return number; }
function boundedNumber(value, minimum, maximum, field) { const number = Number(value); if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${field} must be between ${minimum} and ${maximum}.`); return number; }
function containedPath(projectPath, path) { const root = resolve(projectPath); const absolute = resolve(root, path); const relation = relative(root, absolute); if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Execution paths must stay inside the project workspace."); return absolute; }
function sha256(value) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
