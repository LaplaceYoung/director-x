import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const doctorPath = fileURLToPath(new URL("./doctor-plugin.mjs", import.meta.url));

test("runs the setup doctor from an unrelated working directory with spaces", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "director x doctor "));
  try {
    const result = await run(process.execPath, [doctorPath, "--project", projectPath, "--profile", "local_video_read"], projectPath);
    assert.equal(result.exitCode, 0, result.stderr);
    const health = JSON.parse(result.stdout);
    assert.equal(health.profile, "local_video_read");
    assert.equal(health.security.secretValuesReturned, false);
    assert.equal(health.security.paidCallsPerformed, false);
    assert.ok(health.checks.some((item) => item.checkId === "plugin.identity" && item.status === "ready"));
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

async function run(command, args, cwd) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}
