import test from "node:test";
import assert from "node:assert/strict";
import { assertRenderQualityReady, compileRenderQualityContract } from "./render-quality-contract.mjs";

function readyInput(overrides = {}) {
  const input = {
    renderer: "remotion",
    durationSeconds: 30,
    intentionalOutroSeconds: 2,
    narration: { startSeconds: 0.4, endSeconds: 27.5, language: "zh", text: "让机器理解声音与影像，让每一次自然交互都更接近真实世界。这是一段用于验证节奏与字幕覆盖的宣传片旁白。" },
    captions: [
      { startSeconds: 0.4, endSeconds: 9.5, text: "让机器理解声音与影像" },
      { startSeconds: 9.5, endSeconds: 18.5, text: "让每一次自然交互更接近真实世界" },
      { startSeconds: 18.5, endSeconds: 27.5, text: "用于验证节奏与字幕覆盖" }
    ],
    visualClips: [
      { clipId: "S01", kind: "image", startSeconds: 0, endSeconds: 10 },
      { clipId: "S02", kind: "image", startSeconds: 9.4, endSeconds: 20 },
      { clipId: "S03", kind: "image", startSeconds: 19.4, endSeconds: 30 }
    ],
    transitions: [
      { fromClipId: "S01", toClipId: "S02", kind: "crossfade", durationSeconds: 0.6 },
      { fromClipId: "S02", toClipId: "S03", kind: "zoom_blur", durationSeconds: 0.6 }
    ],
    ...overrides
  };
  return input;
}

function directorBoundary(value) {
  return {
    rationale: "approved Director boundary",
    cutTrigger: "information_complete",
    actionOverlapSeconds: 0,
    easing: value.renderKind === "crossfade" ? "linear" : value.renderKind === "match_cut" || value.renderKind === "cut" ? "linear" : "ease_in_out",
    audioBridge: { kind: "none" },
    boundaryFrames: { outgoingRequired: false, incomingRequired: false, bridgeFrameRequired: false },
    rendererRecipe: { engine: "remotion", operation: value.renderKind, transition: value.renderKind },
    reviewCriteria: ["inspect before, trigger, and after frames"],
    ...value
  };
}

test("accepts covered narration, captions, and natural image-led transitions", () => {
  const contract = compileRenderQualityContract(readyInput());
  assert.equal(contract.status, "ready");
  assert.equal(contract.metrics.captionCoverage.passed, true);
  assert.equal(contract.metrics.transitionCoverage.coveredBoundaries, 2);
  assert.equal(assertRenderQualityReady({ renderQualityContract: contract }, "remotion"), contract);
});

test("blocks rushed narration, missing subtitle tail, and direct image cuts", () => {
  const contract = compileRenderQualityContract(readyInput({
    narration: { startSeconds: 0, endSeconds: 8, language: "zh", text: "这是一段非常长而且会因为持续加入大量信息导致每秒需要朗读很多汉字最终让用户根本听不清楚的宣传片旁白文本内容" },
    captions: [{ startSeconds: 0, endSeconds: 4, text: "字幕提前结束" }],
    transitions: [
      { fromClipId: "S01", toClipId: "S02", kind: "cut", durationSeconds: 0 },
      { fromClipId: "S02", toClipId: "S03", kind: "cut", durationSeconds: 0, rationale: "beat cut" }
    ]
  }));
  assert.equal(contract.status, "blocked");
  assert.ok(contract.blockers.some((item) => item.startsWith("narration_tail_gap")));
  assert.ok(contract.blockers.some((item) => item.startsWith("caption_tail_gap")));
  assert.ok(contract.blockers.some((item) => item.startsWith("direct_cut_without_rationale")));
  assert.ok(contract.blockers.some((item) => item.startsWith("image_led_direct_cut_ratio")));
});

test("requires the renderer used by the approved contract", () => {
  const contract = compileRenderQualityContract(readyInput());
  assert.throws(() => assertRenderQualityReady({ renderQualityContract: contract }, "hyperframes"), /targets remotion/);
});

test("binds every rendered boundary to the approved director transition plan", () => {
  const input = readyInput();
  const contract = compileRenderQualityContract({
    ...input,
    requireDirectorPlan: true,
    transitionLanguagePlan: {
      planId: "transitions:ready",
      status: "ready",
      fps: 30,
      boundaries: [
        directorBoundary({ fromShotId: "S01", toShotId: "S02", directorMethod: "cross_dissolve", renderKind: "crossfade", durationSeconds: 0.6 }),
        directorBoundary({ fromShotId: "S02", toShotId: "S03", directorMethod: "shader", renderKind: "zoom_blur", durationSeconds: 0.6 })
      ]
    },
    transitions: input.transitions.map((transition, index) => ({
      ...transition,
      directorMethod: index === 0 ? "cross_dissolve" : "shader",
      cutTrigger: "information_complete",
      easing: index === 0 ? "linear" : "ease_in_out",
      runtimeAdapterId: index === 0 ? undefined : "directorx.remotion.zoom-blur.v1"
    }))
  });
  assert.equal(contract.status, "ready");
  assert.equal(contract.metrics.transitionPlanBinding.boundBoundaries, 2);
});

test("blocks renderer drift from the approved director transition plan", () => {
  const input = readyInput();
  const contract = compileRenderQualityContract({
    ...input,
    requireDirectorPlan: true,
    transitionLanguagePlan: {
      planId: "transitions:drift",
      status: "ready",
      fps: 30,
      boundaries: [
        directorBoundary({ fromShotId: "S01", toShotId: "S02", directorMethod: "match_action", renderKind: "match_cut", durationSeconds: 0 }),
        directorBoundary({ fromShotId: "S02", toShotId: "S03", directorMethod: "cross_dissolve", renderKind: "crossfade", durationSeconds: 0.6 })
      ]
    }
  });
  assert.equal(contract.status, "blocked");
  assert.ok(contract.blockers.some((item) => item.startsWith("director_transition_kind_mismatch:S01->S02")));
});

test("binds timeline clip IDs to different storyboard shot IDs through boundary identity", () => {
  const input = readyInput({
    visualClips: [
      { clipId: "clip-a", kind: "video", startSeconds: 0, endSeconds: 15 },
      { clipId: "clip-b", kind: "video", startSeconds: 15, endSeconds: 30 }
    ],
    transitions: [{
      fromClipId: "clip-a",
      toClipId: "clip-b",
      transitionBoundaryId: "S10->S11",
      directorMethod: "match_action",
      cutTrigger: "information_complete",
      easing: "linear",
      kind: "match_cut",
      durationSeconds: 0,
      rationale: "action midpoint"
    }]
  });
  const contract = compileRenderQualityContract({
    ...input,
    requireDirectorPlan: true,
    transitionLanguagePlan: {
      planId: "transitions:clip-binding",
      status: "ready",
      fps: 30,
      boundaries: [{
        ...directorBoundary({
        boundaryId: "S10->S11",
        fromShotId: "S10",
        toShotId: "S11",
        directorMethod: "match_action",
        renderKind: "match_cut",
        durationSeconds: 0
        })
      }]
    }
  });
  assert.equal(contract.status, "ready");
  assert.equal(contract.metrics.transitionPlanBinding.boundBoundaries, 1);
});

test("blocks a renderer that differs from the approved transition plan", () => {
  const input = readyInput();
  const contract = compileRenderQualityContract({
    ...input,
    requireDirectorPlan: true,
    transitionLanguagePlan: {
      planId: "transitions:wrong-renderer",
      renderer: "hyperframes",
      status: "ready",
      fps: 30,
      boundaries: [
        directorBoundary({ fromShotId: "S01", toShotId: "S02", directorMethod: "cross_dissolve", renderKind: "crossfade", durationSeconds: 0.6 }),
        directorBoundary({ fromShotId: "S02", toShotId: "S03", directorMethod: "shader", renderKind: "zoom_blur", durationSeconds: 0.6 })
      ]
    }
  });
  assert.equal(contract.status, "blocked");
  assert.ok(contract.blockers.includes("transition_language_plan_renderer_mismatch:hyperframes!=remotion"));
});
