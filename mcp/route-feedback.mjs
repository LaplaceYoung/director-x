import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const FAILURES = new Set(["none", "timeout", "rate_limited", "provider_error", "permission_denied", "invalid_output", "quality_rejected", "rights_blocked", "user_cancelled"]);

export function recordToolExecution(run, input, now = new Date().toISOString()) {
  if (!run.capabilityExecutionPlan) throw new Error("Plan capability_execution_plan.json before recording execution telemetry.");
  if (!input?.executionId || !input.lineageBindingId || !input.capabilityId || !input.toolId || ![...TERMINAL, "input_required"].includes(input.status) || !FAILURES.has(input.failureClass)) throw new Error("Execution telemetry requires IDs, lineage, status, and a supported failure class.");
  const lineage = run.productionLineage?.[input.lineageBindingId];
  if (!lineage || lineage.activity.capabilityId !== input.capabilityId || lineage.activity.toolId !== input.toolId) throw new Error("Execution telemetry must match an immutable production lineage binding.");
  if (input.status === "succeeded" && (!Number.isFinite(input.qualityScore) || input.qualityScore < 0 || input.qualityScore > 1 || !input.reviewEvidenceRefs?.length)) throw new Error("Successful media execution learning requires a quality score and review evidence.");
  for (const [key, value] of Object.entries({ actualCost: input.actualCost, latencyMs: input.latencyMs })) if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be non-negative.`);
  const selected = run.capabilityExecutionPlan.candidates.flatMap((candidate) => candidate.selections).some((selection) => selection.capabilityId === input.capabilityId && selection.toolId === input.toolId);
  if (!selected) throw new Error("Telemetry must reference a tool considered by the active capability execution plan.");
  run.executionTelemetry ??= { schemaVersion: "1.0", planId: run.capabilityExecutionPlan.planId, executions: [] };
  if (run.executionTelemetry.executions.some((item) => item.executionId === input.executionId)) throw new Error(`Duplicate execution telemetry: ${input.executionId}`);
  const record = { ...structuredClone(input), recordedAt: now };
  run.executionTelemetry.executions.push(record);
  return record;
}

export function recordProviderCapacity(run, input, now = new Date().toISOString()) {
  if (!input?.snapshotId || !input.toolId || !["healthy", "constrained", "saturated", "unavailable"].includes(input.state)) throw new Error("Capacity snapshot requires IDs and state.");
  for (const [key, value] of Object.entries({ activeJobs: input.activeJobs, maxConcurrentJobs: input.maxConcurrentJobs, queueDepth: input.queueDepth, retryAfterSeconds: input.retryAfterSeconds })) if (!Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer.`);
  run.providerCapacity ??= {};
  run.providerCapacity[input.toolId] = { ...structuredClone(input), observedAt: now };
  return run.providerCapacity[input.toolId];
}

export function compileRouteFeedback(run, input, now = new Date().toISOString()) {
  const executions = run.executionTelemetry?.executions ?? [];
  if (!input?.reportId || !executions.length) throw new Error("Route feedback requires a report ID and execution telemetry.");
  const selectedCandidate = run.capabilityExecutionPlan.candidates.find((candidate) => candidate.strategy === run.capabilityExecutionPlan.recommendedStrategy);
  const predicted = new Map(selectedCandidate?.selections.map((item) => [`${item.capabilityId}:${item.toolId}`, item]) ?? []);
  const samples = executions.filter((item) => TERMINAL.has(item.status)).map((item) => {
    const baseline = predicted.get(`${item.capabilityId}:${item.toolId}`);
    const actualQuality = item.status === "succeeded" ? item.qualityScore : 0;
    return { executionId: item.executionId, capabilityId: item.capabilityId, toolId: item.toolId, status: item.status, failureClass: item.failureClass, predictedQuality: baseline?.qualityScore ?? null, actualQuality, qualityShortfall: baseline ? round(Math.max(0, baseline.qualityScore - actualQuality)) : null, estimatedCost: baseline?.estimatedCost ?? null, actualCost: item.actualCost, costOverrun: baseline ? round(Math.max(0, item.actualCost - baseline.estimatedCost)) : null, estimatedLatencyMs: baseline?.latencyMsP50 ?? null, actualLatencyMs: item.latencyMs, latencyOverrunMs: baseline ? Math.max(0, item.latencyMs - baseline.latencyMsP50) : null, evidenceRefs: item.reviewEvidenceRefs ?? [] };
  });
  const byTool = new Map();
  for (const sample of samples) { const bucket = byTool.get(sample.toolId) ?? []; bucket.push(sample); byTool.set(sample.toolId, bucket); }
  const toolSummaries = [...byTool.entries()].map(([toolId, values]) => ({ toolId, sampleCount: values.length, successRate: round(values.filter((item) => item.status === "succeeded").length / values.length), meanActualQuality: round(values.reduce((sum, item) => sum + item.actualQuality, 0) / values.length), meanQualityShortfall: round(values.reduce((sum, item) => sum + (item.qualityShortfall ?? 0), 0) / values.length), meanCostOverrun: round(values.reduce((sum, item) => sum + (item.costOverrun ?? 0), 0) / values.length), meanLatencyOverrunMs: Math.round(values.reduce((sum, item) => sum + (item.latencyOverrunMs ?? 0), 0) / values.length), failureClasses: [...new Set(values.map((item) => item.failureClass).filter((value) => value !== "none"))] }));
  const report = { schemaVersion: "1.0", reportId: input.reportId, planId: run.capabilityExecutionPlan.planId, metric: "empirical_regret_proxy_not_counterfactual_regret", samples, toolSummaries, createdAt: now };
  const proposals = toolSummaries.filter((summary) => summary.sampleCount >= (input.minimumSamples ?? 2)).map((summary) => ({ patchId: `knowledge:${input.reportId}:${summary.toolId}`, toolId: summary.toolId, status: "proposed", evidenceSampleCount: summary.sampleCount, updates: { observedQualityScore: summary.meanActualQuality, observedReliabilityScore: summary.successRate, observedLatencyPenaltyMs: summary.meanLatencyOverrunMs, observedFailureClasses: summary.failureClasses }, applyPolicy: "future_routes_only_after_review", currentApprovedRouteImmutable: true }));
  run.routeFeedback = report;
  run.modelKnowledgePatch = { schemaVersion: "1.0", reportId: report.reportId, status: proposals.length ? "review_required" : "insufficient_evidence", proposals, createdAt: now };
  return { report, modelKnowledgePatch: run.modelKnowledgePatch };
}

export async function writeRouteFeedbackArtifacts({ projectPath, runId, executionTelemetry, providerCapacity, routeFeedback, modelKnowledgePatch }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(directory, { recursive: true });
  const values = { "execution_telemetry.json": executionTelemetry, "provider_capacity_snapshot.json": providerCapacity ? { snapshots: Object.values(providerCapacity) } : null, "route_regret_report.json": routeFeedback, "model_knowledge_patch.json": modelKnowledgePatch }, written = {};
  for (const [artifactRef, value] of Object.entries(values)) if (value) { const path = join(directory, artifactRef); await writeFile(path, `${JSON.stringify({ runId, ...value }, null, 2)}\n`, { mode: 0o600 }); written[artifactRef] = { artifactRef, path }; }
  return written;
}

const round = (value) => Math.round(value * 10000) / 10000;
