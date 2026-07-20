import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileReferenceLearningCandidate, promoteReferenceLearningCandidate, readProjectDirectorKnowledge, writePromotedProjectKnowledge } from "./reference-learning.mjs";

function run() {
  return { references: [{
    referenceId: "ref-film", sourceUrl: "https://example.com/film", rightsStatus: "reference_only",
    analysisSection: { startSeconds: 0, maxSeconds: 20 },
    fullFrameCoverage: { passed: true, extractedFrameCount: 600, identityFrameCount: 600, countParity: true },
    clipArtifactRef: "reference:ref-film:video",
    fullFrameManifestArtifactRef: "reference:ref-film:full-frame-manifest",
    frameIdentityArtifactRef: "reference_frame_identity.ref-film.jsonl",
    audioArtifactRef: "reference:ref-film:audio"
  }] };
}

function input() {
  return {
    candidateId: "learn-match-action", referenceId: "ref-film", title: "Match action through a product reveal",
    reviewerId: "DX-Reference-Analyst", topics: ["match_action", "product_reveal"],
    modelModes: ["first_last_frame_video"], shotFunctions: ["transition_bridge"],
    blockedReuse: ["source pixels", "source audio", "brand identity", "dialogue", "music"],
    antiPatterns: ["copying the source composition"],
    observations: [{
      principleId: "match-action-midpoint", startSeconds: 2, endSeconds: 4.5,
      evidenceFrameIndices: [60, 90, 135], claim: "The cut occurs while the product crosses the center line.",
      transferRule: "Place the generated boundary at the same action phase but use the target product, location, lens, and screen direction.",
      originalityRule: "Preserve only the transition function and action phase, never source composition or identity.",
      appliesTo: ["transition_language_plan", "camera_continuity_graph"]
    }]
  };
}

test("compiles only full-frame evidence-grounded reference learning", () => {
  const candidate = compileReferenceLearningCandidate(run(), input(), "2026-07-16T00:00:00.000Z");
  assert.equal(candidate.status, "awaiting_native_approval");
  assert.match(candidate.principles[0].evidenceLocator, /frames 60,90,135/);
  const incomplete = run(); incomplete.references[0].fullFrameCoverage.passed = false;
  assert.throws(() => compileReferenceLearningCandidate(incomplete, input()), /all-decoded-frame/);
});

test("requires native approval before promotion and writes project knowledge", async () => {
  const state = run();
  const candidate = compileReferenceLearningCandidate(state, input(), "2026-07-16T00:00:00.000Z");
  state.referenceLearningCandidates = { [candidate.candidateId]: candidate };
  assert.throws(() => promoteReferenceLearningCandidate(state, { candidateId: candidate.candidateId }, { kind: "knowledge", confirmedBy: "chat", answers: {} }), /native knowledge interaction/);
  promoteReferenceLearningCandidate(state, { candidateId: candidate.candidateId }, {
    requestId: "dxq-1", kind: "knowledge", confirmedBy: "request_user_input",
    answers: { promote_reference_learning: "加入项目知识库 (Recommended)" }
  }, "2026-07-16T01:00:00.000Z");
  const projectPath = await mkdtemp(join(tmpdir(), "dx-project-knowledge-"));
  try {
    const written = await writePromotedProjectKnowledge({ projectPath, candidate });
    assert.equal(written.value.entryCount, 1);
    assert.equal((await readProjectDirectorKnowledge(projectPath)).entries[0].entryId, candidate.candidateId);
    assert.match(await readFile(written.path, "utf8"), /source pixels/);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});
