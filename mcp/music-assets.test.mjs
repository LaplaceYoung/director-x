import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditMusicAsset, listMusicLibraries, registerMusicAudit } from "./music-assets.mjs";

test("catalog exposes rights-aware music libraries instead of generic web downloads", () => {
  const libraries = listMusicLibraries();
  assert.ok(libraries.some((entry) => entry.libraryId === "pixabay_music" && entry.commercialUse === true));
  assert.ok(libraries.some((entry) => entry.libraryId === "youtube_audio_library" && entry.platformScope === "youtube_verified"));
  assert.ok(libraries.every((entry) => entry.licenseUrl.startsWith("https://")));
});

test("audits a local music file for rights, technical quality, and edit fit", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-music-"));
  const localPath = join(projectPath, "theme.mp3");
  await writeFile(localPath, "fake-audio-for-probe");
  try {
    const report = await auditMusicAsset({
      projectPath,
      assetId: "brand-theme",
      artifactRef: "music:brand-theme",
      localPath: "theme.mp3",
      reviewerId: "DX-Asset-Manager",
      source: { libraryId: "pixabay_music", trackPageUrl: "https://pixabay.com/music/example", trackTitle: "Signal", artist: "Example Artist" },
      rights: { licenseId: "pixabay_content", commercialUse: true, synchronizationAllowed: true, attributionRequired: false, proofRef: "music_rights_receipt.json", contentIdRisk: "none" },
      creativeReview: { relevanceScore: .9, editFitScore: .86, audioQualityScore: .88, approvedForUse: true, observations: ["restrained electronic pulse"] }
    }, {
      runFn: async () => ({ stdout: JSON.stringify({ format: { duration: "62", bit_rate: "192000", format_name: "mp3" }, streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "48000", channels: 2, bit_rate: "192000" }] }) })
    });
    assert.equal(report.status, "ready");
    const run = {};
    const record = registerMusicAudit(run, report);
    assert.equal(record.rightsStatus, "licensed");
    assert.equal(run.musicAssetAudits[report.auditId].technical.sampleRate, 48000);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("accepts a user-owned local track without inventing a web track page", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "dx-local-music-"));
  const localPath = join(projectPath, "owned-theme.wav");
  await writeFile(localPath, "fake-audio-for-probe");
  try {
    const report = await auditMusicAsset({
      projectPath,
      assetId: "owned-brand-theme",
      artifactRef: "music:owned-brand-theme",
      localPath: "owned-theme.wav",
      reviewerId: "DX-Asset-Manager",
      source: { libraryId: "local_user_asset", trackTitle: "Owned Theme", artist: "User" },
      rights: { licenseId: "user_owned", commercialUse: true, synchronizationAllowed: true, attributionRequired: false, proofRef: "user_music_rights_declaration.json", contentIdRisk: "none" },
      creativeReview: { relevanceScore: .9, editFitScore: .9, audioQualityScore: .9, approvedForUse: true }
    }, {
      runFn: async () => ({ stdout: JSON.stringify({ format: { duration: "45", bit_rate: "1536000", format_name: "wav" }, streams: [{ codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "48000", channels: 2, bit_rate: "1536000" }] }) })
    });
    assert.equal(report.status, "ready");
    const run = {};
    assert.equal(registerMusicAudit(run, report).sourceUrl, null);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("blocks unsafe licenses and unapproved commercial synchronization", async () => {
  await assert.rejects(() => auditMusicAsset({
    projectPath: "/tmp",
    assetId: "unsafe",
    artifactRef: "music:unsafe",
    localPath: "missing.mp3",
    reviewerId: "DX-Asset-Manager",
    source: { libraryId: "free_music_archive", trackPageUrl: "https://freemusicarchive.org/music/example" },
    rights: { licenseId: "cc_by_nc", commercialUse: false, synchronizationAllowed: true, proofRef: "rights.json" },
    creativeReview: {}
  }), /unsafe music license/);
});
