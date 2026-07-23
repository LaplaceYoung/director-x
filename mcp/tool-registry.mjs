import { validateStructuredResult } from "./tool-contracts.mjs";
import { DIRECTORX_PUBLIC_FACADE_NAMES } from "./tool-surface-policy.mjs";

export const TOOL_PROFILES = Object.freeze(["compatibility", "public"]);

export function normalizeToolProfile(profile = "compatibility") {
  const normalized = String(profile || "compatibility").trim().toLowerCase();
  if (!TOOL_PROFILES.includes(normalized)) throw new Error(`Unknown Director X tool profile: ${profile}`);
  return normalized;
}

function isPublicTool(definition) {
  return DIRECTORX_PUBLIC_FACADE_NAMES.includes(definition?.name);
}

export function createToolRegistry({ definitions, invoke, profile = "compatibility" }) {
  if (!Array.isArray(definitions) || typeof invoke !== "function") throw new Error("Tool registry requires definitions and invoke function.");
  const activeProfile = normalizeToolProfile(profile);
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
    profile: activeProfile,
    has(name) {
      return byName.has(name);
    },
    list() {
      return [...byName.values()]
        .filter((definition) => activeProfile === "compatibility" || isPublicTool(definition))
        .map((definition) => structuredClone(definition));
    },
    definition(name) {
      const definition = byName.get(name);
      return definition && (activeProfile === "compatibility" || isPublicTool(definition)) ? structuredClone(definition) : null;
    },
    async call(name, args = {}) {
      const definition = byName.get(name);
      if (!definition) throw new Error(`Unknown tool: ${name}`);
      if (activeProfile === "public" && !isPublicTool(definition)) throw new Error(`Tool unavailable in public Director X profile: ${name}`);
      const result = await invoke(name, args);
      return validateStructuredResult(definition.outputSchema, result);
    }
  });
}
