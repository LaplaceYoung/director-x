import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARTIFACT_RESOURCE_URI_TEMPLATE,
  buildArtifactResourceUri,
  MAX_BINARY_RESOURCE_BYTES,
  readArtifactResource
} from "./artifact-resources.mjs";

test("reads a SHA-bound registered text artifact through the Director X resource URI", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-resource-text-"));
  try {
    const path = join(projectPath, "script.md");
    const content = "# Product film\n\nOpen with the real interface.\n";
    await writeFile(path, content);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const runId = "dx-resource-text";
    const artifactRef = "script.md";
    const run = { runId, artifacts: { [artifactRef]: { artifactRef, runId, path, relativePath: "script.md", mediaKind: "document", sizeBytes: Buffer.byteLength(content), sha256 } } };
    const uri = buildArtifactResourceUri({ projectPath, runId, artifactRef });

    assert.equal(ARTIFACT_RESOURCE_URI_TEMPLATE, "directorx://artifact{?projectPath,runId,artifactRef}");
    assert.equal(new URL(uri).searchParams.get("artifactRef"), artifactRef);
    assert.deepEqual(await readArtifactResource({ uri, readRun: async () => run }), {
      uri,
      mimeType: "text/markdown; charset=utf-8",
      text: content,
      _meta: { artifactRef, runId, sha256, sizeBytes: Buffer.byteLength(content), mediaKind: "document" }
    });
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("returns bounded registered media as a base64 MCP blob", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-resource-image-"));
  try {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const path = join(projectPath, "frame.png");
    await writeFile(path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const runId = "dx-resource-image", artifactRef = "frame.png";
    const run = { runId, artifacts: { [artifactRef]: { artifactRef, runId, path, relativePath: "frame.png", mediaKind: "image", sha256 } } };
    const uri = buildArtifactResourceUri({ projectPath, runId, artifactRef });

    const resource = await readArtifactResource({ uri, readRun: async () => run });
    assert.equal(resource.mimeType, "image/png");
    assert.equal(resource.blob, bytes.toString("base64"));
    assert.equal(resource.text, undefined);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("rejects cross-Run artifact reads and tampered registered files", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-resource-boundary-"));
  try {
    const path = join(projectPath, "script.md");
    await writeFile(path, "approved version");
    const artifactRef = "script.md", runA = "dx-run-a", runB = "dx-run-b";
    const sha256 = createHash("sha256").update("approved version").digest("hex");
    const runs = {
      [runA]: { runId: runA, artifacts: { [artifactRef]: { artifactRef, runId: runA, path, relativePath: artifactRef, mediaKind: "document", sha256 } } },
      [runB]: { runId: runB, artifacts: {} }
    };
    const readRun = async ({ runId }) => runs[runId];

    await assert.rejects(readArtifactResource({ uri: buildArtifactResourceUri({ projectPath, runId: runB, artifactRef }), readRun }), /not registered in this Director X Run/);
    await writeFile(path, "tampered version");
    await assert.rejects(readArtifactResource({ uri: buildArtifactResourceUri({ projectPath, runId: runA, artifactRef }), readRun }), /no longer matches its registered SHA-256/);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("rejects workspace escape, unsupported active formats, and oversized media", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-resource-limits-"));
  const outsidePath = join(tmpdir(), `directorx-resource-outside-${Date.now()}.md`);
  try {
    await writeFile(outsidePath, "outside");
    const svgPath = join(projectPath, "unsafe.svg");
    await writeFile(svgPath, "<svg><script>alert(1)</script></svg>");
    const videoPath = join(projectPath, "large.mp4");
    await writeFile(videoPath, "");
    await truncate(videoPath, MAX_BINARY_RESOURCE_BYTES + 1);
    const runId = "dx-resource-limits";
    const run = { runId, artifacts: {
      outside: { artifactRef: "outside", runId, path: outsidePath, relativePath: "outside.md", mediaKind: "document", sha256: createHash("sha256").update("outside").digest("hex") },
      unsafe: { artifactRef: "unsafe", runId, path: svgPath, relativePath: "unsafe.svg", mediaKind: "image", sha256: "0".repeat(64) },
      large: { artifactRef: "large", runId, path: videoPath, relativePath: "large.mp4", mediaKind: "video", sha256: "0".repeat(64) }
    } };
    const readRun = async () => run;

    await assert.rejects(readArtifactResource({ uri: buildArtifactResourceUri({ projectPath, runId, artifactRef: "outside" }), readRun }), /inside the project workspace/);
    await assert.rejects(readArtifactResource({ uri: buildArtifactResourceUri({ projectPath, runId, artifactRef: "unsafe" }), readRun }), /format is not allowed/);
    await assert.rejects(readArtifactResource({ uri: buildArtifactResourceUri({ projectPath, runId, artifactRef: "large" }), readRun }), /bounded MCP preview limit/);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
    await rm(outsidePath, { force: true });
  }
});

test("rejects ambiguous URIs and stale resource metadata", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-resource-metadata-"));
  try {
    const path = join(projectPath, "script.txt");
    const content = "current";
    await writeFile(path, content);
    const runId = "dx-resource-metadata", artifactRef = "script";
    const run = { runId, artifacts: { [artifactRef]: {
      artifactRef,
      runId,
      path,
      relativePath: "script.md",
      mediaKind: "document",
      sizeBytes: Buffer.byteLength(content) + 1,
      sha256: createHash("sha256").update(content).digest("hex")
    } } };
    const base = buildArtifactResourceUri({ projectPath, runId, artifactRef });

    await assert.rejects(readArtifactResource({ uri: `${base}&runId=other`, readRun: async () => run }), /parameters are invalid/);
    await assert.rejects(readArtifactResource({ uri: `${base}&unexpected=true`, readRun: async () => run }), /parameters are invalid/);
    await assert.rejects(readArtifactResource({ uri: base, readRun: async () => run }), /format does not match/);

    run.artifacts[artifactRef].relativePath = "script.txt";
    await assert.rejects(readArtifactResource({ uri: base, readRun: async () => run }), /registered byte size/);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
