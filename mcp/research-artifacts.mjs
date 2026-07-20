import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertSafeRemoteUrl } from "./web-image-assets.mjs";

const RESEARCH_TOOLS = new Set(["web.search_query", "web.open", "browser.search", "browser.open"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_SOURCE_SAMPLE_BYTES = 256 * 1024;

export async function writeWebResearch({ projectPath, runId, research }, options = {}) {
  if (!research.sources.some((source) => ["official", "authoritative"].includes(source.sourceType))) throw new Error("Web research requires at least one official or authoritative source.");
  validateResearchExecutions(research);
  const verifiedSources = await Promise.all(research.sources.map((source) => verifyResearchSource(source, options)));
  if (!verifiedSources.some((source) => ["official", "authoritative"].includes(source.sourceType) && source.verification.status === "verified")) throw new Error("Web research requires at least one currently reachable official or authoritative source page.");
  const artifact = { schemaVersion: "1.0", runId, recordedAt: new Date().toISOString(), ...research, sources: verifiedSources, executionPolicy: "host search/open receipt plus plugin HTTPS source verification" };
  return { ...(await writeJson(projectPath, runId, options.artifactRef ?? "web_research_receipt.json", artifact)), research: artifact };
}

export async function writeReferenceVideoAssessment({ projectPath, runId, assessment }) {
  const artifact = { schemaVersion: "1.0", runId, recordedAt: new Date().toISOString(), ...assessment };
  return await writeJson(projectPath, runId, "reference_video_assessment.json", artifact);
}

export async function writeReferenceDownloadConsent({ projectPath, runId, consent }) {
  const artifact = { schemaVersion: "1.0", runId, recordedAt: new Date().toISOString(), ...consent };
  return await writeJson(projectPath, runId, "reference_download_consent.json", artifact);
}

export async function writeResearchPackage({ projectPath, runId, package: input, run }) {
  const validation = validateResearchPackage(run, input);
  if (!validation.valid) throw new Error(`Research package validation failed:\n- ${validation.errors.join("\n- ")}`);
  const sourceRecords = run.webResearch.sources;
  const assets = run.assets;
  const referenceRecords = sourceRecords.map((source) => ({ reference_id: source.id, source_type: source.sourceType, uri: source.url, rights_status: source.rightsStatus, usage_scope: source.intendedUse, local_asset_path: source.previewUri ?? "" }));
  const rightsItems = assets.map((asset) => ({ item_id: `RIGHT-${asset.id}`, asset_ref: asset.id, rights_status: asset.rightsStatus, allowed_use: asset.intendedUse, evidence_ref: asset.licenseEvidence ?? asset.sourceUrl }));
  const artifacts = {
    "research_plan.json": { research_plan_id: `RP-${runId}`, source_artifact_run_id: runId, research_questions: input.researchQuestions.map((question, index) => ({ question_id: `RQ-${index + 1}`, topic: "production_research", decision_unblocked: question })), source_policy: input.sourcePolicy, queries: run.webResearch.queries.map((query, index) => ({ query_id: `Q-${index + 1}`, topic: "web_research", query, target_output: "reference_analysis.json" })), expected_artifacts: ["reference_manifest.json", "reference_analysis.json", "asset_manifest.json", "rights_ledger.json"].map((artifactName) => ({ artifact_name: artifactName, producer: "directorx-reference-intake", acceptance: "source-backed and rights-aware" })) },
    "reference_manifest.json": { reference_manifest_id: `RM-${runId}`, source_artifact_run_id: runId, records: referenceRecords, video_assessment: run.referenceVideoAssessment, ingested_references: run.references ?? [], asset_search_plan_ref: run.assetSearchPlan ? "asset_search_plan.json" : null, quality_audit_refs: Object.values(run.assetQualityAudits ?? {}).map((audit) => `asset_quality_audit_${String(audit.assetRef).toLowerCase().replace(/[^a-z0-9._-]/g, "-")}.json`), handoff_rules: input.handoffRules.map((rule, index) => ({ rule_id: `HR-${index + 1}`, applies_to: "downstream production", action: rule })) },
    "reference_analysis.json": { reference_analysis_id: `RA-${runId}`, source_artifact_run_id: runId, sources: sourceRecords.map((source) => ({ source_id: source.id, source_type: source.sourceType, uri: source.url, rights_status: source.rightsStatus, use_allowed_for: [source.intendedUse] })), findings: input.factualFindings.map((finding, index) => ({ finding_id: finding.finding_id ?? `F-${index + 1}`, topic: finding.topic ?? "research", observation: finding.observation ?? JSON.stringify(finding), evidence: finding.evidence ?? sourceRecords[0].id })), transferable_patterns: input.transferablePatterns.map((pattern, index) => ({ pattern_id: pattern.pattern_id ?? `P-${index + 1}`, pattern: pattern.pattern ?? JSON.stringify(pattern), directorx_use: pattern.directorx_use ?? "original production adaptation" })), blocked_uses: input.blockedReuse.map((reason, index) => ({ block_id: `B-${index + 1}`, reason, replacement_rule: "generate or license an original replacement" })) },
    "reference_learning_report.json": { reference_learning_report_id: `RLR-${runId}`, source_artifact_run_id: runId, assessment: run.referenceVideoAssessment, authorization: run.referenceDownloadConsent ?? { decision: "not_requested" }, ingested_reference_ids: (run.references ?? []).map((item) => item.referenceId), ...input.referenceLearning },
    "asset_manifest.json": { asset_manifest_id: `AM-${runId}`, source_artifact_run_id: runId, required_assets: assets.map((asset) => ({ asset_id: asset.id, role: asset.intendedUse, category: asset.technicalRequirements?.category ?? asset.type, source_route: asset.sourceUrl, source_image_url: asset.sourceImageUrl ?? null, local_asset_path: asset.previewUri ?? asset.localPath ?? null, artifact_ref: asset.artifactRef ?? null, rights_status: asset.rightsStatus, technical_requirements: asset.technicalRequirements ?? {}, quality_audit: Object.values(run.assetQualityAudits ?? {}).find((audit) => [audit.assetRef, audit.artifactRef].includes(asset.id) || [audit.assetRef, audit.artifactRef].includes(asset.artifactRef)) ?? null, fallback: { replacement: asset.fallback } })), source_priority: input.sourcePriority.map((route, index) => ({ rank: index + 1, source_route: route, use_for: "production assets", rights_requirement: input.rightsPolicy })), license_evidence: assets.map((asset) => ({ evidence_id: `LE-${asset.id}`, asset_id: asset.id, rights_status: asset.rightsStatus, source_uri: asset.sourceUrl, local_asset_path: asset.previewUri ?? asset.localPath ?? null, license_label: asset.licenseEvidence ?? "unverified", verification_status: ["unknown", "blocked"].includes(asset.rightsStatus) ? "blocked" : "recorded" })), visual_asset_coverage_ref: run.visualAssetCoverage ? "visual_asset_coverage.json" : null, asset_search_plan_ref: run.assetSearchPlan ? "asset_search_plan.json" : null, rights_policy: input.rightsPolicy, readiness_summary: input.readinessSummary },
    "rights_ledger.json": { rights_ledger_id: `RL-${runId}`, source_artifact_run_id: runId, items: rightsItems, risk_register: rightsRisks(assets), release_requirements: [{ requirement_id: "REL-1", subject: "all delivery assets", required_before: "render export", owner: "asset_manager" }], release_gate: input.rightsReleaseGate },
    "style_playbook.json": { style_playbook_id: `SP-${runId}`, source_artifact_run_id: runId, ...input.stylePlaybook }
  };
  const results = {};
  for (const [artifactRef, value] of Object.entries(artifacts)) results[artifactRef] = await writeJson(projectPath, runId, artifactRef, value);
  return results;
}

export function validateResearchPackage(run, input = {}) {
  const errors = [];
  if (!run.webResearch?.sources?.length) errors.push("Record web research before finalizing the research package.");
  if (!run.webResearch?.executions?.some((item) => item.action === "search") || !run.webResearch?.executions?.some((item) => item.action === "open")) errors.push("Research requires recorded host search and source-open actions.");
  if (!run.webResearch?.sources?.some((source) => ["official", "authoritative"].includes(source.sourceType) && source.verification?.status === "verified")) errors.push("Research requires a plugin-verified current official or authoritative source page.");
  if (!run.referenceVideoAssessment) errors.push("Record a reference video assessment before finalizing research.");
  if (!run.assets?.length) errors.push("Register at least one production or reference asset before finalizing research.");
  if (run.researchAssetPolicy?.requireSearchPlan === true && !run.assetSearchPlan) errors.push("Call directorx_register_asset_search_plan before finalizing research.");
  if (run.researchAssetPolicy?.requireLocalVisuals === true && !(run.assets ?? []).some((asset) => ["image", "logo", "reference_frame"].includes(asset.type) && asset.localPath)) errors.push("Acquire and register at least one real local image, logo, or reference frame before finalizing research.");
  if (run.researchAssetPolicy?.requireCoverageAudit === true && !run.visualAssetCoverage) errors.push("Call directorx_audit_visual_asset_coverage before finalizing research.");
  if (run.visualAssetCoverage && run.visualAssetCoverage.status !== "ready") errors.push(`Visual asset coverage is blocked: ${run.visualAssetCoverage.missingCategories.join(", ")}`);
  if (run.researchAssetPolicy?.requireQualityAudit === true) {
    const audits = Object.values(run.assetQualityAudits ?? {});
    const requiredRefs = new Set([...(run.visualAssetCoverage?.verifiedVisualAssets ?? []).flatMap((item) => [item.id, item.artifactRef]), ...(run.references ?? []).flatMap((item) => [item.referenceId, item.clipArtifactRef])].filter(Boolean));
    for (const assetRef of requiredRefs) if (!audits.some((audit) => audit.status === "ready" && [audit.assetRef, audit.artifactRef].includes(assetRef))) errors.push(`Asset ${assetRef} requires a ready DX-Asset-Manager quality audit before research finalization.`);
  }
  for (const field of ["researchQuestions", "handoffRules", "transferablePatterns", "factualFindings", "sourcePriority"]) requireNonEmptyArray(input, field, errors);
  const sourceIds = new Set((run.webResearch?.sources ?? []).map((source) => source.id));
  for (const [index, finding] of (input.factualFindings ?? []).entries()) if (!sourceIds.has(finding?.evidence)) errors.push(`factualFindings[${index}].evidence must reference a recorded source ID.`);
  for (const field of ["sourcePolicy", "rightsPolicy"]) if (!String(input[field] ?? "").trim()) errors.push(`${field} is required.`);
  for (const field of ["blockedReuse"]) if (!Array.isArray(input[field])) errors.push(`${field} must be an array.`);
  for (const field of ["readinessSummary", "rightsReleaseGate"]) if (!input[field] || typeof input[field] !== "object" || Array.isArray(input[field])) errors.push(`${field} must be an object.`);
  if (run.referenceVideoAssessment?.decision === "required" && !run.references?.length) errors.push("The assessment requires reference video, but no ingested reference receipt exists.");
  if (run.references?.length && run.referenceDownloadConsent?.decision !== "authorized") errors.push("Ingested reference video requires recorded download authorization.");
  validateReferenceLearning(input.referenceLearning, run, errors);
  validateStylePlaybook(input.stylePlaybook, run.directorDocument, errors);
  return {
    valid: errors.length === 0,
    errors,
    directorBinding: {
      fingerprint: run.directorDocument?.fingerprint ?? null,
      availableDirectiveIds: run.directorDocument?.directiveIds ?? [],
      contractArtifactRef: run.directorDocument?.contractArtifactRef ?? "director_contract.json"
    }
  };
}

export function buildResearchPackageTemplate(run) {
  const rules = ["Replace with an evidence-backed production rule."];
  return {
    researchQuestions: ["Which current facts and references materially change the film?"],
    sourcePolicy: "Official and authoritative sources first; record rights and intended use.",
    handoffRules: ["Bind every finding to a downstream Director, script, shot, prompt, or rights decision."],
    transferablePatterns: [{ pattern: "Describe an observed pattern.", directorx_use: "Describe the original production adaptation." }],
    blockedReuse: ["Do not reuse source pixels, audio, subtitles, logos, or music without delivery rights."],
    factualFindings: [{ topic: "brand_or_product", observation: "Record a verified finding.", evidence: "source-id" }],
    referenceLearning: {
      analyzedReferenceIds: (run.references ?? []).map((item) => item.referenceId),
      observations: [{ evidence: "reference-id-or-assessment", observation: "Record a timecoded or source-backed observation." }],
      directorRules: [], styleUpdates: [], shotImpacts: [], blockedReuse: [], degradedRoute: null
    },
    sourcePriority: ["user_owned", "official", "licensed", "project_generated"],
    rightsPolicy: "Only rights-cleared production assets may enter delivery.",
    readinessSummary: { status: "draft", blockers: [] },
    rightsReleaseGate: { status: "pending", blockers: [] },
    stylePlaybook: {
      director_binding: { fingerprint: run.directorDocument?.fingerprint ?? "", inherited_directive_ids: run.directorDocument?.directiveIds ?? [], override_records: [] },
      style_thesis: "", visual_language: "", world_rules: rules, cinematography_rules: rules, lighting_color_rules: rules,
      performance_rules: rules, edit_rhythm_rules: rules, audio_rules: rules, subtitle_rules: rules, negative_style_rules: rules,
      evaluation_rules: rules, learning_policy: { promotion: "Promote only repeated or explicitly approved findings." }
    }
  };
}

function validateReferenceLearning(learning, run, errors) {
  if (!learning || typeof learning !== "object" || Array.isArray(learning)) {
    errors.push("referenceLearning must be an object.");
    learning = {};
  }
  if (!Array.isArray(learning.observations) || !learning.observations.length) errors.push("referenceLearning.observations must contain evidence-backed observations or a documented not-needed finding.");
  for (const field of ["directorRules", "styleUpdates", "shotImpacts", "blockedReuse"]) if (!Array.isArray(learning[field])) errors.push(`referenceLearning.${field} must be an array.`);
  if (run.referenceVideoAssessment?.decision === "required") {
    if (!learning.analyzedReferenceIds?.length) errors.push("Required reference video research must identify analyzedReferenceIds.");
    if (!learning.directorRules?.length) errors.push("Required reference video research must affect Director rules.");
    if (!learning.shotImpacts?.length) errors.push("Required reference video research must affect concrete shots.");
  }
}

function validateStylePlaybook(style, directorDocument, errors) {
  if (!style || typeof style !== "object" || Array.isArray(style)) {
    errors.push("stylePlaybook must be an object.");
    return;
  }
  for (const field of ["director_binding", "style_thesis", "visual_language", "world_rules", "cinematography_rules", "lighting_color_rules", "performance_rules", "edit_rhythm_rules", "audio_rules", "subtitle_rules", "negative_style_rules", "evaluation_rules", "learning_policy"]) if (!(field in style)) errors.push(`stylePlaybook.${field} is required.`);
  for (const field of ["world_rules", "cinematography_rules", "lighting_color_rules", "performance_rules", "edit_rhythm_rules", "audio_rules", "subtitle_rules", "negative_style_rules", "evaluation_rules"]) if (!Array.isArray(style[field]) || style[field].length === 0) errors.push(`stylePlaybook.${field} must be a non-empty array.`);
  if (!directorDocument?.fingerprint) errors.push("Generate Director.md and director_contract.json before finalizing style.");
  if (style.director_binding?.fingerprint !== directorDocument?.fingerprint) errors.push("stylePlaybook.director_binding.fingerprint must match the active Director contract.");
  if (!Array.isArray(style.director_binding?.inherited_directive_ids) || style.director_binding.inherited_directive_ids.length === 0) errors.push("stylePlaybook.director_binding.inherited_directive_ids must cite Director directives.");
}

function requireNonEmptyArray(input, field, errors) {
  if (!Array.isArray(input[field]) || input[field].length === 0) errors.push(`${field} must be a non-empty array.`);
}

function rightsRisks(assets) {
  const risks = assets.filter((asset) => ["unknown", "blocked", "reference_only"].includes(asset.rightsStatus)).map((asset) => ({ risk_id: `RISK-${asset.id}`, asset_ref: asset.id, risk: asset.rightsStatus, mitigation: asset.fallback }));
  return risks.length ? risks : [{ risk_id: "RISK-NONE", asset_ref: "all", risk: "no unresolved rights risk", mitigation: "retain license evidence through delivery" }];
}

async function writeJson(projectPath, runId, artifactRef, value) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Director X run ID.");
  const dir = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(dir, { recursive: true });
  const path = join(dir, artifactRef);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef, path };
}

function validateResearchExecutions(research) {
  if (!Array.isArray(research.executions) || research.executions.length < 2) throw new Error("Web research requires host execution receipts for both search and source opening.");
  const sourceIds = new Set((research.sources ?? []).map((source) => source.id));
  const actions = new Set();
  for (const execution of research.executions) {
    if (!String(execution.executionId ?? "").trim() || !RESEARCH_TOOLS.has(execution.tool) || !["search", "open"].includes(execution.action)) throw new Error("Every web research execution needs an ID, supported host tool, and search/open action.");
    if (!Number.isFinite(Date.parse(execution.executedAt))) throw new Error(`${execution.executionId}.executedAt must be an ISO timestamp.`);
    if (!Array.isArray(execution.sourceIds) || !execution.sourceIds.length || execution.sourceIds.some((id) => !sourceIds.has(id))) throw new Error(`${execution.executionId}.sourceIds must reference recorded research sources.`);
    if (execution.action === "search" && !String(execution.query ?? "").trim()) throw new Error(`${execution.executionId} needs the executed search query.`);
    actions.add(execution.action);
  }
  if (!actions.has("search") || !actions.has("open")) throw new Error("Web research must execute and record both search and source-open actions.");
}

async function verifyResearchSource(source, options) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const lookupFn = options.lookupFn ?? dnsLookup;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let url = new URL(source.url);
  const redirects = [];
  let response;
  for (let index = 0; index < 5; index += 1) {
    await assertSafeRemoteUrl(url, lookupFn);
    response = await fetchFn(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "text/html,application/json,text/plain;q=0.8,*/*;q=0.2", Range: `bytes=0-${MAX_SOURCE_SAMPLE_BYTES - 1}`, "User-Agent": "DirectorX/0.1 research-verifier" } });
    if (!REDIRECT_STATUSES.has(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error(`${source.id} redirected without a Location header.`);
    redirects.push(url.toString());
    url = new URL(location, url);
  }
  if (!response?.ok) throw new Error(`Research source ${source.id} is not currently reachable (HTTP ${response?.status ?? "unknown"}).`);
  const sample = await readSourceSample(response, MAX_SOURCE_SAMPLE_BYTES);
  if (!sample.length) throw new Error(`Research source ${source.id} returned no verifiable content.`);
  return {
    ...source,
    url: url.toString(),
    verification: {
      status: "verified",
      checkedAt: new Date().toISOString(),
      httpStatus: response.status,
      contentType: response.headers.get("content-type") ?? "unknown",
      sampledBytes: sample.length,
      contentSampleSha256: createHash("sha256").update(sample).digest("hex"),
      redirectChain: redirects
    }
  };
}

async function readSourceSample(response, maximumBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < maximumBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maximumBytes - total;
    const chunk = Buffer.from(value.subarray(0, remaining));
    chunks.push(chunk);
    total += chunk.length;
    if (value.byteLength > remaining) break;
  }
  try { await reader.cancel(); } catch {}
  return Buffer.concat(chunks, total);
}
