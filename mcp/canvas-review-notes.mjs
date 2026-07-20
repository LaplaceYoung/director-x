import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const CANVAS_REVIEW_NOTE_CATEGORIES = [
  "creative_direction",
  "timing",
  "continuity",
  "subtitle",
  "audio",
  "technical"
];

export const CANVAS_REVIEW_NOTE_SEVERITIES = ["note", "minor", "major", "critical"];

const MEDIA_KINDS = new Set(["image", "video", "audio"]);
const MAX_NOTES = 200;

export function recordCanvasReviewNote(run, input, now = new Date().toISOString()) {
  const clientNoteId = boundedSingleLine(input?.clientNoteId, 160, "clientNoteId");
  run.canvasReviewNotes ??= [];
  const existing = run.canvasReviewNotes.find((item) => item.clientNoteId === clientNoteId);
  if (existing) {
    assertIdempotentRetry(existing, input);
    return existing;
  }
  if (run.canvasReviewNotes.length >= MAX_NOTES) throw new Error(`Canvas review notes are limited to ${MAX_NOTES} per Run.`);

  const targetArtifactRef = boundedSingleLine(input?.targetArtifactRef, 300, "targetArtifactRef");
  const artifact = run.artifacts?.[targetArtifactRef];
  if (!artifact) throw new Error(`Canvas review note target must be a registered artifact: ${targetArtifactRef}`);
  if (!MEDIA_KINDS.has(artifact.mediaKind)) throw new Error("Canvas review notes must target a registered media artifact.");
  const category = enumValue(input?.category, CANVAS_REVIEW_NOTE_CATEGORIES, "category");
  const severity = enumValue(input?.severity, CANVAS_REVIEW_NOTE_SEVERITIES, "severity");
  const body = boundedBody(input?.body);
  const timeSeconds = normalizeTime(input?.timeSeconds, artifact);

  const note = {
    noteId: `canvas-note-${randomUUID()}`,
    clientNoteId,
    author: "user",
    source: "side_browser_canvas",
    targetArtifactRef,
    targetNodeId: input?.targetNodeId == null ? null : boundedSingleLine(input.targetNodeId, 240, "targetNodeId"),
    timeSeconds,
    category,
    severity,
    body,
    status: "open",
    owner: null,
    resolution: null,
    isApproval: false,
    canSatisfyGate: false,
    createdAt: validIso(now),
    updatedAt: validIso(now)
  };
  run.canvasReviewNotes.push(note);
  return note;
}

export function acknowledgeCanvasReviewNote(run, input, now = new Date().toISOString()) {
  const note = requireNote(run, input?.noteId);
  if (note.status === "resolved") throw new Error("Resolved canvas review notes cannot be acknowledged again.");
  note.status = "acknowledged";
  note.owner = boundedSingleLine(input?.owner, 120, "owner");
  note.updatedAt = validIso(now);
  return note;
}

export function resolveCanvasReviewNote(run, input, now = new Date().toISOString()) {
  const note = requireNote(run, input?.noteId);
  if (note.status === "resolved") return note;
  const evidenceRefs = [...new Set(Array.isArray(input?.evidenceRefs) ? input.evidenceRefs : [])].map((item) => boundedSingleLine(item, 300, "evidenceRef"));
  if (!evidenceRefs.length || evidenceRefs.some((artifactRef) => !run.artifacts?.[artifactRef])) throw new Error("Resolving a canvas review note requires registered evidence artifacts.");
  const resolutionEvidence = evidenceRefs.filter((artifactRef) => artifactRef !== note.targetArtifactRef && artifactRef !== "canvas_review_notes.json");
  if (!resolutionEvidence.length) throw new Error("Resolving a canvas review note requires repair or review evidence beyond the original target and note ledger.");
  note.status = "resolved";
  note.resolution = {
    summary: boundedText(input?.resolutionSummary, 1200, "resolutionSummary"),
    evidenceRefs: resolutionEvidence,
    resolvedAt: validIso(now)
  };
  note.updatedAt = validIso(now);
  return note;
}

export async function writeCanvasReviewNotesArtifact({ projectPath, runId, notes }) {
  const directory = join(resolve(projectPath), ".directorx", "plugin-runs", runId, "review");
  const path = join(directory, "canvas_review_notes.json");
  await mkdir(directory, { recursive: true });
  await writeFile(path, `${JSON.stringify({ schemaVersion: "1.0", notes }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { artifactRef: "canvas_review_notes.json", path };
}

function requireNote(run, noteId) {
  const normalized = boundedSingleLine(noteId, 220, "noteId");
  const note = (run.canvasReviewNotes ?? []).find((item) => item.noteId === normalized);
  if (!note) throw new Error(`Unknown canvas review note: ${normalized}`);
  return note;
}

function assertIdempotentRetry(existing, input) {
  const requested = {
    targetArtifactRef: input?.targetArtifactRef,
    targetNodeId: input?.targetNodeId ?? null,
    timeSeconds: input?.timeSeconds == null ? null : Number(input.timeSeconds),
    category: input?.category,
    severity: input?.severity,
    body: String(input?.body ?? "").trim()
  };
  const stored = {
    targetArtifactRef: existing.targetArtifactRef,
    targetNodeId: existing.targetNodeId,
    timeSeconds: existing.timeSeconds,
    category: existing.category,
    severity: existing.severity,
    body: existing.body
  };
  if (JSON.stringify(requested) !== JSON.stringify(stored)) throw new Error("clientNoteId is already bound to different canvas feedback.");
}

function normalizeTime(value, artifact) {
  if (value == null || value === "") return null;
  const time = Number(value);
  if (!Number.isFinite(time) || time < 0 || time > 43200) throw new Error("Canvas review note timeSeconds is outside safe bounds.");
  const duration = mediaDuration(artifact);
  if (duration != null && time > duration + 0.001) throw new Error(`Canvas review note timeSeconds exceeds the target media duration of ${duration}s.`);
  return Math.round(time * 1000) / 1000;
}

function mediaDuration(artifact) {
  const candidates = [artifact?.metadata?.durationSeconds, artifact?.metadata?.probe?.durationSeconds].map(Number);
  return candidates.find((value) => Number.isFinite(value) && value >= 0) ?? null;
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`Canvas review note ${label} must be one of: ${allowed.join(", ")}.`);
  return value;
}

function boundedBody(value) {
  const text = boundedText(value, 1200, "body");
  if (text.length < 2) throw new Error("Canvas review note body is too short.");
  return text;
}

function boundedText(value, maxLength, label) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength || text.includes("\0")) throw new Error(`Canvas review note ${label} must be non-empty and no longer than ${maxLength} characters.`);
  return text;
}

function boundedSingleLine(value, maxLength, label) {
  const text = boundedText(value, maxLength, label);
  if (/[\r\n]/.test(text)) throw new Error(`Canvas review note ${label} must be a single-line value.`);
  return text;
}

function validIso(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error("Canvas review note timestamp must be valid ISO time.");
  return new Date(time).toISOString();
}
