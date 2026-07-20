import test from "node:test";
import assert from "node:assert/strict";
import { negotiateTaskTransport, requireTaskTransport } from "./task-transport.mjs";

test("keeps durable polling until structured capability, behavior, and server methods all pass", () => {
  const advertised = {}; negotiateTaskTransport(advertised, { protocolVersion: "2026-01-26", protocolGeneration: "tasks_extension", capabilitySource: "request_meta", requestCapabilities: { tasks: { extension: "io.modelcontextprotocol/tasks", version: "2026-01-26" } }, behaviorProbe: "passed", hostBuild: "codex-test" });
  assert.equal(requireTaskTransport(advertised).transport, "provider_job_polling");
  assert.equal(advertised.taskTransport.fallbackReason, "directorx_task_methods_not_ready");
  const fallback = {}; negotiateTaskTransport(fallback, { protocolVersion: "2026-01-26", protocolGeneration: "tasks_extension", capabilitySource: "request_meta", requestCapabilities: {}, behaviorProbe: "not_run", hostBuild: "codex-test" });
  assert.equal(fallback.taskTransport.transport, "provider_job_polling");
  assert.equal(fallback.taskTransport.fallbackReason, "structured_task_capability_missing");
});
