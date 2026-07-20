import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const MEDIA_RUNTIME_SCHEMA_VERSION = "1.0";
export const MEDIA_RUNTIME_RELEASE = "2026.07.16.1";
export const MEDIA_RUNTIME_NODE_PACKAGES = Object.freeze({
  "@remotion/cli": "4.0.484",
  hyperframes: "0.7.60",
  react: "19.2.7",
  "react-dom": "19.2.7",
  remotion: "4.0.484"
});
export const MEDIA_RUNTIME_PYTHON = "3.12";
export const MEDIA_RUNTIME_WHISPER_PACKAGE = "faster-whisper==1.2.1";

export function defaultMediaRuntimeRoot(homeDirectory = homedir()) {
  return join(homeDirectory, ".directorx", "media-runtime", MEDIA_RUNTIME_RELEASE);
}

export function mediaRuntimePaths(root = process.env.DIRECTORX_MEDIA_RUNTIME_ROOT || defaultMediaRuntimeRoot()) {
  const runtimeRoot = resolve(root);
  const windows = process.platform === "win32";
  return {
    root: runtimeRoot,
    manifest: join(runtimeRoot, "runtime-manifest.json"),
    packageJson: join(runtimeRoot, "package.json"),
    nodeModules: join(runtimeRoot, "node_modules"),
    remotion: join(runtimeRoot, "node_modules", ".bin", windows ? "remotion.cmd" : "remotion"),
    hyperframes: join(runtimeRoot, "node_modules", ".bin", windows ? "hyperframes.cmd" : "hyperframes"),
    whisperPython: join(runtimeRoot, "whisper", ".venv", windows ? "Scripts" : "bin", windows ? "python.exe" : "python"),
    whisperScript: join(runtimeRoot, "whisper", "transcribe_audio.py")
  };
}

export async function inspectMediaRuntime(options = {}) {
  const paths = mediaRuntimePaths(options.root);
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(paths.manifest, "utf8"));
  } catch {
    // A missing or incomplete manifest is represented by ready=false below.
  }
  const remotionExecutable = await executableState(paths.remotion);
  const remotionBrowserPath = manifest?.components?.remotion?.browserExecutable ?? null;
  const remotionBrowser = remotionBrowserPath ? await executableState(remotionBrowserPath) : { ready: false, path: null };
  const components = {
    remotion: { ready: remotionExecutable.ready && remotionBrowser.ready, path: paths.remotion, browserPath: remotionBrowser.path },
    hyperframes: await executableState(paths.hyperframes),
    whisper: (await executableState(paths.whisperPython)).ready && (await executableState(paths.whisperScript)).ready
      ? { ready: true, pythonPath: paths.whisperPython, scriptPath: paths.whisperScript }
      : { ready: false, pythonPath: paths.whisperPython, scriptPath: paths.whisperScript }
  };
  const releaseMatches = manifest?.release === MEDIA_RUNTIME_RELEASE;
  return {
    schemaVersion: MEDIA_RUNTIME_SCHEMA_VERSION,
    release: MEDIA_RUNTIME_RELEASE,
    root: paths.root,
    manifestPath: paths.manifest,
    ready: Boolean(releaseMatches && Object.values(components).every((component) => component.ready)),
    releaseMatches,
    components,
    manifest,
    installCommand: "pnpm install:runtime"
  };
}

async function executableState(path) {
  try {
    await access(path);
    return { ready: true, path };
  } catch {
    return { ready: false, path };
  }
}
