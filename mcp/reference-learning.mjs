import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileDirectorKnowledgeLibrary } from "./director-knowledge-library.mjs";

export function compileReferenceLearningCandidate(run, input, now = new Date().toISOString()) {
  if (!input?.candidateId?.trim() || !input.title?.trim()) throw new Error("Reference learning requires candidateId and title.");
  const reference = (run.references ?? []).find((item) => item.referenceId === input.referenceId);
  if (!reference) throw new Error(`Unknown reference: ${input.referenceId}`);
  if (reference.fullFrameCoverage?.passed !== true || !reference.fullFrameManifestArtifactRef || !reference.frameIdentityArtifactRef) {
    throw new Error("Reference learning requires passing all-decoded-frame extraction, frame manifest, and PTS identity evidence.");
  }
  if (reference.rightsStatus !== "reference_only") throw new Error("Reference learning candidates must preserve reference_only rights.");
  if (input.reviewerId !== "DX-Reference-Analyst") throw new Error("Reference learning requires DX-Reference-Analyst ownership.");
  if (!Array.isArray(input.observations) || !input.observations.length) throw new Error("Reference learning requires timecoded observations.");
  const frameCount = reference.fullFrameCoverage.extractedFrameCount;
  const principleIds = new Set();
  const principles = input.observations.map((observation, index) => {
    if (!observation?.principleId?.trim() || principleIds.has(observation.principleId)) throw new Error("Reference learning principle IDs must be present and unique.");
    principleIds.add(observation.principleId);
    const frameIndices = uniqueIntegers(observation.evidenceFrameIndices);
    if (frameIndices.length < 2 || frameIndices.some((value) => value < 0 || value >= frameCount)) {
      throw new Error(`${observation.principleId} requires at least two valid full-frame evidence indices.`);
    }
    if (!finiteRange(observation.startSeconds, observation.endSeconds, reference.analysisSection?.maxSeconds)) {
      throw new Error(`${observation.principleId} requires a bounded source time range.`);
    }
    if (!observation.claim?.trim() || !observation.transferRule?.trim() || !observation.originalityRule?.trim()) {
      throw new Error(`${observation.principleId} requires claim, transfer rule, and originality rule.`);
    }
    return {
      principleId: observation.principleId,
      claim: observation.claim.trim(),
      evidenceLocator: `time ${observation.startSeconds.toFixed(3)}-${observation.endSeconds.toFixed(3)}s; frames ${frameIndices.join(",")}`,
      evidenceFrameIndices: frameIndices,
      timeRangeSeconds: { start: observation.startSeconds, end: observation.endSeconds },
      transferRule: observation.transferRule.trim(),
      originalityRule: observation.originalityRule.trim(),
      appliesTo: uniqueStrings(observation.appliesTo)
    };
  });
  if (!input.blockedReuse?.length) throw new Error("Reference learning must explicitly block source creative reuse.");
  return {
    schemaVersion: "1.0",
    candidateId: input.candidateId,
    status: "awaiting_native_approval",
    referenceId: reference.referenceId,
    title: input.title,
    reviewerId: input.reviewerId,
    source: { url: reference.sourceUrl, sourceType: "authorized_reference_video" },
    evidence: {
      clipArtifactRef: reference.clipArtifactRef,
      fullFrameManifestArtifactRef: reference.fullFrameManifestArtifactRef,
      frameIdentityArtifactRef: reference.frameIdentityArtifactRef,
      audioArtifactRef: reference.audioArtifactRef,
      fullFrameCoverage: reference.fullFrameCoverage
    },
    rights: {
      scope: "reference_only",
      deliveryReuseAllowed: false,
      blockedReuse: uniqueStrings(input.blockedReuse)
    },
    topics: uniqueStrings(input.topics),
    modelModes: uniqueStrings(input.modelModes),
    shotFunctions: uniqueStrings(input.shotFunctions),
    principles,
    antiPatterns: uniqueStrings(input.antiPatterns),
    createdAt: now
  };
}

export function promoteReferenceLearningCandidate(run, input, resolvedInteraction, now = new Date().toISOString()) {
  const candidate = run.referenceLearningCandidates?.[input.candidateId];
  if (!candidate || candidate.status !== "awaiting_native_approval") throw new Error("Promote an awaiting reference learning candidate.");
  if (resolvedInteraction?.kind !== "knowledge" || resolvedInteraction.confirmedBy !== "request_user_input") {
    throw new Error("Reference knowledge promotion requires a resolved native knowledge interaction.");
  }
  const answer = String(resolvedInteraction.answers?.promote_reference_learning ?? "");
  if (!answer.startsWith("加入项目知识库")) throw new Error("The user did not approve project knowledge promotion.");
  candidate.status = "promoted";
  candidate.promotedAt = now;
  candidate.interactionRequestId = resolvedInteraction.requestId;
  return candidate;
}

export async function writeReferenceLearningCandidate({ projectPath, runId, candidate }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `reference_learning_candidate.${candidate.candidateId}.json`);
  await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: `reference_learning_candidate.${candidate.candidateId}.json`, path };
}

export async function readProjectDirectorKnowledge(projectPath) {
  const path = resolve(projectPath, ".directorx", "knowledge", "director-knowledge.json");
  try { return compileDirectorKnowledgeLibrary(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: "1.0", libraryId: "directorx-project-knowledge", revision: "empty", entries: [], entryCount: 0 };
    throw error;
  }
}

export async function writePromotedProjectKnowledge({ projectPath, candidate }) {
  const current = await readProjectDirectorKnowledge(projectPath);
  if (current.entries.some((entry) => entry.entryId === candidate.candidateId)) throw new Error("Project knowledge already contains this candidate.");
  const value = compileDirectorKnowledgeLibrary({
    libraryId: current.libraryId,
    revision: candidate.promotedAt,
    entries: [...current.entries, {
      entryId: candidate.candidateId,
      kind: "production_exemplar",
      title: candidate.title,
      source: { ...candidate.source, publisher: "Authorized reference", accessedAt: candidate.createdAt },
      rights: candidate.rights,
      topics: candidate.topics,
      modelModes: candidate.modelModes,
      shotFunctions: candidate.shotFunctions,
      principles: candidate.principles,
      antiPatterns: candidate.antiPatterns
    }]
  });
  const directory = resolve(projectPath, ".directorx", "knowledge");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "director-knowledge.json");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "project_director_knowledge.json", path, value };
}

function finiteRange(start, end, maximum) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && (!Number.isFinite(maximum) || end <= maximum + 0.001);
}
function uniqueIntegers(values) { return [...new Set((values ?? []).filter(Number.isInteger))].sort((a, b) => a - b); }
function uniqueStrings(values) { return [...new Set((values ?? []).filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))]; }
