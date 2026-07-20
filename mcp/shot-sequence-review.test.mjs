import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindShotSequenceReviewToShotlist, reviewShotSequence, writeShotSequenceReview } from "./shot-sequence-review.mjs";

function base(overrides = {}) {
  const shots = [
    {
      shotId: "S01",
      order: 1,
      beatId: "hook",
      sceneId: "lab",
      purpose: "建立空间和问题",
      function: "hook",
      durationSeconds: 3,
      shotSize: "wide",
      movement: "dolly_in",
      movementMotivation: "从环境进入人物困境并锁定注意力",
      screenDirection: "left_to_right",
      eyelineDirection: "camera_right",
      primarySubjectId: "hero",
      subjectIds: ["hero"],
      actionKey: "activate",
      actionPhase: "setup",
      emotionalEnergy: 0.4,
      informationLoad: 0.45,
      captionUnits: 8,
      cameraAngleDegrees: 0,
      establishesSpace: true
    },
    {
      shotId: "S02",
      order: 2,
      beatId: "proof",
      sceneId: "lab",
      purpose: "动作中点揭示产品响应",
      function: "proof",
      durationSeconds: 2,
      shotSize: "medium_close",
      movement: "track",
      movementMotivation: "跟随手部动作揭示产品反馈",
      screenDirection: "left_to_right",
      eyelineDirection: "camera_right",
      primarySubjectId: "hero",
      subjectIds: ["hero", "product"],
      actionKey: "activate",
      actionPhase: "midpoint",
      emotionalEnergy: 0.75,
      informationLoad: 0.7,
      captionUnits: 8,
      cameraAngleDegrees: 35
    },
    {
      shotId: "S03",
      order: 3,
      beatId: "payoff",
      sceneId: "lab",
      purpose: "结果与人物反应",
      function: "reaction",
      durationSeconds: 3,
      shotSize: "close",
      movement: "locked",
      movementMotivation: "",
      screenDirection: "left_to_right",
      eyelineDirection: "camera_right",
      primarySubjectId: "hero",
      subjectIds: ["hero"],
      actionKey: "activate",
      actionPhase: "reaction",
      emotionalEnergy: 0.62,
      informationLoad: 0.35,
      captionUnits: 6,
      cameraAngleDegrees: 70
    }
  ];
  return {
    reviewId: "review-1",
    sequenceId: "sequence-1",
    targetDurationSeconds: 8,
    qualityThreshold: 65,
    requireProof: true,
    shots,
    ...overrides
  };
}

function transitionPlan(shots = base().shots) {
  return {
    sequenceId: "sequence-1",
    status: "ready",
    shotOrder: shots.map((shot) => shot.shotId),
    boundaries: shots.slice(0, -1).map((shot, index) => ({
      boundaryId: `${shot.shotId}->${shots[index + 1].shotId}`,
      directorMethod: "match_action",
      renderKind: "match_cut"
    }))
  };
}

test("accepts a motivated, continuous sequence and exposes director scores", () => {
  const review = reviewShotSequence(base(), transitionPlan());
  assert.equal(review.status, "ready");
  assert.equal(review.blockers.length, 0);
  assert.equal(review.shotOrder.join(","), "S01,S02,S03");
  assert.ok(review.overallScore >= 65);
  assert.equal(review.adjacency.length, 2);
  assert.ok(review.knowledgeBasis.every((item) => item.sourceUrl.startsWith("https://")));
});

test("blocks unmotivated movement, action regression, direction reversal, and duration drift", () => {
  const input = base({
    targetDurationSeconds: 12,
    shots: base().shots.map((shot) => shot.shotId === "S02"
      ? {
          ...shot,
          movementMotivation: "",
          screenDirection: "right_to_left",
          actionPhase: "idle"
        }
      : shot)
  });
  const review = reviewShotSequence(input, transitionPlan(input.shots));
  assert.equal(review.status, "revision_required");
  assert.ok(review.blockers.some((item) => item.code === "sequence_duration_mismatch"));
  assert.ok(review.blockers.some((item) => item.code === "unmotivated_camera_movement"));
  assert.ok(review.blockers.some((item) => item.code === "screen_direction_break"));
  assert.ok(review.blockers.some((item) => item.code === "action_phase_regression"));
  assert.ok(review.repairs.some((item) => item.priority === "blocker"));
});

test("allows an evidence-backed intentional axis break while keeping it visible as a warning", () => {
  const input = base({
    shots: base().shots.map((shot) => ["S02", "S03"].includes(shot.shotId) ? { ...shot, screenDirection: "right_to_left" } : shot),
    intentionalExceptions: [{
      ruleId: "screen_direction_break",
      shotIds: ["S01", "S02"],
      reason: "在认知失衡瞬间故意翻转空间关系",
      evidenceRefs: ["Director.md#axis-break"]
    }]
  });
  const review = reviewShotSequence(input, transitionPlan(input.shots));
  assert.equal(review.blockers.some((item) => item.code === "screen_direction_break"), false);
  assert.ok(review.warnings.some((item) => item.code === "screen_direction_break_intentional"));
});

test("requires a ready transition plan with the same shot order", () => {
  const review = reviewShotSequence(base(), null);
  assert.equal(review.status, "revision_required");
  assert.ok(review.blockers.some((item) => item.code === "transition_language_plan_missing"));
});

test("binds the review to the verified real shotlist artifact", () => {
  const review = reviewShotSequence(base(), transitionPlan());
  const bound = bindShotSequenceReviewToShotlist(review, {
    sha256: "a".repeat(64),
    shotlist: {
      target_duration_seconds: 8,
      shots: base().shots.map((shot) => ({
        shot_id: shot.shotId,
        purpose: shot.purpose,
        duration_seconds: shot.durationSeconds
      }))
    }
  });
  assert.equal(bound.status, "ready");
  assert.equal(bound.sourceBinding.status, "ready");
  assert.equal(bound.sourceBinding.sha256, "a".repeat(64));
});

test("blocks review parameters that drift from the registered shotlist", () => {
  const review = reviewShotSequence(base(), transitionPlan());
  const shotlistShots = base().shots.map((shot) => ({
    shot_id: shot.shotId,
    purpose: shot.shotId === "S02" ? "另一套临时目的" : shot.purpose,
    duration_seconds: shot.shotId === "S03" ? 4 : shot.durationSeconds
  }));
  const bound = bindShotSequenceReviewToShotlist(review, {
    sha256: "b".repeat(64),
    shotlist: { target_duration_seconds: 9, shots: [shotlistShots[1], shotlistShots[0], shotlistShots[2]] }
  });
  assert.equal(bound.status, "revision_required");
  assert.equal(bound.sourceBinding.status, "revision_required");
  assert.ok(bound.blockers.some((item) => item.code === "shotlist_order_mismatch"));
  assert.ok(bound.blockers.some((item) => item.code === "shotlist_purpose_drift"));
  assert.ok(bound.blockers.some((item) => item.code === "shotlist_duration_drift"));
  assert.ok(bound.blockers.some((item) => item.code === "shotlist_target_duration_drift"));
});

test("writes internal JSON and a user-facing Markdown review", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-shot-sequence-"));
  const review = reviewShotSequence(base(), transitionPlan());
  const written = await writeShotSequenceReview({ projectPath, runId: "run-1", review });
  assert.equal(written.review.artifactRef, "shot_sequence_review.json");
  assert.equal(written.summary.artifactRef, "shot_sequence_review.md");
  const markdown = await readFile(written.summary.path, "utf8");
  assert.match(markdown, /导演级镜头序列审查/);
  assert.match(markdown, /镜头情绪曲线/);
  assert.match(markdown, /方法依据/);
});
