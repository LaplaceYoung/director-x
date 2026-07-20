import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileOpenCutRenderPlan, executeOpenCutRender } from "./opencut-render.mjs";
import { inspectMediaDelivery, runProcess } from "./media-execution.mjs";

function runFixture(projectPath = "/workspace") {
  const range = (start, duration = 150) => ({ start: { value: start, rate: 30 }, duration: { value: duration, rate: 30 } });
  const timeline = { schemaVersion: "1.0", timelineId: "manual", tracks: [{ trackId: "video-main", kind: "video", clips: [
    { clipId: "a", mediaRef: "delivery.video", sourceRange: range(0), timelineRange: range(0), effects: [{ kind: "crop", x: .1, y: .1, width: .8, height: .8 }, { kind: "duck", db: -9, attackMs: 120, releaseMs: 240, range: range(30, 60) }, { kind: "transition", transitionKind: "crossfade", duration: { value: 15, rate: 30 }, toClipId: "b" }] },
    { clipId: "b", mediaRef: "delivery.video", sourceRange: range(150), timelineRange: range(150), effects: [] }
  ] }] };
  return {
    artifacts: { "delivery.video": { artifactRef: "delivery.video", path: `${projectPath}/source.mp4`, mediaKind: "video" } },
    openCutEditor: { activeSessionId: "editor", sessions: { editor: { editorSessionId: "editor", status: "render_required", patchId: "patch", timelineId: "manual", fps: 30, project: { settings: { canvasSize: { width: 1920, height: 1080 } } } } } },
    editSession: { receipt: { status: "committed", patchId: "patch" }, timelineHeads: { manual: "manual:1" }, revisions: { "manual:1": { revisionId: "manual:1", contentHash: "sha256:timeline", timeline } } }
  };
}

test("compiles crop, duck, and centered crossfade into shell-free FFmpeg argv", () => {
  const plan = compileOpenCutRenderPlan({ projectPath: "/workspace", run: runFixture(), outputPath: "outputs/edited.mp4" });
  assert.equal(plan.command, "ffmpeg");
  assert.equal(plan.expectedDurationSeconds, 10);
  assert.match(plan.filterComplex, /crop=iw\*0\.8/);
  assert.match(plan.filterComplex, /volume='if\(/);
  assert.match(plan.filterComplex, /xfade=transition=fade:duration=0\.5:offset=4\.75/);
  assert.match(plan.filterComplex, /acrossfade=d=0\.5/);
  assert.equal(plan.args.at(-1), "/workspace/outputs/edited.mp4");
  assert.ok(!plan.args.includes("sh -c"));
});

test("executes the compiled plan through the injected process runner", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-cut-render-"));
  let called;
  const result = await executeOpenCutRender({ projectPath, run: runFixture(projectPath), outputPath: "outputs/edited.mp4", timeoutMs: 5000 }, { runFn: async (command, args, options) => { called = { command, args, options }; return { command, args, exitCode: 0, stdout: "", stderr: "" }; } });
  assert.equal(called.command, "ffmpeg");
  assert.equal(called.options.failureLabel, "Director X Cut render");
  assert.equal(result.plan.patchId, "patch");
});

test("maps Director X transition language to deterministic FFmpeg transitions", () => {
  const run = runFixture();
  run.editSession.revisions["manual:1"].timeline.tracks[0].clips[0].effects.at(-1).transitionKind = "whip_pan";
  const plan = compileOpenCutRenderPlan({ projectPath: "/workspace", run, outputPath: "outputs/edited.mp4" });
  assert.match(plan.filterComplex, /xfade=transition=slideleft/);
  assert.deepEqual(plan.transitions[0], {
    fromClipId: "a",
    toClipId: "b",
    kind: "whip_pan",
    durationSeconds: 0.5,
    renderOperation: "xfade"
  });
});

test("renders semantic match cuts as frame-accurate concatenation", () => {
  const run = runFixture();
  run.editSession.revisions["manual:1"].timeline.tracks[0].clips[0].effects.at(-1).transitionKind = "match_cut";
  const plan = compileOpenCutRenderPlan({ projectPath: "/workspace", run, outputPath: "outputs/edited.mp4" });
  assert.doesNotMatch(plan.filterComplex, /xfade=/);
  assert.match(plan.filterComplex, /concat=n=2:v=1:a=0/);
  assert.equal(plan.transitions[0].renderOperation, "concat");
  assert.equal(plan.transitions[0].durationSeconds, 0);
});

test("rejects source overwrite and missing render state", () => {
  assert.throws(() => compileOpenCutRenderPlan({ projectPath: "/workspace", run: runFixture(), outputPath: "source.mp4" }), /must not overwrite/);
  assert.throws(() => compileOpenCutRenderPlan({ projectPath: "/workspace", run: runFixture(), outputPath: "outputs/edited.webm" }), /end in \.mp4/);
  const run = runFixture(); run.openCutEditor.sessions.editor.status = "running";
  assert.throws(() => compileOpenCutRenderPlan({ projectPath: "/workspace", run, outputPath: "outputs/edited.mp4" }), /render_required/);
});

test("renders a playable crop, duck, and transition result with real FFmpeg", { timeout: 30000 }, async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-cut-real-"));
  const sourcePath = join(projectPath, "source.mp4");
  await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=10", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath], { cwd: projectPath, timeoutMs: 20000, maxOutputBytes: 200000, failureLabel: "Fixture render" });
  const run = runFixture(projectPath);
  run.openCutEditor.sessions.editor.project.settings.canvasSize = { width: 320, height: 180 };
  const result = await executeOpenCutRender({ projectPath, run, outputPath: "outputs/edited.mp4", timeoutMs: 20000 });
  assert.ok((await stat(result.outputPath)).size > 0);
  const media = await inspectMediaDelivery({ projectPath, finalVideoPath: result.outputPath, requireAudio: true });
  assert.ok(Math.abs(media.durationSeconds - 10) < .15);
  assert.equal(media.videoStreams[0].width, 320);
  assert.equal(media.audioStreams.length, 1);
});
