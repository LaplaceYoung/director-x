import { DIRECTORX_DESTRUCTIVE_TOOL_NAMES } from "./tool-safety-policy.mjs";

const CONTRACT_VERSION = "1.0";

const IDEMPOTENT_WRITES = new Set([
  "directorx_set_session_credential",
  "directorx_submit_provider_job",
  "directorx_submit_media_generation",
  "directorx_decide_production",
  "directorx_prepare_production",
  "directorx_recover_production",
  "directorx_update_provider_job",
  "directorx_upsert_canvas_object",
  "directorx_register_media_evidence_index"
]);

const DESTRUCTIVE_TOOLS = new Set(DIRECTORX_DESTRUCTIVE_TOOL_NAMES);

const OPEN_WORLD_PATTERNS = [
  /acquire_web|record_web_research|provider_api_research|ingest_reference/,
  /generate_mosi|submit_media_generation|poll_media_generation/,
  /submit_provider_job|update_provider_job|cancel_provider_job/
];

export function applyToolContracts(definitions) {
  return definitions.map((definition) => {
    const annotations = { ...(definition.annotations ?? {}) };
    if (annotations.readOnlyHint === true || IDEMPOTENT_WRITES.has(definition.name)) annotations.idempotentHint = true;
    if (DESTRUCTIVE_TOOLS.has(definition.name)) annotations.destructiveHint = true;
    if (OPEN_WORLD_PATTERNS.some((pattern) => pattern.test(definition.name))) annotations.openWorldHint = true;
    const hasDeclaredOutput = Boolean(definition.outputSchema);
    return {
      ...definition,
      outputSchema: definition.outputSchema ?? legacyLooseOutputSchema(),
      annotations,
      _meta: {
        ...(definition._meta ?? {}),
        "directorx/contractVersion": CONTRACT_VERSION,
        "directorx/legacyLooseContract": !hasDeclaredOutput
      }
    };
  });
}

export function validateStructuredResult(schema, value, path = "structuredContent") {
  const errors = [];
  validateNode(schema, value, path, errors);
  if (errors.length) throw new Error(`Tool result violates outputSchema: ${errors.join("; ")}`);
  return value;
}

function legacyLooseOutputSchema() {
  return { type: "object", additionalProperties: true, properties: {} };
}

function validateNode(schema, value, path, errors) {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const candidates = schema.oneOf ?? schema.anyOf;
    const matched = candidates.some((candidate) => {
      const candidateErrors = [];
      validateNode(candidate, value, path, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (!matched) errors.push(`${path} must match ${schema.oneOf ? "oneOf" : "anyOf"}`);
    return;
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path} must be one of: ${schema.enum.join(", ")}`);
  if (Array.isArray(schema.type)) {
    if (schema.type.includes("null") && value === null) return;
    const matching = schema.type.find((type) => type !== "null" && matchesType(type, value));
    if (!matching) { errors.push(`${path} must match one of: ${schema.type.join(", ")}`); return; }
    validateNode({ ...schema, type: matching }, value, path, errors);
    return;
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push(`${path} must be an object`); return; }
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key} is required`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) validateNode(child, value[key], `${path}.${key}`, errors);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) errors.push(`${path}.${key} is not allowed`);
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return; }
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(`${path} must contain at least ${schema.minItems} items`);
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(`${path} must contain at most ${schema.maxItems} items`);
    value.forEach((item, index) => validateNode(schema.items, item, `${path}[${index}]`, errors));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") errors.push(`${path} must be a string`);
    else if (Number.isInteger(schema.minLength) && value.length < schema.minLength) errors.push(`${path} must contain at least ${schema.minLength} characters`);
  }
  if (schema.type === "number" && typeof value !== "number") errors.push(`${path} must be a number`);
  if (schema.type === "integer" && !Number.isInteger(value)) errors.push(`${path} must be an integer`);
  if ((schema.type === "number" || schema.type === "integer") && typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }
  if (schema.type === "boolean" && typeof value !== "boolean") errors.push(`${path} must be a boolean`);
}

function matchesType(type, value) {
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "null") return value === null;
  return typeof value === type;
}
