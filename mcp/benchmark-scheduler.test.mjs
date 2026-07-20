import test from "node:test";
import assert from "node:assert/strict";
import { cancelBenchmarkSchedule, claimBenchmarkJob, instantiateBenchmarkTemplate, planBenchmarkSchedule, updateBenchmarkJob } from "./benchmark-scheduler.mjs";

const fixture = { fixtureId: "f1", maxCost: 2 };
const state = () => ({ benchmarkSuites: { s1: { version: "1", fixtures: [fixture] } }, benchmarkTrials: [] });

test("plans deterministic complete schedules and requires recorded trials", () => {
  const run = state(), schedule = planBenchmarkSchedule(run, { scheduleId: "q1", suiteId: "s1", repeatsPerFixture: 3, baseSeed: 42, maxConcurrency: 1, maxTotalCost: 6 }); assert.equal(schedule.jobs.length, 3); assert.equal(new Set(schedule.jobs.map((job) => job.seed)).size, 3);
  const job = claimBenchmarkJob(run, { scheduleId: "q1" }); assert.throws(() => claimBenchmarkJob(run, { scheduleId: "q1" }), /concurrency/); assert.throws(() => updateBenchmarkJob(run, { scheduleId: "q1", jobId: job.jobId, status: "succeeded", trialId: "t1" }), /recorded fixture trial/);
  run.benchmarkTrials.push({ trialId: "t1", fixtureId: "f1" }); updateBenchmarkJob(run, { scheduleId: "q1", jobId: job.jobId, status: "succeeded", trialId: "t1" }); assert.equal(job.status, "succeeded");
});

test("enforces total budget and cancellation without killing running work", () => {
  const run = state(); assert.throws(() => planBenchmarkSchedule(run, { scheduleId: "x", suiteId: "s1", repeatsPerFixture: 3, baseSeed: 1, maxConcurrency: 1, maxTotalCost: 5 }), /maxTotalCost/);
  planBenchmarkSchedule(run, { scheduleId: "q", suiteId: "s1", repeatsPerFixture: 3, baseSeed: 1, maxConcurrency: 2, maxTotalCost: 6 }); claimBenchmarkJob(run, { scheduleId: "q" }); const schedule = cancelBenchmarkSchedule(run, { scheduleId: "q" }); assert.equal(schedule.status, "cancelling"); assert.equal(schedule.jobs.filter((job) => job.status === "cancelled").length, 2);
});

test("instantiates a rights-safe template from routed capabilities and registered inputs", () => {
  const capabilities = ["reference.temporal_ground", "video.trim_reorder", "review.compare"].map((id) => ({ id }));
  const run = { capabilityRoute: { capabilities }, artifacts: { clips: {}, brief: {} } };
  const suite = instantiateBenchmarkTemplate(run, { familyId: "sequencing", suiteId: "seq", version: "1", fixtureId: "seq-1", inputBindings: [{ slot: "candidate_clips", artifactRef: "clips", rightsStatus: "licensed", rightsEvidenceRef: "rights.json#clips" }, { slot: "sequence_brief", artifactRef: "brief", rightsStatus: "not_applicable" }], maxCost: 3, maxLatencyMs: 60000 });
  assert.deepEqual(suite.capabilityIds, capabilities.map((item) => item.id));
  assert.ok(suite.fixtures[0].programmaticChecks.includes("seq-1:timeline_clip_order"));
  assert.equal(suite.fixtures[0].expertRubric.reduce((sum, item) => sum + item.weight, 0), 1);
  assert.throws(() => instantiateBenchmarkTemplate({ ...run, artifacts: { clips: {}, brief: {} } }, { familyId: "sequencing", suiteId: "bad", version: "1", inputBindings: [{ slot: "candidate_clips", artifactRef: "clips", rightsStatus: "not_applicable" }, { slot: "sequence_brief", artifactRef: "brief", rightsStatus: "not_applicable" }], maxCost: 1, maxLatencyMs: 1 }), /rights-cleared/);
});

test("instantiates the camera-continuity benchmark with structural and expert gates", () => {
  const capabilityIds = ["storyboard.plan", "continuity.manage", "video.first_last_frame"];
  const run = { capabilityRoute: { capabilities: capabilityIds.map((id) => ({ id })) }, artifacts: { shotlist: {} } };
  const suite = instantiateBenchmarkTemplate(run, {
    familyId: "camera-continuity", suiteId: "camera", version: "1", fixtureId: "camera-1",
    inputBindings: [{ slot: "shotlist", artifactRef: "shotlist", rightsStatus: "not_applicable" }],
    maxCost: 0, maxLatencyMs: 1000
  });
  assert.deepEqual(suite.fixtures[0].programmaticChecks, ["camera-1:camera_graph_integrity", "camera-1:reference_plan_integrity"]);
  assert.deepEqual(suite.fixtures[0].expertRubric.map((item) => item.dimensionId), ["identity_reference_fit", "camera_handoff_logic", "parallel_execution_efficiency"]);
});

test("instantiates the four creative-production benchmark families", () => {
  const families = [
    {
      familyId: "creative-shot-sequence",
      capabilities: ["script.compose", "storyboard.plan", "continuity.manage", "video.transition", "review.compare"],
      inputs: ["script", "cinematic_references"],
      checks: ["cinematic_reference_binding", "shot_sequence_artistry", "transition_plan_integrity"]
    },
    {
      familyId: "creative-remotion-launch",
      capabilities: ["storyboard.plan", "video.transition", "audio.mix", "subtitle.compose", "delivery.render"],
      inputs: ["storyboard", "cinematic_references", "narration"],
      checks: ["cinematic_reference_binding", "render_creative_contract", "timeline_clip_order", "media_playable"]
    },
    {
      familyId: "creative-video-modes",
      capabilities: ["image.generate", "video.text_to_video", "video.image_to_video", "video.first_last_frame", "video.extend"],
      inputs: ["director_brief", "model_knowledge"],
      checks: ["visual_prompt_mode_coverage"]
    },
    {
      familyId: "creative-script-duration",
      capabilities: ["script.compose", "storyboard.plan"],
      inputs: ["creative_brief", "cinematic_references"],
      checks: ["cinematic_reference_binding", "script_duration_structure"]
    }
  ];

  for (const family of families) {
    const run = {
      capabilityRoute: { capabilities: family.capabilities.map((id) => ({ id })) },
      artifacts: Object.fromEntries(family.inputs.map((slot) => [slot, {}]))
    };
    const suite = instantiateBenchmarkTemplate(run, {
      familyId: family.familyId,
      suiteId: family.familyId,
      version: "1",
      fixtureId: `${family.familyId}-1`,
      inputBindings: family.inputs.map((slot) => ({ slot, artifactRef: slot, rightsStatus: "not_applicable" })),
      maxCost: 0,
      maxLatencyMs: 1000
    });
    assert.deepEqual(suite.fixtures[0].programmaticChecks, family.checks.map((check) => `${family.familyId}-1:${check}`));
    assert.equal(suite.fixtures[0].expertRubric.length, 4);
    assert.equal(suite.fixtures[0].expertRubric.reduce((sum, item) => sum + item.weight, 0), 1);
  }
});
