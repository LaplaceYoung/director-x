import test from "node:test";
import assert from "node:assert/strict";
import { CORE_PIPELINE_STAGES, createPipelineRunState, getPipeline, missingRegisteredArtifacts, PIPELINE_CATALOG, transitionPipelineStage } from "./pipeline-catalog.mjs";

test("ships complete production pipelines with stable stage contracts", () => {
  assert.equal(PIPELINE_CATALOG.length, 9);
  assert.deepEqual(CORE_PIPELINE_STAGES.map((stage) => stage.id), ["intake", "research", "script", "storyboard", "generation", "edit", "review", "delivery"]);
  assert.deepEqual(getPipeline("brand-film").stages.find((stage) => stage.id === "generation").approvalKinds, ["image_model", "video_model", "voice_model", "music_strategy"]);
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "generation").requiredOutputs.includes("audio_responsibility_plan.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "intake").deferredOutputs.includes("execution_graph.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "intake").deferredOutputs.includes("parallel_subagent_plan.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "research").requiredOutputs.includes("visual_asset_coverage.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "storyboard").requiredOutputs.includes("scene_coverage_plan.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "storyboard").requiredOutputs.includes("transition_language_plan.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "storyboard").requiredOutputs.includes("shot_sequence_review.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "storyboard").requiredOutputs.includes("shot_grounding_plan.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "storyboard").requiredOutputs.includes("shot_grounding_report.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "review").requiredOutputs.includes("scene_coverage_conformance_report.json"));
  assert.ok(getPipeline("longform").stages.find((stage) => stage.id === "storyboard").requiredOutputs.includes("frame_handoff_manifest.json"));
  assert.ok(getPipeline("longform").stages.find((stage) => stage.id === "edit").requiredOutputs.includes("longform_stitch_plan.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "edit").requiredOutputs.includes("edit_intent.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "edit").requiredOutputs.includes("edit_graph.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "edit").requiredOutputs.includes("timeline_patch.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "edit").requiredOutputs.includes("edit_receipt.json"));
  assert.ok(getPipeline("brand-film").stages.find((stage) => stage.id === "edit").requiredOutputs.includes("timeline_revision.json"));
  assert.ok(getPipeline("reference-remix").stages.find((stage) => stage.id === "research").requiredOutputs.includes("evidence_bundle.json"));
  assert.ok(getPipeline("footage-edit").stages.find((stage) => stage.id === "research").requiredOutputs.includes("media_evidence_index.json"));
  assert.ok(!getPipeline("brand-film").stages.find((stage) => stage.id === "research").requiredOutputs.includes("media_evidence_index.json"));
  assert.ok(getPipeline("reference-remix").stages.find((stage) => stage.id === "research").requiredOutputs.includes("reference_replication_plan.json"));
  assert.ok(getPipeline("reference-replication").stages.find((stage) => stage.id === "research").requiredOutputs.includes("reference_media_bundle.json"));
  assert.ok(!getPipeline("reference-replication").stages.find((stage) => stage.id === "intake").requiredOutputs.includes("Director.md"));
  assert.ok(getPipeline("reference-replication").stages.find((stage) => stage.id === "research").requiredOutputs.includes("Director.md"));
  assert.ok(getPipeline("reference-replication").stages.find((stage) => stage.id === "review").requiredOutputs.includes("replication_conformance_report.json"));
  assert.ok(!getPipeline("brand-film").stages.find((stage) => stage.id === "storyboard").requiredOutputs.includes("frame_handoff_manifest.json"));
  assert.ok(getPipeline("layered-collage").stages.find((stage) => stage.id === "storyboard").requiredOutputs.includes("layer_manifest.json"));
  assert.ok(getPipeline("layered-collage").stages.find((stage) => stage.id === "storyboard").requiredOutputs.includes("layered_review_static_layout.json"));
  assert.ok(getPipeline("layered-collage").stages.find((stage) => stage.id === "edit").requiredOutputs.includes("layered_review_motion_audio.json"));
  assert.ok(getPipeline("layered-collage").stages.find((stage) => stage.id === "review").requiredOutputs.includes("layered_review_final_media.json"));
  assert.throws(() => getPipeline("missing"), /Unknown Director X pipeline/);
});

test("requires actual registered artifact records in addition to evidence names", () => {
  const pipeline = createPipelineRunState("brand-film");
  const missing = missingRegisteredArtifacts(pipeline, "intake", { "Director.md": { path: "/tmp/Director.md" } });
  assert.ok(missing.includes("intent_resolution.json"));
  assert.ok(!missing.includes("Director.md"));
});

test("enforces stage order, approval gates, and completion evidence", () => {
  let pipeline = createPipelineRunState("brand-film", "2026-01-01T00:00:00.000Z");
  assert.throws(() => transitionPipelineStage(pipeline, [], { stageId: "research", action: "begin", detail: "start" }), /Complete intake/);
  assert.throws(() => transitionPipelineStage(pipeline, [], { stageId: "intake", action: "begin", detail: "start" }), /Approval budget/);
  const approvals = [{ kind: "budget", status: "approved" }, { kind: "image_model", status: "approved" }, { kind: "video_model", status: "approved" }, { kind: "voice_model", status: "approved" }, { kind: "music_route", status: "approved" }];
  pipeline = transitionPipelineStage(pipeline, approvals, { stageId: "intake", action: "begin", detail: "start" });
  assert.throws(() => transitionPipelineStage(pipeline, approvals, { stageId: "intake", action: "complete", detail: "done" }), /missing required evidence/);
  const intakeEvidence = pipeline.stages.find((stage) => stage.id === "intake").requiredOutputs;
  pipeline = transitionPipelineStage(pipeline, approvals, { stageId: "intake", action: "complete", detail: "done", evidenceRefs: intakeEvidence });
  assert.equal(pipeline.stageStates.intake.status, "complete");
  assert.equal(transitionPipelineStage(pipeline, approvals, { stageId: "research", action: "begin", detail: "start" }).stageStates.research.status, "active");
});
