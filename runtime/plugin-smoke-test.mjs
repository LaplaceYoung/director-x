import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const SETUP_SMOKE_TEST_ID = "directorx-zero-key-local-v1";

export function buildSetupSmokeTestPlan(projectPath, options = {}) {
  const root = resolve(projectPath, ".directorx", "setup", "diagnostics");
  const durationSeconds = options.durationSeconds ?? 2;
  const fps = options.fps ?? 24;
  const width = options.width ?? 640;
  const height = options.height ?? 360;
  const clipPath = resolve(root, "directorx-setup-test.mp4");
  const thumbnailPath = resolve(root, "directorx-setup-test.png");
  const receiptPath = resolve(root, "directorx-setup-test-receipt.json");
  const temporaryClipPath = `${clipPath}.${process.pid}.tmp.mp4`;
  const temporaryThumbnailPath = `${thumbnailPath}.${process.pid}.tmp.png`;
  return {
    schemaVersion: "1.0",
    smokeTestId: SETUP_SMOKE_TEST_ID,
    label: "Director X setup test",
    root,
    durationSeconds,
    fps,
    width,
    height,
    audioSampleRate: 48000,
    clipPath,
    thumbnailPath,
    receiptPath,
    temporaryClipPath,
    temporaryThumbnailPath,
    commands: [
      {
        command: options.ffmpegCommand ?? "ffmpeg",
        args: ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=${fps}:duration=${durationSeconds}`, "-f", "lavfi", "-i", `sine=frequency=660:sample_rate=48000:duration=${durationSeconds}`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", temporaryClipPath]
      },
      {
        command: options.ffprobeCommand ?? "ffprobe",
        args: ["-v", "error", "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate", "-of", "json", temporaryClipPath],
        capture: "probe"
      },
      {
        command: options.ffmpegCommand ?? "ffmpeg",
        args: ["-v", "error", "-i", temporaryClipPath, "-f", "null", "-"],
        capture: "decode"
      },
      {
        command: options.ffmpegCommand ?? "ffmpeg",
        args: ["-y", "-v", "error", "-ss", "0.5", "-i", temporaryClipPath, "-frames:v", "1", temporaryThumbnailPath]
      }
    ]
  };
}

export async function runPluginSmokeTest({ projectPath, ...options }, dependencies = {}) {
  const plan = buildSetupSmokeTestPlan(projectPath, options);
  const runner = dependencies.runner ?? runCommand;
  await mkdir(plan.root, { recursive: true });
  const outputs = {};
  try {
    for (const command of plan.commands) {
      const result = await runner({ command: command.command, args: command.args, cwd: plan.root, timeoutMs: options.timeoutMs ?? 30000 });
      if (result?.exitCode !== 0) throw new Error(`Director X setup smoke command failed (${result?.exitCode ?? "unknown"}).`);
      if (command.capture) outputs[command.capture] = result;
    }
    const probe = JSON.parse(outputs.probe?.stdout || "{}");
    validateProbe(plan, probe);
    await rename(plan.temporaryClipPath, plan.clipPath);
    await rename(plan.temporaryThumbnailPath, plan.thumbnailPath);
    const receipt = {
      schemaVersion: "1.0",
      smokeTestId: plan.smokeTestId,
      label: plan.label,
      status: "passed",
      media: {
        clipPath: plan.clipPath,
        thumbnailPath: plan.thumbnailPath,
        clipSha256: await sha256File(plan.clipPath),
        thumbnailSha256: await sha256File(plan.thumbnailPath),
        durationSeconds: Number(probe.format.duration),
        fps: plan.fps,
        width: plan.width,
        height: plan.height,
        audioSampleRate: plan.audioSampleRate
      },
      evidence: { generated: true, probed: true, decoded: outputs.decode?.exitCode === 0, previewExtracted: true },
      productionRunCreated: false,
      providerBudgetConsumed: false
    };
    await writeFile(plan.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return { ...receipt, receiptPath: plan.receiptPath };
  } catch (error) {
    await Promise.all([rm(plan.temporaryClipPath, { force: true }), rm(plan.temporaryThumbnailPath, { force: true })]);
    throw error;
  }
}

function validateProbe(plan, probe) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe.format?.duration);
  if (!video || !audio) throw new Error("Director X setup smoke output must contain video and audio streams.");
  if (Number(video.width) !== plan.width || Number(video.height) !== plan.height) throw new Error("Director X setup smoke output dimensions do not match the plan.");
  if (Number(audio.sample_rate) !== plan.audioSampleRate) throw new Error("Director X setup smoke output sample rate does not match the plan.");
  if (!Number.isFinite(duration) || Math.abs(duration - plan.durationSeconds) > 0.15) throw new Error("Director X setup smoke output duration is outside tolerance.");
}

async function runCommand({ command, args, cwd, timeoutMs }) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 1024 * 1024) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 1024 * 1024) stderr += chunk.toString("utf8"); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (exitCode) => { clearTimeout(timer); resolvePromise({ exitCode, stdout, stderr }); });
  });
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
