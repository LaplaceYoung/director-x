import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { diagnosePluginHealth, requiredChecksForProfile } from "./plugin-health.mjs";

const readyRuntime = () => ({
  release: "2026.07.16.1",
  releaseMatches: true,
  components: {
    remotion: { ready: true, browserPath: "/managed/browser" },
    hyperframes: { ready: true },
    whisper: { ready: true }
  },
  manifest: { versions: { whisper: "faster-whisper==1.2.1" } }
});

function dependencies(overrides = {}) {
  return {
    commandProbe: async (command, args) => ({ available: true, exitCode: 0, version: `${command} test`, args }),
    writableProbe: async () => ({ ready: true }),
    inspectMediaRuntime: async () => readyRuntime(),
    inspectCodexAgentRoles: async () => ({ diskReady: true, sessionReady: true, sessionMode: "builtin_compatibility" }),
    detectCodexHostCapabilities: () => ({ capabilities: { native_goal_lifecycle: { status: "ready" }, native_user_input: { status: "ready" }, loop_execution: { status: "ready" } } }),
    ...overrides
  };
}

async function diagnose(input = {}, overrides = {}) {
  const projectPath = input.projectPath ?? await mkdtemp(join(tmpdir(), "directorx-health-"));
  return await diagnosePluginHealth({ projectPath, profile: "zero_key_edit", sourceKind: "local", nodeVersion: "v22.18.0", ...input }, dependencies(overrides));
}

test("reports a clean zero-key edit route as ready and offers a behavioral smoke proof", async () => {
  const result = await diagnose();
  assert.equal(result.status, "ready");
  assert.equal(result.nextAction.actionId, "run_zero_key_smoke_test");
  assert.equal(result.security.mutationPerformed, false);
  assert.deepEqual(result.blockers, []);
});

test("blocks missing FFmpeg and FFprobe with one bounded external instruction", async () => {
  const result = await diagnose({}, { commandProbe: async () => ({ available: false, exitCode: null, version: null }) });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("runtime.ffmpeg"));
  assert.ok(result.blockers.includes("runtime.ffprobe"));
  assert.equal(result.nextAction.command, "brew install ffmpeg");
  assert.equal(result.nextAction.kind, "external_instruction");
});

test("distinguishes an installed FFmpeg binary from a failed behavioral probe", async () => {
  const result = await diagnose({}, {
    commandProbe: async (command, args) => args.includes("color=c=black:s=16x16:d=0.1")
      ? { available: true, exitCode: 1, version: "ffmpeg test" }
      : { available: true, exitCode: 0, version: `${command} test` }
  });
  assert.equal(result.checks.find((item) => item.checkId === "runtime.ffmpeg").status, "ready");
  assert.equal(result.checks.find((item) => item.checkId === "runtime.ffmpeg.behavior").status, "blocked");
  assert.equal(result.nextAction.actionId, "repair_ffmpeg");
});

test("requires yt-dlp only for a remote video route", async () => {
  const commandProbe = async (command) => command === "yt-dlp" ? { available: false, exitCode: null } : { available: true, exitCode: 0, version: `${command} test` };
  const local = await diagnose({ profile: "local_video_read", sourceKind: "local" }, { commandProbe });
  const remote = await diagnose({ profile: "local_video_read", sourceKind: "url" }, { commandProbe });
  assert.equal(local.status, "ready");
  assert.equal(local.checks.find((item) => item.checkId === "runtime.ytdlp").status, "optional_missing");
  assert.equal(remote.status, "blocked");
  assert.ok(remote.blockers.includes("runtime.ytdlp"));
});

test("routes a stale managed runtime to the plugin-owned installer", async () => {
  const result = await diagnose({ profile: "local_composition" }, {
    inspectMediaRuntime: async () => ({ releaseMatches: false, components: { remotion: { ready: false, browserPath: null }, hyperframes: { ready: false }, whisper: { ready: false } }, manifest: null })
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.nextAction.actionId, "install_managed_runtime");
  assert.equal(result.nextAction.kind, "plugin_owned");
});

test("does not claim local composition readiness when the managed browser is missing", async () => {
  const runtime = readyRuntime();
  runtime.components.remotion = { ready: false, browserPath: null };
  const result = await diagnose({ profile: "local_composition" }, { inspectMediaRuntime: async () => runtime });
  assert.ok(result.blockers.includes("managed.remotion"));
  assert.ok(result.blockers.includes("managed.browser"));
});

test("distinguishes DX roles on disk from roles loaded in the current Codex session", async () => {
  const result = await diagnose({
    profile: "planning_only",
    hostToolNames: ["create_goal", "get_goal", "update_goal", "request_user_input", "exec"],
    availableAgentTypes: ["default"]
  }, {
    inspectCodexAgentRoles: async () => ({ diskReady: true, sessionReady: false, sessionMode: "unavailable" })
  });
  assert.equal(result.checks.find((item) => item.checkId === "host.agents").status, "restart_required");
  assert.equal(result.nextAction.actionId, "restart_codex");
});

test("detects a stale installed plugin cache version", async () => {
  const result = await diagnose({ expectedPluginVersion: "0.1.0+codex.future" });
  assert.ok(result.blockers.includes("plugin.cache_version"));
  assert.equal(result.checks.find((item) => item.checkId === "plugin.cache_version").status, "restart_required");
});

test("blocks a project output path that is not writable", async () => {
  const result = await diagnose({}, { writableProbe: async () => ({ ready: false }) });
  assert.ok(result.blockers.includes("workspace.writable"));
  assert.equal(result.nextAction.actionId, "choose_writable_workspace");
});

test("reports missing provider credentials without returning secret-shaped values", async () => {
  const result = await diagnose({
    profile: "provider_generation",
    providerCredentialConfigured: false,
    hostToolNames: ["create_goal", "get_goal", "update_goal", "request_user_input", "exec"],
    availableAgentTypes: ["default"]
  });
  assert.ok(result.blockers.includes("provider.credential"));
  assert.equal(result.nextAction.actionId, "configure_provider_credential");
  assert.doesNotMatch(JSON.stringify(result), /secret-value|Bearer\s|apiKey/);
});

test("exposes a stable task-profile dependency graph", () => {
  assert.deepEqual(requiredChecksForProfile("local_video_read", { sourceKind: "url", transcriptionRequested: true }).slice(-2), ["runtime.ytdlp", "managed.whisper"]);
  assert.throws(() => requiredChecksForProfile("invented"), /Unknown Director X health profile/);
});
