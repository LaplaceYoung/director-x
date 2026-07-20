import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { planVideoRead, readVideoEvidence, VIDEO_READ_UPSTREAM } from "./video-reading.mjs";

const execFileAsync = promisify(execFile);

test("plans duration-aware, focused, transcript-cue, and exhaustive reads", () => {
  const short = planVideoRead({ profile: "scene_summary", durationSeconds: 20 });
  assert.equal(short.targetFrames, 20);
  const focused = planVideoRead({ profile: "scene_summary", durationSeconds: 120, startSeconds: 10, endSeconds: 20 });
  assert.equal(focused.focused, true);
  assert.equal(focused.targetFrames, 30);
  const transcript = planVideoRead({ profile: "transcript_only", durationSeconds: 20, cueTimestamps: [2, 8] });
  assert.equal(transcript.maxFrames, 2);
  assert.throws(() => planVideoRead({ profile: "full_frame_evidence", durationSeconds: 20, startSeconds: 1 }), /complete source/);
  assert.throws(() => planVideoRead({ profile: "full_frame_evidence", durationSeconds: 20, cueTimestamps: [2] }), /already contains every decoded frame/);
});

test("reads real video frames, preserves transcript cues, and writes canvas-ready evidence", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-video-reading-"));
  const videoPath = join(projectPath, "source.mp4");
  const transcriptPath = join(projectPath, "source.srt");
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=5:duration=4", "-c:v", "mpeg4", "-q:v", "5", videoPath]);
    await writeFile(transcriptPath, "1\n00:00:00,500 --> 00:00:01,500\nOpening proof\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond beat\n");

    const sampled = await readVideoEvidence({ projectPath, runId: "run-read", readId: "scene-demo", videoPath, profile: "scene_summary", maxFrames: 6, resolution: 320 });
    assert.equal(sampled.status, "ready");
    assert.ok(sampled.frames.length >= 1 && sampled.frames.length <= 6);
    assert.equal((await stat(sampled.contactSheetPath)).isFile(), true);
    assert.equal((await stat(sampled.manifestPath)).isFile(), true);
    assert.equal(sampled.security.shellExecution, false);
    assert.deepEqual(sampled.upstreamInfluence, VIDEO_READ_UPSTREAM);

    const cueRead = await readVideoEvidence({ projectPath, runId: "run-read", readId: "cue-demo", videoPath, transcriptPath, profile: "transcript_only", cueTimestamps: [0.75, 2.25], resolution: 320 });
    assert.equal(cueRead.frames.length, 2);
    assert.deepEqual(cueRead.frames.map((frame) => frame.reason), ["transcript_cue", "transcript_cue"]);
    assert.equal(cueRead.transcript.segments.length, 2);
    const transcript = JSON.parse(await readFile(cueRead.transcriptPath, "utf8"));
    assert.equal(transcript.sourceFormat, "srt");
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("full-frame evidence checks extracted count against independent identity evidence", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-video-full-read-"));
  const videoPath = join(projectPath, "source.mp4");
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=128x72:rate=5:duration=2", "-c:v", "mpeg4", "-q:v", "5", videoPath]);
    const result = await readVideoEvidence({ projectPath, runId: "run-full", readId: "full-demo", videoPath, profile: "full_frame_evidence", maxFrames: 20, resolution: 320 }, {
      collectFrameIdentityFn: async ({ projectPath: root, runId, artifactRef, auditedFrameCount }) => {
        const path = join(root, ".directorx", "plugin-runs", runId, "artifacts", artifactRef);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Array.from({ length: auditedFrameCount }, (_, index) => JSON.stringify({ frameIndex: index })).join("\n") + "\n");
        return { artifactRef, path, frameCount: auditedFrameCount, probeReachedEof: true };
      }
    });
    assert.equal(result.frames.length, 10);
    assert.deepEqual(result.fullFrameCoverage, { extractedFrameCount: 10, identityFrameCount: 10, probeReachedEof: true, countParity: true, passed: true });
    assert.equal((await stat(result.contactSheetPath)).isFile(), true);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
