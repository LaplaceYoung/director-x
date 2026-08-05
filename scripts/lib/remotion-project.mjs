import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addCanvasObject, initProject, projectPaths, readCanvas, resolveProjectMediaPath } from "./project.mjs";

export async function composeRemotionProject(projectPath, options = {}) {
  await initProject(projectPath);
  const paths = remotionPaths(projectPath);
  await mkdir(paths.mediaRoot, { recursive: true });
  const canvas = await readCanvas(projectPath);
  const fps = positiveInteger(options.fps, 30);
  const width = evenInteger(options.width, 1920);
  const height = evenInteger(options.height, 1080);
  const itemFrames = Math.max(1, Math.round(positiveNumber(options.secondsPerItem, 3) * fps));
  const clips = [];
  let audio = null;
  let cursor = 0;

  for (const [index, object] of canvas.objects.entries()) {
    if (object.metadata?.renderer === "remotion") continue;
    if (object.type === "audio" && object.path && !audio) {
      audio = {
        src: await stageMedia(projectPath, object.path, paths.mediaRoot, index),
        volume: 1
      };
      continue;
    }
    if (!["image", "video", "text"].includes(object.type)) continue;
    const clip = {
      type: object.type,
      title: object.title,
      startFrame: cursor,
      durationInFrames: itemFrames
    };
    if (object.type === "text") clip.text = object.text || object.title;
    else clip.src = await stageMedia(projectPath, object.path, paths.mediaRoot, index);
    if (object.type === "video") clip.muted = Boolean(audio);
    clips.push(clip);
    cursor += itemFrames;
  }

  if (!clips.length) {
    clips.push({
      type: "text",
      title: options.title || "Director X Preview",
      text: options.title || "Director X Preview",
      startFrame: 0,
      durationInFrames: itemFrames
    });
    cursor = itemFrames;
  }

  const spec = {
    title: options.title || canvas.title || "Director X Preview",
    width,
    height,
    fps,
    durationInFrames: cursor,
    clips,
    audio
  };
  await writeFile(paths.specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  return { ...paths, spec };
}

export async function renderRemotionProject(projectPath, options = {}) {
  const paths = remotionPaths(projectPath);
  try {
    await access(paths.specPath);
  } catch {
    await composeRemotionProject(projectPath, options);
  }

  const quality = options.quality === "final" ? "final" : "preview";
  const outputPath = options.output
    ? resolve(options.output)
    : join(projectPaths(projectPath).renderRoot, `${quality}.mp4`);
  assertInsideProject(projectPath, outputPath);
  await mkdir(dirname(outputPath), { recursive: true });

  const pluginRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const cliPath = join(pluginRoot, "node_modules", ".bin", "remotion");
  await access(cliPath);
  const args = [
    "render",
    join(pluginRoot, "remotion", "index.jsx"),
    "DirectorXComposition",
    outputPath,
    `--props=${paths.specPath}`,
    `--public-dir=${paths.publicRoot}`,
    "--codec=h264",
    "--overwrite",
    `--crf=${quality === "preview" ? 28 : 18}`
  ];
  if (quality === "preview") args.push("--scale=0.5");
  await run(cliPath, args, { cwd: pluginRoot });

  const spec = JSON.parse(await readFile(paths.specPath, "utf8"));
  await addCanvasObject(projectPath, {
    type: "video",
    title: `${spec.title} — ${quality}`,
    path: outputPath,
    metadata: { renderer: "remotion", quality }
  });
  return { outputPath, quality, specPath: paths.specPath };
}

export function remotionPaths(projectPath) {
  const root = join(projectPaths(projectPath).stateRoot, "remotion");
  const publicRoot = join(root, "public");
  return {
    root,
    publicRoot,
    mediaRoot: join(publicRoot, "media"),
    specPath: join(root, "spec.json")
  };
}

async function stageMedia(projectPath, storedPath, mediaRoot, index) {
  if (!storedPath) throw new Error("Canvas media object is missing its project path.");
  const source = resolveProjectMediaPath(projectPath, storedPath);
  const fileName = `${String(index).padStart(3, "0")}-${safeFileName(basename(source))}`;
  const target = join(mediaRoot, fileName);
  await copyFile(source, target);
  return `media/${fileName}`;
}

function assertInsideProject(projectPath, filePath) {
  const root = projectPaths(projectPath).root;
  const child = relative(root, filePath);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error("Rendered video must stay inside the project.");
  }
}

function safeFileName(value) {
  const extension = extname(value);
  const stem = basename(value, extension)
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]+/g, "-")
    .replace(/^-|-$/g, "") || "asset";
  return `${stem}${extension.toLowerCase()}`;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function evenInteger(value, fallback) {
  const number = positiveInteger(value, fallback);
  return number % 2 === 0 ? number : number + 1;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function run(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`Remotion exited with ${code}`));
    });
  });
}
