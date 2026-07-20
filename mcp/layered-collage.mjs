import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { runProcess } from "./media-execution.mjs";

const REQUIRED_LAYER_TYPES = ["background", "rear", "primary", "foreground"];

export async function writeLayeredCollagePlan({ projectPath, runId, plan }) {
  validateLayeredCollagePlan(plan);
  const root = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(root, { recursive: true });
  const artifacts = {
    "layered_scene_plan.json": { schemaVersion: "1.0", runId, workflowId: plan.workflowId, title: plan.title, aspectRatio: plan.aspectRatio, fps: plan.fps, scenes: plan.scenes },
    "layer_manifest.json": { schemaVersion: "1.0", runId, extractionRoute: plan.extractionRoute, generationRoute: plan.generationRoute, layers: plan.scenes.flatMap((scene) => scene.layers.map((layer) => ({ sceneId: scene.sceneId, ...layer }))) },
    "motion_preset.json": { schemaVersion: "1.0", runId, roleMotion: plan.roleMotion, backgroundMotion: plan.backgroundMotion, stagingPolicy: plan.stagingPolicy, styleProfile: plan.styleProfile ?? {}, captionPolicy: plan.captionPolicy ?? {} },
    "audio_layer_plan.json": { schemaVersion: "1.0", runId, ttsRoute: plan.ttsRoute, voiceTimingPolicy: plan.voiceTimingPolicy, audioLayers: plan.audioLayers },
    "layered_composition_config.json": { schemaVersion: "1.0", runId, engine: "remotion", entryPoint: plan.composition.entryPoint, compositionId: plan.composition.compositionId, propsPath: plan.composition.propsPath, staticLayoutFirst: true, qaFrameSeconds: plan.composition.qaFrameSeconds, renderOutput: plan.composition.renderOutput, qualityPolicy: plan.qualityPolicy ?? defaultQualityPolicy() }
  };
  const results = {};
  for (const [artifactRef, value] of Object.entries(artifacts)) {
    const path = join(root, artifactRef);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    results[artifactRef] = { artifactRef, path };
  }
  return results;
}

export async function writeLayeredCollageReview({ projectPath, runId, phase, status, checks, evidenceRefs, note = "" }) {
  if (!['static_layout', 'motion_audio', 'final_media'].includes(phase)) throw new Error("Unsupported layered collage review phase.");
  if (!['passed', 'failed'].includes(status)) throw new Error("Layered collage review status must be passed or failed.");
  if (!Array.isArray(checks) || !checks.length) throw new Error("Layered collage review requires explicit checks.");
  if (!Array.isArray(evidenceRefs) || !evidenceRefs.length) throw new Error("Layered collage review requires evidence references.");
  const failedChecks = checks.filter((check) => check.status !== 'pass');
  if (status === 'passed' && failedChecks.length) throw new Error("A passed layered collage review cannot contain failed checks.");
  const artifactRef = `layered_review_${phase}.json`;
  const path = join(resolve(projectPath), ".directorx", "plugin-runs", runId, "artifacts", artifactRef);
  await mkdir(dirname(path), { recursive: true });
  const report = { schemaVersion: "1.0", runId, phase, status, checks, evidenceRefs, note, reviewedAt: new Date().toISOString() };
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef, path, report };
}

export async function extractChromaLayers(input, options = {}) {
  const sourcePath = containedPath(input.projectPath, input.sourcePath);
  if (!input.layers?.length) throw new Error("At least one crop region is required.");
  const similarity = finiteRange(input.similarity ?? 0.18, 0, 1, "similarity");
  const blend = finiteRange(input.blend ?? 0.08, 0, 1, "blend");
  const keyColor = String(input.keyColor ?? "0x00FF00");
  if (!/^0x[0-9A-F]{6}$/i.test(keyColor)) throw new Error("keyColor must be a six-digit FFmpeg color such as 0x00FF00.");
  const outputs = [];
  for (const layer of input.layers) {
    for (const field of ["x", "y", "width", "height"]) if (!Number.isInteger(layer[field]) || layer[field] < 0 || (["width", "height"].includes(field) && layer[field] === 0)) throw new Error(`${layer.layerId}.${field} must be a valid non-negative integer.`);
    const outputPath = containedPath(input.projectPath, layer.outputPath);
    if (!outputPath.toLowerCase().endsWith(".png")) throw new Error("Extracted layer outputPath must end in .png.");
    await mkdir(dirname(outputPath), { recursive: true });
    const filter = `crop=${layer.width}:${layer.height}:${layer.x}:${layer.y},chromakey=${keyColor}:${similarity}:${blend},format=rgba`;
    const args = ["-hide_banner", "-loglevel", "error", "-i", sourcePath, "-vf", filter, "-frames:v", "1", "-y", outputPath];
    await runProcess(options.command ?? "ffmpeg", options.argsForLayer?.(layer, args) ?? args, { cwd: resolve(input.projectPath), timeoutMs: input.timeoutMs ?? 60000, maxOutputBytes: 200000, failureLabel: `Layer extraction ${layer.layerId}` });
    outputs.push({ layerId: layer.layerId, outputPath, sha256: createHash("sha256").update(await readFile(outputPath)).digest("hex"), crop: { x: layer.x, y: layer.y, width: layer.width, height: layer.height } });
  }
  return { sourcePath, keyColor, similarity, blend, outputs };
}

export function validateLayeredCollagePlan(plan) {
  if (!plan?.workflowId || !Array.isArray(plan.scenes) || !plan.scenes.length) throw new Error("Layered collage production requires at least one scene.");
  if (!(plan.fps > 0) || !plan.aspectRatio) throw new Error("Layered collage production requires fps and aspectRatio.");
  for (const scene of plan.scenes) {
    if (!scene.sceneId || !(scene.durationSeconds > 0) || !Array.isArray(scene.layers)) throw new Error("Every layered scene needs an ID, duration, and layers.");
    const types = new Set(scene.layers.map((layer) => layer.layerType));
    const missing = REQUIRED_LAYER_TYPES.filter((type) => !types.has(type));
    if (missing.length) throw new Error(`${scene.sceneId} is missing required layer types: ${missing.join(", ")}`);
    const ids = new Set();
    for (const layer of scene.layers) {
      if (!layer.layerId || ids.has(layer.layerId)) throw new Error(`${scene.sceneId} contains a missing or duplicate layerId.`);
      ids.add(layer.layerId);
      if (!Number.isFinite(layer.zIndex) || !layer.assetPath || !layer.role) throw new Error(`${layer.layerId} needs assetPath, role, and numeric zIndex.`);
      if (layer.layerType !== "background" && !["primary", "secondary", "tertiary", "decorative"].includes(layer.role)) throw new Error(`${layer.layerId} has an unsupported narrative role.`);
      if (layer.entranceDelayFrames !== undefined && (!Number.isInteger(layer.entranceDelayFrames) || layer.entranceDelayFrames < 0)) throw new Error(`${layer.layerId}.entranceDelayFrames must be a non-negative integer.`);
      if (layer.facing !== undefined && !["left", "right", "front", "back", "neutral"].includes(layer.facing)) throw new Error(`${layer.layerId}.facing is unsupported.`);
    }
  }
  for (const role of ["primary", "secondary", "tertiary"]) if (!plan.roleMotion?.[role]) throw new Error(`roleMotion.${role} is required.`);
  if (!Array.isArray(plan.audioLayers) || !["voiceover", "music", "chapter_sfx", "entrance_sfx"].every((type) => plan.audioLayers.some((layer) => layer.type === type))) throw new Error("Audio plan must include voiceover, music, chapter_sfx, and entrance_sfx.");
  if (!plan.composition?.entryPoint || !plan.composition?.compositionId || !plan.composition?.renderOutput || !plan.composition?.qaFrameSeconds?.length) throw new Error("Remotion composition and QA frame checkpoints are required.");
}

function defaultQualityPolicy() {
  return {
    staticLayoutChecks: ["narrative hierarchy", "face/hand/prop occlusion", "shared ground plane", "caption safe area"],
    motionAudioChecks: ["staggered entrances", "role motion hierarchy", "entrance SFX frame sync", "voice/music ducking"],
    finalMediaChecks: ["duration", "resolution", "audio stream", "configured sampled frames", "no clipped body parts"]
  };
}

function finiteRange(value, min, max, label) { const number = Number(value); if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`); return number; }
function containedPath(projectPath, path) { const root = resolve(projectPath); const absolute = resolve(root, path); const relation = relative(root, absolute); if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Layer paths must stay inside the project workspace."); return absolute; }
