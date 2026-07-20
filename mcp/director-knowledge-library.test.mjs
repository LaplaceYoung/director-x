import test from "node:test";
import assert from "node:assert/strict";
import { compileDirectorKnowledgeLibrary, loadBundledDirectorKnowledge, queryDirectorKnowledge } from "./director-knowledge-library.mjs";

test("loads evidence-grounded bundled directing knowledge", async () => {
  const library = await loadBundledDirectorKnowledge();
  assert.ok(library.entryCount >= 27);
  assert.ok(library.entries.every((entry) => entry.principles.every((item) => item.evidenceLocator && item.transferRule)));
  assert.ok(library.entries.every((entry) => entry.rights.blockedReuse.length));
});

test("retrieves model-specific motion and camera knowledge for a shot", async () => {
  const library = await loadBundledDirectorKnowledge();
  const result = queryDirectorKnowledge(library, {
    text: "image to video camera motion",
    modelModes: ["image_to_video"],
    shotFunctions: ["product_reveal"],
    limit: 3
  });
  assert.equal(result.stopReason, "evidence_sufficient");
  assert.equal(result.matches[0].entryId, "runway-gen45-sequential-motion");
  assert.ok(result.matches[0].principles.some((item) => /motion/i.test(item.transferRule)));
  assert.ok(result.matches.some((item) => item.entryId === "runway-image-to-video-motion"));
});

test("retrieves deterministic Remotion boundary knowledge", async () => {
  const library = await loadBundledDirectorKnowledge();
  const result = queryDirectorKnowledge(library, {
    text: "Remotion transition overlay duration",
    modelModes: ["remotion_composition"],
    shotFunctions: ["deterministic_transition"],
    limit: 3
  });
  assert.equal(result.stopReason, "evidence_sufficient");
  assert.equal(result.matches[0].entryId, "remotion-transition-overlay-contract");
  assert.ok(result.matches[0].principles.some((item) => /duration|timeline/i.test(item.transferRule)));
});

test("retrieves platform-backed advertising structure knowledge", async () => {
  const library = await loadBundledDirectorKnowledge();
  const result = queryDirectorKnowledge(library, {
    topics: ["advertising_structure"],
    shotFunctions: ["hook", "proof", "cta"],
    limit: 3
  });
  assert.equal(result.stopReason, "evidence_sufficient");
  assert.equal(result.matches[0].entryId, "google-abcd-video-advertising");
  assert.equal(result.matches[0].kind, "official_platform_guide");
});

test("retrieves deterministic Remotion and multi-reference image rules", async () => {
  const library = await loadBundledDirectorKnowledge();
  const remotion = queryDirectorKnowledge(library, {
    text: "Remotion deterministic seed frame audit",
    modelModes: ["remotion_composition"],
    limit: 3
  });
  assert.equal(remotion.matches[0].entryId, "remotion-seeded-deterministic-rendering");
  assert.ok(remotion.matches[0].principles.some((item) => /seed|hash/i.test(item.transferRule)));

  const image = queryDirectorKnowledge(library, {
    text: "multi reference image editing identity product style",
    modelModes: ["reference_to_image"],
    limit: 3
  });
  assert.equal(image.matches[0].entryId, "gemini-image-multi-reference-contract");
  assert.ok(image.matches[0].principles.some((item) => /reference|model/i.test(item.transferRule)));
});

test("retrieves commercial story economy and intentional silence", async () => {
  const library = await loadBundledDirectorKnowledge();
  const result = queryDirectorKnowledge(library, {
    topics: ["commercial_directing", "story_economy"],
    shotFunctions: ["hook", "proof"],
    limit: 3
  });
  assert.equal(result.matches[0].entryId, "dga-commercial-story-economy");
  assert.ok(result.matches[0].principles.some((item) => /silence|quiet/i.test(`${item.claim} ${item.transferRule}`)));
});

test("retrieves audio-driven Remotion, truthful screen proof, and current provider boundaries", async () => {
  const library = await loadBundledDirectorKnowledge();
  const remotion = queryDirectorKnowledge(library, {
    topics: ["audio_visualization", "screen_recording"],
    modelModes: ["remotion_composition"],
    limit: 4
  });
  assert.deepEqual(remotion.matches.slice(0, 2).map((item) => item.entryId), [
    "remotion-audio-responsive-composition",
    "remotion-recorder-product-proof"
  ]);

  const providers = queryDirectorKnowledge(library, {
    topics: ["multi_reference", "model_lifecycle"],
    limit: 8
  });
  assert.ok(providers.matches.some((item) => item.entryId === "seedance2-multimodal-reference-contract"));
  assert.ok(providers.matches.some((item) => item.entryId === "sora-discontinuation-routing"));
});

test("retrieves resolved Remotion, token caption, 3D, and image lifecycle contracts", async () => {
  const library = await loadBundledDirectorKnowledge();
  const remotion = queryDirectorKnowledge(library, {
    text: "resolved props token captions three camera deterministic",
    modelModes: ["remotion_composition"],
    limit: 8
  });
  const ids = remotion.matches.map((item) => item.entryId);
  assert.ok(ids.includes("remotion-resolved-composition-contract"));
  assert.ok(ids.includes("remotion-token-caption-contract"));
  assert.ok(ids.includes("remotion-three-frame-determinism"));

  const lifecycle = queryDirectorKnowledge(library, {
    text: "Imagen 4 deprecated shutdown migration",
    topics: ["model_lifecycle"],
    limit: 8
  });
  assert.ok(lifecycle.matches.some((item) => item.entryId === "imagen4-deprecation-routing"));
});

test("retrieves scene coverage, real handles, lighting continuity, and first-last-frame rules", async () => {
  const library = await loadBundledDirectorKnowledge();
  const result = queryDirectorKnowledge(library, {
    text: "scene coverage camera distance lens real handles lighting continuity first last frame",
    topics: ["camera_position", "edit_handles", "lighting_continuity", "first_frame", "last_frame"],
    limit: 10
  });
  const ids = result.matches.map((item) => item.entryId);
  assert.ok(ids.includes("asc-camera-position-distance-contract"));
  assert.ok(ids.includes("adobe-real-clip-handles"));
  assert.ok(ids.includes("arri-multicamera-lighting-continuity"));
  assert.ok(ids.includes("veo-first-last-frame-contract"));
});

test("rejects link lists without evidence locators and rights boundaries", () => {
  assert.throws(() => compileDirectorKnowledgeLibrary({
    libraryId: "bad",
    entries: [{
      entryId: "link",
      kind: "filmmaking_tutorial",
      title: "A link",
      source: { publisher: "Unknown", url: "https://example.com" },
      rights: { scope: "reference_only", blockedReuse: [] },
      principles: [{ principleId: "p1", claim: "Use closeups" }]
    }]
  }), /blocked reuse|evidence locator/i);
});
