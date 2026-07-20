import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileOtlpTrace, promoteBenchmarkBaseline, revokeBenchmarkBaseline } from "./observability-baseline.mjs";

test("exports low-sensitive OTLP-compatible spans", () => {
  const run = { runId: "r1", productionLineage: { l1: { bindingId: "l1", boundAt: "2026-01-01T00:00:00Z", lineageHash: "sha256:x", activity: { dxAgent: "DX-Provider-Operator", providerId: "mosi", modelId: "video", modelVersion: "1", capabilityId: "video.text_to_video", toolId: "tool", promptContractHash: "sha256:p", directorContractFingerprint: "sha256:d" } } }, executionTelemetry: { executions: [{ lineageBindingId: "l1", status: "succeeded", actualCost: 1, latencyMs: 20, recordedAt: "2026-01-01T00:00:01Z" }] } };
  const trace = compileOtlpTrace(run, { pluginVersion: "1" }); const encoded = JSON.stringify(trace);
  assert.equal(trace.resourceSpans[0].scopeSpans[0].spans.length, 1); assert.match(encoded, /gen_ai\.operation\.name/); assert.doesNotMatch(encoded, /apiKey|input\.messages|output\.messages/);
});

test("promotes and revokes project baselines with native confirmation", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-baseline-")), run = { runId: "r1", benchmarkReports: { q1: { reportId: "q1", suiteId: "s1", suiteVersion: "1", passRate: 1, passRateInterval95: {}, meanScore: .9, meanScoreInterval95: {}, trialCount: 20, status: "passed" } } };
  const baseline = await promoteBenchmarkBaseline(run, { projectPath, reportId: "q1", confirmedBy: "request_user_input", note: "approved" }); assert.equal(baseline.status, "active");
  await revokeBenchmarkBaseline(run, { projectPath, suiteId: "s1", confirmedBy: "request_user_input", note: "model drift" }); const store = JSON.parse(await readFile(join(projectPath, ".directorx/benchmarks/baselines.json"), "utf8")); assert.equal(store.revisions[0].status, "revoked"); assert.equal(store.activeBySuite.s1, undefined);
});
