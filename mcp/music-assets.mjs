import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { runProcess } from "./media-execution.mjs";

export const RIGHTS_SAFE_MUSIC_LIBRARIES = Object.freeze([
  {
    libraryId: "pixabay_music",
    displayName: "Pixabay Music",
    browseUrl: "https://pixabay.com/music/",
    allowedHosts: ["pixabay.com"],
    licenseUrl: "https://pixabay.com/service/license-summary/",
    defaultCost: 0,
    platformScope: "multi_platform",
    commercialUse: true,
    attribution: "not_required",
    cautions: ["Keep the track page, download record, and license summary.", "Prefer tracks without a Content ID shield when possible."]
  },
  {
    libraryId: "mixkit_music",
    displayName: "Mixkit Stock Music",
    browseUrl: "https://mixkit.co/free-stock-music/",
    allowedHosts: ["mixkit.co"],
    licenseUrl: "https://mixkit.co/license/",
    defaultCost: 0,
    platformScope: "web_social_ads_podcast",
    commercialUse: true,
    attribution: "not_required",
    cautions: ["Check the current Stock Music Free License.", "Do not assume TV, radio, game, CD, or DVD use is permitted."]
  },
  {
    libraryId: "youtube_audio_library",
    displayName: "YouTube Audio Library",
    browseUrl: "https://youtube.com/audiolibrary",
    allowedHosts: ["youtube.com", "studio.youtube.com"],
    licenseUrl: "https://support.google.com/youtube/answer/3376882",
    defaultCost: 0,
    platformScope: "youtube_verified",
    commercialUse: true,
    attribution: "track_specific",
    cautions: ["YouTube only guarantees copyright safety on YouTube.", "Creative Commons tracks require the supplied attribution."]
  },
  {
    libraryId: "free_music_archive",
    displayName: "Free Music Archive",
    browseUrl: "https://freemusicarchive.org/",
    allowedHosts: ["freemusicarchive.org"],
    licenseUrl: "https://freemusicarchive.org/License_Guide",
    defaultCost: 0,
    platformScope: "track_specific",
    commercialUse: "track_specific",
    attribution: "track_specific",
    cautions: ["Accept only track-level licenses compatible with commercial video synchronization.", "Reject NC and ND for commercial promotional video unless separate written permission exists."]
  },
  {
    libraryId: "wikimedia_commons_audio",
    displayName: "Wikimedia Commons Audio",
    browseUrl: "https://commons.wikimedia.org/wiki/Commons:Audio",
    allowedHosts: ["commons.wikimedia.org", "upload.wikimedia.org"],
    licenseUrl: "https://commons.wikimedia.org/wiki/Commons:Licensing",
    defaultCost: 0,
    platformScope: "track_specific",
    commercialUse: true,
    attribution: "track_specific",
    cautions: ["Verify composition, performance, lyrics, and recording rights on the exact file page."]
  }
]);

const LICENSES = new Set(["pixabay_content", "mixkit_stock_music_free", "youtube_audio_library", "cc0", "cc_by", "cc_by_sa", "custom_written_permission", "user_owned", "licensed_local_copy"]);

export function listMusicLibraries() {
  return structuredClone(RIGHTS_SAFE_MUSIC_LIBRARIES);
}

export async function auditMusicAsset(input, options = {}) {
  if (input.reviewerId !== "DX-Asset-Manager") throw new Error("Music audit requires the canonical DX-Asset-Manager reviewer.");
  const library = RIGHTS_SAFE_MUSIC_LIBRARIES.find((entry) => entry.libraryId === input.source.libraryId);
  const localUserAsset = input.source.libraryId === "local_user_asset";
  if (!library && !localUserAsset) throw new Error(`Unsupported music library: ${input.source.libraryId}`);
  if (library) {
    const trackPage = new URL(input.source.trackPageUrl);
    if (trackPage.protocol !== "https:" || !library.allowedHosts.some((host) => trackPage.hostname === host || trackPage.hostname.endsWith(`.${host}`))) throw new Error("Music track page must come from the selected library's official domain.");
  }
  if (!LICENSES.has(input.rights.licenseId)) throw new Error(`Unsupported or unsafe music license: ${input.rights.licenseId}`);
  if (localUserAsset && !["user_owned", "licensed_local_copy", "custom_written_permission", "cc0", "cc_by", "cc_by_sa"].includes(input.rights.licenseId)) throw new Error("A local user asset requires ownership, license-copy, public-license, or written-permission evidence.");
  if (input.rights.commercialUse !== true || input.rights.synchronizationAllowed !== true) throw new Error("Delivery music requires explicit commercial-use and video-synchronization rights.");
  if (!input.rights.proofRef || (library && !input.source.trackPageUrl)) throw new Error("Music rights audit requires durable proof, and library music also requires its exact track page.");
  if (["cc_by", "cc_by_sa", "youtube_audio_library"].includes(input.rights.licenseId) && input.rights.attributionRequired && !input.rights.attributionText) throw new Error("Attribution-required music needs exact attribution text.");
  if (input.source.libraryId === "youtube_audio_library" && !["youtube", "youtube_verified"].includes(input.rights.platformScope)) throw new Error("YouTube Audio Library is treated as YouTube-only unless separate cross-platform rights evidence is provided.");
  const projectRoot = resolve(input.projectPath);
  const path = resolve(projectRoot, input.localPath);
  const relation = relative(projectRoot, path);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Music asset must stay inside the project workspace.");
  const details = await stat(path);
  if (!details.isFile() || details.size <= 0) throw new Error("Music audit requires a non-empty local audio file.");
  const probe = await probeAudio(path, projectRoot, options);
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!audio) throw new Error("Music audit requires a decodable audio stream.");
  const durationSeconds = Number(probe.format?.duration ?? audio.duration ?? 0);
  const sampleRate = Number(audio.sample_rate ?? 0);
  const channels = Number(audio.channels ?? 0);
  const bitRate = Number(audio.bit_rate ?? probe.format?.bit_rate ?? 0);
  const requirements = {
    minimumDurationSeconds: input.requirements?.minimumDurationSeconds ?? 10,
    minimumSampleRate: input.requirements?.minimumSampleRate ?? 44100,
    minimumChannels: input.requirements?.minimumChannels ?? 2,
    minimumBitRate: input.requirements?.minimumBitRate ?? 128000,
    minimumScore: input.requirements?.minimumScore ?? .72
  };
  const blockers = [];
  if (!Number.isFinite(durationSeconds) || durationSeconds < requirements.minimumDurationSeconds) blockers.push("music duration is too short");
  if (!Number.isFinite(sampleRate) || sampleRate < requirements.minimumSampleRate) blockers.push("music sample rate is below the delivery threshold");
  if (!Number.isFinite(channels) || channels < requirements.minimumChannels) blockers.push("music channel count is below the delivery threshold");
  if (Number.isFinite(bitRate) && bitRate > 0 && bitRate < requirements.minimumBitRate) blockers.push("music bitrate is below the delivery threshold");
  for (const field of ["relevanceScore", "editFitScore", "audioQualityScore"]) {
    const score = input.creativeReview?.[field];
    if (!Number.isFinite(score) || score < requirements.minimumScore || score > 1) blockers.push(`${field} did not meet the creative threshold`);
  }
  if (input.creativeReview?.approvedForUse !== true) blockers.push("DX-Asset-Manager did not approve this track");
  if (input.rights.contentIdRisk === "known" && input.rights.contentIdProofAvailable !== true) blockers.push("known Content ID risk has no retained license proof");
  return {
    schemaVersion: "1.0",
    auditId: `music-audit:${safeId(input.assetId)}`,
    assetId: input.assetId,
    artifactRef: input.artifactRef,
    localPath: relation,
    status: blockers.length ? "blocked" : "ready",
    blockers,
    source: structuredClone(input.source),
    rights: structuredClone(input.rights),
    creativeReview: structuredClone(input.creativeReview),
    technical: {
      sizeBytes: details.size,
      sha256: await sha256File(path),
      formatName: probe.format?.format_name ?? null,
      codec: audio.codec_name ?? null,
      durationSeconds,
      sampleRate,
      channels,
      bitRate: bitRate || null
    },
    requirements,
    reviewerId: input.reviewerId,
    auditedAt: new Date().toISOString()
  };
}

export function registerMusicAudit(run, report) {
  run.musicAssets ??= [];
  const record = {
    assetId: report.assetId,
    artifactRef: report.artifactRef,
    localPath: report.localPath,
    sourceUrl: report.source.trackPageUrl ?? null,
    libraryId: report.source.libraryId,
    trackTitle: report.source.trackTitle,
    artist: report.source.artist,
    rightsStatus: report.status === "ready" ? (report.rights.licenseId === "cc0" ? "public_domain" : "licensed") : "blocked",
    auditId: report.auditId,
    status: report.status
  };
  const index = run.musicAssets.findIndex((item) => item.assetId === record.assetId);
  if (index >= 0) run.musicAssets[index] = record;
  else run.musicAssets.push(record);
  run.musicAssetAudits ??= {};
  run.musicAssetAudits[report.auditId] = report;
  return record;
}

export async function writeMusicAudit({ projectPath, runId, report }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const values = {
    "music_asset_plan.json": {
      schemaVersion: "1.0",
      selectedAssetId: report.assetId,
      artifactRef: report.artifactRef,
      source: report.source,
      intendedRole: "background_music",
      technical: report.technical,
      creativeReview: report.creativeReview,
      status: report.status
    },
    "music_rights_receipt.json": {
      schemaVersion: "1.0",
      assetId: report.assetId,
      trackPageUrl: report.source.trackPageUrl,
      trackTitle: report.source.trackTitle,
      artist: report.source.artist,
      rights: report.rights,
      proofRef: report.rights.proofRef,
      capturedAt: report.auditedAt
    },
    [`music_quality_audit_${safeId(report.assetId)}.json`]: report
  };
  const written = {};
  for (const [artifactRef, value] of Object.entries(values)) {
    const path = resolve(directory, artifactRef);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    written[artifactRef] = { artifactRef, path };
  }
  return written;
}

async function probeAudio(path, cwd, options) {
  const args = ["-v", "error", "-show_entries", "format=duration,size,format_name,bit_rate:stream=index,codec_name,codec_type,duration,sample_rate,channels,bit_rate", "-of", "json", path];
  const result = await (options.runFn ?? runProcess)(options.command ?? "ffprobe", options.args ?? args, {
    cwd,
    timeoutMs: options.timeoutMs ?? 30000,
    maxOutputBytes: 500000,
    failureLabel: "Music asset probe"
  });
  try { return JSON.parse(result.stdout); }
  catch { throw new Error("Music asset probe returned invalid JSON."); }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function safeId(value) {
  const result = String(value ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120);
  if (!result) throw new Error("Music asset ID is required.");
  return result;
}
