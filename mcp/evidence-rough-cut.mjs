import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { saveOpenCutEditorDraft } from "./opencut-editor.mjs";

const PROPOSAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

export function proposeEvidenceRoughCut(run, input, now = new Date().toISOString()) {
  if (input?.owner !== "DX-Editor") throw new Error("Evidence rough cuts must be authored by DX-Editor.");
  if (!PROPOSAL_ID_PATTERN.test(input?.proposalId ?? "")) throw new Error("Evidence rough-cut proposal IDs must be stable bounded identifiers.");
  const existing = run.roughCutProposals?.[input.proposalId];
  if (existing) {
    if (existing.editorSessionId !== input.editorSessionId) throw new Error("This evidence rough-cut proposal ID is already bound to another editor session.");
    return { proposal: structuredClone(existing), draft: structuredClone(findEditorSession(run, input.editorSessionId).draft) };
  }

  const session = findEditorSession(run, input.editorSessionId);
  if (!["prepared", "running", "draft_saved"].includes(session.status)) throw new Error(`DX-Editor cannot propose a rough cut while the editor is ${session.status}.`);
  if (session.draft?.status === "saved") throw new Error("Review or supersede the current Director X Cut draft before asking DX-Editor for another rough cut.");
  if (!Array.isArray(input.inactiveRanges) || input.inactiveRanges.length < 1 || input.inactiveRanges.length > 48) throw new Error("Evidence rough cuts require between one and 48 inactive ranges.");

  const fps = session.fps;
  const durationFrames = Math.max(1, Math.round(session.durationSeconds * fps));
  const keepBeforeFrames = secondsToFrames(input.keepBeforeSeconds ?? 0.12, fps, "keep-before margin");
  const keepAfterFrames = secondsToFrames(input.keepAfterSeconds ?? 0.12, fps, "keep-after margin");
  const minCutFrames = Math.max(1, secondsToFrames(input.minimumCutSeconds ?? 0.25, fps, "minimum cut"));
  const evidenceIndex = buildEvidenceIndex(run);
  const normalized = normalizeInactiveRanges(input.inactiveRanges, { durationFrames, fps, keepBeforeFrames, keepAfterFrames, minCutFrames, evidenceIndex });
  if (!normalized.cuts.length) throw new Error("No inactive interval remains after context margins and the minimum-cut threshold.");
  const removedFrames = normalized.cuts.reduce((total, cut) => total + cut.endFrame - cut.startFrame, 0);
  if (removedFrames >= durationFrames) throw new Error("A rough-cut proposal cannot remove the complete source video.");

  const revision = run.editSession?.revisions?.[session.baseTimelineRevisionId];
  if (!revision) throw new Error("DX-Editor cannot find the immutable base timeline revision.");
  const videoTrack = revision.timeline.tracks.find((track) => track.kind === "video");
  const baseClip = videoTrack?.clips?.find((clip) => clip.mediaRef === session.sourceArtifactRef) ?? videoTrack?.clips?.[0];
  if (!baseClip) throw new Error("DX-Editor requires a source video clip on the base timeline.");

  const operations = buildVideoOperations({ proposalId: input.proposalId, baseClip, cuts: normalized.cuts, durationFrames, fps });
  operations.push(...buildCaptionOperations({ timeline: revision.timeline, cuts: normalized.cuts, fps }));
  if (operations.length > 200) throw new Error("This rough cut expands beyond the 200-operation safety limit; split it into smaller proposals.");

  const summary = String(input.summary ?? `DX-Editor evidence rough cut: remove ${(removedFrames / fps).toFixed(2)}s of inactive material`).trim().slice(0, 500);
  const draft = saveOpenCutEditorDraft(run, {
    editorSessionId: session.editorSessionId,
    baseRevision: session.baseRevision,
    baseContentHash: session.baseContentHash,
    origin: { kind: "dx_agent", owner: "DX-Editor", proposalId: input.proposalId },
    summary,
    materialChanges: ["narrative_delete", "duration_change"],
    operations
  }, now);

  const proposal = {
    schemaVersion: "1.0",
    proposalId: input.proposalId,
    editorSessionId: session.editorSessionId,
    owner: "DX-Editor",
    status: "draft_ready",
    sourceArtifactRef: session.sourceArtifactRef,
    baseTimelineRevisionId: session.baseTimelineRevisionId,
    draftId: draft.draftId,
    summary,
    policy: {
      keepBeforeSeconds: keepBeforeFrames / fps,
      keepAfterSeconds: keepAfterFrames / fps,
      minimumCutSeconds: minCutFrames / fps,
      sourceImmutable: true,
      draftOnly: true
    },
    cuts: normalized.cuts.map((cut) => publicCut(cut, fps)),
    omittedRanges: normalized.omittedRanges,
    sourceDurationSeconds: durationFrames / fps,
    removedDurationSeconds: removedFrames / fps,
    estimatedOutputDurationSeconds: (durationFrames - removedFrames) / fps,
    operationCount: operations.length,
    operationSummary: countOperations(operations),
    evidenceRefs: [...new Set(normalized.cuts.flatMap((cut) => cut.evidenceRefs))],
    requiresNativeApproval: true,
    nextTool: "directorx_import_opencut_edit_result",
    approvalKind: "edit_change",
    createdAt: now
  };
  run.roughCutProposals ??= {};
  run.roughCutProposals[input.proposalId] = proposal;
  return { proposal: structuredClone(proposal), draft: structuredClone(draft) };
}

export async function writeEvidenceRoughCutArtifact({ projectPath, runId, proposal }) {
  if (!PROPOSAL_ID_PATTERN.test(proposal?.proposalId ?? "")) throw new Error("Cannot persist an invalid evidence rough-cut proposal ID.");
  const root = resolve(projectPath);
  const directory = join(root, ".directorx", "plugin-runs", runId, "artifacts");
  const relation = relative(root, directory);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Evidence rough-cut artifacts must stay inside the project workspace.");
  await mkdir(directory, { recursive: true });
  const artifactRef = `rough_cut_proposal_${proposal.proposalId.replace(/[^A-Za-z0-9._-]/g, "-")}.json`;
  const path = join(directory, artifactRef);
  await writeFile(path, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
  return { artifactRef, path };
}

function buildVideoOperations({ proposalId, baseClip, cuts, durationFrames, fps }) {
  const slug = proposalId.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
  const boundaries = [...new Set([0, durationFrames, ...cuts.flatMap((cut) => [cut.startFrame, cut.endFrame])])].sort((a, b) => a - b);
  const segmentIds = boundaries.slice(0, -1).map((_, index) => `dxrc-${slug}-seg-${index + 1}`);
  const operations = [];
  let currentClipId = baseClip.clipId;
  let currentStart = 0;
  const interiorBoundaries = boundaries.slice(1, -1);

  interiorBoundaries.forEach((boundary, index) => {
    const leftClipId = segmentIds[index];
    const rightClipId = index === interiorBoundaries.length - 1 ? segmentIds[index + 1] : `dxrc-${slug}-remain-${index + 1}`;
    operations.push({
      operationId: `dxrc-${slug}-split-${index + 1}`,
      operation: "split",
      clipId: currentClipId,
      path: `/tracks/video-main/clips/${currentClipId}`,
      value: { splitOffset: frameTime(boundary - currentStart, fps), leftClipId, rightClipId },
      affectedRanges: [frameRange(boundary, 1, fps)],
      evidenceRefs: evidenceAtBoundary(cuts, boundary)
    });
    currentClipId = rightClipId;
    currentStart = boundary;
  });

  let outputStart = 0;
  for (let index = 0; index < segmentIds.length; index += 1) {
    const startFrame = boundaries[index];
    const endFrame = boundaries[index + 1];
    const clipId = segmentIds[index];
    const cut = cuts.find((candidate) => candidate.startFrame <= startFrame && candidate.endFrame >= endFrame);
    if (cut) {
      operations.push({
        operationId: `dxrc-${slug}-delete-${index + 1}`,
        operation: "delete",
        clipId,
        path: `/tracks/video-main/clips/${clipId}`,
        value: {},
        affectedRanges: [frameRange(startFrame, endFrame - startFrame, fps)],
        evidenceRefs: cut.evidenceRefs
      });
      continue;
    }
    if (outputStart !== startFrame) {
      operations.push({
        operationId: `dxrc-${slug}-move-${index + 1}`,
        operation: "reorder",
        clipId,
        path: `/tracks/video-main/clips/${clipId}`,
        value: { targetTrackId: "video-main", timelineStart: frameTime(outputStart, fps) },
        affectedRanges: [frameRange(startFrame, endFrame - startFrame, fps)],
        evidenceRefs: evidenceBefore(cuts, startFrame)
      });
    }
    outputStart += endFrame - startFrame;
  }
  return operations;
}

function buildCaptionOperations({ timeline, cuts, fps }) {
  const captionTrack = timeline.tracks.find((track) => track.kind === "caption");
  if (!captionTrack) return [];
  const operations = [];
  for (const clip of captionTrack.clips ?? []) {
    const startFrame = convertFrame(clip.timelineRange.start, fps);
    const durationFrames = convertFrame(clip.timelineRange.duration, fps);
    const endFrame = startFrame + durationFrames;
    const overlaps = cuts.filter((cut) => startFrame < cut.endFrame && endFrame > cut.startFrame);
    if (overlaps.length) {
      const containing = overlaps.find((cut) => startFrame >= cut.startFrame && endFrame <= cut.endFrame);
      if (!containing || overlaps.length > 1) throw new Error(`Caption ${clip.clipId} crosses a proposed cut boundary; repair the interval or caption timing before rough-cut approval.`);
      operations.push({
        operationId: `dxrc-caption-delete-${clip.clipId}`,
        operation: "delete",
        clipId: clip.clipId,
        path: `/tracks/${captionTrack.trackId}/clips/${clip.clipId}`,
        value: {},
        affectedRanges: [frameRange(startFrame, durationFrames, fps)],
        evidenceRefs: containing.evidenceRefs
      });
      continue;
    }
    const preceding = cuts.filter((cut) => cut.endFrame <= startFrame);
    const removedBefore = preceding.reduce((total, cut) => total + cut.endFrame - cut.startFrame, 0);
    if (!removedBefore) continue;
    operations.push({
      operationId: `dxrc-caption-shift-${clip.clipId}`,
      operation: "caption_shift",
      clipId: clip.clipId,
      path: `/tracks/${captionTrack.trackId}/clips/${clip.clipId}`,
      value: { timelineStart: frameTime(startFrame - removedBefore, fps) },
      affectedRanges: [frameRange(startFrame, durationFrames, fps)],
      evidenceRefs: [...new Set(preceding.flatMap((cut) => cut.evidenceRefs))]
    });
  }
  return operations;
}

function normalizeInactiveRanges(ranges, options) {
  const accepted = [];
  const omittedRanges = [];
  ranges.forEach((range, index) => {
    if (!Number.isFinite(range?.startSeconds) || !Number.isFinite(range?.endSeconds) || range.startSeconds < 0 || range.endSeconds <= range.startSeconds || range.endSeconds > options.durationFrames / options.fps + 0.001) throw new Error(`Inactive range ${index + 1} is outside the editor source duration.`);
    const evidenceRefs = validateEvidenceRefs(range.evidenceRefs, options.evidenceIndex, index);
    const startFrame = Math.min(options.durationFrames, Math.ceil(range.startSeconds * options.fps) + options.keepBeforeFrames);
    const endFrame = Math.max(0, Math.floor(range.endSeconds * options.fps) - options.keepAfterFrames);
    if (endFrame - startFrame < options.minCutFrames) {
      omittedRanges.push({ index, startSeconds: range.startSeconds, endSeconds: range.endSeconds, reason: "below_minimum_after_context_margins", evidenceRefs });
      return;
    }
    accepted.push({ startFrame, endFrame, evidenceRefs, reasons: [String(range.reason ?? "inactive_interval").slice(0, 240)], sourceIndexes: [index] });
  });
  accepted.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  const cuts = [];
  for (const candidate of accepted) {
    const previous = cuts.at(-1);
    if (previous && candidate.startFrame <= previous.endFrame) {
      previous.endFrame = Math.max(previous.endFrame, candidate.endFrame);
      previous.evidenceRefs = [...new Set([...previous.evidenceRefs, ...candidate.evidenceRefs])];
      previous.reasons = [...new Set([...previous.reasons, ...candidate.reasons])];
      previous.sourceIndexes.push(...candidate.sourceIndexes);
    } else cuts.push(structuredClone(candidate));
  }
  return { cuts, omittedRanges };
}

function buildEvidenceIndex(run) {
  const index = new Set(Object.keys(run.artifacts ?? {}));
  for (const marker of run.avReviewTimeline?.markers ?? []) {
    if (marker.id) index.add(marker.id);
    for (const ref of marker.evidenceRefs ?? []) index.add(ref);
  }
  return index;
}

function validateEvidenceRefs(values, evidenceIndex, index) {
  const refs = [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (!refs.length) throw new Error(`Inactive range ${index + 1} requires evidence references.`);
  if (refs.length > 16 || refs.some((ref) => ref.length > 240 || /[\r\n\0]/.test(ref))) throw new Error("Evidence rough-cut references must be bounded single-line identifiers.");
  const unknown = refs.filter((ref) => !evidenceIndex.has(ref));
  if (unknown.length) throw new Error(`Inactive range ${index + 1} cites unregistered evidence: ${unknown.join(", ")}`);
  return refs;
}

function evidenceAtBoundary(cuts, boundary) {
  return [...new Set(cuts.filter((cut) => cut.startFrame === boundary || cut.endFrame === boundary).flatMap((cut) => cut.evidenceRefs))];
}

function evidenceBefore(cuts, startFrame) {
  return [...new Set(cuts.filter((cut) => cut.endFrame <= startFrame).flatMap((cut) => cut.evidenceRefs))];
}

function countOperations(operations) {
  return Object.fromEntries([...new Set(operations.map((operation) => operation.operation))].sort().map((kind) => [kind, operations.filter((operation) => operation.operation === kind).length]));
}

function publicCut(cut, fps) {
  return { startSeconds: cut.startFrame / fps, endSeconds: cut.endFrame / fps, durationSeconds: (cut.endFrame - cut.startFrame) / fps, evidenceRefs: cut.evidenceRefs, reasons: cut.reasons, sourceIndexes: cut.sourceIndexes };
}

function findEditorSession(run, editorSessionId) {
  const session = run.openCutEditor?.sessions?.[editorSessionId];
  if (!session) throw new Error(`Unknown Director X Cut session: ${editorSessionId}`);
  return session;
}

function secondsToFrames(seconds, fps, label) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 10) throw new Error(`Evidence rough-cut ${label} must be between 0 and 10 seconds.`);
  return Math.round(seconds * fps);
}

function convertFrame(time, fps) {
  const value = Number(time?.value);
  const rate = Number(time?.rate);
  if (!Number.isInteger(value) || value < 0 || !Number.isInteger(rate) || rate < 1) throw new Error("Evidence rough cuts require valid rational timeline ranges.");
  return Math.round(value * fps / rate);
}

function frameTime(value, fps) { return { value: Math.max(0, Math.round(value)), rate: fps }; }
function frameRange(start, duration, fps) { return { start: frameTime(start, fps), duration: frameTime(Math.max(1, duration), fps) }; }
