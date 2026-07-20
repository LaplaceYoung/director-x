import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { collectFrameIdentityEvidence } from "./frame-identity-evidence.mjs";
import { runProcess } from "./media-execution.mjs";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov"]);
const DEFAULT_MAX_FRAMES = 1800;

export async function ingestReferenceVideo(input, options = {}) {
  const url = new URL(input.url);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Reference URL must use HTTP or HTTPS.");
  if (url.username || url.password || [...url.searchParams.keys()].some((key) => /(token|key|secret|signature|credential|auth)/i.test(key))) throw new Error("Credential-bearing reference URLs are not accepted; upload the source file instead.");
  if (!input.downloadAuthorized) throw new Error("Video download requires explicit user confirmation that local analytical download is authorized.");
  const fullReference = input.fullReference === true;
  const requestedMaxSeconds = Number(input.maxSeconds ?? 20);
  const startSeconds = Math.max(0, Number(input.startSeconds ?? 0));
  const maxFrames = Math.min(3600, Math.max(90, Number(input.maxFrames ?? DEFAULT_MAX_FRAMES)));
  if (!Number.isFinite(requestedMaxSeconds) || !Number.isFinite(startSeconds) || !Number.isInteger(maxFrames)) throw new Error("Reference time and frame bounds must be finite.");
  if (fullReference && startSeconds !== 0) throw new Error("Full reference analysis must start at 0 seconds.");
  if (!fullReference && requestedMaxSeconds > 30) throw new Error("Reference sections are capped at 30 seconds; set fullReference=true for complete-video analysis.");
  const maxSeconds = fullReference ? null : Math.min(30, Math.max(3, requestedMaxSeconds));
  const referenceId = safeId(input.referenceId);
  const projectRoot = resolve(input.projectPath);
  const root = resolve(projectRoot, ".directorx", "plugin-runs", input.runId, "references", referenceId);
  const framesDir = join(root, "frames", "full");
  const analysisSection = { startSeconds, maxSeconds, maxFrames, fullReference };
  const cached = await readCachedReferenceReceipt({ root, sourceUrl: input.url, referenceId, analysisSection });
  if (cached) return cached;
  await rm(root, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const outputTemplate = join(root, "source.%(ext)s");
  const run = options.runFn ?? runProcess;
  const commands = [];
  const execute = async (command, args, failureLabel) => {
    const result = await run(command, args, { cwd: projectRoot, timeoutMs: input.timeoutMs ?? 300000, maxOutputBytes: 500_000, failureLabel });
    commands.push({ executable: command, args: command === "yt-dlp" ? redactUrl(args) : args, exitCode: result?.exitCode ?? 0 });
    return result;
  };

  const ytdlpArgs = [
    "--no-playlist", "--max-filesize", "250M",
    "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format", "mp4", "--write-info-json", "--write-thumbnail",
    ...(fullReference ? [] : ["--download-sections", `*${startSeconds}-${startSeconds + maxSeconds}`, "--force-keyframes-at-cuts"]),
    "-o", outputTemplate, input.url
  ];
  await execute("yt-dlp", ytdlpArgs, "Reference video download");
  const downloadedFiles = await readdir(root);
  const videoName = downloadedFiles.find((file) => VIDEO_EXTENSIONS.has(extension(file)));
  if (!videoName) throw new Error("yt-dlp completed without a playable reference clip.");
  const downloadedPath = join(root, videoName);
  const videoPath = join(root, "analysis.mp4");
  const trimArgs = ["-hide_banner", "-loglevel", "error", ...(fullReference ? [] : ["-t", String(maxSeconds)]), "-i", downloadedPath, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", "-y", videoPath];
  await execute("ffmpeg", trimArgs, "Reference analysis clip");
  if (downloadedPath !== videoPath) await unlink(downloadedPath);

  const probeArgs = [
    "-v", "error", "-count_frames",
    "-show_entries", "format=duration,format_name:stream=index,codec_type,width,height,avg_frame_rate,r_frame_rate,time_base,nb_read_frames,duration,sample_rate,channels",
    "-of", "json", videoPath
  ];
  const probeResult = await execute("ffprobe", probeArgs, "Reference media probe");
  const probe = parseJson(probeResult.stdout, "Reference media probe");
  const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
  if (!videoStream) throw new Error("Reference analysis clip has no decodable video stream.");
  const estimatedFrames = frameCountEstimate(videoStream, probe.format);
  if (estimatedFrames != null && estimatedFrames > maxFrames) throw new Error(`Reference section contains about ${estimatedFrames} frames, above the ${maxFrames}-frame analysis bound. Select a shorter section.`);

  const framePattern = join(framesDir, "frame-%06d.jpg");
  const frameArgs = ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-map", "0:v:0", "-fps_mode", "passthrough", "-q:v", "2", "-y", framePattern];
  await execute("ffmpeg", frameArgs, "Reference full-frame extraction");
  const frameNames = (await readdir(framesDir)).filter((file) => /^frame-\d{6}\.jpg$/.test(file)).sort();
  if (!frameNames.length) throw new Error("Reference full-frame extraction produced no frames.");
  if (frameNames.length > maxFrames) throw new Error(`Reference full-frame extraction exceeded the ${maxFrames}-frame analysis bound.`);

  const clipSha256 = await sha256(videoPath);
  const collectIdentity = options.collectFrameIdentityFn ?? collectFrameIdentityEvidence;
  const frameIdentity = await collectIdentity({
    projectPath: projectRoot,
    runId: input.runId,
    videoPath,
    sourceMediaSha256: clipSha256,
    stream: videoStream,
    artifactRef: `reference_frame_identity.${referenceId}.jsonl`,
    timeoutMs: input.timeoutMs ?? 300000
  }, options.identityOptions ?? {});
  const fullFrameCoverage = {
    mode: "all_decoded_frames",
    extractedFrameCount: frameNames.length,
    identityFrameCount: frameIdentity.frameCount,
    probeReachedEof: frameIdentity.probeReachedEof,
    countParity: frameNames.length === frameIdentity.frameCount,
    passed: frameNames.length === frameIdentity.frameCount && frameIdentity.probeReachedEof === true
  };
  if (!fullFrameCoverage.passed) throw new Error("Reference full-frame extraction does not match the independently probed decoded-frame count.");

  const frameManifestPath = join(root, "reference_full_frame_manifest.jsonl");
  const frameManifest = await open(frameManifestPath, "w", 0o600);
  try {
    for (const [frameIndex, file] of frameNames.entries()) {
      const path = join(framesDir, file);
      const identity = frameIndex === 0 ? frameIdentity.firstFrame : frameIndex === frameNames.length - 1 ? frameIdentity.lastFrame : null;
      await frameManifest.write(`${JSON.stringify({
        frameIndex,
        relativePath: relative(projectRoot, path),
        sha256: await sha256(path),
        ptsTimeSeconds: identity?.ptsTimeSeconds ?? null,
        bestEffortTimestampTicks: identity?.bestEffortTimestampTicks ?? null
      })}\n`);
    }
    await frameManifest.sync();
  } finally {
    await frameManifest.close();
  }

  const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
  let audioPath = null;
  if (audioStream) {
    audioPath = join(root, "reference_audio.wav");
    const audioArgs = ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-y", audioPath];
    await execute("ffmpeg", audioArgs, "Reference audio extraction");
  }

  const contactSheetPath = join(root, "reference_contact_sheet.jpg");
  const contactSheetArgs = ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-vf", "fps=1/2,scale=320:-2,tile=5x3", "-frames:v", "1", "-q:v", "2", "-y", contactSheetPath];
  await execute("ffmpeg", contactSheetArgs, "Reference contact sheet");
  const infoName = downloadedFiles.find((file) => file.endsWith(".info.json"));
  const info = infoName ? parseJson(await readFile(join(root, infoName), "utf8"), "yt-dlp info JSON") : {};
  const receipt = {
    schemaVersion: "2.0",
    referenceId,
    sourceUrl: input.url,
    title: info.title ?? null,
    uploader: info.uploader ?? null,
    sourceDurationSeconds: info.duration ?? null,
    analysisSection,
    rightsStatus: input.rightsStatus,
    allowedUse: "local reference analysis only; no copied pixels, audio, music, subtitles, logos, or clips in delivery unless the user separately proves reuse rights",
    clipPath: videoPath,
    clipSha256,
    mediaProbe: probe,
    fullFrameCoverage,
    fullFrameDirectory: framesDir,
    fullFrameManifestPath: frameManifestPath,
    frameIdentityArtifactRef: frameIdentity.artifactRef,
    frameIdentityPath: frameIdentity.path,
    audioPath,
    contactSheetPath,
    commands,
    createdAt: new Date().toISOString()
  };
  const receiptPath = join(root, "reference_ingest_receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return {
    receiptPath,
    cached: false,
    referenceId,
    analysisSection,
    framePaths: frameNames.map((file) => join(framesDir, file)),
    frameManifestPath,
    frameIdentityArtifactRef: frameIdentity.artifactRef,
    frameIdentityPath: frameIdentity.path,
    fullFrameCoverage,
    clipPath: videoPath,
    audioPath,
    contactSheetPath,
    rightsStatus: input.rightsStatus
  };
}

async function readCachedReferenceReceipt({ root, sourceUrl, referenceId, analysisSection }) {
  const receiptPath = join(root, "reference_ingest_receipt.json");
  try {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    if (receipt.referenceId !== referenceId || receipt.sourceUrl !== sourceUrl) return null;
    if (JSON.stringify(receipt.analysisSection) !== JSON.stringify(analysisSection)) return null;
    if (receipt.fullFrameCoverage?.passed !== true) return null;
    const framesDir = receipt.fullFrameDirectory;
    const frameManifestPath = receipt.fullFrameManifestPath;
    const frameIdentityPath = receipt.frameIdentityPath;
    await Promise.all([
      stat(receipt.clipPath),
      stat(framesDir),
      stat(frameManifestPath),
      stat(frameIdentityPath),
      receipt.audioPath ? stat(receipt.audioPath) : Promise.resolve(),
      receipt.contactSheetPath ? stat(receipt.contactSheetPath) : Promise.resolve()
    ]);
    const frameNames = (await readdir(framesDir)).filter((file) => /^frame-\d{6}\.jpg$/.test(file)).sort();
    if (frameNames.length !== receipt.fullFrameCoverage.extractedFrameCount) return null;
    return {
      cached: true,
      receiptPath,
      referenceId,
      analysisSection: receipt.analysisSection,
      framePaths: frameNames.map((file) => join(framesDir, file)),
      frameManifestPath,
      frameIdentityArtifactRef: receipt.frameIdentityArtifactRef,
      frameIdentityPath,
      fullFrameCoverage: receipt.fullFrameCoverage,
      clipPath: receipt.clipPath,
      audioPath: receipt.audioPath ?? null,
      contactSheetPath: receipt.contactSheetPath ?? null,
      rightsStatus: receipt.rightsStatus
    };
  } catch {
    return null;
  }
}

export function assertReferenceDownloadAuthorized({ consent, referenceId, url }) {
  if (!consent || consent.decision !== "authorized") throw new Error("Reference download requires a recorded user authorization decision.");
  if (consent.confirmationMethod !== "request_user_input") throw new Error("Reference download authorization must come from request_user_input.");
  if (!consent.sourceUrls?.includes(url)) throw new Error("Reference download authorization does not cover this source URL.");
  if (!consent.referenceIds?.includes(referenceId)) throw new Error("Reference download authorization does not cover this reference ID.");
  if (consent.purpose !== "local_reference_analysis") throw new Error("Reference download authorization must be limited to local reference analysis.");
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function parseJson(value, label) {
  try { return JSON.parse(value); }
  catch { throw new Error(`${label} returned invalid JSON.`); }
}
function frameCountEstimate(stream, format) {
  const exact = Number(stream.nb_read_frames);
  if (Number.isInteger(exact) && exact > 0) return exact;
  const duration = Number(stream.duration ?? format?.duration);
  const fps = rationalNumber(stream.avg_frame_rate ?? stream.r_frame_rate);
  return Number.isFinite(duration) && fps > 0 ? Math.ceil(duration * fps) : null;
}
function rationalNumber(value) {
  const [numerator, denominator] = String(value ?? "").split("/").map(Number);
  return denominator > 0 && Number.isFinite(numerator) ? numerator / denominator : 0;
}
function safeId(value) { const id = String(value ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""); if (!id) throw new Error("referenceId is required."); return id.slice(0, 80); }
function extension(file) { return file.slice(file.lastIndexOf(".")).toLowerCase(); }
function redactUrl(args) { return args.map((arg) => /^https?:\/\//.test(arg) ? "<source-url>" : arg); }
