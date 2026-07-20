import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const EXECUTABLE_ACTIONS = new Set(["install_managed_runtime", "install_dx_roles", "run_zero_key_smoke_test"]);

export function createPluginRepairRegistry({ ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const plans = new Map();

  return Object.freeze({
    issue({ projectPath, health, context = {} }) {
      if (!projectPath || !health?.healthId) throw new Error("Repair plans require a project path and health result.");
      const action = health.nextAction;
      if (!action) return null;
      const plan = {
        schemaVersion: "1.0",
        planId: `dxrepair-${randomUUID()}`,
        projectPath: resolve(projectPath),
        healthId: health.healthId,
        profile: health.profile,
        action,
        context: structuredClone(context),
        executable: action.kind === "plugin_owned" && EXECUTABLE_ACTIONS.has(action.actionId),
        issuedAtMs: now(),
        expiresAtMs: now() + ttlMs,
        consumedAtMs: null
      };
      plans.set(plan.planId, plan);
      return publicPlan(plan);
    },

    inspect(planId) {
      const plan = plans.get(planId);
      return plan ? publicPlan(plan) : null;
    },

    async execute({ planId, projectPath, confirmedBy, repairAccepted }, handlers = {}) {
      const plan = plans.get(planId);
      if (!plan) throw new Error("Unknown Director X setup repair plan.");
      if (plan.projectPath !== resolve(projectPath)) throw new Error("Director X setup repair plans are project-scoped.");
      if (plan.consumedAtMs) throw new Error("Director X setup repair plan has already been consumed.");
      if (now() > plan.expiresAtMs) throw new Error("Director X setup repair plan has expired; diagnose again.");
      if (confirmedBy !== "request_user_input" || repairAccepted !== true) throw new Error("Director X setup repair requires explicit Codex request_user_input acceptance.");
      if (!plan.executable) throw new Error("This setup blocker requires an external host action and cannot be auto-repaired by Director X.");
      const handler = handlers[plan.action.actionId];
      if (typeof handler !== "function") throw new Error(`No bounded repair handler is registered for ${plan.action.actionId}.`);
      const execution = await handler({ plan: publicPlan(plan), context: structuredClone(plan.context) });
      plan.consumedAtMs = now();
      return {
        schemaVersion: "1.0",
        plan: publicPlan(plan),
        execution,
        verificationRequired: true,
        security: { explicitApprovalObserved: true, externalInstallerExecuted: false, credentialValuesReturned: false }
      };
    }
  });
}

function publicPlan(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    planId: plan.planId,
    healthId: plan.healthId,
    profile: plan.profile,
    action: structuredClone(plan.action),
    executable: plan.executable,
    expiresAt: new Date(plan.expiresAtMs).toISOString(),
    consumed: Boolean(plan.consumedAtMs)
  };
}
