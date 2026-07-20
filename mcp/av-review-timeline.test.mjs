import test from "node:test";
import assert from "node:assert/strict";
import { registerAvReviewTimeline } from "./av-review-timeline.mjs";

test("registers synchronized shot, subtitle, waveform and evidence tracks", () => {
  const run = {};
  const rt = (value, rate = 1000) => ({ value, rate });
  registerAvReviewTimeline(run, { timelineId: "tl-1", revisionId: "rev-1", mediaArtifactRef: "delivery.video", projectRate: rt(30000, 1001), duration: rt(10000), shots: [{ id: "s1", range: { start: rt(0), duration: rt(5000) }, label: "opening" }], subtitles: [{ id: "sub1", range: { start: rt(1000), duration: rt(2000) }, text: "hello" }], audioTracks: [{ id: "a1", role: "mix", waveformWindow: { range: { start: rt(0), duration: rt(10000) }, level: 1, samplesPerPoint: 4096, pixelWidth: 800, peaks: [-1, 0, .5, 1] } }], markers: [{ id: "m1", range: { start: rt(2000), duration: rt(100) }, kind: "defect", label: "jitter", evidenceRefs: ["frame-002.jpg"], severity: "major" }] });
  assert.equal(run.avReviewTimeline.durationSeconds, 10);
  assert.throws(() => registerAvReviewTimeline({}, { timelineId: "bad", revisionId: "r", mediaArtifactRef: "x", projectRate: rt(30, 1), duration: rt(2000), shots: [], subtitles: [], audioTracks: [], markers: [{ id: "m", range: { start: rt(3000), duration: rt(1) }, kind: "defect", label: "x", evidenceRefs: ["f"] }] }), /range/);
});
