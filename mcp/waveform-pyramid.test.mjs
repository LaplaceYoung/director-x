import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWaveformPyramid, getWaveformWindow } from "./waveform-pyramid.mjs";

test("builds chunked waveform levels and selects a bounded viewport", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-pyramid-"));
  const analyze = async (input) => ({ sampleRate: 8000, samplesPerPoint: 10, peaks: Array.from({ length: 128 }, (_, i) => i % 2 ? .8 : -.8) });
  const built = await buildWaveformPyramid({ projectPath, runId: "r1", waveformId: "mix", mediaPath: "video.mp4", durationSeconds: 65, chunkDurationSeconds: 30, basePixelWidth: 64 }, { analyze });
  assert.equal(built.index.chunks.length, 3);
  assert.equal(built.index.chunks[0].levels.length, 4);
  const window = await getWaveformWindow({ projectPath, runId: "r1", waveformId: "mix", startSeconds: 20, durationSeconds: 20, pixelWidth: 64 });
  assert.ok(window.peaks.length > 0 && window.peaks.length <= 256);
  assert.equal(window.peakEncoding, "min_max_pairs");
});
