import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hashTimeline } from "./edit-graph.mjs";

const FORMAT = "directorx.timeline+json";

export function createDirectorXTimelineInterchange(revision, artifacts = {}, now = new Date().toISOString()) {
  validateRevision(revision);
  const mediaBindings = mediaReferences(revision.timeline).map((mediaRef) => mediaBinding(mediaRef, artifacts[mediaRef]));
  const { timeline: _timeline, ...canonical } = revision;
  const document = {
    schemaVersion: "1.0",
    format: FORMAT,
    formatVersion: "1.0",
    interchangeId: `dx-interchange:${revision.revisionId}`,
    exportedAt: now,
    semantics: { ranges: "half_open", sourceRangeDomain: "source_media", timelineRangeDomain: "parent_timeline", timeRepresentation: "rational" },
    canonical: structuredClone(canonical),
    timeline: structuredClone(revision.timeline),
    mediaBindings
  };
  const roundtrip = validateDirectorXTimelineInterchangeRoundTrip(revision, JSON.parse(JSON.stringify(document)));
  const lossReport = {
    schemaVersion: "1.0",
    interchangeId: document.interchangeId,
    targetFormat: FORMAT,
    status: roundtrip.status === "passed" ? "lossless" : "blocked",
    entries: [],
    preservedFeatures: ["track_order", "clip_identity", "media_identity", "source_ranges", "parent_timeline_ranges", "rational_time", "effects", "metadata"],
    externalAdapterStatus: { otio: "not_executed", fcpxml: "not_executed", edl: "not_executed" },
    note: "External NLE formats are not claimed until an executable adapter and independent re-import probe are available."
  };
  const manifest = {
    schemaVersion: "1.0",
    interchangeId: document.interchangeId,
    format: FORMAT,
    formatVersion: "1.0",
    adapter: { adapterId: "directorx.timeline-json", executable: true, direction: "export_and_import", implementation: "Director X plugin" },
    source: { timelineId: revision.timelineId, revisionId: revision.revisionId, revision: revision.revision, contentHash: revision.contentHash },
    counts: { tracks: revision.timeline.tracks.length, clips: revision.timeline.tracks.reduce((sum, track) => sum + track.clips.length, 0), mediaBindings: mediaBindings.length },
    handoffReady: roundtrip.status === "passed" && roundtrip.mediaRelinkReady,
    unresolvedMediaRefs: mediaBindings.filter((binding) => binding.relinkStatus === "unresolved").map((binding) => binding.mediaRef),
    files: ["timeline_interchange.dx.json", "timeline_interchange_manifest.json", "timeline_interchange_loss_report.json", "roundtrip_validation.json"]
  };
  return { document, manifest, lossReport, roundtrip };
}

export function importDirectorXTimelineInterchange(document) {
  if (document?.schemaVersion !== "1.0" || document.format !== FORMAT || document.formatVersion !== "1.0") throw new Error("Unsupported Director X timeline interchange format.");
  if (document.semantics?.ranges !== "half_open" || document.semantics?.sourceRangeDomain !== "source_media" || document.semantics?.timelineRangeDomain !== "parent_timeline" || document.semantics?.timeRepresentation !== "rational") throw new Error("Unsupported Director X timeline interchange semantics.");
  const revision = { ...structuredClone(document.canonical), timeline: structuredClone(document.timeline) };
  validateRevision(revision);
  return revision;
}

export function validateDirectorXTimelineInterchangeRoundTrip(source, document) {
  const mismatches = [];
  let imported = null;
  try { imported = importDirectorXTimelineInterchange(document); }
  catch (error) { mismatches.push(error instanceof Error ? error.message : String(error)); }
  const sourceTracks = source.timeline.tracks;
  const importedTracks = imported?.timeline?.tracks ?? [];
  const sourceClips = sourceTracks.flatMap((track) => track.clips);
  const importedClips = importedTracks.flatMap((track) => track.clips);
  const checks = {
    projectRate: same(source.timeline.rate, imported?.timeline?.rate),
    trackOrder: same(sourceTracks.map((track) => [track.trackId, track.kind]), importedTracks.map((track) => [track.trackId, track.kind])),
    clipIdentity: same(sourceClips.map((clip) => clip.clipId), importedClips.map((clip) => clip.clipId)),
    mediaIdentity: same(sourceClips.map((clip) => clip.mediaRef), importedClips.map((clip) => clip.mediaRef)),
    sourceRanges: same(sourceClips.map((clip) => clip.sourceRange), importedClips.map((clip) => clip.sourceRange)),
    timelineRanges: same(sourceClips.map((clip) => clip.timelineRange), importedClips.map((clip) => clip.timelineRange)),
    effects: same(sourceClips.map((clip) => clip.effects ?? []), importedClips.map((clip) => clip.effects ?? [])),
    canonicalTimeline: same(source.timeline, imported?.timeline)
  };
  for (const [name, passed] of Object.entries(checks)) if (!passed) mismatches.push(name);
  return {
    schemaVersion: "1.0",
    format: FORMAT,
    status: mismatches.length ? "failed" : "passed",
    sourceRevisionId: source.revisionId,
    importedRevisionId: imported?.revisionId ?? null,
    sourceContentHash: source.contentHash,
    importedContentHash: imported?.contentHash ?? null,
    checks,
    mismatches: [...new Set(mismatches)],
    mediaRelinkReady: (document.mediaBindings ?? []).every((binding) => binding.relinkStatus !== "unresolved")
  };
}

export async function writeDirectorXTimelineInterchange({ projectPath, runId, revision, artifacts, now }) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId ?? "")) throw new Error("Invalid Director X run ID.");
  const bundle = createDirectorXTimelineInterchange(revision, artifacts, now);
  if (bundle.roundtrip.status !== "passed") throw new Error(`Director X timeline round trip failed: ${bundle.roundtrip.mismatches.join(", ")}`);
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const values = {
    "timeline_interchange.dx.json": bundle.document,
    "timeline_interchange_manifest.json": bundle.manifest,
    "timeline_interchange_loss_report.json": bundle.lossReport,
    "roundtrip_validation.json": bundle.roundtrip
  };
  const written = {};
  for (const [artifactRef, value] of Object.entries(values)) {
    const path = join(directory, artifactRef);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    written[artifactRef] = { artifactRef, path };
  }
  return { ...bundle, written };
}

function validateRevision(revision) {
  const timeline = revision?.timeline;
  if (!revision?.revisionId || !revision.timelineId || timeline?.schemaVersion !== "1.0" || timeline.timelineId !== revision.timelineId || !Array.isArray(timeline.tracks) || !timeline.tracks.length) throw new Error("Invalid Director X canonical timeline revision.");
  const clipIds = new Set();
  for (const track of timeline.tracks) {
    if (!track.trackId || !["video", "audio", "caption"].includes(track.kind) || !Array.isArray(track.clips)) throw new Error("Invalid Director X timeline track.");
    for (const clip of track.clips) {
      if (!clip.clipId || clipIds.has(clip.clipId) || !clip.mediaRef) throw new Error("Director X timeline clip identity must be unique and complete.");
      clipIds.add(clip.clipId);
      validateRange(clip.sourceRange);
      validateRange(clip.timelineRange);
    }
  }
  if (hashTimeline(timeline) !== revision.contentHash) throw new Error("Director X timeline revision content hash mismatch.");
}

function validateRange(range) {
  for (const [key, minimum] of [["start", 0], ["duration", 1]]) {
    if (!Number.isInteger(range?.[key]?.value) || range[key].value < minimum || !Number.isInteger(range[key].rate) || range[key].rate < 1) throw new Error("Director X timeline interchange requires rational source and parent ranges.");
  }
}

function mediaReferences(timeline) { return [...new Set(timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.mediaRef)))].sort(); }
function mediaBinding(mediaRef, artifact) {
  if (mediaRef.startsWith("caption:")) return { mediaRef, artifactRef: null, mediaKind: "virtual", pathHint: null, sha256: null, relinkStatus: "embedded_semantic" };
  if (!artifact?.path || !artifact.sha256) return { mediaRef, artifactRef: null, mediaKind: "unknown", pathHint: null, sha256: null, relinkStatus: "unresolved" };
  return { mediaRef, artifactRef: artifact.artifactRef ?? mediaRef, mediaKind: artifact.mediaKind ?? "unknown", pathHint: artifact.relativePath ?? artifact.path, sha256: artifact.sha256 ?? null, relinkStatus: "registered" };
}
function same(left, right) { return stableJson(left) === stableJson(right); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`; return JSON.stringify(value); }
