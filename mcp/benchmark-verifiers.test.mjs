import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeBenchmarkVerifiers } from "./benchmark-verifiers.mjs";

test("executes only declared built-in verifiers and persists evidence", async () => {
  const run = { benchmarkSuites: { s1: { version: "1", fixtures: [{ fixtureId: "f1", programmaticChecks: ["registered", "hash"] }] } }, artifacts: { "clip.mp4": { path: "/tmp/clip.mp4", sha256: "a".repeat(64) } } };
  const receipt = await executeBenchmarkVerifiers(run, { projectPath: "/tmp", suiteId: "s1", fixtureId: "f1", receiptId: "r1", checks: [{ checkId: "registered", verifierId: "artifact_registered", artifactRef: "clip.mp4" }, { checkId: "hash", verifierId: "sha256_registered", artifactRef: "clip.mp4" }] });
  assert.equal(receipt.status, "passed"); assert.equal(receipt.permissionBoundary, "builtin_verifiers_only"); assert.match(receipt.results[0].evidenceRefs[0], /benchmark_verifier_receipt/);
});

test("rejects arbitrary or undeclared verifier execution", async () => {
  const run = { benchmarkSuites: { s1: { version: "1", fixtures: [{ fixtureId: "f1", programmaticChecks: ["registered"] }] } }, artifacts: { a: { path: "/tmp/a" } } };
  await assert.rejects(() => executeBenchmarkVerifiers(run, { projectPath: "/tmp", suiteId: "s1", fixtureId: "f1", receiptId: "r", checks: [{ checkId: "registered", verifierId: "shell", artifactRef: "a" }] }), /unknown verifier/);
});

test("verifies timeline order, subtitle timing, and measured loudness from durable JSON", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-verifier-"));
  const timelinePath = join(projectPath, "timeline.json"), captionsPath = join(projectPath, "captions.json"), audioPath = join(projectPath, "audio.json");
  await writeFile(timelinePath, JSON.stringify({ tracks: [{ track_id: "v1", track_type: "video", clips: [{ clip_id: "A" }, { clip_id: "B" }] }] }));
  await writeFile(captionsPath, JSON.stringify({ cues: [{ range: { start: { value: 0, rate: 1000 }, duration: { value: 1500, rate: 1000 } } }, { range: { start: { value: 1400, rate: 1000 }, duration: { value: 1000, rate: 1000 } } }] }));
  await writeFile(audioPath, JSON.stringify({ analyses: [{ asset_id: "mix", integrated_loudness_lufs: -16.2, true_peak_dbtp: -1.3 }] }));
  const checks = [
    { checkId: "order", verifierId: "timeline_clip_order", artifactRef: "timeline", parameters: { trackType: "video", expectedClipIds: ["A", "B"] } },
    { checkId: "captions", verifierId: "subtitle_timing_integrity", artifactRef: "captions", parameters: { maxDurationSeconds: 10, maxOverlapSeconds: 0.2 } },
    { checkId: "loudness", verifierId: "audio_loudness_range", artifactRef: "audio", parameters: { assetId: "mix", minIntegratedLufs: -17, maxIntegratedLufs: -15, maxTruePeakDbtp: -1 } }
  ];
  const run = { benchmarkSuites: { s: { version: "1", fixtures: [{ fixtureId: "f", programmaticChecks: checks.map((item) => item.checkId) }] } }, artifacts: { timeline: { path: timelinePath }, captions: { path: captionsPath }, audio: { path: audioPath } } };
  const receipt = await executeBenchmarkVerifiers(run, { projectPath, suiteId: "s", fixtureId: "f", receiptId: "professional", checks });
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.results[1].observed.maximumOverlapSeconds, 0.1);
});

test("fails professional JSON checks closed on bad order and workspace escape", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-verifier-"));
  const path = join(projectPath, "timeline.json"); await writeFile(path, JSON.stringify({ tracks: [{ clips: [{ id: "B" }, { id: "A" }] }] }));
  const run = { benchmarkSuites: { s: { version: "1", fixtures: [{ fixtureId: "f", programmaticChecks: ["order"] }] } }, artifacts: { timeline: { path } } };
  const receipt = await executeBenchmarkVerifiers(run, { projectPath, suiteId: "s", fixtureId: "f", receiptId: "bad", checks: [{ checkId: "order", verifierId: "timeline_clip_order", artifactRef: "timeline", parameters: { expectedClipIds: ["A", "B"] } }] });
  assert.equal(receipt.status, "failed");
  run.artifacts.timeline.path = "/tmp/outside.json";
  const escaped = await executeBenchmarkVerifiers({ ...run, benchmarkVerifierReceipts: {} }, { projectPath, suiteId: "s", fixtureId: "f", receiptId: "escape", checks: [{ checkId: "order", verifierId: "timeline_clip_order", artifactRef: "timeline", parameters: { expectedClipIds: ["A", "B"] } }] });
  assert.equal(escaped.status, "failed");
  assert.match(escaped.results[0].observed.errorMessage, /inside the project/);
});

test("verifies camera graph topology and DX-approved eligible reference targets", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-camera-verifier-"));
  const graphPath = join(projectPath, "camera.json");
  const referencesPath = join(projectPath, "references.json");
  await writeFile(graphPath, JSON.stringify({
    status: "ready",
    cameras: [{ cameraId: "A" }, { cameraId: "B" }],
    shots: [
      { shotId: "S1", lastFrameRequired: true, lastFrameAssetRef: "f1-last", taskNodeIds: { firstFrame: "frame:S1:first", lastFrame: "frame:S1:last", clip: "clip:S1" } },
      { shotId: "S2", lastFrameRequired: false, taskNodeIds: { firstFrame: "frame:S2:first", lastFrame: null, clip: "clip:S2" } }
    ],
    nodes: [
      { nodeId: "frame:S1:first", dependsOn: [] },
      { nodeId: "frame:S1:last", dependsOn: ["frame:S1:first"] },
      { nodeId: "clip:S1", dependsOn: ["frame:S1:first", "frame:S1:last"] },
      { nodeId: "frame:S2:first", dependsOn: ["frame:S1:last"] },
      { nodeId: "clip:S2", dependsOn: ["frame:S2:first"] }
    ],
    executionWaves: [
      { wave: 1, taskNodeIds: ["frame:S1:first"] },
      { wave: 2, taskNodeIds: ["frame:S1:last"] },
      { wave: 3, taskNodeIds: ["clip:S1", "frame:S2:first"] },
      { wave: 4, taskNodeIds: ["clip:S2"] }
    ]
  }));
  await writeFile(referencesPath, JSON.stringify({
    status: "approved",
    maxReferencesPerFrame: 8,
    eligibilityPolicy: { rightsStatuses: ["owned", "generated"], qualityStatuses: ["passed"] },
    targets: [{
      targetId: "reference:S2:first", status: "approved", strictReferenceCoverage: true,
      forcedAssetRefs: ["f1-last"], selectedAssetRefs: ["f1-last", "portrait:bob"],
      candidates: [
        { assetRef: "f1-last", rightsStatus: "generated", qualityStatus: "passed" },
        { assetRef: "portrait:bob", rightsStatus: "owned", qualityStatus: "passed" }
      ],
      coverage: { missingEntityIds: [] },
      review: { reviewerId: "DX-Reference-Analyst", evidenceRefs: ["review:S2"] }
    }]
  }));
  const checks = [
    { checkId: "graph", verifierId: "camera_graph_integrity", artifactRef: "graph", parameters: { minimumShots: 2, minimumCameras: 2 } },
    { checkId: "refs", verifierId: "reference_plan_integrity", artifactRef: "refs" }
  ];
  const run = { benchmarkSuites: { s: { version: "1", fixtures: [{ fixtureId: "f", programmaticChecks: ["graph", "refs"] }] } }, artifacts: { graph: { path: graphPath }, refs: { path: referencesPath } } };
  const receipt = await executeBenchmarkVerifiers(run, { projectPath, suiteId: "s", fixtureId: "f", receiptId: "camera", checks });
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.results[0].observed.scheduledNodeCount, 5);
});

test("verifies cinematic references, shot artistry, transitions, Remotion, video modes, and duration variants", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-creative-verifier-"));
  const documents = {
    references: {
      status: "ready",
      selectedReferences: [{
        referenceId: "film-1",
        rights: { scope: "reference_only", deliveryReuseAllowed: false, localAnalysisRequiresConsent: true, blockedReuse: ["pixels"] }
      }],
      bindings: [
        { referenceId: "film-1", ruleId: "r1", instruction: "Use one proof event.", evidenceLocator: "official film", targets: ["shot_planning", "remotion_composition"] }
      ]
    },
    shotReview: {
      status: "ready",
      overallScore: 84,
      blockers: [],
      dimensions: { narrativeFunction: 88, coverage: 80, visualVariation: 82, continuity: 90, rhythm: 78, emotionalArc: 81, movementMotivation: 86 },
      shotContract: [{ shotId: "S1", function: "hook" }, { shotId: "S2", function: "proof" }, { shotId: "S3", function: "cta" }],
      metrics: { distinctShotSizes: 3, distinctMovements: 2, emotionalEnergyRange: 0.45, adjacencyRevisionCount: 0 }
    },
    transitions: {
      status: "ready",
      blockers: [],
      boundaries: [
        { boundaryId: "S1->S2", directorMethod: "match_action", renderKind: "match_cut", rationale: "Continue the product action.", cutTrigger: "impact", rendererRecipe: { kind: "match_cut" }, fallback: { renderKind: "cut" }, reviewCriteria: ["action phase"], audioBridge: { kind: "l_cut" } },
        { boundaryId: "S2->S3", directorMethod: "graphic_match", renderKind: "match_cut", rationale: "Resolve the proof shape into the mark.", cutTrigger: "shape alignment", rendererRecipe: { kind: "match_cut" }, fallback: { renderKind: "crossfade" }, reviewCriteria: ["shape alignment"], audioBridge: { kind: "music_hit" } }
      ]
    },
    renderContract: {
      status: "ready",
      renderer: "remotion",
      blockers: [],
      metrics: {
        captionCoverage: { passed: true, coverageRatio: 0.99 },
        transitionCoverage: { passed: true, boundaries: 2, directCutRatio: 0 },
        transitionPlanBinding: { passed: true }
      }
    },
    promptPack: {
      status: "ready",
      modalityIsolation: true,
      routes: [
        { routeId: "t2v", mode: "text_to_video" },
        { routeId: "i2v", mode: "image_to_video" },
        { routeId: "flf", mode: "first_last_frame_video" },
        { routeId: "ext", mode: "video_extension" }
      ],
      prompts: [
        { shotId: "S1", routeId: "t2v", mode: "text_to_video", positivePrompt: "A visible action.", referenceInputs: {}, repairTargets: ["motion"] },
        { shotId: "S2", routeId: "i2v", mode: "image_to_video", positivePrompt: "Animate the product.", referenceInputs: { firstFrameRef: "f1" }, repairTargets: ["motion"] },
        { shotId: "S3", routeId: "flf", mode: "first_last_frame_video", positivePrompt: "Move continuously.", referenceInputs: { firstFrameRef: "f2", lastFrameRef: "f3" }, repairTargets: ["motion"] },
        { shotId: "S4", routeId: "ext", mode: "video_extension", positivePrompt: "Continue from the registered tail frame.", referenceInputs: { firstFrameRef: "f3" }, repairTargets: ["motion"] }
      ]
    },
    scripts: {
      status: "ready",
      variants: [15, 30, 60].map((duration) => {
        const beatCount = duration === 15 ? 3 : duration === 30 ? 4 : 6;
        return {
          durationSeconds: duration,
          propositionId: "one-promise",
          proofEvent: "The product visibly completes the task.",
          cta: "Try it.",
          beats: Array.from({ length: beatCount }, (_, index) => ({
            function: index === 0 ? "hook" : index === beatCount - 1 ? "cta" : "proof",
            visibleAction: `action-${duration}-${index}`,
            durationSeconds: duration / beatCount
          }))
        };
      })
    }
  };
  const artifacts = {};
  for (const [artifactRef, document] of Object.entries(documents)) {
    const path = join(projectPath, `${artifactRef}.json`);
    await writeFile(path, JSON.stringify(document));
    artifacts[artifactRef] = { path };
  }
  const checks = [
    { checkId: "references", verifierId: "cinematic_reference_binding", artifactRef: "references", parameters: { requiredTargets: ["shot_planning", "remotion_composition"] } },
    { checkId: "shots", verifierId: "shot_sequence_artistry", artifactRef: "shotReview" },
    { checkId: "transitions", verifierId: "transition_plan_integrity", artifactRef: "transitions", parameters: { expectedBoundaryCount: 2, minimumAudioBridges: 1 } },
    { checkId: "render", verifierId: "render_creative_contract", artifactRef: "renderContract", parameters: { requireDirectorPlan: true } },
    { checkId: "modes", verifierId: "visual_prompt_mode_coverage", artifactRef: "promptPack" },
    { checkId: "scripts", verifierId: "script_duration_structure", artifactRef: "scripts" }
  ];
  const run = {
    benchmarkSuites: { creative: { version: "1", fixtures: [{ fixtureId: "creative-1", programmaticChecks: checks.map((item) => item.checkId) }] } },
    artifacts
  };
  const receipt = await executeBenchmarkVerifiers(run, { projectPath, suiteId: "creative", fixtureId: "creative-1", receiptId: "creative-pass", checks });
  assert.equal(receipt.status, "passed");
  assert.ok(receipt.results.every((result) => result.passed));
});

test("fails creative verification on cosmetic references, flat shots, direct cuts, and mode leakage", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-creative-fail-"));
  const path = join(projectPath, "bad.json");
  await writeFile(path, JSON.stringify({
    status: "ready",
    modalityIsolation: false,
    routes: [{ routeId: "one", mode: "text_to_video" }],
    prompts: [{ shotId: "S1", routeId: "one", mode: "image_to_video", positivePrompt: "cinematic", referenceInputs: {}, repairTargets: [] }]
  }));
  const run = {
    benchmarkSuites: { creative: { version: "1", fixtures: [{ fixtureId: "bad", programmaticChecks: ["modes"] }] } },
    artifacts: { bad: { path } }
  };
  const receipt = await executeBenchmarkVerifiers(run, {
    projectPath,
    suiteId: "creative",
    fixtureId: "bad",
    receiptId: "creative-fail",
    checks: [{ checkId: "modes", verifierId: "visual_prompt_mode_coverage", artifactRef: "bad" }]
  });
  assert.equal(receipt.status, "failed");
  assert.ok(receipt.results[0].observed.missingModes.includes("video_extension"));
  assert.ok(receipt.results[0].observed.invalidPrompts.length > 0);
});
