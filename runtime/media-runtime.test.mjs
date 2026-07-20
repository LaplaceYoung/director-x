import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { inspectMediaRuntime, MEDIA_RUNTIME_RELEASE, mediaRuntimePaths } from "./media-runtime.mjs";

test("reports a complete managed media runtime only when all three engines are present", async () => {
  const root = await mkdtemp(join(tmpdir(), "directorx-media-runtime-"));
  const paths = mediaRuntimePaths(root);
  const remotionBrowser = join(root, "browsers", "chrome-headless-shell");
  for (const path of [paths.remotion, paths.hyperframes, paths.whisperPython, paths.whisperScript, remotionBrowser]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "runtime");
  }
  await writeFile(paths.manifest, `${JSON.stringify({ release: MEDIA_RUNTIME_RELEASE, components: { remotion: { browserExecutable: remotionBrowser } } })}\n`);
  const status = await inspectMediaRuntime({ root });
  assert.equal(status.ready, true);
  assert.equal(status.components.remotion.ready, true);
  assert.equal(status.components.hyperframes.ready, true);
  assert.equal(status.components.whisper.ready, true);
});

test("reports a stale or partial runtime as not ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "directorx-partial-runtime-"));
  const paths = mediaRuntimePaths(root);
  await mkdir(dirname(paths.remotion), { recursive: true });
  await writeFile(paths.remotion, "runtime");
  await writeFile(paths.manifest, `${JSON.stringify({ release: "old" })}\n`);
  const status = await inspectMediaRuntime({ root });
  assert.equal(status.ready, false);
  assert.equal(status.releaseMatches, false);
  assert.equal(status.components.hyperframes.ready, false);
});
