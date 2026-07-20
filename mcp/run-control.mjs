import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const RUN_MODES = ["guided_autonomy", "stage_approval", "full_automation"];

export function configureRunMode(run, config, now = new Date().toISOString()) {
  if (!RUN_MODES.includes(config.mode)) throw new Error(`Unsupported Director X run mode: ${config.mode}`);
  if (config.confirmedBy !== "request_user_input") throw new Error("Run mode must be confirmed through Codex request_user_input.");
  run.runMode = {
    mode: config.mode, confirmedAt: now, confirmedBy: config.confirmedBy,
    lowRiskAutoAdvance: config.mode !== "stage_approval",
    stageApprovalRequired: config.mode === "stage_approval",
    hardGates: ["budget", "image_model", "video_model", "voice_model", "music_strategy", "music_asset_selection", "provider_reroute", "reference_download", "delivery_promise_change", "delivery"]
  };
  run.stageApprovals ??= {};
  return run.runMode;
}

export function approveStage(run, input, now = new Date().toISOString()) {
  if (run.runMode?.mode !== "stage_approval") throw new Error("Explicit stage approval is only used in stage_approval mode.");
  if (input.confirmedBy !== "request_user_input") throw new Error("Stage approval must come from Codex request_user_input.");
  if (!run.pipeline?.stages?.some((stage) => stage.id === input.stageId)) throw new Error(`Unknown pipeline stage: ${input.stageId}`);
  run.stageApprovals ??= {};
  run.stageApprovals[input.stageId] = { status: "approved", approvedAt: now, confirmedBy: input.confirmedBy, note: input.note };
  return run.stageApprovals[input.stageId];
}

export function assertRunModeAllowsStage(run, stageId, action) {
  if (action !== "begin" || stageId === "intake") return;
  if (!run.runMode) throw new Error("Confirm a Director X run mode before beginning production stages.");
  if (run.runMode.mode === "stage_approval" && run.stageApprovals?.[stageId]?.status !== "approved") throw new Error(`Stage ${stageId} requires Codex request_user_input approval before it can begin.`);
}

export async function appendRunCheckpoint({ projectPath, runId, run, reason, detail }, now = new Date().toISOString()) {
  run.checkpoints ??= [];
  const checkpoint = {
    checkpointId: `CHK-${randomUUID()}`, sequence: run.checkpoints.length + 1, at: now, reason, detail,
    stage: run.stage, status: run.status, pipelineId: run.pipeline?.id ?? null,
    stageStates: structuredClone(run.pipeline?.stageStates ?? {}), approvals: structuredClone(run.approvals ?? []), stageApprovals: structuredClone(run.stageApprovals ?? {}),
    activeInteractionIds: (run.interactions?.pending ?? []).map((interaction) => interaction.requestId),
    resolvedInteractionIds: (run.interactions?.history ?? []).filter((interaction) => interaction.status === "resolved").map((interaction) => interaction.requestId),
    decisionIds: (run.decisions ?? []).map((decision) => decision.id), artifactRefs: Object.keys(run.artifacts ?? {}), eventCursor: run.events?.at(-1)?.sequence ?? 0,
    generationCost: run.generation ? { currency: run.generation.currency, estimated: run.generation.totalEstimatedCost, actual: run.generation.totalActualCost } : null,
    supersedes: run.checkpoints.at(-1)?.checkpointId ?? null
  };
  run.checkpoints.push(checkpoint);
  const artifact = {
    schemaVersion: "1.0", checkpoint_replay_id: `CPR-${runId}`, run_id: runId,
    latest_checkpoint_id: checkpoint.checkpointId, checkpoints: run.checkpoints,
    decision_rail: (run.decisions ?? []).map((decision) => ({ decision_id: decision.id, kind: decision.kind, approved_at: decision.approvedAt })),
    event_cursor: { latest_sequence: checkpoint.eventCursor, replay_cursor: checkpoint.eventCursor },
    approval_evidence: [...(run.approvals ?? []), ...Object.entries(run.stageApprovals ?? {}).map(([stage, value]) => ({ kind: `stage:${stage}`, ...value }))],
    native_interactions: { pending: structuredClone(run.interactions?.pending ?? []), history: structuredClone(run.interactions?.history ?? []) }
  };
  const dir = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "checkpoint_replay.json");
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return { checkpoint, artifactRef: "checkpoint_replay.json", path };
}
