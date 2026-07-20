import test from "node:test";
import assert from "node:assert/strict";
import { assertIntakeReady, confirmIntake } from "./intake-gate.mjs";

const decisions = [
  { field: "objective", value: "Build brand trust", source: "brief", rationale: "Explicit request" },
  { field: "audience", value: "Enterprise buyers", source: "safe_inference", rationale: "Company film default" },
  { field: "platform", value: "Official website", source: "user", rationale: "Answered intake question" },
  { field: "duration", value: "60 seconds", source: "brief", rationale: "Explicit request" },
  { field: "production_route", value: "AI motion-design hybrid", source: "user", rationale: "Answered intake question" },
  { field: "asset_readiness", value: "Logo available; UI pending", source: "user", rationale: "Answered intake question" }
];

test("requires user confirmation for strategy-changing fields omitted by a vague brief", () => {
  const vague = structuredClone(decisions);
  vague.find((item) => item.field === "platform").source = "safe_inference";
  assert.throws(() => confirmIntake({}, { decisions: vague, questionsAsked: [], userAnswers: [] }), /Ask the user to confirm.*platform/);
});

test("records a complete intake gate before intent resolution", () => {
  const run = {};
  confirmIntake(run, { decisions, questionsAsked: ["Where will it run?", "Which production route?"], userAnswers: ["Official website", "AI motion-design hybrid"] });
  assert.equal(run.intakeGate.ready, true);
  assert.doesNotThrow(() => assertIntakeReady(run));
});
