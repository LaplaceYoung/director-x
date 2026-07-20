import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("SIGTERM gracefully closes the loopback canvas service", async () => {
  const fixture = await startCanvasServer("signal");
  try {
    fixture.child.kill("SIGTERM");
    const exit = await fixture.exit;
    assert.deepEqual(exit, { code: 143, signal: null });
    await assert.rejects(fetch(fixture.browserCanvasUrl));
  } finally {
    fixture.child.kill("SIGKILL");
    await rm(fixture.projectPath, { recursive: true, force: true });
  }
});

test("stdin EOF closes the loopback canvas service once", async () => {
  const fixture = await startCanvasServer("stdin");
  try {
    fixture.child.stdin.end();
    const exit = await fixture.exit;
    assert.deepEqual(exit, { code: 0, signal: null });
    await assert.rejects(fetch(fixture.browserCanvasUrl));
  } finally {
    fixture.child.kill("SIGKILL");
    await rm(fixture.projectPath, { recursive: true, force: true });
  }
});

async function startCanvasServer(label) {
  const projectPath = await mkdtemp(join(tmpdir(), `directorx-shutdown-${label}-`));
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "pipe"] });
  const exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "directorx_capability_preflight", arguments: { projectPath, outcome: "Shutdown test", availableAgentTypes: ["default", "worker", "explorer"] } } })}\n`);
  await waitFor(() => parseMessages(output).some((message) => message.id === 1), 2_000);
  const response = parseMessages(output).find((message) => message.id === 1);
  if (response.result?.isError) throw new Error(response.result.content?.[0]?.text ?? "Preflight failed.");
  return { projectPath, child, exit, browserCanvasUrl: response.result.structuredContent.browserCanvasUrl };
}

function parseMessages(output) {
  return output.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; }
    catch { return []; }
  });
}

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for Director X MCP response.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
