import test from "node:test";
import assert from "node:assert/strict";
import { createReviewSession, updateReviewTransport } from "./review-session.mjs";

test("creates one revisioned transport for media, comparison, and tracks", () => {
  const run = { artifacts: { "a.mp4": {}, "b.mp4": {} } };
  createReviewSession(run, { reviewSessionId: "review-1", activeArtifactRef: "a.mp4", activeRevisionId: "tl:2", projectRate: 30, compareMode: "ab", compareArtifactRefs: ["a.mp4", "b.mp4"], selectedAudioTrackIds: ["vo"], selectedCaptionTrackIds: ["zh"] });
  updateReviewTransport(run, { reviewSessionId: "review-1", expectedRevision: 1, playhead: { value: 75, rate: 30 }, playing: true, playbackRate: 1, direction: 1, loopRange: { start: { value: 60, rate: 30 }, duration: { value: 90, rate: 30 } } });
  assert.equal(run.reviewSession.revision, 2);
  assert.equal(run.reviewSession.transport.playhead.value, 75);
  assert.deepEqual(run.reviewSession.compareArtifactRefs, ["a.mp4", "b.mp4"]);
});

test("rejects stale transport writes", () => {
  const run = { artifacts: { "a.mp4": {} } };
  createReviewSession(run, { reviewSessionId: "review-1", activeArtifactRef: "a.mp4", activeRevisionId: "tl:1", projectRate: 24, compareMode: "single" });
  assert.throws(() => updateReviewTransport(run, { reviewSessionId: "review-1", expectedRevision: 0, playhead: { value: 0, rate: 24 }, playing: false, playbackRate: 1, direction: 1 }), /conflict/);
});
