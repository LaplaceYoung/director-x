import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspaceMediaFile } from "./workspace-media-access.mjs";

test("resolves regular files inside the real workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "directorx-workspace-media-"));
  await mkdir(join(workspace, "media"));
  await writeFile(join(workspace, "media", "clip.mp4"), "video");
  const result = await resolveWorkspaceMediaFile(workspace, "media/clip.mp4");
  assert.equal(result.path, await realpath(join(workspace, "media", "clip.mp4")));
  assert.equal(result.size, 5);
});

test("rejects lexical traversal outside the workspace", async () => {
  const parent = await mkdtemp(join(tmpdir(), "directorx-workspace-parent-"));
  const workspace = join(parent, "workspace");
  await mkdir(workspace);
  await writeFile(join(parent, "outside.mp4"), "video");
  await assert.rejects(resolveWorkspaceMediaFile(workspace, "../outside.mp4"), (error) => error.statusCode === 403);
});

test("rejects symlinks that resolve outside the workspace", async () => {
  const parent = await mkdtemp(join(tmpdir(), "directorx-workspace-symlink-"));
  const workspace = join(parent, "workspace");
  await mkdir(workspace);
  await writeFile(join(parent, "outside.mp4"), "video");
  await symlink(join(parent, "outside.mp4"), join(workspace, "escaped.mp4"));
  await assert.rejects(resolveWorkspaceMediaFile(workspace, "escaped.mp4"), (error) => error.statusCode === 403);
});
