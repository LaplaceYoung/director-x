import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const GENERATION_MODES = new Set(["text_to_video", "image_to_video", "keyframes_to_video", "reference_to_video", "transition_clip", "video_extension", "motion_graphics", "licensed_source_edit"]);

export function compileReferenceReplicationPlan(run, input, now = new Date().toISOString()) {
  if (input.reviewerId !== "DX-Reference-Analyst") throw new Error("Reference replication planning requires the canonical DX-Reference-Analyst.");
  const reference = (run.references ?? []).find((item) => item.referenceId === input.referenceId);
  if (!reference) throw new Error(`Ingest reference ${input.referenceId} before planning its recreation.`);
  if (reference.fullFrameCoverage?.passed !== true || !reference.fullFrameManifestArtifactRef || !reference.frameIdentityArtifactRef) throw new Error("Reference recreation requires a passing all-decoded-frame extraction and identity manifest.");
  if (!input.planId || !input.target?.title || !Number.isFinite(input.target.durationSeconds) || input.target.durationSeconds <= 0 || !input.target.aspectRatio || !input.target.platform) throw new Error("Reference recreation requires a plan ID and a concrete target title, duration, aspect ratio, and platform.");
  if (!input.analysis?.hook?.mechanism || !validRange(input.analysis.hook.sourceRange) || !Array.isArray(input.analysis.beats) || !input.analysis.beats.length) throw new Error("Reference recreation requires an evidence-backed hook and beat decomposition.");
  if (!Array.isArray(input.shots) || !input.shots.length) throw new Error("Reference recreation requires at least one executable target shot.");
  if (!Array.isArray(input.adaptation?.transferablePatterns) || !input.adaptation.transferablePatterns.length || !Array.isArray(input.adaptation?.originalityRules) || input.adaptation.originalityRules.length < 3) throw new Error("Reference recreation requires transferable patterns and at least three originality rules.");
  if (!run.audioResponsibilityPlan) throw new Error("Register the approved voice, music, ambience, and SFX responsibility plan before compiling an exact recreation tool route.");

  const frameCount = reference.fullFrameCoverage.extractedFrameCount;
  validateFrameEvidence(input.analysis.hook.evidenceFrameIndices, frameCount, "hook");
  const beatIds = new Set();
  for (const beat of input.analysis.beats) {
    if (!beat.beatId || beatIds.has(beat.beatId) || !validRange(beat.sourceRange) || !beat.function || !beat.camera || !beat.motion || !beat.composition || !beat.audioEnergy) throw new Error("Every reference beat requires a unique ID, source range, function, camera, motion, composition, and audio energy.");
    validateFrameEvidence(beat.evidenceFrameIndices, frameCount, beat.beatId);
    beatIds.add(beat.beatId);
  }
  const approvedVideo = latestDecision(run, "video_model");
  const shotIds = new Set();
  let durationTotal = 0;
  const shots = input.shots.map((shot) => {
    if (!shot.targetShotId || shotIds.has(shot.targetShotId) || !beatIds.has(shot.sourceBeatId) || !GENERATION_MODES.has(shot.generationMode) || !Number.isFinite(shot.durationSeconds) || shot.durationSeconds <= 0) throw new Error("Every target shot requires a unique ID, source beat, supported generation mode, and positive duration.");
    if (!shot.shotFunction || !shot.promptIntent || !shot.camera || !shot.continuityStrategy || !shot.fallback || !Array.isArray(shot.originalityChanges) || shot.originalityChanges.length < 2) throw new Error(`${shot.targetShotId} requires function, prompt intent, camera, continuity, fallback, and at least two originality changes.`);
    validateFrameEvidence(shot.referenceFrameIndices, frameCount, shot.targetShotId);
    if (!["motion_graphics", "licensed_source_edit"].includes(shot.generationMode)) {
      if (!approvedVideo) throw new Error(`${shot.targetShotId} requires a user-approved video provider and model.`);
      const providerId = shot.providerId ?? approvedVideo?.providerId ?? approvedVideo?.provider_id;
      const modelId = shot.modelId ?? approvedVideo?.modelId ?? approvedVideo?.model_id;
      if (!providerId || !modelId) throw new Error(`${shot.targetShotId} requires an exact approved video provider and model.`);
      if (approvedVideo && ((approvedVideo.providerId ?? approvedVideo.provider_id) !== providerId || (approvedVideo.modelId ?? approvedVideo.model_id) !== modelId)) throw new Error(`${shot.targetShotId} does not match the user-approved video provider/model.`);
      shot = { ...shot, providerId, modelId };
    }
    if (shot.generationMode === "licensed_source_edit" && !reuseAllowed(reference, input)) throw new Error("Reference pixels may be edited only when durable reuse rights were separately proven.");
    shotIds.add(shot.targetShotId);
    durationTotal += shot.durationSeconds;
    return structuredClone(shot);
  });
  if (Math.abs(durationTotal - input.target.durationSeconds) > .25) throw new Error("Executable shot durations must sum to the approved target duration.");

  const reuse = reuseAllowed(reference, input);
  const blockedReuse = reuse ? [...new Set(input.adaptation.blockedReuse ?? [])] : [...new Set([
    "source pixels and clips",
    "source dialogue and voice likeness",
    "source music and sound recording",
    "source subtitles and copy",
    "source logos, product marks, and protected character identity",
    ...(input.adaptation.blockedReuse ?? [])
  ])];
  const plan = {
    schemaVersion: "1.0",
    planId: input.planId,
    referenceId: input.referenceId,
    sourceEvidence: {
      clipArtifactRef: reference.clipArtifactRef,
      receiptArtifactRef: reference.receiptArtifactRef,
      fullFrameManifestArtifactRef: reference.fullFrameManifestArtifactRef,
      frameIdentityArtifactRef: reference.frameIdentityArtifactRef,
      extractedFrameCount: frameCount,
      rightsStatus: reference.rightsStatus,
      analysisSection: reference.analysisSection ?? null
    },
    target: structuredClone(input.target),
    adaptationMode: reuse ? "rights_authorized_recreation" : "structure_and_directing_language_only",
    analysis: structuredClone(input.analysis),
    adaptation: {
      transferablePatterns: structuredClone(input.adaptation.transferablePatterns),
      mustChange: structuredClone(input.adaptation.mustChange ?? []),
      originalityRules: structuredClone(input.adaptation.originalityRules),
      blockedReuse
    },
    execution: {
      shots,
      totalDurationSeconds: durationTotal,
      acquisitionAndAnalysisTools: [
        { step: "source_open", tool: "Codex web/browser", evidence: "opened source URL" },
        { step: "authorization", tool: "Codex request_user_input", evidence: "source-scoped reference_download decision" },
        { step: "download", tool: "yt-dlp", evidence: reference.receiptArtifactRef },
        { step: "probe_and_all_frame_identity", tool: "ffprobe", evidence: reference.frameIdentityArtifactRef },
        { step: "all_frame_extraction", tool: "FFmpeg", evidence: reference.fullFrameManifestArtifactRef },
        { step: "multimodal_director_analysis", tool: "DX-Reference-Analyst", evidence: "reference_replication_plan.json" }
      ],
      productionTools: {
        visualGeneration: [...new Map(shots.filter((shot) => shot.providerId).map((shot) => [`${shot.providerId}:${shot.modelId}`, { providerId: shot.providerId, modelId: shot.modelId, modes: [...new Set(shots.filter((item) => item.providerId === shot.providerId && item.modelId === shot.modelId).map((item) => item.generationMode))] }])).values()],
        voice: structuredClone(run.audioResponsibilityPlan?.voice ?? { owner: "unresolved" }),
        music: structuredClone(run.audioResponsibilityPlan?.music ?? { owner: "unresolved" }),
        ambienceAndSfx: structuredClone(run.audioResponsibilityPlan?.ambienceAndSfx ?? { owner: "unresolved" }),
        composition: ["Remotion", "FFmpeg"],
        verification: ["ffprobe", "Director X exhaustive frame audit", "DX-Quality-Reviewer"]
      },
      requiredDownstreamArtifacts: ["shotlist.json", "keyframe_storyboard.json", "generation_request.json", "semantic_timeline.json", "render_report.json", "frame_audit_report.json"]
    },
    reviewerId: input.reviewerId,
    createdAt: now
  };
  run.referenceReplicationPlans ??= {};
  run.referenceReplicationPlans[plan.planId] = plan;
  return plan;
}

export async function writeReferenceReplicationPlan({ projectPath, runId, plan }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const values = {
    "reference_replication_plan.json": plan,
    "reference_shot_blueprint.json": {
      schemaVersion: "1.0",
      planId: plan.planId,
      referenceId: plan.referenceId,
      hook: plan.analysis.hook,
      beats: plan.analysis.beats,
      targetShots: plan.execution.shots,
      adaptation: plan.adaptation
    },
    "reference_tool_route.json": {
      schemaVersion: "1.0",
      planId: plan.planId,
      acquisitionAndAnalysisTools: plan.execution.acquisitionAndAnalysisTools,
      productionTools: plan.execution.productionTools,
      requiredDownstreamArtifacts: plan.execution.requiredDownstreamArtifacts
    }
  };
  const written = {};
  for (const [artifactRef, value] of Object.entries(values)) {
    const path = resolve(directory, artifactRef);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    written[artifactRef] = { artifactRef, path };
  }
  return written;
}

function latestDecision(run, kind) {
  return [...(run.decisions ?? [])].reverse().find((decision) => decision.kind === kind)?.value ?? null;
}
function reuseAllowed(reference, input) {
  return input.reuseAuthorized === true && ["user_owned", "licensed", "public_domain"].includes(reference.rightsStatus);
}
function validRange(value) {
  return Number.isFinite(value?.startSeconds) && Number.isFinite(value?.endSeconds) && value.startSeconds >= 0 && value.endSeconds > value.startSeconds;
}
function validateFrameEvidence(values, frameCount, label) {
  if (!Array.isArray(values) || values.length < 2 || values.some((value) => !Number.isInteger(value) || value < 0 || value >= frameCount)) throw new Error(`${label} requires at least two valid all-frame evidence indices.`);
}
