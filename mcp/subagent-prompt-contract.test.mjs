import test from "node:test";
import assert from "node:assert/strict";
import { buildDelegatedSubagentPrompt, buildSubagentSystemPrompt, DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID } from "./subagent-prompt-contract.mjs";
import { DX_SUBAGENT_CATALOG } from "./subagent-registry.mjs";

function role(roleId) { return DX_SUBAGENT_CATALOG.find((item) => item.roleId === roleId); }

test("gives visual production roles distinct executable system protocols", () => {
  const shotPlanner = buildSubagentSystemPrompt(role("shot_planner"));
  const router = buildSubagentSystemPrompt(role("model_router"));
  const operator = buildSubagentSystemPrompt(role("provider_operator"));
  const drawLoop = buildSubagentSystemPrompt(role("draw_loop_controller"));
  const reviewer = buildSubagentSystemPrompt(role("quality_evaluator"));
  assert.match(shotPlanner, /Choose the generation mode before writing prompt prose/);
  assert.match(shotPlanner, /identity, product_geometry, layout, pose, style, palette, or lighting/);
  assert.match(router, /exact provider, model version, endpoint, and mode/);
  assert.match(router, /directorx_register_prompt_bound_generation_plan/);
  assert.match(operator, /Do not rewrite creative intent during submission/);
  assert.match(operator, /promptBinding and bindingSha256 as immutable/);
  assert.match(drawLoop, /Change one causal variable per repair/);
  assert.match(reviewer, /first, middle, and last states/);
  assert.ok(new Set([shotPlanner, router, operator, drawLoop, reviewer]).size === 5);
});

test("delegated prompts preserve scope, artifacts, tools, caps, and the current prompt contract", () => {
  const prompt = buildDelegatedSubagentPrompt(role("shot_planner"), {
    delegationDepth: 1, maxDelegationDepth: 1, mission: "Compile model-ready shots", stage: "storyboard",
    inputArtifactRefs: ["shotlist.json"], outputArtifactRefs: ["visual_prompt_pack.json"],
    allowedTools: ["directorx_compile_visual_prompt_pack"], restrictedTools: ["spawn_agent"],
    stopCondition: "Prompt pack registered", escalationTriggers: ["missing model evidence"], currency: "CNY", maxCost: 0, maxAttempts: 2,
    approvalBoundary: "Escalate provider changes"
  }, { projectPath: "/tmp/directorx", runId: "dx-test" });
  assert.match(prompt, new RegExp(DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID.replaceAll(".", "\\.")));
  assert.match(prompt, /visual_prompt_pack\.json/);
  assert.match(prompt, /directorx_compile_visual_prompt_pack/);
  assert.match(prompt, /at most 2 attempts/);
});
