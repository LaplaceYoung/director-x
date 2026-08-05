import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { addCanvasObject, initProject, projectPaths } from "./lib/project.mjs";
import { resolveMediaTool } from "./lib/media-tools.mjs";

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
  await mkdir(framesRoot, { recursive: true });

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

  const audioPath = join(outputRoot, "audio.wav");
  await run(tools.ffmpeg, ["-y", "-i", sourcePath, "-vn", "-ac", "2", "-ar", "48000", audioPath]);

  await run(tools.ffmpeg, [
    "-y", "-i", sourcePath,
    "-vf", "scale='min(960,iw)':-2",
    "-q:v", "4",
    join(framesRoot, "frame-%06d.jpg")
  ]);

  const keyframesPath = join(outputRoot, "shot-keyframes.jpg");
  await run(tools.ffmpeg, [
    "-y", "-i", sourcePath,
    "-vf", "select='gt(scene,0.28)',scale=320:-2,tile=4x4",
    "-frames:v", "1",
    keyframesPath
  ], { allowFailure: true });

  const contactSheetPath = join(outputRoot, "contact-sheet.jpg");
  await run(tools.ffmpeg, [
    "-y", "-i", sourcePath,
    "-vf", "fps=1/2,scale=320:-2,tile=4x4",
    "-frames:v", "1",
    contactSheetPath
  ], { allowFailure: true });

  const palettePath = join(outputRoot, "color-palette.png");
  await run(tools.ffmpeg, [
    "-y", "-i", sourcePath,
    "-vf", "fps=1,scale=320:-2,palettegen=max_colors=12:stats_mode=diff",
    palettePath
  ], { allowFailure: true });

  const relativeOutput = outputRoot.slice(paths.root.length + 1);
  const summaryPath = join(outputRoot, "analysis-guide.md");
  const summary = [
    `# ${title}`,
    "",
    "Director X extracted the reference into reviewable media.",
    "",
    `- Source: ${sourcePath.slice(paths.root.length + 1)}`,
    `- Metadata: ${relativeOutput}/metadata.json`,
    `- Audio: ${relativeOutput}/audio.wav`,
    `- Full frames: ${relativeOutput}/frames/`,
    `- Contact sheet: ${relativeOutput}/contact-sheet.jpg`,
    `- Shot keyframes: ${relativeOutput}/shot-keyframes.jpg`,
    `- Color palette: ${relativeOutput}/color-palette.png`,
    "",
    "Codex should inspect the contact sheet first, then read denser frame ranges for each detected shot. Analyze shot timing, composition, camera motion, subject motion, typography, lighting, color, transitions, sound, and transferable creative principles. Put only useful media and production text on the canvas."
  ].join("\n");
  await writeFile(summaryPath, `${summary}\n`, "utf8");

  await addCanvasObject(projectPath, { type: "video", title, path: sourcePath, sourceUrl: isUrl(input) ? input : undefined });
  await addCanvasObject(projectPath, { type: "audio", title: `${title} — separated audio`, path: audioPath });
  for (const [filePath, objectTitle] of [
    [contactSheetPath, `${title} — contact sheet`],
    [keyframesPath, `${title} — shot keyframes`],
    [palettePath, `${title} — color palette`]
  ]) {
    if (await exists(filePath)) await addCanvasObject(projectPath, { type: "image", title: objectTitle, path: filePath });
  }
  await addCanvasObject(projectPath, { type: "text", title: `${title} — analysis guide`, text: summary });
  return { outputRoot, sourcePath, metadataPath, audioPath, framesRoot, summaryPath };
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

function isUrl(value) {
  return /^https?:\/\//i.test(String(value));
}

function safeName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "reference";
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
