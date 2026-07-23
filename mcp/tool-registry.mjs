import { validateStructuredResult } from "./tool-contracts.mjs";
import { DIRECTORX_PUBLIC_FACADE_NAMES } from "./tool-surface-policy.mjs";

export const TOOL_PROFILES = Object.freeze(["compatibility", "public"]);
export const DEFAULT_TOOL_PROFILE = "public";

export function normalizeToolProfile(profile = DEFAULT_TOOL_PROFILE) {
  const normalized = String(profile || DEFAULT_TOOL_PROFILE).trim().toLowerCase();
  if (!TOOL_PROFILES.includes(normalized)) throw new Error(`Unknown Director X tool profile: ${profile}`);
  return normalized;
}

function isPublicTool(definition) {
  return DIRECTORX_PUBLIC_FACADE_NAMES.includes(definition?.name);
}

export function createToolRegistry({ definitions, invoke, profile = DEFAULT_TOOL_PROFILE, projectPublicResult = null }) {
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

  const publicToolNames = new Set([...byName.values()].filter(isPublicTool).map((definition) => definition.name));

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
      const result = validateStructuredResult(definition.outputSchema, await invoke(name, args));
      if (activeProfile !== "public" || typeof projectPublicResult !== "function") return result;
      return validateStructuredResult(definition.outputSchema, projectPublicResult({ toolName: name, args: structuredClone(args), result, publicToolNames: new Set(publicToolNames) }));
    }
  });
}
