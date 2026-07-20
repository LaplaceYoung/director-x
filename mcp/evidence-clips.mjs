import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { runProcess } from "./media-execution.mjs";

const MAX_REVIEW_CLIP_SECONDS = 60;
const MAX_REVIEW_CLIP_BYTES = 250_000_000;
const MIN_REVIEW_CLIP_SECONDS = 0.04;
const SHA256 = /^[a-f0-9]{64}$/i;

/**
 * Materialize one selected evidence range as a review-only derivative.
 * The source is never mutated and the output is never delivery-eligible.
 */
export async function materializeEvidenceClip(input, options = {}) {
  const projectPath = resolve(input.projectPath);
  const sourcePath = containedPath(projectPath, input.sourcePath, "Evidence source");
  const sourceDetails = await stat(sourcePath);
  if (!sourceDetails.isFile() || sourceDetails.size <= 0) throw new Error("Evidence source must be a non-empty project video.");
  if (!SHA256.test(String(input.sourceSha256 ?? ""))) throw new Error("Evidence source SHA-256 is required.");
  const actualSourceSha256 = await sha256(sourcePath);
  if (actualSourceSha256 !== String(input.sourceSha256).toLowerCase()) throw new Error("Evidence source content changed since indexing.");

  const startSeconds = finiteNonNegative(input.startSeconds, "Evidence clip start");
  const endSeconds = finiteNonNegative(input.endSeconds, "Evidence clip end");
  const durationSeconds = round(endSeconds - startSeconds);
  if (durationSeconds < MIN_REVIEW_CLIP_SECONDS || durationSeconds > MAX_REVIEW_CLIP_SECONDS) throw new Error(`Evidence review clips must be between ${MIN_REVIEW_CLIP_SECONDS} and ${MAX_REVIEW_CLIP_SECONDS} seconds.`);
  if (input.sourceDurationSeconds != null && endSeconds > Number(input.sourceDurationSeconds) + 0.05) throw new Error("Evidence clip range exceeds the indexed source duration.");

  const clipId = safeToken(input.clipId, "Evidence clip ID");
  const root = containedPath(projectPath, `.directorx/plugin-runs/${input.runId}/evidence-clips`, "Evidence clip output");
  await mkdir(root, { recursive: true });
  const outputPath = join(root, `${clipId}.mp4`);
  const receiptPath = join(root, `${clipId}.receipt.json`);
  const run = options.runFn ?? runProcess;
  const commands = [];
  const execute = async (command, args, failureLabel, maxOutputBytes = 2_000_000) => {
    const result = await run(command, args, { cwd: projectPath, timeoutMs: input.timeoutMs ?? 300000, maxOutputBytes, failureLabel });
    commands.push({ command, args: args.map((value) => redactPath(projectPath, value)), exitCode: result.exitCode ?? 0 });
    return result;
  };

  await rm(outputPath, { force: true });
  const ffmpegArgs = [
    "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
    "-ss", String(startSeconds), "-t", String(durationSeconds),
    "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", outputPath
  ];
  await execute("ffmpeg", ffmpegArgs, "Evidence review clip extraction");
  const outputDetails = await stat(outputPath);
  if (!outputDetails.isFile() || outputDetails.size <= 0) throw new Error("Evidence clip extraction produced no output.");
  if (outputDetails.size > MAX_REVIEW_CLIP_BYTES) throw new Error("Evidence review clip exceeded the 250 MB safety bound.");

  const probeArgs = ["-v", "error", "-show_entries", "format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,avg_frame_rate,duration", "-of", "json", outputPath];
  const probeResult = await execute("ffprobe", probeArgs, "Evidence review clip probe", 1_000_000);
  let probe;
  try { probe = JSON.parse(probeResult.stdout); } catch { throw new Error("Evidence review clip probe returned invalid JSON."); }
  const actualDurationSeconds = Number(probe.format?.duration ?? 0);
  const videoStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === "video");
  if (!Number.isFinite(actualDurationSeconds) || actualDurationSeconds < MIN_REVIEW_CLIP_SECONDS || videoStreams.length === 0) throw new Error("Evidence review clip is not playable.");
  if (actualDurationSeconds > durationSeconds + 0.25) throw new Error("Evidence review clip exceeded the requested range.");

  const outputSha256 = await sha256(outputPath);
  const relativeSourcePath = relative(projectPath, sourcePath);
  const relativeOutputPath = relative(projectPath, outputPath);
  const receipt = {
    schemaVersion: "1.0",
    receiptKind: "evidence_clip",
    clipId,
    status: "ready_for_human_review",
    source: { artifactRef: input.sourceArtifactRef, relativePath: relativeSourcePath, sha256: actualSourceSha256, sizeBytes: sourceDetails.size },
    selection: {
      queryId: input.queryId,
      nodeId: input.nodeId,
      startSeconds,
      endSeconds,
      durationSeconds,
      halfOpen: true,
      evidenceRefs: [...new Set(input.evidenceRefs ?? [])]
    },
    output: { artifactRef: input.outputArtifactRef ?? `evidence-clip:${clipId}`, relativePath: relativeOutputPath, sha256: outputSha256, sizeBytes: outputDetails.size, durationSeconds: round(actualDurationSeconds), probe },
    rights: { sourceRightsStatus: input.rightsStatus ?? "unknown", deliveryEligible: false, referenceOnly: true, policy: "review_only_derivative_never_enters_delivery_without_a_separate_rights_decision" },
    humanReview: { required: true, status: "pending", instruction: "Open the playable evidence clip and verify the selected moment before using it in a claim or edit." },
    lineage: { sourceArtifactRef: input.sourceArtifactRef, indexId: input.indexId, queryId: input.queryId, nodeId: input.nodeId, retrievalTraceRef: input.retrievalTraceRef ?? null },
    commands,
    createdAt: new Date().toISOString()
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return { clipId, outputPath, receiptPath, relativeOutputPath, outputSha256, sourceSha256: actualSourceSha256, durationSeconds: round(actualDurationSeconds), probe, receipt };
}

function containedPath(projectPath, inputPath, label) {
  const absolute = resolve(projectPath, inputPath);
  const relation = relative(projectPath, absolute);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error(`${label} must stay inside the project workspace.`);
  return absolute;
}

function redactPath(projectPath, value) {
  const text = String(value);
  if (!isAbsolute(text)) return text;
  const relation = relative(projectPath, text);
  return relation.startsWith("..") || isAbsolute(relation) ? "<external-path>" : relation;
}

function finiteNonNegative(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be finite and non-negative.`);
  return result;
}

function safeToken(value, label) {
  const token = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
  if (!token) throw new Error(`${label} is required.`);
  return token;
}

function round(value) { return Math.round(value * 1000) / 1000; }

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
