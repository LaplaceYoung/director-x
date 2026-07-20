import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUserFacingRunSummary,
  conciseToolResult,
  DIRECTORX_CONVERSATION_POLICY,
  friendlyToolTitle
} from "./conversation-ux.mjs";

test("turns durable production state into a concise consumer-facing update", () => {
  const summary = buildUserFacingRunSummary({
    stage: "generation",
    status: "production_in_progress",
    pipeline: {
      stages: [{ id: "intake" }, { id: "generation" }],
      stageStates: { intake: { status: "complete" }, generation: { status: "active" } }
    },
    interactions: { pending: [] },
    artifacts: {
      script: { mediaKind: "document", relativePath: "script.md" },
      receipt: { mediaKind: "document", relativePath: "provider_receipt.json" },
      image: { mediaKind: "image", relativePath: "hero.png" }
    }
  });
  assert.equal(summary.stageLabel, "生成素材");
  assert.equal(summary.statusLabel, "制作中");
  assert.equal(summary.completedStages, 1);
  assert.deepEqual(summary.visibleResults, { documents: 1, images: 1, videos: 0, audio: 0 });
  assert.doesNotMatch(summary.headline, /MCP|JSON|artifact|provider|runtime|tool|\.json/i);
});

test("prioritizes the one pending user decision without exposing internal IDs", () => {
  const summary = buildUserFacingRunSummary({
    stage: "generation",
    status: "production_in_progress",
    interactions: { pending: [{ requestId: "dxq-secret-internal-id", kind: "video_model", status: "pending" }] },
    artifacts: {}
  });
  assert.equal(summary.awaitingUser, true);
  assert.equal(summary.pendingDecisionLabel, "视频生成方式");
  assert.equal(summary.headline, "需要你确认视频生成方式，确认后会继续制作。");
  assert.doesNotMatch(JSON.stringify(summary), /dxq-secret-internal-id/);
});

test("surfaces a repeated tool failure as a concise recovery pause", () => {
  const summary = buildUserFacingRunSummary({
    stage: "research",
    status: "production_in_progress",
    recoveryGate: { status: "blocked", kind: "tool_failure", nextRequiredAction: "resolve_reference_download" },
    interactions: { pending: [] },
    artifacts: {}
  });
  assert.equal(summary.headline, "当前环节已暂停，处理后会从最近进度继续。");
  assert.equal(summary.statusLabel, "制作中");
});

test("gives every MCP operation a short human title and compact success text", () => {
  assert.equal(friendlyToolTitle("directorx_capability_preflight"), "准备制作空间");
  assert.equal(friendlyToolTitle("directorx_get_preflight_status"), "确认侧边画布");
  assert.equal(friendlyToolTitle("directorx_plan_production_team"), "安排并行制作团队");
  assert.equal(friendlyToolTitle("directorx_compile_camera_continuity_graph"), "整理镜头与衔接");
  assert.equal(friendlyToolTitle("directorx_compile_scene_coverage_plan"), "设计场景与摄影覆盖");
  assert.equal(friendlyToolTitle("directorx_compile_transition_language_plan"), "设计镜头转场");
  assert.equal(friendlyToolTitle("directorx_review_shot_sequence"), "审查镜头节奏");
  assert.equal(friendlyToolTitle("directorx_compile_shot_grounding_plan"), "规划逐镜头素材");
  assert.equal(friendlyToolTitle("directorx_finalize_shot_grounding"), "确认镜头素材依据");
  assert.equal(friendlyToolTitle("directorx_verify_final_media"), "全面检查成片");
  assert.equal(friendlyToolTitle("directorx_update_canvas_review_note"), "处理画布审片反馈");
  assert.equal(conciseToolResult("directorx_record_event", { userFacingSummary: { headline: "正在打磨脚本。" } }), "正在打磨脚本。");
  assert.equal(DIRECTORX_CONVERSATION_POLICY.maxSentencesPerUpdate, 2);
});
