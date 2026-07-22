import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCanvasUiState } from "./canvas-ui-state.mjs";

test("normalizes bounded canvas inspection state for durable Run storage", () => {
  const value = normalizeCanvasUiState({ version: 1, transform: { x: 10, y: -20, zoom: .8 }, view: "review", filter: "asset", query: "logo", railCollapsed: true, selectedId: "asset:logo", compareIds: ["video:a", "video:b", "video:c"], syncLocked: true, timelineViewport: { start: 5, duration: 20 }, reviewCurrentTime: 8.5, updatedAt: "2026-07-16T00:00:00.000Z" });
  assert.deepEqual(value.compareIds, ["video:a", "video:b"]);
  assert.equal(value.railCollapsed, true);
  assert.equal(value.updatedAt, "2026-07-16T00:00:00.000Z");
});

test("persists dedicated coverage and continuity views", () => {
  for (const view of ["coverage", "continuity"]) {
    assert.equal(normalizeCanvasUiState({ version: 1, transform: { x: 0, y: 0, zoom: .7 }, view, filter: "all" }).view, view);
  }
});

test("persists the media-first canvas view", () => {
  assert.equal(normalizeCanvasUiState({ version: 1, transform: { x: 0, y: 0, zoom: .7 }, view: "media", filter: "asset" }).view, "media");
});

test("rejects unsafe or malformed durable canvas inspection state", () => {
  const base = { version: 1, transform: { x: 0, y: 0, zoom: .7 }, view: "workflow", filter: "all", compareIds: [], syncLocked: true, reviewCurrentTime: 0 };
  assert.throws(() => normalizeCanvasUiState({ ...base, view: "admin" }), /unsupported view/);
  assert.throws(() => normalizeCanvasUiState({ ...base, transform: { x: 0, y: 0, zoom: 4 } }), /safe bounds/);
  assert.throws(() => normalizeCanvasUiState({ ...base, query: "line\nbreak" }), /single-line/);
});
