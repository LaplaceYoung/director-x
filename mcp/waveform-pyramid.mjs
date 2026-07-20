import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { analyzeMediaWaveform } from "./media-execution.mjs";

export async function buildWaveformPyramid(input, options = {}) {
  assertId(input.waveformId);
  assertId(input.runId);
  const duration = Number(input.durationSeconds), chunkDuration = Number(input.chunkDurationSeconds ?? 30);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 21600) throw new Error("Waveform pyramid duration must be between 0 and 6 hours.");
  if (!Number.isFinite(chunkDuration) || chunkDuration < 5 || chunkDuration > 300) throw new Error("Waveform chunk duration must be between 5 and 300 seconds.");
  const chunkCount = Math.ceil(duration / chunkDuration);
  if (chunkCount > 720) throw new Error("Waveform pyramid exceeds the 720 chunk safety limit.");
  const root = resolve(input.projectPath, ".directorx", "plugin-runs", input.runId, "artifacts", "waveforms", input.waveformId);
  await mkdir(root, { recursive: true });
  const chunks = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const startSeconds = index * chunkDuration, durationSeconds = Math.min(chunkDuration, duration - startSeconds);
    const base = await (options.analyze ?? analyzeMediaWaveform)({ ...input, startSeconds, durationSeconds, pixelWidth: input.basePixelWidth ?? 1024 }, options.mediaOptions ?? {});
    const levels = [1, 4, 16, 64].map((factor, level) => ({ level, factor, peaks: coarsenPairs(base.peaks, factor) }));
    const value = { schemaVersion: "1.0", chunkId: `chunk-${String(index).padStart(4, "0")}`, startSeconds, durationSeconds, sampleRate: base.sampleRate, baseSamplesPerPoint: base.samplesPerPoint, peakEncoding: "min_max_pairs", levels };
    const filename = `${value.chunkId}.json`; await writeFile(join(root, filename), `${JSON.stringify(value)}\n`, { mode: 0o600 });
    chunks.push({ chunkId: value.chunkId, startSeconds, durationSeconds, artifactPath: join("waveforms", input.waveformId, filename), levels: levels.map((item) => ({ level: item.level, factor: item.factor, pointCount: item.peaks.length / 2 })) });
  }
  const index = { schemaVersion: "1.0", waveformId: input.waveformId, sourcePath: input.mediaPath, durationSeconds: duration, chunkDurationSeconds: chunkDuration, basePixelWidth: input.basePixelWidth ?? 1024, peakEncoding: "min_max_pairs", chunks };
  const path = resolve(input.projectPath, ".directorx", "plugin-runs", input.runId, "artifacts", `waveform_pyramid_${input.waveformId}.json`);
  await writeFile(path, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  return { index, path, artifactRef: `waveform_pyramid_${input.waveformId}.json` };
}

export async function getWaveformWindow(input) {
  assertId(input.waveformId);
  assertId(input.runId);
  const indexPath = resolve(input.projectPath, ".directorx", "plugin-runs", input.runId, "artifacts", `waveform_pyramid_${input.waveformId}.json`);
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const start = Number(input.startSeconds), end = start + Number(input.durationSeconds), pixelWidth = Number(input.pixelWidth);
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start || end > index.durationSeconds || !Number.isInteger(pixelWidth) || pixelWidth < 64 || pixelWidth > 4096) throw new Error("Invalid waveform viewport.");
  const selectedChunks = index.chunks.filter((chunk) => chunk.startSeconds < end && chunk.startSeconds + chunk.durationSeconds > start);
  let chosenLevel = 0;
  for (const level of [0, 1, 2, 3]) {
    const points = selectedChunks.reduce((sum, chunk) => sum + (chunk.levels.find((item) => item.level === level)?.pointCount ?? 0), 0);
    if (points <= pixelWidth * 2) { chosenLevel = level; break; }
    chosenLevel = level;
  }
  const peaks = [];
  for (const chunk of selectedChunks) {
    const value = JSON.parse(await readFile(artifactPath(input.projectPath, input.runId, chunk.artifactPath), "utf8"));
    const level = value.levels.find((item) => item.level === chosenLevel), count = level.peaks.length / 2;
    for (let point = 0; point < count; point += 1) {
      const at = value.startSeconds + (point + .5) / count * value.durationSeconds;
      if (at >= start && at < end) peaks.push(level.peaks[point * 2], level.peaks[point * 2 + 1]);
    }
  }
  const bounded = peaks.length / 2 > pixelWidth * 2 ? coarsenPairs(peaks, Math.ceil(peaks.length / 2 / (pixelWidth * 2))) : peaks;
  return { waveformId: input.waveformId, range: { start: { value: Math.round(start * 1000), rate: 1000 }, duration: { value: Math.round((end - start) * 1000), rate: 1000 } }, level: chosenLevel, samplesPerPoint: selectedChunks[0]?.levels.find((item) => item.level === chosenLevel)?.factor ?? 1, pixelWidth, peaks: bounded, peakEncoding: "min_max_pairs" };
}

function assertId(value) { if (!/^[A-Za-z0-9._-]{1,100}$/.test(value ?? "")) throw new Error("Invalid waveform ID."); }
function artifactPath(projectPath, runId, relativePath) {
  const root = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"), path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}/`)) throw new Error("Waveform artifact path escapes the Run.");
  return path;
}

function coarsenPairs(peaks, factor) {
  if (factor === 1) return [...peaks];
  const output = [], pointCount = peaks.length / 2;
  for (let offset = 0; offset < pointCount; offset += factor) {
    let min = 1, max = -1;
    for (let point = offset; point < Math.min(pointCount, offset + factor); point += 1) { min = Math.min(min, peaks[point * 2]); max = Math.max(max, peaks[point * 2 + 1]); }
    output.push(min, max);
  }
  return output;
}
