import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export function registerAvReviewTimeline(run, timeline) {
  const durationSeconds = rationalSeconds(timeline.duration, "duration");
  if (durationSeconds <= 0) throw new Error("A/V review timeline duration must be greater than zero.");
  validateRanges(timeline.shots, durationSeconds, "shot");
  validateRanges(timeline.subtitles, durationSeconds, "subtitle");
  for (const track of timeline.audioTracks ?? []) {
    const window = track.waveformWindow;
    if (!track.id || !track.role || !window || !Array.isArray(window.peaks) || window.peaks.length > 8192 || window.peaks.length % 2 !== 0 || window.peaks.some((peak) => !Number.isFinite(peak) || peak < -1 || peak > 1)) throw new Error("Audio tracks require a bounded waveform window of normalized min/max peak pairs between -1 and 1.");
    if (!Number.isInteger(window.level) || !Number.isFinite(window.samplesPerPoint) || window.samplesPerPoint <= 0 || !Number.isInteger(window.pixelWidth) || window.pixelWidth <= 0) throw new Error("Waveform windows require level, samplesPerPoint, and pixelWidth.");
    validateRange(window.range, durationSeconds, "waveform window");
  }
  for (const marker of timeline.markers ?? []) {
    validateRange(marker.range, durationSeconds, "timeline marker", true);
    if (!marker.kind || !marker.label || !marker.evidenceRefs?.length) throw new Error("Timeline markers require kind, label, and evidenceRefs.");
  }
  run.avReviewTimeline = { ...timeline, schemaVersion: "1.0", durationSeconds };
  return run.avReviewTimeline;
}

export async function writeAvReviewTimeline({ projectPath, runId, timeline }) {
  const dir = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(dir, { recursive: true });
  const path = join(dir, "av_review_timeline.json");
  await writeFile(path, `${JSON.stringify(timeline, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "av_review_timeline.json", path };
}

function validateRanges(items = [], duration, label) {
  for (const item of items) {
    if (!item.id) throw new Error(`Invalid ${label}: missing id.`);
    validateRange(item.range, duration, label);
  }
}

function validateRange(range, duration, label, allowPoint = false) {
  const start = rationalSeconds(range?.start, `${label}.start`, true), length = rationalSeconds(range?.duration, `${label}.duration`, allowPoint);
  if (start < 0 || (!allowPoint && length <= 0) || length < 0 || start + length > duration) throw new Error(`Invalid ${label} range.`);
}

function rationalSeconds(time, label, allowZero = false) {
  if (!time || !Number.isFinite(time.value) || !Number.isFinite(time.rate) || time.rate <= 0 || (!allowZero && time.value <= 0) || (allowZero && time.value < 0)) throw new Error(`${label} must be a valid rational time.`);
  return time.value / time.rate;
}
