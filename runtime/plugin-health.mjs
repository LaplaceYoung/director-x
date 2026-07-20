import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, constants, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCodexAgentRoles } from "../mcp/codex-agent-roles.mjs";
import { detectCodexHostCapabilities } from "../mcp/codex-host-capabilities.mjs";
import { inspectMediaRuntime, MEDIA_RUNTIME_RELEASE } from "./media-runtime.mjs";

export const PLUGIN_HEALTH_SCHEMA_VERSION = "1.0";
export const PLUGIN_HEALTH_PROFILES = Object.freeze([
  "planning_only",
  "local_video_read",
  "zero_key_edit",
  "local_composition",
  "provider_generation",
  "full_production"
]);
export const PLUGIN_HEALTH_STATUSES = Object.freeze([
  "ready",
  "installed_unverified",
  "optional_missing",
  "repairable",
  "permission_required",
  "restart_required",
  "blocked",
  "unsupported"
]);

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_REQUIREMENTS = Object.freeze({
  planning_only: ["plugin.identity", "plugin.cache_version", "runtime.node", "workspace.writable", "host.goal", "host.input", "host.agents", "host.loop"],
  local_video_read: ["plugin.identity", "plugin.cache_version", "runtime.node", "workspace.writable", "runtime.ffmpeg", "runtime.ffprobe"],
  zero_key_edit: ["plugin.identity", "plugin.cache_version", "runtime.node", "workspace.writable", "runtime.ffmpeg", "runtime.ffprobe", "runtime.ffmpeg.behavior"],
  local_composition: ["plugin.identity", "plugin.cache_version", "runtime.node", "workspace.writable", "runtime.ffmpeg", "runtime.ffprobe", "runtime.ffmpeg.behavior", "managed.release", "managed.remotion", "managed.hyperframes", "managed.browser"],
  provider_generation: ["plugin.identity", "plugin.cache_version", "runtime.node", "workspace.writable", "host.goal", "host.input", "provider.credential"],
  full_production: ["plugin.identity", "plugin.cache_version", "runtime.node", "workspace.writable", "runtime.ffmpeg", "runtime.ffprobe", "runtime.ffmpeg.behavior", "managed.release", "managed.remotion", "managed.hyperframes", "managed.browser", "host.goal", "host.input", "host.agents", "host.loop"]
});

export async function diagnosePluginHealth(input = {}, dependencies = {}) {
  const profile = normalizeProfile(input.profile);
  const projectPath = resolve(String(input.projectPath || process.cwd()));
  const readJson = dependencies.readJson ?? defaultReadJson;
  const commandProbe = dependencies.commandProbe ?? defaultCommandProbe;
  const writableProbe = dependencies.writableProbe ?? defaultWritableProbe;
  const inspectRuntime = dependencies.inspectMediaRuntime ?? inspectMediaRuntime;
  const inspectRoles = dependencies.inspectCodexAgentRoles ?? inspectCodexAgentRoles;
  const detectHost = dependencies.detectCodexHostCapabilities ?? detectCodexHostCapabilities;
  const root = resolve(input.pluginRoot || pluginRoot);

  const [manifest, packageDocument, mcpConfig, workspaceWritable, ffmpeg, ffprobe, ffmpegBehavior, ytdlp, managedRuntime] = await Promise.all([
    safeJson(readJson, resolve(root, ".codex-plugin", "plugin.json")),
    safeJson(readJson, resolve(root, "package.json")),
    safeJson(readJson, resolve(root, ".mcp.json")),
    writableProbe(projectPath),
    commandProbe("ffmpeg", ["-hide_banner", "-version"]),
    commandProbe("ffprobe", ["-hide_banner", "-version"]),
    commandProbe("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.1", "-frames:v", "1", "-f", "null", "-"]),
    input.sourceKind === "url" ? commandProbe("yt-dlp", ["--version"]) : Promise.resolve({ available: false, skipped: true }),
    inspectRuntime({ root: input.mediaRuntimeRoot })
  ]);

  const hostObserved = Boolean((input.hostToolNames?.length ?? 0) || (input.hostSkillNames?.length ?? 0) || (input.availableAgentTypes?.length ?? 0));
  const host = detectHost({ toolNames: input.hostToolNames ?? [], skillNames: input.hostSkillNames ?? [], availableAgentTypes: input.availableAgentTypes ?? [] });
  const roles = await inspectRoles(projectPath, { availableAgentTypes: input.availableAgentTypes ?? [], userHome: input.userHome });
  const installedVersion = manifest.value?.version ?? null;
  const expectedVersion = input.expectedPluginVersion ?? installedVersion;
  const identityReady = manifest.ok
    && packageDocument.ok
    && mcpConfig.ok
    && mcpConfig.value?.mcpServers?.["directorx-production"]?.args?.includes("./mcp/server.mjs")
    && String(installedVersion ?? "").startsWith(`${packageDocument.value?.version ?? ""}+codex.`);

  const checks = [
    check("plugin.identity", identityReady ? "ready" : "blocked", {
      observedVersion: installedVersion,
      evidence: identityReady ? "manifest_package_and_mcp_paths_match" : "plugin_package_contract_incomplete",
      action: identityReady ? null : externalAction("reinstall_plugin", "Reinstall or update the Director X plugin from its configured marketplace, then fully restart Codex.", null, true)
    }),
    check("plugin.cache_version", !expectedVersion || expectedVersion === installedVersion ? "ready" : "restart_required", {
      observedVersion: installedVersion,
      evidence: expectedVersion === installedVersion ? "installed_cache_matches_expected_version" : "installed_cache_version_mismatch",
      action: expectedVersion === installedVersion ? null : externalAction("restart_codex", "Fully quit and reopen Codex so it loads the updated Director X plugin cache.", null, true)
    }),
    check("runtime.node", nodeMajor(input.nodeVersion ?? process.version) >= 22 ? "ready" : "unsupported", {
      observedVersion: input.nodeVersion ?? process.version,
      evidence: nodeMajor(input.nodeVersion ?? process.version) >= 22 ? "node_version_supported" : "node_22_or_newer_required",
      action: nodeMajor(input.nodeVersion ?? process.version) >= 22 ? null : externalAction("upgrade_node", "Install Node.js 22 or newer, then restart Codex.", "brew install node@22", true)
    }),
    check("workspace.writable", workspaceWritable.ready ? "ready" : "blocked", {
      evidence: workspaceWritable.ready ? "workspace_write_permission_observed" : "workspace_not_writable",
      action: workspaceWritable.ready ? null : externalAction("choose_writable_workspace", "Choose a writable project folder or repair its filesystem permissions.")
    }),
    executableCheck("runtime.ffmpeg", ffmpeg, "brew install ffmpeg"),
    executableCheck("runtime.ffprobe", ffprobe, "brew install ffmpeg"),
    check("runtime.ffmpeg.behavior", ffmpegBehavior.available && ffmpegBehavior.exitCode === 0 ? "ready" : ffmpeg.available ? "blocked" : "blocked", {
      observedVersion: ffmpeg.version,
      evidence: ffmpegBehavior.available && ffmpegBehavior.exitCode === 0 ? "behavioral_encode_decode_probe_passed" : ffmpeg.available ? "ffmpeg_behavioral_probe_failed" : "ffmpeg_unavailable",
      action: ffmpegBehavior.available && ffmpegBehavior.exitCode === 0 ? null : externalAction("repair_ffmpeg", "Reinstall FFmpeg and verify that a local lavfi frame can be decoded.", "brew reinstall ffmpeg")
    }),
    check("runtime.ytdlp", input.sourceKind !== "url" ? "optional_missing" : ytdlp.available && ytdlp.exitCode === 0 ? "ready" : "blocked", {
      observedVersion: ytdlp.version,
      evidence: input.sourceKind !== "url" ? "not_required_for_local_input" : ytdlp.available ? "yt_dlp_version_observed" : "yt_dlp_missing_for_url_input",
      action: input.sourceKind !== "url" || ytdlp.available ? null : externalAction("install_ytdlp", "Install yt-dlp before reading a remote video URL.", "brew install yt-dlp")
    }),
    managedCheck("managed.release", managedRuntime.releaseMatches, managedRuntime.releaseMatches ? "managed_runtime_release_matches" : "managed_runtime_missing_or_stale"),
    managedCheck("managed.remotion", managedRuntime.components?.remotion?.ready, managedRuntime.components?.remotion?.ready ? "remotion_and_browser_present" : "remotion_or_browser_missing"),
    managedCheck("managed.hyperframes", managedRuntime.components?.hyperframes?.ready, managedRuntime.components?.hyperframes?.ready ? "hyperframes_present" : "hyperframes_missing"),
    managedCheck("managed.browser", Boolean(managedRuntime.components?.remotion?.browserPath), managedRuntime.components?.remotion?.browserPath ? "managed_browser_present" : "managed_browser_missing"),
    check("managed.whisper", !input.transcriptionRequested ? "optional_missing" : managedRuntime.components?.whisper?.ready ? "installed_unverified" : "repairable", {
      observedVersion: managedRuntime.manifest?.versions?.whisper ?? null,
      evidence: !input.transcriptionRequested ? "transcription_not_requested" : managedRuntime.components?.whisper?.ready ? "whisper_runtime_present_model_weights_unverified" : "whisper_runtime_missing",
      action: input.transcriptionRequested && !managedRuntime.components?.whisper?.ready ? pluginAction("install_managed_runtime", "Install the pinned Director X media runtime.") : null
    }),
    hostCheck("host.goal", hostObserved, host.capabilities?.native_goal_lifecycle?.status === "ready", "native_goal_lifecycle"),
    hostCheck("host.input", hostObserved, host.capabilities?.native_user_input?.status === "ready", "native_user_input"),
    hostCheck("host.loop", hostObserved, host.capabilities?.loop_execution?.status === "ready", "durable_loop"),
    check("host.agents", !hostObserved ? "installed_unverified" : roles.sessionReady ? "ready" : roles.diskReady ? "restart_required" : "repairable", {
      evidence: !hostObserved ? "current_codex_session_not_observed" : roles.sessionReady ? `agent_route_${roles.sessionMode}` : roles.diskReady ? "dx_roles_on_disk_but_not_loaded" : "dx_roles_not_installed",
      requiresRestart: Boolean(hostObserved && roles.diskReady && !roles.sessionReady),
      action: !hostObserved ? null : roles.sessionReady ? null : roles.diskReady ? externalAction("restart_codex", "Fully quit and reopen Codex so the current session can load the installed DX roles.", null, true) : pluginAction("install_dx_roles", "Install or synchronize plugin-managed DX role files for the current user.")
    }),
    check("provider.credential", input.providerCredentialConfigured ? "ready" : "permission_required", {
      evidence: input.providerCredentialConfigured ? "session_credential_reference_present" : "selected_provider_credential_missing",
      action: input.providerCredentialConfigured ? null : externalAction("configure_provider_credential", "Configure the selected provider credential through Director X's secure session-only setup.")
    })
  ];

  const requiredIds = new Set(PROFILE_REQUIREMENTS[profile]);
  if (input.sourceKind === "url") requiredIds.add("runtime.ytdlp");
  if (input.transcriptionRequested) requiredIds.add("managed.whisper");
  for (const item of checks) {
    item.requiredFor = PLUGIN_HEALTH_PROFILES.filter((candidate) => PROFILE_REQUIREMENTS[candidate].includes(item.checkId));
    item.required = requiredIds.has(item.checkId);
    if (!item.required && ["blocked", "repairable", "permission_required", "restart_required", "unsupported"].includes(item.status)) item.status = "optional_missing";
  }

  const requiredChecks = checks.filter((item) => item.required);
  const blockers = requiredChecks.filter((item) => ["repairable", "permission_required", "restart_required", "blocked", "unsupported"].includes(item.status)).map((item) => item.checkId);
  const unverified = requiredChecks.filter((item) => item.status === "installed_unverified").map((item) => item.checkId);
  const nextAction = checks.find((item) => item.required && item.action)?.action
    ?? (blockers.length === 0 && ["zero_key_edit", "local_composition", "full_production"].includes(profile) ? pluginAction("run_zero_key_smoke_test", "Create and verify a two-second local Director X setup preview.") : null);
  const status = blockers.length ? "blocked" : unverified.length ? "degraded" : "ready";
  const result = {
    schemaVersion: PLUGIN_HEALTH_SCHEMA_VERSION,
    healthId: healthFingerprint({ projectPath, profile, installedVersion, checks }),
    profile,
    status,
    ready: status === "ready",
    plugin: { version: installedVersion, expectedVersion, mediaRuntimeRelease: MEDIA_RUNTIME_RELEASE },
    checks,
    blockers,
    unverified,
    nextAction,
    smokeTestEligible: blockers.length === 0 && ["zero_key_edit", "local_composition", "full_production"].includes(profile),
    security: { secretValuesReturned: false, paidCallsPerformed: false, mutationPerformed: false }
  };
  return redactHealthResult(result);
}

export function requiredChecksForProfile(profile, options = {}) {
  const normalized = normalizeProfile(profile);
  const ids = new Set(PROFILE_REQUIREMENTS[normalized]);
  if (options.sourceKind === "url") ids.add("runtime.ytdlp");
  if (options.transcriptionRequested) ids.add("managed.whisper");
  return [...ids];
}

function normalizeProfile(profile) {
  const value = profile || "zero_key_edit";
  if (!PLUGIN_HEALTH_PROFILES.includes(value)) throw new Error(`Unknown Director X health profile: ${value}`);
  return value;
}

function check(checkId, status, details = {}) {
  if (!PLUGIN_HEALTH_STATUSES.includes(status)) throw new Error(`Invalid health status for ${checkId}: ${status}`);
  return { checkId, status, required: false, requiredFor: [], observedVersion: details.observedVersion ?? null, evidence: details.evidence ?? "not_observed", repairActionId: details.action?.actionId ?? null, requiresRestart: Boolean(details.requiresRestart ?? details.action?.requiresRestart), action: details.action ?? null };
}

function executableCheck(checkId, probe, installCommand) {
  const ready = probe.available && probe.exitCode === 0;
  return check(checkId, ready ? "ready" : "blocked", {
    observedVersion: probe.version,
    evidence: ready ? "executable_version_observed" : "executable_missing_or_failed",
    action: ready ? null : externalAction(`install_${checkId.split(".").at(-1)}`, `Install ${checkId.split(".").at(-1)} and rerun the Director X doctor.`, installCommand)
  });
}

function managedCheck(checkId, ready, evidence) {
  return check(checkId, ready ? "ready" : "repairable", { evidence, action: ready ? null : pluginAction("install_managed_runtime", "Install the pinned Director X media runtime.") });
}

function hostCheck(checkId, observed, ready, evidenceId) {
  return check(checkId, !observed ? "installed_unverified" : ready ? "ready" : "blocked", {
    evidence: !observed ? "current_codex_session_not_observed" : ready ? `${evidenceId}_ready` : `${evidenceId}_missing`,
    action: !observed || ready ? null : externalAction("restart_or_update_codex", `Enable ${evidenceId.replaceAll("_", " ")} in the current Codex host, then rerun setup diagnosis.`, null, true)
  });
}

function pluginAction(actionId, label) {
  return { actionId, kind: "plugin_owned", label, requiresApproval: true, requiresRestart: actionId === "install_dx_roles", command: null };
}

function externalAction(actionId, label, command = null, requiresRestart = false) {
  return { actionId, kind: "external_instruction", label, requiresApproval: true, requiresRestart, command };
}

async function defaultReadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function safeJson(readJson, path) {
  try { return { ok: true, value: await readJson(path) }; }
  catch { return { ok: false, value: null }; }
}

async function defaultWritableProbe(path) {
  try { await access(path, constants.W_OK); return { ready: true }; }
  catch { return { ready: false }; }
}

async function defaultCommandProbe(command, args) {
  try {
    const result = await runCommand(command, args, 8000);
    const line = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).find(Boolean) ?? null;
    return { available: true, exitCode: result.exitCode, version: line?.slice(0, 160) ?? null };
  } catch (error) {
    return { available: false, exitCode: null, version: null, errorCode: error?.code ?? "command_failed" };
  }
}

async function runCommand(command, args, timeoutMs) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 65536) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 65536) stderr += chunk.toString("utf8"); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (exitCode) => { clearTimeout(timer); resolvePromise({ exitCode, stdout, stderr }); });
  });
}

function nodeMajor(version) {
  return Number(String(version ?? "").replace(/^v/, "").split(".")[0]) || 0;
}

function healthFingerprint(value) {
  return `dxh-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function redactHealthResult(value) {
  const serialized = JSON.stringify(value);
  if (/(?:api[_-]?key|authorization|bearer|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*["'][^"']+/i.test(serialized)) {
    throw new Error("Director X health output contained credential-shaped data.");
  }
  return JSON.parse(serialized);
}
