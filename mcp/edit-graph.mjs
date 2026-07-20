import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const OPERATIONS = new Set(["trim", "split", "delete", "reorder", "replace", "transition", "audio_gain", "audio_duck", "caption_shift", "crop", "resize"]);
const MATERIAL_CHANGES = new Set(["narrative_delete", "duration_change", "aspect_ratio_change", "music_replace", "rights_change", "manual_edit_override"]);
const EDITOR_TRANSITIONS = new Set(["crossfade", "dip_to_black", "fade_through_color", "slide", "wipe", "zoom_blur", "match_cut", "whip_pan"]);

export function registerEditIntent(run, intent) {
  if (!intent?.intentId || !intent.baseTimelineRef || !intent.baseContentHash || !Number.isInteger(intent.baseRevision) || intent.baseRevision < 0) throw new Error("Edit intent requires an ID, base timeline ref, content hash, and non-negative base revision.");
  if (!intent.explicitGoals?.length || !Array.isArray(intent.inferredConstraints) || !intent.requestedOperations?.length) throw new Error("Edit intent requires explicit goals, inferred constraints, and requested operations.");
  for (const operation of intent.requestedOperations) if (!OPERATIONS.has(operation)) throw new Error(`Unsupported edit operation: ${operation}`);
  run.editSession ??= {};
  if (run.editSession.intent && run.editSession.intent.intentId !== intent.intentId) throw new Error("This Run already has a different active edit intent.");
  run.editSession.intent = structuredClone(intent);
  run.editSession.status = "intent_registered";
  return run.editSession.intent;
}

export function registerTimelineRevision(run, revision) {
  validateCanonicalTimeline(revision?.timeline);
  const contentHash = hashTimeline(revision.timeline);
  if (!revision.revisionId || !revision.timelineId || revision.timeline.timelineId !== revision.timelineId || !Number.isInteger(revision.revision) || revision.revision < 0 || revision.contentHash !== contentHash) throw new Error("Timeline revision identity or content hash is invalid.");
  run.editSession ??= {};
  run.editSession.revisions ??= {};
  const head = getTimelineHead(run, revision.timelineId);
  if (head && (revision.revision !== head.revision + 1 || revision.parentRevisionId !== head.revisionId)) throw new Error("Timeline revisions must extend the current head.");
  run.editSession.revisions[revision.revisionId] = structuredClone(revision);
  run.editSession.timelineHeads ??= {};
  run.editSession.timelineHeads[revision.timelineId] = revision.revisionId;
  run.editSession.status = "timeline_revision_registered";
  return run.editSession.revisions[revision.revisionId];
}

export function compileEditGraph(run, graph) {
  if (!run.editSession?.intent || graph?.intentId !== run.editSession.intent.intentId) throw new Error("Compile the edit graph from the active edit intent.");
  if (!graph.graphId || graph.baseTimelineRef !== run.editSession.intent.baseTimelineRef || graph.baseRevision !== run.editSession.intent.baseRevision || !graph.nodes?.length) throw new Error("Edit graph must preserve the intent base timeline and revision.");
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node.nodeId || ids.has(node.nodeId) || !OPERATIONS.has(node.operation)) throw new Error("Edit graph nodes require unique IDs and supported operations.");
    ids.add(node.nodeId);
    if (!Array.isArray(node.dependsOn) || !node.inputArtifactRefs?.length || !node.outputArtifactRefs?.length || !node.affectedRanges?.length) throw new Error("Edit graph nodes require dependencies, artifact handoffs, and affected ranges.");
    for (const range of node.affectedRanges) validateRange(range);
  }
  for (const node of graph.nodes) for (const dependency of node.dependsOn) if (!ids.has(dependency)) throw new Error(`Unknown edit dependency: ${dependency}`);
  assertAcyclic(graph.nodes);
  run.editSession.graph = { ...structuredClone(graph), nodes: graph.nodes.map((node) => ({ ...node, status: node.status ?? "pending" })) };
  run.editSession.status = "graph_compiled";
  return run.editSession.graph;
}

export function registerTimelinePatch(run, patch) {
  const graph = run.editSession?.graph;
  if (!graph || patch?.graphId !== graph.graphId || patch.baseTimelineRef !== graph.baseTimelineRef || patch.baseRevision !== graph.baseRevision) throw new Error("Timeline patch must target the active edit graph base timeline.");
  if (!patch.patchId || !patch.timelineId || !patch.baseContentHash || patch.targetRevision !== patch.baseRevision + 1 || !patch.operations?.length) throw new Error("Timeline patch requires an ID, timeline identity, base content hash, one-step target revision, and operations.");
  const head = getTimelineHead(run, patch.timelineId);
  if (!head || head.revision !== patch.baseRevision || head.contentHash !== patch.baseContentHash) throw new Error("Timeline patch base revision is stale or unregistered.");
  const graphNodes = new Set(graph.nodes.map((node) => node.nodeId));
  for (const operation of patch.operations) {
    if (!operation.operationId || !graphNodes.has(operation.nodeId) || !OPERATIONS.has(operation.operation) || !operation.affectedRanges?.length || !operation.evidenceRefs?.length) throw new Error("Patch operations must map to graph nodes with ranges and evidence.");
    for (const range of operation.affectedRanges) validateRange(range);
  }
  const repairLineage = patch.repairLineage ? validateRepairLineage(run, patch) : null;
  const materialChanges = [...new Set(patch.materialChanges ?? [])];
  for (const change of materialChanges) if (!MATERIAL_CHANGES.has(change)) throw new Error(`Unsupported material edit change: ${change}`);
  run.editSession.patch = { ...structuredClone(patch), repairLineage, materialChanges, requiresUserApproval: materialChanges.length > 0, status: materialChanges.length ? "awaiting_approval" : "dry_run_ready" };
  run.editSession.status = run.editSession.patch.status;
  return run.editSession.patch;
}

export function createPatchPreview(run, { authorSessionId, ttlSeconds = 900, now = new Date() }) {
  const patch = run.editSession?.patch;
  if (!patch || !["awaiting_approval", "dry_run_ready"].includes(patch.status)) throw new Error("Register a dry-run timeline patch before preview.");
  if (!authorSessionId || !Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600) throw new Error("Preview requires an author session and a TTL between 30 and 3600 seconds.");
  const token = randomBytes(32).toString("base64url"), patchDigest = hashObject(patch), previewId = `preview:${patch.patchId}:${now.getTime()}`;
  const record = { previewId, patchId: patch.patchId, patchDigest, timelineId: patch.timelineId, baseRevision: patch.baseRevision, baseContentHash: patch.baseContentHash, authorSessionId, tokenHash: hashToken(token), status: "active", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString() };
  run.editSession.previews ??= {};
  for (const preview of Object.values(run.editSession.previews)) if (preview.patchId === patch.patchId && preview.status === "active") preview.status = "invalidated";
  run.editSession.previews[previewId] = record;
  run.editSession.activePreviewId = previewId;
  run.editSession.status = "patch_previewed";
  return { previewToken: token, preview: structuredClone(record) };
}

export function commitTimelinePatch(run, { patchId, previewId, previewToken, authorSessionId, confirmedBy, approvalNote }, now = new Date()) {
  const patch = run.editSession?.patch;
  if (!patch || patch.patchId !== patchId) throw new Error("Unknown active timeline patch.");
  if (patch.status === "committed") return patch;
  const preview = run.editSession?.previews?.[previewId];
  if (!preview || preview.status !== "active") throw new Error("Timeline commit requires an active single-use preview.");
  if (Date.parse(preview.expiresAt) <= now.getTime()) { preview.status = "expired"; throw new Error("Timeline preview expired; generate and inspect a new preview."); }
  if (preview.authorSessionId !== authorSessionId || preview.tokenHash !== hashToken(previewToken ?? "")) throw new Error("Timeline preview authorization failed.");
  if (preview.patchId !== patch.patchId || preview.patchDigest !== hashObject(patch) || preview.timelineId !== patch.timelineId || preview.baseRevision !== patch.baseRevision || preview.baseContentHash !== patch.baseContentHash) { preview.status = "invalidated"; throw new Error("Timeline patch changed after preview; preview it again."); }
  if (patch.requiresUserApproval && (confirmedBy !== "request_user_input" || !approvalNote)) throw new Error("Material timeline changes require Codex request_user_input approval.");
  const head = getTimelineHead(run, patch.timelineId);
  if (!head || head.revision !== patch.baseRevision || head.contentHash !== patch.baseContentHash) {
    patch.status = "conflict";
    run.editSession.status = "patch_conflict";
    run.editSession.receipt = { receiptId: `receipt:${patch.patchId}`, patchId, graphId: patch.graphId, status: "conflict", baseRevision: patch.baseRevision, actualBaseRevision: head?.revision ?? null, expectedBaseContentHash: patch.baseContentHash, actualBaseContentHash: head?.contentHash ?? null, operationIds: patch.operations.map((item) => item.operationId), reversible: false, approval: null, errors: ["timeline_head_changed"], committedAt: null };
    preview.status = "invalidated";
    return patch;
  }
  const nextTimeline = applyTimelineOperations(head.timeline, patch.operations);
  const nextRevision = { revisionId: `${patch.timelineId}:${patch.targetRevision}`, timelineId: patch.timelineId, revision: patch.targetRevision, parentRevisionId: head.revisionId, contentHash: hashTimeline(nextTimeline), timeline: nextTimeline, patchId: patch.patchId, repairLineage: patch.repairLineage ?? null, createdAt: new Date().toISOString() };
  registerTimelineRevision(run, nextRevision);
  patch.status = "committed";
  patch.committedAt = new Date().toISOString();
  patch.approval = patch.requiresUserApproval ? { confirmedBy, approvalNote } : { confirmedBy: "not_required" };
  run.editSession.status = "patch_committed";
  run.editSession.receipt = { receiptId: `receipt:${patch.patchId}`, patchId, graphId: patch.graphId, status: "committed", baseRevision: patch.baseRevision, targetRevision: patch.targetRevision, expectedBaseContentHash: patch.baseContentHash, resultContentHash: nextRevision.contentHash, resultRevisionId: nextRevision.revisionId, operationIds: patch.operations.map((item) => item.operationId), repairLineage: patch.repairLineage ?? null, reversible: patch.operations.every((item) => item.reversible !== false), approval: patch.approval, errors: [], committedAt: patch.committedAt };
  preview.status = "consumed"; preview.consumedAt = patch.committedAt;
  return patch;
}

export async function writeEditArtifacts({ projectPath, runId, editSession }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(directory, { recursive: true });
  const activeRevisionId = editSession.timelineHeads && editSession.patch?.timelineId ? editSession.timelineHeads[editSession.patch.timelineId] : null;
  const values = { "edit_intent.json": editSession.intent, "edit_graph.json": editSession.graph, "timeline_patch.json": editSession.patch, "timeline_preview.json": editSession.activePreviewId ? editSession.previews?.[editSession.activePreviewId] : null, "edit_receipt.json": editSession.receipt, "timeline_revision.json": activeRevisionId ? editSession.revisions?.[activeRevisionId] : null };
  const written = {};
  for (const [artifactRef, value] of Object.entries(values)) if (value) { const path = join(directory, artifactRef); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); written[artifactRef] = { artifactRef, path }; }
  return written;
}

function validateRange(range) {
  for (const key of ["start", "duration"]) if (!Number.isInteger(range?.[key]?.value) || range[key].value < (key === "duration" ? 1 : 0) || !Number.isInteger(range[key].rate) || range[key].rate < 1) throw new Error("Edit ranges require non-negative rational starts and positive rational durations.");
}

function assertAcyclic(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node])); const visiting = new Set(); const visited = new Set();
  const visit = (id) => { if (visiting.has(id)) throw new Error("Edit graph must be acyclic."); if (visited.has(id)) return; visiting.add(id); for (const dependency of byId.get(id).dependsOn) visit(dependency); visiting.delete(id); visited.add(id); };
  for (const node of nodes) visit(node.nodeId);
}

function validateRepairLineage(run, patch) {
  const lineage = structuredClone(patch.repairLineage);
  const allowedReviewEvidenceRefs = new Set(["final_review_evidence.json", run.finalReviewEvidence?.versionedArtifactRef].filter(Boolean));
  if (!lineage.reviewId || !allowedReviewEvidenceRefs.has(lineage.reviewerEvidenceRef) || lineage.frameAuditRef !== "frame_audit_report.json" || lineage.repairPlanRef !== "frame_audit_repair_plan.json" || !lineage.sourceMediaArtifactRef || !lineage.sourceMediaSha256 || !lineage.findingIds?.length) throw new Error("Repair lineage must bind the DX review, frame audit, repair plan, source media hash, and finding IDs.");
  if (!run.artifacts?.[lineage.reviewerEvidenceRef] || !run.artifacts?.[lineage.frameAuditRef] || !run.artifacts?.[lineage.repairPlanRef]) throw new Error("Repair lineage references must be registered before creating a timeline patch.");
  const source = run.artifacts?.[lineage.sourceMediaArtifactRef];
  if (!source || source.sha256 !== lineage.sourceMediaSha256) throw new Error("Repair lineage source media hash does not match the registered artifact.");
  const knownFindings = new Set(run.frameAuditRepairPlan?.findings?.map((finding) => finding.findingId) ?? []);
  for (const findingId of lineage.findingIds) if (!knownFindings.has(findingId)) throw new Error(`Repair lineage references an unknown finding: ${findingId}`);
  const allowed = new Set(lineage.findingIds);
  for (const operation of patch.operations) {
    if (!operation.repairFindingIds?.length || operation.repairFindingIds.some((findingId) => !allowed.has(findingId))) throw new Error("Every repair operation must bind one or more lineage finding IDs.");
    if (!operation.evidenceRefs.includes(lineage.reviewerEvidenceRef)) throw new Error("Every repair operation must cite the versioned final-review evidence.");
  }
  return lineage;
}

export const editOperations = [...OPERATIONS];
export const materialEditChanges = [...MATERIAL_CHANGES];
export const editorTransitionKinds = [...EDITOR_TRANSITIONS];

export function applyTimelineOperations(timeline, operations) {
  validateCanonicalTimeline(timeline);
  if (!Array.isArray(operations) || !operations.length) throw new Error("Timeline execution requires at least one operation.");
  const limits = timelineLimits(timeline);
  const nextTimeline = structuredClone(timeline);
  for (const operation of operations) applyTypedOperation(nextTimeline, operation, limits);
  validateCanonicalTimeline(nextTimeline);
  validateTimelineSemantics(nextTimeline, limits);
  return nextTimeline;
}

export function hashTimeline(timeline) { return `sha256:${createHash("sha256").update(stableJson(timeline)).digest("hex")}`; }

function getTimelineHead(run, timelineId) { const id = run.editSession?.timelineHeads?.[timelineId]; return id ? run.editSession.revisions?.[id] : null; }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`; return JSON.stringify(value); }
function hashObject(value) { return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`; }
function hashToken(token) { return `sha256:${createHash("sha256").update(token).digest("hex")}`; }
function validateCanonicalTimeline(timeline) { if (timeline?.schemaVersion !== "1.0" || !timeline.timelineId || !timeline.tracks?.length) throw new Error("Invalid canonical timeline."); const ids = new Set(); for (const track of timeline.tracks) for (const clip of track.clips ?? []) { if (!clip.clipId || ids.has(clip.clipId)) throw new Error("Timeline clip IDs must be unique."); ids.add(clip.clipId); validateRange(clip.sourceRange); validateRange(clip.timelineRange); } }
function findClip(timeline, clipId) { for (const track of timeline.tracks) { const index = track.clips.findIndex((clip) => clip.clipId === clipId); if (index >= 0) return { track, clip: track.clips[index], index }; } throw new Error(`Unknown timeline clip: ${clipId}`); }
function applyTypedOperation(timeline, operation, limits) {
  const located = findClip(timeline, operation.clipId);
  if (operation.operation === "trim") {
    const sourceRange = operation.value?.sourceRange;
    const timelineRange = operation.value?.timelineRange;
    validateRange(sourceRange);
    validateRange(timelineRange);
    requireRangeTimebase(sourceRange, located.clip.sourceRange.start.rate, "Trim source range");
    requireRangeTimebase(timelineRange, located.clip.timelineRange.start.rate, "Trim timeline range");
    if (sourceRange.duration.value !== timelineRange.duration.value || sourceRange.duration.rate !== timelineRange.duration.rate) throw new Error("Trim requires matching source and timeline durations.");
    if (rangeStart(sourceRange) < rangeStart(located.clip.sourceRange) || rangeEnd(sourceRange) > rangeEnd(located.clip.sourceRange)) throw new Error("Trim source range exceeds the current clip source bounds.");
    if (rangeEnd(timelineRange) > limits.maxTimelineEnd) throw new Error("Trim timeline range exceeds the canonical timeline bounds.");
    located.clip.sourceRange = structuredClone(sourceRange);
    located.clip.timelineRange = structuredClone(timelineRange);
    located.clip.effects = (located.clip.effects ?? []).map((effect) => effect.kind === "duck" ? { ...effect, range: structuredClone(timelineRange) } : effect);
    return;
  }
  if (operation.operation === "split") {
    const offset = operation.value?.splitOffset;
    const leftClipId = String(operation.value?.leftClipId ?? "").trim();
    const rightClipId = String(operation.value?.rightClipId ?? "").trim();
    if (!leftClipId || !rightClipId || leftClipId === rightClipId) throw new Error("Split requires distinct left and right clip IDs.");
    if (timeline.tracks.some((track) => (track.clips ?? []).some((clip) => clip.clipId === leftClipId || clip.clipId === rightClipId))) throw new Error("Split clip IDs must be new within the timeline.");
    if (!Number.isInteger(offset?.value) || !Number.isInteger(offset?.rate) || offset.value <= 0 || offset.rate < 1) throw new Error("Split requires a positive rational offset.");
    const source = located.clip.sourceRange;
    const target = located.clip.timelineRange;
    if (offset.rate !== source.duration.rate || offset.rate !== target.duration.rate || source.start.rate !== offset.rate || target.start.rate !== offset.rate) throw new Error("Split offset must use the clip timebase.");
    if (offset.value >= source.duration.value || offset.value >= target.duration.value) throw new Error("Split offset must fall inside the clip.");
    const left = structuredClone(located.clip);
    const right = structuredClone(located.clip);
    left.clipId = leftClipId;
    right.clipId = rightClipId;
    left.sourceRange.duration.value = offset.value;
    left.timelineRange.duration.value = offset.value;
    right.sourceRange.start.value += offset.value;
    right.sourceRange.duration.value -= offset.value;
    right.timelineRange.start.value += offset.value;
    right.timelineRange.duration.value -= offset.value;
    left.effects = (left.effects ?? []).filter((effect) => effect.kind !== "transition").map((effect) => effect.kind === "duck" ? { ...effect, range: structuredClone(left.timelineRange) } : effect);
    right.effects = (right.effects ?? []).map((effect) => effect.kind === "duck" ? { ...effect, range: structuredClone(right.timelineRange) } : effect);
    located.track.clips.splice(located.index, 1, left, right);
    return;
  }
  if (operation.operation === "delete") { for (const track of timeline.tracks) for (const clip of track.clips ?? []) clip.effects = (clip.effects ?? []).filter((effect) => effect.kind !== "transition" || effect.toClipId !== located.clip.clipId); located.track.clips.splice(located.index, 1); return; }
  if (operation.operation === "replace") { if (located.clip.mediaRef !== operation.value?.fromMediaRef || !operation.value?.toMediaRef) throw new Error("Replace precondition failed."); located.clip.mediaRef = operation.value.toMediaRef; return; }
  if (operation.operation === "reorder") { const target = timeline.tracks.find((track) => track.trackId === operation.value?.targetTrackId); if (!target || target.kind !== located.track.kind) throw new Error("Invalid target track."); const start = operation.value?.timelineStart; if (!Number.isInteger(start?.value) || !Number.isInteger(start?.rate) || start.value < 0 || start.rate !== located.clip.timelineRange.start.rate) throw new Error("Invalid timeline start or timebase."); if (start.value / start.rate + located.clip.timelineRange.duration.value / located.clip.timelineRange.duration.rate > limits.maxTimelineEnd) throw new Error("Reorder exceeds the canonical timeline bounds."); const delta = start.value - located.clip.timelineRange.start.value; located.track.clips.splice(located.index, 1); located.clip.timelineRange.start = structuredClone(start); located.clip.effects = (located.clip.effects ?? []).map((effect) => effect.kind === "duck" ? { ...effect, range: { ...structuredClone(effect.range), start: { ...effect.range.start, value: effect.range.start.value + delta } } } : effect); target.clips.push(located.clip); target.clips.sort((a, b) => a.timelineRange.start.value / a.timelineRange.start.rate - b.timelineRange.start.value / b.timelineRange.start.rate); return; }
  if (operation.operation === "audio_gain") { if (!["audio", "video"].includes(located.track.kind) || !Number.isFinite(operation.value?.gainDb) || operation.value.gainDb < -96 || operation.value.gainDb > 24) throw new Error("Audio gain must be between -96 dB and +24 dB."); located.clip.effects = [...(located.clip.effects ?? []).filter((effect) => effect.kind !== "gain"), { kind: "gain", db: operation.value.gainDb }]; return; }
  if (operation.operation === "audio_duck") {
    const { gainDb, attackMs, releaseMs, range } = operation.value ?? {};
    if (!["audio", "video"].includes(located.track.kind) || !Number.isFinite(gainDb) || gainDb < -96 || gainDb > 0) throw new Error("Audio duck gain must be between -96 dB and 0 dB.");
    if (!Number.isFinite(attackMs) || attackMs < 0 || attackMs > 10000 || !Number.isFinite(releaseMs) || releaseMs < 0 || releaseMs > 10000) throw new Error("Audio duck attack and release must be between 0 and 10000 ms.");
    validateRange(range); requireRangeTimebase(range, located.clip.timelineRange.start.rate, "Audio duck range");
    if (rangeStart(range) < rangeStart(located.clip.timelineRange) || rangeEnd(range) > rangeEnd(located.clip.timelineRange)) throw new Error("Audio duck range must stay inside the selected clip.");
    located.clip.effects = [...(located.clip.effects ?? []).filter((effect) => effect.kind !== "duck"), { kind: "duck", db: gainDb, attackMs, releaseMs, range: structuredClone(range) }];
    return;
  }
  if (operation.operation === "crop") {
    const crop = operation.value;
    if (located.track.kind !== "video" || ![crop?.x, crop?.y, crop?.width, crop?.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) throw new Error("Crop requires a normalized rectangle inside the source frame.");
    located.clip.effects = [...(located.clip.effects ?? []).filter((effect) => effect.kind !== "crop"), { kind: "crop", x: crop.x, y: crop.y, width: crop.width, height: crop.height }];
    return;
  }
  if (operation.operation === "transition") {
    const { transitionKind, duration, toClipId } = operation.value ?? {};
    if (located.track.kind !== "video" || !EDITOR_TRANSITIONS.has(transitionKind)) throw new Error(`Transition kind must be one of: ${[...EDITOR_TRANSITIONS].join(", ")}.`);
    if (!Number.isInteger(duration?.value) || !Number.isInteger(duration?.rate) || duration.value < 1 || duration.rate !== located.clip.timelineRange.duration.rate) throw new Error("Transition duration must use the clip timebase.");
    const ordered = [...located.track.clips].sort((left, right) => rangeStart(left.timelineRange) - rangeStart(right.timelineRange));
    const index = ordered.findIndex((clip) => clip.clipId === located.clip.clipId), next = ordered[index + 1];
    if (!next || next.clipId !== toClipId) throw new Error("Transition must target the immediately adjacent video clip.");
    const durationSeconds = duration.value / duration.rate;
    if (durationSeconds > Math.min(rangeDuration(located.clip.timelineRange), rangeDuration(next.timelineRange)) / 2) throw new Error("Transition duration cannot exceed half of either adjacent clip.");
    located.clip.effects = [...(located.clip.effects ?? []).filter((effect) => effect.kind !== "transition"), { kind: "transition", transitionKind, duration: structuredClone(duration), toClipId }];
    return;
  }
  if (operation.operation === "caption_shift") { if (located.track.kind !== "caption") throw new Error("Caption shift requires a caption clip."); const start = operation.value?.timelineStart; if (!Number.isInteger(start?.value) || !Number.isInteger(start?.rate) || start.value < 0 || start.rate !== located.clip.timelineRange.start.rate) throw new Error("Invalid caption time or timebase."); located.clip.timelineRange.start = structuredClone(start); return; }
  throw new Error(`Timeline execution is not implemented for operation: ${operation.operation}`);
}

function timelineLimits(timeline) {
  const clips = timeline.tracks.flatMap((track) => track.clips ?? []);
  const videoClips = timeline.tracks.filter((track) => track.kind === "video").flatMap((track) => track.clips ?? []);
  const sourceEndsByMediaRef = new Map();
  for (const clip of clips) sourceEndsByMediaRef.set(clip.mediaRef, Math.max(sourceEndsByMediaRef.get(clip.mediaRef) ?? 0, rangeEnd(clip.sourceRange)));
  return {
    maxTimelineEnd: Math.max(0, ...clips.map((clip) => rangeEnd(clip.timelineRange))),
    initialVideoClipCount: videoClips.length,
    sourceEndsByMediaRef
  };
}

function rangeDuration(range) { return range.duration.value / range.duration.rate; }

function validateTimelineSemantics(timeline, limits) {
  const videoTracks = timeline.tracks.filter((track) => track.kind === "video");
  const videoClips = videoTracks.flatMap((track) => track.clips ?? []);
  if (limits.initialVideoClipCount && !videoClips.length) throw new Error("Timeline edits cannot remove every video clip.");
  for (const track of timeline.tracks) {
    const clips = [...(track.clips ?? [])].sort((left, right) => rangeStart(left.timelineRange) - rangeStart(right.timelineRange));
    for (const clip of clips) {
      requireRangeTimebase(clip.sourceRange, clip.sourceRange.start.rate, "Clip source range");
      requireRangeTimebase(clip.timelineRange, clip.timelineRange.start.rate, "Clip timeline range");
      if (clip.sourceRange.duration.value / clip.sourceRange.duration.rate !== clip.timelineRange.duration.value / clip.timelineRange.duration.rate) throw new Error("Timeline clips require matching source and timeline durations until speed effects are supported.");
      const sourceLimit = limits.sourceEndsByMediaRef.get(clip.mediaRef);
      if (Number.isFinite(sourceLimit) && rangeEnd(clip.sourceRange) > sourceLimit) throw new Error(`Clip ${clip.clipId} exceeds registered source bounds.`);
      if (track.kind !== "caption" && rangeEnd(clip.timelineRange) > limits.maxTimelineEnd) throw new Error(`Clip ${clip.clipId} exceeds canonical timeline bounds.`);
    }
    if (track.kind === "video") for (let index = 1; index < clips.length; index += 1) if (rangeStart(clips[index].timelineRange) < rangeEnd(clips[index - 1].timelineRange)) throw new Error(`Video clips ${clips[index - 1].clipId} and ${clips[index].clipId} overlap.`);
    if (track.kind === "video") for (let index = 0; index < clips.length; index += 1) for (const effect of clips[index].effects ?? []) if (effect.kind === "transition" && clips[index + 1]?.clipId !== effect.toClipId) throw new Error(`Transition on ${clips[index].clipId} no longer targets the adjacent video clip.`);
  }
  const videoEnd = Math.max(0, ...videoClips.map((clip) => rangeEnd(clip.timelineRange)));
  for (const track of timeline.tracks.filter((item) => item.kind === "caption")) for (const clip of track.clips ?? []) if (rangeEnd(clip.timelineRange) > videoEnd) throw new Error(`Caption ${clip.clipId} exceeds the edited video timeline.`);
}

function requireRangeTimebase(range, rate, label) {
  if (range.start.rate !== rate || range.duration.rate !== rate) throw new Error(`${label} must use one consistent project timebase.`);
}

function rangeStart(range) { return range.start.value / range.start.rate; }
function rangeEnd(range) { return rangeStart(range) + range.duration.value / range.duration.rate; }
