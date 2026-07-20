import { readFile } from "node:fs/promises";

const ENTRY_KINDS = new Set([
  "official_model_guide",
  "official_platform_guide",
  "filmmaking_tutorial",
  "production_exemplar",
  "rendering_guide"
]);
const RIGHTS_SCOPES = new Set(["facts_and_methods", "reference_only", "licensed_reuse"]);

export async function loadBundledDirectorKnowledge() {
  const value = JSON.parse(await readFile(new URL("../knowledge/director-knowledge-seed.json", import.meta.url), "utf8"));
  return compileDirectorKnowledgeLibrary(value);
}

export function compileDirectorKnowledgeLibrary(input) {
  if (!input?.libraryId?.trim() || !Array.isArray(input.entries) || !input.entries.length) {
    throw new Error("Director knowledge library requires libraryId and entries.");
  }
  const ids = new Set();
  const entries = input.entries.map((entry) => {
    if (!entry?.entryId?.trim() || ids.has(entry.entryId)) throw new Error("Knowledge entry IDs must be present and unique.");
    ids.add(entry.entryId);
    if (!ENTRY_KINDS.has(entry.kind)) throw new Error(`${entry.entryId} has an unsupported knowledge kind.`);
    if (!entry.title?.trim() || !entry.source?.publisher?.trim() || !isHttps(entry.source.url)) {
      throw new Error(`${entry.entryId} requires a title, publisher, and HTTPS source URL.`);
    }
    if (!RIGHTS_SCOPES.has(entry.rights?.scope)) throw new Error(`${entry.entryId} requires an explicit rights scope.`);
    if (!entry.rights.blockedReuse?.length) throw new Error(`${entry.entryId} must name blocked reuse.`);
    if (!Array.isArray(entry.principles) || !entry.principles.length) throw new Error(`${entry.entryId} requires evidence-grounded principles.`);
    const principles = entry.principles.map((principle, index) => {
      if (!principle?.principleId?.trim() || !principle.claim?.trim() || !principle.evidenceLocator?.trim() || !principle.transferRule?.trim()) {
        throw new Error(`${entry.entryId} principle ${index + 1} requires ID, claim, evidence locator, and transfer rule.`);
      }
      return {
        principleId: principle.principleId,
        claim: principle.claim.trim(),
        evidenceLocator: principle.evidenceLocator.trim(),
        transferRule: principle.transferRule.trim(),
        appliesTo: unique(principle.appliesTo)
      };
    });
    return {
      entryId: entry.entryId,
      kind: entry.kind,
      title: entry.title.trim(),
      source: {
        publisher: entry.source.publisher.trim(),
        url: entry.source.url,
        sourceType: entry.source.sourceType ?? "web",
        accessedAt: entry.source.accessedAt
      },
      rights: {
        scope: entry.rights.scope,
        deliveryReuseAllowed: entry.rights.deliveryReuseAllowed === true,
        blockedReuse: unique(entry.rights.blockedReuse)
      },
      topics: unique(entry.topics),
      modelModes: unique(entry.modelModes),
      shotFunctions: unique(entry.shotFunctions),
      principles,
      antiPatterns: unique(entry.antiPatterns)
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

export function queryDirectorKnowledge(library, query) {
  const limit = Number.isInteger(query.limit) ? Math.max(1, Math.min(20, query.limit)) : 6;
  const terms = unique([
    ...(query.topics ?? []),
    ...(query.modelModes ?? []),
    ...(query.shotFunctions ?? []),
    ...String(query.text ?? "").toLowerCase().split(/[^\p{L}\p{N}_-]+/u)
  ]).map((value) => value.toLowerCase());
  if (!terms.length) throw new Error("Director knowledge query requires text, topics, model modes, or shot functions.");
  const matches = library.entries.map((entry) => {
    const fields = [
      entry.title,
      ...entry.topics,
      ...entry.modelModes,
      ...entry.shotFunctions,
      ...entry.principles.flatMap((principle) => [principle.claim, principle.transferRule, ...principle.appliesTo])
    ].map((value) => value.toLowerCase());
    const matchedTerms = terms.filter((term) => fields.some((field) => field.includes(term)));
    const exactTags = terms.filter((term) => [...entry.topics, ...entry.modelModes, ...entry.shotFunctions].some((tag) => tag.toLowerCase() === term));
    return {
      entry,
      score: exactTags.length * 3 + matchedTerms.length,
      matchedTerms: unique(matchedTerms)
    };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.entryId.localeCompare(right.entry.entryId))
    .slice(0, limit);
  return {
    schemaVersion: "1.0",
    libraryId: library.libraryId,
    query: { ...query, terms },
    matches: matches.map(({ entry, score, matchedTerms }) => ({
      entryId: entry.entryId,
      title: entry.title,
      kind: entry.kind,
      score,
      matchedTerms,
      source: entry.source,
      rights: entry.rights,
      principles: entry.principles,
      antiPatterns: entry.antiPatterns
    })),
    stopReason: matches.length ? "evidence_sufficient" : "no_matching_knowledge"
  };
}

export function mergeDirectorKnowledgeLibraries(...libraries) {
  const entries = [];
  const seen = new Set();
  for (const library of libraries.filter(Boolean)) for (const entry of library.entries ?? []) {
    if (seen.has(entry.entryId)) continue;
    seen.add(entry.entryId);
    entries.push(entry);
  }
  return {
    schemaVersion: "1.0",
    libraryId: "directorx-effective-directing-knowledge",
    revision: libraries.map((library) => library?.revision).filter(Boolean).join("+") || "runtime",
    entries,
    entryCount: entries.length
  };
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function isHttps(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
