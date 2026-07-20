import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeMediaWaveform, executeHyperframesRender, executeMosiTts, executeMossTtsNano, executeRemotionRender, executeWhisperTranscription, inspectAudioSource, inspectMediaDelivery } from "./media-execution.mjs";

test("executes MOSI TTS without persisting its session key", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-tts-"));
  let request;
  const result = await executeMosiTts({ projectPath, text: "你好", voiceId: "voice-1", outputPath: "out/voice.mp3" }, {
    apiKey: "session-secret", providerId: "mosi.tts.mock", baseUrl: "https://example.test/v1", fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from("audio"), text: async () => "" };
    }
  });
  assert.equal(request.url, "https://example.test/v1/audio/speech");
  assert.deepEqual(JSON.parse(request.init.body), { model: "moss-tts", input: "你好", voice_id: "voice-1", response_format: "mp3", delivery_method: "audio" });
  assert.equal((await readFile(result.outputPath)).toString(), "audio");
  assert.equal(result.providerId, "mosi.tts.mock");
  assert.equal(JSON.stringify(result).includes("session-secret"), false);
});

test("rejects execution output outside the workspace", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-path-"));
  await assert.rejects(() => executeMosiTts({ projectPath, text: "x", voiceId: "v", outputPath: "../voice.mp3" }, { apiKey: "session-secret" }), /inside the project workspace/);
});

test("executes a configured local MOSS-TTS-Nano CLI without an API key", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-moss-nano-"));
  await writeFile(join(projectPath, "prompt.wav"), "prompt-audio");
  const script = "const fs=require('fs');fs.mkdirSync('out',{recursive:true});fs.writeFileSync('out/voice.wav','local-audio')";
  const result = await executeMossTtsNano({ projectPath, text: "本地配音", promptSpeechPath: "prompt.wav", promptSpeechRightsApproved: true, outputPath: "out/voice.wav", backend: "onnx" }, {
    command: process.execPath,
    args: ["-e", script]
  });
  assert.equal(result.providerId, "openmoss.moss-tts-nano.local");
  assert.equal(result.modelId, "moss-tts-nano");
  assert.equal(result.executionMode, "local_cli");
  assert.equal((await readFile(result.outputPath)).toString(), "local-audio");
});

test("keeps local MOSS-TTS-Nano inputs and outputs inside the project", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-moss-nano-path-"));
  await writeFile(join(projectPath, "prompt.wav"), "prompt-audio");
  await assert.rejects(() => executeMossTtsNano({ projectPath, text: "x", promptSpeechPath: "prompt.wav", promptSpeechRightsApproved: true, outputPath: "../voice.wav" }), /inside the project workspace/);
});

test("requires prompt-speech rights before local MOSS-TTS-Nano voice cloning", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-moss-nano-rights-"));
  await writeFile(join(projectPath, "prompt.wav"), "prompt-audio");
  await assert.rejects(() => executeMossTtsNano({ projectPath, text: "x", promptSpeechPath: "prompt.wav", outputPath: "voice.wav" }), /approved rights/);
});

test("runs Remotion with argv and verifies a project-contained output", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-render-"));
  await writeFile(join(projectPath, "entry.tsx"), "export {}\n");
  const result = await executeRemotionRender({ projectPath, entryPoint: "entry.tsx", compositionId: "Demo", outputPath: "out/demo.mp4" }, {
    command: process.execPath,
    args: ["-e", `require('fs').mkdirSync('out',{recursive:true});require('fs').writeFileSync('out/demo.mp4','video')`]
  });
  assert.equal(result.exitCode, 0);
  assert.equal((await readFile(result.outputPath)).toString(), "video");
});

test("uses the built-in Remotion runtime when it is ready", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-builtin-remotion-"));
  await writeFile(join(projectPath, "entry.tsx"), "export {}\n");
  const result = await executeRemotionRender({ projectPath, entryPoint: "entry.tsx", compositionId: "Demo", outputPath: "out/demo.mp4" }, {
    command: process.execPath,
    args: ["-e", `require('fs').mkdirSync('out',{recursive:true});require('fs').writeFileSync('out/demo.mp4','video')`],
    runtimeStatus: { root: "/tmp/directorx-runtime", release: "test", components: { remotion: { ready: true, path: "/tmp/remotion" } } }
  });
  assert.equal(result.runtime, "directorx-builtin-remotion");
  assert.equal(result.runtimeRelease, "test");
});

test("renders a project-contained HyperFrames composition with the built-in runtime", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-hyperframes-"));
  await writeFile(join(projectPath, "composition.html"), "<html></html>\n");
  const result = await executeHyperframesRender({ projectPath, compositionPath: "composition.html", outputPath: "out/demo.mp4" }, {
    command: process.execPath,
    args: ["-e", `require('fs').mkdirSync('out',{recursive:true});require('fs').writeFileSync('out/demo.mp4','video')`],
    runtimeStatus: { release: "test", components: { hyperframes: { ready: true, path: "/tmp/hyperframes" } } }
  });
  assert.equal(result.runtime, "directorx-builtin-hyperframes");
  assert.equal((await readFile(result.outputPath)).toString(), "video");
});

test("writes stable word-level Whisper transcript JSON with the built-in runtime", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-whisper-"));
  await writeFile(join(projectPath, "speech.wav"), "audio");
  const transcript = { provider: "faster-whisper", model: "small", language: "zh", segments: [{ segment_id: "SEG-0001", start_seconds: 0, end_seconds: 1, text: "你好", words: [{ start_seconds: 0, end_seconds: 1, text: "你好", probability: 0.99 }] }] };
  const result = await executeWhisperTranscription({ projectPath, mediaPath: "speech.wav", outputPath: "out/transcript.json", wordTimestamps: true }, {
    command: process.execPath,
    args: ["-e", `process.stdout.write(${JSON.stringify(JSON.stringify(transcript))})`],
    runtimeStatus: { release: "test", components: { whisper: { ready: true, pythonPath: "/tmp/python", scriptPath: "/tmp/transcribe_audio.py" } } }
  });
  assert.equal(result.runtime, "directorx-builtin-whisper");
  assert.deepEqual(JSON.parse(await readFile(result.outputPath, "utf8")), transcript);
});

test("probes a playable final video with required audio", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-probe-"));
  const result = await inspectMediaDelivery({ projectPath, finalVideoPath: "out/final.mp4" }, {
    command: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify({format:{duration:'8.04',size:'5014104',format_name:'mov,mp4',start_time:'0'},streams:[{index:0,codec_type:'video',codec_name:'h264',duration:'8.0',start_time:'0',avg_frame_rate:'30/1',nb_frames:'240',nb_read_frames:'240',width:1920,height:1080},{index:1,codec_type:'audio',codec_name:'aac',duration:'8.04',start_time:'0',channels:2}]}))"]
  });
  assert.equal(result.durationSeconds, 8.04);
  assert.equal(result.videoStreams[0].codec_name, "h264");
  assert.equal(result.audioStreams[0].codec_name, "aac");
  assert.deepEqual(result.mediaIntegrity, { videoDurationSeconds: 8, audioDurationSeconds: 8.04, avDurationDeltaSeconds: 0.04, videoStartSeconds: 0, audioStartSeconds: 0, avStartDeltaSeconds: 0, expectedFrameCount: 240, expectedFrameCountSource: "ffprobe.nb_read_frames", frameRate: 30 });
});

test("rejects a final video without required audio", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-probe-no-audio-"));
  await assert.rejects(() => inspectMediaDelivery({ projectPath, finalVideoPath: "out/final.mp4" }, {
    command: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify({format:{duration:'3',size:'1000'},streams:[{codec_type:'video',codec_name:'h264'}]}))"]
  }), /missing the required audio stream/);
});

test("probes a registered source audio duration before timeline compilation", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-source-audio-"));
  await writeFile(join(projectPath, "voice.wav"), "audio");
  const result = await inspectAudioSource({ projectPath, audioPath: "voice.wav" }, {
    command: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify({format:{duration:'9.52',size:'1000',format_name:'wav'},streams:[{index:0,codec_type:'audio',codec_name:'pcm_s16le',duration:'9.52',sample_rate:'48000',channels:1}]}))"]
  });
  assert.equal(result.durationSeconds, 9.52);
  assert.equal(result.audioStreams[0].codec_name, "pcm_s16le");
});

test("rejects an unplayable source audio binding", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-source-audio-invalid-"));
  await writeFile(join(projectPath, "voice.wav"), "audio");
  await assert.rejects(() => inspectAudioSource({ projectPath, audioPath: "voice.wav" }, {
    command: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify({format:{duration:'0'},streams:[]}))"]
  }), /not a playable audio file/);
});

test("extracts a bounded min/max waveform window from real float samples", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-waveform-"));
  await writeFile(join(projectPath, "source.mp4"), "media");
  const result = await analyzeMediaWaveform({ projectPath, mediaPath: "source.mp4", startSeconds: 0, durationSeconds: 1, sampleRate: 8000, pixelWidth: 64 }, { command: process.execPath, argsFactory: (rawPath) => ["-e", "const fs=require('fs');const p=process.argv[1],b=Buffer.alloc(16);[-1,-.5,.5,1].forEach((v,i)=>b.writeFloatLE(v,i*4));fs.writeFileSync(p,b)", rawPath] });
  assert.equal(result.peakEncoding, "min_max_pairs");
  assert.deepEqual(result.peaks, [-1, -1, -.5, -.5, .5, .5, 1, 1]);
});
