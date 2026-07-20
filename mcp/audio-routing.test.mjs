import test from "node:test";
import assert from "node:assert/strict";
import { applyAudioResponsibilityToMediaInput, compileAudioResponsibilityPlan, musicRouteSetup } from "./audio-routing.mjs";

test("external TTS and local music disable video-native audio", () => {
  const run = { musicAssets: [{ assetId: "brand-theme", artifactRef: "music:brand-theme", status: "ready" }] };
  const plan = compileAudioResponsibilityPlan(run, {
    planId: "audio-1",
    video: { providerId: "google_gemini", modelId: "veo-3.1-fast-generate-preview", nativeAudio: true },
    voice: { enabled: true, configured: true, providerId: "mosi.tts", modelId: "moss-tts" },
    music: { route: "local_file", assetRef: "music:brand-theme" },
    confirmedBy: "request_user_input"
  });
  assert.equal(plan.video.generateAudio, false);
  assert.equal(plan.voice.owner, "tts");
  assert.equal(plan.music.owner, "local_asset");
  assert.equal(plan.finalMix.duckMusicUnderVoice, true);
  const input = applyAudioResponsibilityToMediaInput(run, {
    mediaType: "video", providerId: "google_gemini", modelId: "veo-3.1-fast-generate-preview",
    prompt: "cinematic city", providerOptions: {}
  });
  assert.equal(input.generateAudio, false);
  assert.equal(input.providerOptions.bgm, false);
  assert.match(input.negativePrompt, /Do not generate speech/);
  assert.match(input.negativePrompt, /Do not generate background music/);
});

test("video-native full audio is only a confirmed fallback when TTS and music are absent", () => {
  const run = {};
  const plan = compileAudioResponsibilityPlan(run, {
    planId: "audio-2",
    video: { providerId: "openai", modelId: "sora-2", nativeAudio: true },
    voice: { enabled: false },
    music: { route: "video_native_fallback" },
    nativeFallbackApproved: true,
    confirmedBy: "request_user_input"
  });
  assert.equal(plan.video.generateAudio, true);
  assert.equal(plan.voice.owner, "video_model");
  assert.equal(plan.music.owner, "video_model");
  assert.throws(() => compileAudioResponsibilityPlan({}, {
    planId: "bad",
    video: { providerId: "openai", modelId: "sora-2", nativeAudio: true },
    voice: { enabled: true, configured: true, providerId: "mosi.tts", modelId: "moss-tts" },
    music: { route: "video_native_fallback" },
    nativeFallbackApproved: true
  }), /only when no independent TTS/);
});

test("media submission cannot override the approved audio route", () => {
  const run = {};
  compileAudioResponsibilityPlan(run, {
    planId: "audio-3",
    video: { providerId: "vidu", modelId: "viduq3-pro", nativeAudio: true },
    voice: { enabled: false },
    music: { route: "none" }
  });
  assert.throws(() => applyAudioResponsibilityToMediaInput(run, {
    mediaType: "video", providerId: "vidu", modelId: "viduq3-pro", generateAudio: true
  }), /conflict/);
});

test("music setup requires native questions and local rights evidence", () => {
  const setup = musicRouteSetup();
  assert.equal(setup.selectionQuestion.id, "music_route");
  assert.equal(setup.fallbackQuestion.id, "native_audio_fallback");
  assert.ok(setup.searchContract.requiredArtifactRefs.includes("music_quality_audit_<assetId>.json"));
});
