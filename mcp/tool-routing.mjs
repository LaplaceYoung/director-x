import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const SOURCES = new Set(["codex_host", "directorx_plugin", "mcp_app", "local_runtime", "provider"]);
const STATUSES = new Set(["available", "degraded", "unavailable"]);
const TASK_SUPPORT = new Set(["required", "optional", "forbidden", "unknown"]);
const STRATEGIES = Object.freeze({
  quality: { quality: 0.7, cost: 0.1, latency: 0.1, reliability: 0.1 },
  balanced: { quality: 0.4, cost: 0.2, latency: 0.2, reliability: 0.2 },
  economy: { quality: 0.3, cost: 0.45, latency: 0.1, reliability: 0.15 }
});

const GUARANTEED_RUNTIME_TOOLS = Object.freeze([
  {
    toolId: "codex.host.reasoning",
    toolClass: "reasoning",
    source: "codex_host",
    status: "available",
    permissions: [],
    taskSupport: "required",
    capabilityIds: [],
    qualityScore: 0.9,
    reliabilityScore: 0.95,
    estimatedCost: 0,
    latencyMsP50: 1000,
    discoveredBy: "directorx_runtime_baseline"
  },
  {
    toolId: "directorx.runtime.state",
    toolClass: "state",
    source: "directorx_plugin",
    status: "available",
    permissions: ["run_state_write"],
    taskSupport: "required",
    capabilityIds: [],
    qualityScore: 0.98,
    reliabilityScore: 0.99,
    estimatedCost: 0,
    latencyMsP50: 50,
    discoveredBy: "directorx_runtime_baseline"
  }
]);

export function registerToolInventory(run, input, now = new Date().toISOString()) {
  if (!input?.inventoryId || !Array.isArray(input.tools) || !input.tools.length) throw new Error("Tool inventory requires an ID and at least one tool.");
  const ids = new Set();
  const tools = [...input.tools, ...missingGuaranteedTools(input.tools)].map((tool) => {
    if (!tool.toolId || ids.has(tool.toolId)) throw new Error("Tool inventory IDs must be present and unique.");
    ids.add(tool.toolId);
    if (!tool.toolClass || !SOURCES.has(tool.source) || !STATUSES.has(tool.status) || !TASK_SUPPORT.has(tool.taskSupport ?? "unknown")) throw new Error(`${tool.toolId} has an invalid class, source, status, or task support value.`);
    for (const [field, value] of Object.entries({ qualityScore: tool.qualityScore, reliabilityScore: tool.reliabilityScore })) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${tool.toolId}.${field} must be between 0 and 1.`);
    for (const [field, value] of Object.entries({ estimatedCost: tool.estimatedCost, latencyMsP50: tool.latencyMsP50 })) if (!Number.isFinite(value) || value < 0) throw new Error(`${tool.toolId}.${field} must be non-negative.`);
    return { ...structuredClone(tool), taskSupport: tool.taskSupport ?? "unknown", permissions: [...new Set(tool.permissions ?? [])], capabilityIds: [...new Set(tool.capabilityIds ?? [])] };
  });
  run.toolInventory = { schemaVersion: "1.0", inventoryId: input.inventoryId, hostBuild: input.hostBuild ?? null, currency: input.currency, tools, recordedAt: now };
  return run.toolInventory;
}

export function planToolRoute(run, input, now = new Date().toISOString()) {
  if (!run.capabilityRoute) throw new Error("Plan capability_route.json before tool routing.");
  if (!run.toolInventory) throw new Error("Register tool_inventory.json before tool routing.");
  if (!input?.planId || !Number.isFinite(input.maxEstimatedCost) || input.maxEstimatedCost < 0 || !Number.isFinite(input.maxLatencyMs) || input.maxLatencyMs < 1 || !Number.isFinite(input.minimumQuality) || input.minimumQuality < 0 || input.minimumQuality > 1) throw new Error("Tool route requires plan ID, cost/latency caps, and minimum quality.");
  const candidates = Object.entries(STRATEGIES).map(([strategy, weights]) => buildCandidate(run, input, strategy, weights));
  const feasible = candidates.filter((candidate) => candidate.status === "feasible");
  const recommended = feasible.sort((a, b) => b.score - a.score)[0] ?? null;
  const plan = {
    schemaVersion: "1.0", planId: input.planId, routeId: run.capabilityRoute.routeId, inventoryId: run.toolInventory.inventoryId,
    constraints: { maxEstimatedCost: input.maxEstimatedCost, maxLatencyMs: input.maxLatencyMs, minimumQuality: input.minimumQuality, allowedSources: input.allowedSources ?? [...SOURCES], requiredPermissions: input.requiredPermissions ?? [] },
    candidates, recommendedStrategy: recommended?.strategy ?? null, status: recommended ? "ready" : "blocked", blockers: recommended ? [] : [...new Set(candidates.flatMap((candidate) => candidate.blockers))], createdAt: now
  };
  run.capabilityExecutionPlan = plan;
  return plan;
}

function buildCandidate(run, input, strategy, weights) {
  const selections = [], blockers = [];
  for (const capability of run.capabilityRoute.capabilities) {
    const tools = run.toolInventory.tools.filter((tool) => tool.status !== "unavailable" && tool.toolClass === capability.toolClass && (input.allowedSources ?? [...SOURCES]).includes(tool.source) && (!tool.capabilityIds.length || tool.capabilityIds.includes(capability.id)) && tool.qualityScore >= input.minimumQuality && tool.latencyMsP50 <= input.maxLatencyMs);
    if (!tools.length) { blockers.push(`${capability.id}:no_compatible_tool`); continue; }
    const ranked = tools.map((tool) => ({ tool, score: toolScore(tool, input, weights) })).sort((a, b) => b.score - a.score);
    selections.push({ capabilityId: capability.id, toolId: ranked[0].tool.toolId, toolClass: capability.toolClass, source: ranked[0].tool.source, score: round(ranked[0].score), estimatedCost: ranked[0].tool.estimatedCost, latencyMsP50: ranked[0].tool.latencyMsP50, qualityScore: ranked[0].tool.qualityScore, reliabilityScore: ranked[0].tool.reliabilityScore, taskSupport: ranked[0].tool.taskSupport, interaction: capability.interaction });
  }
  const estimatedCost = selections.reduce((sum, item) => sum + item.estimatedCost, 0);
  if (estimatedCost > input.maxEstimatedCost) blockers.push(`estimated_cost:${round(estimatedCost)}>${input.maxEstimatedCost}`);
  const criticalPathLatencyMs = selections.reduce((sum, item) => sum + item.latencyMsP50, 0);
  if (criticalPathLatencyMs > input.maxLatencyMs) blockers.push(`critical_path_latency:${criticalPathLatencyMs}>${input.maxLatencyMs}`);
  const routePermissions = new Set(selections.flatMap((selection) => run.toolInventory.tools.find((tool) => tool.toolId === selection.toolId)?.permissions ?? []));
  for (const permission of input.requiredPermissions ?? []) if (!routePermissions.has(permission)) blockers.push(`route_permission_missing:${permission}`);
  const confirmationCount = new Set(selections.map((item) => item.interaction).filter((value) => value !== "automatic")).size;
  const status = blockers.length ? "blocked" : "feasible";
  return { strategy, status, selections, blockers, estimatedCost: round(estimatedCost), criticalPathLatencyMs, confirmationCount, score: status === "feasible" && selections.length ? round(selections.reduce((sum, item) => sum + item.score, 0) / selections.length - confirmationCount * 0.02) : 0 };
}

function missingGuaranteedTools(tools) {
  const classes = new Set(tools.filter((tool) => tool.status !== "unavailable").map((tool) => tool.toolClass));
  return GUARANTEED_RUNTIME_TOOLS.filter((tool) => !classes.has(tool.toolClass));
}

function toolScore(tool, input, weights) {
  const costFitness = input.maxEstimatedCost === 0 ? (tool.estimatedCost === 0 ? 1 : 0) : Math.max(0, 1 - tool.estimatedCost / input.maxEstimatedCost);
  const latencyFitness = Math.max(0, 1 - tool.latencyMsP50 / input.maxLatencyMs);
  return tool.qualityScore * weights.quality + costFitness * weights.cost + latencyFitness * weights.latency + tool.reliabilityScore * weights.reliability;
}

export async function writeToolRoutingArtifacts({ projectPath, runId, toolInventory, capabilityExecutionPlan }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(directory, { recursive: true });
  const values = { "tool_inventory.json": toolInventory, "capability_execution_plan.json": capabilityExecutionPlan }, written = {};
  for (const [artifactRef, value] of Object.entries(values)) if (value) { const path = join(directory, artifactRef); await writeFile(path, `${JSON.stringify({ runId, ...value }, null, 2)}\n`, { mode: 0o600 }); written[artifactRef] = { artifactRef, path }; }
  return written;
}

const round = (value) => Math.round(value * 10000) / 10000;
