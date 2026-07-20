import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindSceneCoveragePlanToShotlist, compileSceneCoveragePlan, writeSceneCoveragePlan } from "./scene-coverage-plan.mjs";

function base(overrides = {}) {
  const shots = [
    shot({ shotId: "S01", order: 1, coverageRole: "geography", durationSeconds: 3, lensMm: 24, cameraDistanceMeters: 8, blocking: [] }),
    shot({ shotId: "S02", order: 2, coverageRole: "primary_action", durationSeconds: 3, lensMm: 40, cameraDistanceMeters: 3.5 }),
    shot({ shotId: "S03", order: 3, coverageRole: "proof", durationSeconds: 2, lensMm: 65, cameraDistanceMeters: 1.8 }),
    shot({ shotId: "S04", order: 4, coverageRole: "reaction", durationSeconds: 2, lensMm: 85, cameraDistanceMeters: 1.4 })
  ];
  return {
    planId: "coverage-1",
    sequenceId: "sequence-1",
    targetDurationSeconds: 10,
    qualityThreshold: 70,
    scenes: [{ sceneId: "lab", purpose: "产品演示", axisId: "hero-product", axisType: "product_demo", defaultScreenDirection: "left_to_right", requiresGeography: true, requiresAction: true, requiresReaction: true, requiresProof: true, primarySubjectIds: ["hero", "product"] }],
    shots,
    ...overrides
  };
}

function shot(overrides = {}) {
  const shotId = overrides.shotId ?? "S01";
  return {
    shotId,
    order: overrides.order ?? 1,
    sceneId: "lab",
    beatId: "proof",
    purpose: `${shotId} purpose`,
    coverageRole: overrides.coverageRole ?? "primary_action",
    durationSeconds: overrides.durationSeconds ?? 2,
    mediaMode: "generated_video",
    shotSize: overrides.coverageRole === "geography" ? "wide" : "medium",
    lensMm: overrides.lensMm ?? 50,
    lensIntent: overrides.coverageRole === "geography" ? "spatial" : "natural",
    cameraSide: "axis_a",
    cameraHeight: "eye",
    cameraAzimuthDegrees: overrides.cameraAzimuthDegrees ?? (overrides.order ?? 1) * 35,
    cameraDistanceMeters: overrides.cameraDistanceMeters ?? 2.5,
    movement: "dolly_in",
    movementMotivation: "跟随动作揭示产品反馈",
    blocking: overrides.blocking ?? [{ subjectId: "hero", startRegion: "left", endRegion: "center", facing: "camera_right", screenDirection: "left_to_right", actionKey: "activate", actionPhaseIn: "setup", actionPhaseOut: "impact", motivation: "靠近产品以触发并确认结果" }],
    composition: { foreground: "console edge", midground: "hero and product", background: "lab practicals", leadRoom: 0.45, headroom: 0.35, negativeSpace: 0.25, negativeSpacePurpose: "text", focusStrategy: "subject_isolation" },
    lighting: { keyDirection: "front_left", colorTemperatureK: 4800, contrastRatio: 4 },
    handles: { headSeconds: 0.5, tailSeconds: 0.5 },
    transitionCritical: true,
    ...overrides
  };
}

test("compiles complete scene coverage, setup groups, and execution waves", () => {
  const plan = compileSceneCoveragePlan(base());
  assert.equal(plan.status, "ready");
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.scenes[0].coverageMatrix.geography, true);
  assert.equal(plan.scenes[0].coverageMatrix.proof, true);
  assert.ok(plan.setupGroups.length >= 3);
  assert.equal(plan.executionWaves.length, 1);
});

test("blocks missing proof, action blocking, handles, and unexplained light changes", () => {
  const input = base({
    shots: [
      shot({ shotId: "S01", order: 1, coverageRole: "geography", durationSeconds: 4, blocking: [] }),
      shot({ shotId: "S02", order: 2, coverageRole: "primary_action", durationSeconds: 6, blocking: [], handles: { headSeconds: 0.1, tailSeconds: 0.1 }, lighting: { keyDirection: "side_right", colorTemperatureK: 7000, contrastRatio: 4 } })
    ]
  });
  const plan = compileSceneCoveragePlan(input);
  assert.equal(plan.status, "revision_required");
  assert.ok(plan.blockers.some((item) => item.code === "scene_proof_coverage_missing"));
  assert.ok(plan.blockers.some((item) => item.code === "scene_reaction_coverage_missing"));
  assert.ok(plan.blockers.some((item) => item.code === "action_blocking_missing"));
  assert.ok(plan.blockers.some((item) => item.code === "generated_video_handles_insufficient"));
  assert.ok(plan.blockers.some((item) => item.code === "key_light_direction_break"));
});

test("warns when focal length, distance, and similar shot scale cannot all hold", () => {
  const input = base({
    scenes: [{ sceneId: "lab", purpose: "空间测试", axisId: "hero-axis", axisType: "eyeline", defaultScreenDirection: "left_to_right", requiresGeography: false, primarySubjectIds: ["hero"] }],
    targetDurationSeconds: 4,
    shots: [
      shot({ shotId: "S01", order: 1, coverageRole: "hero", durationSeconds: 2, lensMm: 24, cameraDistanceMeters: 2.5 }),
      shot({ shotId: "S02", order: 2, coverageRole: "reaction", durationSeconds: 2, lensMm: 85, cameraDistanceMeters: 2.7 })
    ]
  });
  const plan = compileSceneCoveragePlan(input);
  assert.ok(plan.warnings.some((item) => item.code === "lens_distance_contract_inconsistent"));
});

test("binds the plan to the real shotlist and blocks drift", () => {
  const plan = compileSceneCoveragePlan(base());
  const matching = base().shots.map((item) => ({ shot_id: item.shotId, purpose: item.purpose, duration_seconds: item.durationSeconds }));
  const bound = bindSceneCoveragePlanToShotlist(plan, { sha256: "a".repeat(64), shotlist: { shots: matching } });
  assert.equal(bound.status, "ready");
  const drifted = bindSceneCoveragePlanToShotlist(plan, { sha256: "b".repeat(64), shotlist: { shots: [matching[1], matching[0], matching[2], matching[3]] } });
  assert.equal(drifted.status, "revision_required");
  assert.ok(drifted.blockers.some((item) => item.code === "coverage_shot_order_mismatch"));
});

test("writes the internal plan and user-facing coverage summary", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-scene-coverage-"));
  const plan = compileSceneCoveragePlan(base());
  const written = await writeSceneCoveragePlan({ projectPath, runId: "run-1", plan });
  const markdown = await readFile(written.summary.path, "utf8");
  assert.equal(written.plan.artifactRef, "scene_coverage_plan.json");
  assert.match(markdown, /场景覆盖与摄影执行方案/);
  assert.match(markdown, /摄影设置与并行执行/);
});
