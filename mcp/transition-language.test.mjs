import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileTransitionLanguagePlan, writeTransitionLanguagePlan } from "./transition-language.mjs";

function base(overrides = {}) {
  return {
    planId: "transitions:demo",
    sequenceId: "sequence:demo",
    fps: 30,
    renderer: "remotion",
    shots: [
      {
        shotId: "S01",
        purpose: "建立动作",
        shotSize: "wide",
        durationSeconds: 4,
        sceneId: "lab",
        locationKey: "lab",
        timeKey: "night",
        screenDirection: "left_to_right",
        eyeTraceRegion: "center_right",
        motionVector: "right",
        actionKey: "reach_console",
        actionPhaseOut: "middle",
        energyOut: 0.75,
        subjectIds: ["hero"],
        audio: { dialogueAtEnd: true, ambienceKey: "lab_room" }
      },
      {
        shotId: "S02",
        purpose: "完成动作并揭示界面",
        shotSize: "close_up",
        durationSeconds: 3,
        sceneId: "lab",
        locationKey: "lab",
        timeKey: "night",
        screenDirection: "left_to_right",
        eyeTraceRegion: "center_right",
        motionVector: "right",
        actionKey: "reach_console",
        actionPhaseIn: "middle",
        actionPhaseOut: "complete",
        energyIn: 0.75,
        subjectIds: ["hero"],
        audio: { ambienceKey: "lab_room" }
      },
      {
        shotId: "S03",
        purpose: "进入次日城市",
        shotSize: "wide",
        durationSeconds: 5,
        sceneId: "city",
        locationKey: "shanghai",
        timeKey: "day",
        screenDirection: "left_to_right",
        motionVector: "right",
        energyIn: 0.4,
        subjectIds: [],
        audio: { dialogueAtStart: true, ambienceKey: "city" }
      }
    ],
    ...overrides
  };
}

test("compiles action continuation and chapter transitions from shot semantics", () => {
  const plan = compileTransitionLanguagePlan(base());
  assert.equal(plan.status, "ready");
  assert.equal(plan.boundaries[0].directorMethod, "match_action");
  assert.equal(plan.boundaries[0].renderKind, "match_cut");
  assert.equal(plan.boundaries[0].easing, "linear");
  assert.match(plan.boundaries[0].promptHandoff.incoming, /^继续/);
  assert.equal(plan.boundaries[0].audioBridge.kind, "l_cut");
  assert.equal(plan.boundaries[1].directorMethod, "dip_to_black");
  assert.equal(plan.boundaries[1].renderKind, "dip_to_black");
  assert.equal(plan.boundaries[1].easing, "ease_in_out");
  assert.equal(plan.metrics.boundaryCount, 2);
});

test("blocks an overridden match action when motion and action identity do not line up", () => {
  const input = base({
    shots: base().shots.map((shot) => shot.shotId === "S03" ? { ...shot, motionVector: "left" } : shot),
    overrides: [{
      fromShotId: "S02",
      toShotId: "S03",
      directorMethod: "match_action",
      rationale: "force test"
    }]
  });
  const plan = compileTransitionLanguagePlan(input);
  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockers.includes("S02->S03:match_action_key_missing"));
  assert.ok(plan.blockers.includes("S02->S03:match_action_motion_mismatch"));
});

test("requires shader transitions to use an enabled motion renderer", () => {
  const plan = compileTransitionLanguagePlan(base({
    renderer: "directorx-cut-ffmpeg",
    preferences: { allowShader: false },
    overrides: [{
      fromShotId: "S01",
      toShotId: "S02",
      directorMethod: "shader",
      rationale: "world switch"
    }]
  }));
  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockers.includes("S01->S02:shader_transition_not_available"));
});

test("writes internal JSON plus a user-facing Markdown transition document", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-transition-plan-"));
  const plan = compileTransitionLanguagePlan(base());
  const written = await writeTransitionLanguagePlan({ projectPath, runId: "run-1", plan });
  assert.equal(written.plan.artifactRef, "transition_language_plan.json");
  assert.equal(written.summary.artifactRef, "transition_language_plan.md");
  assert.match(await readFile(written.summary.path, "utf8"), /导演转场与镜头衔接/);
  assert.match(await readFile(written.summary.path, "utf8"), /match_action/);
});
