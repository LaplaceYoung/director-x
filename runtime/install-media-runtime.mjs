#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectMediaRuntime,
  MEDIA_RUNTIME_NODE_PACKAGES,
  MEDIA_RUNTIME_PYTHON,
  MEDIA_RUNTIME_RELEASE,
  MEDIA_RUNTIME_SCHEMA_VERSION,
  MEDIA_RUNTIME_WHISPER_PACKAGE,
  mediaRuntimePaths
} from "./media-runtime.mjs";

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));

export async function installDirectorXMediaRuntime(options = {}) {
  const paths = mediaRuntimePaths(options.root);
  const before = await inspectMediaRuntime({ root: paths.root });
  if (before.ready && !options.force) return before;

  await mkdir(paths.root, { recursive: true });
  const packageDocument = {
    name: "directorx-builtin-media-runtime",
    private: true,
    version: MEDIA_RUNTIME_RELEASE,
    description: "User-scoped Director X media runtime. Managed by Director X; do not edit manually.",
    dependencies: MEDIA_RUNTIME_NODE_PACKAGES
  };
  await atomicWrite(paths.packageJson, `${JSON.stringify(packageDocument, null, 2)}\n`);
  await run(options, options.npmCommand ?? "npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], paths.root, "Node media runtime");

  await mkdir(resolve(paths.root, "whisper"), { recursive: true });
  if (!await exists(paths.whisperPython)) {
    await run(options, options.uvCommand ?? "uv", ["venv", "--python", MEDIA_RUNTIME_PYTHON, resolve(paths.root, "whisper", ".venv")], paths.root, "Whisper Python runtime");
  }
  await run(options, options.uvCommand ?? "uv", ["pip", "install", "--python", paths.whisperPython, MEDIA_RUNTIME_WHISPER_PACKAGE], paths.root, "Whisper package");
  await copyFile(resolve(runtimeDirectory, "transcribe_audio.py"), paths.whisperScript);

  if (!options.skipBrowser) {
    await run(options, paths.remotion, ["browser", "ensure"], paths.root, "Remotion browser");
    await run(options, paths.hyperframes, ["browser", "ensure"], paths.root, "HyperFrames browser");
  }
  const remotionBrowserExecutable = options.skipBrowser ? null : await findExecutableNamed(resolve(paths.root, "node_modules", ".remotion"), "chrome-headless-shell");
  if (!options.skipBrowser && !remotionBrowserExecutable) throw new Error("Remotion browser installation completed without a discoverable executable.");

  const versions = {
    node: process.version,
    remotion: await packageVersion(paths.root, "node_modules/@remotion/cli/package.json"),
    hyperframes: await packageVersion(paths.root, "node_modules/hyperframes/package.json"),
    whisper: MEDIA_RUNTIME_WHISPER_PACKAGE,
    python: MEDIA_RUNTIME_PYTHON
  };
  await atomicWrite(paths.manifest, `${JSON.stringify({
    schemaVersion: MEDIA_RUNTIME_SCHEMA_VERSION,
    release: MEDIA_RUNTIME_RELEASE,
    installedAt: new Date().toISOString(),
    root: paths.root,
    versions,
    components: {
      remotion: { command: paths.remotion, browserExecutable: remotionBrowserExecutable },
      hyperframes: { command: paths.hyperframes },
      whisper: { python: paths.whisperPython, script: paths.whisperScript, modelWeights: "downloaded-on-first-use" }
    }
  }, null, 2)}\n`);

  const status = await inspectMediaRuntime({ root: paths.root });
  if (!status.ready) throw new Error(`Director X media runtime installation is incomplete at ${paths.root}.`);
  return status;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findExecutableNamed(root, expectedName) {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    const match = entries.find((entry) => entry.isFile() && entry.name === expectedName);
    return match ? resolve(match.parentPath, match.name) : null;
  } catch {
    return null;
  }
}

async function packageVersion(root, relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8")).version;
}

async function run(options, command, args, cwd, label) {
  if (options.runner) return await options.runner({ command, args, cwd, label });
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} installation failed (${signal ?? code}).`));
    });
  });
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents);
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const status = await installDirectorXMediaRuntime({ force: process.argv.includes("--force"), skipBrowser: process.argv.includes("--skip-browser") });
  process.stdout.write(`Director X media runtime ready at ${status.root}.\n`);
}
