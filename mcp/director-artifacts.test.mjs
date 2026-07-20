import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeliveryPromise, compileProjectBrief, writeDeliveryPromise, writeDirectorDocument, writeIntakeConfirmation, writeIntentResolution, writeProjectBrief } from "./director-artifacts.mjs";
import { assertReferenceDownloadAuthorized, ingestReferenceVideo } from "./reference-ingest.mjs";

test("writes resolved intent and project Director.md artifacts", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-director-"));
  const runId = "dx-test-run";
  try {
    const intake = await writeIntakeConfirmation({ projectPath, runId, intake: { decisions: [{ field: "platform", value: "官网", source: "user", rationale: "用户确认" }], questionsAsked: ["发布在哪里？"], userAnswers: ["官网"] } });
    assert.equal(intake.artifactRef, "intake_confirmation.json");
    const intent = await writeIntentResolution({ projectPath, runId, resolution: { clarity: "clarified", rawIntent: "科技宣传片", resolvedIntent: "60 秒品牌片", directorPrompt: "以冷静精密的镜头建立可信技术感", questionsAsked: ["面向谁？"], userAnswers: ["企业客户"], safeInferences: [], unresolvedRisks: [] } });
    assert.equal(intent.artifactRef, "intent_resolution.json");
    const director = await writeDirectorDocument({ projectPath, runId, director: {
      title: "科技品牌片", logline: "让复杂智能变得可感知", audience: "企业客户", platform: "官网", duration: "60s", aspectRatio: "16:9", objective: "建立技术信任",
      directorInterpretation: "从抽象系统到真实业务结果", hook: "数据城市被点亮", beatProgression: "问题—能力—证据—愿景", visualLanguage: "克制的未来现实主义", cameraGrammar: "稳定推进与微距", composition: "秩序化构图", lightingColor: "冷灰与品牌强调色", performanceDirection: "真实工程师状态", audioDirection: "低频空间感", musicDirection: "渐进电子乐", editRhythm: "前紧后稳", promptStrategy: "写动作、机位、光线变化", researchPlan: "搜索官方事实与授权资产", styleThesis: "把系统能力拍成可验证的秩序", worldBehavior: "界面响应遵循因果", textureMaterial: "石墨与真实屏幕反射", typographyGraphics: "功能性排版", temporalGrammar: "由问题收束到证据", continuityAnchors: ["品牌色"], negativeRules: ["不使用空泛科技粒子"], reviewCriteria: ["技术信息准确"], approvalBoundaries: ["预算与模型需确认"]
    } });
    assert.equal(director.artifactRef, "Director.md");
    const content = await readFile(director.path, "utf8");
    assert.match(content, /Director1\.md main loop/);
    assert.match(content, /克制的未来现实主义/);
    assert.match(content, /Shot Inheritance Contract/);
    const contract = JSON.parse(await readFile(director.contractPath, "utf8"));
    assert.match(contract.fingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.ok(contract.directives.some((item) => item.id === "DIR-CAMERA"));
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("compiles the missing fast-start brief and delivery promise artifacts", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-fast-start-artifacts-"));
  const runId = "dx-fast-start";
  try {
    const brief = compileProjectBrief(runId, { videoType: "brand_film", targetPlatform: "官网", budgetCap: { currency: "CNY", amount: 10 }, durationSeconds: 30, qualityTarget: "professional", runMode: "guided_autonomy" });
    assert.equal(brief.target_platform, "官网");
    assert.equal(brief.run_mode, "guided_autonomy");
    const delivery = compileDeliveryPromise(runId, brief, { promise: "一支可播放的品牌短片", primaryViewerOutcome: "理解产品价值", minimumFinalScore: 0.8, minimumShotScore: 0.72, requiredArtifacts: ["script_or_outline.json", "final_review.json"], requiredTracks: ["visual", "voiceover_or_dialogue"], primaryProductionPath: "ai_generation_plus_web_assets" });
    assert.equal(delivery.delivery_promise.duration_seconds, 30);
    assert.equal(delivery.approved_production_paths[0].path, "ai_generation_plus_web_assets");
    const writtenBrief = await writeProjectBrief({ projectPath, runId, brief: { videoType: "brand_film", targetPlatform: "官网", budgetCap: { currency: "CNY", amount: 10 }, durationSeconds: 30, qualityTarget: "professional", runMode: "guided_autonomy" } });
    const writtenDelivery = await writeDeliveryPromise({ projectPath, runId, brief: writtenBrief.artifact, delivery: { promise: "一支可播放的品牌短片", primaryViewerOutcome: "理解产品价值", minimumFinalScore: 0.8, minimumShotScore: 0.72, requiredArtifacts: ["script_or_outline.json", "final_review.json"], requiredTracks: ["visual", "voiceover_or_dialogue"], primaryProductionPath: "ai_generation_plus_web_assets" } });
    assert.equal(JSON.parse(await readFile(writtenDelivery.path, "utf8")).quality_floor.minimum_final_score, 0.8);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("blocks reference video download without explicit authorization", async () => {
  await assert.rejects(() => ingestReferenceVideo({ projectPath: "/tmp", runId: "dx-test", url: "https://example.com/video", referenceId: "ref", downloadAuthorized: false, rightsStatus: "reference_only" }), /explicit user confirmation/);
  assert.throws(() => assertReferenceDownloadAuthorized({ consent: null, referenceId: "ref", url: "https://example.com/video" }), /recorded user authorization/);
  assert.throws(() => assertReferenceDownloadAuthorized({ consent: { decision: "authorized", confirmationMethod: "request_user_input", purpose: "local_reference_analysis", referenceIds: ["ref"], sourceUrls: ["https://example.com/other"] }, referenceId: "ref", url: "https://example.com/video" }), /does not cover this source URL/);
  assert.doesNotThrow(() => assertReferenceDownloadAuthorized({ consent: { decision: "authorized", confirmationMethod: "request_user_input", purpose: "local_reference_analysis", referenceIds: ["ref"], sourceUrls: ["https://example.com/video"] }, referenceId: "ref", url: "https://example.com/video" }));
});
