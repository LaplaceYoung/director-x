import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateLayeredCollagePlan, writeLayeredCollagePlan, writeLayeredCollageReview } from "./layered-collage.mjs";

const plan = {
  workflowId: "collage-01", title: "历史纸片动画", aspectRatio: "16:9", fps: 30,
  generationRoute: { provider: "codex_imagegen", backgroundPolicy: "no_people", characterPolicy: "green_screen_sheet" }, extractionRoute: { mode: "ffmpeg_chromakey", keyColor: "0x00FF00" }, ttsRoute: { provider: "mosi", model: "moss-tts" }, voiceTimingPolicy: "voiceover defines scene duration",
  stagingPolicy: { staticLayoutBeforeMotion: true, narrativeScale: "primary > secondary > tertiary", feetShareGroundPlane: true }, backgroundMotion: { scaleDelta: 0.01 },
  roleMotion: { primary: { distance: 78, rise: 55, startScale: 0.86 }, secondary: { distance: 58, rise: 38, startScale: 0.9 }, tertiary: { distance: 38, rise: 22, startScale: 0.95 } },
  scenes: [{ sceneId: "scene-01", durationSeconds: 10, narrativePurpose: "establish hierarchy", layers: [
    { layerId: "bg", layerType: "background", assetPath: "assets/bg.png", role: "decorative", zIndex: 0 },
    { layerId: "rear", layerType: "rear", assetPath: "assets/rear.png", role: "tertiary", zIndex: 1 },
    { layerId: "hero", layerType: "primary", assetPath: "assets/hero.png", role: "primary", zIndex: 5 },
    { layerId: "front", layerType: "foreground", assetPath: "assets/front.png", role: "secondary", zIndex: 8 }
  ] }],
  audioLayers: [{ type: "voiceover" }, { type: "music" }, { type: "chapter_sfx" }, { type: "entrance_sfx" }],
  composition: { entryPoint: "src/index.tsx", compositionId: "CollageFilm", propsPath: "src/script.json", qaFrameSeconds: [2, 5, 9], renderOutput: "out/final.mp4" }
};

test("writes configurable layered collage production artifacts", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-collage-"));
  try {
    const results = await writeLayeredCollagePlan({ projectPath, runId: "dx-collage", plan });
    assert.equal(Object.keys(results).length, 5);
    assert.match(await readFile(results["layer_manifest.json"].path, "utf8"), /foreground/);
    assert.match(await readFile(results["audio_layer_plan.json"].path, "utf8"), /entrance_sfx/);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});

test("rejects flat scenes and incomplete audio/config routes", () => {
  const flat = structuredClone(plan); flat.scenes[0].layers = flat.scenes[0].layers.filter((layer) => layer.layerType !== "foreground");
  assert.throws(() => validateLayeredCollagePlan(flat), /missing required layer types: foreground/);
  const noAudio = structuredClone(plan); noAudio.audioLayers = [{ type: "voiceover" }];
  assert.throws(() => validateLayeredCollagePlan(noAudio), /Audio plan must include/);
});

test("persists evidence-backed layered production gates", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-collage-review-"));
  try {
    const written = await writeLayeredCollageReview({ projectPath, runId: "dx-collage", phase: "static_layout", status: "passed", checks: [{ id: "hierarchy", status: "pass", observation: "Primary subject is dominant." }], evidenceRefs: ["layout-frame-001.png"] });
    assert.match(await readFile(written.path, "utf8"), /static_layout/);
    await assert.rejects(() => writeLayeredCollageReview({ projectPath, runId: "dx-collage", phase: "motion_audio", status: "passed", checks: [{ id: "sync", status: "fail", observation: "Entrance SFX is late." }], evidenceRefs: ["preview.mp4"] }), /cannot contain failed checks/);
  } finally { await rm(projectPath, { recursive: true, force: true }); }
});
