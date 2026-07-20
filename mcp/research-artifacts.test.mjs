import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectArtifact } from "./artifact-registry.mjs";
import { buildResearchPackageTemplate, validateResearchPackage, writeReferenceDownloadConsent, writeReferenceVideoAssessment, writeResearchPackage, writeWebResearch } from "./research-artifacts.mjs";

const hostExecutions = [
  { executionId: "search-1", tool: "web.search_query", action: "search", query: "official product facts", executedAt: "2026-07-15T00:00:00.000Z", sourceIds: ["official"] },
  { executionId: "open-1", tool: "web.open", action: "open", executedAt: "2026-07-15T00:00:01.000Z", sourceIds: ["official"] }
];
const webOptions = { lookupFn: async () => [{ address: "93.184.216.34" }], fetchFn: async () => new Response("<html>official current facts</html>", { status: 200, headers: { "content-type": "text/html" } }) };

test("records authoritative web research and compiles a complete research package", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-research-"));
  const runId = "dx-research-test";
  try {
    const research = { queries: ["official product facts", "licensed technology stock"], executions: hostExecutions, summary: "Official facts plus licensed visual options", sources: [{ id: "official", url: "https://example.com/official", title: "Official", sourceType: "official", retrievedAt: "2026-07-14", relevance: "Primary facts", rightsStatus: "reference_only", intendedUse: "fact verification" }] };
    const web = await writeWebResearch({ projectPath, runId, research }, webOptions);
    assert.equal(web.artifactRef, "web_research_receipt.json");
    await writeReferenceVideoAssessment({ projectPath, runId, assessment: { decision: "not_needed", rationale: "Still-image production", searchQueries: [], selectedSourceIds: [], transferTargets: [] } });
    const styleRules = [{ rule_id: "R1", condition: "proof", direction: "stable push", evidence: "camera path" }];
    const results = await writeResearchPackage({ projectPath, runId, run: { directorDocument: { fingerprint: "sha256:test" }, webResearch: web.research, referenceVideoAssessment: { decision: "not_needed" }, assets: [{ id: "asset-1", rightsStatus: "licensed", intendedUse: "style reference", sourceUrl: "https://example.com/asset", fallback: "generate original", licenseEvidence: "license page" }], references: [] }, package: { researchQuestions: ["What is true?"], sourcePolicy: "official first", handoffRules: ["cite sources"], transferablePatterns: [{ pattern: "ordered reveal", directorx_use: "original pacing" }], blockedReuse: ["source pixels"], factualFindings: [{ topic: "product", observation: "verified capability", evidence: "official" }], referenceLearning: { analyzedReferenceIds: [], observations: [{ evidence: "assessment", observation: "External motion reference is not needed for this still-image production." }], directorRules: [], styleUpdates: [], shotImpacts: [], blockedReuse: ["source pixels"], degradedRoute: "not_needed" }, sourcePriority: ["official"], rightsPolicy: "clear before delivery", readinessSummary: { status: "ready" }, rightsReleaseGate: { status: "pass" }, stylePlaybook: { director_binding: { fingerprint: "sha256:test", inherited_directive_ids: ["DIR-VISUAL"], override_records: [] }, style_thesis: "ordered proof", visual_language: "ordered realism", world_rules: styleRules, cinematography_rules: styleRules, lighting_color_rules: styleRules, performance_rules: styleRules, edit_rhythm_rules: styleRules, audio_rules: styleRules, subtitle_rules: styleRules, negative_style_rules: styleRules, evaluation_rules: styleRules, learning_policy: { promotion: "repeat twice or approve" } } } });
    assert.equal(Object.keys(results).length, 7);
    assert.match(await readFile(results["asset_manifest.json"].path, "utf8"), /asset-1/);
    assert.match(await readFile(results["reference_learning_report.json"].path, "utf8"), /not_needed/);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("records scoped reference download consent without treating it as reuse rights", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-consent-"));
  try {
    const result = await writeReferenceDownloadConsent({ projectPath, runId: "dx-consent", consent: { decision: "authorized", confirmationMethod: "request_user_input", purpose: "local_reference_analysis", referenceIds: ["ref-1"], sourceUrls: ["https://example.com/video"], retentionPolicy: "retain bounded clip in run until user deletes it", userFacingNotice: "Analysis only; no reuse rights." } });
    const artifact = JSON.parse(await readFile(result.path, "utf8"));
    assert.equal(artifact.decision, "authorized");
    assert.equal(artifact.purpose, "local_reference_analysis");
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("returns all research package diagnostics in one pass and seeds the active Director binding", () => {
  const run = {
    directorDocument: { fingerprint: "sha256:director", directiveIds: ["DIR-HOOK", "DIR-VISUAL"], contractArtifactRef: "director_contract.json" },
    referenceVideoAssessment: { decision: "required" },
    webResearch: null,
    assets: [],
    references: []
  };
  const validation = validateResearchPackage(run, { stylePlaybook: {} });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length > 10);
  assert.ok(validation.errors.some((error) => error.includes("web research")));
  assert.ok(validation.errors.some((error) => error.includes("analyzedReferenceIds")));
  assert.ok(validation.errors.some((error) => error.includes("stylePlaybook.audio_rules")));
  assert.deepEqual(validation.directorBinding.availableDirectiveIds, ["DIR-HOOK", "DIR-VISUAL"]);

  const template = buildResearchPackageTemplate(run);
  assert.equal(template.stylePlaybook.director_binding.fingerprint, "sha256:director");
  assert.deepEqual(template.stylePlaybook.director_binding.inherited_directive_ids, ["DIR-HOOK", "DIR-VISUAL"]);
});

test("requires locally acquired visual assets and a passing coverage audit for new production runs", () => {
  const base = {
    researchAssetPolicy: { requireLocalVisuals: true, requireCoverageAudit: true },
    directorDocument: { fingerprint: "sha256:director", directiveIds: ["DIR-VISUAL"] },
    webResearch: { queries: ["official"], executions: hostExecutions, sources: [{ id: "official", sourceType: "official", verification: { status: "verified" } }] },
    referenceVideoAssessment: { decision: "not_needed" }, references: [], assets: []
  };
  const invalid = validateResearchPackage(base, {});
  assert.ok(invalid.errors.some((error) => error.includes("real local image")));
  assert.ok(invalid.errors.some((error) => error.includes("audit_visual_asset_coverage")));
  const blocked = validateResearchPackage({ ...base, visualAssetCoverage: { status: "blocked", missingCategories: ["company_logo"] }, assets: [{ id: "url-only", type: "logo", rightsStatus: "reference_only" }] }, {});
  assert.ok(blocked.errors.some((error) => error.includes("company_logo")));
});

test("rejects research without authoritative evidence and artifact paths outside the workspace", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-evidence-"));
  try {
    await assert.rejects(() => writeWebResearch({ projectPath, runId: "dx-test", research: { queries: ["trend"], executions: hostExecutions, summary: "social only", sources: [{ id: "social", url: "https://example.com", title: "Post", sourceType: "social", retrievedAt: "2026-07-14", relevance: "trend", rightsStatus: "reference_only", intendedUse: "pattern" }] } }, webOptions), /official or authoritative/);
    await writeFile(join(projectPath, "inside.json"), "{}\n");
    const record = await inspectArtifact({ projectPath, runId: "dx-test", artifactRef: "inside.json", path: "inside.json", stage: "intake" });
    assert.equal(record.sizeBytes, 3);
    await assert.rejects(() => inspectArtifact({ projectPath, runId: "dx-test", artifactRef: "outside", path: "../outside.json", stage: "intake" }), /inside the project/);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});
