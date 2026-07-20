const MODALITIES = new Set(["image", "video", "voice", "music", "screen", "avatar", "live_action"]);

export function planProductionComplexity(input) {
  const durationSeconds = positive(input.durationSeconds, "durationSeconds");
  const shotCount = integer(input.shotCount, 1, 500, "shotCount");
  const segmentCount = integer(input.segmentCount ?? 1, 1, 500, "segmentCount");
  const referenceVideoCount = integer(input.referenceVideoCount ?? 0, 0, 100, "referenceVideoCount");
  const modalities = [...new Set(input.modalities ?? [])];
  if (!modalities.length || modalities.some((item) => !MODALITIES.has(item))) throw new Error("modalities must contain supported production modalities.");
  const characterContinuity = Boolean(input.characterContinuity);
  const deliveryTier = ["preview", "review", "publish"].includes(input.deliveryTier) ? input.deliveryTier : "review";

  let score = 0;
  if (durationSeconds > 15) score += 2;
  if (durationSeconds > 60) score += 3;
  if (shotCount > 4) score += 2;
  if (shotCount > 12) score += 3;
  if (segmentCount > 1) score += 2;
  if (segmentCount > 6) score += 3;
  if (referenceVideoCount > 0) score += 2;
  if (characterContinuity) score += 2;
  if (modalities.length > 3) score += 1;
  if (deliveryTier === "publish") score += 1;

  const profile = score <= 1 ? "quick" : score <= 7 ? "standard" : "complex";
  const settings = {
    quick: {
      maxConcurrency: 2,
      maxSubagentTasksPerStage: 2,
      candidateCapPerShot: 2,
      researchDepth: "official_sources_plus_one_rights_safe_asset_pass",
      stageExecution: "compressed_passes",
      firstPreviewStrategy: "one_director_pass_one_generation_pass",
      checkpointCadence: "stage_boundary",
      reviewMode: "single_internal_preview_then_exhaustive_final_audit",
      targetFirstPreviewMinutes: 12
    },
    standard: {
      maxConcurrency: 4,
      maxSubagentTasksPerStage: 4,
      candidateCapPerShot: 3,
      researchDepth: "official_sources_plus_reference_and_asset_tracks",
      stageExecution: "normal_stage_gates",
      firstPreviewStrategy: "keyframe_review_then_generation",
      checkpointCadence: "stage_and_paid_attempt",
      reviewMode: "keyframe_review_plus_exhaustive_final_audit",
      targetFirstPreviewMinutes: 30
    },
    complex: {
      maxConcurrency: 6,
      maxSubagentTasksPerStage: 6,
      candidateCapPerShot: 4,
      researchDepth: "multi-source_reference_asset_rights_and_continuity_tracks",
      stageExecution: "scene_and_department_gates",
      firstPreviewStrategy: "scene_proof_then_continuity_generation",
      checkpointCadence: "stage_scene_and_paid_attempt",
      reviewMode: "scene_gates_continuity_review_and_exhaustive_final_audit",
      targetFirstPreviewMinutes: 60
    }
  }[profile];
  return {
    schemaVersion: "1.0",
    profile,
    score,
    inputs: { durationSeconds, shotCount, segmentCount, referenceVideoCount, modalities, characterContinuity, deliveryTier },
    settings,
    invariants: [
      "Director.md remains required",
      "native user approvals remain required",
      "official pricing evidence remains required before paid attempts",
      "full decoded-frame audit remains required before delivery"
    ],
    plannedAt: new Date().toISOString()
  };
}

function positive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive.`);
  return number;
}

function integer(value, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
  return number;
}
