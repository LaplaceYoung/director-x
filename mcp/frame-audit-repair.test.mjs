import test from "node:test";
import assert from "node:assert/strict";
import { buildFrameAuditRepairPlan, mergeFrameAuditIntoReviewTimeline } from "./frame-audit-repair.mjs";

const range = (start, duration, rate = 30) => ({ start: { value: start, rate }, duration: { value: duration, rate } });

test("maps exhaustive frame defects to canonical clips and repair actions", async () => {
  const timeline = {
    schemaVersion: "1.0", timelineId: "cut", rate: { value: 1, rate: 30 },
    tracks: [{ trackId: "video-main", kind: "video", clips: [
      { clipId: "opening", mediaRef: "candidate:a", sourceRange: range(0, 150), timelineRange: range(0, 150) },
      { clipId: "close", mediaRef: "candidate:b", sourceRange: range(0, 150), timelineRange: range(150, 150) }
    ] }]
  };
  const run = { runId: "dx-test", editSession: { timelineHeads: { cut: "cut:1" }, revisions: { "cut:1": { revisionId: "cut:1", timeline } } } };
  const plan = await buildFrameAuditRepairPlan({
    run, durationSeconds: 10,
    frameAudit: { auditMode: "exhaustive_decoded_frames_streaming", fps: 30, passed: false, blockers: ["frozen_run:2s"], defectIntervals: [{ code: "frozen_run", startFrame: 180, endFrame: 239, timeSeconds: 6, endSeconds: 8, durationSeconds: 2 }] }
  });
  assert.equal(plan.status, "review_required");
  assert.equal(plan.findings[0].clipId, "close");
  assert.equal(plan.findings[0].trackId, "video-main");
  assert.equal(plan.findings[0].repairAction, "replace_or_regenerate_affected_clip_interval");
  assert.equal(plan.mappedFindingCount, 1);
});

test("projects frame findings into the review timeline without deleting user markers", async () => {
  const repairPlan = {
    planId: "frame-audit-repair:dx-test", sourceRevisionId: "cut:1",
    timelineClips: [{ trackId: "video-main", clipId: "opening", mediaRef: "candidate:a", startSeconds: 0, endSeconds: 5 }],
    findings: [{ findingId: "frame-audit:1", code: "flash_frame", severity: "major", label: "异常闪变", startSeconds: 2, endSeconds: 2.04, durationSeconds: 0.04, clipId: "opening", trackId: "video-main", repairAction: "inspect_transition_then_trim_replace_or_rerender", evidenceRefs: ["timeline_revision.json"] }]
  };
  const timeline = mergeFrameAuditIntoReviewTimeline({
    repairPlan, durationSeconds: 5, fps: 25,
    existingTimeline: {
      timelineId: "review-1", revisionId: "cut:1", mediaArtifactRef: "delivery.video", projectRate: { value: 25, rate: 1 }, duration: { value: 5000, rate: 1000 }, shots: [], subtitles: [], audioTracks: [],
      markers: [
        { id: "note:user", range: { start: { value: 1000, rate: 1000 }, duration: { value: 100, rate: 1000 } }, kind: "note", label: "保留", evidenceRefs: ["user-note"] },
        { id: "frame-audit:old", range: { start: { value: 0, rate: 1000 }, duration: { value: 10, rate: 1000 } }, kind: "defect", label: "旧", evidenceRefs: ["old"] }
      ]
    }
  });
  assert.deepEqual(timeline.markers.map((marker) => marker.id), ["note:user", "frame-audit:1"]);
  assert.equal(timeline.markers[1].clipId, "opening");
  assert.equal(timeline.markers[1].range.start.value, 2000);
  assert.equal(timeline.shots[0].id, "opening");
});

test("creates a global repair finding when frame coverage is incomplete", async () => {
  const plan = await buildFrameAuditRepairPlan({
    run: { runId: "dx-test" }, durationSeconds: 30,
    frameAudit: { auditMode: "exhaustive_decoded_frames_streaming", fps: 30, passed: false, blockers: ["coverage:0.8<0.98"], defectIntervals: [] }
  });
  assert.equal(plan.findings[0].code, "decode_coverage");
  assert.equal(plan.findings[0].severity, "critical");
  assert.equal(plan.findings[0].repairAction, "rerender_from_canonical_timeline");
});

test("treats exact frame-count parity failures as global rerender findings", async () => {
  const plan = await buildFrameAuditRepairPlan({
    run: { runId: "dx-test" }, durationSeconds: 12,
    frameAudit: { auditMode: "exhaustive_decoded_frames_streaming", fps: 24, passed: false, blockers: ["frame_count_delta:-2"], defectIntervals: [], auditedFrameCount: 286 }
  });
  assert.equal(plan.findings[0].code, "decode_coverage");
  assert.equal(plan.findings[0].severity, "critical");
  assert.equal(plan.findings[0].startSeconds, 0);
  assert.equal(plan.findings[0].endSeconds, 12);
});
