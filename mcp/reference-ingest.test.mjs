import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ingestReferenceVideo } from "./reference-ingest.mjs";

test("downloads one authorized section and verifies all decoded frames", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-reference-ingest-"));
  const runId = "dx-test";
  const referenceId = "ref-demo";
  const root = join(projectPath, ".directorx", "plugin-runs", runId, "references", referenceId);
  let downloadCount = 0;
  const ytdlpArgsList = [];
  const ffmpegArgsList = [];
  try {
    const input = {
      projectPath,
      runId,
      referenceId,
      url: "https://example.com/video",
      downloadAuthorized: true,
      rightsStatus: "reference_only",
      maxSeconds: 10,
      maxFrames: 300
    };
    const options = {
      runFn: async (command, args) => {
        if (command === "yt-dlp") {
          downloadCount += 1;
          ytdlpArgsList.push(args);
          const outputRoot = dirname(args[args.indexOf("-o") + 1]);
          await mkdir(outputRoot, { recursive: true });
          await writeFile(join(outputRoot, "source.mp4"), "downloaded");
          await writeFile(join(outputRoot, "source.info.json"), JSON.stringify({ title: "Demo", uploader: "Example", duration: 20 }));
        } else if (command === "ffprobe") {
          return { command, args, exitCode: 0, stdout: JSON.stringify({
            format: { duration: "10", format_name: "mov,mp4" },
            streams: [
              { index: 0, codec_type: "video", width: 1280, height: 720, avg_frame_rate: "3/1", r_frame_rate: "3/1", time_base: "1/90000", nb_read_frames: "3" },
              { index: 1, codec_type: "audio", sample_rate: "48000", channels: 2 }
            ]
          }) };
        } else if (command === "ffmpeg" && args.includes("-fps_mode")) {
          ffmpegArgsList.push(args);
          const pattern = args.at(-1);
          for (let index = 1; index <= 3; index += 1) await writeFile(pattern.replace("%06d", String(index).padStart(6, "0")), `frame-${index}`);
        } else if (command === "ffmpeg") {
          ffmpegArgsList.push(args);
          const output = args.at(-1);
          await mkdir(dirname(output), { recursive: true });
          await writeFile(output, output.endsWith(".wav") ? "audio" : output.endsWith(".jpg") ? "sheet" : "analysis-video");
        }
        return { command, args, exitCode: 0, stdout: "", stderr: "" };
      },
      collectFrameIdentityFn: async ({ projectPath: rootPath, runId: id, artifactRef }) => {
        const path = join(rootPath, ".directorx", "plugin-runs", id, "artifacts", artifactRef);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "{}\n{}\n{}\n");
        return {
          artifactRef,
          path,
          frameCount: 3,
          probeReachedEof: true,
          firstFrame: { frameIndex: 0, ptsTimeSeconds: 0, bestEffortTimestampTicks: "0" },
          lastFrame: { frameIndex: 2, ptsTimeSeconds: 2 / 3, bestEffortTimestampTicks: "60000" }
        };
      }
    };
    const result = await ingestReferenceVideo(input, options);
    assert.deepEqual(result.fullFrameCoverage, {
      mode: "all_decoded_frames",
      extractedFrameCount: 3,
      identityFrameCount: 3,
      probeReachedEof: true,
      countParity: true,
      passed: true
    });
    const manifest = (await readFile(result.frameManifestPath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(manifest.length, 3);
    assert.match(manifest[0].sha256, /^[a-f0-9]{64}$/);
    const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
    assert.equal(receipt.schemaVersion, "2.0");
    assert.ok(receipt.commands.some((entry) => entry.executable === "yt-dlp"));
    assert.ok(receipt.commands.filter((entry) => entry.executable === "ffmpeg").length >= 4);
    assert.ok(!ytdlpArgsList[0].includes("--write-subs"));
    assert.ok(!ytdlpArgsList[0].includes("--write-auto-subs"));

    const cached = await ingestReferenceVideo(input, options);
    assert.equal(cached.cached, true);
    assert.equal(downloadCount, 1);
    assert.deepEqual(cached.fullFrameCoverage, result.fullFrameCoverage);

    const fullInput = { ...input, referenceId: "ref-full", fullReference: true };
    const fullResult = await ingestReferenceVideo(fullInput, options);
    assert.equal(fullResult.analysisSection.fullReference, true);
    assert.equal(fullResult.analysisSection.maxSeconds, null);
    assert.ok(!ytdlpArgsList[1].includes("--download-sections"));
    const fullTrimArgs = ffmpegArgsList.find((args) => args.includes(fullResult.clipPath));
    assert.ok(fullTrimArgs);
    assert.ok(!fullTrimArgs.includes("-t"));
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
