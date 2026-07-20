import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertGenerationAnchorsAudited, auditAssetQuality, registerAssetSearchPlan, requireWebAssetDownloadAuthorization, writeAssetQualityAudit, writeAssetSearchPlan } from "./asset-retrieval.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5ZQAAAABJRU5ErkJggg==", "base64");

function searchPlan() {
  return {
    planId: "assets-1", objective: "Find current brand facts and rights-clear visual references", requiredAssetTypes: ["company_logo", "stock_video"],
    sourcePriority: ["official", "public_domain", "licensed_stock", "platform", "community"],
    queries: [
      { queryId: "official-logo", query: "MOSI official logo brand", assetType: "company_logo", sourceScopes: ["official"], purpose: "brand identity" },
      { queryId: "public-video", query: "Shanghai skyline public domain video", assetType: "stock_video", sourceScopes: ["public_domain", "licensed_stock"], purpose: "establishing shot" }
    ],
    selectionCriteria: { minimumRelevance: .8, minimumVisualQuality: .75, minimumWidth: 1280, minimumHeight: 720, rightsPreference: ["public_domain", "licensed", "attribution"] },
    stopConditions: ["official facts verified", "one rights-clear candidate per required role"]
  };
}

test("registers an official-first public-library asset search plan", async () => {
  const run = {};
  const plan = registerAssetSearchPlan(run, searchPlan());
  assert.equal(plan.sourcePriority[0], "official");
  const projectPath = await mkdtemp(join(tmpdir(), "dx-asset-search-"));
  try { const written = await writeAssetSearchPlan({ projectPath, runId: "dx-assets", plan }); assert.match(await readFile(written.path, "utf8"), /public_domain/); }
  finally { await rm(projectPath, { recursive: true, force: true }); }
  assert.throws(() => registerAssetSearchPlan({}, { ...searchPlan(), sourcePriority: ["platform", "official"] }), /prioritize official/);
});

test("audits a local web asset before it can be used as a generation anchor", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-asset-quality-"));
  try {
    const imagePath = join(projectPath, "logo.png"); await writeFile(imagePath, PNG);
    const run = { assets: [{ id: "logo", artifactRef: "web_image:logo", type: "logo", sourceUrl: "https://example.com/logo", localPath: imagePath, rightsStatus: "public_domain" }], artifacts: {}, assetQualityAudits: {} };
    const report = await auditAssetQuality(run, { projectPath, assetRef: "logo", useMode: "delivery", reviewerId: "DX-Asset-Manager", requirements: { minimumWidth: 1, minimumHeight: 1, minimumScore: .7 }, directorReview: { relevanceScore: .95, visualQualityScore: .9, compositionScore: .9, artifactRisk: "none", observations: ["clean raster edge"], approvedForUse: true } });
    assert.equal(report.status, "ready");
    const written = await writeAssetQualityAudit({ projectPath, runId: "dx-assets", report });
    assert.match(await readFile(written.path, "utf8"), /DX-Asset-Manager/);
    assert.throws(() => assertGenerationAnchorsAudited(run, [{ requestId: "REQ-1", inputAnchorAssets: ["logo"] }]), /before a ready asset quality audit/);
    run.assetQualityAudits[report.auditId] = report;
    assert.doesNotThrow(() => assertGenerationAnchorsAudited(run, [{ requestId: "REQ-1", inputAnchorAssets: ["logo"] }]));
    const blocked = await auditAssetQuality(run, { projectPath, assetRef: "logo", useMode: "delivery", reviewerId: "DX-Asset-Manager", requirements: { minimumWidth: 1280, minimumHeight: 720 }, directorReview: { relevanceScore: .95, visualQualityScore: .9, compositionScore: .9, artifactRisk: "none", observations: ["too small"], approvedForUse: true } });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockers[0], /resolution/);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("requires the exact Codex-native authorization gate for uncertain web rights", () => {
  const args = { assetId: "logo", sourceType: "official", rightsStatus: "reference_only", interactionRequestId: "dxq-logo" };
  const run = { interactions: { pending: [], history: [{ requestId: "dxq-logo", kind: "reference_download", gateKey: "asset-download:logo", status: "resolved", confirmedBy: "request_user_input", answers: { asset_download: "允许下载用于本地分析" } }] } };
  const authorization = requireWebAssetDownloadAuthorization(run, args);
  assert.equal(authorization.rightsGrant, false);
  assert.throws(() => requireWebAssetDownloadAuthorization(run, { ...args, assetId: "other" }), /gateKey/);
  assert.equal(requireWebAssetDownloadAuthorization({}, { assetId: "stock", sourceType: "public_domain", rightsStatus: "public_domain" }), null);
});
