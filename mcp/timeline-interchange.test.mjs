import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashTimeline } from "./edit-graph.mjs";
import { createDirectorXTimelineInterchange, importDirectorXTimelineInterchange, writeDirectorXTimelineInterchange } from "./timeline-interchange.mjs";

function revision() {
  const timeline = { schemaVersion: "1.0", timelineId: "timeline:cut", rate: { value: 1, rate: 30 }, tracks: [{ trackId: "video-main", kind: "video", clips: [{ clipId: "clip-1", mediaRef: "delivery.video", sourceRange: { start: { value: 90, rate: 30 }, duration: { value: 150, rate: 30 } }, timelineRange: { start: { value: 300, rate: 30 }, duration: { value: 150, rate: 30 } }, effects: [{ kind: "gain", db: -3 }] }] }] };
  return { revisionId: "timeline:cut:2", timelineId: timeline.timelineId, revision: 2, parentRevisionId: "timeline:cut:1", contentHash: hashTimeline(timeline), timeline, createdAt: "2026-07-16T00:00:00.000Z" };
}

test("keeps source-media and parent-timeline ranges distinct through an independent JSON round trip", () => {
  const source = revision();
  const bundle = createDirectorXTimelineInterchange(source, { "delivery.video": { artifactRef: "delivery.video", path: "/workspace/final.mp4", relativePath: "final.mp4", mediaKind: "video", sha256: "sha256:abc" } }, "2026-07-16T00:01:00.000Z");
  const imported = importDirectorXTimelineInterchange(JSON.parse(JSON.stringify(bundle.document)));
  assert.equal(imported.timeline.tracks[0].clips[0].sourceRange.start.value, 90);
  assert.equal(imported.timeline.tracks[0].clips[0].timelineRange.start.value, 300);
  assert.equal(bundle.roundtrip.status, "passed");
  assert.equal(bundle.manifest.handoffReady, true);
  assert.equal(bundle.lossReport.status, "lossless");
});

test("writes the executable Director X interchange and its loss/round-trip evidence", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-interchange-"));
  try {
    const result = await writeDirectorXTimelineInterchange({ projectPath, runId: "dx-test", revision: revision(), artifacts: {} });
    assert.deepEqual(Object.keys(result.written).sort(), ["roundtrip_validation.json", "timeline_interchange.dx.json", "timeline_interchange_loss_report.json", "timeline_interchange_manifest.json"]);
    assert.equal(JSON.parse(await readFile(result.written["roundtrip_validation.json"].path, "utf8")).status, "passed");
    assert.equal(result.manifest.handoffReady, false);
    assert.deepEqual(result.manifest.unresolvedMediaRefs, ["delivery.video"]);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});
