import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { installDirectorXMediaRuntime } from "./install-media-runtime.mjs";
import { MEDIA_RUNTIME_RELEASE, mediaRuntimePaths } from "./media-runtime.mjs";

test("force refresh reuses an existing Whisper environment and refreshes managed packages", async () => {
  const root = await mkdtemp(join(tmpdir(), "directorx-runtime-install-"));
  const paths = mediaRuntimePaths(root);
  await mkdir(dirname(paths.whisperPython), { recursive: true });
  await writeFile(paths.whisperPython, "python");
  const calls = [];
  const browserPath = join(root, "node_modules", ".remotion", "chrome-headless-shell", "chrome-headless-shell");

  const status = await installDirectorXMediaRuntime({
    root,
    force: true,
    runner: async ({ label }) => {
      calls.push(label);
      if (label === "Node media runtime") {
        for (const [path, contents] of [
          [paths.remotion, "remotion"],
          [paths.hyperframes, "hyperframes"],
          [join(root, "node_modules", "@remotion", "cli", "package.json"), JSON.stringify({ version: "4.0.484" })],
          [join(root, "node_modules", "hyperframes", "package.json"), JSON.stringify({ version: "0.7.60" })]
        ]) {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, contents);
        }
      }
      if (label === "Remotion browser") {
        await mkdir(dirname(browserPath), { recursive: true });
        await writeFile(browserPath, "browser");
      }
    }
  });

  assert.equal(status.ready, true);
  assert.equal(status.release, MEDIA_RUNTIME_RELEASE);
  assert.equal(calls.includes("Whisper Python runtime"), false);
  assert.deepEqual(calls, ["Node media runtime", "Whisper package", "Remotion browser", "HyperFrames browser"]);
});
