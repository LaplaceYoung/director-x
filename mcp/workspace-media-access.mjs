import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export async function resolveWorkspaceMediaFile(projectPath, candidatePath) {
  const lexicalRoot = resolve(projectPath);
  const requestedPath = resolve(lexicalRoot, String(candidatePath ?? ""));
  assertInsideWorkspace(lexicalRoot, requestedPath);
  const projectRoot = await resolveExistingPath(lexicalRoot, 404, "Director X project workspace is unavailable.");
  const mediaPath = await resolveExistingPath(requestedPath, 404, "Director X media file is unavailable.");
  assertInsideWorkspace(projectRoot, mediaPath);
  const details = await stat(mediaPath);
  if (!details.isFile()) throw new WorkspaceMediaAccessError(404, "Director X media path is not a file.");
  return Object.freeze({ path: mediaPath, size: details.size });
}

export class WorkspaceMediaAccessError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "WorkspaceMediaAccessError";
    this.statusCode = statusCode;
  }
}

function assertInsideWorkspace(projectRoot, mediaPath) {
  const relation = relative(projectRoot, mediaPath);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new WorkspaceMediaAccessError(403, "Director X media must stay inside the project workspace.");
}

async function resolveExistingPath(path, statusCode, message) {
  try {
    return await realpath(resolve(path));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") throw new WorkspaceMediaAccessError(statusCode, message);
    throw error;
  }
}
