import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parseCaptionText } from "./caption-import.mjs";
import { collectFrameIdentityEvidence } from "./frame-identity-evidence.mjs";

export const VIDEO_READ_PROFILES = Object.freeze(["transcript_only", "fast_keyframes", "scene_summary", "full_frame_evidence"]);
export const VIDEO_READ_UPSTREAM = Object.freeze({
  repository: "https://github.com/bradautomates/claude-video",
  commit: "83da59fa78c3eee9e20f515fe75c438bb5166efd",
  license: "MIT",
  implementation: "rewritten_node_esm"
});

const PROFILE_DEFAULT_CAPS = Object.freeze({ transcript_only: 0, fast_keyframes: 50, scene_summary: 100, full_frame_evidence: 3600 });
const MAX_SAMPLE_CANDIDATES = 2000;
const SCENE_MINIMUM = 8;
const KEYFRAME_MINIMUM = 4;
const DEDUP_SIDE = 16;
const DEDUP_THRESHOLD = 2;
const SHOWINFO_PATTERN = /pts_time:([-0-9.]+)/g;

export function planVideoRead(input) {
  const profile = normalizeProfile(input.profile);
  const fullDurationSeconds = finiteNonNegative(input.durationSeconds, "Video duration");
  const startSeconds = finiteNonNegative(input.startSeconds ?? 0, "Video read start");
  const endSeconds = input.endSeconds == null ? fullDurationSeconds : finiteNonNegative(input.endSeconds, "Video read end");
  if (endSeconds <= startSeconds || startSeconds >= fullDurationSeconds || endSeconds > fullDurationSeconds + 0.05) throw new Error("Video read range must stay inside the source duration.");
  if (profile === "full_frame_evidence" && (startSeconds !== 0 || Math.abs(endSeconds - fullDurationSeconds) > 0.05)) throw new Error("Full-frame evidence must cover the complete source; use a sampled profile for focused ranges.");
  const durationSeconds = endSeconds - startSeconds;
  const focused = startSeconds > 0 || endSeconds < fullDurationSeconds - 0.05;
  if (profile === "full_frame_evidence" && (input.cueTimestamps?.length ?? 0) > 0) throw new Error("Full-frame evidence already contains every decoded frame; transcript cue frames are only valid for sampled profiles.");
  const defaultCap = profile === "transcript_only" && (input.cueTimestamps?.length ?? 0) > 0
    ? Math.min(100, input.cueTimestamps.length)
    : PROFILE_DEFAULT_CAPS[profile];
  const maxFrames = input.maxFrames == null ? defaultCap : boundedInteger(input.maxFrames, profile === "full_frame_evidence" ? 1 : 0, 3600, "Video read frame cap");
  const targetFrames = profile === "transcript_only" ? 0 : profile === "full_frame_evidence" ? maxFrames : Math.min(maxFrames, focused ? focusedBudget(durationSeconds) : fullVideoBudget(durationSeconds));
  const fps = profile === "transcript_only" || profile === "full_frame_evidence" ? null : round(Math.min(2, Math.max(1 / Math.max(durationSeconds, 1), targetFrames / Math.max(durationSeconds, 0.001))));
  return { profile, fullDurationSeconds, startSeconds, endSeconds, durationSeconds: round(durationSeconds), focused, maxFrames, targetFrames, fps, resolution: boundedInteger(input.resolution ?? 512, 160, 1920, "Video read resolution") };
}

export async function readVideoEvidence(input, options = {}) {
  const projectPath = resolve(input.projectPath);
  const videoPath = containedPath(projectPath, input.videoPath, "Video source");
  const sourceStat = await stat(videoPath);
  if (!sourceStat.isFile() || sourceStat.size <= 0) throw new Error("Video source must be a non-empty project file.");
  const readId = safeId(input.readId);
  const run = options.runFn ?? runTextProcess;
  const probe = await probeVideo(videoPath, projectPath, input.timeoutMs, run);
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const format = probe.format ?? {};
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  if (!videoStream) throw new Error("Video source has no decodable video stream.");
  const plan = planVideoRead({ ...input, durationSeconds: Number(format.duration) });
  const root = containedPath(projectPath, `.directorx/plugin-runs/${input.runId}/video-reads/${readId}`, "Video read output");
  const candidateDir = join(root, "candidates");
  const frameDir = join(root, "frames");
  await rm(root, { recursive: true, force: true });
  await mkdir(candidateDir, { recursive: true });
  await mkdir(frameDir, { recursive: true });

  const transcript = input.transcriptPath ? await loadTranscript(projectPath, input.transcriptPath, plan) : null;
  const cueFrames = await extractCueFrames({ videoPath, candidateDir, timestamps: input.cueTimestamps ?? [], plan, run, projectPath, timeoutMs: input.timeoutMs });
  const remainingCap = Math.max(0, plan.maxFrames - cueFrames.length);
  let selected = [];
  let selection = { engine: "none", candidateCount: 0, deduplicatedCount: 0, selectedCount: 0, fallback: false, candidateCoverageTruncated: false };

  if (plan.profile === "fast_keyframes" && remainingCap > 0) {
    const candidates = await extractCandidates({ videoPath, candidateDir, plan, mode: "keyframes", run, projectPath, timeoutMs: input.timeoutMs });
    if (candidates.length >= KEYFRAME_MINIMUM) {
      ({ selected, selection } = await selectCandidates(candidates, remainingCap, input.deduplicate !== false, "keyframes", projectPath, input.timeoutMs, options.runBufferFn));
    } else {
      const fallback = await extractCandidates({ videoPath, candidateDir, plan, mode: "uniform", run, projectPath, timeoutMs: input.timeoutMs });
      ({ selected, selection } = await selectCandidates(fallback, remainingCap, input.deduplicate !== false, "uniform", projectPath, input.timeoutMs, options.runBufferFn));
      selection.fallback = true;
      selection.fallbackFrom = "keyframes";
    }
  } else if (plan.profile === "scene_summary" && remainingCap > 0) {
    const candidates = await extractCandidates({ videoPath, candidateDir, plan, mode: "scene", run, projectPath, timeoutMs: input.timeoutMs });
    if (candidates.length >= SCENE_MINIMUM) {
      ({ selected, selection } = await selectCandidates(candidates, remainingCap, input.deduplicate !== false, "scene", projectPath, input.timeoutMs, options.runBufferFn));
    } else {
      const fallback = await extractCandidates({ videoPath, candidateDir, plan, mode: "uniform", run, projectPath, timeoutMs: input.timeoutMs });
      ({ selected, selection } = await selectCandidates(fallback, remainingCap, input.deduplicate !== false, "uniform", projectPath, input.timeoutMs, options.runBufferFn));
      selection.fallback = true;
      selection.fallbackFrom = "scene";
    }
  } else if (plan.profile === "full_frame_evidence") {
    const estimated = exactOrEstimatedFrames(videoStream, format);
    if (estimated != null && estimated > plan.maxFrames) throw new Error(`Complete source contains about ${estimated} frames, above the ${plan.maxFrames}-frame bound. Raise the bound or use scene_summary.`);
    selected = await extractCandidates({ videoPath, candidateDir, plan, mode: "full", run, projectPath, timeoutMs: input.timeoutMs });
    if (selected.length > plan.maxFrames) throw new Error("Full-frame extraction exceeded the declared frame bound.");
    selection = { engine: "all_decoded_frames", candidateCount: selected.length, deduplicatedCount: 0, selectedCount: selected.length, fallback: false, candidateCoverageTruncated: false };
  }

  const merged = mergePinnedFrames(selected, cueFrames, plan.maxFrames);
  const frames = await materializeFrames(merged, frameDir, projectPath);
  const sourceSha256 = await sha256(videoPath);
  let frameIdentity = null;
  let fullFrameCoverage = null;
  if (plan.profile === "full_frame_evidence") {
    const collectIdentity = options.collectFrameIdentityFn ?? collectFrameIdentityEvidence;
    frameIdentity = await collectIdentity({
      projectPath,
      runId: input.runId,
      videoPath,
      sourceMediaSha256: sourceSha256,
      stream: videoStream,
      auditedFrameCount: frames.length,
      artifactRef: `video_read_frame_identity.${readId}.jsonl`,
      timeoutMs: input.timeoutMs ?? 300000
    }, options.identityOptions ?? {});
    fullFrameCoverage = { extractedFrameCount: frames.length, identityFrameCount: frameIdentity.frameCount, probeReachedEof: frameIdentity.probeReachedEof, countParity: frames.length === frameIdentity.frameCount, passed: frames.length === frameIdentity.frameCount && frameIdentity.probeReachedEof === true };
    if (!fullFrameCoverage.passed) throw new Error("Full-frame video read did not match the independently probed decoded-frame count.");
  }

  const contactSheetPath = frames.length ? await createContactSheet({ frames, root, run, projectPath, timeoutMs: input.timeoutMs }) : null;
  const transcriptPath = transcript ? join(root, "video_read_transcript.json") : null;
  if (transcriptPath) await atomicJson(transcriptPath, transcript);
  const manifestPath = join(root, "video_read_manifest.json");
  const manifest = { schemaVersion: "1.0", readId, sourceSha256, plan, selection: { ...selection, cueFrameCount: cueFrames.length, selectedCount: frames.length }, frames, transcript: transcript ? { path: transcriptPath, sourceFormat: transcript.sourceFormat, segmentCount: transcript.segments.length } : null, fullFrameCoverage, frameIdentityArtifactRef: frameIdentity?.artifactRef ?? null };
  await atomicJson(manifestPath, manifest);
  const receiptPath = join(root, "video_read_receipt.json");
  const receipt = { schemaVersion: "1.0", readId, status: "ready", source: { path: videoPath, sha256: sourceSha256, sizeBytes: sourceStat.size }, mediaProbe: probe, plan, selection: manifest.selection, frameManifestPath: manifestPath, contactSheetPath, transcriptPath, fullFrameCoverage, frameIdentityArtifactRef: frameIdentity?.artifactRef ?? null, frameIdentityPath: frameIdentity?.path ?? null, upstreamInfluence: VIDEO_READ_UPSTREAM, security: { projectContainedInput: true, shellExecution: false, providerCallsPerformed: false }, createdAt: new Date().toISOString() };
  await atomicJson(receiptPath, receipt);
  return { ...receipt, receiptPath, manifestPath, frames, transcript };
}

async function probeVideo(videoPath, cwd, timeoutMs, run) {
  const result = await run("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,time_base,nb_frames,nb_read_frames,sample_rate,channels", "-of", "json", videoPath], { cwd, timeoutMs: timeoutMs ?? 120000, maxOutputBytes: 2_000_000, failureLabel: "Video read probe" });
  try { return JSON.parse(result.stdout); } catch { throw new Error("Video read probe returned invalid JSON."); }
}

async function extractCandidates({ videoPath, candidateDir, plan, mode, run, projectPath, timeoutMs }) {
  await clearJpegs(candidateDir);
  const pattern = join(candidateDir, "candidate-%06d.jpg");
  const args = ["-hide_banner", "-loglevel", mode === "uniform" ? "error" : "info", "-y"];
  if (plan.startSeconds > 0) args.push("-ss", String(plan.startSeconds));
  if (mode === "keyframes") args.push("-skip_frame", "nokey");
  args.push("-i", videoPath);
  if (plan.focused) args.push("-t", String(plan.durationSeconds));
  const scale = scaleFilter(plan.resolution);
  if (mode === "keyframes") args.push("-vf", `${scale},showinfo`, "-fps_mode", "vfr", "-frames:v", String(MAX_SAMPLE_CANDIDATES));
  else if (mode === "scene") args.push("-vf", `select='eq(n\\,0)+gt(scene\\,0.20)',${scale},showinfo`, "-fps_mode", "vfr", "-frames:v", String(MAX_SAMPLE_CANDIDATES));
  else if (mode === "uniform") args.push("-vf", `fps=${plan.fps},${scale},showinfo`, "-frames:v", String(Math.max(plan.targetFrames, 1)));
  else args.push("-map", "0:v:0", "-vf", `${scale},showinfo`, "-fps_mode", "passthrough");
  args.push("-q:v", "3", pattern);
  const result = await run("ffmpeg", args, { cwd: projectPath, timeoutMs: timeoutMs ?? 300000, maxOutputBytes: 4_000_000, failureLabel: `Video read ${mode} extraction` });
  const names = (await readdir(candidateDir)).filter((name) => /^candidate-\d{6}\.jpg$/.test(name)).sort();
  const timestamps = [...result.stderr.matchAll(SHOWINFO_PATTERN)].map((match) => round(plan.startSeconds + Number(match[1])));
  return names.map((name, index) => ({ candidateIndex: index, path: join(candidateDir, name), timestampSeconds: timestamps[index] ?? estimatedTimestamp(plan, index, names.length), reason: mode === "scene" ? index === 0 ? "first_frame" : "scene_change" : mode === "keyframes" ? "keyframe" : mode === "full" ? "decoded_frame" : "uniform_sample" }));
}

async function extractCueFrames({ videoPath, candidateDir, timestamps, plan, run, projectPath, timeoutMs }) {
  const normalized = [...new Set(timestamps.map(Number).filter(Number.isFinite).map(round))].filter((value) => value >= plan.startSeconds && value <= plan.endSeconds).sort((a, b) => a - b).slice(0, plan.maxFrames);
  const frames = [];
  for (const timestamp of normalized) {
    const path = join(candidateDir, `cue-${String(frames.length + 1).padStart(6, "0")}.jpg`);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(timestamp), "-i", videoPath, "-frames:v", "1", "-vf", scaleFilter(plan.resolution), "-q:v", "3", path], { cwd: projectPath, timeoutMs: timeoutMs ?? 120000, maxOutputBytes: 100_000, failureLabel: "Video read cue-frame extraction" });
    frames.push({ candidateIndex: frames.length, path, timestampSeconds: timestamp, reason: "transcript_cue", pinned: true });
  }
  return frames;
}

async function selectCandidates(candidates, cap, deduplicate, engine, cwd, timeoutMs, runBufferFn) {
  const candidateCoverageTruncated = candidates.length >= MAX_SAMPLE_CANDIDATES;
  const deduped = deduplicate ? await deduplicateFrames(candidates, cwd, timeoutMs, runBufferFn) : { frames: candidates, dropped: 0 };
  const selected = evenSample(deduped.frames, cap);
  return { selected, selection: { engine, candidateCount: candidates.length, deduplicatedCount: deduped.dropped, selectedCount: selected.length, fallback: false, candidateCoverageTruncated } };
}

async function deduplicateFrames(frames, cwd, timeoutMs, runBufferFn = runBufferProcess) {
  if (frames.length < 2) return { frames, dropped: 0 };
  const pattern = join(dirname(frames[0].path), "candidate-%06d.jpg");
  const result = await runBufferFn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-start_number", "1", "-i", pattern, "-vf", `scale=${DEDUP_SIDE}:${DEDUP_SIDE},format=gray`, "-f", "rawvideo", "-"], { cwd, timeoutMs: timeoutMs ?? 120000, maxOutputBytes: frames.length * DEDUP_SIDE * DEDUP_SIDE + 1024, failureLabel: "Video read frame deduplication" });
  const frameBytes = DEDUP_SIDE * DEDUP_SIDE;
  if (result.stdout.length !== frames.length * frameBytes) return { frames, dropped: 0 };
  const kept = [frames[0]];
  let previous = result.stdout.subarray(0, frameBytes);
  for (let index = 1; index < frames.length; index += 1) {
    const current = result.stdout.subarray(index * frameBytes, (index + 1) * frameBytes);
    if (meanAbsoluteDifference(previous, current) > DEDUP_THRESHOLD) { kept.push(frames[index]); previous = current; }
  }
  return { frames: kept, dropped: frames.length - kept.length };
}

function mergePinnedFrames(frames, cues, maxFrames) {
  const merged = [...cues];
  for (const frame of frames) if (!merged.some((cue) => Math.abs(cue.timestampSeconds - frame.timestampSeconds) < 0.04)) merged.push(frame);
  merged.sort((a, b) => a.timestampSeconds - b.timestampSeconds || Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  if (merged.length <= maxFrames) return merged;
  const pinned = merged.filter((frame) => frame.pinned);
  const sampled = evenSample(merged.filter((frame) => !frame.pinned), Math.max(0, maxFrames - pinned.length));
  return [...pinned, ...sampled].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

async function materializeFrames(frames, frameDir, projectPath) {
  const output = [];
  for (const [index, frame] of frames.entries()) {
    const path = join(frameDir, `frame-${String(index + 1).padStart(4, "0")}.jpg`);
    await copyFile(frame.path, path);
    output.push({ frameIndex: index, timestampSeconds: frame.timestampSeconds, reason: frame.reason, path, relativePath: relative(projectPath, path), sha256: await sha256(path), pinned: frame.pinned === true });
  }
  return output;
}

async function createContactSheet({ frames, root, run, projectPath, timeoutMs }) {
  const previewFrames = evenSample(frames, 20);
  const previewDir = join(root, "contact-sheet-frames");
  await mkdir(previewDir, { recursive: true });
  for (const [index, frame] of previewFrames.entries()) await copyFile(frame.path, join(previewDir, `preview-${String(index + 1).padStart(4, "0")}.jpg`));
  const columns = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(previewFrames.length))));
  const rows = Math.ceil(previewFrames.length / columns);
  const path = join(root, "video_read_contact_sheet.jpg");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "1", "-start_number", "1", "-i", join(previewDir, "preview-%04d.jpg"), "-vf", `scale=320:-2,tile=${columns}x${rows}:padding=8:margin=8:color=0x151515`, "-frames:v", "1", "-q:v", "3", path], { cwd: projectPath, timeoutMs: timeoutMs ?? 120000, maxOutputBytes: 100_000, failureLabel: "Video read contact sheet" });
  return path;
}

async function loadTranscript(projectPath, transcriptPath, plan) {
  const path = containedPath(projectPath, transcriptPath, "Video transcript");
  const details = await stat(path);
  if (!details.isFile() || details.size <= 0 || details.size > 20_000_000) throw new Error("Video transcript must be a non-empty project file no larger than 20 MB.");
  const extension = extname(path).toLowerCase();
  let segments;
  if (extension === ".srt" || extension === ".vtt") {
    const source = (await readFile(path, "utf8")).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    segments = parseCaptionText(source, extension.slice(1)).map((cue) => ({ startSeconds: cue.range.start.value / cue.range.start.rate, endSeconds: (cue.range.start.value + cue.range.duration.value) / cue.range.start.rate, text: cue.text }));
  } else if (extension === ".json") {
    const document = JSON.parse(await readFile(path, "utf8"));
    const sourceSegments = document.segments ?? document.transcript?.segments ?? [];
    segments = sourceSegments.map((segment) => ({ startSeconds: Number(segment.startSeconds ?? segment.start ?? 0), endSeconds: Number(segment.endSeconds ?? segment.end ?? segment.startSeconds ?? segment.start ?? 0), text: String(segment.text ?? "").trim() })).filter((segment) => segment.text && Number.isFinite(segment.startSeconds) && Number.isFinite(segment.endSeconds));
  } else throw new Error("Video transcript must be SRT, VTT, or Director X transcript JSON.");
  const filtered = segments.filter((segment) => segment.endSeconds >= plan.startSeconds && segment.startSeconds <= plan.endSeconds).map((segment) => ({ ...segment, startSeconds: round(segment.startSeconds), endSeconds: round(segment.endSeconds) }));
  return { schemaVersion: "1.0", sourcePath: path, sourceFormat: extension.slice(1), range: { startSeconds: plan.startSeconds, endSeconds: plan.endSeconds }, segments: filtered };
}

function fullVideoBudget(duration) { if (duration <= 30) return Math.max(12, Math.round(duration)); if (duration <= 60) return 40; if (duration <= 180) return 60; if (duration <= 600) return 80; return 100; }
function focusedBudget(duration) { if (duration <= 5) return 10; if (duration <= 15) return 30; if (duration <= 30) return 60; if (duration <= 60) return 80; return 100; }
function evenSample(items, count) { if (count <= 0) return []; if (items.length <= count) return items; if (count === 1) return [items[0]]; return Array.from({ length: count }, (_, index) => items[Math.round(index * (items.length - 1) / (count - 1))]); }
function meanAbsoluteDifference(left, right) { let sum = 0; for (let index = 0; index < left.length; index += 1) sum += Math.abs(left[index] - right[index]); return sum / left.length; }
function estimatedTimestamp(plan, index, count) { return round(plan.startSeconds + (count <= 1 ? 0 : index * plan.durationSeconds / (count - 1))); }
function scaleFilter(resolution) { return `scale=w='min(${resolution},iw)':h=-2:force_original_aspect_ratio=decrease:force_divisible_by=2`; }
function exactOrEstimatedFrames(stream, format) { const exact = Number(stream.nb_read_frames ?? stream.nb_frames); if (Number.isInteger(exact) && exact > 0) return exact; const duration = Number(stream.duration ?? format.duration); const rate = rationalNumber(stream.avg_frame_rate ?? stream.r_frame_rate); return Number.isFinite(duration) && rate > 0 ? Math.ceil(duration * rate) : null; }
function rationalNumber(value) { const [numerator, denominator = 1] = String(value ?? "").split("/").map(Number); const result = numerator / denominator; return Number.isFinite(result) ? result : 0; }
function normalizeProfile(profile) { if (!VIDEO_READ_PROFILES.includes(profile)) throw new Error(`Unknown Director X video read profile: ${profile}`); return profile; }
function safeId(value) { const result = String(value ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""); if (!result) throw new Error("Video read ID is required."); return result.slice(0, 80); }
function finiteNonNegative(value, label) { const result = Number(value); if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be finite and non-negative.`); return result; }
function boundedInteger(value, minimum, maximum, label) { const result = Number(value); if (!Number.isInteger(result) || result < minimum || result > maximum) throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`); return result; }
function round(value) { return Math.round(value * 1000) / 1000; }
function containedPath(projectPath, path, label) { const absolute = resolve(projectPath, path); const relation = relative(projectPath, absolute); if (relation.startsWith("..") || isAbsolute(relation)) throw new Error(`${label} must stay inside the project workspace.`); return absolute; }
async function clearJpegs(path) { for (const name of await readdir(path)) if (/^candidate-\d{6}\.jpg$/.test(name)) await rm(join(path, name), { force: true }); }
async function sha256(path) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
async function atomicJson(path, value) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); try { await rename(temporary, path); } finally { await rm(temporary, { force: true }); } }

function runTextProcess(command, args, options) { return runProcess(command, args, options, false); }
function runBufferProcess(command, args, options) { return runProcess(command, args, options, true); }
function runProcess(command, args, options, binary) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stdoutBytes = 0;
    let stderr = "";
    child.stdout.on("data", (chunk) => { if (stdoutBytes < options.maxOutputBytes) { const remaining = options.maxOutputBytes - stdoutBytes; stdout.push(chunk.subarray(0, remaining)); stdoutBytes += Math.min(chunk.length, remaining); } });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-options.maxOutputBytes); });
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(new Error(`Unable to start ${command}: ${error.message}`)); });
    child.once("close", (code, signal) => { clearTimeout(timer); if (code !== 0) return reject(new Error(`${options.failureLabel} failed (${signal ?? code}): ${stderr.slice(-2000)}`)); const buffer = Buffer.concat(stdout); resolvePromise({ command, args, exitCode: code, stdout: binary ? buffer : buffer.toString("utf8"), stderr }); });
  });
}
