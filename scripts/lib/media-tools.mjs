import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const TOOL_CONFIG = {
  ffmpeg: { env: "DIRECTORX_FFMPEG", versionArgs: ["-version"] },
  ffprobe: { env: "DIRECTORX_FFPROBE", versionArgs: ["-version"] },
  "yt-dlp": { env: "DIRECTORX_YT_DLP", versionArgs: ["--version"] }
};

export async function resolveMediaTool(name, options = {}) {
  const result = await inspectMediaTool(name, options);
  if (result.available) return result.path;
  if (options.optional) return null;
  throw new Error(
    `${name} is unavailable. Set ${result.env}, place the binary in ${result.managedDirectory}, or install it on PATH.`
  );
}

export async function inspectMediaTool(name, options = {}) {
  const config = TOOL_CONFIG[name];
  if (!config) throw new Error(`Unknown media tool: ${name}`);

  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const pluginRoot = resolve(options.pluginRoot || fileURLToPath(new URL("../../", import.meta.url)));
  const userRoot = resolve(options.homeDir || homedir(), ".directorx");
  const runtimeName = `${platform}-${arch}`;
  const managedDirectory = join(pluginRoot, "runtime", "bin", runtimeName);
  const candidates = [
    { path: env[config.env], source: "environment" },
    ...packagedCandidates(name, pluginRoot, platform, arch),
    { path: join(managedDirectory, name), source: "plugin-runtime" },
    { path: join(userRoot, "bin", runtimeName, name), source: "user-runtime" },
    ...pathCandidates(name, env.PATH).map((path) => ({ path, source: "path" }))
  ].filter((candidate) => candidate.path);

  for (const candidate of candidates) {
    if (await isExecutable(candidate.path)) {
      return {
        name,
        available: true,
        path: resolve(candidate.path),
        source: candidate.source,
        env: config.env,
        managedDirectory
      };
    }
  }

  return {
    name,
    available: false,
    path: null,
    source: null,
    env: config.env,
    managedDirectory
  };
}

export async function doctorMediaTools(options = {}) {
  const tools = {};
  for (const name of Object.keys(TOOL_CONFIG)) {
    const result = await inspectMediaTool(name, options);
    tools[name] = result.available
      ? { ...result, version: await readVersion(result.path, TOOL_CONFIG[name].versionArgs) }
      : result;
  }
  return {
    ok: tools.ffmpeg.available && tools.ffprobe.available,
    readyForUrlAnalysis: tools.ffmpeg.available && tools.ffprobe.available && tools["yt-dlp"].available,
    node: {
      available: Number(process.versions.node.split(".")[0]) >= 22,
      version: process.version,
      required: ">=22"
    },
    tools
  };
}

function packagedCandidates(name, pluginRoot, platform, arch) {
  const candidates = [];
  if (name === "ffmpeg") {
    candidates.push({ path: requirePackagePath(pluginRoot, "ffmpeg-static"), source: "plugin-dependency" });
  } else if (name === "ffprobe") {
    candidates.push({
      path: requirePackagePath(pluginRoot, "@derhuerst/ffprobe-static"),
      source: "plugin-dependency"
    });
  } else if (name === "yt-dlp" && platform === "darwin") {
    candidates.push({
      path: join(pluginRoot, "runtime", "bin", "darwin-universal", "yt-dlp"),
      source: "plugin-runtime"
    });
  }
  return candidates.filter((candidate) => candidate.path);
}

function requirePackagePath(pluginRoot, packageName) {
  try {
    const require = createRequire(join(pluginRoot, "package.json"));
    const value = require(packageName);
    return typeof value === "string" ? value : value?.path;
  } catch {
    return null;
  }
}

function pathCandidates(name, pathValue = "") {
  return String(pathValue)
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, name));
}

async function isExecutable(filePath) {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readVersion(command, args) {
  try {
    const output = await capture(command, args);
    return output.trim().split("\n")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

function capture(command, args) {
  return new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectCapture);
    child.once("exit", (code) => {
      if (code === 0) resolveCapture(stdout || stderr);
      else rejectCapture(new Error(`${command} exited with ${code}`));
    });
  });
}
