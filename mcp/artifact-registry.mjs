import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export async function inspectArtifact({ projectPath, runId, artifactRef, path, stage, mediaKind = "document", metadata = {} }) {
  const projectRoot = resolve(projectPath);
  const absolutePath = resolve(projectRoot, path);
  const relation = relative(projectRoot, absolutePath);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Artifact path must stay inside the project workspace.");
  const details = await stat(absolutePath);
  if (!details.isFile()) throw new Error("Artifact path must point to a file.");
  return {
    artifactRef, path: absolutePath, relativePath: relation, stage, mediaKind, runId,
    sizeBytes: details.size, sha256: await sha256File(absolutePath),
    metadata: structuredClone(metadata), registeredAt: new Date().toISOString()
  };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function artifactRecord({ artifactRef, path, stage, mediaKind = "document", metadata = {} }) {
  return { artifactRef, path, stage, mediaKind, metadata, registeredAt: new Date().toISOString() };
}
