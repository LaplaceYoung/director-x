import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFinalMediaQuality, createFrameAuditAccumulator, evaluateFinalMediaQuality, parseLoudnessSummary, summarizeFrameAudit, summarizeVisualSamples } from "./final-media-quality.mjs";

const width = 8, height = 8, frameSize = width * height;

test("detects one repeated visual cluster despite repeated frames", () => {
  const frame = Buffer.from(Array.from({ length: frameSize }, (_, index) => index < frameSize / 2 ? 20 : 220));
  const result = summarizeVisualSamples(Buffer.concat(Array.from({ length: 12 }, () => frame)), { sampleWidth: width, sampleHeight: height, sampleIntervalSeconds: 5 });
  assert.equal(result.sampleCount, 12);
  assert.equal(result.uniqueVisualClusters, 1);
  assert.equal(result.averageAdjacentDistance, 0);
});

test("detects materially different sampled visuals", () => {
  const patterns = [
    (x, y) => x < width / 2,
    (x, y) => x >= width / 2,
    (x, y) => y < height / 2,
    (x, y) => (x + y) % 2 === 0
  ];
  const frames = patterns.map((pattern) => Buffer.from(Array.from({ length: frameSize }, (_, index) => pattern(index % width, Math.floor(index / width)) ? 230 : 10)));
  const result = summarizeVisualSamples(Buffer.concat(frames), { sampleWidth: width, sampleHeight: height });
  assert.equal(result.uniqueVisualClusters, 4);
});

test("blocks the prior MOSI-style review cut and distinguishes publish-only requirements", () => {
  const common = {
    deliveryTier: "review",
    durationSeconds: 60,
    visual: { sampleCount: 12, uniqueVisualClusters: 1 },
    audio: { integratedLufs: -14, loudnessRangeLu: 5.9, truePeakDbfs: 0.1 },
    audioRequired: true,
    expectedVisualClusters: 4,
    visualExpectation: { source: "semantic_timeline.json" },
    visualContinuityMode: "multi_shot",
    singleTakeApprovalRef: null,
    mockComponents: ["placeholder_music", "synthetic_tts"],
    rightsStatus: "project_generated"
  };
  const review = evaluateFinalMediaQuality(common);
  assert.equal(review.passed, false);
  assert.ok(review.blockers.includes("visual_diversity:1<4"));
  assert.ok(review.blockers.includes("true_peak:0.1>0"));
  assert.ok(review.warnings.some((warning) => warning.includes("non_publish_components")));

  const publish = evaluateFinalMediaQuality({ ...common, deliveryTier: "publish", visual: { sampleCount: 12, uniqueVisualClusters: 4 }, audio: { integratedLufs: -14, loudnessRangeLu: 5, truePeakDbfs: -1.2 } });
  assert.equal(publish.passed, false);
  assert.ok(publish.blockers.some((blocker) => blocker.startsWith("publish_mock_components:")));
});

test("parses the FFmpeg EBU R128 summary", () => {
  const parsed = parseLoudnessSummary(`noise\nSummary:\n\n  Integrated loudness:\n    I:         -14.0 LUFS\n  Loudness range:\n    LRA:         5.9 LU\n  True peak:\n    Peak:        -1.2 dBFS\n`);
  assert.deepEqual(parsed, { integratedLufs: -14, loudnessRangeLu: 5.9, truePeakDbfs: -1.2, analyzer: "ffmpeg-ebur128" });
});

test("blocks publish renders outside the approved timeline duration", () => {
  const result = evaluateFinalMediaQuality({
    deliveryTier: "publish", durationSeconds: 61.8,
    visual: { sampleCount: 12, uniqueVisualClusters: 4 }, audio: { integratedLufs: -14, loudnessRangeLu: 4, truePeakDbfs: -1.5 }, audioRequired: true,
    expectedVisualClusters: 4, visualExpectation: { source: "semantic_timeline.json", targetDurationSeconds: 60 }, visualContinuityMode: "multi_shot",
    singleTakeApprovalRef: null, mockComponents: [], rightsStatus: "project_generated"
  });
  assert.equal(result.passed, false);
  assert.ok(result.blockers.some((blocker) => blocker.startsWith("duration:61.8_outside_60")));
});

test("audits every decoded frame and detects blank, frozen, and flash defects", () => {
  const black = Buffer.alloc(frameSize, 0);
  const still = Buffer.from(Array.from({ length: frameSize }, (_, index) => index < frameSize / 2 ? 30 : 220));
  const flash = Buffer.alloc(frameSize, 255);
  const report = summarizeFrameAudit(Buffer.concat([
    black,
    ...Array.from({ length: 35 }, () => still),
    flash,
    still,
  ]), { sampleWidth: width, sampleHeight: height, fps: 30, expectedFrameCount: 38 });
  assert.equal(report.auditedFrameCount, 38);
  assert.equal(report.coverageRatio, 1);
  assert.equal(report.blackFrameCount, 1);
  assert.ok(report.longestFrozenRunFrames >= 30);
  assert.ok(report.flashFrameIndices.includes(36));
  assert.equal(report.passed, false);
});

test("accepts restrained frame-to-frame motion without treating it as a freeze", () => {
  const frames = Array.from({ length: 60 }, (_, frameIndex) => Buffer.from(Array.from({ length: frameSize }, (_, pixelIndex) => {
    const base = pixelIndex < frameSize / 2 ? 30 : 100;
    return base + frameIndex * 2;
  })));
  const report = summarizeFrameAudit(Buffer.concat(frames), { sampleWidth: width, sampleHeight: height, fps: 30, expectedFrameCount: 60 });
  assert.equal(report.motionCoverage, 1);
  assert.equal(report.longestFrozenRunFrames, 0);
  assert.equal(report.passed, true);
});

test("streams exhaustive frame analysis across arbitrary chunk boundaries with bounded frame memory", () => {
  const accumulator = createFrameAuditAccumulator({ sampleWidth: width, sampleHeight: height, fps: 30, expectedFrameCount: 3000 });
  const bytes = Buffer.concat(Array.from({ length: 3000 }, (_, frameIndex) => Buffer.from(Array.from({ length: frameSize }, (_, pixelIndex) => (pixelIndex * 3 + frameIndex * 5) % 256))));
  for (let offset = 0; offset < bytes.length; offset += 137) accumulator.pushBytes(bytes.subarray(offset, Math.min(bytes.length, offset + 137)));
  const report = accumulator.finish();
  assert.equal(report.auditMode, "exhaustive_decoded_frames_streaming");
  assert.equal(report.auditedFrameCount, 3000);
  assert.equal(report.coverageRatio, 1);
  assert.equal(report.exactFrameCountParity, true);
  assert.equal(report.exactCoverage, true);
  assert.equal(report.missingFrameCount, 0);
  assert.equal(report.overDecodedFrameCount, 0);
  assert.equal(report.corruptFrameCount, null);
  assert.equal(report.corruptionStatus, "no_decode_error_observed");
  assert.equal(report.peakAnalysisFrameBytes, frameSize);
  assert.ok(!report.blockers.some((blocker) => blocker.startsWith("partial_frame_bytes:")));
  assert.equal(accumulator.finish(), report);
  assert.throws(() => accumulator.pushBytes(Buffer.alloc(frameSize)), /cannot accept decoded bytes/);
});

test("reports incomplete decoded-frame bytes as a hard audit blocker", () => {
  const report = summarizeFrameAudit(Buffer.alloc(frameSize + 7, 24), { sampleWidth: width, sampleHeight: height, fps: 30, expectedFrameCount: 2 });
  assert.equal(report.auditedFrameCount, 1);
  assert.ok(report.blockers.includes("partial_frame_bytes:7"));
  assert.equal(report.passed, false);
});

test("fails exact declared frame-count mismatches in both directions", () => {
  const frame = Buffer.from(Array.from({ length: frameSize }, (_, index) => (index * 9) % 251));
  const under = summarizeFrameAudit(Buffer.concat([frame, frame]), { sampleWidth: width, sampleHeight: height, expectedFrameCount: 3, expectedFrameCountIsExact: true });
  assert.equal(under.missingFrameCount, 1);
  assert.equal(under.overDecodedFrameCount, 0);
  assert.ok(under.blockers.includes("frame_count_delta:-1"));
  const over = summarizeFrameAudit(Buffer.concat([frame, frame, frame]), { sampleWidth: width, sampleHeight: height, expectedFrameCount: 2, expectedFrameCountIsExact: true });
  assert.equal(over.missingFrameCount, 0);
  assert.equal(over.overDecodedFrameCount, 1);
  assert.ok(over.blockers.includes("frame_count_delta:1"));
});

test("distinguishes nominal frame estimates from exact stream frame counts", () => {
  const frame = Buffer.from(Array.from({ length: frameSize }, (_, index) => (index * 7) % 253));
  const report = summarizeFrameAudit(Buffer.concat([frame, frame]), {
    sampleWidth: width, sampleHeight: height, expectedFrameCount: 3,
    expectedFrameCountSource: "duration_times_nominal_fps", expectedFrameCountIsExact: false
  });
  assert.equal(report.expectedFrameCountIsExact, false);
  assert.equal(report.exactCoverage, false);
  assert.ok(!report.blockers.some((blocker) => blocker.startsWith("frame_count_delta:")));
});

test("requires exhaustive frame-audit evidence for review and publish tiers", () => {
  const result = evaluateFinalMediaQuality({
    deliveryTier: "review", durationSeconds: 30,
    visual: { sampleCount: 12, uniqueVisualClusters: 4 },
    frameAudit: null,
    audio: { integratedLufs: -14, loudnessRangeLu: 4, truePeakDbfs: -1.5 }, audioRequired: true,
    expectedVisualClusters: 4, visualExpectation: { source: "semantic_timeline.json", targetDurationSeconds: 30 }, visualContinuityMode: "multi_shot",
    singleTakeApprovalRef: null, mockComponents: [], rightsStatus: "project_generated"
  });
  assert.equal(result.passed, false);
  assert.ok(result.blockers.includes("full_frame_audit_missing"));
});

test("reads canonical tracks arrays and artifact_uri sources from the semantic timeline", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-quality-timeline-"));
  const timelinePath = join(projectPath, "semantic_timeline.json");
  await writeFile(timelinePath, JSON.stringify({
    duration_seconds: 12,
    tracks: [{ track_id: "video-main", track_type: "video", clips: ["a", "b", "c", "d"].map((id, index) => ({ clip_id: id, start_seconds: index * 3, end_seconds: index * 3 + 3, artifact_uri: `generated://${id}` })) }],
    transition_strategy: []
  }));
  const quality = await analyzeFinalMediaQuality({
    run: { artifacts: { "semantic_timeline.json": { path: timelinePath } } },
    media: { durationSeconds: 12, videoPath: join(projectPath, "final.mp4"), videoStreams: [{ nb_frames: "360", avg_frame_rate: "30/1" }], audioStreams: [{ codec_name: "aac" }], mediaIntegrity: { avDurationDeltaSeconds: 0.02 } },
    deliveryTier: "review", mockComponents: [], rightsStatus: "project_generated", visualContinuityMode: "multi_shot"
  }, {
    visual: { sampleCount: 12, uniqueVisualClusters: 4 },
    frameAudit: { passed: true, blockers: [], auditedFrameCount: 360, expectedFrameCount: 360, coverageRatio: 1 },
    audio: { integratedLufs: -14, loudnessRangeLu: 4, truePeakDbfs: -1.5 }
  });
  assert.equal(quality.visual.expectation.timelineClipCount, 4);
  assert.equal(quality.visual.expectation.uniqueTimelineSources, 4);
  assert.equal(quality.visual.expectation.targetDurationSeconds, 12);
  assert.equal(quality.visual.expectedVisualClusters, 3);
  assert.equal(quality.passed, true);
});

test("blocks a review render with excessive audio/video duration drift", () => {
  const result = evaluateFinalMediaQuality({
    deliveryTier: "review", durationSeconds: 30,
    visual: { sampleCount: 12, uniqueVisualClusters: 3 },
    frameAudit: { passed: true, blockers: [], auditedFrameCount: 900, expectedFrameCount: 900, coverageRatio: 1 },
    mediaIntegrity: { avDurationDeltaSeconds: 0.25 },
    audio: { integratedLufs: -14, loudnessRangeLu: 4, truePeakDbfs: -1.5 }, audioRequired: true,
    expectedVisualClusters: 3, visualExpectation: { source: "semantic_timeline.json", targetDurationSeconds: 30 }, visualContinuityMode: "multi_shot",
    singleTakeApprovalRef: null, mockComponents: [], rightsStatus: "project_generated"
  });
  assert.ok(result.blockers.includes("av_duration_delta:0.25>0.1"));
});
