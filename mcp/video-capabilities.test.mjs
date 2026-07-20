import test from "node:test";
import assert from "node:assert/strict";
import { VIDEO_CAPABILITY_CATALOG, planCapabilityRoute } from "./video-capabilities.mjs";

test("catalog exposes broad video-agent abilities through canonical DX roles", () => {
  assert.ok(VIDEO_CAPABILITY_CATALOG.length >= 30);
  assert.ok(new Set(VIDEO_CAPABILITY_CATALOG.map((item) => item.department)).size >= 8);
  assert.ok(VIDEO_CAPABILITY_CATALOG.every((item) => item.id && item.ownerRoleId && item.toolClass && item.outputs.length));
  assert.equal(VIDEO_CAPABILITY_CATALOG.find((item) => item.id === "asset.audit")?.ownerRoleId, "asset_manager");
});

test("plans a capability-filtered route with tool and interaction gates", () => {
  const run = { pipeline: { id: "brand-film" }, artifacts: { "semantic_timeline.json": {} } };
  const route = planCapabilityRoute(run, { routeId: "route:1", objective: "replace a product and review it", requestedCapabilities: ["video.replace", "review.compare"] });
  assert.deepEqual(route.requiredToolClasses, ["video_edit_model", "canvas"]);
  assert.deepEqual(route.interactionGates, ["preview_then_approve", "user_review"]);
  assert.equal(route.capabilities[0].agentType, "dx_editor");
  assert.equal(route.status, "inputs_required");
});

test("rejects invented capability names", () => {
  assert.throws(() => planCapabilityRoute({}, { routeId: "r", objective: "x", requestedCapabilities: ["video.magic"] }), /Unknown video capabilities/);
});
