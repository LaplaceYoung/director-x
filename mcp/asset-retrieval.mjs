import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { runProcess } from "./media-execution.mjs";
import { requireResolvedInteraction } from "./interaction-gates.mjs";

const ASSET_TYPES = new Set(["company_logo", "product_interface", "product_image", "landmark", "office", "team", "stock_image", "stock_video", "reference_video", "audio_reference", "background_music", "sound_effect"]);
const SOURCE_SCOPES = new Set(["official", "authoritative", "public_domain", "licensed_stock", "platform", "community"]);
const USE_MODES = new Set(["delivery", "reference_analysis"]);
const DELIVERY_RIGHTS = new Set(["project_generated", "user_owned", "licensed", "public_domain", "attribution"]);
const ANALYSIS_RIGHTS = new Set([...DELIVERY_RIGHTS, "reference_only", "unknown"]);

export function registerAssetSearchPlan(run, plan) {
  if (!plan?.planId || !String(plan.objective ?? "").trim() || !Array.isArray(plan.requiredAssetTypes) || !plan.requiredAssetTypes.length || !Array.isArray(plan.sourcePriority) || !plan.sourcePriority.length || !Array.isArray(plan.queries) || !plan.queries.length) throw new Error("Asset search plan requires an ID, objective, asset types, source priority, and queries.");
  for (const type of plan.requiredAssetTypes) if (!ASSET_TYPES.has(type)) throw new Error(`Unsupported search asset type: ${type}`);
  for (const scope of plan.sourcePriority) if (!SOURCE_SCOPES.has(scope)) throw new Error(`Unsupported search source scope: ${scope}`);
  if (plan.sourcePriority[0] !== "official" || !plan.sourcePriority.includes("public_domain") || !plan.sourcePriority.includes("licensed_stock")) throw new Error("Asset search must prioritize official sources and include public-domain plus licensed-stock fallbacks.");
  const queryIds = new Set();
  for (const query of plan.queries) {
    if (!query?.queryId || queryIds.has(query.queryId) || !String(query.query ?? "").trim() || !ASSET_TYPES.has(query.assetType) || !Array.isArray(query.sourceScopes) || !query.sourceScopes.length || query.sourceScopes.some((scope) => !SOURCE_SCOPES.has(scope)) || !String(query.purpose ?? "").trim()) throw new Error("Every asset query needs a unique ID, query, supported type/scopes, and purpose.");
    queryIds.add(query.queryId);
  }
  const criteria = plan.selectionCriteria;
  for (const field of ["minimumRelevance", "minimumVisualQuality"]) if (!Number.isFinite(criteria?.[field]) || criteria[field] < 0 || criteria[field] > 1) throw new Error(`selectionCriteria.${field} must be between 0 and 1.`);
  if (!Array.isArray(criteria.rightsPreference) || !criteria.rightsPreference.length || !Number.isInteger(criteria.minimumWidth) || criteria.minimumWidth < 1 || !Number.isInteger(criteria.minimumHeight) || criteria.minimumHeight < 1) throw new Error("Asset selection criteria require rights preferences and minimum dimensions.");
  run.assetSearchPlan = { schemaVersion: "1.0", ...structuredClone(plan), status: "registered", registeredAt: new Date().toISOString() };
  return run.assetSearchPlan;
}

export async function writeAssetSearchPlan({ projectPath, runId, plan }) {
  return await writeJson(projectPath, runId, "asset_search_plan.json", plan);
}

export async function auditAssetQuality(run, input, options = {}) {
  if (!USE_MODES.has(input.useMode) || input.reviewerId !== "DX-Asset-Manager") throw new Error("Asset quality audit requires a use mode and the canonical DX-Asset-Manager reviewer.");
  const resolved = resolveAsset(run, input.assetRef, input.projectPath);
  const details = await stat(resolved.path);
  if (!details.isFile() || details.size <= 0) throw new Error("Asset quality audit requires a non-empty local file.");
  const probe = await probeMedia(resolved.path, input.projectPath, options);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  if (!video) throw new Error("Asset quality audit requires a decodable image or video stream.");
  const durationSeconds = Number(probe.format?.duration ?? video.duration ?? 0);
  const requirements = normalizedRequirements(input.requirements);
  const aspectRatio = Number(video.width) / Number(video.height);
  const technicalFailures = [];
  if (Number(video.width) < requirements.minimumWidth || Number(video.height) < requirements.minimumHeight) technicalFailures.push(`resolution ${video.width}x${video.height} is below ${requirements.minimumWidth}x${requirements.minimumHeight}`);
  if (requirements.targetAspectRatio && Math.abs(aspectRatio - requirements.targetAspectRatio) > requirements.aspectTolerance) technicalFailures.push(`aspect ratio ${aspectRatio.toFixed(3)} is outside tolerance`);
  if (requirements.minimumDurationSeconds != null && durationSeconds < requirements.minimumDurationSeconds) technicalFailures.push(`duration ${durationSeconds.toFixed(2)}s is too short`);
  if (requirements.maximumDurationSeconds != null && durationSeconds > requirements.maximumDurationSeconds) technicalFailures.push(`duration ${durationSeconds.toFixed(2)}s is too long`);
  if (requirements.requireAudio && !audio) technicalFailures.push("required audio stream is missing");
  const review = normalizeDirectorReview(input.directorReview);
  const rightsAllowed = (input.useMode === "delivery" ? DELIVERY_RIGHTS : ANALYSIS_RIGHTS).has(resolved.rightsStatus) && resolved.rightsStatus !== "blocked";
  const rightsFailure = rightsAllowed ? null : `${resolved.rightsStatus} rights do not allow ${input.useMode}`;
  const qualityPassed = review.approvedForUse && review.relevanceScore >= requirements.minimumScore && review.visualQualityScore >= requirements.minimumScore && review.compositionScore >= requirements.minimumScore && !["high", "blocked"].includes(review.artifactRisk);
  const blockers = [...technicalFailures, ...(rightsFailure ? [rightsFailure] : []), ...(qualityPassed ? [] : ["DX-Asset-Manager review did not meet the quality threshold"] )];
  return {
    schemaVersion: "1.0",
    auditId: `asset-quality:${safeId(input.assetRef)}`,
    assetRef: input.assetRef,
    artifactRef: resolved.artifactRef,
    sourceUrl: resolved.sourceUrl,
    localPath: relative(resolve(input.projectPath), resolved.path),
    mediaKind: resolved.mediaKind,
    useMode: input.useMode,
    reviewerId: input.reviewerId,
    rightsStatus: resolved.rightsStatus,
    status: blockers.length ? "blocked" : "ready",
    blockers,
    technical: { sizeBytes: details.size, sha256: await sha256File(resolved.path), formatName: probe.format?.format_name ?? null, codec: video.codec_name ?? null, width: Number(video.width), height: Number(video.height), aspectRatio, durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null, hasAudio: Boolean(audio), frameRate: video.avg_frame_rate ?? video.r_frame_rate ?? null },
    requirements,
    directorReview: review,
    probe: { command: "ffprobe", args: probe.args },
    auditedAt: new Date().toISOString()
  };
}

export async function writeAssetQualityAudit({ projectPath, runId, report }) {
  return await writeJson(projectPath, runId, `asset_quality_audit_${safeId(report.assetRef)}.json`, report);
}

export function assertGenerationAnchorsAudited(run, requests) {
  const audits = Object.values(run.assetQualityAudits ?? {});
  for (const request of requests ?? []) for (const assetRef of request.inputAnchorAssets ?? []) {
    const asset = (run.assets ?? []).find((item) => [item.id, item.artifactRef].includes(assetRef));
    const reference = (run.references ?? []).find((item) => [item.referenceId, item.clipArtifactRef].includes(assetRef));
    if (!asset && !reference) continue;
    const isExternal = Boolean(reference || /^https?:/i.test(asset?.sourceUrl ?? "") || asset?.rightsStatus === "reference_only");
    if (!isExternal) continue;
    const audit = audits.find((item) => item.status === "ready" && [item.assetRef, item.artifactRef].includes(assetRef));
    if (!audit) throw new Error(`${request.requestId} cannot use external anchor ${assetRef} before a ready asset quality audit.`);
  }
}

export function requireWebAssetDownloadAuthorization(run, args) {
  const requiresApproval = ["reference_only", "unknown", "blocked"].includes(args.rightsStatus) || ["editorial", "social", "reference"].includes(args.sourceType);
  if (!requiresApproval) return null;
  const interaction = requireResolvedInteraction(run, args.interactionRequestId, "reference_download");
  if (interaction.gateKey !== `asset-download:${args.assetId}`) throw new Error(`Web asset download approval must use gateKey asset-download:${args.assetId}.`);
  const answer = Object.values(interaction.answers ?? {}).map(String).join(" ");
  if (/拒绝|取消|不允许|decline|cancel|deny/i.test(answer) || !/授权|允许|同意|确认|authorize|allow|approve/i.test(answer)) throw new Error("The request_user_input answer did not authorize this local asset download.");
  return { requestId: interaction.requestId, gateKey: interaction.gateKey, confirmedBy: "request_user_input", purpose: "local_reference_analysis", rightsGrant: false };
}

function resolveAsset(run, assetRef, projectPath) {
  const asset = (run.assets ?? []).find((item) => [item.id, item.artifactRef].includes(assetRef));
  const reference = (run.references ?? []).find((item) => [item.referenceId, item.clipArtifactRef].includes(assetRef));
  const artifactRef = asset?.artifactRef ?? reference?.clipArtifactRef ?? (run.artifacts?.[assetRef] ? assetRef : null);
  const artifact = artifactRef ? run.artifacts?.[artifactRef] : null;
  const rawPath = asset?.localPath ?? artifact?.path;
  if (!rawPath) throw new Error(`Unknown local asset for quality audit: ${assetRef}`);
  const root = resolve(projectPath), path = resolve(root, rawPath), relation = relative(root, path);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Asset quality audit path must stay inside the project workspace.");
  return { path, artifactRef: artifactRef ?? `asset:${asset.id}`, mediaKind: artifact?.mediaKind ?? (asset?.type === "video" ? "video" : "image"), rightsStatus: asset?.rightsStatus ?? reference?.rightsStatus ?? artifact?.metadata?.rightsStatus ?? "unknown", sourceUrl: asset?.sourceUrl ?? reference?.sourceUrl ?? artifact?.metadata?.sourceUrl ?? null };
}

async function probeMedia(path, projectPath, options) {
  const args = ["-v", "error", "-show_entries", "format=duration,size,format_name:stream=index,codec_name,codec_type,width,height,duration,avg_frame_rate,r_frame_rate,sample_rate,channels", "-of", "json", path];
  const result = await (options.runFn ?? runProcess)(options.command ?? "ffprobe", options.args ?? args, { cwd: resolve(projectPath), timeoutMs: options.timeoutMs ?? 30000, maxOutputBytes: 500000, failureLabel: "Asset quality probe" });
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new Error("Asset quality probe returned invalid JSON."); }
  return { ...value, args: result.args };
}

function normalizedRequirements(value = {}) {
  const requirements = { minimumWidth: value.minimumWidth ?? 1, minimumHeight: value.minimumHeight ?? 1, minimumDurationSeconds: value.minimumDurationSeconds ?? null, maximumDurationSeconds: value.maximumDurationSeconds ?? null, targetAspectRatio: value.targetAspectRatio ?? null, aspectTolerance: value.aspectTolerance ?? .25, requireAudio: Boolean(value.requireAudio), minimumScore: value.minimumScore ?? .72 };
  if (!Number.isInteger(requirements.minimumWidth) || requirements.minimumWidth < 1 || !Number.isInteger(requirements.minimumHeight) || requirements.minimumHeight < 1 || !Number.isFinite(requirements.aspectTolerance) || requirements.aspectTolerance < 0 || requirements.aspectTolerance > 2 || !Number.isFinite(requirements.minimumScore) || requirements.minimumScore < 0 || requirements.minimumScore > 1) throw new Error("Asset quality requirements are invalid.");
  for (const field of ["minimumDurationSeconds", "maximumDurationSeconds", "targetAspectRatio"]) if (requirements[field] != null && (!Number.isFinite(requirements[field]) || requirements[field] <= 0)) throw new Error(`Asset quality ${field} must be positive when provided.`);
  return requirements;
}

function normalizeDirectorReview(value) {
  for (const field of ["relevanceScore", "visualQualityScore", "compositionScore"]) if (!Number.isFinite(value?.[field]) || value[field] < 0 || value[field] > 1) throw new Error(`directorReview.${field} must be between 0 and 1.`);
  if (!["none", "low", "medium", "high", "blocked"].includes(value.artifactRisk) || !Array.isArray(value.observations) || !value.observations.length || typeof value.approvedForUse !== "boolean") throw new Error("Director review requires artifact risk, observations, and an approval decision.");
  return structuredClone(value);
}

async function writeJson(projectPath, runId, artifactRef, value) { const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(directory, { recursive: true }); const path = join(directory, artifactRef); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); return { artifactRef, path }; }
function safeId(value) { const result = String(value ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120); if (!result) throw new Error("Asset reference is required."); return result; }
async function sha256File(path) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
