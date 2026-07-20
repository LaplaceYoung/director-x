import assert from "node:assert/strict";
import test from "node:test";
import { createPluginRepairRegistry } from "./plugin-repair.mjs";

const health = (actionId = "install_managed_runtime", kind = "plugin_owned") => ({
  healthId: "dxh-test",
  profile: "local_composition",
  nextAction: { actionId, kind, label: "Repair", requiresApproval: true, requiresRestart: false, command: null }
});

test("requires native acceptance and enforces project, expiry, and one-shot boundaries", async () => {
  let clock = 1000;
  const registry = createPluginRepairRegistry({ ttlMs: 100, now: () => clock });
  const plan = registry.issue({ projectPath: "/tmp/project-a", health: health() });
  await assert.rejects(registry.execute({ planId: plan.planId, projectPath: "/tmp/project-a", confirmedBy: "chat", repairAccepted: true }), /request_user_input/);
  await assert.rejects(registry.execute({ planId: plan.planId, projectPath: "/tmp/project-b", confirmedBy: "request_user_input", repairAccepted: true }), /project-scoped/);
  clock = 1200;
  await assert.rejects(registry.execute({ planId: plan.planId, projectPath: "/tmp/project-a", confirmedBy: "request_user_input", repairAccepted: true }), /expired/);

  clock = 2000;
  const fresh = registry.issue({ projectPath: "/tmp/project-a", health: health() });
  const result = await registry.execute({ planId: fresh.planId, projectPath: "/tmp/project-a", confirmedBy: "request_user_input", repairAccepted: true }, { install_managed_runtime: async () => ({ ready: true }) });
  assert.equal(result.plan.consumed, true);
  await assert.rejects(registry.execute({ planId: fresh.planId, projectPath: "/tmp/project-a", confirmedBy: "request_user_input", repairAccepted: true }, { install_managed_runtime: async () => ({ ready: true }) }), /already been consumed/);
});

test("never executes an external package-manager instruction as an internal repair", async () => {
  const registry = createPluginRepairRegistry();
  const plan = registry.issue({ projectPath: "/tmp/project", health: health("install_ffmpeg", "external_instruction") });
  assert.equal(plan.executable, false);
  await assert.rejects(registry.execute({ planId: plan.planId, projectPath: "/tmp/project", confirmedBy: "request_user_input", repairAccepted: true }), /external host action/);
});

test("keeps a repair plan retryable when execution itself fails", async () => {
  const registry = createPluginRepairRegistry();
  const plan = registry.issue({ projectPath: "/tmp/project", health: health() });
  await assert.rejects(registry.execute({ planId: plan.planId, projectPath: "/tmp/project", confirmedBy: "request_user_input", repairAccepted: true }, { install_managed_runtime: async () => { throw new Error("verification failed"); } }), /verification failed/);
  assert.equal(registry.inspect(plan.planId).consumed, false);
});
