import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export function registerBenchmarkSuite(run, input, now = new Date().toISOString()) {
  if (!input.suiteId || !input.version || !input.taskFamily || !input.fixtures?.length) throw new Error("Benchmark suite requires identity, task family, and fixtures.");
  const routed = new Set(run.capabilityRoute?.capabilities?.map((item) => item.id) ?? []);
  for (const capabilityId of input.capabilityIds ?? []) if (!routed.has(capabilityId)) throw new Error(`Benchmark capability is not routed: ${capabilityId}`);
  const fixtureIds = new Set();
  for (const fixture of input.fixtures) {
    if (!fixture.fixtureId || fixtureIds.has(fixture.fixtureId) || !fixture.objective || !fixture.expectedArtifactRefs?.length || !fixture.programmaticChecks?.length || !fixture.expertRubric?.length) throw new Error("Each benchmark fixture requires a unique ID, objective, expected artifacts, checks, and expert rubric.");
    fixtureIds.add(fixture.fixtureId);
    const weight = fixture.expertRubric.reduce((sum, item) => sum + item.weight, 0);
    if (Math.abs(weight - 1) > 0.001 || fixture.expertRubric.some((item) => !item.dimensionId || item.weight <= 0 || item.minimumScore < 0 || item.minimumScore > 1)) throw new Error("Expert rubric weights must sum to 1 and scores must be normalized.");
  }
  const suite = { schemaVersion: "1.0", suiteId: input.suiteId, version: input.version, taskFamily: input.taskFamily, capabilityIds: [...(input.capabilityIds ?? [])], fixtures: structuredClone(input.fixtures), registeredAt: now };
  run.benchmarkSuites ??= {}; if (run.benchmarkSuites[input.suiteId]) throw new Error(`Duplicate benchmark suite: ${input.suiteId}`);
  run.benchmarkSuites[input.suiteId] = suite; return suite;
}

export function recordBenchmarkTrial(run, input, now = new Date().toISOString()) {
  const suite = run.benchmarkSuites?.[input.suiteId], fixture = suite?.fixtures.find((item) => item.fixtureId === input.fixtureId);
  if (!fixture || !input.trialId || !input.lineageBindingIds?.length || !input.outputArtifactRefs?.length) throw new Error("Benchmark trial requires a registered fixture, trial ID, lineage, and outputs.");
  for (const id of input.lineageBindingIds) if (!run.productionLineage?.[id]) throw new Error(`Unknown benchmark lineage binding: ${id}`);
  for (const ref of input.outputArtifactRefs) if (!run.artifacts?.[ref]) throw new Error(`Unknown benchmark output artifact: ${ref}`);
  for (const ref of fixture.expectedArtifactRefs) if (!input.outputArtifactRefs.includes(ref)) throw new Error(`Missing expected benchmark output: ${ref}`);
  const receipt = run.benchmarkVerifierReceipts?.[input.verifierReceiptId];
  if (!receipt || receipt.suiteId !== input.suiteId || receipt.fixtureId !== input.fixtureId) throw new Error("Benchmark trial requires a matching plugin-executed verifier receipt.");
  const checks = new Map(receipt.results.map((item) => [item.checkId, item])), scores = new Map(input.rubricScores?.map((item) => [item.dimensionId, item]) ?? []);
  if (fixture.programmaticChecks.some((id) => !checks.get(id)?.evidenceRefs?.length) || fixture.expertRubric.some((item) => !scores.get(item.dimensionId)?.evidenceRefs?.length)) throw new Error("Every verifier and rubric score requires durable evidence.");
  const weightedScore = fixture.expertRubric.reduce((sum, item) => { const score = scores.get(item.dimensionId)?.score; if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error(`Invalid rubric score: ${item.dimensionId}`); return sum + score * item.weight; }, 0);
  const programmaticPassed = fixture.programmaticChecks.every((id) => checks.get(id)?.passed === true);
  const rubricPassed = fixture.expertRubric.every((item) => scores.get(item.dimensionId).score >= item.minimumScore);
  const constraintsPassed = input.actualCost <= fixture.maxCost && input.latencyMs <= fixture.maxLatencyMs;
  const trial = { schemaVersion: "1.0", trialId: input.trialId, suiteId: input.suiteId, suiteVersion: suite.version, fixtureId: input.fixtureId, lineageBindingIds: [...input.lineageBindingIds], outputArtifactRefs: [...input.outputArtifactRefs], verifierReceiptId: receipt.receiptId, programmaticResults: structuredClone(receipt.results), rubricScores: structuredClone(input.rubricScores), weightedScore: round(weightedScore), actualCost: input.actualCost, latencyMs: input.latencyMs, programmaticPassed, rubricPassed, constraintsPassed, status: programmaticPassed && rubricPassed && constraintsPassed ? "passed" : "failed", recordedAt: now };
  run.benchmarkTrials ??= []; if (run.benchmarkTrials.some((item) => item.trialId === input.trialId)) throw new Error(`Duplicate benchmark trial: ${input.trialId}`);
  run.benchmarkTrials.push(trial); return trial;
}

export function compileBenchmarkReport(run, input, now = new Date().toISOString()) {
  const suite = run.benchmarkSuites?.[input.suiteId], trials = (run.benchmarkTrials ?? []).filter((item) => item.suiteId === input.suiteId);
  if (!suite || trials.length < input.minimumTrials) throw new Error("Benchmark report requires a registered suite and enough trials.");
  const passRate = trials.filter((item) => item.status === "passed").length / trials.length, meanScore = mean(trials.map((item) => item.weightedScore));
  const passRateInterval95 = wilson(trials.filter((item) => item.status === "passed").length, trials.length), meanScoreInterval95 = meanInterval(trials.map((item) => item.weightedScore));
  const regressions = [];
  if (input.baseline) {
    if (passRateInterval95.upper < input.baseline.passRate - input.regressionTolerance) regressions.push({ metric: "pass_rate", baseline: input.baseline.passRate, current: round(passRate), interval95: passRateInterval95 });
    if (meanScoreInterval95.upper < input.baseline.meanScore - input.regressionTolerance) regressions.push({ metric: "mean_score", baseline: input.baseline.meanScore, current: round(meanScore), interval95: meanScoreInterval95 });
  }
  const precisionWidth = Math.max(passRateInterval95.upper - passRateInterval95.lower, meanScoreInterval95.upper - meanScoreInterval95.lower), insufficientPrecision = precisionWidth > input.maxConfidenceWidth;
  const report = { schemaVersion: "1.1", reportId: input.reportId, suiteId: suite.suiteId, suiteVersion: suite.version, trialCount: trials.length, passRate: round(passRate), passRateInterval95, meanScore: round(meanScore), meanScoreInterval95, scoreStdDev: round(sampleStdDev(trials.map((item) => item.weightedScore))), meanCost: round(mean(trials.map((item) => item.actualCost))), meanLatencyMs: round(mean(trials.map((item) => item.latencyMs))), maxConfidenceWidth: input.maxConfidenceWidth, baseline: input.baseline ?? null, regressionTolerance: input.regressionTolerance, regressions, status: regressions.length ? "regressed" : insufficientPrecision ? "insufficient_precision" : passRate === 1 ? "passed" : "needs_improvement", currentApprovedRouteImmutable: true, createdAt: now };
  run.benchmarkReports ??= {}; run.benchmarkReports[input.reportId] = report; return report;
}

export async function writeBenchmarkArtifacts({ projectPath, runId, benchmarkSuites, benchmarkVerifierReceipts, benchmarkTrials, report }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(directory, { recursive: true });
  const values = { "benchmark_suite.json": benchmarkSuites ? { suites: Object.values(benchmarkSuites) } : null, "benchmark_verifier_receipt.json": benchmarkVerifierReceipts ? { receipts: Object.values(benchmarkVerifierReceipts) } : null, "benchmark_trials.json": benchmarkTrials ? { trials: benchmarkTrials } : null, "benchmark_report.json": report };
  const written = {}; for (const [artifactRef, value] of Object.entries(values)) if (value) { const path = join(directory, artifactRef); await writeFile(path, `${JSON.stringify({ runId, ...value }, null, 2)}\n`, { mode: 0o600 }); written[artifactRef] = { artifactRef, path }; } return written;
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function sampleStdDev(values) { if (values.length < 2) return 0; const average = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)); }
function wilson(successes, count) { const z = 1.959964, p = successes / count, denominator = 1 + z ** 2 / count, center = (p + z ** 2 / (2 * count)) / denominator, margin = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * count)) / count) / denominator; return { lower: round(Math.max(0, center - margin)), upper: round(Math.min(1, center + margin)), method: "wilson_95" }; }
function meanInterval(values) { if (values.length < 2) return { lower: 0, upper: 1, method: "insufficient_samples" }; const average = mean(values), margin = 1.959964 * sampleStdDev(values) / Math.sqrt(values.length); return { lower: round(Math.max(0, average - margin)), upper: round(Math.min(1, average + margin)), method: "normal_approx_95" }; }
function round(value) { return Math.round(value * 10000) / 10000; }
