import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MODES = new Set(["single", "ab", "wipe", "difference", "onion", "grid"]);

export function createReviewSession(run, session) {
  if (!session?.reviewSessionId || !session.activeArtifactRef || !session.activeRevisionId || !MODES.has(session.compareMode)) throw new Error("Review Session requires identity, active artifact/revision, and a supported compare mode.");
  if (!run.artifacts?.[session.activeArtifactRef]) throw new Error(`Review artifact is not registered: ${session.activeArtifactRef}`);
  for (const artifactRef of session.compareArtifactRefs ?? []) if (!run.artifacts[artifactRef]) throw new Error(`Comparison artifact is not registered: ${artifactRef}`);
  run.reviewSession = {
    ...structuredClone(session), revision: 1,
    transport: { playhead: { value: 0, rate: session.projectRate }, playing: false, playbackRate: 1, direction: 1, loopRange: null, droppedFrames: 0 },
    selectedAudioTrackIds: session.selectedAudioTrackIds ?? [], selectedCaptionTrackIds: session.selectedCaptionTrackIds ?? [], status: "active", updatedAt: new Date().toISOString()
  };
  return run.reviewSession;
}

export function updateReviewTransport(run, update) {
  const session = run.reviewSession;
  if (!session || update.reviewSessionId !== session.reviewSessionId) throw new Error("Unknown Review Session.");
  if (update.expectedRevision !== session.revision) throw new Error(`Review Session conflict: expected revision ${update.expectedRevision}, current ${session.revision}.`);
  validateTime(update.playhead);
  if (update.loopRange) validateRange(update.loopRange);
  if (!Number.isFinite(update.playbackRate) || update.playbackRate <= 0 || update.playbackRate > 16 || ![-1, 1].includes(update.direction)) throw new Error("Invalid review transport rate or direction.");
  session.transport = { ...session.transport, playhead: structuredClone(update.playhead), playing: update.playing, playbackRate: update.playbackRate, direction: update.direction, loopRange: update.loopRange ? structuredClone(update.loopRange) : null };
  if (update.activeArtifactRef) { if (!run.artifacts?.[update.activeArtifactRef]) throw new Error("Active review artifact is not registered."); session.activeArtifactRef = update.activeArtifactRef; }
  if (update.compareMode) { if (!MODES.has(update.compareMode)) throw new Error("Unsupported comparison mode."); session.compareMode = update.compareMode; }
  if (update.compareArtifactRefs) { for (const ref of update.compareArtifactRefs) if (!run.artifacts?.[ref]) throw new Error(`Comparison artifact is not registered: ${ref}`); session.compareArtifactRefs = [...update.compareArtifactRefs]; }
  session.revision += 1; session.updatedAt = new Date().toISOString();
  return session;
}

export async function writeReviewSession({ projectPath, runId, reviewSession }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(directory, { recursive: true });
  const path = join(directory, "review_session.json"); await writeFile(path, `${JSON.stringify(reviewSession, null, 2)}\n`, "utf8");
  return { artifactRef: "review_session.json", path };
}

function validateTime(time) { if (!Number.isInteger(time?.value) || time.value < 0 || !Number.isInteger(time.rate) || time.rate < 1) throw new Error("Review transport requires non-negative RationalTime."); }
function validateRange(range) { validateTime(range?.start); validateTime(range?.duration); if (range.duration.value < 1) throw new Error("Review loop duration must be positive."); }

export const reviewCompareModes = [...MODES];
