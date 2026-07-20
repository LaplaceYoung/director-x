import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileCinematicReferenceSelection,
  compileCinematicReferenceLibrary,
  loadBundledCinematicReferences,
  queryCinematicReferences,
  writeCinematicReferenceSelection
} from "./cinematic-reference-library.mjs";

test("loads a rights-bounded cinematic reference library", async () => {
  const library = await loadBundledCinematicReferences();
  assert.ok(library.entryCount >= 13);
  assert.ok(library.entries.every((entry) => entry.rights.scope === "reference_only"));
  assert.ok(library.entries.every((entry) => entry.rights.deliveryReuseAllowed === false));
  assert.ok(library.entries.every((entry) => entry.rights.localAnalysisRequiresConsent));
  assert.ok(library.entries.every((entry) => entry.transferRules.every((rule) => rule.evidenceLocator)));
});

test("retrieves product proof and screen-story exemplars by directing need", async () => {
  const library = await loadBundledCinematicReferences();
  const proof = queryCinematicReferences(library, {
    videoTypes: ["brand_film"],
    shotFunctions: ["proof_event"],
    text: "single product proof",
    limit: 3
  });
  assert.equal(proof.stopReason, "reference_patterns_found");
  assert.equal(proof.matches[0].referenceId, "volvo-epic-split");
  assert.match(proof.matches[0].transferRules[0].instruction, /visually undeniable/i);

  const screen = queryCinematicReferences(library, {
    videoTypes: ["screen_demo"],
    remotionTechniques: ["interface_state_sequence"],
    limit: 3
  });
  assert.equal(screen.matches[0].referenceId, "google-parisian-love");
  assert.match(screen.matches[0].structure.progression, /product state/i);
});

test("retrieves cinematography workflow instead of a cosmetic style label", async () => {
  const library = await loadBundledCinematicReferences();
  const result = queryCinematicReferences(library, {
    text: "cinematic camera lighting timecode dolly crane grading",
    videoTypes: ["brand_film"],
    limit: 3
  });
  assert.equal(result.matches[0].referenceId, "apple-scary-fast-bts");
  assert.match(result.matches[0].transferRules[0].instruction, /camera, lighting, sync, monitoring, and grading/i);
  assert.equal(result.matches[0].requiresTimecodedIngestForReplication, true);
  assert.match(result.useBoundary, /native consent/i);
});

test("retrieves process proof, experience metaphor, and archive montage references", async () => {
  const library = await loadBundledCinematicReferences();
  const result = queryCinematicReferences(library, {
    text: "process proof experience metaphor archive montage",
    videoTypes: ["brand_film"],
    limit: 8
  });
  const ids = result.matches.map((item) => item.referenceId);
  assert.ok(ids.includes("nyt-truth-rigor"));
  assert.ok(ids.includes("apple-welcome-home"));
  assert.ok(ids.includes("google-year-in-search-2020"));
  assert.ok(result.matches.every((item) => item.rights.deliveryReuseAllowed === false));
});

test("retrieves Remotion personalization, technical proof, captions, and prompt-video references", async () => {
  const library = await loadBundledCinematicReferences();
  const result = queryCinematicReferences(library, {
    text: "personalized technical proof captions prompt video",
    remotionTechniques: ["data_driven_motion", "token_timed_captions", "semantic_timeline"],
    limit: 12
  });
  const ids = result.matches.map((item) => item.referenceId);
  assert.ok(ids.includes("remotion-github-unwrapped"));
  assert.ok(ids.includes("remotion-mediaparser-announcement"));
  assert.ok(ids.includes("remotion-tiktok-caption-template"));
  assert.ok(ids.includes("remotion-prompt-to-video-template"));
  assert.ok(result.matches.every((item) => item.requiresTimecodedIngestForReplication));
});

test("retrieves dense montage, matched proof, causal mechanism, and technology coverage exemplars", async () => {
  const library = await loadBundledCinematicReferences();
  const result = queryCinematicReferences(library, {
    text: "dense montage matched before after causal mechanism technology product coverage",
    shotFunctions: ["match_action", "before_after_proof", "causal_progression", "feature_proof"],
    limit: 12
  });
  const ids = result.matches.map((item) => item.referenceId);
  assert.ok(ids.includes("nike-you-cant-stop-us"));
  assert.ok(ids.includes("google-fixed-on-pixel"));
  assert.ok(ids.includes("honda-cog"));
  assert.ok(ids.includes("apple-vision-pro-introduction"));
});

test("rejects a film index that permits unapproved delivery reuse", () => {
  assert.throws(() => compileCinematicReferenceLibrary({
    libraryId: "unsafe",
    entries: [{
      referenceId: "unsafe-film",
      title: "Unsafe",
      kind: "finished_film",
      evidenceLevel: "curated_structure",
      source: { publisher: "Publisher", url: "https://example.com/video" },
      rights: {
        scope: "licensed_reuse",
        deliveryReuseAllowed: true,
        localAnalysisRequiresConsent: false,
        blockedReuse: []
      },
      structure: { hook: "Hook", progression: "Progress", payoff: "Payoff" },
      transferRules: [{ ruleId: "rule", instruction: "Copy it", evidenceLocator: "none", appliesTo: ["film"] }]
    }]
  }), /reference-only|local-analysis consent/i);
});

test("compiles selected films into explicit Director, shot, and Remotion bindings", async () => {
  const library = await loadBundledCinematicReferences();
  const selection = compileCinematicReferenceSelection(library, {
    runId: "run-film-library",
    selectionId: "selection-brand-proof",
    videoType: "brand_film",
    platform: "web",
    selectedReferenceIds: ["volvo-epic-split", "apple-scary-fast-bts", "remotion-curated-showcase"],
    requiredShotFunctions: ["hook", "proof_event", "cta"],
    remotionRequired: true
  });
  assert.equal(selection.status, "ready");
  assert.ok(selection.bindings.some((binding) => binding.targets.includes("shot_planning")));
  assert.ok(selection.remotionTechniques.includes("typed_scene_props"));
  assert.match(selection.useBoundary, /reference-only/i);

  const projectPath = await mkdtemp(join(tmpdir(), "directorx-film-library-"));
  try {
    const written = await writeCinematicReferenceSelection({ projectPath, runId: "run-film-library", selection });
    assert.match(await readFile(written.summary.path, "utf8"), /影视范例与导演迁移规则/);
    assert.equal(JSON.parse(await readFile(written.selection.path, "utf8")).selectionId, "selection-brand-proof");
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("blocks a selection that does not cover required shot functions", async () => {
  const library = await loadBundledCinematicReferences();
  const selection = compileCinematicReferenceSelection(library, {
    runId: "run-gap",
    selectionId: "selection-gap",
    videoType: "screen_demo",
    selectedReferenceIds: ["apple-scary-fast-bts"],
    requiredShotFunctions: ["state_change"],
    remotionRequired: false
  });
  assert.equal(selection.status, "blocked");
  assert.deepEqual(selection.blockers, ["missing_shot_function:state_change"]);
});
