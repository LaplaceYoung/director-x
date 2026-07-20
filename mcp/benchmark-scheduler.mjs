import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const BENCHMARK_FIXTURE_TEMPLATES = [
  template("repurpose", "Turn long user/licensed footage into a brief-driven short deliverable.", ["reference.temporal_ground", "video.trim_reorder", "audio.mix", "subtitle.compose", "delivery.render"], ["source_media", "brief"], ["delivery.video", "caption_track.json", "audio_analysis_report.json"], ["media_playable", "audio_present", "duration_range", "subtitle_timing_integrity", "audio_loudness_range"]),
  template("sequencing", "Restore shuffled licensed shots into a coherent narrative order.", ["reference.temporal_ground", "video.trim_reorder", "review.compare"], ["candidate_clips", "sequence_brief"], ["semantic_timeline.json", "delivery.video"], ["timeline_clip_order", "media_playable", "duration_range"]),
  template("repair", "Find and repair bounded technical or continuity defects without changing unaffected regions.", ["video.inpaint", "review.av_sync", "review.compare"], ["broken_media", "defect_scope"], ["delivery.video", "shot_review_report.json"], ["media_playable", "audio_present"]),
  template("assembly", "Select one licensed candidate per storyboard slot and build a continuity-aware rough cut.", ["storyboard.plan", "video.trim_reorder", "video.transition", "delivery.render"], ["storyboard", "candidate_clips"], ["semantic_timeline.json", "delivery.video"], ["timeline_clip_order", "media_playable", "duration_range"]),
  template("camera-continuity", "Compile a rights-safe multi-camera first/last-frame graph and approve every reference target before generation.", ["storyboard.plan", "continuity.manage", "video.first_last_frame"], ["shotlist"], ["camera_dependency_graph.json", "reference_selection_plan.json"], ["camera_graph_integrity", "reference_plan_integrity"]),
  template("creative-shot-sequence", "Turn a script and rights-bounded cinematic references into a motivated, emotionally shaped, continuity-safe shot sequence.", ["script.compose", "storyboard.plan", "continuity.manage", "video.transition", "review.compare"], ["script", "cinematic_references"], ["shot_sequence_review.json", "transition_language_plan.json"], ["cinematic_reference_binding", "shot_sequence_artistry", "transition_plan_integrity"]),
  template("creative-remotion-launch", "Build a 30-second Remotion launch film whose layered scenes, narration, captions, and motivated boundaries remain deterministic and reviewable.", ["storyboard.plan", "video.transition", "audio.mix", "subtitle.compose", "delivery.render"], ["storyboard", "cinematic_references", "narration"], ["render_quality_contract.json", "semantic_timeline.json", "delivery.video"], ["cinematic_reference_binding", "render_creative_contract", "timeline_clip_order", "media_playable"]),
  template("creative-video-modes", "Compile one intent across text-to-video, image-to-video, first/last-frame, and extension routes without leaking mode-specific parameters.", ["image.generate", "video.text_to_video", "video.image_to_video", "video.first_last_frame", "video.extend"], ["director_brief", "model_knowledge"], ["visual_prompt_pack.json"], ["visual_prompt_mode_coverage"]),
  template("creative-script-duration", "Express one commercial proposition as disciplined 15, 30, and 60 second structures with visible proof and non-repetitive escalation.", ["script.compose", "storyboard.plan"], ["creative_brief", "cinematic_references"], ["script_duration_variants.json"], ["cinematic_reference_binding", "script_duration_structure"])
];

export function instantiateBenchmarkTemplate(run, input) {
  const selected = BENCHMARK_FIXTURE_TEMPLATES.find((item) => item.familyId === input.familyId); if (!selected) throw new Error(`Unknown benchmark template: ${input.familyId}`);
  const routed = new Set(run.capabilityRoute?.capabilities?.map((item) => item.id) ?? []); for (const capabilityId of selected.capabilityIds) if (!routed.has(capabilityId)) throw new Error(`Benchmark template capability is not routed: ${capabilityId}`);
  const bindings = new Map((input.inputBindings ?? []).map((item) => [item.slot, item]));
  for (const slot of selected.requiredInputSlots) { const binding = bindings.get(slot); if (!binding || !run.artifacts?.[binding.artifactRef]) throw new Error(`Benchmark template input slot is not bound to a registered artifact: ${slot}`); if (mediaSlot(slot) && !["user_uploaded", "licensed", "public_domain"].includes(binding.rightsStatus)) throw new Error(`Benchmark media slot requires user-uploaded or rights-cleared evidence: ${slot}`); }
  const fixtureId = input.fixtureId || `${input.familyId}-fixture-1`;
  return { suiteId: input.suiteId, version: input.version, taskFamily: input.familyId, capabilityIds: [...selected.capabilityIds], fixtures: [{ fixtureId, objective: input.objective || selected.objective, inputArtifactRefs: selected.requiredInputSlots.map((slot) => bindings.get(slot).artifactRef), inputBindings: selected.requiredInputSlots.map((slot) => ({ ...bindings.get(slot) })), expectedArtifactRefs: [...selected.expectedArtifactRefs], programmaticChecks: selected.recommendedChecks.map((id) => `${fixtureId}:${id}`), expertRubric: rubric(input.familyId), maxCost: input.maxCost, maxLatencyMs: input.maxLatencyMs, templateFamilyId: selected.familyId, mediaPolicy: selected.mediaPolicy }] };
}

export function planBenchmarkSchedule(run, input, now = new Date().toISOString()) {
  const suite = run.benchmarkSuites?.[input.suiteId]; if (!suite || !input.scheduleId || !Number.isInteger(input.repeatsPerFixture) || input.repeatsPerFixture < 1 || input.repeatsPerFixture > 20 || !Number.isInteger(input.maxConcurrency) || input.maxConcurrency < 1 || input.maxConcurrency > 8) throw new Error("Schedule requires a suite, ID, 1-20 repeats, and concurrency 1-8.");
  const jobs = suite.fixtures.flatMap((fixture) => Array.from({ length: input.repeatsPerFixture }, (_, repeatIndex) => ({ jobId: `${input.scheduleId}:${fixture.fixtureId}:${repeatIndex + 1}`, fixtureId: fixture.fixtureId, repeatIndex, seed: seed(input.baseSeed, fixture.fixtureId, repeatIndex), estimatedCost: fixture.maxCost, status: "pending", attempt: 0, trialId: null, startedAt: null, completedAt: null, errorCode: null })));
  const estimatedTotalCost = jobs.reduce((sum, job) => sum + job.estimatedCost, 0); if (estimatedTotalCost > input.maxTotalCost) throw new Error(`Benchmark schedule exceeds maxTotalCost: ${estimatedTotalCost} > ${input.maxTotalCost}`);
  const schedule = { schemaVersion: "1.0", scheduleId: input.scheduleId, suiteId: input.suiteId, suiteVersion: suite.version, repeatsPerFixture: input.repeatsPerFixture, baseSeed: input.baseSeed, seedPolicy: "sha256(baseSeed,fixtureId,repeatIndex)", maxConcurrency: input.maxConcurrency, maxTotalCost: input.maxTotalCost, estimatedTotalCost, jobs, status: "ready", createdAt: now, updatedAt: now };
  run.benchmarkSchedules ??= {}; if (run.benchmarkSchedules[input.scheduleId]) throw new Error(`Duplicate benchmark schedule: ${input.scheduleId}`); run.benchmarkSchedules[input.scheduleId] = schedule; return schedule;
}

export function claimBenchmarkJob(run, input, now = new Date().toISOString()) {
  const schedule = requireSchedule(run, input.scheduleId), running = schedule.jobs.filter((job) => job.status === "running").length; if (running >= schedule.maxConcurrency) throw new Error("Benchmark schedule concurrency is full.");
  const job = schedule.jobs.find((item) => item.status === "pending"); if (!job) throw new Error("No pending benchmark job remains."); job.status = "running"; job.attempt += 1; job.startedAt = now; schedule.status = "running"; schedule.updatedAt = now; return job;
}

export function updateBenchmarkJob(run, input, now = new Date().toISOString()) {
  const schedule = requireSchedule(run, input.scheduleId), job = schedule.jobs.find((item) => item.jobId === input.jobId); if (!job || job.status !== "running" || !["succeeded", "failed", "cancelled"].includes(input.status)) throw new Error("Update an active benchmark job to a terminal state.");
  if (input.status === "succeeded" && !(run.benchmarkTrials ?? []).some((trial) => trial.trialId === input.trialId && trial.fixtureId === job.fixtureId)) throw new Error("A succeeded benchmark job requires its recorded fixture trial.");
  if (input.status === "failed" && !input.errorCode) throw new Error("A failed benchmark job requires a stable errorCode.");
  job.status = input.status; job.trialId = input.trialId ?? null; job.errorCode = input.errorCode ?? null; job.completedAt = now; schedule.updatedAt = now;
  const terminal = schedule.jobs.every((item) => ["succeeded", "failed", "cancelled"].includes(item.status)); if (terminal) schedule.status = schedule.jobs.some((item) => item.status !== "succeeded") ? "completed_with_failures" : "completed"; return job;
}

export function cancelBenchmarkSchedule(run, input, now = new Date().toISOString()) { const schedule = requireSchedule(run, input.scheduleId); for (const job of schedule.jobs) if (job.status === "pending") { job.status = "cancelled"; job.completedAt = now; } schedule.status = schedule.jobs.some((job) => job.status === "running") ? "cancelling" : "cancelled"; schedule.updatedAt = now; return schedule; }

export async function writeBenchmarkSchedule({ projectPath, runId, benchmarkSchedules }) { const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(directory, { recursive: true }); const artifactRef = "benchmark_schedule.json", path = join(directory, artifactRef); await writeFile(path, `${JSON.stringify({ runId, schedules: Object.values(benchmarkSchedules) }, null, 2)}\n`, { mode: 0o600 }); return { artifactRef, path }; }

function template(familyId, objective, capabilityIds, requiredInputSlots, expectedArtifactRefs, recommendedChecks) { return { familyId, objective, capabilityIds, requiredInputSlots, expectedArtifactRefs, recommendedChecks, mediaPolicy: "user_uploaded_or_rights_cleared_only", verifierHiddenReferencePolicy: familyId === "repair" ? "verifier_only_never_agent_context" : "none" }; }
function mediaSlot(slot) { return ["source_media", "candidate_clips", "broken_media"].includes(slot); }
function rubric(familyId) {
  const dimensions = familyId === "repair"
    ? ["defect_removed", "unaffected_regions_preserved", "av_continuity"]
    : familyId === "sequencing"
      ? ["narrative_order", "temporal_continuity", "edit_fit"]
      : familyId === "assembly"
        ? ["storyboard_coverage", "continuity", "edit_fit"]
        : familyId === "camera-continuity"
          ? ["identity_reference_fit", "camera_handoff_logic", "parallel_execution_efficiency"]
          : familyId === "creative-shot-sequence"
            ? ["narrative_function", "visual_variation", "emotional_arc", "motivated_movement"]
            : familyId === "creative-remotion-launch"
              ? ["composition_semantics", "boundary_motivation", "av_readability", "deterministic_rendering"]
              : familyId === "creative-video-modes"
                ? ["mode_isolation", "reference_roles", "motion_observability", "editability"]
                : familyId === "creative-script-duration"
                  ? ["single_proposition", "visible_proof", "duration_discipline", "escalation"]
                  : ["brief_adherence", "retention_structure", "platform_readiness"];
  const weights = dimensions.length === 4 ? [0.3, 0.25, 0.25, 0.2] : [0.4, 0.3, 0.3];
  return dimensions.map((dimensionId, index) => ({ dimensionId, weight: weights[index], minimumScore: 0.7 }));
}
function seed(baseSeed, fixtureId, repeatIndex) { return Number.parseInt(createHash("sha256").update(`${baseSeed}:${fixtureId}:${repeatIndex}`).digest("hex").slice(0, 8), 16); }
function requireSchedule(run, id) { const schedule = run.benchmarkSchedules?.[id]; if (!schedule) throw new Error(`Unknown benchmark schedule: ${id}`); return schedule; }
