const REQUIRED_FIELDS = ["objective", "audience", "platform", "duration", "production_route", "asset_readiness"];
const USER_BOUND_FIELDS = new Set(["platform", "production_route", "asset_readiness"]);

export function confirmIntake(run, intake) {
  const byField = new Map((intake.decisions ?? []).map((decision) => [decision.field, decision]));
  const missing = REQUIRED_FIELDS.filter((field) => !byField.get(field)?.value?.trim());
  const unconfirmed = [...USER_BOUND_FIELDS].filter((field) => byField.get(field)?.source === "safe_inference");
  if (missing.length) throw new Error(`Intake is missing required production decisions: ${missing.join(", ")}`);
  if (unconfirmed.length) throw new Error(`Ask the user to confirm strategy-changing intake fields: ${unconfirmed.join(", ")}`);
  const answered = (intake.userAnswers ?? []).filter((answer) => answer?.trim());
  const asked = (intake.questionsAsked ?? []).filter((question) => question?.trim());
  if (asked.length !== answered.length) throw new Error("Every recorded intake question must have one user answer.");
  run.intakeGate = {
    ready: true,
    decisions: REQUIRED_FIELDS.map((field) => byField.get(field)),
    questionsAsked: asked,
    userAnswers: answered,
    confirmedAt: new Date().toISOString()
  };
  return run;
}

export function assertIntakeReady(run) {
  if (!run.intakeGate?.ready) throw new Error("Confirm the Director X intake gate before resolving intent or starting research.");
}

export const intakeFields = REQUIRED_FIELDS;
