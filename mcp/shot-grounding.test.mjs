import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindShotGroundingPlanToShotlist, compileShotGroundingPlan, finalizeShotGrounding, writeShotGroundingArtifacts } from "./shot-grounding.mjs";

const hash = "a".repeat(64);
const baseShots = [{
  shotId: "S01",
  order: 1,
  purpose: "Establish the official brand and Shanghai location",
  visualDescription: "MOSI logo resolves over Shanghai skyline",
  durationSeconds: 4,
  generationMode: "text_to_image",
  modelTier: "weak",
  namedEntities: [
    { entityId: "mosi", name: "MOSI Intelligence", kind: "logo" },
    { entityId: "shanghai", name: "Shanghai skyline", kind: "landmark" }
  ],
  exactText: ["MOSI Intelligence"],
  factualClaimIds: ["claim-company-location"],
  userAssetRefs: [],
  continuitySensitive: true
}];

function boundPlan() {
  return bindShotGroundingPlanToShotlist(
    compileShotGroundingPlan({ planId: "grounding-1", sequenceId: "seq-1", shots: baseShots }, "2026-07-17T00:00:00.000Z"),
    {
      sha256: hash,
      shotlist: { shots: [{ shotId: "S01", purpose: baseShots[0].purpose, durationSeconds: 4 }] }
    }
  );
}

test("compiles explicit per-shot grounding triggers and binds to the real shotlist", () => {
  const plan = boundPlan();
  assert.equal(plan.status, "awaiting_research");
  assert.equal(plan.sourceBinding.sha256, hash);
  assert.ok(plan.tasks.some((item) => item.trigger === "named_logo"));
  assert.ok(plan.tasks.some((item) => item.trigger === "named_landmark"));
  assert.ok(plan.tasks.some((item) => item.trigger === "exact_text"));
  assert.ok(plan.tasks.some((item) => item.trigger === "factual_claim"));
  assert.ok(plan.tasks.some((item) => item.trigger === "continuity_sensitive"));
  assert.ok(plan.tasks.some((item) => item.trigger === "weak_model_named_entity"));
  assert.throws(() => bindShotGroundingPlanToShotlist(plan, {
    sha256: hash,
    shotlist: { shots: [{ shotId: "S01", purpose: "Different purpose", durationSeconds: 4 }] }
  }), /purpose drifts/);
});

test("produces a ready grounding report only from durable evidence and audited generation anchors", () => {
  const plan = boundPlan();
  const asset = { id: "mosi-logo", artifactRef: "web_image:mosi-logo", localPath: "/tmp/mosi-logo.png", rightsStatus: "licensed" };
  const run = {
    shotGroundingPlan: plan,
    assets: [asset],
    references: [],
    artifacts: {
      "web_image:mosi-logo": { artifactRef: "web_image:mosi-logo" },
      "official-company-page.json": { artifactRef: "official-company-page.json" }
    },
    assetQualityAudits: {
      "asset-quality:mosi-logo": { status: "ready", assetRef: "mosi-logo", artifactRef: "web_image:mosi-logo" }
    }
  };
  const resolutions = plan.tasks.map((task) => ({
    taskId: task.taskId,
    status: "resolved",
    assetRefs: task.trigger === "named_logo" ? ["mosi-logo"] : [],
    evidenceRefs: task.trigger === "named_logo" ? ["web_image:mosi-logo"] : ["official-company-page.json"],
    transferRule: `Use verified ${task.trigger} evidence without copying unsupported source pixels.`,
    rightsUse: task.trigger === "named_logo" ? "generation_anchor" : "fact_only"
  }));
  const report = finalizeShotGrounding(run, { planId: plan.planId, reportId: "grounding-report-1", resolutions }, "2026-07-17T00:10:00.000Z");
  assert.equal(report.status, "ready");
  assert.deepEqual(report.shots[0].authorizedGenerationAnchorRefs, ["mosi-logo"]);
  assert.ok(report.evidenceRefs.includes("official-company-page.json"));
});

test("blocks unaudited or reference-only assets from generation anchors", () => {
  const plan = boundPlan();
  const logoTask = plan.tasks.find((task) => task.trigger === "named_logo");
  const run = {
    shotGroundingPlan: plan,
    assets: [{ id: "logo", artifactRef: "web_image:logo", localPath: "/tmp/logo.png", rightsStatus: "reference_only" }],
    artifacts: { "web_image:logo": {} },
    assetQualityAudits: {}
  };
  assert.throws(() => finalizeShotGrounding(run, {
    planId: plan.planId,
    reportId: "blocked",
    resolutions: [{
      taskId: logoTask.taskId,
      status: "resolved",
      assetRefs: ["logo"],
      evidenceRefs: ["web_image:logo"],
      transferRule: "Use logo",
      rightsUse: "generation_anchor"
    }]
  }), /incompatible rights/);
});

test("writes JSON and user-facing Markdown grounding artifacts", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-grounding-"));
  try {
    const plan = boundPlan();
    const written = await writeShotGroundingArtifacts({ projectPath, runId: "dx-grounding", plan });
    assert.equal(written.plan.artifactRef, "shot_grounding_plan.json");
    assert.equal(written.planSummary.artifactRef, "shot_grounding_plan.md");
    assert.match(await readFile(written.planSummary.path, "utf8"), /逐镜头 Grounding 计划/);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
