import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeEvidenceClip } from "./evidence-clips.mjs";
import { runProcess } from "./media-execution.mjs";

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function createSource(projectPath) {
  const sourcePath = join(projectPath, "reference.mp4");
  await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=5:duration=4", "-c:v", "mpeg4", "-q:v", "5", sourcePath], { cwd: projectPath, timeoutMs: 120000, maxOutputBytes: 1_000_000, failureLabel: "test source" });
  return { sourcePath, sourceSha256: await sha256(sourcePath) };
}

test("materializes a bounded review-only clip with hash, lineage, and receipt", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-evidence-clip-"));
  try {
    const source = await createSource(projectPath);
    const result = await materializeEvidenceClip({
      projectPath,
      runId: "run-clip",
      sourcePath: "reference.mp4",
      sourceSha256: source.sourceSha256,
      sourceArtifactRef: "source.video",
      outputArtifactRef: "video-evidence-clip:clip-1",
      clipId: "clip-1",
      queryId: "q1",
      nodeId: "shot-1",
      indexId: "idx-1",
      retrievalTraceRef: "video-retrieval-trace:q1",
      startSeconds: 1,
      endSeconds: 2.5,
      sourceDurationSeconds: 4,
      rightsStatus: "reference_only",
      evidenceRefs: ["frame://reference/1"]
    });
    const output = await stat(result.outputPath);
    const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
    assert.ok(output.size > 0);
    assert.equal(result.outputSha256, await sha256(result.outputPath));
    assert.equal(receipt.receiptKind, "evidence_clip");
    assert.equal(receipt.source.sha256, source.sourceSha256);
    assert.deepEqual(receipt.selection, { queryId: "q1", nodeId: "shot-1", startSeconds: 1, endSeconds: 2.5, durationSeconds: 1.5, halfOpen: true, evidenceRefs: ["frame://reference/1"] });
    assert.equal(receipt.rights.deliveryEligible, false);
    assert.equal(receipt.humanReview.status, "pending");
    assert.equal(receipt.lineage.retrievalTraceRef, "video-retrieval-trace:q1");
    assert.ok(receipt.commands.every((command) => command.args.every((value) => !String(value).includes(projectPath))));
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("fails closed when the source hash, range, or workspace boundary is invalid", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-evidence-clip-invalid-"));
  try {
    const source = await createSource(projectPath);
    const base = { projectPath, runId: "run-clip", sourcePath: "reference.mp4", sourceSha256: source.sourceSha256, sourceArtifactRef: "source.video", queryId: "q1", nodeId: "shot-1", startSeconds: 1, endSeconds: 2 };
    await assert.rejects(() => materializeEvidenceClip({ ...base, sourceSha256: "0".repeat(64), clipId: "bad-hash" }), /content changed/);
    await assert.rejects(() => materializeEvidenceClip({ ...base, clipId: "too-long", startSeconds: 0, endSeconds: 61 }), /between 0.04 and 60/);
    await assert.rejects(() => materializeEvidenceClip({ ...base, sourcePath: "../outside.mp4", clipId: "escape" }), /inside the project workspace/);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
