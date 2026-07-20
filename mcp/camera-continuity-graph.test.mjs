import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGenerationPlanUsesCameraContinuity,
  compileCameraContinuityPlan,
  reviewCameraReferences
} from "./camera-continuity-graph.mjs";

function fixture(overrides = {}) {
  return {
    graphId: "camera-graph-1",
    sequenceId: "sequence-1",
    maxParallelism: 4,
    maxReferencesPerFrame: 8,
    strictReferenceCoverage: true,
    providerEnvelope: {
      supportsFirstFrame: true,
      supportsLastFrame: true,
      supportsTransitionVideo: true,
      maxReferenceImages: 8
    },
    shots: [
      {
        shotId: "S01",
        requestId: "REQ-01",
        cameraId: "CAM-A",
        sceneId: "SCENE-1",
        durationSeconds: 5,
        variation: "medium",
        lastFramePolicy: "auto",
        firstFrameAssetRef: "frame:S01:first",
        lastFrameAssetRef: "frame:S01:last",
        targetDescription: "Alice enters the lab.",
        entityIds: ["alice"],
        environmentKeys: ["lab"],
        styleKeys: ["graphite"]
      },
      {
        shotId: "S02",
        requestId: "REQ-02",
        cameraId: "CAM-A",
        sceneId: "SCENE-1",
        durationSeconds: 5,
        variation: "small",
        lastFramePolicy: "auto",
        firstFrameAssetRef: "frame:S01:last",
        targetDescription: "Alice studies the display.",
        entityIds: ["alice"],
        environmentKeys: ["lab"],
        styleKeys: ["graphite"]
      },
      {
        shotId: "S03",
        requestId: "REQ-03",
        cameraId: "CAM-B",
        sceneId: "SCENE-1",
        durationSeconds: 5,
        variation: "large",
        lastFramePolicy: "required",
        parentShotId: "S01",
        parentFrameRole: "last",
        handoffStrategy: "transition_extract",
        firstFrameAssetRef: "frame:S03:first",
        lastFrameAssetRef: "frame:S03:last",
        targetDescription: "Reverse angle reveals Bob.",
        entityIds: ["bob"],
        environmentKeys: ["lab"],
        styleKeys: ["graphite"]
      }
    ],
    references: [
      {
        assetRef: "portrait:alice",
        kind: "character_portrait",
        entityIds: ["alice"],
        environmentKeys: [],
        styleKeys: ["graphite"],
        rightsStatus: "owned",
        qualityStatus: "passed",
        rightsEvidenceRef: "rights_ledger.json",
        qualityEvidenceRef: "asset_quality_audit.json"
      },
      {
        assetRef: "portrait:bob",
        kind: "character_portrait",
        entityIds: ["bob"],
        environmentKeys: [],
        styleKeys: ["graphite"],
        rightsStatus: "licensed",
        qualityStatus: "passed",
        rightsEvidenceRef: "rights_ledger.json",
        qualityEvidenceRef: "asset_quality_audit.json"
      },
      {
        assetRef: "scene:lab",
        kind: "scene_frame",
        cameraId: "CAM-A",
        sceneId: "SCENE-1",
        entityIds: [],
        environmentKeys: ["lab"],
        styleKeys: ["graphite"],
        rightsStatus: "generated",
        qualityStatus: "approved",
        rightsEvidenceRef: "rights_ledger.json",
        qualityEvidenceRef: "asset_quality_audit.json"
      },
      {
        assetRef: "future:leak",
        kind: "scene_frame",
        sourceShotId: "S03",
        cameraId: "CAM-B",
        sceneId: "SCENE-1",
        entityIds: ["bob"],
        environmentKeys: ["lab"],
        styleKeys: ["graphite"],
        rightsStatus: "owned",
        qualityStatus: "passed"
      },
      {
        assetRef: "bad:rights",
        kind: "scene_frame",
        entityIds: ["alice"],
        environmentKeys: ["lab"],
        styleKeys: ["graphite"],
        rightsStatus: "unknown",
        qualityStatus: "passed"
      }
    ],
    ...overrides
  };
}

function approveReferences(graph, referencePlan) {
  return reviewCameraReferences(graph, referencePlan, {
    graphId: graph.graphId,
    reviewerId: "DX-Reference-Analyst",
    reviews: referencePlan.targets.map((target) => ({
      targetId: target.targetId,
      selectedAssetRefs: target.recommendedAssetRefs,
      reason: "Multimodal comparison confirmed identity, composition, and scene continuity.",
      evidenceRefs: [`review-frame:${target.targetId}`]
    }))
  });
}

test("compiles multi-camera frame dependencies into parallel execution waves", () => {
  const { graph, referencePlan } = compileCameraContinuityPlan(fixture());
  assert.equal(graph.status, "awaiting_reference_review");
  assert.deepEqual(graph.cameras.map((camera) => camera.cameraId), ["CAM-A", "CAM-B"]);
  assert.equal(graph.shots.find((shot) => shot.shotId === "S02").handoffStrategy, "reuse");
  assert.ok(graph.edges.some((edge) => edge.source === "frame:S01:last" && edge.target === "frame:S02:first"));
  assert.ok(graph.edges.some((edge) => edge.source === "frame:S01:last" && edge.target === "frame:S03:first"));
  assert.ok(graph.executionWaves.some((wave) => wave.parallel && wave.taskNodeIds.includes("frame:S02:first") && wave.taskNodeIds.includes("frame:S03:first")));
  const firstTarget = referencePlan.targets.find((target) => target.targetId === "reference:S01:first");
  assert.ok(firstTarget.candidates.some((candidate) => candidate.assetRef === "portrait:alice"));
  assert.ok(!firstTarget.candidates.some((candidate) => candidate.assetRef === "future:leak"));
  assert.ok(!firstTarget.candidates.some((candidate) => candidate.assetRef === "bad:rights"));
});

test("requires DX multimodal review and retains forced continuity anchors", () => {
  const { graph, referencePlan } = compileCameraContinuityPlan(fixture());
  const target = referencePlan.targets.find((item) => item.targetId === "reference:S02:first");
  assert.deepEqual(target.forcedAssetRefs, ["frame:S01:last"]);
  assert.throws(() => reviewCameraReferences(graph, referencePlan, {
    graphId: graph.graphId,
    reviewerId: "DX-Visual-Designer",
    reviews: []
  }), /DX-Reference-Analyst/);
  const approved = approveReferences(graph, referencePlan);
  assert.equal(approved.graph.status, "ready");
  assert.equal(approved.referencePlan.status, "approved");
  assert.ok(approved.referencePlan.targets.every((item) => item.status === "approved"));
});

test("rejects future parents and silent provider continuity downgrades", () => {
  const futureParent = fixture();
  futureParent.shots[1].parentShotId = "S03";
  assert.throws(() => compileCameraContinuityPlan(futureParent), /earlier parent shot/);
  const unsupportedLastFrame = fixture({ providerEnvelope: { supportsFirstFrame: true, supportsLastFrame: false, supportsTransitionVideo: true, maxReferenceImages: 8 } });
  assert.throws(() => compileCameraContinuityPlan(unsupportedLastFrame), /does not support last frames/);
  const unsupportedTransition = fixture({ providerEnvelope: { supportsFirstFrame: true, supportsLastFrame: true, supportsTransitionVideo: false, maxReferenceImages: 8 } });
  assert.throws(() => compileCameraContinuityPlan(unsupportedTransition), /does not support transition video/);
});

test("binds an approved camera graph to every video generation request", () => {
  const compiled = compileCameraContinuityPlan(fixture());
  const { graph, referencePlan } = approveReferences(compiled.graph, compiled.referencePlan);
  const plan = {
    requests: graph.shots.map((shot) => ({
      requestId: shot.requestId,
      shotId: shot.shotId,
      mode: shot.lastFrameRequired ? "keyframes_to_video" : "image_to_video",
      inputAnchorAssets: [shot.firstFrameAssetRef],
      outputAnchorAssets: shot.lastFrameRequired ? [shot.lastFrameAssetRef] : [],
      cameraGraphNodeId: shot.taskNodeIds.clip,
      referenceTargetIds: shot.referenceTargetIds
    }))
  };
  const run = { cameraContinuityGraph: graph, cameraReferenceSelectionPlan: referencePlan };
  assert.doesNotThrow(() => assertGenerationPlanUsesCameraContinuity(run, plan));
  plan.requests[0].mode = "image_to_video";
  assert.throws(() => assertGenerationPlanUsesCameraContinuity(run, plan), /requires keyframes_to_video/);
});
