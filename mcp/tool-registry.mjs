import { validateStructuredResult } from "./tool-contracts.mjs";

export function createToolRegistry({ definitions, invoke }) {
  if (!Array.isArray(definitions) || typeof invoke !== "function") throw new Error("Tool registry requires definitions and an invoke function.");
  const byName = new Map();
  for (const definition of definitions) {
    const name = String(definition?.name ?? "").trim();
    if (!name) throw new Error("Every registered tool needs a non-empty name.");
    if (byName.has(name)) throw new Error(`Duplicate tool registration: ${name}`);
    if (!definition?.inputSchema || typeof definition.inputSchema !== "object") throw new Error(`Registered tool is missing inputSchema: ${name}`);
    if (!definition?.outputSchema || typeof definition.outputSchema !== "object") throw new Error(`Registered tool is missing outputSchema: ${name}`);
    byName.set(name, structuredClone(definition));
  }

  return Object.freeze({
    size: byName.size,
    has(name) {
      return byName.has(name);
    },
    list() {
      return [...byName.values()].map((definition) => structuredClone(definition));
    },
    definition(name) {
      const definition = byName.get(name);
      return definition ? structuredClone(definition) : null;
    },
    async call(name, args = {}) {
      if (!byName.has(name)) throw new Error(`Unknown tool: ${name}`);
      const result = await invoke(name, args);
      return validateStructuredResult(byName.get(name).outputSchema, result);
    }
  });
}
