import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute, join, relative, resolve } from "node:path";

export const WEB_IMAGE_CATEGORIES = Object.freeze([
  "company_logo", "product_interface", "product_image", "landmark", "office", "team", "visual_reference"
]);

const RIGHTS = new Set(["licensed", "public_domain", "attribution", "reference_only", "unknown", "blocked"]);
const SOURCE_TYPES = new Set(["official", "authoritative", "licensed_stock", "public_domain", "editorial", "social", "reference"]);
const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const URL_SECRET_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|private[_-]?key|credential|signature)/i;

export async function acquireWebImageAsset(input, options = {}) {
  validateInput(input);
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const lookupFn = options.lookupFn ?? dnsLookup;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let currentUrl = new URL(input.sourceImageUrl);
  const redirectChain = [];
  let response;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertSafeRemoteUrl(currentUrl, lookupFn);
    response = await fetchFn(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "image/png,image/jpeg,image/webp,image/gif", "User-Agent": "DirectorX/0.1 web-image-acquisition" }
    });
    if (!REDIRECT_STATUSES.has(response.status)) break;
    if (redirect === MAX_REDIRECTS) throw new Error("Web image download exceeded the redirect limit.");
    const location = response.headers.get("location");
    if (!location) throw new Error("Web image redirect did not include a Location header.");
    redirectChain.push(currentUrl.toString());
    currentUrl = new URL(location, currentUrl);
  }
  if (!response?.ok) throw new Error(`Web image download failed with HTTP ${response?.status ?? "unknown"}.`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error(`Web image exceeds the ${maxBytes}-byte limit.`);
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith("image/") && contentType !== "application/octet-stream") throw new Error(`Web image URL returned unsupported content type: ${contentType}`);
  const bytes = await readBoundedBody(response, maxBytes);
  const image = detectRasterImage(bytes);
  if (!image) throw new Error("Downloaded content is not a supported PNG, JPEG, WebP, or GIF image.");
  if (contentType && contentType.startsWith("image/") && !contentTypeMatches(contentType, image.mimeType)) throw new Error(`Image content does not match its declared content type (${contentType}).`);

  const projectRoot = resolve(input.projectPath);
  const directory = resolve(projectRoot, ".directorx", "plugin-runs", input.runId, "media", "research-images");
  await mkdir(directory, { recursive: true });
  const fileName = `${input.assetId}.${image.extension}`;
  const path = join(directory, fileName);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const relativePath = relative(projectRoot, path);
  const artifactRef = `web_image:${input.assetId}`;
  const acquiredAt = new Date().toISOString();
  const receipt = {
    schemaVersion: "1.0",
    runId: input.runId,
    assetId: input.assetId,
    category: input.category,
    label: input.label,
    sourceType: input.sourceType,
    sourcePageUrl: input.sourcePageUrl,
    requestedImageUrl: input.sourceImageUrl,
    resolvedImageUrl: currentUrl.toString(),
    redirectChain,
    rightsStatus: input.rightsStatus,
    licenseEvidence: input.licenseEvidence ?? null,
    attribution: input.attribution ?? null,
    intendedUse: input.intendedUse,
    fallback: input.fallback,
    localPath: relativePath,
    artifactRef,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    byteLength: bytes.length,
    sha256,
    acquiredAt
  };
  if (input.downloadAuthorization) receipt.downloadAuthorization = structuredClone(input.downloadAuthorization);
  const receiptName = `web_image_receipt_${input.assetId}.json`;
  const receiptPath = resolve(projectRoot, ".directorx", "plugin-runs", input.runId, "artifacts", receiptName);
  await mkdir(resolve(projectRoot, ".directorx", "plugin-runs", input.runId, "artifacts"), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return {
    asset: {
      id: input.assetId,
      type: input.category === "company_logo" ? "logo" : "image",
      label: input.label,
      sourceUrl: input.sourcePageUrl,
      sourceImageUrl: currentUrl.toString(),
      localPath: path,
      previewUri: relativePath,
      artifactRef,
      rightsStatus: input.rightsStatus,
      intendedUse: input.intendedUse,
      licenseEvidence: input.licenseEvidence,
      attribution: input.attribution,
      fallback: input.fallback,
      stage: "research",
      technicalRequirements: { category: input.category, sourceType: input.sourceType, mimeType: image.mimeType, width: image.width, height: image.height, byteLength: bytes.length, sha256 },
      registeredAt: acquiredAt
    },
    receipt,
    imageArtifact: { artifactRef, path, relativePath, stage: "research", mediaKind: "image", sizeBytes: bytes.length, sha256, registeredAt: acquiredAt },
    receiptArtifact: { artifactRef: receiptName, path: receiptPath, stage: "research", mediaKind: "document", registeredAt: acquiredAt }
  };
}

export async function auditVisualAssetCoverage(run, input, now = new Date().toISOString()) {
  if (!Array.isArray(input?.requirements) || !input.requirements.length) throw new Error("Visual asset coverage requires at least one category requirement.");
  if (!input.projectPath) throw new Error("Visual asset coverage requires projectPath so local evidence can be verified.");
  const candidateAssets = (run.assets ?? []).filter((asset) => ["image", "logo", "reference_frame"].includes(asset.type) && asset.localPath);
  const verifiedVisualAssets = [];
  const invalidVisualAssets = [];
  for (const asset of candidateAssets) {
    try {
      verifiedVisualAssets.push(await verifyVisualAsset(run, input.projectPath, asset));
    } catch (error) {
      invalidVisualAssets.push({ assetId: asset.id ?? null, localPath: asset.localPath, reason: error.message });
    }
  }
  const requirements = input.requirements.map((requirement) => {
    if (!WEB_IMAGE_CATEGORIES.includes(requirement.category)) throw new Error(`Unsupported visual asset category: ${requirement.category}`);
    if (!Number.isInteger(requirement.minimumCount) || requirement.minimumCount < 1) throw new Error(`${requirement.category}.minimumCount must be a positive integer.`);
    const matches = verifiedVisualAssets.filter((asset) => {
      if (asset.technicalRequirements?.category !== requirement.category) return false;
      if (["unknown", "blocked"].includes(asset.rightsStatus)) return false;
      if (!requirement.allowReferenceOnly && asset.rightsStatus === "reference_only") return false;
      if (run.researchAssetPolicy?.requireQualityAudit === true) {
        const audited = Object.values(run.assetQualityAudits ?? {}).some((audit) => audit.status === "ready" && ([audit.assetRef, audit.artifactRef].includes(asset.id) || [audit.assetRef, audit.artifactRef].includes(asset.artifactRef)));
        if (!audited) return false;
      }
      return true;
    });
    return {
      ...requirement,
      acquiredCount: matches.length,
      assetIds: matches.map((asset) => asset.id),
      status: matches.length >= requirement.minimumCount ? "ready" : "missing"
    };
  });
  const missing = requirements.filter((requirement) => requirement.status !== "ready");
  return {
    schemaVersion: "1.0",
    runId: run.runId,
    status: missing.length ? "blocked" : "ready",
    requirements,
    acquiredVisualAssetCount: verifiedVisualAssets.length,
    discoveredVisualAssetCount: candidateAssets.length,
    verifiedVisualAssets: verifiedVisualAssets.map(({ id, artifactRef, localPath, sha256, rightsStatus }) => ({ id, artifactRef, localPath, sha256, rightsStatus })),
    invalidVisualAssets,
    missingCategories: missing.map((requirement) => requirement.category),
    auditedAt: now
  };
}

async function verifyVisualAsset(run, projectPath, asset) {
  const projectRoot = resolve(projectPath);
  const absolutePath = resolve(projectRoot, asset.localPath);
  const relation = relative(projectRoot, absolutePath);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("asset path escapes the project workspace");
  const details = await stat(absolutePath);
  if (!details.isFile() || details.size <= 0) throw new Error("local raster is missing or empty");
  const bytes = await readFile(absolutePath);
  if (!detectRasterImage(bytes)) throw new Error("local file is not a supported raster image");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (asset.technicalRequirements?.sha256 !== sha256) throw new Error("local raster hash does not match the registered asset");
  const receipt = (run.webImageAcquisitions ?? []).find((item) => item.assetId === asset.id);
  if (!receipt) throw new Error("web acquisition receipt is missing");
  if (receipt.sha256 !== sha256 || receipt.artifactRef !== asset.artifactRef) throw new Error("web acquisition receipt does not match the local asset");
  const receiptPath = resolve(projectRoot, receipt.localPath);
  if (receiptPath !== absolutePath) throw new Error("web acquisition receipt points to a different local file");
  if (receipt.rightsStatus !== asset.rightsStatus) throw new Error("rights status differs between asset and acquisition receipt");
  if (["licensed", "public_domain", "attribution"].includes(asset.rightsStatus) && !String(receipt.licenseEvidence ?? "").trim()) throw new Error(`${asset.rightsStatus} asset is missing license evidence`);
  if (asset.rightsStatus === "attribution" && !String(receipt.attribution ?? "").trim()) throw new Error("attribution asset is missing attribution text");
  return { ...asset, localPath: relation, sha256 };
}

export async function writeVisualAssetCoverage({ projectPath, runId, report }) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Director X run ID.");
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "visual_asset_coverage.json");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "visual_asset_coverage.json", path };
}

export async function assertSafeRemoteUrl(url, lookupFn) {
  if (url.protocol !== "https:") throw new Error("Web image acquisition accepts HTTPS URLs only.");
  if (url.username || url.password) throw new Error("Authenticated image URLs are not accepted.");
  for (const name of url.searchParams.keys()) if (URL_SECRET_PATTERN.test(name)) throw new Error("Signed or credential-bearing image URLs are not persisted; use a public direct image URL.");
  if (isSearchThumbnailUrl(url)) throw new Error("Search-result thumbnail proxies are not assets; open the source page and use its public original image URL.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) throw new Error("Local and private network image URLs are blocked.");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookupFn(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Local, private, reserved, or link-local image hosts are blocked.");
}

async function readBoundedBody(response, maxBytes) {
  if (!response.body) throw new Error("Web image response had no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new Error(`Web image exceeds the ${maxBytes}-byte limit.`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length);
}

function validateInput(input) {
  if (!input?.projectPath || !/^dx-[a-z0-9-]+$/i.test(input.runId ?? "")) throw new Error("projectPath and a valid Director X runId are required.");
  if (!ASSET_ID_PATTERN.test(input.assetId ?? "")) throw new Error("assetId must use letters, numbers, hyphens, or underscores.");
  if (!WEB_IMAGE_CATEGORIES.includes(input.category)) throw new Error(`Unsupported visual asset category: ${input.category}`);
  if (!SOURCE_TYPES.has(input.sourceType)) throw new Error(`Unsupported web image source type: ${input.sourceType}`);
  if (!RIGHTS.has(input.rightsStatus)) throw new Error(`Unsupported rights status: ${input.rightsStatus}`);
  for (const field of ["label", "sourcePageUrl", "sourceImageUrl", "intendedUse", "fallback"]) if (!String(input[field] ?? "").trim()) throw new Error(`${field} is required.`);
  const page = new URL(input.sourcePageUrl);
  if (!["http:", "https:"].includes(page.protocol) || page.username || page.password) throw new Error("sourcePageUrl must be a public HTTP(S) page.");
  for (const name of page.searchParams.keys()) if (URL_SECRET_PATTERN.test(name)) throw new Error("Credential-bearing source pages are not persisted.");
}

function detectRasterImage(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && bytes.subarray(12, 16).toString("ascii") === "IHDR") {
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width && height) return { mimeType: "image/png", extension: "png", width, height };
  }
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const dimensions = jpegDimensions(bytes);
    if (dimensions) return { mimeType: "image/jpeg", extension: "jpg", ...dimensions };
  }
  if (bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
    const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
    if (width && height) return { mimeType: "image/gif", extension: "gif", width, height };
  }
  if (bytes.length >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" && bytes.subarray(12, 16).toString("ascii") === "VP8X") {
    const width = 1 + bytes.readUIntLE(24, 3), height = 1 + bytes.readUIntLE(27, 3);
    if (width && height) return { mimeType: "image/webp", extension: "webp", width, height };
  }
  if (bytes.length >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" && bytes.subarray(12, 16).toString("ascii") === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    const width = bytes.readUInt16LE(26) & 0x3fff, height = bytes.readUInt16LE(28) & 0x3fff;
    if (width && height) return { mimeType: "image/webp", extension: "webp", width, height };
  }
  if (bytes.length >= 25 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" && bytes.subarray(12, 16).toString("ascii") === "VP8L" && bytes[20] === 0x2f) {
    const dimensions = bytes.readUInt32LE(21);
    const width = (dimensions & 0x3fff) + 1, height = ((dimensions >>> 14) & 0x3fff) + 1;
    if (width && height) return { mimeType: "image/webp", extension: "webp", width, height };
  }
  return null;
}

function jpegDimensions(bytes) {
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (startOfFrame.has(marker) && length >= 7) {
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      return width && height ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

function contentTypeMatches(declared, detected) {
  return declared === detected || (declared === "image/jpg" && detected === "image/jpeg");
}

function isPrivateAddress(address) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (normalized.includes(":")) return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && [0, 2].includes(c)) || (a === 192 && b === 88 && c === 99) || (a === 198 && [18, 19].includes(b)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
}

function isSearchThumbnailUrl(url) {
  const host = url.hostname.toLowerCase();
  return (host.endsWith("gstatic.com") && /(?:^|[?&])q=tbn:|\/images\?q=tbn:/i.test(`${url.pathname}${url.search}`))
    || (host.endsWith("mm.bing.net") && /\/th\//i.test(url.pathname))
    || host === "external-content.duckduckgo.com";
}
