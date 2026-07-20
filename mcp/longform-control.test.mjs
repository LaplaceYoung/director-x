import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateLongformPlan, validateLongformStitchPlan, writeLongformPlan } from "./longform-control.mjs";

const handoff = { matchPolicy: "exact_end_frame", actionOverlapSeconds: 0.4, cameraContinuity: "continue push-in", subjectContinuity: "same subject pose and wardrobe", environmentContinuity: "same light direction", audioBridge: "J-cut ambience", acceptanceCriteria: ["edge similarity passes", "motion vector continues"] };
const plan = { longformId: "film-01", targetDurationSeconds: 24, continuityStrategy: "approved end frame seeds next segment", segments: [
  { segmentId: "seg-01", generationRequestId: "req-01", durationSeconds: 8, outputEndFrameAssetId: "frame-01-end", storyBeat: "arrival" },
  { segmentId: "seg-02", previousSegmentId: "seg-01", generationRequestId: "req-02", durationSeconds: 8, inputStartFrameAssetId: "frame-01-end", outputEndFrameAssetId: "frame-02-end", storyBeat: "reveal", handoff },
  { segmentId: "seg-03", previousSegmentId: "seg-02", generationRequestId: "req-03", durationSeconds: 8, inputStartFrameAssetId: "frame-02-end", outputEndFrameAssetId: "frame-03-end", storyBeat: "payoff", handoff }
] };

test("writes an auditable first/last-frame handoff chain", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-longform-"));
  try {
    const results = await writeLongformPlan({ projectPath, runId: "dx-longform", plan });
    const manifest = JSON.parse(await readFile(results["frame_handoff_manifest.json"].path, "utf8"));
    assert.equal(manifest.handoffs.length, 2);
    assert.equal(manifest.handoffs[0].sourceEndFrameAssetId, manifest.handoffs[0].targetStartFrameAssetId);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("rejects broken frame chains and incomplete stitch decisions", () => {
  const broken = structuredClone(plan);
  broken.segments[1].inputStartFrameAssetId = "unrelated-frame";
  assert.throws(() => validateLongformPlan(broken), /must use seg-01's output end frame/);
  assert.throws(() => validateLongformStitchPlan({ clips: [], transitions: [] }, plan), /one selected clip/);
  assert.doesNotThrow(() => validateLongformStitchPlan({ clips: plan.segments.map((segment, index) => ({ segmentId: segment.segmentId, candidateId: `can-${index}`, localPath: `clips/${index}.mp4` })), transitions: [{ fromSegmentId: "seg-01", toSegmentId: "seg-02", method: "match_cut", boundaryReview: "pass" }, { fromSegmentId: "seg-02", toSegmentId: "seg-03", method: "action_overlap", boundaryReview: "pass" }] }, plan));
});
