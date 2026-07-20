import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { inspectMediaDelivery, runProcess } from "./media-execution.mjs";

const SEGMENT_ID = /^[A-Za-z0-9._-]{1,80}$/;
const REVIEW_STATES = new Set(["passed", "failed"]);
const DEFAULT_MINIMUM_SSIM = 0.62;

export async function writeSegmentContinuityPlan({ projectPath, runId, plan }) {
  validateSegmentContinuityPlan(plan);
  const root = artifactRoot(projectPath, runId);
  await mkdir(root, { recursive: true });
  const documents = {
    "segment_continuity_plan.json": {
      schemaVersion: "1.0",
      runId,
      createdAt: new Date().toISOString(),
      ...plan
    },
    "frame_handoff_manifest.json": {
      schemaVersion: "1.0",
      runId,
      sequenceId: plan.sequenceId,
      handoffs: plan.segments.slice(1).map((segment, index) => ({
        handoffId: `HANDOFF-${index + 1}`,
        fromSegmentId: plan.segments[index].segmentId,
        toSegmentId: segment.segmentId,
        sourceEndFrameAssetRef: plan.segments[index].endFrameAssetRef,
        targetStartFrameAssetRef: segment.startFrameAssetRef,
        matchPolicy: segment.handoff.matchPolicy,
        minimumSsim: segment.handoff.minimumSsim ?? plan.minimumSsim ?? DEFAULT_MINIMUM_SSIM,
        actionOverlapSeconds: segment.handoff.actionOverlapSeconds ?? 0,
        cameraContinuity: segment.handoff.cameraContinuity,
        subjectContinuity: segment.handoff.subjectContinuity,
        environmentContinuity: segment.handoff.environmentContinuity,
        motionContinuity: segment.handoff.motionContinuity,
        audioBridge: segment.handoff.audioBridge,
        acceptanceCriteria: segment.handoff.acceptanceCriteria
      }))
    }
  };
  return await writeDocuments(root, documents);
}

export function validateSegmentContinuityPlan(plan) {
  if (!String(plan?.sequenceId ?? "").trim()) throw new Error("Segment continuity requires a sequenceId.");
  if (!Array.isArray(plan?.segments) || !plan.segments.length) throw new Error("Segment continuity requires at least one ordered video segment.");
  const ids = new Set();
  const requestIds = new Set();
  plan.segments.forEach((segment, index) => {
    if (!SEGMENT_ID.test(segment?.segmentId ?? "") || ids.has(segment.segmentId)) throw new Error("Every segment needs a unique safe segmentId.");
    ids.add(segment.segmentId);
    if (!String(segment.requestId ?? "").trim() || requestIds.has(segment.requestId)) throw new Error(`${segment.segmentId} needs a unique requestId.`);
    requestIds.add(segment.requestId);
    if (!(segment.durationSeconds > 0)) throw new Error(`${segment.segmentId} needs a positive durationSeconds.`);
    if (!String(segment.startFrameAssetRef ?? "").trim() || !String(segment.endFrameAssetRef ?? "").trim()) throw new Error(`${segment.segmentId} needs explicit startFrameAssetRef and endFrameAssetRef.`);
    if (segment.startFrameAssetRef === segment.endFrameAssetRef) throw new Error(`${segment.segmentId} must define distinct start and end frame assets.`);
    if (index === 0) {
      if (segment.previousSegmentId) throw new Error("The first segment cannot declare previousSegmentId.");
      return;
    }
    const previous = plan.segments[index - 1];
    if (segment.previousSegmentId !== previous.segmentId) throw new Error(`${segment.segmentId} must follow ${previous.segmentId}.`);
    if (segment.startFrameAssetRef !== previous.endFrameAssetRef) throw new Error(`${segment.segmentId} must consume ${previous.segmentId}'s approved end frame as its start frame.`);
    validateHandoff(segment.handoff, segment.segmentId, plan.minimumSsim);
  });
}

export function assertGenerationPlanUsesBoundaryFrames(run, generationPlan) {
  const videoRequests = (generationPlan?.requests ?? []).filter((request) => request.mode !== "image");
  if (videoRequests.length <= 1) return;
  const plan = run.segmentContinuityPlan;
  if (!plan) throw new Error("Multi-segment video generation requires directorx_register_segment_continuity_plan before generation.");
  validateSegmentContinuityPlan(plan);
  if (plan.segments.length !== videoRequests.length) throw new Error("The segment continuity plan must contain one segment for every video generation request.");
  for (const [index, request] of videoRequests.entries()) {
    const segment = plan.segments[index];
    if (segment.requestId !== request.requestId) throw new Error(`Segment ${segment.segmentId} must bind generation request ${request.requestId}.`);
    if (request.mode !== "keyframes_to_video") throw new Error(`${request.requestId} must use keyframes_to_video so both approved boundary frames reach the provider.`);
    if (!(request.inputAnchorAssets ?? []).includes(segment.startFrameAssetRef)) throw new Error(`${request.requestId} is missing its approved start-frame anchor.`);
    if (!(request.outputAnchorAssets ?? []).includes(segment.endFrameAssetRef)) throw new Error(`${request.requestId} is missing its approved end-frame anchor.`);
  }
}

export async function extractSegmentBoundaryFrames(input, run, options = {}) {
  const plan = run.segmentContinuityPlan;
  if (!plan) throw new Error("Register a segment continuity plan before extracting boundary frames.");
  const segment = plan.segments.find((item) => item.segmentId === input.segmentId);
  if (!segment) throw new Error(`Unknown continuity segment: ${input.segmentId}`);
  const selected = selectedVideoForRequest(run, segment.requestId);
  if (!selected) throw new Error(`${segment.segmentId} needs a selected generated video before boundary extraction.`);
  if (input.videoArtifactRef !== selected.assetRef) throw new Error(`${segment.segmentId} boundary extraction must use its selected candidate ${selected.assetRef}.`);
  const artifact = run.artifacts?.[input.videoArtifactRef];
  if (!artifact?.path || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) throw new Error(`Missing hashed registered video artifact: ${input.videoArtifactRef}`);
  const videoPath = containedPath(input.projectPath, artifact.path);
  const videoSha256 = await fileSha256(videoPath);
  if (videoSha256 !== artifact.sha256) throw new Error(`${input.videoArtifactRef} changed after registration; register the current video before boundary extraction.`);
  const media = await (options.inspectMedia ?? inspectMediaDelivery)({ projectPath: input.projectPath, finalVideoPath: videoPath, requireAudio: false, timeoutMs: input.timeoutMs });
  const directory = containedPath(input.projectPath, `.directorx/plugin-runs/${input.runId}/media/boundary-frames`);
  await mkdir(directory, { recursive: true });
  const firstPath = join(directory, `${segment.segmentId}.first.png`);
  const lastPath = join(directory, `${segment.segmentId}.last.png`);
  const runFn = options.runFn ?? runProcess;
  const firstArgs = ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-vf", "select=eq(n\\,0)", "-frames:v", "1", firstPath];
  const lastSeek = Math.max(0, media.durationSeconds - Math.max(0.05, 1 / (media.mediaIntegrity?.frameRate ?? 24)));
  const lastArgs = ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(lastSeek), "-i", videoPath, "-frames:v", "1", lastPath];
  const effectiveFirstArgs = options.firstArgs ?? firstArgs;
  const effectiveLastArgs = options.lastArgs ?? lastArgs;
  await runFn(options.ffmpegCommand ?? "ffmpeg", effectiveFirstArgs, { cwd: resolve(input.projectPath), timeoutMs: input.timeoutMs ?? 120000, maxOutputBytes: 200_000, failureLabel: `First-frame extraction for ${segment.segmentId}` });
  await runFn(options.ffmpegCommand ?? "ffmpeg", effectiveLastArgs, { cwd: resolve(input.projectPath), timeoutMs: input.timeoutMs ?? 120000, maxOutputBytes: 200_000, failureLabel: `Last-frame extraction for ${segment.segmentId}` });
  await assertNonEmptyFile(firstPath, "first boundary frame");
  await assertNonEmptyFile(lastPath, "last boundary frame");
  const firstArtifactRef = `boundary:${segment.segmentId}:first`;
  const lastArtifactRef = `boundary:${segment.segmentId}:last`;
  return {
    schemaVersion: "1.0",
    runId: input.runId,
    sequenceId: plan.sequenceId,
    segmentId: segment.segmentId,
    requestId: segment.requestId,
    videoArtifactRef: input.videoArtifactRef,
    videoPath: relative(resolve(input.projectPath), videoPath),
    videoSha256,
    durationSeconds: media.durationSeconds,
    extractedAt: new Date().toISOString(),
    firstFrame: await frameRecord(input.projectPath, firstArtifactRef, firstPath, 0),
    lastFrame: await frameRecord(input.projectPath, lastArtifactRef, lastPath, lastSeek),
    commands: [{ executable: options.ffmpegCommand ?? "ffmpeg", args: effectiveFirstArgs }, { executable: options.ffmpegCommand ?? "ffmpeg", args: effectiveLastArgs }]
  };
}

export async function writeSegmentBoundaryIndex({ projectPath, runId, frames, segmentOrder = [] }) {
  const order = new Map(segmentOrder.map((segmentId, index) => [segmentId, index]));
  const value = { schemaVersion: "1.0", runId, updatedAt: new Date().toISOString(), segments: Object.values(frames ?? {}).sort((a, b) => (order.get(a.segmentId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.segmentId) ?? Number.MAX_SAFE_INTEGER) || a.segmentId.localeCompare(b.segmentId)) };
  const [result] = Object.values(await writeDocuments(artifactRoot(projectPath, runId), { "segment_boundary_frames.json": value }));
  return result;
}

export async function auditSegmentContinuity({ projectPath, runId, reviews = [], minimumSsim }, run, options = {}) {
  const plan = run.segmentContinuityPlan;
  if (!plan || plan.segments.length < 2) throw new Error("Boundary continuity audit requires a multi-segment continuity plan.");
  const frames = run.segmentBoundaryFrames ?? {};
  const results = [];
  for (let index = 1; index < plan.segments.length; index += 1) {
    const from = plan.segments[index - 1];
    const to = plan.segments[index];
    const source = frames[from.segmentId]?.lastFrame;
    const target = frames[to.segmentId]?.firstFrame;
    if (!source?.path || !target?.path) throw new Error(`Extract real boundary frames for ${from.segmentId} and ${to.segmentId} before audit.`);
    const review = reviews.find((item) => item.fromSegmentId === from.segmentId && item.toSegmentId === to.segmentId);
    validateBoundaryReview(review, from.segmentId, to.segmentId);
    const threshold = to.handoff?.minimumSsim ?? plan.minimumSsim ?? minimumSsim ?? DEFAULT_MINIMUM_SSIM;
    const similarity = await measureSsim(source.path, target.path, inputProcessOptions(projectPath, options));
    const checks = {
      visualSimilarity: similarity >= threshold ? "passed" : "failed",
      subjectContinuity: review.subjectContinuity,
      cameraContinuity: review.cameraContinuity,
      motionContinuity: review.motionContinuity,
      environmentContinuity: review.environmentContinuity,
      audioContinuity: review.audioContinuity
    };
    const status = Object.values(checks).every((value) => value === "passed") ? "passed" : "failed";
    results.push({
      boundaryId: `${from.segmentId}->${to.segmentId}`,
      fromSegmentId: from.segmentId,
      toSegmentId: to.segmentId,
      sourceEndFrameArtifactRef: source.artifactRef,
      targetStartFrameArtifactRef: target.artifactRef,
      sourceEndFrameSha256: source.sha256,
      targetStartFrameSha256: target.sha256,
      ssim: similarity,
      minimumSsim: threshold,
      checks,
      status,
      evidenceRefs: review.evidenceRefs,
      notes: review.notes
    });
  }
  return { schemaVersion: "1.0", runId, sequenceId: plan.sequenceId, status: results.every((item) => item.status === "passed") ? "passed" : "blocked", boundaries: results, auditedAt: new Date().toISOString(), verifier: "ffmpeg-ssim-plus-director-review" };
}

export async function writeBoundaryContinuityReport({ projectPath, runId, report }) {
  const [result] = Object.values(await writeDocuments(artifactRoot(projectPath, runId), { "boundary_continuity_report.json": report }));
  return result;
}

export async function writeSegmentStitchPlan({ projectPath, runId, stitchPlan }, run) {
  validateSegmentStitchPlan(stitchPlan, run);
  const value = { schemaVersion: "1.0", runId, createdAt: new Date().toISOString(), ...stitchPlan };
  const [result] = Object.values(await writeDocuments(artifactRoot(projectPath, runId), { "segment_stitch_plan.json": value }));
  return result;
}

export function validateSegmentStitchPlan(stitchPlan, run) {
  const plan = run.segmentContinuityPlan;
  if (!plan) throw new Error("Register a segment continuity plan before the stitch plan.");
  if (stitchPlan?.sequenceId !== plan.sequenceId) throw new Error("The stitch plan sequenceId must match the approved segment continuity plan.");
  if (run.boundaryContinuityReport?.status !== "passed" && plan.segments.length > 1) throw new Error("The boundary continuity report must pass before stitching multiple segments.");
  if (!Array.isArray(stitchPlan?.clips) || stitchPlan.clips.length !== plan.segments.length) throw new Error("The stitch plan must include one selected clip for every segment.");
  plan.segments.forEach((segment, index) => {
    const clip = stitchPlan.clips[index];
    const extracted = run.segmentBoundaryFrames?.[segment.segmentId];
    const selected = selectedVideoForRequest(run, segment.requestId);
    if (clip?.segmentId !== segment.segmentId || !clip.videoArtifactRef) throw new Error("Stitch clips must preserve the planned segment order and identify registered videos.");
    if (clip.videoArtifactRef !== extracted?.videoArtifactRef) throw new Error(`${segment.segmentId} stitch input does not match its audited boundary-frame source.`);
    if (clip.videoArtifactRef !== selected?.assetRef) throw new Error(`${segment.segmentId} stitch input is no longer the selected video for ${segment.requestId}.`);
  });
  if (!Array.isArray(stitchPlan.transitions) || stitchPlan.transitions.length !== Math.max(0, plan.segments.length - 1)) throw new Error("The stitch plan needs exactly one transition per segment boundary.");
  for (const [index, transition] of stitchPlan.transitions.entries()) {
    const expectedFrom = plan.segments[index].segmentId;
    const expectedTo = plan.segments[index + 1].segmentId;
    if (transition.fromSegmentId !== expectedFrom || transition.toSegmentId !== expectedTo) throw new Error(`Stitch transition ${index + 1} must connect ${expectedFrom} -> ${expectedTo}.`);
    const boundary = run.boundaryContinuityReport?.boundaries?.find((item) => item.fromSegmentId === transition.fromSegmentId && item.toSegmentId === transition.toSegmentId);
    if (!boundary || boundary.status !== "passed" || transition.boundaryEvidenceRef !== "boundary_continuity_report.json") throw new Error("Every stitch transition must reference a passed audited boundary.");
    if (!String(transition.method ?? "").trim() || !String(transition.audioBridge ?? "").trim()) throw new Error("Every stitch transition needs an explicit visual method and audio bridge.");
  }
  if (!String(stitchPlan.renderStrategy ?? "").trim()) throw new Error("The stitch plan needs a renderStrategy.");
}

export function assertSegmentContinuityReady(run) {
  const selectedVideos = (run.generation?.candidates ?? []).filter((candidate) => candidate.status === "selected" && candidate.mediaType === "video");
  const plannedCount = run.segmentContinuityPlan?.segments?.length ?? 0;
  if (selectedVideos.length <= 1 && plannedCount <= 1) return { required: false, status: "not_required" };
  if (!run.segmentContinuityPlan) throw new Error("Multi-segment render is blocked: segment_continuity_plan.json is missing.");
  const expected = run.segmentContinuityPlan.segments.length;
  if (selectedVideos.length !== expected) throw new Error(`Multi-segment render is blocked: selected ${selectedVideos.length}/${expected} planned videos.`);
  if (Object.keys(run.segmentBoundaryFrames ?? {}).length < expected) throw new Error("Multi-segment render is blocked: real first/last frame extraction is incomplete.");
  if (run.boundaryContinuityReport?.status !== "passed") throw new Error("Multi-segment render is blocked: boundary_continuity_report.json has not passed.");
  if (!run.segmentStitchPlan) throw new Error("Multi-segment render is blocked: segment_stitch_plan.json is missing.");
  validateSegmentStitchPlan(run.segmentStitchPlan, run);
  return { required: true, status: "passed", segmentCount: expected, boundaryCount: expected - 1 };
}

export async function assertRenderPropsBindSegmentStitch(run, { projectPath, propsPath }) {
  const readiness = assertSegmentContinuityReady(run);
  if (!readiness.required) return { ...readiness, renderPropsBinding: "not_required" };
  if (!String(propsPath ?? "").trim()) throw new Error("Multi-segment render is blocked: propsPath must bind the audited segment stitch plan.");
  const absolutePath = containedPath(projectPath, propsPath);
  const details = await stat(absolutePath);
  if (!details.isFile() || details.size <= 0 || details.size > 1024 * 1024) throw new Error("Multi-segment render props must be a non-empty JSON file no larger than 1 MB.");
  const bytes = await readFile(absolutePath);
  let props;
  try { props = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Multi-segment render props must contain valid JSON."); }
  const binding = props.directorxSegmentStitch ?? props.directorx?.segmentStitch;
  if (!binding || binding.planArtifactRef !== "segment_stitch_plan.json" || binding.boundaryReportRef !== "boundary_continuity_report.json") throw new Error("Remotion props must bind segment_stitch_plan.json and boundary_continuity_report.json.");
  if (binding.sequenceId !== run.segmentContinuityPlan.sequenceId) throw new Error("Remotion props segment sequence does not match the approved continuity plan.");
  const expectedClips = run.segmentStitchPlan.clips.map((clip) => clip.videoArtifactRef);
  if (!Array.isArray(binding.clipArtifactRefs) || binding.clipArtifactRefs.length !== expectedClips.length || binding.clipArtifactRefs.some((artifactRef, index) => artifactRef !== expectedClips[index])) throw new Error("Remotion props clipArtifactRefs must exactly preserve the audited stitch order.");
  for (const [index, artifactRef] of expectedClips.entries()) {
    const artifact = run.artifacts?.[artifactRef];
    if (!artifact?.path || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) throw new Error(`Remotion stitch input is not a hashed registered local artifact: ${artifactRef}`);
    const currentSha256 = await fileSha256(containedPath(projectPath, artifact.path));
    const auditedSha256 = run.segmentBoundaryFrames?.[run.segmentContinuityPlan.segments[index].segmentId]?.videoSha256;
    if (currentSha256 !== artifact.sha256 || currentSha256 !== auditedSha256) throw new Error(`Remotion stitch input changed after continuity audit: ${artifactRef}`);
  }
  return {
    ...readiness,
    renderPropsBinding: "passed",
    propsPath: relative(resolve(projectPath), absolutePath),
    propsSha256: createHash("sha256").update(bytes).digest("hex"),
    clipArtifactRefs: expectedClips
  };
}

export function assertSegmentContinuityRenderEvidence(run) {
  const readiness = assertSegmentContinuityReady(run);
  if (!readiness.required) return { ...readiness, renderEvidence: "not_required" };
  const evidence = run.artifacts?.["render_report.json"]?.metadata?.segmentContinuity;
  if (evidence?.status !== "passed" || evidence?.renderPropsBinding !== "passed" || !String(evidence.propsSha256 ?? "").match(/^[a-f0-9]{64}$/)) throw new Error("Final verification is blocked: render_report.json lacks a validated multi-segment props binding.");
  if (evidence.segmentCount !== readiness.segmentCount || evidence.boundaryCount !== readiness.boundaryCount) throw new Error("Final verification is blocked: render continuity evidence does not match the current segment plan.");
  return { ...readiness, renderEvidence: "passed", propsSha256: evidence.propsSha256 };
}

export function preserveSegmentContinuityRenderEvidence(run) {
  const verification = assertSegmentContinuityRenderEvidence(run);
  const binding = run.artifacts?.["render_report.json"]?.metadata?.segmentContinuity ?? null;
  return {
    verification,
    binding,
    artifactMetadata: {
      segmentContinuity: binding,
      sourceArtifactRefs: verification.required ? ["segment_stitch_plan.json", "boundary_continuity_report.json"] : []
    }
  };
}

export function parseSsim(output) {
  const matches = [...String(output ?? "").matchAll(/All:([0-9]+(?:\.[0-9]+)?)/g)];
  const value = Number(matches.at(-1)?.[1]);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("FFmpeg SSIM output did not contain a valid All score.");
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function measureSsim(sourcePath, targetPath, options) {
  const args = ["-hide_banner", "-i", sourcePath, "-i", targetPath, "-lavfi", "[0:v]scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2,format=gray[a];[1:v]scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2,format=gray[b];[a][b]ssim", "-f", "null", "-"];
  const result = await options.runFn(options.command, options.args ?? args, { cwd: options.cwd, timeoutMs: options.timeoutMs, maxOutputBytes: 300_000, failureLabel: "Boundary SSIM audit" });
  return parseSsim(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

function inputProcessOptions(projectPath, options) {
  return { runFn: options.runFn ?? runProcess, command: options.ffmpegCommand ?? "ffmpeg", args: options.ssimArgs, cwd: resolve(projectPath), timeoutMs: options.timeoutMs ?? 120000 };
}

function validateHandoff(handoff, segmentId, planMinimum) {
  if (!handoff || typeof handoff !== "object") throw new Error(`${segmentId} needs an explicit handoff contract.`);
  for (const field of ["matchPolicy", "cameraContinuity", "subjectContinuity", "environmentContinuity", "motionContinuity", "audioBridge"]) if (!String(handoff[field] ?? "").trim()) throw new Error(`${segmentId}.handoff.${field} is required.`);
  if (!Array.isArray(handoff.acceptanceCriteria) || !handoff.acceptanceCriteria.length) throw new Error(`${segmentId}.handoff.acceptanceCriteria must be non-empty.`);
  const threshold = handoff.minimumSsim ?? planMinimum ?? DEFAULT_MINIMUM_SSIM;
  if (!Number.isFinite(threshold) || threshold < 0.4 || threshold > 1) throw new Error(`${segmentId}.handoff.minimumSsim must be between 0.4 and 1.`);
}

function validateBoundaryReview(review, fromSegmentId, toSegmentId) {
  if (!review) throw new Error(`A director boundary review is required for ${fromSegmentId} -> ${toSegmentId}.`);
  for (const field of ["subjectContinuity", "cameraContinuity", "motionContinuity", "environmentContinuity", "audioContinuity"]) if (!REVIEW_STATES.has(review[field])) throw new Error(`${fromSegmentId} -> ${toSegmentId} requires ${field}=passed|failed.`);
  if (!Array.isArray(review.evidenceRefs) || !review.evidenceRefs.length) throw new Error(`${fromSegmentId} -> ${toSegmentId} requires evidenceRefs.`);
  if (!String(review.notes ?? "").trim()) throw new Error(`${fromSegmentId} -> ${toSegmentId} requires review notes.`);
}

function selectedVideoForRequest(run, requestId) {
  return (run.generation?.candidates ?? []).find((candidate) => candidate.requestId === requestId && candidate.status === "selected" && candidate.mediaType === "video");
}

async function frameRecord(projectPath, artifactRef, path, timeSeconds) {
  const bytes = await readFile(path);
  return { artifactRef, path, relativePath: relative(resolve(projectPath), path), fileName: basename(path), timeSeconds, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function assertNonEmptyFile(path, label) {
  const details = await stat(path);
  if (!details.isFile() || details.size <= 0) throw new Error(`FFmpeg did not produce a non-empty ${label}.`);
}

async function fileSha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function writeDocuments(root, documents) {
  await mkdir(root, { recursive: true });
  const results = {};
  for (const [artifactRef, value] of Object.entries(documents)) {
    const path = join(root, artifactRef);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    results[artifactRef] = { artifactRef, path };
  }
  return results;
}

function artifactRoot(projectPath, runId) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId ?? "")) throw new Error("Invalid Director X run ID.");
  return containedPath(projectPath, `.directorx/plugin-runs/${runId}/artifacts`);
}

function containedPath(projectPath, path) {
  const root = resolve(projectPath);
  const absolute = resolve(root, path);
  const relation = relative(root, absolute);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Segment continuity paths must stay inside the project workspace.");
  return absolute;
}
