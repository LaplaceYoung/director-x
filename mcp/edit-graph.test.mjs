import test from "node:test";
import assert from "node:assert/strict";
import { applyTimelineOperations, commitTimelinePatch, compileEditGraph, createPatchPreview, hashTimeline, registerEditIntent, registerTimelinePatch, registerTimelineRevision } from "./edit-graph.mjs";

const range = { start: { value: 0, rate: 30 }, duration: { value: 90, rate: 30 } };

test("compiles and commits an auditable timeline patch", () => {
  const run = {};
  const timeline = { schemaVersion: "1.0", timelineId: "tl1", rate: { value: 1, rate: 30 }, tracks: [{ trackId: "v1", kind: "video", clips: [{ clipId: "c1", mediaRef: "asset:a", sourceRange: { start: { value: 0, rate: 30 }, duration: { value: 120, rate: 30 } }, timelineRange: { start: { value: 0, rate: 30 }, duration: { value: 120, rate: 30 } } }] }] };
  const contentHash = hashTimeline(timeline);
  registerTimelineRevision(run, { revisionId: "tl1:2", timelineId: "tl1", revision: 2, parentRevisionId: null, contentHash, timeline, createdAt: "2026-01-01T00:00:00.000Z" });
  registerEditIntent(run, { intentId: "ei1", baseTimelineRef: "semantic_timeline.json", baseRevision: 2, baseContentHash: contentHash, explicitGoals: ["shorten opening"], inferredConstraints: ["keep narration"], requestedOperations: ["trim"] });
  compileEditGraph(run, { graphId: "eg1", intentId: "ei1", baseTimelineRef: "semantic_timeline.json", baseRevision: 2, nodes: [{ nodeId: "trim1", operation: "trim", dependsOn: [], inputArtifactRefs: ["clip:a"], outputArtifactRefs: ["clip:a:v2"], affectedRanges: [range] }] });
  const patch = registerTimelinePatch(run, { patchId: "tp1", graphId: "eg1", timelineId: "tl1", baseTimelineRef: "semantic_timeline.json", baseRevision: 2, baseContentHash: contentHash, targetRevision: 3, materialChanges: ["duration_change"], operations: [{ operationId: "op1", nodeId: "trim1", operation: "trim", path: "/clips/c1", value: { sourceRange: range, timelineRange: range }, affectedRanges: [range], evidenceRefs: ["review:opening"], reversible: true, clipId: "c1" }] });
  assert.equal(patch.status, "awaiting_approval");
  const grant = createPatchPreview(run, { authorSessionId: "session:1" });
  assert.throws(() => commitTimelinePatch(run, { patchId: "tp1", previewId: grant.preview.previewId, previewToken: grant.previewToken, authorSessionId: "session:1" }), /request_user_input/);
  commitTimelinePatch(run, { patchId: "tp1", previewId: grant.preview.previewId, previewToken: grant.previewToken, authorSessionId: "session:1", confirmedBy: "request_user_input", approvalNote: "User approved shorter opening" });
  assert.equal(run.editSession.receipt.targetRevision, 3);
  assert.equal(run.editSession.receipt.status, "committed");
  assert.equal(run.editSession.timelineHeads.tl1, "tl1:3");
  assert.equal(run.editSession.receipt.reversible, true);
});

test("rejects cycles and patch operations without evidence", () => {
  const run = {}; registerEditIntent(run, { intentId: "ei1", baseTimelineRef: "timeline", baseRevision: 0, baseContentHash: "sha256:test", explicitGoals: ["edit"], inferredConstraints: [], requestedOperations: ["trim"] });
  assert.throws(() => compileEditGraph(run, { graphId: "eg", intentId: "ei1", baseTimelineRef: "timeline", baseRevision: 0, nodes: [
    { nodeId: "a", operation: "trim", dependsOn: ["b"], inputArtifactRefs: ["x"], outputArtifactRefs: ["y"], affectedRanges: [range] },
    { nodeId: "b", operation: "trim", dependsOn: ["a"], inputArtifactRefs: ["y"], outputArtifactRefs: ["z"], affectedRanges: [range] }
  ] }), /acyclic/);
});

test("rejects a patch whose timeline head changed after preview", () => {
  const timeline = { schemaVersion: "1.0", timelineId: "tl", rate: { value: 1, rate: 30 }, tracks: [{ trackId: "v", kind: "video", clips: [{ clipId: "c", mediaRef: "a", sourceRange: range, timelineRange: range }] }] };
  const run = {}, hash = hashTimeline(timeline);
  registerTimelineRevision(run, { revisionId: "tl:0", timelineId: "tl", revision: 0, parentRevisionId: null, contentHash: hash, timeline, createdAt: "2026-01-01T00:00:00.000Z" });
  registerEditIntent(run, { intentId: "i", baseTimelineRef: "semantic_timeline.json", baseRevision: 0, baseContentHash: hash, explicitGoals: ["replace"], inferredConstraints: [], requestedOperations: ["replace"] });
  compileEditGraph(run, { graphId: "g", intentId: "i", baseTimelineRef: "semantic_timeline.json", baseRevision: 0, nodes: [{ nodeId: "n", operation: "replace", dependsOn: [], inputArtifactRefs: ["a"], outputArtifactRefs: ["b"], affectedRanges: [range] }] });
  registerTimelinePatch(run, { patchId: "p", graphId: "g", timelineId: "tl", baseTimelineRef: "semantic_timeline.json", baseRevision: 0, baseContentHash: hash, targetRevision: 1, materialChanges: [], operations: [{ operationId: "o", nodeId: "n", operation: "replace", clipId: "c", path: "/clips/c", value: { fromMediaRef: "a", toMediaRef: "b" }, affectedRanges: [range], evidenceRefs: ["review"], reversible: true }] });
  const grant = createPatchPreview(run, { authorSessionId: "session:2" });
  run.editSession.revisions["tl:0"].contentHash = "sha256:changed";
  commitTimelinePatch(run, { patchId: "p", previewId: grant.preview.previewId, previewToken: grant.previewToken, authorSessionId: "session:2", confirmedBy: "not_required" });
  assert.equal(run.editSession.receipt.status, "conflict");
});

test("commits split, reorder, audio gain, and delete operations used by manual editing", () => {
  const timeline = { schemaVersion: "1.0", timelineId: "manual", rate: { value: 1, rate: 30 }, tracks: [{ trackId: "v", kind: "video", clips: [{ clipId: "source", mediaRef: "delivery.video", sourceRange: { start: { value: 0, rate: 30 }, duration: { value: 300, rate: 30 } }, timelineRange: { start: { value: 0, rate: 30 }, duration: { value: 300, rate: 30 } } }] }] };
  const run = {}, hash = hashTimeline(timeline);
  registerTimelineRevision(run, { revisionId: "manual:0", timelineId: "manual", revision: 0, parentRevisionId: null, contentHash: hash, timeline, createdAt: "2026-01-01T00:00:00.000Z" });
  registerEditIntent(run, { intentId: "manual-edit", baseTimelineRef: "opencut_project.json", baseRevision: 0, baseContentHash: hash, explicitGoals: ["manual polish"], inferredConstraints: ["preserve source media"], requestedOperations: ["split", "audio_gain", "reorder", "delete"] });
  const nodes = [
    { nodeId: "split", operation: "split", dependsOn: [], inputArtifactRefs: ["delivery.video"], outputArtifactRefs: ["left", "right"], affectedRanges: [range] },
    { nodeId: "gain", operation: "audio_gain", dependsOn: ["split"], inputArtifactRefs: ["left"], outputArtifactRefs: ["left:gained"], affectedRanges: [range] },
    { nodeId: "move", operation: "reorder", dependsOn: ["gain"], inputArtifactRefs: ["right"], outputArtifactRefs: ["right:moved"], affectedRanges: [range] },
    { nodeId: "delete", operation: "delete", dependsOn: ["move"], inputArtifactRefs: ["right:moved"], outputArtifactRefs: ["right:deleted"], affectedRanges: [range] }
  ];
  compileEditGraph(run, { graphId: "manual-graph", intentId: "manual-edit", baseTimelineRef: "opencut_project.json", baseRevision: 0, nodes });
  registerTimelinePatch(run, { patchId: "manual-patch", graphId: "manual-graph", timelineId: "manual", baseTimelineRef: "opencut_project.json", baseRevision: 0, baseContentHash: hash, targetRevision: 1, materialChanges: ["manual_edit_override"], operations: [
    { operationId: "op-split", nodeId: "split", operation: "split", clipId: "source", path: "/tracks/v/clips/source", value: { splitOffset: { value: 120, rate: 30 }, leftClipId: "left", rightClipId: "right" }, affectedRanges: [range], evidenceRefs: ["editor:manual"], reversible: true },
    { operationId: "op-gain", nodeId: "gain", operation: "audio_gain", clipId: "left", path: "/tracks/v/clips/left/effects", value: { gainDb: -3 }, affectedRanges: [range], evidenceRefs: ["editor:manual"], reversible: true },
    { operationId: "op-move", nodeId: "move", operation: "reorder", clipId: "right", path: "/tracks/v/clips/right", value: { targetTrackId: "v", timelineStart: { value: 120, rate: 30 } }, affectedRanges: [range], evidenceRefs: ["editor:manual"], reversible: true },
    { operationId: "op-delete", nodeId: "delete", operation: "delete", clipId: "right", path: "/tracks/v/clips/right", value: {}, affectedRanges: [range], evidenceRefs: ["editor:manual"], reversible: true }
  ] });
  const grant = createPatchPreview(run, { authorSessionId: "opencut:1" });
  commitTimelinePatch(run, { patchId: "manual-patch", previewId: grant.preview.previewId, previewToken: grant.previewToken, authorSessionId: "opencut:1", confirmedBy: "request_user_input", approvalNote: "Approved manual edit" });
  const head = run.editSession.revisions[run.editSession.timelineHeads.manual].timeline;
  assert.deepEqual(head.tracks[0].clips.map((clip) => clip.clipId), ["left"]);
  assert.equal(head.tracks[0].clips[0].sourceRange.duration.value, 120);
  assert.equal(head.tracks[0].clips[0].effects[0].db, -3);
});

test("carries DX review finding lineage into the committed revision and receipt", () => {
  const timeline = { schemaVersion: "1.0", timelineId: "repair", rate: { value: 1, rate: 30 }, tracks: [{ trackId: "v", kind: "video", clips: [{ clipId: "broken", mediaRef: "delivery.video", sourceRange: range, timelineRange: range }] }] };
  const hash = hashTimeline(timeline);
  const run = {
    artifacts: {
      "delivery.video": { sha256: "media-sha" },
      "frame_audit_report.json": {},
      "frame_audit_repair_plan.json": {},
      "final_review_evidence/review-1.json": {}
    },
    finalReviewEvidence: { reviewId: "review-1", versionedArtifactRef: "final_review_evidence/review-1.json" },
    frameAuditRepairPlan: { findings: [{ findingId: "frame-audit:1" }] }
  };
  registerTimelineRevision(run, { revisionId: "repair:0", timelineId: "repair", revision: 0, parentRevisionId: null, contentHash: hash, timeline, createdAt: "2026-01-01T00:00:00.000Z" });
  registerEditIntent(run, { intentId: "repair-intent", baseTimelineRef: "semantic_timeline.json", baseRevision: 0, baseContentHash: hash, explicitGoals: ["repair confirmed defect"], inferredConstraints: ["preserve evidence"], requestedOperations: ["trim"] });
  compileEditGraph(run, { graphId: "repair-graph", intentId: "repair-intent", baseTimelineRef: "semantic_timeline.json", baseRevision: 0, nodes: [{ nodeId: "repair-node", operation: "trim", dependsOn: [], inputArtifactRefs: ["delivery.video"], outputArtifactRefs: ["delivery.repaired"], affectedRanges: [range] }] });
  registerTimelinePatch(run, {
    patchId: "repair-patch", graphId: "repair-graph", timelineId: "repair", baseTimelineRef: "semantic_timeline.json", baseRevision: 0, baseContentHash: hash, targetRevision: 1,
    materialChanges: ["duration_change"],
    repairLineage: { reviewId: "review-1", reviewerEvidenceRef: "final_review_evidence/review-1.json", frameAuditRef: "frame_audit_report.json", repairPlanRef: "frame_audit_repair_plan.json", sourceMediaArtifactRef: "delivery.video", sourceMediaSha256: "media-sha", findingIds: ["frame-audit:1"] },
    operations: [{ operationId: "repair-op", nodeId: "repair-node", operation: "trim", clipId: "broken", path: "/tracks/v/clips/broken", value: { sourceRange: range, timelineRange: range }, affectedRanges: [range], evidenceRefs: ["final_review_evidence/review-1.json", "frame_evidence/frame-audit-1-trigger.png"], repairFindingIds: ["frame-audit:1"], reversible: true }]
  });
  const grant = createPatchPreview(run, { authorSessionId: "dx-editor" });
  commitTimelinePatch(run, { patchId: "repair-patch", previewId: grant.preview.previewId, previewToken: grant.previewToken, authorSessionId: "dx-editor", confirmedBy: "request_user_input", approvalNote: "Approved evidence-linked repair" });
  assert.equal(run.editSession.receipt.repairLineage.reviewId, "review-1");
  assert.deepEqual(run.editSession.revisions["repair:1"].repairLineage.findingIds, ["frame-audit:1"]);
});

test("applies canonical operations only when source, timeline, overlap, and caption bounds remain valid", () => {
  const timeline = {
    schemaVersion: "1.0", timelineId: "bounded", rate: { value: 1, rate: 30 }, tracks: [
      { trackId: "video", kind: "video", clips: [{ clipId: "video-1", mediaRef: "delivery.video", sourceRange: { start: { value: 0, rate: 30 }, duration: { value: 300, rate: 30 } }, timelineRange: { start: { value: 0, rate: 30 }, duration: { value: 300, rate: 30 } } }] },
      { trackId: "captions", kind: "caption", clips: [{ clipId: "caption-1", mediaRef: "caption:1", sourceRange: { start: { value: 0, rate: 30 }, duration: { value: 30, rate: 30 } }, timelineRange: { start: { value: 0, rate: 30 }, duration: { value: 30, rate: 30 } } }] }
    ]
  };
  assert.throws(() => applyTimelineOperations(timeline, [{ operation: "trim", clipId: "video-1", value: { sourceRange: { start: { value: 280, rate: 30 }, duration: { value: 30, rate: 30 } }, timelineRange: { start: { value: 0, rate: 30 }, duration: { value: 30, rate: 30 } } } }]), /source bounds/);
  assert.throws(() => applyTimelineOperations(timeline, [{ operation: "caption_shift", clipId: "caption-1", value: { timelineStart: { value: 290, rate: 30 } } }]), /caption-1.*edited video timeline/i);
  const valid = applyTimelineOperations(timeline, [{ operation: "trim", clipId: "video-1", value: { sourceRange: { start: { value: 30, rate: 30 }, duration: { value: 240, rate: 30 } }, timelineRange: { start: { value: 0, rate: 30 }, duration: { value: 240, rate: 30 } } } }]);
  assert.equal(valid.tracks[0].clips[0].sourceRange.start.value, 30);
  assert.equal(valid.tracks[0].clips[0].timelineRange.duration.value, 240);
});

test("applies bounded crop, duck, and adjacent transition effects", () => {
  const clip = (clipId, start) => ({ clipId, mediaRef: "delivery.video", sourceRange: { start: { value: start, rate: 30 }, duration: { value: 150, rate: 30 } }, timelineRange: { start: { value: start, rate: 30 }, duration: { value: 150, rate: 30 } }, effects: [] });
  const timeline = { schemaVersion: "1.0", timelineId: "effects", rate: { value: 1, rate: 30 }, tracks: [{ trackId: "video", kind: "video", clips: [clip("a", 0), clip("b", 150)] }] };
  const result = applyTimelineOperations(timeline, [
    { operation: "crop", clipId: "a", value: { x: .1, y: .1, width: .8, height: .8 } },
    { operation: "audio_duck", clipId: "a", value: { gainDb: -9, attackMs: 120, releaseMs: 240, range: { start: { value: 30, rate: 30 }, duration: { value: 60, rate: 30 } } } },
    { operation: "transition", clipId: "a", value: { transitionKind: "crossfade", duration: { value: 15, rate: 30 }, toClipId: "b" } }
  ]);
  assert.deepEqual(result.tracks[0].clips[0].effects.map((effect) => effect.kind), ["crop", "duck", "transition"]);
  const matchCut = applyTimelineOperations(timeline, [
    { operation: "transition", clipId: "a", value: { transitionKind: "match_cut", duration: { value: 1, rate: 30 }, toClipId: "b" } }
  ]);
  assert.equal(matchCut.tracks[0].clips[0].effects.at(-1).transitionKind, "match_cut");
  assert.throws(() => applyTimelineOperations(timeline, [{ operation: "crop", clipId: "a", value: { x: .8, y: 0, width: .4, height: 1 } }]), /normalized rectangle/);
  assert.throws(() => applyTimelineOperations(timeline, [{ operation: "transition", clipId: "a", value: { transitionKind: "crossfade", duration: { value: 15, rate: 30 }, toClipId: "missing" } }]), /immediately adjacent/);
  assert.throws(() => applyTimelineOperations(timeline, [{ operation: "audio_duck", clipId: "a", value: { gainDb: -9, attackMs: 120, releaseMs: 240, range: { start: { value: 140, rate: 30 }, duration: { value: 30, rate: 30 } } } }]), /inside the selected clip/);
});
