import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DX_SUBAGENT_CATALOG } from "./subagent-registry.mjs";
import { readRun } from "./run-store.mjs";

const availableAgentTypes = DX_SUBAGENT_CATALOG.map((role) => role.agentType);
const hostToolNames = ["create_goal", "get_goal", "update_goal", "request_user_input", "exec", "wait"];
const publicToolNames = [
  "directorx_build_rough_cut",
  "directorx_decide_production",
  "directorx_generate_media",
  "directorx_get_production_status",
  "directorx_prepare_production",
  "directorx_recover_production",
  "directorx_research_video",
  "directorx_resume_production",
  "directorx_review_media_candidate",
  "directorx_start_production"
];

test("server defaults to the compact public Facade profile", async () => {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    env: { ...process.env, DIRECTORX_TOOL_PROFILE: "" },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);
    await waitFor(() => messages(output).some((message) => message.id === 1));
    assert.deepEqual(messages(output).find((message) => message.id === 1).result.tools.map((tool) => tool.name).sort(), publicToolNames);
  } finally {
    child.kill("SIGTERM");
  }
});

test("public decision Facade persists, resolves, and replays one native decision without legacy interaction tools", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-public-decision-"));
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    env: { ...process.env, DIRECTORX_TOOL_PROFILE: "public" },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });

  const call = async (id, name, args) => {
    send(id, name, args);
    await waitFor(() => messages(output).some((message) => message.id === id));
    const message = messages(output).find((item) => item.id === id);
    assert.equal(message.result.isError, undefined, JSON.stringify(message.result.structuredContent));
    return message.result.structuredContent;
  };
  const send = (id, name, args) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`);

  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);
    await waitFor(() => messages(output).some((message) => message.id === 1));
    const toolNames = messages(output).find((message) => message.id === 1).result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(toolNames, publicToolNames);

    const outcome = "Deliver a replay-safe product film";
    const started = await call(2, "directorx_start_production", {
      projectPath,
      action: "begin",
      outcome,
      availableAgentTypes,
      hostToolNames,
      hostSkillNames: ["browser:control-in-app-browser"]
    });
    await claimCanvas(started.browserCanvasUrl);
    const awaitingGoal = await call(3, "directorx_start_production", {
      projectPath,
      action: "status",
      preflightId: started.preflightId
    });
    assert.equal(awaitingGoal.hostAction.tool, "request_user_input");

    await call(4, "directorx_start_production", {
      projectPath,
      action: "resolve_goal",
      preflightId: started.preflightId,
      requestId: awaitingGoal.goalInteractionRequestId,
      confirmedBy: "request_user_input",
      answers: { enter_directorx_goal: { answers: ["进入制作 (Recommended)"] } }
    });
    const ready = await call(5, "directorx_start_production", {
      projectPath,
      action: "create",
      outcome,
      preflightId: started.preflightId,
      goalInteractionRequestId: awaitingGoal.goalInteractionRequestId,
      codexGoalId: "goal-public-decision",
      confirmedBy: "request_user_input",
      goalAccepted: true
    });
    const beforeRunMode = await call(99, "directorx_prepare_production", productionPreparationInput(projectPath, ready.runId));
    assert.equal(beforeRunMode.nextRequiredAction, "request_run_mode");

    const decisionInput = {
      projectPath,
      runId: ready.runId,
      action: "request",
      kind: "run_mode",
      gateKey: "public-run-mode",
      reason: "The production mode changes the approval cadence.",
      questions: [{
        id: "run_mode",
        header: "调用方伪造文案",
        question: "这份问题会被服务端规范化。",
        options: [
          { label: "任意模式", description: "不能改变持久化语义。" },
          { label: "任意模式 2", description: "不能改变持久化语义。" }
        ]
      }],
      application: {
        type: "run_mode",
        questionId: "run_mode"
      }
    };
    const requested = await call(6, "directorx_decide_production", decisionInput);
    assert.equal(requested.status, "pending");
    assert.equal(requested.hostAction.tool, "request_user_input");
    assert.equal(requested.hostAction.afterAnswer.tool, "directorx_decide_production");
    assert.equal(requested.hostAction.afterAnswer.arguments.action, "resolve");
    assert.equal(requested.decision.deduplicated, false);
    const pendingRunMode = await readRun({ projectPath, runId: ready.runId });
    assert.deepEqual(pendingRunMode.interactions.pending[0].questions[0].options.map((option) => option.label), ["引导自治 (Recommended)", "逐阶段确认", "全自动"]);

    const replayedRequest = await call(7, "directorx_decide_production", decisionInput);
    assert.equal(replayedRequest.decision.requestId, requested.decision.requestId);
    assert.equal(replayedRequest.decision.deduplicated, true);
    assert.equal(replayedRequest.hostAction.afterAnswer.tool, "directorx_decide_production");

    const resolved = await call(8, "directorx_decide_production", {
      projectPath,
      runId: ready.runId,
      action: "resolve",
      requestId: requested.decision.requestId,
      confirmedBy: "request_user_input",
      answers: { run_mode: { answers: ["逐阶段确认"] } }
    });
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.nextRequiredAction, "directorx_resume_production");
    assert.equal(resolved.decision.deduplicated, false);
    assert.deepEqual(resolved.application, { type: "run_mode", applied: true, value: "stage_approval" });

    const replayedResolution = await call(9, "directorx_decide_production", {
      projectPath,
      runId: ready.runId,
      action: "resolve",
      requestId: requested.decision.requestId,
      confirmedBy: "request_user_input",
      answers: { run_mode: { answers: ["逐阶段确认"] } }
    });
    assert.equal(replayedResolution.status, "resolved");
    assert.equal(replayedResolution.decision.deduplicated, true);

    let run = await readRun({ projectPath, runId: ready.runId });
    assert.equal(run.runMode.mode, "stage_approval");
    assert.equal(run.events.filter((item) => item.type === "run.mode.configured").length, 1);
    assert.equal(run.checkpoints.filter((item) => item.reason === "run.mode.configured").length, 1);

    const blockedResearch = await call(10, "directorx_research_video", { projectPath, runId: ready.runId });
    assert.equal(blockedResearch.status, "blocked");
    assert.equal(blockedResearch.nextRequiredAction, "directorx_prepare_production");

    const preparationInput = productionPreparationInput(projectPath, ready.runId);
    // Both calls enter the server before either response is consumed. The public
    // façade must create one durable native confirmation, never write a material
    // promise from unconfirmed caller input, and never ask twice on retry.
    send(11, "directorx_prepare_production", preparationInput);
    send(12, "directorx_prepare_production", preparationInput);
    await waitFor(() => messages(output).some((message) => message.id === 11) && messages(output).some((message) => message.id === 12));
    const awaitingBriefConfirmation = messages(output).find((message) => message.id === 11).result.structuredContent;
    const retriedBriefConfirmation = messages(output).find((message) => message.id === 12).result.structuredContent;
    assert.equal(messages(output).find((message) => message.id === 11).result.isError, undefined, JSON.stringify(awaitingBriefConfirmation));
    assert.equal(messages(output).find((message) => message.id === 12).result.isError, undefined, JSON.stringify(retriedBriefConfirmation));
    assert.equal(awaitingBriefConfirmation.status, "awaiting_brief_confirmation");
    assert.equal(awaitingBriefConfirmation.nextRequiredAction, "request_user_input");
    assert.equal(awaitingBriefConfirmation.hostAction.tool, "request_user_input");
    assert.equal(awaitingBriefConfirmation.hostAction.afterAnswer.type, "host_action_sequence");
    assert.deepEqual(awaitingBriefConfirmation.hostAction.afterAnswer.actions.map((item) => item.tool), ["directorx_decide_production", "directorx_prepare_production"]);
    assert.deepEqual(awaitingBriefConfirmation.hostAction.afterAnswer.actions[1].arguments.brief, preparationInput.brief);
    assert.equal(awaitingBriefConfirmation.briefConfirmation.requestId, retriedBriefConfirmation.briefConfirmation.requestId);
    run = await readRun({ projectPath, runId: ready.runId });
    assert.equal(run.projectBrief, undefined);
    assert.equal(run.deliveryPromise, undefined);
    assert.equal(run.interactions.pending.length, 1);

    const deferredBrief = await call(13, "directorx_decide_production", {
      projectPath,
      runId: ready.runId,
      action: "resolve",
      requestId: awaitingBriefConfirmation.briefConfirmation.requestId,
      confirmedBy: "request_user_input",
      answers: { confirm_production_brief: { answers: ["暂不确认"] } }
    });
    assert.deepEqual(deferredBrief.application, { type: "public_prepare", applied: false, value: "declined" });
    assert.equal(deferredBrief.nextRequiredAction, "revise_production_brief");
    const declinedBrief = await call(14, "directorx_prepare_production", preparationInput);
    assert.equal(declinedBrief.status, "brief_confirmation_declined");
    assert.equal(declinedBrief.hostAction, null);
    run = await readRun({ projectPath, runId: ready.runId });
    assert.equal(run.projectBrief, undefined);
    assert.equal(run.deliveryPromise, undefined);

    const confirmedPreparationInput = {
      ...preparationInput,
      brief: { ...preparationInput.brief, title: "Confirmed public production brief" }
    };
    const replacementBriefConfirmation = await call(15, "directorx_prepare_production", confirmedPreparationInput);
    assert.equal(replacementBriefConfirmation.status, "awaiting_brief_confirmation");
    const confirmedBrief = await call(16, "directorx_decide_production", {
      projectPath,
      runId: ready.runId,
      action: "resolve",
      requestId: replacementBriefConfirmation.briefConfirmation.requestId,
      confirmedBy: "request_user_input",
      answers: { confirm_production_brief: { answers: ["确认并继续 (Recommended)"] } }
    });
    assert.deepEqual(confirmedBrief.application, { type: "public_prepare", applied: true, value: "confirmed" });
    assert.equal(confirmedBrief.nextRequiredAction, "directorx_prepare_production");

    // Once the exact brief is confirmed, retries still deduplicate the write
    // inside the Run transaction rather than duplicating artifacts or prompts.
    send(17, "directorx_prepare_production", confirmedPreparationInput);
    send(18, "directorx_prepare_production", confirmedPreparationInput);
    await waitFor(() => messages(output).some((message) => message.id === 17) && messages(output).some((message) => message.id === 18));
    const prepared = messages(output).find((message) => message.id === 17).result.structuredContent;
    const retriedPreparation = messages(output).find((message) => message.id === 18).result.structuredContent;
    assert.equal(messages(output).find((message) => message.id === 17).result.isError, undefined, JSON.stringify(prepared));
    assert.equal(messages(output).find((message) => message.id === 18).result.isError, undefined, JSON.stringify(retriedPreparation));
    assert.equal(prepared.pipelineId, "brand-film");
    assert.ok(prepared.complexityProfile);
    assert.equal(prepared.researchReadiness.ready, false);
    assert.equal(prepared.nextRequiredAction, "request_stage_approval");
    assert.equal(retriedPreparation.nextRequiredAction, "request_stage_approval");

    const stageApproval = await call(19, "directorx_decide_production", {
      projectPath,
      runId: ready.runId,
      action: "request",
      kind: "stage_approval",
      gateKey: "public-stage-approval:research",
      reason: "Starting research is the next explicit stage boundary.",
      questions: [{
        id: "research_stage",
        header: "开始研究",
        question: "是否开始参考资料、素材和脚本研究？",
        options: [
          { label: "开始研究 (Recommended)", description: "开始不会产生付费生成。" },
          { label: "暂不开始", description: "保留当前制作准备，稍后继续。" }
        ]
      }],
      application: {
        type: "stage_approval",
        questionId: "research_stage",
        stageId: "research",
        note: "Research approved through the native stage gate.",
        selections: [
          { answerLabel: "开始研究 (Recommended)", approved: true },
          { answerLabel: "暂不开始", approved: false }
        ]
      }
    });
    const resolvedStageApproval = await call(20, "directorx_decide_production", {
      projectPath,
      runId: ready.runId,
      action: "resolve",
      requestId: stageApproval.decision.requestId,
      confirmedBy: "request_user_input",
      answers: { research_stage: { answers: ["开始研究 (Recommended)"] } }
    });
    assert.deepEqual(resolvedStageApproval.application, { type: "stage_approval", applied: true, value: "research" });

    const research = await call(21, "directorx_research_video", { projectPath, runId: ready.runId });
    assert.equal(research.researchStatus, "reference_research_started");
    assert.equal(research.stage, "research");
    const status = await call(22, "directorx_get_production_status", { projectPath, runId: ready.runId });
    const resumed = await call(23, "directorx_resume_production", { projectPath, runId: ready.runId });
    assert.equal(resumed.resumeActionPlan.protocol, "public_resume");
    const roughCut = await call(24, "directorx_build_rough_cut", { projectPath, runId: ready.runId, action: "inspect" });
    assert.equal(roughCut.status, "blocked");
    assert.equal(roughCut.nextRequiredAction, "directorx_review_media_candidate");
    assertNoHiddenToolNames([blockedResearch, prepared, retriedPreparation, stageApproval, resolvedStageApproval, research, status, resumed], toolNames);

    run = await readRun({ projectPath, runId: ready.runId });
    assert.equal(run.stage, "research");
    assert.equal(run.pipeline.stageStates.research.status, "active");
    assert.equal(run.stageApprovals.research.status, "approved");
    assert.equal(run.interactions.history.filter((item) => item.requestId === requested.decision.requestId).length, 1);
    assert.equal(run.interactions.history.filter((item) => item.requestId === awaitingBriefConfirmation.briefConfirmation.requestId).length, 1);
    assert.equal(run.interactions.history.filter((item) => item.requestId === replacementBriefConfirmation.briefConfirmation.requestId).length, 1);
    assert.equal(run.interactions.history.filter((item) => item.requestId === stageApproval.decision.requestId).length, 1);
    assert.equal(run.publicProductionBriefConfirmation.confirmed, true);
    assert.equal(run.publicProductionPreparation.confirmationRequestId, replacementBriefConfirmation.briefConfirmation.requestId);
    const intakeArtifact = JSON.parse(await readFile(run.artifacts["intake_confirmation.json"].path, "utf8"));
    const intentArtifact = JSON.parse(await readFile(run.artifacts["intent_resolution.json"].path, "utf8"));
    assert.equal(intakeArtifact.confirmation.requestId, replacementBriefConfirmation.briefConfirmation.requestId);
    assert.equal(intakeArtifact.confirmation.fingerprint, run.publicProductionPreparation.fingerprint);
    assert.equal(intentArtifact.confirmation.requestId, replacementBriefConfirmation.briefConfirmation.requestId);
    assert.equal(run.events.filter((item) => item.type === "interaction.requested").length, 4);
    assert.equal(run.events.filter((item) => item.type === "interaction.resolved").length, 4);
  } finally {
    child.kill("SIGTERM");
    await rm(projectPath, { recursive: true, force: true });
  }
});

async function claimCanvas(browserCanvasUrl) {
  const url = new URL(browserCanvasUrl);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const heartbeat = await fetch(`${url.origin}/directorx/api/surface-heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session: url.searchParams.get("session"),
      claimToken: url.searchParams.get("claim"),
      surface: "canvas",
      visibility: "visible",
      event: "boot"
    })
  });
  assert.equal(heartbeat.status, 200);
}

function assertNoHiddenToolNames(results, publicToolNames) {
  const publicNames = new Set(publicToolNames);
  for (const result of results) {
    const names = JSON.stringify(result).match(/directorx_[a-z0-9_]+/g) ?? [];
    for (const name of names) assert.ok(publicNames.has(name), `public result exposed unavailable tool ${name}`);
  }
}

function productionPreparationInput(projectPath, runId) {
  return {
    projectPath,
    runId,
    pipelineId: "brand-film",
    brief: {
      objective: "Introduce a new workspace product with one clear outcome.",
      audience: "Product teams evaluating an AI workspace.",
      platform: "LinkedIn",
      durationSeconds: 30,
      aspectRatio: "16:9",
      productionRoute: "AI-generated visuals with rights-safe web assets",
      assetReadiness: "Brand references will be acquired during research.",
      videoType: "brand_film",
      qualityTarget: "professional",
      budgetCap: { currency: "CNY", amount: 10 },
      shotCount: 4,
      modalities: ["image", "video", "voice", "music"],
      characterContinuity: false,
      deliveryTier: "review"
    }
  };
}

function messages(output) {
  return output.trim().split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; }
    catch { return []; }
  });
}

async function waitFor(predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for MCP response.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
