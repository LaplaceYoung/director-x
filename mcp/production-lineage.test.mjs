import test from "node:test";
import assert from "node:assert/strict";
import { bindExecutionLineage, reviewKnowledgePatch, revokeKnowledgePatch } from "./production-lineage.mjs";

const sha = "a".repeat(64), director = `sha256:${"b".repeat(64)}`, prompt = `sha256:${"c".repeat(64)}`;
const state = () => ({ directorDocument: { fingerprint: director }, toolInventory: { tools: [{ toolId: "video-a" }] }, capabilityRoute: { capabilities: [{ id: "video.text_to_video", owner: "DX-Provider-Operator" }] }, artifacts: { "shotlist.json": { sha256: sha }, "clip.mp4": { sha256: sha } }, modelKnowledgePatch: { reportId: "f1", proposals: [{ patchId: "p1", toolId: "video-a", status: "proposed", updates: {} }] } });

test("binds execution to immutable model, prompt, director, agent and media lineage", () => {
  const run = state();
  const binding = bindExecutionLineage(run, { bindingId: "l1", capabilityId: "video.text_to_video", toolId: "video-a", providerId: "provider-a", modelId: "model-a", modelVersion: "2026-07-01", promptContractId: "prompt:shot-1", promptContractHash: prompt, directorContractFingerprint: director, dxAgent: "DX-Provider-Operator", inputArtifacts: [{ artifactRef: "shotlist.json", sha256: sha }], outputArtifacts: [{ artifactRef: "clip.mp4", sha256: sha }] });
  assert.match(binding.lineageHash, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => bindExecutionLineage(run, { ...binding.activity, bindingId: "l2", directorContractFingerprint: `sha256:${"d".repeat(64)}`, inputArtifacts: binding.usedEntities, outputArtifacts: binding.generatedEntities }), /Director fingerprint/);
});

test("accepts scoped expiring knowledge without mutating the current route and supports revocation", () => {
  const run = state(), now = new Date("2026-07-15T00:00:00.000Z");
  const decision = reviewKnowledgePatch(run, { patchId: "p1", decision: "accept", scope: "project", authority: "project_user", confirmedBy: "request_user_input", note: "Use for later runs", expiresAt: "2026-08-15T00:00:00.000Z" }, now);
  assert.equal(decision.currentApprovedRouteImmutable, true);
  assert.equal(run.acceptedModelKnowledge.entries.length, 1);
  revokeKnowledgePatch(run, { patchId: "p1", confirmedBy: "request_user_input", note: "Provider changed" }, new Date("2026-07-16T00:00:00.000Z"));
  assert.equal(run.acceptedModelKnowledge.entries.length, 0);
  assert.throws(() => reviewKnowledgePatch(state(), { patchId: "p1", decision: "accept", scope: "workspace", authority: "project_user", confirmedBy: "request_user_input", note: "x", expiresAt: "2026-08-15T00:00:00.000Z" }, now), /workspace_admin/);
});
