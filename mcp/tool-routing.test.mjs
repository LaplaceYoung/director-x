import test from "node:test";
import assert from "node:assert/strict";
import { planToolRoute, registerToolInventory } from "./tool-routing.mjs";

const capabilityRoute = { routeId: "route:1", capabilities: [
  { id: "image.generate", toolClass: "image_generation", interaction: "provider_model_budget_confirmation" },
  { id: "delivery.render", toolClass: "local_media", interaction: "automatic" }
] };

test("matches runtime tools and produces explainable route alternatives", () => {
  const run = { capabilityRoute };
  registerToolInventory(run, { inventoryId: "tools:1", currency: "CNY", tools: [
    { toolId: "codex-imagegen", toolClass: "image_generation", source: "codex_host", status: "available", permissions: ["execute"], taskSupport: "forbidden", capabilityIds: ["image.generate"], qualityScore: 0.9, reliabilityScore: 0.95, estimatedCost: 1, latencyMsP50: 8000 },
    { toolId: "cheap-image", toolClass: "image_generation", source: "provider", status: "available", permissions: ["execute"], taskSupport: "optional", capabilityIds: ["image.generate"], qualityScore: 0.7, reliabilityScore: 0.8, estimatedCost: 0.1, latencyMsP50: 3000 },
    { toolId: "ffmpeg", toolClass: "local_media", source: "local_runtime", status: "available", permissions: ["execute"], taskSupport: "forbidden", capabilityIds: [], qualityScore: 0.98, reliabilityScore: 0.99, estimatedCost: 0, latencyMsP50: 1000 }
  ] });
  const plan = planToolRoute(run, { planId: "plan:1", maxEstimatedCost: 5, maxLatencyMs: 10000, minimumQuality: 0.65, requiredPermissions: ["execute"] });
  assert.equal(plan.status, "ready");
  assert.equal(plan.candidates.length, 3);
  assert.equal(plan.candidates.find((item) => item.strategy === "quality").selections[0].toolId, "codex-imagegen");
  assert.equal(plan.candidates.find((item) => item.strategy === "economy").selections[0].toolId, "cheap-image");
  assert.equal(plan.candidates[0].confirmationCount, 1);
});

test("fails closed when quality or permissions leave no compatible tool", () => {
  const run = { capabilityRoute };
  registerToolInventory(run, { inventoryId: "tools:2", currency: "CNY", tools: [{ toolId: "ffmpeg", toolClass: "local_media", source: "local_runtime", status: "available", permissions: ["execute"], qualityScore: 0.99, reliabilityScore: 0.99, estimatedCost: 0, latencyMsP50: 100 }] });
  const plan = planToolRoute(run, { planId: "plan:2", maxEstimatedCost: 5, maxLatencyMs: 10000, minimumQuality: 0.8, requiredPermissions: ["execute"] });
  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockers.includes("image.generate:no_compatible_tool"));
});

test("treats required permissions as route-wide capabilities and adds guaranteed Codex runtime tools", () => {
  const run = { capabilityRoute: { routeId: "route:prior-run", capabilities: [
    { id: "brief.resolve", toolClass: "reasoning", interaction: "automatic" },
    { id: "reference.retrieve", toolClass: "web_search", interaction: "automatic" },
    { id: "image.generate", toolClass: "image_generation", interaction: "provider_model_budget_confirmation" },
    { id: "delivery.render", toolClass: "local_media", interaction: "automatic" }
  ] } };
  const inventory = registerToolInventory(run, { inventoryId: "tools:prior-run", currency: "CNY", tools: [
    { toolId: "web.search", toolClass: "web_search", source: "codex_host", status: "available", permissions: ["network_read"], capabilityIds: ["reference.retrieve"], qualityScore: 0.9, reliabilityScore: 0.9, estimatedCost: 0, latencyMsP50: 1000 },
    { toolId: "codex.imagegen", toolClass: "image_generation", source: "codex_host", status: "available", permissions: ["local_workspace_write"], capabilityIds: ["image.generate"], qualityScore: 0.8, reliabilityScore: 0.85, estimatedCost: 1, latencyMsP50: 5000 },
    { toolId: "ffmpeg", toolClass: "local_media", source: "local_runtime", status: "available", permissions: ["local_workspace_write", "process_exec"], capabilityIds: ["delivery.render"], qualityScore: 0.9, reliabilityScore: 0.95, estimatedCost: 0, latencyMsP50: 1000 }
  ] });

  assert.ok(inventory.tools.some((tool) => tool.toolId === "codex.host.reasoning"));
  assert.ok(inventory.tools.some((tool) => tool.toolId === "directorx.runtime.state"));
  const plan = planToolRoute(run, { planId: "plan:prior-run", maxEstimatedCost: 10, maxLatencyMs: 30000, minimumQuality: 0.7, requiredPermissions: ["network_read", "local_workspace_write"] });
  assert.equal(plan.status, "ready");
  assert.equal(plan.blockers.length, 0);
  assert.ok(plan.candidates.every((candidate) => candidate.status === "feasible"));
});
