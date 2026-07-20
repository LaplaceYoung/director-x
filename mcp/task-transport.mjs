import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export function negotiateTaskTransport(run, input, now = new Date().toISOString()) {
  const requestCapability = input.requestCapabilities?.tasks;
  const capabilityValid = input.capabilitySource === "request_meta"
    ? requestCapability?.extension === "io.modelcontextprotocol/tasks" && requestCapability?.version === "2026-01-26"
    : input.capabilitySource === "initialize" && requestCapability?.version === "2025-11-25";
  const serverTaskMethodsReady = false;
  const supportsTasks = capabilityValid && input.behaviorProbe === "passed" && serverTaskMethodsReady;
  const transport = supportsTasks ? "mcp_tasks" : "provider_job_polling";
  const fallbackReason = !capabilityValid ? "structured_task_capability_missing"
    : input.behaviorProbe !== "passed" ? `behavior_probe_${input.behaviorProbe}`
      : !serverTaskMethodsReady ? "directorx_task_methods_not_ready" : null;
  run.taskTransport = {
    schemaVersion: "2.0", transport, protocolVersion: input.protocolVersion, protocolGeneration: input.protocolGeneration,
    capabilitySource: input.capabilitySource, requestCapabilities: input.requestCapabilities ?? {}, behaviorProbe: input.behaviorProbe,
    hostBuild: input.hostBuild, negotiatedAt: now, serverTaskMethodsReady,
    fallbackReason,
    taskStateMapping: {
      working: "running", input_required: "input_required", completed: "succeeded",
      failed: "failed", cancelled: "cancelled"
    }
  };
  return run.taskTransport;
}

export function requireTaskTransport(run) {
  if (!run.taskTransport) throw new Error("Negotiate MCP Tasks support before submitting an asynchronous provider job.");
  return run.taskTransport;
}

export async function writeTaskTransport({ projectPath, runId, taskTransport }) {
  const dir = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(dir, { recursive: true });
  const path = join(dir, "task_transport.json");
  await writeFile(path, `${JSON.stringify({ runId, ...taskTransport }, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "task_transport.json", path };
}
