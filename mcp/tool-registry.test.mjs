import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry, normalizeToolProfile } from "./tool-registry.mjs";

const definitions = [
  { name: "directorx_read", description: "Read", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } },
  { name: "directorx_write", description: "Write", inputSchema: { type: "object", properties: { value: { type: "string" } } }, outputSchema: { type: "object", additionalProperties: true, properties: {} } }
];

test("registers unique tools and isolates listed definitions from mutation", () => {
  const registry = createToolRegistry({ profile: "compatibility", definitions, invoke: async () => ({ ok: true }) });
  const listed = registry.list();
  listed[0].description = "mutated";
  assert.equal(registry.size, 2);
  assert.equal(registry.has("directorx_write"), true);
  assert.equal(registry.definition("directorx_read").description, "Read");
});

test("public profile lists and calls only completed public Facades", async () => {
  const calls = [];
  const registry = createToolRegistry({
    profile: "public",
    definitions: [
      { name: "directorx_recover_production", description: "Recover", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", additionalProperties: true, properties: {} } },
      { name: "directorx_internal_checkpoint", description: "Internal", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", additionalProperties: true, properties: {} } }
    ],
    invoke: async (name) => { calls.push(name); return {}; }
  });
  assert.equal(registry.profile, "public");
  assert.deepEqual(registry.list().map((tool) => tool.name), ["directorx_recover_production"]);
  assert.equal(registry.definition("directorx_internal_checkpoint"), null);
  await registry.call("directorx_recover_production");
  await assert.rejects(() => registry.call("directorx_internal_checkpoint"), /unavailable in public/);
  assert.deepEqual(calls, ["directorx_recover_production"]);
});

test("defaults the installed registry to the public Facade profile", () => {
  const registry = createToolRegistry({
    definitions: [
      { name: "directorx_recover_production", description: "Recover", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", additionalProperties: true, properties: {} } },
      { name: "directorx_internal_checkpoint", description: "Internal", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", additionalProperties: true, properties: {} } }
    ],
    invoke: async () => ({})
  });
  assert.equal(registry.profile, "public");
  assert.deepEqual(registry.list().map((tool) => tool.name), ["directorx_recover_production"]);
});

test("projects public results after validation without changing compatibility results", async () => {
  const publicRegistry = createToolRegistry({
    profile: "public",
    definitions: [{ name: "directorx_recover_production", description: "Recover", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", additionalProperties: true, properties: {} } }],
    invoke: async () => ({ nextTool: "directorx_internal_checkpoint" }),
    projectPublicResult: ({ result, publicToolNames }) => ({ ...result, nextTool: publicToolNames.has("directorx_recover_production") ? "continue_production" : "unexpected" })
  });
  assert.deepEqual(await publicRegistry.call("directorx_recover_production"), { nextTool: "continue_production" });

  const compatibilityRegistry = createToolRegistry({
    profile: "compatibility",
    definitions: [{ name: "directorx_recover_production", description: "Recover", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", additionalProperties: true, properties: {} } }],
    invoke: async () => ({ nextTool: "directorx_internal_checkpoint" }),
    projectPublicResult: () => ({ nextTool: "should-not-run" })
  });
  assert.deepEqual(await compatibilityRegistry.call("directorx_recover_production"), { nextTool: "directorx_internal_checkpoint" });
});

test("rejects unknown tool profiles", () => {
  assert.throws(() => normalizeToolProfile("debug"), /Unknown Director X tool profile/);
});

test("dispatches only registered tools", async () => {
  const calls = [];
  const registry = createToolRegistry({ profile: "compatibility", definitions, invoke: async (name, args) => {
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
  assert.throws(() => createToolRegistry({ definitions: [{ name: "directorx_bad", inputSchema: {} }], invoke: async () => null }), /missing outputSchema/);
});

test("validates structured results against declared output schemas", async () => {
  const registry = createToolRegistry({ profile: "compatibility", definitions, invoke: async () => ({ nope: true }) });
  await assert.rejects(() => registry.call("directorx_read"), /structuredContent\.ok is required/);
});
