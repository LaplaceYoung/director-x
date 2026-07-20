import test from "node:test";
import assert from "node:assert/strict";
import { commitTimelinePatch } from "./edit-graph.mjs";
import { proposeEvidenceRoughCut } from "./evidence-rough-cut.mjs";
import { createOpenCutEditorSession, importOpenCutEditorDraft, recordPostProductionEditDecision, saveOpenCutEditorDraft } from "./opencut-editor.mjs";

function frameRange(start, duration, rate = 10) {
  return { start: { value: start, rate }, duration: { value: duration, rate } };
}

function runFixture({ crossingCaption = false } = {}) {
  const run = {
    runId: "dx-evidence-cut",
    goal: { outcome: "Create a concise interview" },
    artifacts: {
      "delivery.video": { artifactRef: "delivery.video", path: "/workspace/final.mp4", mediaKind: "video", sizeBytes: 1000, sha256: "abc" },
      "audio_analysis_report.json": { artifactRef: "audio_analysis_report.json", path: "/workspace/audio_analysis_report.json", mediaKind: "document", sizeBytes: 100 }
    },
    avReviewTimeline: {
      timelineId: "review-1",
      mediaArtifactRef: "delivery.video",
      subtitles: [
        { id: "c1", text: "Opening", range: frameRange(5, 10) },
        { id: "c2", text: crossingCaption ? "Crosses cut" : "Inactive", range: crossingCaption ? frameRange(15, 10) : frameRange(22, 8) },
        { id: "c3", text: "Middle", range: frameRange(50, 10) },
        { id: "c4", text: "Closing", range: frameRange(85, 5) }
      ],
      audioTracks: [],
      markers: [
        { id: "silence-marker-1", evidenceRefs: ["audio_analysis_report.json"] },
        { id: "silence-marker-2", evidenceRefs: ["audio_analysis_report.json"] }
      ]
    },
    approvals: [],
    decisions: [],
    openCutEditor: null,
    editSession: null
  };
  recordPostProductionEditDecision(run, {
    kind: "post_production_edit",
    requestId: "dxq-edit",
    status: "resolved",
    confirmedBy: "request_user_input",
    answers: { post_production_edit: "进入剪辑 (Recommended)" }
  });
  const session = createOpenCutEditorSession(run, { sourceArtifactRef: "delivery.video", durationSeconds: 10, fps: 10 });
  return { run, session };
}

test("DX-Editor builds an evidence-bound reversible rough-cut draft and keeps captions synchronized", () => {
  const { run, session } = runFixture();
  const { proposal, draft } = proposeEvidenceRoughCut(run, {
    proposalId: "rough-cut-1",
    owner: "DX-Editor",
    editorSessionId: session.editorSessionId,
    keepBeforeSeconds: 0,
    keepAfterSeconds: 0,
    minimumCutSeconds: 0.1,
    inactiveRanges: [
      { startSeconds: 2, endSeconds: 4, reason: "silence", evidenceRefs: ["silence-marker-1"] },
      { startSeconds: 7, endSeconds: 8, reason: "inactive visual", evidenceRefs: ["silence-marker-2"] }
    ]
  }, "2026-07-16T10:00:00.000Z");

  assert.equal(proposal.owner, "DX-Editor");
  assert.equal(proposal.status, "draft_ready");
  assert.equal(proposal.removedDurationSeconds, 3);
  assert.equal(proposal.estimatedOutputDurationSeconds, 7);
  assert.equal(proposal.requiresNativeApproval, true);
  assert.deepEqual(draft.origin, { kind: "dx_agent", owner: "DX-Editor", proposalId: "rough-cut-1" });
  assert.equal(draft.operations.filter((operation) => operation.operation === "split").length, 4);
  assert.equal(draft.operations.filter((operation) => operation.operation === "delete").length, 3);
  assert.equal(draft.operations.filter((operation) => operation.operation === "caption_shift").length, 2);

  const imported = importOpenCutEditorDraft(run, { editorSessionId: session.editorSessionId, ttlSeconds: 900 }, new Date("2026-07-16T10:01:00.000Z"));
  commitTimelinePatch(run, {
    patchId: imported.patch.patchId,
    previewId: imported.preview.previewId,
    previewToken: imported.previewToken,
    authorSessionId: session.editorSessionId,
    confirmedBy: "request_user_input",
    approvalNote: "User approved the DX-Editor rough cut"
  }, new Date("2026-07-16T10:02:00.000Z"));

  const head = run.editSession.revisions[run.editSession.timelineHeads[session.timelineId]].timeline;
  const video = head.tracks.find((track) => track.kind === "video").clips;
  assert.deepEqual(video.map((clip) => clip.sourceRange.start.value), [0, 40, 80]);
  assert.deepEqual(video.map((clip) => clip.timelineRange.start.value), [0, 20, 50]);
  assert.deepEqual(video.map((clip) => clip.timelineRange.duration.value), [20, 30, 20]);
  const captions = head.tracks.find((track) => track.kind === "caption").clips;
  assert.deepEqual(captions.map((clip) => clip.metadata.text), ["Opening", "Middle", "Closing"]);
  assert.deepEqual(captions.map((clip) => clip.timelineRange.start.value), [5, 30, 55]);
});

test("DX-Editor rejects unregistered evidence and caption boundary collisions", () => {
  const first = runFixture();
  assert.throws(() => proposeEvidenceRoughCut(first.run, {
    proposalId: "unknown-evidence",
    owner: "DX-Editor",
    editorSessionId: first.session.editorSessionId,
    inactiveRanges: [{ startSeconds: 2, endSeconds: 4, evidenceRefs: ["made-up-report.json"] }]
  }), /unregistered evidence/);

  const second = runFixture({ crossingCaption: true });
  assert.throws(() => proposeEvidenceRoughCut(second.run, {
    proposalId: "caption-collision",
    owner: "DX-Editor",
    editorSessionId: second.session.editorSessionId,
    keepBeforeSeconds: 0,
    keepAfterSeconds: 0,
    inactiveRanges: [{ startSeconds: 2, endSeconds: 4, evidenceRefs: ["silence-marker-1"] }]
  }), /crosses a proposed cut boundary/);
});

test("DX-Editor never silently replaces a user's saved manual draft", () => {
  const { run, session } = runFixture();
  saveOpenCutEditorDraft(run, {
    editorSessionId: session.editorSessionId,
    baseRevision: 0,
    baseContentHash: session.baseContentHash,
    operations: [{ operation: "audio_gain", clipId: "clip-final-1", value: { gainDb: -2 }, affectedRanges: [frameRange(0, 100)] }]
  });
  assert.throws(() => proposeEvidenceRoughCut(run, {
    proposalId: "must-not-replace-user",
    owner: "DX-Editor",
    editorSessionId: session.editorSessionId,
    inactiveRanges: [{ startSeconds: 2, endSeconds: 4, evidenceRefs: ["silence-marker-1"] }]
  }), /current Director X Cut draft/);
});
