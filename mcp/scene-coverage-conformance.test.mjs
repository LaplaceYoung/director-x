import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachSceneCoverageEvidence, compileSceneCoverageConformance, extractSceneCoverageEvidence, recordSceneCoverageConformanceReview } from "./scene-coverage-conformance.mjs";

const rationalRange = (start, duration) => ({ start: { value: start, rate: 30 }, duration: { value: duration, rate: 30 } });

function plan() {
  return {
    planId: "coverage-1",
    sequenceId: "sequence-1",
    status: "ready",
    targetDurationSeconds: 6,
    sourceBinding: { status: "ready", artifactRef: "shotlist.json", sha256: "a".repeat(64) },
    shotOrder: ["S01", "S02"],
    shots: [
      { shotId: "S01", sceneId: "SC-1", coverageRole: "geography", purpose: "Establish space", durationSeconds: 3, handles: { headSeconds: .5, tailSeconds: .5 } },
      { shotId: "S02", sceneId: "SC-1", coverageRole: "proof", purpose: "Show proof", durationSeconds: 3, handles: { headSeconds: .5, tailSeconds: .5 } }
    ]
  };
}

function timeline() {
  return {
    schemaVersion: "1.0",
    timelineId: "timeline-1",
    tracks: [{
      trackId: "video-main",
      kind: "video",
      clips: [
        { clipId: "clip-1", shotId: "S01", mediaRef: "candidate:1", sourceRange: rationalRange(30, 90), timelineRange: rationalRange(0, 90) },
        { clipId: "clip-2", metadata: { shotId: "S02", sourceDurationSeconds: 5 }, mediaRef: "candidate:2", sourceRange: rationalRange(30, 90), timelineRange: rationalRange(90, 90) }
      ]
    }]
  };
}

function auditInput(overrides = {}) {
  return {
    plan: plan(),
    timeline: timeline(),
    frameAudit: { auditMode: "exhaustive_decoded_frames_streaming", passed: true, auditedFrameCount: 180, blockers: [] },
    frameIdentity: { passed: true, frameCountParity: true, frameCount: 180, sourceMediaSha256: "media-sha", blockers: [], capturedFrames: Object.fromEntries([0, 45, 89, 90, 135, 179].map((frameIndex) => [String(frameIndex), { frameIndex, decodeOrdinal: frameIndex, bestEffortTimestampTicks: String(frameIndex), ptsTimeSeconds: frameIndex / 30 }])) },
    mediaArtifactRef: "delivery.video",
    mediaSha256: "media-sha",
    mediaDurationsByRef: { "candidate:1": 5, "candidate:2": 5 },
    finalDurationSeconds: 6,
    fps: 30,
    ...overrides
  };
}

test("binds every planned shot to final timeline identity, duration, handles, and review targets", () => {
  const report = compileSceneCoverageConformance(auditInput());
  assert.equal(report.status, "awaiting_multimodal_review");
  assert.deepEqual(report.shotOrder, ["S01", "S02"]);
  assert.equal(report.shots[0].handles.availableHeadSeconds, 1);
  assert.equal(report.shots[0].handles.availableTailSeconds, 1);
  assert.deepEqual(report.reviewTasks[0].evidenceTargets.map((item) => item.role), ["first", "middle", "last"]);
  assert.equal(report.technicalBlockers.length, 0);
});

test("blocks missing shot identity, duration drift, source handle uncertainty, and failed frame identity", () => {
  const broken = timeline();
  delete broken.tracks[0].clips[0].shotId;
  broken.tracks[0].clips[1].timelineRange = rationalRange(90, 60);
  delete broken.tracks[0].clips[1].metadata.sourceDurationSeconds;
  const report = compileSceneCoverageConformance(auditInput({ timeline: broken, mediaDurationsByRef: {}, finalDurationSeconds: 5, frameIdentity: { passed: false, frameCountParity: false, frameCount: 150, sourceMediaSha256: "media-sha", blockers: ["frame_identity_count_delta:-1"] } }));
  const codes = report.technicalBlockers.map((item) => item.code);
  assert.equal(report.status, "technical_blocked");
  assert.ok(codes.includes("timeline_clip_shot_identity_missing"));
  assert.ok(codes.includes("planned_shot_missing_from_final_timeline"));
  assert.ok(codes.includes("final_shot_duration_drift"));
  assert.ok(codes.includes("source_duration_evidence_missing"));
  assert.ok(codes.includes("frame_identity_not_verified"));
});

test("blocks a source handle that is short by one frame", () => {
  const shortHandleTimeline = timeline();
  shortHandleTimeline.tracks[0].clips[0].sourceRange = rationalRange(14, 90);
  const report = compileSceneCoverageConformance(auditInput({ timeline: shortHandleTimeline }));
  const shot = report.shots.find((item) => item.shotId === "S01");
  assert.equal(shot.handles.availableHeadFrames, 14);
  assert.equal(shot.handles.requiredHeadFrames, 15);
  assert.ok(report.technicalBlockers.some((item) => item.code === "real_head_handle_insufficient"));
});

test("requires canonical DX reviewer evidence for every artistic task", () => {
  const report = attachSceneCoverageEvidence(compileSceneCoverageConformance(auditInput()), {
    S01: ["first", "middle", "last"].map((role) => ({ artifactRef: `scene_frames/S01-${role}.png`, role })),
    S02: ["first", "middle", "last"].map((role) => ({ artifactRef: `scene_frames/S02-${role}.png`, role }))
  });
  const evidence = ["scene_frames/S01-first.png", "scene_frames/S01-middle.png", "scene_frames/S01-last.png", "scene_frames/S02-first.png", "scene_frames/S02-middle.png", "scene_frames/S02-last.png"];
  const dispositions = report.reviewTasks.map((task) => ({
    taskId: task.taskId,
    status: "fulfilled",
    reason: "The rendered shot fulfills the planned camera, blocking, lighting, composition, and narrative responsibility.",
    evidenceRefs: evidence.filter((ref) => ref.includes(task.shotId))
  }));
  const result = recordSceneCoverageConformanceReview(report, { reviewId: "review-1", reviewerId: "DX-Quality-Reviewer", decision: "accept", summary: "All planned coverage is present and visually fulfilled.", dispositions }, evidence);
  assert.equal(result.report.status, "conformant");
  assert.equal(result.evidence.reviewerId, "DX-Quality-Reviewer");
  assert.equal(result.report.reviewTasks.every((task) => task.status === "fulfilled"), true);
});

test("rejects a review that substitutes another shot or omits an identity-bound frame", () => {
  const report = attachSceneCoverageEvidence(compileSceneCoverageConformance(auditInput()), {
    S01: ["first", "middle", "last"].map((role) => ({ artifactRef: `scene_frames/S01-${role}.png`, role })),
    S02: ["first", "middle", "last"].map((role) => ({ artifactRef: `scene_frames/S02-${role}.png`, role }))
  });
  const evidence = report.evidenceIndex.map((item) => item.artifactRef);
  const dispositions = report.reviewTasks.map((task) => ({
    taskId: task.taskId,
    status: "fulfilled",
    reason: "Reviewed against the rendered evidence.",
    evidenceRefs: task.shotId === "S01" ? task.evidenceRefs.slice(0, 2) : task.evidenceRefs
  }));
  assert.throws(() => recordSceneCoverageConformanceReview(report, { reviewId: "review-incomplete", reviewerId: "DX-Quality-Reviewer", decision: "accept", summary: "Incomplete evidence", dispositions }, evidence), /must cite every first\/middle\/last evidence frame/);
});

test("extracts identity-bound first, middle, and last evidence for every planned shot", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-scene-evidence-"));
  const videoPath = join(projectPath, "final.mp4");
  await writeFile(videoPath, "video-placeholder");
  const compiled = compileSceneCoverageConformance(auditInput());
  const extractionCalls = [];
  const evidence = await extractSceneCoverageEvidence({ projectPath, runId: "run-1", videoPath, report: compiled, frameIdentity: auditInput().frameIdentity }, {
    extractor: async ({ outputPath, shot, target, extractionMode }) => {
      extractionCalls.push({ shotId: shot.shotId, role: target.role, extractionMode });
      await writeFile(outputPath, `frame:${shot.shotId}:${target.role}`);
    }
  });
  assert.equal(extractionCalls.length, 6);
  assert.deepEqual(Object.keys(evidence), ["S01", "S02"]);
  assert.equal(evidence.S01.every((item) => item.identityVerified && item.sourceMediaSha256 === "media-sha"), true);
  assert.equal(await readFile(evidence.S02[2].path, "utf8"), "frame:S02:last");
});

test("does not allow reviewer acceptance to waive technical blockers", () => {
  const report = compileSceneCoverageConformance(auditInput({ frameAudit: { auditMode: "exhaustive_decoded_frames_streaming", passed: false, auditedFrameCount: 179, blockers: ["frame_count_delta:-1"] } }));
  assert.throws(() => recordSceneCoverageConformanceReview(report, { reviewId: "review-2", reviewerId: "DX-Quality-Reviewer", decision: "accept", summary: "Attempted waiver", dispositions: [] }, []), /Technical scene-coverage blockers/);
});
