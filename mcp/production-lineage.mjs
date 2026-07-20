import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export function bindExecutionLineage(run, input, now = new Date().toISOString()) {
  if (!input?.bindingId || !input.capabilityId || !input.toolId || !input.providerId || !input.modelId || !input.modelVersion || !input.promptContractId || !isSha(input.promptContractHash) || !isSha(input.directorContractFingerprint) || !input.dxAgent || !input.inputArtifacts?.length || !input.outputArtifacts?.length) throw new Error("Execution lineage requires tool/model versions, prompt and Director fingerprints, DX agent, and hashed input/output entities.");
  if (run.directorDocument?.fingerprint !== input.directorContractFingerprint) throw new Error("Lineage Director fingerprint must match the active Director contract.");
  if (!run.toolInventory?.tools.some((tool) => tool.toolId === input.toolId)) throw new Error("Lineage tool must exist in the active tool inventory.");
  const route = run.capabilityRoute?.capabilities?.find((item) => item.id === input.capabilityId);
  if (!route || route.owner !== input.dxAgent) throw new Error("Lineage capability and DX agent must match the active capability route.");
  for (const entity of [...input.inputArtifacts, ...input.outputArtifacts]) verifyArtifactEntity(run, entity);
  const canonical = { schemaVersion: "1.0", bindingId: input.bindingId, activity: { capabilityId: input.capabilityId, toolId: input.toolId, providerId: input.providerId, modelId: input.modelId, modelVersion: input.modelVersion, promptContractId: input.promptContractId, promptContractHash: input.promptContractHash, directorContractFingerprint: input.directorContractFingerprint, dxAgent: input.dxAgent }, usedEntities: structuredClone(input.inputArtifacts), generatedEntities: structuredClone(input.outputArtifacts), boundAt: now };
  const binding = { ...canonical, lineageHash: hash(canonical) };
  run.productionLineage ??= {};
  if (run.productionLineage[input.bindingId]) throw new Error(`Duplicate lineage binding: ${input.bindingId}`);
  run.productionLineage[input.bindingId] = binding;
  return binding;
}

export function reviewKnowledgePatch(run, input, now = new Date()) {
  const proposal = run.modelKnowledgePatch?.proposals?.find((item) => item.patchId === input.patchId);
  if (!proposal) throw new Error("Review an existing model knowledge proposal.");
  if (!input.note || input.confirmedBy !== "request_user_input" || !["accept", "reject"].includes(input.decision) || !["project", "workspace"].includes(input.scope) || !["project_user", "workspace_admin"].includes(input.authority)) throw new Error("Knowledge review requires a native confirmation, decision, scope, authority, and note.");
  if (input.scope === "workspace" && input.authority !== "workspace_admin") throw new Error("Workspace knowledge requires workspace_admin authority.");
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) throw new Error("Accepted knowledge requires a future expiry.");
  run.knowledgeDecisions ??= [];
  if (run.knowledgeDecisions.some((item) => item.patchId === input.patchId && item.status === "accepted")) throw new Error("An accepted knowledge patch cannot be silently replaced; revoke it first.");
  const decision = { decisionId: `knowledge-decision:${input.patchId}:${now.getTime()}`, patchId: input.patchId, decision: input.decision, status: input.decision === "accept" ? "accepted" : "rejected", scope: input.scope, authority: input.authority, note: input.note, confirmedBy: input.confirmedBy, decidedAt: now.toISOString(), expiresAt: expiresAt.toISOString(), currentApprovedRouteImmutable: true };
  run.knowledgeDecisions.push(decision);
  run.acceptedModelKnowledge = { schemaVersion: "1.0", sourceReportId: run.modelKnowledgePatch.reportId, entries: run.knowledgeDecisions.filter((item) => item.status === "accepted" && Date.parse(item.expiresAt) > now.getTime()).map((item) => ({ ...item, proposal: run.modelKnowledgePatch.proposals.find((proposalItem) => proposalItem.patchId === item.patchId) })), generatedAt: now.toISOString() };
  return decision;
}

export function revokeKnowledgePatch(run, input, now = new Date()) {
  const decision = [...(run.knowledgeDecisions ?? [])].reverse().find((item) => item.patchId === input.patchId && item.status === "accepted");
  if (!decision || input.confirmedBy !== "request_user_input" || !input.note) throw new Error("Revocation requires an accepted patch and native confirmation note.");
  decision.status = "revoked"; decision.revokedAt = now.toISOString(); decision.revocationNote = input.note;
  run.acceptedModelKnowledge = { schemaVersion: "1.0", sourceReportId: run.modelKnowledgePatch.reportId, entries: run.knowledgeDecisions.filter((item) => item.status === "accepted" && Date.parse(item.expiresAt) > now.getTime()).map((item) => ({ ...item, proposal: run.modelKnowledgePatch.proposals.find((proposalItem) => proposalItem.patchId === item.patchId) })), generatedAt: now.toISOString() };
  return decision;
}

export async function writeLineageArtifacts({ projectPath, runId, productionLineage, knowledgeDecisions, acceptedModelKnowledge }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts"); await mkdir(directory, { recursive: true });
  const values = { "production_lineage.json": productionLineage ? { bindings: Object.values(productionLineage) } : null, "knowledge_decisions.json": knowledgeDecisions ? { decisions: knowledgeDecisions } : null, "accepted_model_knowledge.json": acceptedModelKnowledge }, written = {};
  for (const [artifactRef, value] of Object.entries(values)) if (value) { const path = join(directory, artifactRef); await writeFile(path, `${JSON.stringify({ runId, ...value }, null, 2)}\n`, { mode: 0o600 }); written[artifactRef] = { artifactRef, path }; }
  return written;
}

function verifyArtifactEntity(run, entity) {
  if (!entity?.artifactRef || !isSha(entity.sha256)) throw new Error("Lineage entities require artifactRef and SHA-256.");
  const artifact = run.artifacts?.[entity.artifactRef];
  if (!artifact || normalizeSha(artifact.sha256) !== normalizeSha(entity.sha256)) throw new Error(`Lineage hash does not match registered artifact ${entity.artifactRef}.`);
}
function isSha(value) { return /^(sha256:)?[a-f0-9]{64}$/i.test(value ?? ""); }
function normalizeSha(value) { return (value ?? "").replace(/^sha256:/, "").toLowerCase(); }
function hash(value) { return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`; }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
