import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenCutEditorBootstrap,
  createOpenCutEditorSession,
  importOpenCutEditorDraft,
  markOpenCutEditCommitted,
  markOpenCutEditRendered,
  markOpenCutEditReviewed,
  openCutEditorWaveformDescriptor,
  recordPostProductionEditDecision,
  resumeOpenCutEditorAfterDecline,
  saveOpenCutEditorDraft
} from "./opencut-editor.mjs";

function runFixture() {
  return {
    runId: "dx-open-cut",
    goal: { outcome: "Make a film" },
    artifacts: { "delivery.video": { artifactRef: "delivery.video", path: "/workspace/final.mp4", mediaKind: "video", sizeBytes: 1000, sha256: "abc" } },
    approvals: [{ kind: "delivery", status: "approved" }],
    decisions: [{ kind: "delivery", value: { acceptedTier: "review" } }],
    finalMediaReview: { passed: true, mediaSha256: "abc" },
    finalReviewEvidence: { reviewId: "review-1", versionedArtifactRef: "final_review_evidence/review-1.json", decision: "accept" },
    frameAuditRepairPlan: { planId: "repair-plan-1", findings: [] },
    openCutEditor: null,
    editSession: null
  };
}

function approveEditing(run) {
  recordPostProductionEditDecision(run, {
    kind: "post_production_edit",
    requestId: "dxq-edit",
    status: "resolved",
    confirmedBy: "request_user_input",
    answers: { post_production_edit: "进入剪辑 (Recommended)" },
    resolvedAt: "2026-07-15T12:00:00.000Z"
  });
}

test("prepares an immutable OpenCut-derived project from a final video", () => {
  const run = runFixture();
  approveEditing(run);
  const session = createOpenCutEditorSession(run, { sourceArtifactRef: "delivery.video", durationSeconds: 10, fps: 30 });
  assert.equal(session.engine.productName, "Director X Cut");
  assert.equal(session.engine.commit, "cf5e79e919144200294fb9fed22a222592a0aeea");
  assert.equal(session.project.branding.forcedOutputWatermark, false);
  const bootstrap = buildOpenCutEditorBootstrap(run, session.editorSessionId);
  assert.equal(bootstrap.timeline.tracks[0].clips[0].mediaRef, "delivery.video");
  assert.equal(bootstrap.timeline.tracks[0].clips[0].sourceRange.duration.value, 300);
});

test("exposes a bounded viewport waveform descriptor when the review track has a persisted pyramid", () => {
  const run = runFixture();
  approveEditing(run);
  run.avReviewTimeline = {
    mediaArtifactRef: "delivery.video",
    audioTracks: [{ id: "mix", role: "mix", waveformId: "delivery-mix", waveformWindow: { range: { start: { value: 0, rate: 1000 }, duration: { value: 10000, rate: 1000 } }, peaks: [-1, 1] } }]
  };
  run.waveformPyramids = { "delivery-mix": { waveformId: "delivery-mix", durationSeconds: 10 } };
  const session = createOpenCutEditorSession(run, { sourceArtifactRef: "delivery.video", durationSeconds: 10, fps: 30 });
  const descriptor = openCutEditorWaveformDescriptor(run, session.editorSessionId);
  assert.equal(descriptor.mode, "viewport_pyramid");
  assert.equal(descriptor.endpoint, "/directorx/api/editor-waveform");
  assert.equal(buildOpenCutEditorBootstrap(run, session.editorSessionId).waveform.waveformId, "delivery-mix");
});

test("imports a saved manual draft as an approval-gated canonical patch", () => {
  const run = runFixture();
  approveEditing(run);
  const session = createOpenCutEditorSession(run, { sourceArtifactRef: "delivery.video", durationSeconds: 10, fps: 30 });
  const range = { start: { value: 0, rate: 30 }, duration: { value: 150, rate: 30 } };
  saveOpenCutEditorDraft(run, {
    editorSessionId: session.editorSessionId,
    baseRevision: 0,
    baseContentHash: session.baseContentHash,
    summary: "Split the opening",
    materialChanges: ["duration_change"],
    operations: [{ operationId: "split-1", operation: "split", clipId: "clip-final-1", value: { splitOffset: { value: 150, rate: 30 }, leftClipId: "clip-a", rightClipId: "clip-b" }, affectedRanges: [range] }]
  });
  const imported = importOpenCutEditorDraft(run, { editorSessionId: session.editorSessionId, ttlSeconds: 900 }, new Date("2026-07-15T12:10:00.000Z"));
  assert.equal(imported.patch.status, "awaiting_approval");
  assert.equal(imported.patch.operations[0].operation, "split");
  assert.ok(imported.previewToken.length > 20);
  assert.equal(session.status, "awaiting_patch_approval");
});

test("a committed manual edit invalidates the previous final review and delivery approval", () => {
  const run = runFixture();
  run.artifacts["final_review_evidence.json"] = { artifactRef: "final_review_evidence.json", path: "/workspace/final_review_evidence.json", mediaKind: "document" };
  run.artifacts["final_review_evidence/review-1.json"] = { artifactRef: "final_review_evidence/review-1.json", path: "/workspace/review-1.json", mediaKind: "document" };
  run.artifacts["frame_audit_report.json"] = { artifactRef: "frame_audit_report.json", path: "/workspace/frame_audit_report.json", mediaKind: "document" };
  approveEditing(run);
  const session = createOpenCutEditorSession(run, { sourceArtifactRef: "delivery.video", durationSeconds: 10, fps: 30 });
  session.patchId = "patch:1";
  const result = markOpenCutEditCommitted(run, "patch:1", "2026-07-15T12:20:00.000Z");
  assert.equal(result.status, "render_required");
  assert.equal(run.finalMediaReview, null);
  assert.equal(run.finalReviewEvidence, null);
  assert.equal(run.frameAuditRepairPlan, null);
  assert.equal(run.artifacts["final_review_evidence.json"], undefined);
  assert.ok(run.artifacts["final_review_evidence/review-1.json"]);
  assert.equal(run.artifacts["final_review_evidence/review-1.json"].metadata.current, false);
  assert.equal(run.artifacts["frame_audit_report.json"].metadata.current, false);
  assert.equal(run.reviewHistory[0].finalReviewEvidence.reviewId, "review-1");
  assert.equal(run.approvals[0].status, "pending");
  assert.deepEqual(run.decisions, []);
});

test("binds manual-edit completion to a newly rendered and reviewed file hash", () => {
  const run = runFixture();
  approveEditing(run);
  const session = createOpenCutEditorSession(run, { sourceArtifactRef: "delivery.video", durationSeconds: 10, fps: 30 });
  session.patchId = "patch:1";
  run.editSession.receipt = { status: "committed", patchId: "patch:1" };
  markOpenCutEditCommitted(run, "patch:1", "2026-07-15T12:20:00.000Z");
  run.artifacts["delivery.video"] = { artifactRef: "delivery.video", path: "/workspace/edited.mp4", mediaKind: "video", sizeBytes: 1000, sha256: "edited-hash" };
  assert.equal(markOpenCutEditReviewed(run, { finalVideoArtifactRef: "delivery.video", finalVideoPath: "/workspace/final.mp4", passed: true }), null);
  const rendered = markOpenCutEditRendered(run, { finalVideoArtifactRef: "delivery.video", finalVideoPath: "/workspace/edited.mp4", sha256: "edited-hash" }, "2026-07-15T12:21:00.000Z");
  assert.equal(rendered.status, "review_required");
  assert.throws(() => markOpenCutEditReviewed(run, { finalVideoArtifactRef: "delivery.video", finalVideoPath: "/workspace/final.mp4", passed: true }), /exact newly rendered artifact/);
  const reviewed = markOpenCutEditReviewed(run, { finalVideoArtifactRef: "delivery.video", finalVideoPath: "/workspace/edited.mp4", passed: true }, "2026-07-15T12:22:00.000Z");
  assert.equal(reviewed.status, "completed");
});

test("a declined manual patch returns the same editor session to an adjustable base timeline", () => {
  const run = runFixture();
  approveEditing(run);
  const session = createOpenCutEditorSession(run, { sourceArtifactRef: "delivery.video", durationSeconds: 10, fps: 30 });
  const range = { start: { value: 0, rate: 30 }, duration: { value: 150, rate: 30 } };
  saveOpenCutEditorDraft(run, {
    editorSessionId: session.editorSessionId,
    baseRevision: 0,
    baseContentHash: session.baseContentHash,
    operations: [{ operation: "trim", clipId: "clip-final-1", value: { sourceRange: range, timelineRange: range }, affectedRanges: [range] }]
  });
  importOpenCutEditorDraft(run, { editorSessionId: session.editorSessionId }, new Date("2026-07-15T12:10:00.000Z"));

  const resumed = resumeOpenCutEditorAfterDecline(run, {
    kind: "edit_change",
    requestId: "dxq-manual-edit",
    status: "resolved",
    confirmedBy: "request_user_input",
    answers: { manual_edit_commit: "返回继续调整" }
  }, "2026-07-15T12:11:00.000Z");

  assert.equal(resumed.status, "running");
  assert.equal(resumed.draft, null);
  assert.equal(resumed.patchId, null);
  assert.equal(resumed.draftHistory[0].status, "declined");
  assert.equal(run.editSession.timelineHeads[session.timelineId], session.baseTimelineRevisionId);
  assert.doesNotThrow(() => buildOpenCutEditorBootstrap(run, session.editorSessionId));
});

test("rejects editor startup when the user chose direct delivery", () => {
  const run = runFixture();
  recordPostProductionEditDecision(run, {
    kind: "post_production_edit",
    requestId: "dxq-edit",
    status: "resolved",
    confirmedBy: "request_user_input",
    answers: { post_production_edit: "直接交付" }
  });
  assert.throws(() => createOpenCutEditorSession(run, { sourceArtifactRef: "delivery.video", durationSeconds: 10, fps: 30 }), /chooses editing/);
});

test("rejects malformed browser drafts before they become approval prompts", () => {
  const run = runFixture();
  approveEditing(run);
  const session = createOpenCutEditorSession(run, { sourceArtifactRef: "delivery.video", durationSeconds: 10, fps: 30 });
  const range = { start: { value: 0, rate: 30 }, duration: { value: 150, rate: 30 } };
  assert.throws(() => saveOpenCutEditorDraft(run, { editorSessionId: session.editorSessionId, baseRevision: 0, baseContentHash: session.baseContentHash, operations: [{ operation: "audio_gain", clipId: "clip-final-1", value: { gainDb: 99 }, affectedRanges: [range] }] }), /between -96 dB and \+24 dB/);
  assert.throws(() => saveOpenCutEditorDraft(run, { editorSessionId: session.editorSessionId, baseRevision: 0, baseContentHash: session.baseContentHash, operations: [{ operation: "split", clipId: "clip-final-1", value: { splitOffset: { value: 300, rate: 30 }, leftClipId: "a", rightClipId: "b" }, affectedRanges: [range] }] }), /fall inside the source duration/);
});

test("rejects out-of-bounds trims, duration mismatches, unknown clips, and caption overflow on the server", () => {
  const run = runFixture();
  approveEditing(run);
  run.avReviewTimeline = {
    mediaArtifactRef: "delivery.video",
    subtitles: [{ id: "opening", text: "Opening", range: { start: { value: 0, rate: 30 }, duration: { value: 30, rate: 30 } } }]
  };
  const session = createOpenCutEditorSession(run, { sourceArtifactRef: "delivery.video", durationSeconds: 10, fps: 30 });
  const affected = { start: { value: 0, rate: 30 }, duration: { value: 300, rate: 30 } };
  const save = (operation) => saveOpenCutEditorDraft(run, { editorSessionId: session.editorSessionId, baseRevision: 0, baseContentHash: session.baseContentHash, operations: [operation] });
  assert.throws(() => save({ operation: "trim", clipId: "clip-final-1", value: { sourceRange: { start: { value: 250, rate: 30 }, duration: { value: 80, rate: 30 } }, timelineRange: { start: { value: 0, rate: 30 }, duration: { value: 80, rate: 30 } } }, affectedRanges: [affected] }), /source bounds/);
  assert.throws(() => save({ operation: "trim", clipId: "clip-final-1", value: { sourceRange: { start: { value: 0, rate: 30 }, duration: { value: 120, rate: 30 } }, timelineRange: { start: { value: 0, rate: 30 }, duration: { value: 90, rate: 30 } } }, affectedRanges: [affected] }), /matching source and timeline durations/);
  assert.throws(() => save({ operation: "audio_gain", clipId: "missing-clip", value: { gainDb: -3 }, affectedRanges: [affected] }), /Unknown timeline clip/);
  assert.throws(() => save({ operation: "caption_shift", clipId: "caption-opening", value: { timelineStart: { value: 290, rate: 30 } }, affectedRanges: [{ start: { value: 0, rate: 30 }, duration: { value: 30, rate: 30 } }] }), /exceeds the edited video timeline/);
});
