import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { resolveWorkspaceMediaFile } from "./workspace-media-access.mjs";

export const ARTIFACT_RESOURCE_URI_TEMPLATE = "directorx://artifact{?projectPath,runId,artifactRef}";
export const MAX_TEXT_RESOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_BINARY_RESOURCE_BYTES = 16 * 1024 * 1024;

const MIME_TYPES = Object.freeze({
  document: Object.freeze({
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".srt": "application/x-subrip; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".vtt": "text/vtt; charset=utf-8"
  }),
  image: Object.freeze({ ".gif": "image/gif", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }),
  audio: Object.freeze({ ".aac": "audio/aac", ".flac": "audio/flac", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav" }),
  video: Object.freeze({ ".mov": "video/quicktime", ".mp4": "video/mp4", ".webm": "video/webm" })
});

export class ArtifactResourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactResourceError";
  }
}

export function buildArtifactResourceUri({ projectPath, runId, artifactRef }) {
  const url = new URL("directorx://artifact");
  url.searchParams.set("projectPath", requiredValue(projectPath, "projectPath", 4096));
  url.searchParams.set("runId", requiredValue(runId, "runId", 220));
  url.searchParams.set("artifactRef", requiredValue(artifactRef, "artifactRef", 500));
  return url.toString();
}

export async function readArtifactResource({ uri, readRun }) {
  if (typeof readRun !== "function") throw new ArtifactResourceError("Director X artifact resource reader is unavailable.");
  const request = parseArtifactResourceUri(uri);
  let run;
  try { run = await readRun({ projectPath: request.projectPath, runId: request.runId }); }
  catch { throw new ArtifactResourceError("The requested Director X Run is unavailable."); }
  if (run?.runId !== request.runId) throw new ArtifactResourceError("Director X Run identity does not match the requested resource.");
  const artifact = run?.artifacts?.[request.artifactRef];
  if (!artifact) throw new ArtifactResourceError("The requested resource is not registered in this Director X Run.");
  if (artifact.runId && artifact.runId !== request.runId) throw new ArtifactResourceError("The requested artifact belongs to a different Director X Run.");
  const mediaKind = requiredMediaKind(artifact.mediaKind);
  const details = await resolveWorkspaceMediaFile(request.projectPath, artifact.path ?? artifact.relativePath);
  const mimeType = resourceMimeType(artifact, mediaKind, details.path);
  const maxBytes = mediaKind === "document" ? MAX_TEXT_RESOURCE_BYTES : MAX_BINARY_RESOURCE_BYTES;
  if (details.size > maxBytes) throw new ArtifactResourceError(`The requested ${mediaKind} resource exceeds the bounded MCP preview limit; use the Director X side Browser canvas for large media.`);
  if (Number.isFinite(artifact.sizeBytes) && artifact.sizeBytes !== details.size) throw new ArtifactResourceError("The requested resource no longer matches its registered byte size.");
  const registeredSha256 = normalizedSha256(artifact.sha256);
  if (!registeredSha256) throw new ArtifactResourceError("The requested resource has no valid registered SHA-256 identity.");
  const actualSha256 = await sha256File(details.path);
  if (actualSha256 !== registeredSha256) throw new ArtifactResourceError("The requested resource no longer matches its registered SHA-256 identity.");
  const metadata = { artifactRef: request.artifactRef, runId: request.runId, sha256: actualSha256, sizeBytes: details.size, mediaKind };
  if (mediaKind === "document") return { uri: request.uri, mimeType, text: await readFile(details.path, "utf8"), _meta: metadata };
  return { uri: request.uri, mimeType, blob: (await readFile(details.path)).toString("base64"), _meta: metadata };
}

function parseArtifactResourceUri(uri) {
  let url;
  try { url = new URL(requiredValue(uri, "uri", 8192)); }
  catch { throw new ArtifactResourceError("Director X artifact resource URI is invalid."); }
  if (url.protocol !== "directorx:" || url.hostname !== "artifact" || (url.pathname && url.pathname !== "/") || url.username || url.password || url.port || url.hash) throw new ArtifactResourceError("Unsupported Director X artifact resource URI.");
  const allowedParams = new Set(["projectPath", "runId", "artifactRef"]);
  if ([...url.searchParams.keys()].some((key) => !allowedParams.has(key)) || [...allowedParams].some((key) => url.searchParams.getAll(key).length !== 1)) throw new ArtifactResourceError("Director X artifact resource URI parameters are invalid.");
  return {
    uri: url.toString(),
    projectPath: requiredValue(url.searchParams.get("projectPath"), "projectPath", 4096),
    runId: requiredValue(url.searchParams.get("runId"), "runId", 220),
    artifactRef: requiredValue(url.searchParams.get("artifactRef"), "artifactRef", 500)
  };
}

function resourceMimeType(artifact, mediaKind, actualPath) {
  const declaredExtension = extname(artifact.relativePath ?? artifact.path ?? "").toLowerCase();
  const extension = extname(actualPath).toLowerCase();
  if (declaredExtension && declaredExtension !== extension) throw new ArtifactResourceError("The registered resource format does not match the resolved file.");
  const mimeType = MIME_TYPES[mediaKind]?.[extension];
  if (!mimeType) throw new ArtifactResourceError(`The registered ${mediaKind} format is not allowed through MCP Resources.`);
  return mimeType;
}

function requiredMediaKind(value) {
  if (!Object.hasOwn(MIME_TYPES, value)) throw new ArtifactResourceError("Only registered document, image, audio, and video artifacts can be read as MCP Resources.");
  return value;
}

function normalizedSha256(value) {
  const normalized = String(value ?? "").replace(/^sha256:/i, "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function requiredValue(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength || /[\0\r\n]/.test(text)) throw new ArtifactResourceError(`Director X artifact resource ${label} is invalid.`);
  return text;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
