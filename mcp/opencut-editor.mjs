import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  compileEditGraph,
  createPatchPreview,
  applyTimelineOperations,
  hashTimeline,
  registerEditIntent,
  registerTimelinePatch,
  registerTimelineRevision
} from "./edit-graph.mjs";

export const OPENCUT_CLASSIC_SOURCE = Object.freeze({
  repository: "https://github.com/OpenCut-app/opencut-classic",
  commit: "cf5e79e919144200294fb9fed22a222592a0aeea",
  license: "MIT",
  upstreamName: "OpenCut Classic",
  productName: "Director X Cut",
  attributionRef: "third_party/opencut-classic/LICENSE"
});

const DRAFT_OPERATIONS = new Set(["trim", "split", "delete", "reorder", "transition", "audio_gain", "audio_duck", "caption_shift", "crop"]);
const MATERIAL_CHANGES = new Set(["narrative_delete", "duration_change", "aspect_ratio_change", "music_replace", "rights_change", "manual_edit_override"]);

export function recordPostProductionEditDecision(run, resolved) {
  if (resolved?.kind !== "post_production_edit" || resolved.status !== "resolved" || resolved.confirmedBy !== "request_user_input") throw new Error("Post-production editing must be decided through Codex request_user_input.");
  const answer = String(resolved.answers?.post_production_edit ?? "").trim();
  const accepted = /进入剪辑|需要剪辑|edit/i.test(answer) && !/直接交付|无需剪辑|skip/i.test(answer);
  run.openCutEditor ??= baseEditorState();
  run.openCutEditor.decision = {
    requestId: resolved.requestId,
    answer,
    status: accepted ? "accepted" : "skipped",
    confirmedBy: "request_user_input",
    decidedAt: resolved.resolvedAt ?? new Date().toISOString()
  };
  return run.openCutEditor.decision;
}

export function createOpenCutEditorSession(run, args, now = new Date().toISOString()) {
  if (run.openCutEditor?.decision?.status !== "accepted") throw new Error("Start Director X Cut only after the user chooses editing through Codex request_user_input.");
  const source = run.artifacts?.[args.sourceArtifactRef];
  if (!source || source.mediaKind !== "video" || Number(source.sizeBytes ?? 0) <= 0) throw new Error("Director X Cut requires a registered non-empty video artifact.");
  if (!Number.isFinite(args.durationSeconds) || args.durationSeconds <= 0 || args.durationSeconds > 12 * 60 * 60) throw new Error("Editor duration must be between zero and twelve hours.");
  if (!Number.isInteger(args.fps) || args.fps < 1 || args.fps > 120) throw new Error("Editor FPS must be an integer from 1 to 120.");
  const active = activeOpenCutSession(run);
  if (active && !["completed", "cancelled", "failed"].includes(active.status)) {
    if (active.sourceArtifactRef !== args.sourceArtifactRef) throw new Error("An active Director X Cut session already targets another source video.");
    return active;
  }

  if (run.editSession) {
    run.editHistory ??= [];
    run.editHistory.push(structuredClone(run.editSession));
    run.editSession = null;
  }

  const editorSessionId = `dxe-${randomUUID()}`;
  const timelineId = `timeline:${run.runId}:manual-edit`;
  const frameCount = Math.max(1, Math.round(args.durationSeconds * args.fps));
  const timeRange = { start: { value: 0, rate: args.fps }, duration: { value: frameCount, rate: args.fps } };
  const videoTrack = {
    trackId: "video-main",
    kind: "video",
    clips: [{
      clipId: "clip-final-1",
      label: source.artifactRef ?? args.sourceArtifactRef,
      mediaRef: args.sourceArtifactRef,
      sourceRange: structuredClone(timeRange),
      timelineRange: structuredClone(timeRange),
      effects: []
    }]
  };
  const captionTrack = buildCaptionTrack(run, args);
  const timeline = {
    schemaVersion: "1.0",
    timelineId,
    rate: { value: 1, rate: args.fps },
    tracks: [videoTrack, ...(captionTrack ? [captionTrack] : [])]
  };
  const revision = {
    revisionId: `${timelineId}:0`,
    timelineId,
    revision: 0,
    parentRevisionId: null,
    contentHash: hashTimeline(timeline),
    timeline,
    createdAt: now
  };
  registerTimelineRevision(run, revision);

  const session = {
    schemaVersion: "1.0",
    editorSessionId,
    engine: { ...OPENCUT_CLASSIC_SOURCE, integrationMode: "bounded_local_adapter" },
    status: "prepared",
    sourceArtifactRef: args.sourceArtifactRef,
    sourcePath: source.path,
    sourceSha256: source.sha256 ?? null,
    durationSeconds: args.durationSeconds,
    fps: args.fps,
    baseTimelineRef: "opencut_project.json",
    baseTimelineRevisionId: revision.revisionId,
    baseRevision: revision.revision,
    baseContentHash: revision.contentHash,
    timelineId,
    project: buildOpenCutProject(run, sessionProjectInput({ editorSessionId, source, args, revision, now })),
    draft: null,
    patchId: null,
    createdAt: now,
    updatedAt: now
  };
  run.openCutEditor ??= baseEditorState();
  run.openCutEditor.sessions[editorSessionId] = session;
  run.openCutEditor.activeSessionId = editorSessionId;
  run.openCutEditor.service = { status: "prepared", host: "127.0.0.1", transport: "directorx_mcp_http", startedAt: null };
  return session;
}

export function markOpenCutServiceRunning(run, editorSessionId, now = new Date().toISOString()) {
  const session = requireOpenCutSession(run, editorSessionId);
  if (["completed", "cancelled", "failed"].includes(session.status)) throw new Error(`Cannot reopen a ${session.status} Director X Cut session.`);
  session.status = "running";
  session.openedAt ??= now;
  session.updatedAt = now;
  run.openCutEditor.service = { status: "running", host: "127.0.0.1", transport: "directorx_mcp_http", startedAt: run.openCutEditor.service?.startedAt ?? now };
  return session;
}

export function buildOpenCutEditorBootstrap(run, editorSessionId) {
  const session = requireOpenCutSession(run, editorSessionId);
  const source = run.artifacts?.[session.sourceArtifactRef];
  if (!source) throw new Error("The Director X Cut source artifact is no longer registered.");
  const reviewTimeline = matchingReviewTimeline(run, session);
  const assets = Object.values(run.artifacts ?? {})
    .filter((artifact) => ["image", "video", "audio"].includes(artifact.mediaKind) && artifact.path)
    .map((artifact) => ({ artifactRef: artifact.artifactRef, mediaKind: artifact.mediaKind, label: artifact.artifactRef, path: artifact.relativePath ?? artifact.path, active: artifact.artifactRef === session.sourceArtifactRef }));
  return {
    schemaVersion: "1.0",
    branding: {
      productName: OPENCUT_CLASSIC_SOURCE.productName,
      company: "openmoss",
      watermarkPolicy: "no_forced_output_watermark",
      accent: "#ef6b4a"
    },
    attribution: OPENCUT_CLASSIC_SOURCE,
    session: publicEditorSession(session),
    project: structuredClone(session.project),
    timeline: structuredClone(run.editSession.revisions[session.baseTimelineRevisionId].timeline),
    source: { artifactRef: session.sourceArtifactRef, path: source.relativePath ?? source.path, durationSeconds: session.durationSeconds, fps: session.fps },
    assets,
    reviewTimeline: reviewTimeline ? structuredClone(reviewTimeline) : null,
    waveform: openCutEditorWaveformDescriptor(run, editorSessionId),
    draft: session.draft ? structuredClone(session.draft) : null
  };
}

export function openCutEditorWaveformDescriptor(run, editorSessionId) {
  const session = requireOpenCutSession(run, editorSessionId);
  const timeline = matchingReviewTimeline(run, session);
  const tracks = Array.isArray(timeline?.audioTracks) ? timeline.audioTracks : [];
  const pyramidTrack = tracks.find((track) => track.waveformId && run.waveformPyramids?.[track.waveformId]);
  if (pyramidTrack) {
    const index = run.waveformPyramids[pyramidTrack.waveformId];
    return {
      mode: "viewport_pyramid",
      waveformId: pyramidTrack.waveformId,
      trackId: pyramidTrack.id,
      role: pyramidTrack.role,
      durationSeconds: index.durationSeconds,
      endpoint: "/directorx/api/editor-waveform",
      staticWindow: pyramidTrack.waveformWindow ? structuredClone(pyramidTrack.waveformWindow) : null
    };
  }
  const staticTrack = tracks.find((track) => track.waveformWindow?.peaks?.length);
  if (staticTrack) return { mode: "static_window", waveformId: staticTrack.waveformId ?? null, trackId: staticTrack.id, role: staticTrack.role, durationSeconds: session.durationSeconds, endpoint: null, staticWindow: structuredClone(staticTrack.waveformWindow) };
  return { mode: "unavailable", waveformId: null, trackId: null, role: null, durationSeconds: session.durationSeconds, endpoint: null, staticWindow: null };
}

export function saveOpenCutEditorDraft(run, input, now = new Date().toISOString()) {
  const session = requireOpenCutSession(run, input.editorSessionId);
  if (!["prepared", "running", "draft_saved"].includes(session.status)) throw new Error(`Director X Cut cannot save a draft while ${session.status}.`);
  if (input.baseRevision !== session.baseRevision || input.baseContentHash !== session.baseContentHash) throw new Error("The editor draft targets a stale Director X timeline revision.");
  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 200) throw new Error("An editor draft requires between one and 200 operations.");
  const operationIds = new Set();
  const operations = input.operations.map((operation, index) => normalizeDraftOperation(operation, index, session, operationIds));
  const baseTimeline = run.editSession?.revisions?.[session.baseTimelineRevisionId]?.timeline;
  if (!baseTimeline) throw new Error("Director X Cut cannot validate a draft without its canonical base timeline.");
  applyTimelineOperations(baseTimeline, operations);
  const materialChanges = [...new Set(["manual_edit_override", ...(input.materialChanges ?? [])])];
  for (const change of materialChanges) if (!MATERIAL_CHANGES.has(change)) throw new Error(`Unsupported manual-edit material change: ${change}`);
  const previousDraft = session.draft ? structuredClone(session.draft) : null;
  if (previousDraft) {
    session.draftHistory ??= [];
    session.draftHistory.push({ ...previousDraft, status: "superseded", supersededAt: now });
  }
  const draft = {
    schemaVersion: "1.0",
    draftId: `ocd-${randomUUID()}`,
    editorSessionId: session.editorSessionId,
    baseRevision: session.baseRevision,
    baseContentHash: session.baseContentHash,
    parentDraftId: previousDraft?.draftId ?? null,
    origin: normalizeDraftOrigin(input.origin),
    summary: String(input.summary ?? "Director X Cut manual edit").trim().slice(0, 500),
    operations,
    materialChanges,
    status: "saved",
    savedAt: now
  };
  session.draft = draft;
  session.status = "draft_saved";
  session.updatedAt = now;
  return draft;
}

export function importOpenCutEditorDraft(run, args, now = new Date()) {
  const session = requireOpenCutSession(run, args.editorSessionId);
  const draft = session.draft;
  if (!draft || draft.status !== "saved") throw new Error("Save a Director X Cut draft before importing it into the canonical timeline.");
  if (session.patchId && run.editSession?.patch?.patchId === session.patchId) throw new Error("This Director X Cut draft is already imported.");

  const intentId = `intent:${session.editorSessionId}:${draft.draftId}`;
  const graphId = `graph:${session.editorSessionId}:${draft.draftId}`;
  const patchId = `patch:${session.editorSessionId}:${draft.draftId}`;
  registerEditIntent(run, {
    intentId,
    baseTimelineRef: session.baseTimelineRef,
    baseRevision: session.baseRevision,
    baseContentHash: session.baseContentHash,
    explicitGoals: [draft.summary],
    inferredConstraints: ["Preserve source media immutability", "Render and re-run full-frame review after commit"],
    requestedOperations: [...new Set(draft.operations.map((item) => item.operation))],
    risks: ["Manual timeline changes may alter duration, narrative rhythm, captions, or audio balance"]
  });
  const nodes = draft.operations.map((operation, index) => ({
    nodeId: `oc-node-${index + 1}`,
    operation: operation.operation,
    dependsOn: index ? [`oc-node-${index}`] : [],
    inputArtifactRefs: index ? [`opencut-operation-${index}`] : [session.sourceArtifactRef, session.baseTimelineRef],
    outputArtifactRefs: [`opencut-operation-${index + 1}`],
    affectedRanges: operation.affectedRanges
  }));
  compileEditGraph(run, { graphId, intentId, baseTimelineRef: session.baseTimelineRef, baseRevision: session.baseRevision, nodes });
  registerTimelinePatch(run, {
    patchId,
    graphId,
    timelineId: session.timelineId,
    baseTimelineRef: session.baseTimelineRef,
    baseRevision: session.baseRevision,
    baseContentHash: session.baseContentHash,
    targetRevision: session.baseRevision + 1,
    summary: draft.summary,
    materialChanges: draft.materialChanges,
    operations: draft.operations.map((operation, index) => ({
      ...operation,
      nodeId: nodes[index].nodeId,
      evidenceRefs: [...new Set([...(operation.evidenceRefs ?? []), "opencut_edit_result.json", session.sourceArtifactRef])]
    }))
  });
  const grant = createPatchPreview(run, { authorSessionId: session.editorSessionId, ttlSeconds: args.ttlSeconds ?? 1800, now });
  session.patchId = patchId;
  session.previewId = grant.preview.previewId;
  session.status = "awaiting_patch_approval";
  session.updatedAt = now.toISOString();
  draft.status = "imported";
  draft.importedAt = now.toISOString();
  return { session, patch: run.editSession.patch, preview: grant.preview, previewToken: grant.previewToken };
}

export function resumeOpenCutEditorAfterDecline(run, resolved, now = new Date().toISOString()) {
  if (resolved?.kind !== "edit_change" || resolved.status !== "resolved" || resolved.confirmedBy !== "request_user_input") return null;
  const answer = Object.values(resolved.answers ?? {}).map(String).join(" ");
  if (!/返回|继续调整|拒绝|不提交|decline|continue editing/i.test(answer)) return null;
  const session = activeOpenCutSession(run);
  if (!session || session.status !== "awaiting_patch_approval") return null;
  const baseRevision = run.editSession?.revisions?.[session.baseTimelineRevisionId];
  if (!baseRevision) throw new Error("Cannot resume Director X Cut because the canonical base timeline is missing.");

  run.editHistory ??= [];
  if (run.editSession) run.editHistory.push({ ...structuredClone(run.editSession), archivedReason: "manual_patch_declined", archivedAt: now });
  run.editSession = {
    revisions: { [baseRevision.revisionId]: structuredClone(baseRevision) },
    timelineHeads: { [session.timelineId]: baseRevision.revisionId },
    status: "timeline_revision_registered"
  };
  session.draftHistory ??= [];
  if (session.draft) session.draftHistory.push({ ...structuredClone(session.draft), status: "declined", declinedAt: now, interactionRequestId: resolved.requestId });
  session.draft = null;
  session.patchId = null;
  session.previewId = null;
  session.status = "running";
  session.updatedAt = now;
  return session;
}

export function markOpenCutEditCommitted(run, patchId, now = new Date().toISOString()) {
  const session = activeOpenCutSession(run);
  if (!session || session.patchId !== patchId) return null;
  session.status = "render_required";
  session.committedAt = now;
  session.updatedAt = now;

  const invalidatedReview = {
    patchId,
    invalidatedAt: now,
    finalMediaReview: run.finalMediaReview ?? null,
    finalReviewEvidence: run.finalReviewEvidence ?? null,
    frameAuditRepairPlan: run.frameAuditRepairPlan ?? null
  };
  if (invalidatedReview.finalMediaReview || invalidatedReview.finalReviewEvidence || invalidatedReview.frameAuditRepairPlan) {
    run.reviewHistory ??= [];
    run.reviewHistory.push(structuredClone(invalidatedReview));
  }
  run.finalMediaReview = null;
  run.finalReviewEvidence = null;
  run.frameAuditRepairPlan = null;
  if (run.artifacts?.["final_review_evidence.json"]) delete run.artifacts["final_review_evidence.json"];
  for (const artifactRef of [invalidatedReview.finalReviewEvidence?.versionedArtifactRef, "render_report.json", "frame_audit_report.json", "frame_identity.jsonl", "frame_audit_repair_plan.json", "av_review_timeline.json", "final_review.json", "delivery_manifest.json"].filter(Boolean)) {
    const record = run.artifacts?.[artifactRef];
    if (record) record.metadata = { ...(record.metadata ?? {}), current: false, invalidatedByPatchId: patchId, invalidatedAt: now };
  }
  run.completionCheck = null;
  const deliveryApproval = run.approvals?.find((approval) => approval.kind === "delivery");
  if (deliveryApproval) deliveryApproval.status = "pending";
  run.decisions = (run.decisions ?? []).filter((decision) => decision.kind !== "delivery");
  return session;
}

export function markOpenCutEditRendered(run, { finalVideoArtifactRef, finalVideoPath, sha256 }, now = new Date().toISOString()) {
  const session = activeOpenCutSession(run);
  if (!session || session.status !== "render_required") return null;
  if (run.editSession?.receipt?.status !== "committed" || run.editSession.receipt.patchId !== session.patchId) throw new Error("Director X Cut rerender requires the committed canonical patch receipt.");
  const artifact = run.artifacts?.[finalVideoArtifactRef];
  if (!artifact || resolve(artifact.path) !== resolve(finalVideoPath) || artifact.sha256 !== sha256) throw new Error("Director X Cut rerender must bind the newly registered delivery video path and SHA-256.");
  session.status = "review_required";
  session.renderedArtifactRef = finalVideoArtifactRef;
  session.renderedPath = finalVideoPath;
  session.renderedSha256 = sha256;
  session.renderedAt = now;
  session.updatedAt = now;
  return session;
}

export function markOpenCutEditReviewed(run, { finalVideoArtifactRef, finalVideoPath, passed }, now = new Date().toISOString()) {
  const session = activeOpenCutSession(run);
  if (!session || session.status !== "review_required" || !passed) return null;
  const artifact = run.artifacts?.[finalVideoArtifactRef];
  if (!artifact || finalVideoArtifactRef !== session.renderedArtifactRef || resolve(finalVideoPath) !== resolve(session.renderedPath) || artifact.sha256 !== session.renderedSha256) throw new Error("Director X Cut review must verify the exact newly rendered artifact.");
  session.status = "completed";
  session.completedAt = now;
  session.updatedAt = now;
  run.openCutEditor.service = { ...(run.openCutEditor.service ?? {}), status: "completed" };
  return session;
}

export function getOpenCutEditorStatus(run) {
  const active = activeOpenCutSession(run);
  return {
    source: OPENCUT_CLASSIC_SOURCE,
    decision: run.openCutEditor?.decision ?? null,
    service: run.openCutEditor?.service ?? { status: "not_started" },
    activeSession: active ? publicEditorSession(active) : null
  };
}

export async function writeOpenCutEditorArtifacts({ projectPath, runId, session }) {
  const root = resolve(projectPath);
  const directory = join(root, ".directorx", "plugin-runs", runId, "artifacts");
  const relation = relative(root, directory);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Director X Cut artifacts must stay inside the project workspace.");
  await mkdir(directory, { recursive: true });
  const values = {
    "opencut_editor_session.json": publicEditorSession(session),
    "opencut_project.json": session.project,
    ...(session.draft ? { "opencut_edit_result.json": session.draft } : {})
  };
  const written = {};
  for (const [artifactRef, value] of Object.entries(values)) {
    const path = join(directory, artifactRef);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    written[artifactRef] = { artifactRef, path };
  }
  return written;
}

function normalizeDraftOperation(operation, index, session, operationIds) {
  if (!DRAFT_OPERATIONS.has(operation?.operation)) throw new Error(`Unsupported Director X Cut operation: ${operation?.operation}`);
  const operationId = String(operation.operationId ?? `oc-operation-${index + 1}`).trim();
  if (!operationId || operationIds.has(operationId)) throw new Error("Director X Cut operation IDs must be unique.");
  operationIds.add(operationId);
  const clipId = String(operation.clipId ?? "").trim();
  if (!clipId) throw new Error("Director X Cut operations require a clip ID.");
  const affectedRanges = operation.affectedRanges ?? [];
  if (!affectedRanges.length) throw new Error("Director X Cut operations require an affected range.");
  for (const range of affectedRanges) validateDraftRange(range, session.fps);
  const durationFrames = Math.round(session.durationSeconds * session.fps);
  for (const range of affectedRanges) if (range.start.value + range.duration.value > durationFrames) throw new Error("Director X Cut affected ranges must stay inside the source duration.");
  if (!operation.value || typeof operation.value !== "object" || Array.isArray(operation.value)) throw new Error("Director X Cut operations require a structured value.");
  validateDraftOperationValue(operation.operation, operation.value, session);
  return {
    operationId,
    operation: operation.operation,
    clipId,
    path: String(operation.path ?? `/tracks/video-main/clips/${clipId}`).slice(0, 300),
    value: structuredClone(operation.value),
    affectedRanges: structuredClone(affectedRanges),
    evidenceRefs: normalizeEvidenceRefs(operation.evidenceRefs),
    reversible: true
  };
}

function validateDraftOperationValue(operation, value, session) {
  if (operation === "trim") {
    validateDraftRange(value.sourceRange, session.fps);
    validateDraftRange(value.timelineRange, session.fps);
    return;
  }
  if (operation === "split") {
    const offset = value.splitOffset;
    if (!Number.isInteger(offset?.value) || offset.value <= 0 || offset.rate !== session.fps || offset.value >= Math.round(session.durationSeconds * session.fps)) throw new Error("Director X Cut split offsets must fall inside the source duration and use the project timebase.");
    if (!String(value.leftClipId ?? "").trim() || !String(value.rightClipId ?? "").trim() || value.leftClipId === value.rightClipId) throw new Error("Director X Cut split operations require distinct output clip IDs.");
    return;
  }
  if (operation === "reorder") {
    if (!String(value.targetTrackId ?? "").trim()) throw new Error("Director X Cut reorder operations require a target track.");
    validateDraftTime(value.timelineStart, session.fps, "timeline start");
    return;
  }
  if (operation === "audio_gain") {
    if (!Number.isFinite(value.gainDb) || value.gainDb < -96 || value.gainDb > 24) throw new Error("Director X Cut audio gain must be between -96 dB and +24 dB.");
    return;
  }
  if (operation === "audio_duck") {
    if (!Number.isFinite(value.gainDb) || value.gainDb < -96 || value.gainDb > 0) throw new Error("Director X Cut audio duck gain must be between -96 dB and 0 dB.");
    if (!Number.isFinite(value.attackMs) || value.attackMs < 0 || value.attackMs > 10000 || !Number.isFinite(value.releaseMs) || value.releaseMs < 0 || value.releaseMs > 10000) throw new Error("Director X Cut audio duck attack and release must be between 0 and 10000 ms.");
    validateDraftRange(value.range, session.fps);
    return;
  }
  if (operation === "crop") {
    if (![value.x, value.y, value.width, value.height].every(Number.isFinite) || value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0 || value.x + value.width > 1 || value.y + value.height > 1) throw new Error("Director X Cut crop must be a normalized rectangle inside the source frame.");
    return;
  }
  if (operation === "transition") {
    if (!["crossfade", "dip_to_black"].includes(value.transitionKind)) throw new Error("Director X Cut transition must be crossfade or dip_to_black.");
    validateDraftTime(value.duration, session.fps, "transition duration");
    if (value.duration.value < 1 || !String(value.toClipId ?? "").trim()) throw new Error("Director X Cut transition requires a positive duration and adjacent target clip.");
    return;
  }
  if (operation === "caption_shift") validateDraftTime(value.timelineStart, session.fps, "caption start");
}

function validateDraftRange(range, fps) {
  for (const key of ["start", "duration"]) {
    const value = range?.[key];
    if (!Number.isInteger(value?.value) || value.value < (key === "duration" ? 1 : 0) || value.rate !== fps) throw new Error(`Director X Cut ranges must use the ${fps} fps project timebase.`);
  }
}

function validateDraftTime(value, fps, label) {
  if (!Number.isInteger(value?.value) || value.value < 0 || value.rate !== fps) throw new Error(`Director X Cut ${label} must use the ${fps} fps project timebase.`);
}

function buildOpenCutProject(run, input) {
  return {
    metadata: { id: input.editorSessionId, name: `${run.goal?.outcome ?? "Director X production"} · manual edit`, duration: input.args.durationSeconds, createdAt: input.now, updatedAt: input.now },
    settings: { fps: input.args.fps, canvasSize: input.args.canvasSize ?? null, background: { type: "color", color: "#080808" } },
    scenes: [{ id: "main", name: "Main scene", isMain: true, tracks: structuredClone(input.revision.timeline.tracks), bookmarks: [] }],
    currentSceneId: "main",
    version: 1,
    directorx: { runId: run.runId, sourceArtifactRef: input.args.sourceArtifactRef, canonicalTimelineRevisionId: input.revision.revisionId, immutableSourceSha256: input.source.sha256 ?? null },
    branding: { productName: OPENCUT_CLASSIC_SOURCE.productName, upstreamAttribution: OPENCUT_CLASSIC_SOURCE, forcedOutputWatermark: false }
  };
}

function buildCaptionTrack(run, args) {
  const timeline = run.avReviewTimeline;
  if (!timeline || timeline.mediaArtifactRef !== args.sourceArtifactRef || !Array.isArray(timeline.subtitles) || !timeline.subtitles.length) return null;
  const seen = new Set();
  const clips = timeline.subtitles.map((cue, index) => {
    const startSeconds = rationalSeconds(cue.range?.start);
    const durationSeconds = rationalSeconds(cue.range?.duration);
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || startSeconds + durationSeconds > args.durationSeconds + .05) throw new Error("Director X Cut cannot import an invalid subtitle range from the A/V review timeline.");
    const baseId = `caption-${String(cue.id ?? index + 1).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80)}`;
    const clipId = seen.has(baseId) ? `${baseId}-${index + 1}` : baseId;
    seen.add(clipId);
    return {
      clipId,
      label: String(cue.text ?? cue.label ?? cue.id ?? `Caption ${index + 1}`).slice(0, 500),
      mediaRef: `caption:${cue.id ?? index + 1}`,
      sourceRange: { start: { value: 0, rate: args.fps }, duration: frameTime(durationSeconds, args.fps) },
      timelineRange: { start: frameTime(startSeconds, args.fps), duration: frameTime(durationSeconds, args.fps) },
      effects: [],
      metadata: { cueId: cue.id ?? null, text: cue.text ?? cue.label ?? "", speaker: cue.speaker ?? null }
    };
  });
  return { trackId: "captions-main", kind: "caption", clips };
}

function matchingReviewTimeline(run, session) {
  return run.avReviewTimeline?.mediaArtifactRef === session.sourceArtifactRef ? run.avReviewTimeline : null;
}

function normalizeDraftOrigin(origin) {
  if (!origin) return { kind: "manual", owner: "user" };
  if (origin.kind !== "dx_agent" || origin.owner !== "DX-Editor" || !/^[A-Za-z0-9._:-]{1,120}$/.test(origin.proposalId ?? "")) throw new Error("Agent-authored Director X Cut drafts must come from DX-Editor with a valid proposal ID.");
  return { kind: "dx_agent", owner: "DX-Editor", proposalId: origin.proposalId };
}

function normalizeEvidenceRefs(values) {
  const refs = [...new Set(["opencut_editor_session.json", ...(Array.isArray(values) ? values : [])].map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (refs.length > 24 || refs.some((value) => value.length > 240 || /[\r\n\0]/.test(value))) throw new Error("Director X Cut evidence references must be bounded single-line identifiers.");
  return refs;
}

function frameTime(seconds, fps) { return { value: Math.max(0, Math.round(seconds * fps)), rate: fps }; }
function rationalSeconds(time) { return Number(time?.value) / Number(time?.rate); }

function sessionProjectInput({ editorSessionId, source, args, revision, now }) { return { editorSessionId, source, args, revision, now }; }
function baseEditorState() { return { schemaVersion: "1.0", source: OPENCUT_CLASSIC_SOURCE, decision: null, service: { status: "not_started" }, activeSessionId: null, sessions: {} }; }
function activeOpenCutSession(run) { const id = run.openCutEditor?.activeSessionId; return id ? run.openCutEditor.sessions?.[id] ?? null : null; }
function requireOpenCutSession(run, editorSessionId) { const session = run.openCutEditor?.sessions?.[editorSessionId]; if (!session) throw new Error(`Unknown Director X Cut session: ${editorSessionId}`); return session; }
function publicEditorSession(session) { const { sourcePath, project, draft, ...safe } = session; return { ...structuredClone(safe), hasDraft: Boolean(draft), sourcePathRef: sourcePath ? "project-contained" : null }; }
