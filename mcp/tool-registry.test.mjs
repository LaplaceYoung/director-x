import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "./tool-registry.mjs";

const definitions = [
  { name: "directorx_read", description: "Read", inputSchema: { type: "object", properties: {} } },
  { name: "directorx_write", description: "Write", inputSchema: { type: "object", properties: { value: { type: "string" } } } }
];

test("registers unique tools and isolates listed definitions from mutation", () => {
  const registry = createToolRegistry({ definitions, invoke: async () => ({ ok: true }) });
  const listed = registry.list();
  listed[0].description = "mutated";
  assert.equal(registry.size, 2);
  assert.equal(registry.has("directorx_write"), true);
  assert.equal(registry.definition("directorx_read").description, "Read");
});

test("dispatches only registered tools", async () => {
  const calls = [];
  const registry = createToolRegistry({ definitions, invoke: async (name, args) => {
    calls.push({ name, args });
    return { name, args };
  } });
  assert.deepEqual(await registry.call("directorx_write", { value: "x" }), { name: "directorx_write", args: { value: "x" } });
  await assert.rejects(() => registry.call("directorx_unknown"), /Unknown tool/);
  assert.deepEqual(calls, [{ name: "directorx_write", args: { value: "x" } }]);
});

test("rejects duplicate or malformed registrations", () => {
  assert.throws(() => createToolRegistry({ definitions: [...definitions, definitions[0]], invoke: async () => null }), /Duplicate tool registration/);
  assert.throws(() => createToolRegistry({ definitions: [{ name: "directorx_bad" }], invoke: async () => null }), /missing inputSchema/);
});
