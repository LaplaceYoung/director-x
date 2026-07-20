import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function writeLongformPlan({ projectPath, runId, plan }) {
  validateLongformPlan(plan);
  const root = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(root, { recursive: true });
  const documents = {
    "longform_segment_plan.json": { schemaVersion: "1.0", runId, createdAt: new Date().toISOString(), ...plan },
    "frame_handoff_manifest.json": {
      schemaVersion: "1.0", runId, longformId: plan.longformId,
      handoffs: plan.segments.slice(1).map((segment, index) => ({
        handoffId: `HANDOFF-${index + 1}`, fromSegmentId: plan.segments[index].segmentId, toSegmentId: segment.segmentId,
        sourceEndFrameAssetId: plan.segments[index].outputEndFrameAssetId, targetStartFrameAssetId: segment.inputStartFrameAssetId,
        matchPolicy: segment.handoff.matchPolicy, actionOverlapSeconds: segment.handoff.actionOverlapSeconds,
        cameraContinuity: segment.handoff.cameraContinuity, subjectContinuity: segment.handoff.subjectContinuity,
        environmentContinuity: segment.handoff.environmentContinuity, audioBridge: segment.handoff.audioBridge,
        acceptanceCriteria: segment.handoff.acceptanceCriteria
      }))
    }
  };
  const results = {};
  for (const [artifactRef, value] of Object.entries(documents)) {
    const path = join(root, artifactRef);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    results[artifactRef] = { artifactRef, path };
  }
  return results;
}

export async function writeLongformStitchPlan({ projectPath, runId, stitchPlan, run }) {
  validateLongformStitchPlan(stitchPlan, run.longformPlan);
  const root = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(root, { recursive: true });
  const value = { schemaVersion: "1.0", runId, createdAt: new Date().toISOString(), ...stitchPlan };
  const path = join(root, "longform_stitch_plan.json");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "longform_stitch_plan.json", path };
}

export function validateLongformPlan(plan) {
  if (!plan?.longformId || !Array.isArray(plan.segments) || plan.segments.length < 2) throw new Error("Long-form production requires at least two ordered segments.");
  const ids = new Set();
  plan.segments.forEach((segment, index) => {
    if (!segment.segmentId || ids.has(segment.segmentId)) throw new Error("Every long-form segment needs a unique segmentId.");
    ids.add(segment.segmentId);
    if (!(segment.durationSeconds > 0)) throw new Error(`${segment.segmentId} needs a positive durationSeconds.`);
    if (!segment.generationRequestId || !segment.outputEndFrameAssetId) throw new Error(`${segment.segmentId} needs generationRequestId and outputEndFrameAssetId.`);
    if (index === 0) {
      if (segment.previousSegmentId) throw new Error("The first segment cannot declare previousSegmentId.");
      return;
    }
    const previous = plan.segments[index - 1];
    if (segment.previousSegmentId !== previous.segmentId) throw new Error(`${segment.segmentId} must follow ${previous.segmentId}.`);
    if (segment.inputStartFrameAssetId !== previous.outputEndFrameAssetId) throw new Error(`${segment.segmentId} must use ${previous.segmentId}'s output end frame as its input start frame.`);
    if (!segment.handoff?.matchPolicy || !segment.handoff?.acceptanceCriteria?.length) throw new Error(`${segment.segmentId} needs an explicit frame handoff and acceptance criteria.`);
  });
}

export function validateLongformStitchPlan(stitchPlan, longformPlan) {
  if (!longformPlan) throw new Error("Register a long-form segment plan before the stitch plan.");
  if (!Array.isArray(stitchPlan?.clips) || stitchPlan.clips.length !== longformPlan.segments.length) throw new Error("The stitch plan must contain one selected clip for every segment.");
  const expected = longformPlan.segments.map((segment) => segment.segmentId);
  if (stitchPlan.clips.some((clip, index) => clip.segmentId !== expected[index] || !clip.candidateId || !clip.localPath)) throw new Error("Stitch clips must preserve segment order and identify real selected candidates and local paths.");
  if (!Array.isArray(stitchPlan.transitions) || stitchPlan.transitions.length !== expected.length - 1) throw new Error("The stitch plan needs exactly one transition decision per segment boundary.");
  for (const transition of stitchPlan.transitions) {
    if (!transition.fromSegmentId || !transition.toSegmentId || !transition.method || !transition.boundaryReview) throw new Error("Each stitch transition needs endpoints, method, and boundaryReview evidence.");
  }
}
