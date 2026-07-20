import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const REFERENCE_KINDS = new Set(["finished_film", "behind_the_scenes", "tutorial", "showcase_collection"]);
const EVIDENCE_LEVELS = new Set(["official_page", "official_video_metadata", "curated_structure"]);

export async function loadBundledCinematicReferences() {
  const value = JSON.parse(await readFile(new URL("../knowledge/cinematic-reference-library.json", import.meta.url), "utf8"));
  return compileCinematicReferenceLibrary(value);
}

export function compileCinematicReferenceLibrary(input) {
  if (!input?.libraryId?.trim() || !Array.isArray(input.entries) || input.entries.length < 1) {
    throw new Error("Cinematic reference library requires libraryId and entries.");
  }
  const ids = new Set();
  const entries = input.entries.map((entry, index) => {
    if (!entry?.referenceId?.trim() || ids.has(entry.referenceId)) {
      throw new Error(`Cinematic reference ${index + 1} requires a unique referenceId.`);
    }
    ids.add(entry.referenceId);
    if (!REFERENCE_KINDS.has(entry.kind)) throw new Error(`${entry.referenceId} has an unsupported reference kind.`);
    if (!entry.title?.trim() || !entry.source?.publisher?.trim() || !isHttps(entry.source.url)) {
      throw new Error(`${entry.referenceId} requires a title, publisher, and HTTPS source URL.`);
    }
    if (!EVIDENCE_LEVELS.has(entry.evidenceLevel)) throw new Error(`${entry.referenceId} requires an evidence level.`);
    if (entry.rights?.scope !== "reference_only" || entry.rights.deliveryReuseAllowed !== false) {
      throw new Error(`${entry.referenceId} must remain reference-only and blocked from delivery reuse.`);
    }
    if (!entry.rights.localAnalysisRequiresConsent || !entry.rights.blockedReuse?.length) {
      throw new Error(`${entry.referenceId} requires local-analysis consent and blocked reuse rules.`);
    }
    if (!entry.structure?.hook?.trim() || !entry.structure?.progression?.trim() || !entry.structure?.payoff?.trim()) {
      throw new Error(`${entry.referenceId} requires hook, progression, and payoff structure.`);
    }
    if (!Array.isArray(entry.transferRules) || !entry.transferRules.length) {
      throw new Error(`${entry.referenceId} requires transferable directing rules.`);
    }
    const transferRules = entry.transferRules.map((rule, ruleIndex) => {
      if (!rule?.ruleId?.trim() || !rule.instruction?.trim() || !rule.evidenceLocator?.trim() || !rule.appliesTo?.length) {
        throw new Error(`${entry.referenceId} transfer rule ${ruleIndex + 1} is incomplete.`);
      }
      return {
        ruleId: rule.ruleId,
        instruction: rule.instruction.trim(),
        evidenceLocator: rule.evidenceLocator.trim(),
        appliesTo: unique(rule.appliesTo)
      };
    });
    return {
      referenceId: entry.referenceId,
      title: entry.title.trim(),
      kind: entry.kind,
      evidenceLevel: entry.evidenceLevel,
      source: {
        publisher: entry.source.publisher.trim(),
        url: entry.source.url,
        sourceType: entry.source.sourceType ?? "web",
        accessedAt: entry.source.accessedAt
      },
      rights: {
        scope: "reference_only",
        deliveryReuseAllowed: false,
        localAnalysisRequiresConsent: true,
        blockedReuse: unique(entry.rights.blockedReuse)
      },
      videoTypes: unique(entry.videoTypes),
      platforms: unique(entry.platforms),
      shotFunctions: unique(entry.shotFunctions),
      remotionTechniques: unique(entry.remotionTechniques),
      searchTerms: unique(entry.searchTerms),
      structure: {
        hook: entry.structure.hook.trim(),
        progression: entry.structure.progression.trim(),
        proof: String(entry.structure.proof ?? "").trim(),
        payoff: entry.structure.payoff.trim()
      },
      shotGrammar: unique(entry.shotGrammar),
      audioGrammar: unique(entry.audioGrammar),
      transferRules,
      antiPatterns: unique(entry.antiPatterns),
      requiresTimecodedIngestForReplication: entry.requiresTimecodedIngestForReplication !== false
    };
  });
  return {
    schemaVersion: "1.0",
    libraryId: input.libraryId,
    revision: input.revision,
    entries,
    entryCount: entries.length
  };
}

export function queryCinematicReferences(library, query) {
  const limit = Number.isInteger(query.limit) ? Math.max(1, Math.min(12, query.limit)) : 5;
  const terms = unique([
    ...(query.videoTypes ?? []),
    ...(query.platforms ?? []),
    ...(query.shotFunctions ?? []),
    ...(query.remotionTechniques ?? []),
    ...String(query.text ?? "").toLowerCase().split(/[^\p{L}\p{N}_-]+/u)
  ]).map((value) => value.toLowerCase());
  if (!terms.length) {
    throw new Error("Cinematic reference query requires text, video types, platforms, shot functions, or Remotion techniques.");
  }
  const matches = library.entries.map((entry) => {
    const tags = [
      ...entry.videoTypes,
      ...entry.platforms,
      ...entry.shotFunctions,
      ...entry.remotionTechniques,
      ...entry.searchTerms
    ].map((value) => value.toLowerCase());
    const fields = [
      entry.title,
      entry.structure.hook,
      entry.structure.progression,
      entry.structure.proof,
      entry.structure.payoff,
      ...entry.shotGrammar,
      ...entry.audioGrammar,
      ...entry.transferRules.flatMap((rule) => [rule.instruction, ...rule.appliesTo]),
      ...entry.antiPatterns,
      ...tags
    ].map((value) => value.toLowerCase());
    const matchedTerms = terms.filter((term) => fields.some((field) => field.includes(term)));
    const exactTags = terms.filter((term) => tags.includes(term));
    return {
      entry,
      matchedTerms: unique(matchedTerms),
      score: exactTags.length * 4 + matchedTerms.length
    };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.referenceId.localeCompare(right.entry.referenceId))
    .slice(0, limit);

  return {
    schemaVersion: "1.0",
    libraryId: library.libraryId,
    query: { ...query, terms },
    matches: matches.map(({ entry, matchedTerms, score }) => ({
      referenceId: entry.referenceId,
      title: entry.title,
      kind: entry.kind,
      evidenceLevel: entry.evidenceLevel,
      score,
      matchedTerms,
      source: entry.source,
      rights: entry.rights,
      structure: entry.structure,
      shotGrammar: entry.shotGrammar,
      audioGrammar: entry.audioGrammar,
      transferRules: entry.transferRules,
      antiPatterns: entry.antiPatterns,
      requiresTimecodedIngestForReplication: entry.requiresTimecodedIngestForReplication
    })),
    stopReason: matches.length ? "reference_patterns_found" : "no_matching_reference",
    useBoundary: "Search results provide directing patterns only. Timecoded replication requires native consent, bounded local ingest, all-frame evidence, and a new originality-safe blueprint."
  };
}

export function compileCinematicReferenceSelection(library, input) {
  if (!input?.selectionId?.trim() || !input.videoType?.trim()) {
    throw new Error("Cinematic reference selection requires selectionId and videoType.");
  }
  const selectedIds = unique(input.selectedReferenceIds);
  if (!selectedIds.length) throw new Error("Cinematic reference selection requires at least one selected reference.");
  const selected = selectedIds.map((referenceId) => {
    const entry = library.entries.find((candidate) => candidate.referenceId === referenceId);
    if (!entry) throw new Error(`Unknown cinematic reference: ${referenceId}`);
    return entry;
  });
  const requiredShotFunctions = unique(input.requiredShotFunctions);
  const coveredShotFunctions = unique(selected.flatMap((entry) => entry.shotFunctions));
  const missingShotFunctions = requiredShotFunctions.filter((item) => !coveredShotFunctions.includes(item));
  const remotionRequired = input.remotionRequired === true;
  const remotionTechniques = unique(selected.flatMap((entry) => entry.remotionTechniques));
  const blockers = [
    ...missingShotFunctions.map((item) => `missing_shot_function:${item}`),
    ...(remotionRequired && !remotionTechniques.length ? ["missing_remotion_technique"] : [])
  ];
  const bindings = selected.flatMap((entry) => entry.transferRules.map((rule) => ({
    referenceId: entry.referenceId,
    ruleId: rule.ruleId,
    instruction: rule.instruction,
    evidenceLocator: rule.evidenceLocator,
    targets: rule.appliesTo
  })));
  return {
    schemaVersion: "1.0",
    selectionId: input.selectionId,
    libraryId: library.libraryId,
    libraryRevision: library.revision,
    sourceRunId: input.runId,
    videoType: input.videoType,
    platform: String(input.platform ?? "").trim(),
    status: blockers.length ? "blocked" : "ready",
    requiredShotFunctions,
    coveredShotFunctions,
    missingShotFunctions,
    remotionRequired,
    remotionTechniques,
    selectedReferences: selected.map((entry) => ({
      referenceId: entry.referenceId,
      title: entry.title,
      kind: entry.kind,
      evidenceLevel: entry.evidenceLevel,
      source: entry.source,
      rights: entry.rights,
      structure: entry.structure,
      shotGrammar: entry.shotGrammar,
      audioGrammar: entry.audioGrammar,
      antiPatterns: entry.antiPatterns,
      requiresTimecodedIngestForReplication: entry.requiresTimecodedIngestForReplication
    })),
    bindings,
    blockers,
    useBoundary: "Bindings may shape Director.md, style, script, shots, and Remotion composition. Indexed source media remains reference-only and cannot enter generation anchors or delivery.",
    compiledAt: new Date().toISOString()
  };
}

export async function writeCinematicReferenceSelection({ projectPath, runId, selection }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const jsonArtifactRef = "cinematic_reference_selection.json";
  const jsonPath = join(directory, jsonArtifactRef);
  const markdownArtifactRef = "cinematic_reference_selection.md";
  const markdownPath = join(directory, markdownArtifactRef);
  await writeFile(jsonPath, `${JSON.stringify(selection, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(markdownPath, cinematicReferenceMarkdown(selection), { encoding: "utf8", mode: 0o600 });
  return {
    selection: { artifactRef: jsonArtifactRef, path: jsonPath },
    summary: { artifactRef: markdownArtifactRef, path: markdownPath }
  };
}

function cinematicReferenceMarkdown(selection) {
  return [
    "# 影视范例与导演迁移规则",
    "",
    `- 片型：${selection.videoType}`,
    `- 平台：${selection.platform || "未指定"}`,
    `- 状态：${selection.status}`,
    "",
    "## 选定范例",
    "",
    ...selection.selectedReferences.flatMap((entry) => [
      `### ${entry.title}`,
      "",
      `- 来源：${entry.source.publisher} · ${entry.source.url}`,
      `- Hook：${entry.structure.hook}`,
      `- 推进：${entry.structure.progression}`,
      `- 证明：${entry.structure.proof || "无单独证明段"}`,
      `- 回报：${entry.structure.payoff}`,
      `- 镜头语法：${entry.shotGrammar.join("、")}`,
      `- 声音语法：${entry.audioGrammar.join("、")}`,
      `- 禁止复用：${entry.rights.blockedReuse.join("、")}`,
      ""
    ]),
    "## 写入 Director 与制作链的规则",
    "",
    ...selection.bindings.map((binding) => `- [${binding.referenceId}] ${binding.instruction} → ${binding.targets.join("、")}`),
    "",
    "## 边界",
    "",
    `- ${selection.useBoundary}`,
    ...selection.blockers.map((blocker) => `- 阻塞：${blocker}`)
  ].join("\n");
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean))];
}

function isHttps(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
