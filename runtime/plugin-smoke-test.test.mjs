import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSetupSmokeTestPlan, runPluginSmokeTest } from "./plugin-smoke-test.mjs";

test("compiles a shell-free bounded audiovisual smoke plan", () => {
  const plan = buildSetupSmokeTestPlan("/tmp/Director X Project");
  assert.equal(plan.durationSeconds, 2);
  assert.equal(plan.commands.length, 4);
  assert.ok(plan.commands.every((command) => Array.isArray(command.args)));
  assert.ok(plan.commands[0].args.includes("libx264"));
  assert.match(plan.clipPath, /Director X Project/);
});

test("creates, probes, decodes, previews, and idempotently replaces a real zero-key setup clip", { timeout: 30000 }, async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-smoke-"));
  const first = await runPluginSmokeTest({ projectPath });
  const second = await runPluginSmokeTest({ projectPath });
  assert.equal(first.status, "passed");
  assert.equal(first.evidence.decoded, true);
  assert.equal(first.productionRunCreated, false);
  assert.equal(first.providerBudgetConsumed, false);
  assert.equal(second.media.clipSha256, first.media.clipSha256);
  await access(second.media.clipPath);
  await access(second.media.thumbnailPath);
  await access(second.receiptPath);
});
