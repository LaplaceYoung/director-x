import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DX_SUBAGENT_CATALOG } from "./subagent-registry.mjs";

const STAGES = ["intake", "research", "script", "storyboard", "generation", "edit", "review", "delivery"];
const KINDS = ["agent", "tool", "review", "approval"];

export function registerExecutionGraph(run, graph, now = new Date().toISOString()) {
  const normalizedGraph = normalizeExecutionGraph(graph);
  validateExecutionGraph(normalizedGraph);
  if (run.capabilityRoute) {
    const routed = new Map(run.capabilityRoute.capabilities.map((item) => [item.id, item]));
    const outsideRoute = normalizedGraph.selectedCapabilities.filter((id) => !routed.has(id));
    if (outsideRoute.length) throw new Error(`Execution graph uses capabilities outside capability_route.json: ${outsideRoute.join(", ")}`);
    for (const node of normalizedGraph.nodes) {
      const definition = routed.get(node.capability);
      if (node.kind === "agent" && definition && node.owner !== definition.owner) throw new Error(`${node.nodeId} must be owned by ${definition.owner} for capability ${node.capability}.`);
    }
  }
  const previous = run.executionGraph;
  if (previous && normalizedGraph.supersedesGraphId !== previous.graphId) throw new Error(`Execution graph revision must supersede ${previous.graphId}.`);
  const previousNodes = new Map((previous?.nodes ?? []).map((node) => [node.nodeId, node]));
  const nodes = normalizedGraph.nodes.map((node) => {
    const prior = previousNodes.get(node.nodeId);
    const signature = nodeSignature(node);
    const reusable = prior?.status === "complete" && prior.signature === signature && node.outputArtifactRefs.every((ref) => run.artifacts?.[ref]);
    return { ...node, status: reusable ? "complete" : "pending", evidenceRefs: reusable ? prior.evidenceRefs : [], signature, updatedAt: now };
  });
  run.executionGraph = { schemaVersion: "1.0", ...normalizedGraph, nodes, registeredAt: now, updatedAt: now };
  return run.executionGraph;
}

/**
 * The capability list is a derived property of the graph, not an independent
 * hand-maintained list. Keep caller intent, but make registration resilient to
 * a node being added without updating selectedCapabilities.
 */
export function normalizeExecutionGraph(graph) {
  const declared = Array.isArray(graph?.selectedCapabilities) ? graph.selectedCapabilities : [];
  const used = Array.isArray(graph?.nodes) ? graph.nodes.map((node) => node?.capability).filter(Boolean) : [];
  return { ...graph, selectedCapabilities: [...new Set([...declared, ...used])] };
}

export function transitionExecutionNode(run, input, now = new Date().toISOString()) {
  const graph = run.executionGraph;
  if (!graph) throw new Error("Register execution_graph.json before transitioning execution nodes.");
  const node = graph.nodes.find((item) => item.nodeId === input.nodeId);
  if (!node) throw new Error(`Unknown execution node: ${input.nodeId}`);
  if (!["running", "blocked", "failed", "complete"].includes(input.status)) throw new Error(`Unsupported execution node status: ${input.status}`);
  if (input.status === "running") {
    const incomplete = node.dependsOn.filter((dependency) => graph.nodes.find((item) => item.nodeId === dependency)?.status !== "complete");
    if (incomplete.length) throw new Error(`${node.nodeId} cannot run before dependencies complete: ${incomplete.join(", ")}`);
  }
  if (input.status === "complete") {
    const evidence = new Set(input.evidenceRefs ?? []);
    const missingEvidence = node.outputArtifactRefs.filter((ref) => !evidence.has(ref));
    const missingArtifacts = node.outputArtifactRefs.filter((ref) => !run.artifacts?.[ref]);
    if (missingEvidence.length) throw new Error(`${node.nodeId} completion is missing output evidence: ${missingEvidence.join(", ")}`);
    if (missingArtifacts.length) throw new Error(`${node.nodeId} completion references unregistered artifacts: ${missingArtifacts.join(", ")}`);
  }
  node.status = input.status;
  node.detail = input.detail;
  node.evidenceRefs = [...new Set([...(node.evidenceRefs ?? []), ...(input.evidenceRefs ?? [])])];
  node.updatedAt = now;
  graph.updatedAt = now;
  return node;
}

export async function writeExecutionGraph({ projectPath, runId, graph }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "execution_graph.json");
  await writeFile(path, `${JSON.stringify({ runId, ...graph }, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "execution_graph.json", path };
}

export function validateExecutionGraph(graph) {
  if (!graph?.graphId || !Number.isInteger(graph.revision) || graph.revision < 1 || !graph.intentSummary || !Array.isArray(graph.selectedCapabilities) || !graph.selectedCapabilities.length || !Array.isArray(graph.nodes) || !graph.nodes.length) throw new Error("Execution graph requires graphId, positive revision, intentSummary, selectedCapabilities, and nodes.");
  const selectedCapabilities = new Set(graph.selectedCapabilities);
  const ids = new Set();
  const outputOwners = new Map();
  for (const node of graph.nodes) {
    if (!node.nodeId || ids.has(node.nodeId)) throw new Error("Execution graph node IDs must be present and unique.");
    ids.add(node.nodeId);
    if (!KINDS.includes(node.kind) || !STAGES.includes(node.stage) || !node.label || !node.capability) throw new Error(`${node.nodeId} requires a supported kind, stage, label, and capability.`);
    if (!selectedCapabilities.has(node.capability)) throw new Error(`${node.nodeId} uses capability ${node.capability} outside selectedCapabilities.`);
    if (!Array.isArray(node.dependsOn) || !Array.isArray(node.inputArtifactRefs) || !Array.isArray(node.outputArtifactRefs)) throw new Error(`${node.nodeId} requires dependency and artifact arrays.`);
    if (node.kind === "agent" && !DX_SUBAGENT_CATALOG.some((role) => role.displayName === node.owner)) throw new Error(`${node.nodeId} agent owner must be a canonical DX-xxxxx identity.`);
    for (const output of node.outputArtifactRefs) {
      if (outputOwners.has(output)) throw new Error(`${output} has multiple execution graph producers.`);
      outputOwners.set(output, node.nodeId);
    }
  }
  const byId = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  for (const node of graph.nodes) for (const dependency of node.dependsOn) {
    if (!ids.has(dependency) || dependency === node.nodeId) throw new Error(`${node.nodeId} has an invalid dependency: ${dependency}`);
    if (STAGES.indexOf(byId.get(dependency).stage) > STAGES.indexOf(node.stage)) throw new Error(`${node.nodeId} cannot depend on a later pipeline stage: ${dependency}`);
  }
  assertAcyclic(graph.nodes);
}

function assertAcyclic(nodes) {
  const dependencies = new Map(nodes.map((node) => [node.nodeId, node.dependsOn]));
  const visiting = new Set(), visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error("Execution graph must be acyclic.");
    if (visited.has(id)) return;
    visiting.add(id); for (const dependency of dependencies.get(id) ?? []) visit(dependency); visiting.delete(id); visited.add(id);
  };
  for (const node of nodes) visit(node.nodeId);
}

function nodeSignature(node) {
  return createHash("sha256").update(JSON.stringify({ kind: node.kind, stage: node.stage, owner: node.owner, capability: node.capability, dependsOn: node.dependsOn, inputArtifactRefs: node.inputArtifactRefs, outputArtifactRefs: node.outputArtifactRefs, config: node.config ?? {} })).digest("hex");
}
