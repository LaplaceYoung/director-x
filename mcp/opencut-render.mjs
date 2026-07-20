import { mkdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { runProcess } from "./media-execution.mjs";

const TRANSITIONS = Object.freeze({
  crossfade: "fade",
  dip_to_black: "fadeblack",
  fade_through_color: "fadewhite",
  slide: "slideleft",
  wipe: "wipeleft",
  zoom_blur: "hblur",
  whip_pan: "slideleft"
});

export function compileOpenCutRenderPlan({ projectPath, run, outputPath }) {
  const sessionId = run.openCutEditor?.activeSessionId;
  const session = sessionId ? run.openCutEditor.sessions?.[sessionId] : null;
  if (!session || session.status !== "render_required") throw new Error("Director X Cut render requires a committed editor session in render_required state.");
  if (run.editSession?.receipt?.status !== "committed" || run.editSession.receipt.patchId !== session.patchId) throw new Error("Director X Cut render requires the committed canonical patch receipt.");
  const revisionId = run.editSession.timelineHeads?.[session.timelineId];
  const revision = revisionId ? run.editSession.revisions?.[revisionId] : null;
  if (!revision?.timeline) throw new Error("Director X Cut render requires the committed canonical timeline revision.");
  const videoTrack = revision.timeline.tracks.find((track) => track.kind === "video");
  const clips = [...(videoTrack?.clips ?? [])].sort((left, right) => seconds(left.timelineRange.start) - seconds(right.timelineRange.start));
  if (!clips.length) throw new Error("Director X Cut render requires at least one video clip.");
  const canvas = session.project?.settings?.canvasSize;
  if (!Number.isInteger(canvas?.width) || !Number.isInteger(canvas?.height) || canvas.width < 16 || canvas.height < 16) throw new Error("Director X Cut render requires a valid project canvas size.");
  const fps = session.fps;
  const output = containedPath(projectPath, outputPath);
  if (extname(output).toLowerCase() !== ".mp4") throw new Error("Director X Cut render output must end in .mp4.");

  const sources = [];
  const inputByArtifact = new Map();
  for (const clip of clips) {
    if (inputByArtifact.has(clip.mediaRef)) continue;
    const artifact = run.artifacts?.[clip.mediaRef];
    if (!artifact?.path || !["video", "audio"].includes(artifact.mediaKind)) throw new Error(`Director X Cut cannot render missing media artifact: ${clip.mediaRef}`);
    const path = containedPath(projectPath, artifact.path);
    if (path === output) throw new Error("Director X Cut render output must not overwrite an immutable source file.");
    inputByArtifact.set(clip.mediaRef, sources.length);
    sources.push({ artifactRef: clip.mediaRef, path, inputIndex: sources.length });
  }

  const filters = [];
  const transitionEvidence = [];
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index], inputIndex = inputByArtifact.get(clip.mediaRef), duration = seconds(clip.sourceRange.duration), sourceStart = seconds(clip.sourceRange.start);
    const previousTransition = blendTransition(transitionEffect(clips[index - 1], clip.clipId));
    const nextTransition = blendTransition(transitionEffect(clip, clips[index + 1]?.clipId));
    const videoFilters = [`trim=start=${decimal(sourceStart)}:duration=${decimal(duration)}`, "setpts=PTS-STARTPTS"];
    if (previousTransition) videoFilters.push(`tpad=start_mode=clone:start_duration=${decimal(seconds(previousTransition.duration) / 2)}`);
    if (nextTransition) videoFilters.push(`tpad=stop_mode=clone:stop_duration=${decimal(seconds(nextTransition.duration) / 2)}`);
    const crop = clip.effects?.find((effect) => effect.kind === "crop");
    if (crop) videoFilters.push(`crop=iw*${decimal(crop.width)}:ih*${decimal(crop.height)}:iw*${decimal(crop.x)}:ih*${decimal(crop.y)}`);
    videoFilters.push(`scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=decrease`, `pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2`, "setsar=1", `fps=${fps}`, "format=yuv420p");
    filters.push(`[${inputIndex}:v]${videoFilters.join(",")}[v${index}]`);

    const audioFilters = [`atrim=start=${decimal(sourceStart)}:duration=${decimal(duration)}`, "asetpts=PTS-STARTPTS", "aresample=48000", "aformat=sample_rates=48000:channel_layouts=stereo"];
    const gain = clip.effects?.find((effect) => effect.kind === "gain");
    if (gain) audioFilters.push(`volume=${decimal(gain.db)}dB`);
    const duck = clip.effects?.find((effect) => effect.kind === "duck");
    if (duck) audioFilters.push(duckVolumeFilter(duck, clip));
    if (previousTransition) audioFilters.push(`adelay=${Math.round(seconds(previousTransition.duration) * 500)}:all=1`);
    if (nextTransition) audioFilters.push(`apad=pad_dur=${decimal(seconds(nextTransition.duration) / 2)}`);
    filters.push(`[${inputIndex}:a]${audioFilters.join(",")}[a${index}]`);
    const declaredTransition = transitionEffect(clip, clips[index + 1]?.clipId);
    if (declaredTransition) transitionEvidence.push({
      fromClipId: clip.clipId,
      toClipId: declaredTransition.toClipId,
      kind: declaredTransition.transitionKind,
      durationSeconds: declaredTransition.transitionKind === "match_cut" ? 0 : seconds(declaredTransition.duration),
      renderOperation: declaredTransition.transitionKind === "match_cut" ? "concat" : "xfade"
    });
  }

  let videoLabel = "v0", audioLabel = "a0", cumulativeDuration = seconds(clips[0].timelineRange.duration);
  for (let index = 1; index < clips.length; index += 1) {
    const transition = blendTransition(transitionEffect(clips[index - 1], clips[index].clipId));
    const nextVideo = `vx${index}`, nextAudio = `ax${index}`;
    if (transition) {
      const duration = seconds(transition.duration), offset = cumulativeDuration - duration / 2;
      filters.push(`[${videoLabel}][v${index}]xfade=transition=${TRANSITIONS[transition.transitionKind]}:duration=${decimal(duration)}:offset=${decimal(offset)}[${nextVideo}]`);
      filters.push(`[${audioLabel}][a${index}]acrossfade=d=${decimal(duration)}:c1=tri:c2=tri[${nextAudio}]`);
    } else {
      filters.push(`[${videoLabel}][v${index}]concat=n=2:v=1:a=0[${nextVideo}]`);
      filters.push(`[${audioLabel}][a${index}]concat=n=2:v=0:a=1[${nextAudio}]`);
    }
    videoLabel = nextVideo; audioLabel = nextAudio; cumulativeDuration += seconds(clips[index].timelineRange.duration);
  }

  const filterComplex = filters.join(";");
  const args = ["-hide_banner", "-loglevel", "error", "-y", ...sources.flatMap((source) => ["-i", source.path]), "-filter_complex", filterComplex, "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`, "-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output];
  return {
    schemaVersion: "1.0",
    engine: "ffmpeg",
    editorSessionId: session.editorSessionId,
    patchId: session.patchId,
    revisionId,
    sourceContentHash: revision.contentHash,
    sources,
    outputPath: output,
    canvasSize: canvas,
    fps,
    expectedDurationSeconds: clips.reduce((total, clip) => total + seconds(clip.timelineRange.duration), 0),
    clipCount: clips.length,
    transitions: transitionEvidence,
    filterComplex,
    command: "ffmpeg",
    args
  };
}

export async function executeOpenCutRender(input, options = {}) {
  const plan = compileOpenCutRenderPlan(input);
  await mkdir(dirname(plan.outputPath), { recursive: true });
  const execution = await (options.runFn ?? runProcess)(options.command ?? plan.command, options.args ?? plan.args, { cwd: resolve(input.projectPath), timeoutMs: input.timeoutMs ?? 900000, maxOutputBytes: 1_000_000, failureLabel: "Director X Cut render" });
  return { plan, execution, outputPath: plan.outputPath };
}

function transitionEffect(clip, toClipId) { return clip?.effects?.find((effect) => effect.kind === "transition" && effect.toClipId === toClipId) ?? null; }
function blendTransition(effect) {
  if (!effect || effect.transitionKind === "match_cut") return null;
  if (!TRANSITIONS[effect.transitionKind]) throw new Error(`Director X Cut FFmpeg renderer does not support transition: ${effect.transitionKind}`);
  return effect;
}
function seconds(time) { return Number(time?.value ?? 0) / Number(time?.rate ?? 1); }
function decimal(value) { return Number(value.toFixed(6)).toString(); }
function linearGain(db) { return Math.pow(10, db / 20); }

function duckVolumeFilter(effect, clip) {
  const clipStart = seconds(clip.timelineRange.start), start = Math.max(0, seconds(effect.range.start) - clipStart), end = Math.min(seconds(clip.timelineRange.duration), start + seconds(effect.range.duration));
  const attack = Math.min(effect.attackMs / 1000, Math.max(0, end - start)), release = Math.min(effect.releaseMs / 1000, Math.max(0, end - start - attack));
  const gain = decimal(linearGain(effect.db));
  if (attack === 0 && release === 0) return `volume=${gain}:enable='between(t\\,${decimal(start)}\\,${decimal(end)})'`;
  const attackEnd = start + attack, releaseStart = end - release;
  const attackExpr = attack > 0 ? `1-(1-${gain})*(t-${decimal(start)})/${decimal(attack)}` : gain;
  const releaseExpr = release > 0 ? `${gain}+(1-${gain})*(t-${decimal(releaseStart)})/${decimal(release)}` : gain;
  const expression = `if(lt(t\\,${decimal(start)})\\,1\\,if(lt(t\\,${decimal(attackEnd)})\\,${attackExpr}\\,if(lt(t\\,${decimal(releaseStart)})\\,${gain}\\,if(lt(t\\,${decimal(end)})\\,${releaseExpr}\\,1))))`;
  return `volume='${expression}':eval=frame`;
}

function containedPath(projectPath, path) {
  const root = resolve(projectPath), target = resolve(root, path), relation = relative(root, target);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Director X Cut render paths must stay inside the project workspace.");
  return target;
}
