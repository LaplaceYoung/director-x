import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { inspectMediaRuntime, mediaRuntimePaths } from "../runtime/media-runtime.mjs";

const AUDIO_FORMATS = new Set(["mp3", "wav", "aac", "flac", "opus"]);
const VIDEO_FORMATS = new Set([".mp4", ".webm"]);

export async function executeMosiTts(input, options = {}) {
  const apiKey = options.apiKey ?? process.env.MOSS_API_KEY ?? process.env.DIRECTORX_TTS_API_KEY;
  if (!apiKey) throw new Error("MOSI TTS requires a session credential in MOSS_API_KEY. Ask the user through the Director X canvas; do not persist it.");
  const format = input.responseFormat ?? "mp3";
  if (!AUDIO_FORMATS.has(format)) throw new Error(`Unsupported MOSI response format: ${format}`);
  if (!input.text?.trim()) throw new Error("TTS text is required.");
  if (!input.voiceId?.trim()) throw new Error("MOSI voiceId is required.");
  const outputPath = containedPath(input.projectPath, input.outputPath);
  if (extname(outputPath).toLowerCase() !== `.${format}`) throw new Error(`TTS outputPath must end in .${format}.`);
  const baseUrl = (options.baseUrl ?? process.env.DIRECTORX_TTS_BASE_URL ?? "https://api.mosi.cn/v1").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: input.model ?? "moss-tts", input: input.text, voice_id: input.voiceId, response_format: format, delivery_method: "audio" }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 120000)
  });
  if (!response.ok) throw new Error(`MOSI TTS failed with status ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("MOSI TTS returned an empty audio payload.");
  if (bytes.length > (input.maxBytes ?? 50_000_000)) throw new Error("MOSI TTS response exceeded the configured size limit.");
  await atomicWrite(outputPath, bytes);
  return { outputPath, byteLength: bytes.length, providerId: options.providerId ?? process.env.DIRECTORX_TTS_PROVIDER_ID ?? "mosi.tts", modelId: input.model ?? "moss-tts", voiceId: input.voiceId, responseFormat: format };
}

export async function executeMossTtsNano(input, options = {}) {
  if (!input.text?.trim()) throw new Error("MOSS-TTS-Nano text is required.");
  if (input.promptSpeechRightsApproved !== true) throw new Error("MOSS-TTS-Nano voice cloning requires approved rights for the prompt speech.");
  const promptSpeechPath = containedPath(input.projectPath, input.promptSpeechPath);
  const promptSpeech = await stat(promptSpeechPath);
  if (!promptSpeech.isFile() || promptSpeech.size <= 0) throw new Error("MOSS-TTS-Nano prompt speech must be a non-empty project audio file.");
  const outputPath = containedPath(input.projectPath, input.outputPath);
  if (extname(outputPath).toLowerCase() !== ".wav") throw new Error("MOSS-TTS-Nano outputPath must end in .wav.");
  await mkdir(dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });
  const args = ["generate", "--prompt-speech", promptSpeechPath, "--text", input.text, "--output", outputPath];
  if (input.backend) args.push("--backend", input.backend);
  if (input.executionProvider && input.backend !== "onnx") throw new Error("MOSS-TTS-Nano executionProvider is only valid with the ONNX backend.");
  if (input.executionProvider) args.push("--execution-provider", input.executionProvider);
  const command = options.command ?? process.env.MOSS_TTS_NANO_COMMAND ?? "moss-tts-nano";
  const execution = await runProcess(command, options.args ?? args, {
    cwd: resolve(input.projectPath), timeoutMs: input.timeoutMs ?? 900000, maxOutputBytes: 1_000_000,
    failureLabel: "MOSS-TTS-Nano generation"
  });
  const generated = await stat(outputPath);
  if (!generated.isFile() || generated.size <= 0) throw new Error("MOSS-TTS-Nano did not produce the requested WAV output.");
  return {
    ...execution,
    outputPath,
    byteLength: generated.size,
    providerId: "openmoss.moss-tts-nano.local",
    modelId: "moss-tts-nano",
    voiceId: input.voiceId ?? null,
    responseFormat: "wav",
    executionMode: "local_cli"
  };
}

export async function executeRemotionRender(input, options = {}) {
  const entryPoint = containedPath(input.projectPath, input.entryPoint);
  const outputPath = containedPath(input.projectPath, input.outputPath);
  const renderCwd = containedPath(input.projectPath, input.renderCwd ?? ".");
  if (!VIDEO_FORMATS.has(extname(outputPath).toLowerCase())) throw new Error("Remotion outputPath must end in .mp4 or .webm.");
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(input.compositionId)) throw new Error("Invalid Remotion compositionId.");
  const runtime = options.runtimeStatus ?? await inspectMediaRuntime();
  const useBuiltinRuntime = runtime.components?.remotion?.ready;
  const args = useBuiltinRuntime
    ? ["render", entryPoint, input.compositionId, outputPath]
    : ["exec", "remotion", "render", entryPoint, input.compositionId, outputPath];
  if (input.propsPath) args.push(`--props=${containedPath(input.projectPath, input.propsPath)}`);
  if (input.codec) args.push(`--codec=${input.codec}`);
  if (useBuiltinRuntime && runtime.components.remotion.browserPath) args.push(`--browser-executable=${runtime.components.remotion.browserPath}`);
  await mkdir(dirname(outputPath), { recursive: true });
  const result = await runProcess(options.command ?? (useBuiltinRuntime ? runtime.components.remotion.path : "pnpm"), options.args ?? args, {
    cwd: renderCwd,
    env: useBuiltinRuntime ? { NODE_PATH: mediaRuntimePaths(runtime.root).nodeModules } : undefined,
    timeoutMs: input.timeoutMs ?? 900000,
    maxOutputBytes: 1_000_000
  });
  return { ...result, outputPath, compositionId: input.compositionId, entryPoint, renderCwd, runtime: useBuiltinRuntime ? "directorx-builtin-remotion" : "project-remotion", runtimeRelease: useBuiltinRuntime ? runtime.release : null };
}

export async function executeHyperframesRender(input, options = {}) {
  const compositionPath = containedPath(input.projectPath, input.compositionPath);
  const outputPath = containedPath(input.projectPath, input.outputPath);
  const renderCwd = containedPath(input.projectPath, input.renderCwd ?? ".");
  if (extname(compositionPath).toLowerCase() !== ".html") throw new Error("HyperFrames compositionPath must end in .html.");
  if (extname(outputPath).toLowerCase() !== ".mp4") throw new Error("HyperFrames outputPath must end in .mp4.");
  const runtime = options.runtimeStatus ?? await inspectMediaRuntime();
  if (!runtime.components?.hyperframes?.ready) throw new Error("The built-in HyperFrames runtime is not ready. Run pnpm install:runtime or reinstall the Director X plugin.");
  const args = ["render", "-c", compositionPath, "-o", outputPath];
  await mkdir(dirname(outputPath), { recursive: true });
  const result = await runProcess(options.command ?? runtime.components.hyperframes.path, options.args ?? args, {
    cwd: renderCwd,
    timeoutMs: input.timeoutMs ?? 900000,
    maxOutputBytes: 1_000_000,
    failureLabel: "HyperFrames render"
  });
  return { ...result, outputPath, compositionPath, renderCwd, runtime: "directorx-builtin-hyperframes", runtimeRelease: runtime.release };
}

export async function executeWhisperTranscription(input, options = {}) {
  const mediaPath = containedPath(input.projectPath, input.mediaPath);
  const outputPath = containedPath(input.projectPath, input.outputPath);
  const details = await stat(mediaPath);
  if (!details.isFile() || details.size <= 0) throw new Error("Whisper input must be a non-empty project media file.");
  if (extname(outputPath).toLowerCase() !== ".json") throw new Error("Whisper outputPath must end in .json.");
  const runtime = options.runtimeStatus ?? await inspectMediaRuntime();
  if (!runtime.components?.whisper?.ready) throw new Error("The built-in Whisper runtime is not ready. Run pnpm install:runtime or reinstall the Director X plugin.");
  const args = [
    runtime.components.whisper.scriptPath,
    "--input", mediaPath,
    "--model", input.model ?? "small",
    "--device", input.device ?? "auto",
    "--compute-type", input.computeType ?? "int8"
  ];
  if (input.language) args.push("--language", input.language);
  if (input.wordTimestamps !== false) args.push("--word-timestamps");
  const result = await runProcess(options.command ?? runtime.components.whisper.pythonPath, options.args ?? args, {
    cwd: resolve(input.projectPath),
    timeoutMs: input.timeoutMs ?? 900000,
    maxOutputBytes: 20_000_000,
    failureLabel: "Whisper transcription"
  });
  let transcript;
  try {
    transcript = JSON.parse(result.stdout);
  } catch {
    throw new Error("Whisper transcription returned invalid JSON.");
  }
  if (!Array.isArray(transcript.segments)) throw new Error("Whisper transcription did not return segments.");
  await atomicWrite(outputPath, Buffer.from(`${JSON.stringify(transcript, null, 2)}\n`));
  return {
    ...result,
    outputPath,
    mediaPath,
    transcript,
    runtime: "directorx-builtin-whisper",
    runtimeRelease: runtime.release
  };
}

export async function inspectMediaDelivery(input, options = {}) {
  const videoPath = containedPath(input.projectPath, input.finalVideoPath);
  const args = ["-v", "error", "-count_frames", "-show_entries", "format=duration,size,format_name,start_time:stream=index,codec_name,codec_type,duration,start_time,width,height,sample_rate,channels,avg_frame_rate,r_frame_rate,time_base,nb_frames,nb_read_frames", "-of", "json", videoPath];
  const result = await runProcess(options.command ?? "ffprobe", options.args ?? args, {
    cwd: resolve(input.projectPath), timeoutMs: input.timeoutMs ?? 30000, maxOutputBytes: 1_000_000,
    failureLabel: "Media probe"
  });
  let probe;
  try { probe = JSON.parse(result.stdout); } catch { throw new Error("Media probe returned invalid JSON."); }
  const durationSeconds = Number(probe.format?.duration ?? 0);
  const sizeBytes = Number(probe.format?.size ?? 0);
  const videoStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === "video");
  const audioStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === "audio");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || videoStreams.length === 0) {
    throw new Error("Final media is not a playable non-empty video.");
  }
  if (input.requireAudio !== false && audioStreams.length === 0) throw new Error("Final media is missing the required audio stream.");
  const videoDurationSeconds = finiteNumber(videoStreams[0]?.duration);
  const audioDurationSeconds = finiteNumber(audioStreams[0]?.duration);
  const videoStartSeconds = finiteNumber(videoStreams[0]?.start_time) ?? finiteNumber(probe.format?.start_time) ?? 0;
  const audioStartSeconds = finiteNumber(audioStreams[0]?.start_time) ?? finiteNumber(probe.format?.start_time) ?? 0;
  const mediaIntegrity = {
    videoDurationSeconds,
    audioDurationSeconds,
    avDurationDeltaSeconds: videoDurationSeconds != null && audioDurationSeconds != null ? rounded(Math.abs(videoDurationSeconds - audioDurationSeconds)) : null,
    videoStartSeconds,
    audioStartSeconds,
    avStartDeltaSeconds: rounded(Math.abs(videoStartSeconds - audioStartSeconds)),
    expectedFrameCount: finiteNumber(videoStreams[0]?.nb_read_frames) ?? finiteNumber(videoStreams[0]?.nb_frames),
    expectedFrameCountSource: finiteNumber(videoStreams[0]?.nb_read_frames) != null ? "ffprobe.nb_read_frames" : finiteNumber(videoStreams[0]?.nb_frames) != null ? "stream.nb_frames" : null,
    frameRate: parseRate(videoStreams[0]?.avg_frame_rate ?? videoStreams[0]?.r_frame_rate)
  };
  return { videoPath, durationSeconds, sizeBytes, formatName: probe.format?.format_name ?? "unknown", videoStreams, audioStreams, mediaIntegrity, command: result.command, args: result.args };
}

export async function inspectAudioSource(input, options = {}) {
  const audioPath = containedPath(input.projectPath, input.audioPath);
  const details = await stat(audioPath);
  if (!details.isFile() || details.size <= 0) throw new Error("Audio source must be a non-empty project file.");
  const args = ["-v", "error", "-show_entries", "format=duration,size,format_name:stream=index,codec_name,codec_type,duration,start_time,sample_rate,channels", "-of", "json", audioPath];
  const result = await runProcess(options.command ?? "ffprobe", options.args ?? args, {
    cwd: resolve(input.projectPath), timeoutMs: input.timeoutMs ?? 30000, maxOutputBytes: 1_000_000,
    failureLabel: "Audio source probe"
  });
  let probe;
  try { probe = JSON.parse(result.stdout); } catch { throw new Error("Audio source probe returned invalid JSON."); }
  const audioStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === "audio");
  const durationSeconds = finiteNumber(probe.format?.duration) ?? finiteNumber(audioStreams[0]?.duration);
  if (audioStreams.length === 0 || durationSeconds == null || durationSeconds <= 0) throw new Error("Audio source is not a playable audio file.");
  return {
    audioPath,
    durationSeconds,
    sizeBytes: details.size,
    formatName: probe.format?.format_name ?? null,
    audioStreams,
    command: result.command,
    args: result.args
  };
}

export async function analyzeMediaWaveform(input, options = {}) {
  const mediaPath = containedPath(input.projectPath, input.mediaPath);
  const details = await stat(mediaPath);
  if (!details.isFile() || details.size <= 0) throw new Error("Waveform input must be a non-empty project file.");
  const startSeconds = Number(input.startSeconds ?? 0), durationSeconds = Number(input.durationSeconds);
  const sampleRate = Number(input.sampleRate ?? 8000), pixelWidth = Number(input.pixelWidth);
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Waveform window requires a valid start and duration.");
  if (!Number.isInteger(sampleRate) || sampleRate < 1000 || sampleRate > 48000 || !Number.isInteger(pixelWidth) || pixelWidth < 64 || pixelWidth > 4096) throw new Error("Waveform sampleRate or pixelWidth is outside the safe range.");
  const rawPath = containedPath(input.projectPath, `.directorx/tmp/waveform-${randomUUID()}.f32le`);
  await mkdir(dirname(rawPath), { recursive: true });
  const args = ["-v", "error", "-ss", String(startSeconds), "-t", String(durationSeconds), "-i", mediaPath, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", rawPath];
  try {
    const executionArgs = options.argsFactory ? options.argsFactory(rawPath) : options.args ?? args;
    const execution = await runProcess(options.command ?? "ffmpeg", executionArgs, { cwd: resolve(input.projectPath), timeoutMs: input.timeoutMs ?? 120000, maxOutputBytes: 100_000, failureLabel: "Waveform analysis" });
    const bytes = await readFile(rawPath);
    if (!bytes.length || bytes.length % 4 !== 0) throw new Error("Waveform analysis produced invalid float audio.");
    const sampleCount = bytes.length / 4;
    const samplesPerPoint = Math.max(1, Math.ceil(sampleCount / pixelWidth));
    const peaks = [];
    for (let offset = 0; offset < sampleCount; offset += samplesPerPoint) {
      let min = 1, max = -1;
      for (let index = offset; index < Math.min(sampleCount, offset + samplesPerPoint); index += 1) {
        const value = Math.max(-1, Math.min(1, bytes.readFloatLE(index * 4))); min = Math.min(min, value); max = Math.max(max, value);
      }
      peaks.push(min, max);
    }
    return { startSeconds, durationSeconds, sampleRate, sampleCount, samplesPerPoint, pixelWidth, peaks, peakEncoding: "min_max_pairs", command: execution.command, args: execution.args };
  } finally { await rm(rawPath, { force: true }); }
}

export function runProcess(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...(options.env ?? {}) }, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => (current + chunk.toString()).slice(-options.maxOutputBytes);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(new Error(`Unable to start ${command}: ${error.message}`)); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`${options.failureLabel ?? "Process"} failed (${signal ?? code}): ${stderr.slice(-2000) || stdout.slice(-2000)}`));
      resolvePromise({ command, args, exitCode: code, stdout, stderr });
    });
  });
}

export async function writeExecutionReceipt(projectPath, runId, name, value) {
  const path = containedPath(projectPath, `.directorx/plugin-runs/${runId}/artifacts/${name}`);
  await atomicWrite(path, Buffer.from(`${JSON.stringify({ ...value, recordedAt: new Date().toISOString() }, null, 2)}\n`));
  return path;
}

function containedPath(projectPath, path) {
  const root = resolve(projectPath);
  const absolute = resolve(root, path);
  const relation = relative(root, absolute);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Execution paths must stay inside the project workspace.");
  return absolute;
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  try { await rename(temporary, path); } finally { await rm(temporary, { force: true }); }
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseRate(value) {
  const [numerator, denominator = "1"] = String(value ?? "").split("/").map(Number);
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rounded(rate) : null;
}

function rounded(value) { return Math.round(value * 1000000) / 1000000; }
