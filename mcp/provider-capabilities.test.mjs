import test from "node:test";
import assert from "node:assert/strict";
import { assertProviderCapability, recordProviderCapabilityProbe } from "./provider-capabilities.mjs";

test("requires a fresh runtime capability probe before provider routing", () => {
  const run = {};
  assert.throws(() => assertProviderCapability(run, { providerId: "p", modelId: "m", requests: [{ mode: "image_to_video" }] }), /Probe provider capability/);
  recordProviderCapabilityProbe(run, { providerId: "p", modelId: "m", status: "available", capabilities: ["image_to_video"], evidence: "GET /models + dry-run", credentialReady: true });
  assert.equal(assertProviderCapability(run, { providerId: "p", modelId: "m", requests: [{ mode: "image_to_video" }] }).status, "available");
  assert.throws(() => assertProviderCapability(run, { providerId: "p", modelId: "m", requests: [{ mode: "keyframes_to_video" }] }), /lacks required/);
});
