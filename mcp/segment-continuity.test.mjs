import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertGenerationPlanUsesBoundaryFrames,
  assertRenderPropsBindSegmentStitch,
  assertSegmentContinuityRenderEvidence,
  preserveSegmentContinuityRenderEvidence,
  assertSegmentContinuityReady,
  auditSegmentContinuity,
  extractSegmentBoundaryFrames,
  parseSsim,
  validateSegmentContinuityPlan,
  validateSegmentStitchPlan
} from "./segment-continuity.mjs";

function continuityPlan() {
  return {
    sequenceId: "seq-1",
    minimumSsim: 0.62,
    segments: [
      { segmentId: "S01", requestId: "REQ-1", durationSeconds: 5, startFrameAssetRef: "kf-01", endFrameAssetRef: "kf-02" },
      {
        segmentId: "S02", requestId: "REQ-2", previousSegmentId: "S01", durationSeconds: 5,
        startFrameAssetRef: "kf-02", endFrameAssetRef: "kf-03",
        handoff: {
          matchPolicy: "exact_anchor_then_motion_match", minimumSsim: 0.7, actionOverlapSeconds: 0.2,
          cameraContinuity: "continue push-in", subjectContinuity: "same product and orientation",
          environmentContinuity: "same room and light", motionContinuity: "continue left-to-right action",
          audioBridge: "carry ambience and J-cut narration", acceptanceCriteria: ["same product silhouette", "no direction reversal"]
        }
      }
    ]
  };
}

test("requires every generated segment to use an explicit first/last-frame chain", () => {
  const plan = continuityPlan();
  validateSegmentContinuityPlan(plan);
  assert.throws(() => validateSegmentContinuityPlan({ ...plan, segments: [plan.segments[0], { ...plan.segments[1], startFrameAssetRef: "wrong" }] }), /approved end frame/);
  const run = { segmentContinuityPlan: plan };
  const generationPlan = { requests: [
    { requestId: "REQ-1", mode: "keyframes_to_video", inputAnchorAssets: ["kf-01"], outputAnchorAssets: ["kf-02"] },
    { requestId: "REQ-2", mode: "keyframes_to_video", inputAnchorAssets: ["kf-02"], outputAnchorAssets: ["kf-03"] }
  ] };
  assert.doesNotThrow(() => assertGenerationPlanUsesBoundaryFrames(run, generationPlan));
  assert.throws(() => assertGenerationPlanUsesBoundaryFrames(run, { requests: [generationPlan.requests[0], { ...generationPlan.requests[1], mode: "image_to_video" }] }), /keyframes_to_video/);
});

test("extracts actual first and last frame evidence from the selected video", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-boundary-"));
  const videoPath = join(projectPath, "selected.mp4");
  await writeFile(videoPath, "video");
  const run = {
    segmentContinuityPlan: continuityPlan(),
    generation: { candidates: [{ requestId: "REQ-1", candidateId: "C1", assetRef: "candidate:C1", status: "selected", mediaType: "video" }] },
    artifacts: { "candidate:C1": { path: videoPath, sha256: sha256("video") } }
  };
  const runFn = async (_command, args) => { await mkdir(join(projectPath, ".directorx", "plugin-runs", "dx-test", "media", "boundary-frames"), { recursive: true }); await writeFile(args.at(-1), Buffer.from("fake-png")); return { stdout: "", stderr: "", command: "ffmpeg", args }; };
  const receipt = await extractSegmentBoundaryFrames({ projectPath, runId: "dx-test", segmentId: "S01", videoArtifactRef: "candidate:C1" }, run, {
    runFn,
    inspectMedia: async () => ({ durationSeconds: 5, mediaIntegrity: { frameRate: 25 } })
  });
  assert.equal(receipt.segmentId, "S01");
  assert.match(receipt.firstFrame.artifactRef, /boundary:S01:first/);
  assert.equal(receipt.lastFrame.timeSeconds, 4.95);
  assert.notEqual(receipt.firstFrame.sha256, "");
  assert.equal(receipt.videoSha256, sha256("video"));
});

test("blocks stitching until automatic similarity and every director continuity check pass", async () => {
  const plan = continuityPlan();
  const run = {
    segmentContinuityPlan: plan,
    segmentBoundaryFrames: {
      S01: { videoArtifactRef: "candidate:C1", lastFrame: { artifactRef: "boundary:S01:last", path: "/tmp/s01-last.png", sha256: "a" } },
      S02: { videoArtifactRef: "candidate:C2", firstFrame: { artifactRef: "boundary:S02:first", path: "/tmp/s02-first.png", sha256: "b" } }
    }
  };
  const review = [{ fromSegmentId: "S01", toSegmentId: "S02", subjectContinuity: "passed", cameraContinuity: "passed", motionContinuity: "passed", environmentContinuity: "passed", audioContinuity: "passed", evidenceRefs: ["boundary:S01:last", "boundary:S02:first"], notes: "Product, camera vector, movement and ambience continue across the cut." }];
  const passed = await auditSegmentContinuity({ projectPath: "/tmp", runId: "dx-test", reviews: review }, run, { runFn: async () => ({ stdout: "", stderr: "SSIM Y:0.8 All:0.82 (8.0)" }) });
  assert.equal(passed.status, "passed");
  const blocked = await auditSegmentContinuity({ projectPath: "/tmp", runId: "dx-test", reviews: [{ ...review[0], motionContinuity: "failed" }] }, run, { runFn: async () => ({ stdout: "", stderr: "All:0.82 (8.0)" }) });
  assert.equal(blocked.status, "blocked");
  assert.equal(parseSsim("frame\nAll:0.745000 (5.9)"), 0.745);
});

test("render readiness requires audited boundary frames and a matching stitch plan", () => {
  const plan = continuityPlan();
  const run = {
    segmentContinuityPlan: plan,
    generation: { candidates: [
      { requestId: "REQ-1", assetRef: "candidate:C1", status: "selected", mediaType: "video" },
      { requestId: "REQ-2", assetRef: "candidate:C2", status: "selected", mediaType: "video" }
    ] },
    segmentBoundaryFrames: {
      S01: { videoArtifactRef: "candidate:C1" },
      S02: { videoArtifactRef: "candidate:C2" }
    },
    boundaryContinuityReport: { status: "passed", boundaries: [{ fromSegmentId: "S01", toSegmentId: "S02", status: "passed" }] }
  };
  assert.throws(() => assertSegmentContinuityReady(run), /segment_stitch_plan/);
  run.segmentStitchPlan = {
    sequenceId: "seq-1",
    clips: [{ segmentId: "S01", videoArtifactRef: "candidate:C1" }, { segmentId: "S02", videoArtifactRef: "candidate:C2" }],
    transitions: [{ fromSegmentId: "S01", toSegmentId: "S02", method: "cut_on_match", audioBridge: "J-cut ambience", boundaryEvidenceRef: "boundary_continuity_report.json" }],
    renderStrategy: "Use audited boundaries as immutable clip joins."
  };
  assert.doesNotThrow(() => validateSegmentStitchPlan(run.segmentStitchPlan, run));
  assert.throws(() => validateSegmentStitchPlan({ ...run.segmentStitchPlan, sequenceId: "wrong" }, run), /sequenceId/);
  assert.throws(() => validateSegmentStitchPlan({ ...run.segmentStitchPlan, transitions: [{ ...run.segmentStitchPlan.transitions[0], fromSegmentId: "S02", toSegmentId: "S01" }] }, run), /must connect/);
  assert.deepEqual(assertSegmentContinuityReady(run), { required: true, status: "passed", segmentCount: 2, boundaryCount: 1 });
});

test("multi-segment Remotion props must bind the exact audited clip order", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-stitch-props-"));
  const plan = continuityPlan();
  const c1Path = join(projectPath, "c1.mp4");
  const c2Path = join(projectPath, "c2.mp4");
  await writeFile(c1Path, "clip-one");
  await writeFile(c2Path, "clip-two");
  const c1Sha256 = sha256("clip-one");
  const c2Sha256 = sha256("clip-two");
  const run = {
    segmentContinuityPlan: plan,
    generation: { candidates: [
      { requestId: "REQ-1", assetRef: "candidate:C1", status: "selected", mediaType: "video" },
      { requestId: "REQ-2", assetRef: "candidate:C2", status: "selected", mediaType: "video" }
    ] },
    artifacts: { "candidate:C1": { path: c1Path, sha256: c1Sha256 }, "candidate:C2": { path: c2Path, sha256: c2Sha256 } },
    segmentBoundaryFrames: { S01: { videoArtifactRef: "candidate:C1", videoSha256: c1Sha256 }, S02: { videoArtifactRef: "candidate:C2", videoSha256: c2Sha256 } },
    boundaryContinuityReport: { status: "passed", boundaries: [{ fromSegmentId: "S01", toSegmentId: "S02", status: "passed" }] },
    segmentStitchPlan: {
      sequenceId: "seq-1",
      clips: [{ segmentId: "S01", videoArtifactRef: "candidate:C1" }, { segmentId: "S02", videoArtifactRef: "candidate:C2" }],
      transitions: [{ fromSegmentId: "S01", toSegmentId: "S02", method: "cut_on_match", audioBridge: "J-cut ambience", boundaryEvidenceRef: "boundary_continuity_report.json" }],
      renderStrategy: "audited assembly"
    }
  };
  const propsPath = join(projectPath, "props.json");
  await writeFile(propsPath, JSON.stringify({ directorxSegmentStitch: { planArtifactRef: "segment_stitch_plan.json", boundaryReportRef: "boundary_continuity_report.json", sequenceId: "seq-1", clipArtifactRefs: ["candidate:C1", "candidate:C2"] } }));
  const bound = await assertRenderPropsBindSegmentStitch(run, { projectPath, propsPath });
  assert.equal(bound.renderPropsBinding, "passed");
  assert.equal(bound.propsSha256.length, 64);
  assert.throws(() => assertSegmentContinuityRenderEvidence(run), /lacks a validated/);
  run.artifacts["render_report.json"] = { metadata: { segmentContinuity: bound } };
  assert.equal(assertSegmentContinuityRenderEvidence(run).renderEvidence, "passed");
  const preserved = preserveSegmentContinuityRenderEvidence(run);
  assert.deepEqual(preserved.artifactMetadata, {
    segmentContinuity: bound,
    sourceArtifactRefs: ["segment_stitch_plan.json", "boundary_continuity_report.json"]
  });
  await writeFile(c2Path, "tampered-clip");
  await assert.rejects(() => assertRenderPropsBindSegmentStitch(run, { projectPath, propsPath }), /changed after continuity audit/);
  await writeFile(c2Path, "clip-two");
  await writeFile(propsPath, JSON.stringify({ directorxSegmentStitch: { planArtifactRef: "segment_stitch_plan.json", boundaryReportRef: "boundary_continuity_report.json", sequenceId: "seq-1", clipArtifactRefs: ["candidate:C2", "candidate:C1"] } }));
  await assert.rejects(() => assertRenderPropsBindSegmentStitch(run, { projectPath, propsPath }), /audited stitch order/);
});

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
