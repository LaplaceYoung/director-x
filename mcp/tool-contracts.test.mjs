import assert from "node:assert/strict";
import test from "node:test";
import { applyToolContracts, validateStructuredResult } from "./tool-contracts.mjs";

test("adds an explicit migration contract to every legacy tool", () => {
  const definitions = applyToolContracts([
    { name: "directorx_read", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "directorx_strict", inputSchema: { type: "object" }, outputSchema: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string" } } } }
  ]);
  assert.equal(definitions.length, 2);
  assert.equal(definitions[0]._meta["directorx/legacyLooseContract"], true);
  assert.equal(definitions[1]._meta["directorx/legacyLooseContract"], false);
  assert.equal(definitions[0].annotations.idempotentHint, true);
  assert.equal(definitions[1].outputSchema.additionalProperties, false);
});

test("improves retry and impact annotations only for evidence-backed operations", () => {
  const definitions = applyToolContracts([
    { name: "directorx_cancel_provider_job", inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    { name: "directorx_upsert_canvas_object", inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }
  ]);
  assert.equal(definitions[0].annotations.destructiveHint, true);
  assert.equal(definitions[0].annotations.openWorldHint, true);
  assert.equal(definitions[1].annotations.idempotentHint, true);
});

test("validates nested required output fields and schema unions", () => {
  const schema = { type: "object", additionalProperties: false, properties: { status: { enum: ["ready"] }, items: { type: "array", minItems: 1, items: { type: "object", properties: { id: { type: "string", minLength: 1 } }, required: ["id"] } } }, required: ["status", "items"] };
  assert.doesNotThrow(() => validateStructuredResult(schema, { status: "ready", items: [{ id: "one" }] }));
  assert.throws(() => validateStructuredResult(schema, { status: "wrong", items: [{}], extra: true }), /status must be one of.*items\[0\]\.id is required.*extra is not allowed/);
});
