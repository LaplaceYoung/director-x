import test from "node:test";
import assert from "node:assert/strict";
import { requestNativeInteraction, resolveNativeInteraction } from "./interaction-gates.mjs";

const question = {
  id: "budget_route",
  header: "预算",
  question: "请选择本次制作预算。",
  options: [
    { label: "零外部预算", description: "只使用已批准的本地与 Codex 能力。" },
    { label: "允许付费", description: "可调用已确认的外部模型。" }
  ]
};

test("deduplicates a pending native question and emits the exact host action", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const first = requestNativeInteraction(run, { kind: "budget", reason: "Budget changes the production route.", questions: [question] }, "2026-07-15T00:00:00.000Z");
  const second = requestNativeInteraction(run, { kind: "budget", reason: "Budget changes the production route.", questions: [question] }, "2026-07-15T00:00:01.000Z");
  assert.equal(first.request.requestId, second.request.requestId);
  assert.equal(run.interactions.pending.length, 1);
  assert.equal(first.hostAction.tool, "request_user_input");
  assert.deepEqual(first.hostAction.arguments.questions, [question]);
});

test("resolves only through request_user_input and never reopens a resolved request", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const { request } = requestNativeInteraction(run, { kind: "budget", reason: "Budget changes the production route.", questions: [question] });
  assert.throws(() => resolveNativeInteraction(run, { requestId: request.requestId, confirmedBy: "chat", answers: { budget_route: "零外部预算" } }), /request_user_input/);
  assert.throws(
    () => resolveNativeInteraction(run, { requestId: request.requestId, confirmedBy: "request_user_input", answers: { budget_route: "零外部预算" } }),
    /raw request_user_input answer envelope/
  );
  const resolved = resolveNativeInteraction(run, { requestId: request.requestId, confirmedBy: "request_user_input", answers: { budget_route: { answers: ["零外部预算"] } } });
  assert.equal(resolved.status, "resolved");
  assert.equal(run.interactions.pending.length, 0);
  assert.equal(run.interactions.history.length, 1);
  const replay = requestNativeInteraction(run, { kind: "budget", reason: "Budget changes the production route.", questions: [question] });
  assert.equal(replay.request.requestId, request.requestId);
  assert.equal(replay.request.status, "resolved");
  assert.equal(run.interactions.pending.length, 0);
});

test("normalizes the structured answer envelope returned by Codex", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const { request } = requestNativeInteraction(run, { kind: "budget", reason: "Budget changes the production route.", questions: [question] });
  const resolved = resolveNativeInteraction(run, {
    requestId: request.requestId,
    confirmedBy: "request_user_input",
    answers: { budget_route: { answers: ["零外部预算"] } }
  });
  assert.deepEqual(resolved.answers, { budget_route: "零外部预算" });
});

test("rejects unstructured free text that does not identify an offered option", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const { request } = requestNativeInteraction(run, { kind: "budget", reason: "Budget changes the production route.", questions: [question] });
  assert.throws(
    () => resolveNativeInteraction(run, { requestId: request.requestId, confirmedBy: "request_user_input", answers: { budget_route: { answers: ["先不纠结预算"] } } }),
    /must match one of the offered options/
  );
});

test("accepts provider free text when the native question explicitly offers custom input", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const providerQuestion = {
    ...question,
    options: [...question.options, { label: "其他 / 自定义", description: "填写具体供应商或模型。" }]
  };
  const { request } = requestNativeInteraction(run, { kind: "provider_input", reason: "Resolve the exact provider model.", questions: [providerQuestion] });
  const resolved = resolveNativeInteraction(run, {
    requestId: request.requestId,
    confirmedBy: "request_user_input",
    answers: { budget_route: { answers: ["z-image turbo"] } }
  });
  assert.equal(resolved.answers.budget_route, "z-image turbo");
});

test("supersedes a materially changed pending question instead of creating duplicate blockers", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const first = requestNativeInteraction(run, { kind: "budget", reason: "Budget changes the route.", questions: [question] });
  const changedQuestion = { ...question, question: "请选择本次正式制作预算上限。" };
  const second = requestNativeInteraction(run, { kind: "budget", reason: "Budget changes the route.", questions: [changedQuestion] });
  assert.equal(second.request.supersedes, first.request.requestId);
  assert.equal(run.interactions.pending.length, 1);
  assert.equal(run.interactions.history[0].status, "superseded");
});

test("keeps independent same-kind provider questions separate by gateKey", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const first = requestNativeInteraction(run, { kind: "provider_input", gateKey: "job:video-1", reason: "Video job needs input.", questions: [question] });
  const second = requestNativeInteraction(run, { kind: "provider_input", gateKey: "job:voice-1", reason: "Voice job needs input.", questions: [question] });
  assert.notEqual(first.request.requestId, second.request.requestId);
  assert.equal(run.interactions.pending.length, 2);
  assert.equal(run.interactions.history.length, 0);
});

test("does not replay a reference authorization for a different source", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const first = requestNativeInteraction(run, {
    kind: "reference_download", gateKey: "reference_download", sourceUrl: "https://example.com/first", referenceId: "ref-1",
    reason: "Authorize local reference analysis.", questions: [{ id: "allow", header: "授权", question: "允许下载第一条参考吗？", options: [{ label: "允许", description: "仅用于本地分析。" }, { label: "拒绝", description: "不下载。" }] }]
  });
  const second = requestNativeInteraction(run, {
    kind: "reference_download", gateKey: "reference_download", sourceUrl: "https://example.com/second", referenceId: "ref-2",
    reason: "Authorize local reference analysis.", questions: [{ id: "allow", header: "授权", question: "允许下载第二条参考吗？", options: [{ label: "允许", description: "仅用于本地分析。" }, { label: "拒绝", description: "不下载。" }] }]
  });
  assert.notEqual(first.request.requestId, second.request.requestId);
  assert.equal(second.request.supersedes, first.request.requestId);
  assert.equal(run.interactions.pending.length, 1);
  assert.equal(run.interactions.pending[0].requestId, second.request.requestId);
});

test("treats a legacy pending request without gateKey as the default kind gate", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const first = requestNativeInteraction(run, { kind: "budget", reason: "Budget changes the route.", questions: [question] });
  delete first.request.gateKey;
  const changedQuestion = { ...question, question: "请选择更新后的预算上限。" };
  const second = requestNativeInteraction(run, { kind: "budget", reason: "Budget changes the route.", questions: [changedQuestion] });
  assert.equal(second.request.supersedes, first.request.requestId);
  assert.equal(run.interactions.pending.length, 1);
});

test("supports the post-production manual editing decision as a native gate", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const result = requestNativeInteraction(run, {
    kind: "post_production_edit",
    reason: "A reviewed final candidate is ready for optional manual editing.",
    questions: [{
      id: "post_production_edit",
      header: "成片剪辑",
      question: "是否进入 Director X Cut 做手工剪辑？",
      options: [
        { label: "进入剪辑 (Recommended)", description: "启动本地剪辑服务并在侧边栏编辑。" },
        { label: "直接交付", description: "跳过手工剪辑并进入最终交付确认。" }
      ]
    }]
  });
  assert.equal(result.hostAction.tool, "request_user_input");
  assert.equal(result.request.kind, "post_production_edit");
});

test("supports background music as an independent native production gate", () => {
  const run = { runId: "dx-test", interactions: { pending: [], history: [] } };
  const result = requestNativeInteraction(run, {
    kind: "music_route",
    reason: "Background music ownership changes video-native audio and final mix behavior.",
    questions: [{
      id: "music_route",
      header: "背景音乐",
      question: "这支片的背景音乐从哪里来？",
      options: [
        { label: "正版曲库检索 (Recommended)", description: "搜索并审核可商用音乐。" },
        { label: "使用本地音乐", description: "审核用户已有的本地配乐。" }
      ]
    }]
  });
  assert.equal(result.request.kind, "music_route");
  assert.equal(result.hostAction.tool, "request_user_input");
});
