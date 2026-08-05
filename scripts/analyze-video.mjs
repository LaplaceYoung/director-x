import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { addCanvasObject, initProject, projectPaths } from "./lib/project.mjs";
import { resolveMediaTool } from "./lib/media-tools.mjs";
import {
  buildShotRanges,
  colorSystemSvg,
  extractDominantColors,
  parseSceneCutTimes,
  shotListMarkdown
} from "./lib/video-analysis.mjs";

export async function analyzeVideo({ projectPath, input, title = "Reference video" }) {
  const paths = projectPaths(projectPath);
  await initProject(projectPath);
  const tools = {
    ffmpeg: await resolveMediaTool("ffmpeg"),
    ffprobe: await resolveMediaTool("ffprobe"),
    ytdlp: await resolveMediaTool("yt-dlp", { optional: !isUrl(input) })
  };
  const slug = `${Date.now()}-${safeName(title)}`;
  const outputRoot = join(paths.analysisRoot, slug);
  const framesRoot = join(outputRoot, "frames");
  const shotFramesRoot = join(outputRoot, "shot-frames");
  await Promise.all([
    mkdir(framesRoot, { recursive: true }),
    mkdir(shotFramesRoot, { recursive: true })
  ]);

  const sourcePath = isUrl(input)
    ? await downloadReference(tools.ytdlp, input, outputRoot)
    : await copyReference(projectPath, input, outputRoot);

  const metadataPath = join(outputRoot, "metadata.json");
  const metadata = JSON.parse(await capture(tools.ffprobe, [
    "-v", "error",
    "-show_format",
    "-show_streams",
    "-of", "json",
    sourcePath
  ]));
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  const durationSeconds = readDuration(metadata);

  const audioPath = join(outputRoot, "audio.wav");
  await run(
    tools.ffmpeg,
    ["-y", "-i", sourcePath, "-vn", "-ac", "2", "-ar", "48000", audioPath],
    { allowFailure: true }
  );

  const frameMode = durationSeconds <= 300 ? "all-frames" : "2fps-proxy";
  const frameFilter = durationSeconds <= 300
    ? "scale='min(960,iw)':-2"
    : "fps=2,scale='min(960,iw)':-2";
  await run(tools.ffmpeg, [
    "-y", "-i", sourcePath,
    "-vf", frameFilter,
    "-q:v", "4",
    join(framesRoot, "frame-%06d.jpg")
  ]);

  const sceneResult = await run(tools.ffmpeg, [
    "-hide_banner", "-i", sourcePath,
    "-vf", "select='gt(scene,0.28)',showinfo",
    "-an", "-f", "null", "-"
  ], { allowFailure: true });
  const cutTimes = parseSceneCutTimes(sceneResult.stderr);
  const shots = buildShotRanges(durationSeconds, cutTimes);
  const shotFrameLimit = Math.min(shots.length, 160);
  for (const shot of shots.slice(0, shotFrameLimit)) {
    const framePath = join(shotFramesRoot, `${shot.id}.jpg`);
    await run(tools.ffmpeg, [
      "-y",
      "-ss", String(shot.representativeSeconds),
      "-i", sourcePath,
      "-frames:v", "1",
      "-vf", "scale='min(960,iw)':-2",
      "-q:v", "3",
      framePath
    ]);
    shot.evidenceFrame = relative(paths.root, framePath);
  }

  const shotBoardPaths = [];
  for (let page = 0; page < Math.ceil(shotFrameLimit / 20); page += 1) {
    const startNumber = page * 20 + 1;
    const itemCount = Math.min(20, shotFrameLimit - page * 20);
    const columns = Math.min(4, itemCount);
    const rows = Math.ceil(itemCount / columns);
    const boardPath = join(outputRoot, `shot-board-${String(page + 1).padStart(3, "0")}.jpg`);
    await run(tools.ffmpeg, [
      "-y",
      "-framerate", "1",
      "-start_number", String(startNumber),
      "-t", String(itemCount),
      "-i", join(shotFramesRoot, "shot-%03d.jpg"),
      "-vf", `scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:black,tile=${columns}x${rows}:padding=4:margin=4`,
      "-frames:v", "1",
      "-q:v", "3",
      boardPath
    ], { allowFailure: true });
    if (await exists(boardPath)) shotBoardPaths.push(boardPath);
  }

  const contactSheetPath = join(outputRoot, "contact-sheet.jpg");
  const sampleRate = 16 / durationSeconds;
  await run(tools.ffmpeg, [
    "-y", "-i", sourcePath,
    "-vf", `fps=${sampleRate},scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:black,tile=4x4:padding=4:margin=4`,
    "-frames:v", "1",
    contactSheetPath
  ], { allowFailure: true });

  const colorSampleRate = Math.min(1, 120 / durationSeconds);
  const colorPixels = await captureBuffer(tools.ffmpeg, [
    "-v", "error",
    "-i", sourcePath,
    "-vf", `fps=${colorSampleRate},scale=160:90:force_original_aspect_ratio=increase,crop=160:90`,
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "pipe:1"
  ]);
  const colors = extractDominantColors(colorPixels, 12);
  const colorSystemPath = join(outputRoot, "color-system.json");
  const colorCardPath = join(outputRoot, "color-system.svg");
  await writeFile(colorSystemPath, `${JSON.stringify({
    title,
    method: "FFmpeg temporal sampling with 4-bit RGB histogram clustering",
    sampleRate: colorSampleRate,
    colors
  }, null, 2)}\n`, "utf8");
  await writeFile(colorCardPath, colorSystemSvg(`${title} — color system`, colors), "utf8");

  const shotsPath = join(outputRoot, "shots.json");
  await writeFile(shotsPath, `${JSON.stringify({
    title,
    durationSeconds,
    sceneThreshold: 0.28,
    detectedCutTimes: cutTimes,
    generatedEvidenceFrames: shotFrameLimit,
    shots
  }, null, 2)}\n`, "utf8");
  const shotListPath = join(outputRoot, "shot-list.md");
  const shotList = shotListMarkdown(title, shots, relative(outputRoot, shotFramesRoot));
  await writeFile(shotListPath, shotList, "utf8");

  const relativeOutput = relative(paths.root, outputRoot);
  const summaryPath = join(outputRoot, "analysis-guide.md");
  const summary = [
    `# ${title}`,
    "",
    "Director X extracted the reference into reviewable media.",
    "",
    `- Source: ${sourcePath.slice(paths.root.length + 1)}`,
    `- Metadata: ${relativeOutput}/metadata.json`,
    `- Audio: ${await exists(audioPath) ? `${relativeOutput}/audio.wav` : "No audio stream detected"}`,
    `- Frame evidence: ${relativeOutput}/frames/ (${frameMode})`,
    `- Contact sheet: ${relativeOutput}/contact-sheet.jpg`,
    `- Shot boundaries: ${relativeOutput}/shots.json`,
    `- Shot worksheet: ${relativeOutput}/shot-list.md`,
    `- Shot evidence frames: ${relativeOutput}/shot-frames/ (${shotFrameLimit}/${shots.length})`,
    `- Shot boards: ${shotBoardPaths.length}`,
    `- Color system: ${relativeOutput}/color-system.json`,
    `- Color card: ${relativeOutput}/color-system.svg`,
    "",
    "Review order:",
    "1. Inspect the contact sheet and every shot-board page.",
    "2. Verify scene boundaries against the source video and audio.",
    "3. Inspect denser frame ranges for motion, transitions, typography, and continuity.",
    "4. Complete the shot worksheet with narrative purpose, composition, camera motion, subject motion, lighting, color, edit rhythm, and audio.",
    "5. Separate transferable technique from protected expression, then write an original remake plan."
  ].join("\n");
  await writeFile(summaryPath, `${summary}\n`, "utf8");

  const sourceObject = await addCanvasObject(projectPath, {
    type: "video",
    title,
    path: sourcePath,
    sourceUrl: isUrl(input) ? input : undefined,
    metadata: { kind: "reference-source" }
  });
  if (await exists(audioPath)) {
    await addCanvasObject(projectPath, {
      type: "audio",
      title: `${title} — separated audio`,
      path: audioPath,
      dependsOn: sourceObject.id,
      metadata: { kind: "reference-audio" }
    });
  }
  for (const [filePath, objectTitle] of [
    [contactSheetPath, `${title} — contact sheet`],
    ...shotBoardPaths.map((filePath, index) => [filePath, `${title} — shot board ${index + 1}`]),
    [colorCardPath, `${title} — color system`]
  ]) {
    if (!(await exists(filePath))) continue;
    const colorCard = filePath === colorCardPath;
    await addCanvasObject(projectPath, {
      type: "image",
      title: objectTitle,
      path: filePath,
      dependsOn: sourceObject.id,
      width: colorCard ? 520 : undefined,
      height: colorCard ? 300 : undefined,
      metadata: {
        kind: colorCard ? "color-card" : filePath === contactSheetPath ? "contact-sheet" : "shot-board",
        creativeDecisionEvidence: colorCard
      }
    });
  }
  await addCanvasObject(projectPath, {
    type: "text",
    title: `${title} — shot worksheet`,
    text: shotList,
    dependsOn: sourceObject.id
  });
  await addCanvasObject(projectPath, {
    type: "text",
    title: `${title} — analysis guide`,
    text: summary,
    dependsOn: sourceObject.id
  });
  return {
    outputRoot,
    sourcePath,
    metadataPath,
    audioPath: await exists(audioPath) ? audioPath : null,
    framesRoot,
    frameMode,
    shotsPath,
    shotListPath,
    shotFramesRoot,
    shotBoardPaths,
    colorSystemPath,
    colorCardPath,
    summaryPath
  };
}

async function downloadReference(ytdlp, url, outputRoot) {
  const template = join(outputRoot, "reference.%(ext)s");
  const output = await capture(ytdlp, [
    "--no-playlist",
    "--write-info-json",
    "--print", "after_move:filepath",
    "-o", template,
    url
  ]);
  return output.trim().split("\n").filter(Boolean).at(-1);
}

async function copyReference(projectPath, input, outputRoot) {
  const source = resolve(input);
  await access(source);
  const target = join(outputRoot, `reference${extname(source) || ".mp4"}`);
  await copyFile(source, target);
  return target;
}

function run(command, args, { allowFailure = false } = {}) {
  if (!command) throw new Error("Required command is unavailable.");
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0 || allowFailure) resolveRun({ code, stderr });
      else rejectRun(new Error(`${basename(command)} exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function capture(command, args) {
  return new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectCapture);
    child.once("exit", (code) => {
      if (code === 0) resolveCapture(stdout);
      else rejectCapture(new Error(`${basename(command)} exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function captureBuffer(command, args) {
  return new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout.push(chunk); });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectCapture);
    child.once("exit", (code) => {
      if (code === 0) resolveCapture(Buffer.concat(stdout));
      else rejectCapture(new Error(`${basename(command)} exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value));
}

function safeName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "reference";
}

function readDuration(metadata) {
  const candidates = [
    metadata?.format?.duration,
    ...(metadata?.streams || []).map((stream) => stream.duration)
  ];
  for (const candidate of candidates) {
    const duration = Number(candidate);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  throw new Error("FFprobe did not report a usable video duration.");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
