import test from "node:test";
import assert from "node:assert/strict";
import {
  acknowledgeCanvasReviewNote,
  recordCanvasReviewNote,
  resolveCanvasReviewNote
} from "./canvas-review-notes.mjs";
import { projectCanvas } from "./canvas-projector.mjs";

function runFixture() {
  return {
    stage: "review",
    artifacts: {
      "candidate-a.mp4": {
        mediaKind: "video",
        path: "/project/candidate-a.mp4",
        metadata: { durationSeconds: 12 }
      },
      "repair-plan.json": { mediaKind: "document", path: "/project/repair-plan.json" }
    },
    canvasReviewNotes: [],
    events: [],
    approvals: [],
    decisions: [],
    canvas: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.72 } }
  };
}

test("records an idempotent user-authored timecode note without satisfying approval gates", () => {
  const run = runFixture();
  const input = {
    clientNoteId: "browser-note-001",
    targetArtifactRef: "candidate-a.mp4",
    timeSeconds: 4.25,
    category: "timing",
    severity: "major",
    body: "这里停留太久，请更早进入产品界面。"
  };

  const first = recordCanvasReviewNote(run, input, "2026-07-21T12:00:00.000Z");
  const retried = recordCanvasReviewNote(run, input, "2026-07-21T12:00:03.000Z");

  assert.equal(first.noteId, retried.noteId);
  assert.equal(run.canvasReviewNotes.length, 1);
  assert.equal(first.author, "user");
  assert.equal(first.source, "side_browser_canvas");
  assert.equal(first.status, "open");
  assert.equal(first.isApproval, false);
  assert.equal(first.canSatisfyGate, false);
  assert.equal(first.timeSeconds, 4.25);
});

test("only resolves a user note with registered evidence and preserves the original note", () => {
  const run = runFixture();
  const note = recordCanvasReviewNote(run, {
    clientNoteId: "browser-note-002",
    targetArtifactRef: "candidate-a.mp4",
    timeSeconds: 8,
    category: "subtitle",
    severity: "minor",
    body: "字幕压到了产品按钮。"
  }, "2026-07-21T12:00:00.000Z");

  acknowledgeCanvasReviewNote(run, { noteId: note.noteId, owner: "DX-Editor" }, "2026-07-21T12:01:00.000Z");
  assert.equal(note.status, "acknowledged");
  assert.throws(() => resolveCanvasReviewNote(run, {
    noteId: note.noteId,
    resolutionSummary: "已修复",
    evidenceRefs: ["missing.json"]
  }), /registered evidence/);
  assert.throws(() => resolveCanvasReviewNote(run, {
    noteId: note.noteId,
    resolutionSummary: "已修复",
    evidenceRefs: ["candidate-a.mp4"]
  }), /beyond the original target/);

  resolveCanvasReviewNote(run, {
    noteId: note.noteId,
    resolutionSummary: "字幕已上移并完成预览检查。",
    evidenceRefs: ["repair-plan.json"]
  }, "2026-07-21T12:02:00.000Z");

  assert.equal(note.status, "resolved");
  assert.equal(note.body, "字幕压到了产品按钮。");
  assert.deepEqual(note.resolution.evidenceRefs, ["repair-plan.json"]);
});

test("projects open canvas feedback as review markers and activity, never as approvals", () => {
  const run = runFixture();
  const note = recordCanvasReviewNote(run, {
    clientNoteId: "browser-note-003",
    targetArtifactRef: "candidate-a.mp4",
    timeSeconds: 2.5,
    category: "creative_direction",
    severity: "major",
    body: "开场需要更快出现品牌主体。"
  });

  const canvas = projectCanvas(run);
  assert.equal(canvas.reviewNotes.openCount, 1);
  assert.equal(canvas.reviewNotes.items[0].noteId, note.noteId);
  assert.equal(canvas.reviewNotes.items[0].timeSeconds, 2.5);
  assert.ok(canvas.reviewTimeline?.markers?.some((marker) => marker.noteId === note.noteId));
  assert.ok(canvas.activity.userReviewNotes.some((item) => item.noteId === note.noteId));
  assert.equal(canvas.activity.pendingInteractions.length, 0);
});

test("rejects notes outside the bound media duration or against non-media artifacts", () => {
  const run = runFixture();
  assert.throws(() => recordCanvasReviewNote(run, {
    clientNoteId: "browser-note-004",
    targetArtifactRef: "candidate-a.mp4",
    timeSeconds: 13,
    category: "technical",
    severity: "major",
    body: "越界时间码"
  }), /duration/);
  assert.throws(() => recordCanvasReviewNote(run, {
    clientNoteId: "browser-note-005",
    targetArtifactRef: "repair-plan.json",
    category: "creative_direction",
    severity: "note",
    body: "不应绑定到文档"
  }), /media artifact/);
});
