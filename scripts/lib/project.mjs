import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const PROJECT_DIR = ".directorx";
export const CANVAS_FILE = "canvas.json";
export const OBJECT_TYPES = new Set(["image", "video", "audio", "text"]);

export function projectPaths(projectPath) {
  const root = resolve(projectPath);
  const stateRoot = join(root, PROJECT_DIR);
  return {
    root,
    stateRoot,
    canvasPath: join(stateRoot, CANVAS_FILE),
    mediaRoot: join(stateRoot, "media"),
    analysisRoot: join(stateRoot, "analysis"),
    renderRoot: join(stateRoot, "renders")
  };
}
export async function initProject(projectPath) {
  const paths = projectPaths(projectPath);
  await Promise.all([
    mkdir(paths.mediaRoot, { recursive: true }),
    mkdir(paths.analysisRoot, { recursive: true }),
    mkdir(paths.renderRoot, { recursive: true })
  ]);
  try {
    return await readCanvas(projectPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const canvas = {
    version: 1,
    title: "Director X Canvas",
    updatedAt: new Date().toISOString(),
    objects: []
  };
  await writeCanvas(projectPath, canvas);
  return canvas;
}

export async function readCanvas(projectPath) {
  const { canvasPath } = projectPaths(projectPath);
  return JSON.parse(await readFile(canvasPath, "utf8"));
}

export async function writeCanvas(projectPath, canvas) {
  const { canvasPath } = projectPaths(projectPath);
  const next = { ...canvas, updatedAt: new Date().toISOString() };
  await mkdir(dirname(canvasPath), { recursive: true });
  await writeFile(canvasPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function addCanvasObject(projectPath, input) {
  if (!OBJECT_TYPES.has(input.type)) {
    throw new Error(`Unsupported canvas object type: ${input.type}`);
  }
  const canvas = await initProject(projectPath);
  const index = canvas.objects.length;
  const object = {
    id: input.id || randomUUID(),
    type: input.type,
    title: input.title || defaultTitle(input),
    x: Number.isFinite(input.x) ? input.x : 80 + (index % 4) * 340,
    y: Number.isFinite(input.y) ? input.y : 80 + Math.floor(index / 4) * 280,
    width: Number.isFinite(input.width) ? input.width : input.type === "text" ? 360 : 320,
    height: Number.isFinite(input.height) ? input.height : input.type === "text" ? 240 : 220,
    createdAt: new Date().toISOString()
  };
  if (input.text !== undefined) object.text = String(input.text);
  if (input.path) object.path = normalizeProjectPath(projectPath, input.path);
  if (input.sourceUrl) object.sourceUrl = String(input.sourceUrl);
  if (input.metadata) object.metadata = input.metadata;
  canvas.objects.push(object);
  await writeCanvas(projectPath, canvas);
  return object;
}

export async function updateObjectPosition(projectPath, id, position) {
  const canvas = await readCanvas(projectPath);
  const object = canvas.objects.find((item) => item.id === id);
  if (!object) throw new Error(`Canvas object not found: ${id}`);
  if (Number.isFinite(position.x)) object.x = position.x;
  if (Number.isFinite(position.y)) object.y = position.y;
  if (Number.isFinite(position.width)) object.width = position.width;
  if (Number.isFinite(position.height)) object.height = position.height;
  await writeCanvas(projectPath, canvas);
  return object;
}

export function resolveProjectMediaPath(projectPath, storedPath) {
  const { root } = projectPaths(projectPath);
  const target = resolve(root, storedPath);
  const child = relative(root, target);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error("Media path must stay inside the project.");
  }
  return target;
}

export function inferObjectType(filePath) {
  const extension = extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"].includes(extension)) return "image";
  if ([".mp4", ".mov", ".m4v", ".webm"].includes(extension)) return "video";
  if ([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"].includes(extension)) return "audio";
  return "text";
}

function normalizeProjectPath(projectPath, filePath) {
  const { root } = projectPaths(projectPath);
  const absolute = resolve(filePath);
  const child = relative(root, absolute);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error(`Canvas media must be stored inside the project: ${filePath}`);
  }
  return child;
}

function defaultTitle(input) {
  if (input.path) return input.path.split("/").at(-1);
  return input.type === "text" ? "Production note" : "Untitled media";
}
