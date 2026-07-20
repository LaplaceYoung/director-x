import test from "node:test";
import assert from "node:assert/strict";
import { compileReferenceReplicationPlan } from "./reference-replication.mjs";

function run(rightsStatus = "reference_only") {
  return {
    references: [{
      referenceId: "ref-1",
      rightsStatus,
      clipArtifactRef: "reference:ref-1:video",
      receiptArtifactRef: "reference:ref-1:receipt",
      fullFrameManifestArtifactRef: "reference:ref-1:full-frame-manifest",
      frameIdentityArtifactRef: "reference_frame_identity.ref-1.jsonl",
      fullFrameCoverage: { passed: true, extractedFrameCount: 300 }
    }],
    decisions: [{ kind: "video_model", value: { providerId: "runway", modelId: "gen4.5" } }],
    audioResponsibilityPlan: { voice: { owner: "tts", providerId: "mosi.tts", modelId: "moss-tts" }, music: { owner: "licensed_asset", assetRef: "music:theme" }, ambienceAndSfx: { owner: "edit_sound_design" } }
  };
}

function input() {
  return {
    planId: "replicate-1",
    referenceId: "ref-1",
    reviewerId: "DX-Reference-Analyst",
    reuseAuthorized: false,
    target: { title: "Original brand film", durationSeconds: 10, aspectRatio: "16:9", platform: "website", objective: "adapt the pacing to a new brand" },
    analysis: {
      hook: { mechanism: "result-first contradiction", sourceRange: { startSeconds: 0, endSeconds: 2 }, evidenceFrameIndices: [0, 59] },
      beats: [
        { beatId: "B1", sourceRange: { startSeconds: 0, endSeconds: 5 }, function: "hook", camera: "controlled push", motion: "fast then settle", composition: "central product", audioEnergy: "rising pulse", evidenceFrameIndices: [0, 149] },
        { beatId: "B2", sourceRange: { startSeconds: 5, endSeconds: 10 }, function: "payoff", camera: "wide reveal", motion: "slow expansion", composition: "brand lockup", audioEnergy: "resolve", evidenceFrameIndices: [150, 299] }
      ]
    },
    adaptation: {
      transferablePatterns: ["two-beat acceleration and resolve"],
      mustChange: ["brand", "setting", "copy", "visual motif"],
      originalityRules: ["new subjects", "new composition", "new palette"]
    },
    shots: [
      { targetShotId: "S1", sourceBeatId: "B1", durationSeconds: 5, shotFunction: "hook", generationMode: "image_to_video", promptIntent: "new product emerges from real workflow", camera: "controlled push", continuityStrategy: "approved first/end frame", fallback: "motion graphics", originalityChanges: ["new product", "new environment"], referenceFrameIndices: [0, 149] },
      { targetShotId: "S2", sourceBeatId: "B2", durationSeconds: 5, shotFunction: "payoff", generationMode: "keyframes_to_video", promptIntent: "new brand resolves in a distinct visual world", camera: "wide reveal", continuityStrategy: "carry S1 final frame", fallback: "static end card", originalityChanges: ["new framing", "new typography"], referenceFrameIndices: [150, 299] }
    ]
  };
}

test("turns full-frame reference evidence into an executable, originality-safe recreation plan", () => {
  const state = run();
  const plan = compileReferenceReplicationPlan(state, input());
  assert.equal(plan.adaptationMode, "structure_and_directing_language_only");
  assert.equal(plan.execution.shots[0].providerId, "runway");
  assert.ok(plan.adaptation.blockedReuse.includes("source pixels and clips"));
  assert.ok(plan.execution.acquisitionAndAnalysisTools.some((item) => item.tool === "yt-dlp"));
  assert.equal(state.referenceReplicationPlans[plan.planId].execution.totalDurationSeconds, 10);
});

test("blocks unlicensed source-pixel reuse and incomplete full-frame evidence", () => {
  const sourceReuse = input();
  sourceReuse.reuseAuthorized = true;
  sourceReuse.shots[0].generationMode = "licensed_source_edit";
  assert.throws(() => compileReferenceReplicationPlan(run(), sourceReuse), /reuse rights/);
  const incomplete = run("licensed");
  incomplete.references[0].fullFrameCoverage.passed = false;
  assert.throws(() => compileReferenceReplicationPlan(incomplete, input()), /all-decoded-frame/);
});
