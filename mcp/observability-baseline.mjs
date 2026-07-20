import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export function compileOtlpTrace(run, input, now = new Date().toISOString()) {
  const traceId = hex(run.runId, 32), spans = [];
  for (const binding of Object.values(run.productionLineage ?? {})) {
    const telemetry = run.executionTelemetry?.executions?.find((item) => item.lineageBindingId === binding.bindingId);
    spans.push(span(traceId, binding.bindingId, binding.boundAt, telemetry?.recordedAt ?? binding.boundAt, "gen_ai.execute_tool", {
      "gen_ai.operation.name": "execute_tool", "gen_ai.agent.name": binding.activity.dxAgent, "gen_ai.provider.name": binding.activity.providerId, "gen_ai.request.model": binding.activity.modelId, "gen_ai.response.model": binding.activity.modelVersion,
      "directorx.run.id": run.runId, "directorx.capability.id": binding.activity.capabilityId, "directorx.tool.id": binding.activity.toolId, "directorx.prompt.hash": binding.activity.promptContractHash, "directorx.director.fingerprint": binding.activity.directorContractFingerprint, "directorx.lineage.hash": binding.lineageHash,
      "directorx.execution.status": telemetry?.status ?? "unknown", "directorx.execution.cost": telemetry?.actualCost ?? 0, "directorx.execution.latency_ms": telemetry?.latencyMs ?? 0
    }));
  }
  for (const receipt of Object.values(run.benchmarkVerifierReceipts ?? {})) spans.push(span(traceId, receipt.receiptId, receipt.results[0]?.startedAt ?? receipt.completedAt, receipt.completedAt, "directorx.benchmark.verify", { "gen_ai.operation.name": "invoke_workflow", "gen_ai.workflow.name": "directorx_benchmark_verifiers", "directorx.run.id": run.runId, "directorx.benchmark.suite_id": receipt.suiteId, "directorx.benchmark.fixture_id": receipt.fixtureId, "directorx.benchmark.status": receipt.status, "directorx.benchmark.check_count": receipt.results.length }));
  for (const trial of run.benchmarkTrials ?? []) spans.push(span(traceId, trial.trialId, trial.recordedAt, trial.recordedAt, "directorx.benchmark.trial", { "gen_ai.operation.name": "invoke_workflow", "gen_ai.workflow.name": "directorx_benchmark_trial", "directorx.run.id": run.runId, "directorx.benchmark.suite_id": trial.suiteId, "directorx.benchmark.fixture_id": trial.fixtureId, "directorx.benchmark.status": trial.status, "directorx.benchmark.score": trial.weightedScore, "directorx.execution.cost": trial.actualCost, "directorx.execution.latency_ms": trial.latencyMs }));
  const trace = { schemaVersion: "1.0", format: "otlp-json-compatible", contentPolicy: "identifiers_hashes_metrics_only", generatedAt: now, resourceSpans: [{ resource: { attributes: attrs({ "service.name": "directorx", "service.version": input.pluginVersion, "directorx.run.id": run.runId }) }, scopeSpans: [{ scope: { name: "openmoss.directorx", version: input.pluginVersion }, spans }] }] };
  run.observabilityTrace = { artifactRef: "agent_trace_otlp.json", spanCount: spans.length, generatedAt: now, contentPolicy: trace.contentPolicy }; return trace;
}

export async function promoteBenchmarkBaseline(run, input, now = new Date().toISOString()) {
  const report = run.benchmarkReports?.[input.reportId];
  if (!report || input.confirmedBy !== "request_user_input" || !input.note) throw new Error("Baseline promotion requires a report and Codex-native confirmation note.");
  if (["regressed", "insufficient_precision"].includes(report.status)) throw new Error(`Cannot promote benchmark report with status ${report.status}.`);
  const store = await readBaselineStore(input.projectPath), previous = store.activeBySuite[report.suiteId] ?? null;
  const revision = { baselineId: `baseline:${report.suiteId}:${randomUUID()}`, suiteId: report.suiteId, suiteVersion: report.suiteVersion, sourceRunId: run.runId, sourceReportId: report.reportId, passRate: report.passRate, passRateInterval95: report.passRateInterval95, meanScore: report.meanScore, meanScoreInterval95: report.meanScoreInterval95, trialCount: report.trialCount, note: input.note, confirmedBy: input.confirmedBy, promotedAt: now, supersedesBaselineId: previous?.baselineId ?? null, status: "active" };
  if (previous) { previous.status = "superseded"; const previousRevision = store.revisions.find((item) => item.baselineId === previous.baselineId); if (previousRevision) previousRevision.status = "superseded"; } store.revisions.push(revision); store.activeBySuite[report.suiteId] = revision; store.updatedAt = now; await writeBaselineStore(input.projectPath, store);
  run.benchmarkBaselineDecisions ??= []; run.benchmarkBaselineDecisions.push({ action: "promote", ...revision }); return revision;
}

export async function revokeBenchmarkBaseline(run, input, now = new Date().toISOString()) {
  if (input.confirmedBy !== "request_user_input" || !input.note) throw new Error("Baseline revocation requires Codex-native confirmation note.");
  const store = await readBaselineStore(input.projectPath), active = store.activeBySuite[input.suiteId]; if (!active) throw new Error(`No active baseline for ${input.suiteId}.`);
  const revision = store.revisions.find((item) => item.baselineId === active.baselineId) ?? active;
  revision.status = "revoked"; revision.revokedAt = now; revision.revocationNote = input.note; delete store.activeBySuite[input.suiteId]; store.updatedAt = now; await writeBaselineStore(input.projectPath, store);
  run.benchmarkBaselineDecisions ??= []; run.benchmarkBaselineDecisions.push({ action: "revoke", baselineId: active.baselineId, suiteId: input.suiteId, note: input.note, confirmedBy: input.confirmedBy, decidedAt: now }); return revision;
}

export async function readBaselineStore(projectPath) { try { return JSON.parse(await readFile(baselinePath(projectPath), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; return { schemaVersion: "1.0", scope: "project", activeBySuite: {}, revisions: [], updatedAt: null }; } }

export async function writeGovernanceArtifacts({ projectPath, runId, trace, decisions }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(directory, { recursive: true }); const written = {};
  for (const [artifactRef, value] of Object.entries({ "agent_trace_otlp.json": trace, "benchmark_baseline_decisions.json": decisions ? { decisions } : null })) if (value) { const path = join(directory, artifactRef); await atomic(path, `${JSON.stringify({ runId, ...value }, null, 2)}\n`); written[artifactRef] = { artifactRef, path }; } return written;
}

function span(traceId, id, start, end, name, attributes) { const startTimeUnixNano = nanos(start), endTimeUnixNano = String(BigInt(nanos(end)) + 1_000_000n); return { traceId, spanId: hex(id, 16), name, kind: 1, startTimeUnixNano, endTimeUnixNano, attributes: attrs(attributes), status: { code: attributes["directorx.execution.status"] === "failed" || attributes["directorx.benchmark.status"] === "failed" ? 2 : 1 } }; }
function attrs(value) { return Object.entries(value).filter(([, item]) => item !== null && item !== undefined).map(([key, item]) => ({ key, value: typeof item === "number" ? { doubleValue: item } : typeof item === "boolean" ? { boolValue: item } : { stringValue: String(item) } })); }
function nanos(value) { return String(BigInt(Date.parse(value) || 0) * 1_000_000n); }
function hex(value, length) { return createHash("sha256").update(String(value)).digest("hex").slice(0, length); }
function baselinePath(projectPath) { return resolve(projectPath, ".directorx", "benchmarks", "baselines.json"); }
async function writeBaselineStore(projectPath, value) { await atomic(baselinePath(projectPath), `${JSON.stringify(value, null, 2)}\n`); }
async function atomic(path, value) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${randomUUID()}.tmp`; await writeFile(temporary, value, { mode: 0o600 }); await rename(temporary, path); }
