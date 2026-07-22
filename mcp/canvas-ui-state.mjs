const VIEWS = new Set(["media", "workflow", "coverage", "continuity", "storyboard", "review", "activity"]);
const FILTERS = new Set(["all", "asset"]);

export function normalizeCanvasUiState(value, now = new Date().toISOString()) {
  if (!value || value.version !== 1) throw new Error("Canvas UI state must use version 1.");
  if (!VIEWS.has(value.view) || !FILTERS.has(value.filter)) throw new Error("Canvas UI state contains an unsupported view or filter.");
  const transform = value.transform;
  if (![transform?.x, transform?.y, transform?.zoom].every(Number.isFinite) || transform.zoom < .25 || transform.zoom > 1.6 || Math.abs(transform.x) > 100000 || Math.abs(transform.y) > 100000) throw new Error("Canvas UI transform is outside safe bounds.");
  const timelineViewport = value.timelineViewport == null ? null : boundedViewport(value.timelineViewport);
  const reviewCurrentTime = Number(value.reviewCurrentTime ?? 0);
  if (!Number.isFinite(reviewCurrentTime) || reviewCurrentTime < 0 || reviewCurrentTime > 43200) throw new Error("Canvas review playhead is outside safe bounds.");
  return {
    version: 1,
    transform: { x: transform.x, y: transform.y, zoom: transform.zoom },
    view: value.view,
    filter: value.filter,
    query: boundedText(value.query ?? "", 200, "query"),
    railCollapsed: Boolean(value.railCollapsed),
    mediaPreviewCollapsed: Boolean(value.mediaPreviewCollapsed),
    selectedId: value.selectedId == null ? null : boundedText(value.selectedId, 240, "selected ID"),
    compareIds: [...new Set((Array.isArray(value.compareIds) ? value.compareIds : []).map((item) => boundedText(item, 240, "compare ID")))].slice(0, 2),
    syncLocked: Boolean(value.syncLocked),
    timelineViewport,
    reviewCurrentTime,
    updatedAt: validDate(value.updatedAt) ?? now
  };
}

function boundedViewport(value) {
  if (!Number.isFinite(value.start) || !Number.isFinite(value.duration) || value.start < 0 || value.duration <= 0 || value.start > 43200 || value.duration > 43200) throw new Error("Canvas timeline viewport is outside safe bounds.");
  return { start: value.start, duration: value.duration };
}

function boundedText(value, maxLength, label) {
  const text = String(value);
  if (text.length > maxLength || /[\0\r\n]/.test(text)) throw new Error(`Canvas UI ${label} must be a bounded single-line value.`);
  return text;
}

function validDate(value) { const time = Date.parse(value ?? ""); return Number.isFinite(time) ? new Date(time).toISOString() : null; }
