import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireWebImageAsset, auditVisualAssetCoverage, writeVisualAssetCoverage } from "./web-image-assets.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5ZQAAAABJRU5ErkJggg==", "base64");
const lookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

function input(projectPath, overrides = {}) {
  return {
    projectPath, runId: "dx-web-images", assetId: "mosi-logo", category: "company_logo", label: "MOSI 官方 Logo",
    sourceType: "official", sourcePageUrl: "https://mosi.example/brand", sourceImageUrl: "https://cdn.example/logo.png",
    rightsStatus: "reference_only", intendedUse: "brand identity reference", fallback: "request the official vector logo from the user",
    ...overrides
  };
}

test("downloads, verifies, hashes, and persists a web image plus provenance receipt", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-web-image-"));
  try {
    const result = await acquireWebImageAsset(input(projectPath), {
      lookupFn,
      fetchFn: async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png", "content-length": String(PNG.length) } })
    });
    await access(result.asset.localPath);
    assert.equal(result.asset.type, "logo");
    assert.equal(result.asset.previewUri.includes("research-images/mosi-logo.png"), true);
    assert.equal(result.receipt.sha256.length, 64);
    assert.deepEqual([result.receipt.width, result.receipt.height], [1, 1]);
    assert.equal(result.receipt.rightsStatus, "reference_only");
    assert.equal(JSON.parse(await readFile(result.receiptArtifact.path, "utf8")).sourcePageUrl, "https://mosi.example/brand");
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("blocks private, credential-bearing, non-image, and oversized URLs", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-web-image-safe-"));
  try {
    await assert.rejects(() => acquireWebImageAsset(input(projectPath, { sourceImageUrl: "https://127.0.0.1/logo.png" }), { fetchFn: async () => new Response(PNG) }), /private/);
    await assert.rejects(() => acquireWebImageAsset(input(projectPath, { sourceImageUrl: "https://cdn.example/logo.png?access_token=x" }), { lookupFn, fetchFn: async () => new Response(PNG) }), /credential-bearing/);
    await assert.rejects(() => acquireWebImageAsset(input(projectPath, { sourceImageUrl: "https://tse1.mm.bing.net/th/id/logo" }), { lookupFn, fetchFn: async () => new Response(PNG) }), /thumbnail/);
    await assert.rejects(() => acquireWebImageAsset(input(projectPath), { lookupFn, fetchFn: async () => new Response("html", { headers: { "content-type": "text/html" } }) }), /content type/);
    await assert.rejects(() => acquireWebImageAsset(input(projectPath), { lookupFn, maxBytes: 8, fetchFn: async () => new Response(PNG, { headers: { "content-length": "9", "content-type": "image/png" } }) }), /exceeds/);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("audits required visual categories and writes the coverage gate", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-web-coverage-"));
  try {
    const acquired = await acquireWebImageAsset(input(projectPath), {
      lookupFn,
      fetchFn: async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })
    });
    const run = { runId: "dx-web-images", assets: [acquired.asset], webImageAcquisitions: [acquired.receipt] };
    const ready = await auditVisualAssetCoverage(run, { projectPath, requirements: [{ category: "company_logo", minimumCount: 1, allowReferenceOnly: true, rationale: "brand identity" }] });
    assert.equal(ready.status, "ready");
    assert.equal(ready.verifiedVisualAssets[0].sha256, acquired.receipt.sha256);
    const blocked = await auditVisualAssetCoverage(run, { projectPath, requirements: [{ category: "landmark", minimumCount: 1, allowReferenceOnly: true, rationale: "Shanghai context" }] });
    assert.equal(blocked.status, "blocked");
    const written = await writeVisualAssetCoverage({ projectPath, runId: run.runId, report: ready });
    assert.equal(JSON.parse(await readFile(written.path, "utf8")).status, "ready");
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("does not count missing or tampered image files as acquired assets", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-web-tamper-"));
  try {
    const acquired = await acquireWebImageAsset(input(projectPath), {
      lookupFn,
      fetchFn: async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })
    });
    acquired.asset.technicalRequirements.sha256 = "0".repeat(64);
    const report = await auditVisualAssetCoverage(
      { runId: "dx-web-images", assets: [acquired.asset], webImageAcquisitions: [acquired.receipt] },
      { projectPath, requirements: [{ category: "company_logo", minimumCount: 1, allowReferenceOnly: true, rationale: "brand identity" }] }
    );
    assert.equal(report.status, "blocked");
    assert.match(report.invalidVisualAssets[0].reason, /hash/);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("does not count downloaded visuals before the quality audit passes", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-web-quality-gate-"));
  try {
    const acquired = await acquireWebImageAsset(input(projectPath), { lookupFn, fetchFn: async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }) });
    const run = { runId: "dx-web-images", researchAssetPolicy: { requireQualityAudit: true }, assets: [acquired.asset], webImageAcquisitions: [acquired.receipt], assetQualityAudits: {} };
    const requirements = [{ category: "company_logo", minimumCount: 1, allowReferenceOnly: true, rationale: "brand identity" }];
    assert.equal((await auditVisualAssetCoverage(run, { projectPath, requirements })).status, "blocked");
    run.assetQualityAudits["asset-quality:mosi-logo"] = { status: "ready", assetRef: "mosi-logo", artifactRef: acquired.asset.artifactRef };
    assert.equal((await auditVisualAssetCoverage(run, { projectPath, requirements })).status, "ready");
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});
