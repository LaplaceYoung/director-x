import test from "node:test";
import assert from "node:assert/strict";
import { registerExecutionGraph, transitionExecutionNode, validateExecutionGraph } from "./execution-graph.mjs";

const graph = { graphId: "graph-1", revision: 1, intentSummary: "Create a researched promo", selectedCapabilities: ["web_research", "shot_planning"], nodes: [
  { nodeId: "research", kind: "agent", stage: "research", label: "Research", owner: "DX-Reference-Analyst", capability: "web_research", dependsOn: [], inputArtifactRefs: ["Director.md"], outputArtifactRefs: ["reference_analysis.json"], config: {} },
  { nodeId: "shots", kind: "agent", stage: "storyboard", label: "Shots", owner: "DX-Shot-Planner", capability: "shot_planning", dependsOn: ["research"], inputArtifactRefs: ["reference_analysis.json"], outputArtifactRefs: ["shotlist.json"], config: {} }
] };

test("registers an acyclic capability-filtered execution graph", () => {
  const run = { artifacts: {} };
  registerExecutionGraph(run, graph, "2026-01-01T00:00:00.000Z");
  assert.equal(run.executionGraph.nodes[0].status, "pending");
  assert.throws(() => transitionExecutionNode(run, { nodeId: "shots", status: "running", detail: "start", evidenceRefs: [] }), /dependencies complete/);
  run.artifacts["reference_analysis.json"] = { path: "/tmp/reference.json" };
  transitionExecutionNode(run, { nodeId: "research", status: "complete", detail: "done", evidenceRefs: ["reference_analysis.json"] });
  assert.equal(transitionExecutionNode(run, { nodeId: "shots", status: "running", detail: "start", evidenceRefs: [] }).status, "running");
});

test("rejects cycles, non-DX owners, and duplicate producers", () => {
  const cyclic = structuredClone(graph); cyclic.nodes[0].dependsOn = ["shots"];
  assert.throws(() => validateExecutionGraph(cyclic), /later pipeline stage|acyclic/);
  const unnamed = structuredClone(graph); unnamed.nodes[0].owner = "Researcher";
  assert.throws(() => validateExecutionGraph(unnamed), /canonical DX/);
  const duplicate = structuredClone(graph); duplicate.nodes[1].outputArtifactRefs = ["reference_analysis.json"];
  assert.throws(() => validateExecutionGraph(duplicate), /multiple execution graph producers/);
  const unselected = structuredClone(graph); unselected.nodes[1].capability = "unused_tool";
  assert.throws(() => validateExecutionGraph(unselected), /outside selectedCapabilities/);
  const reversed = structuredClone(graph); reversed.nodes[0].dependsOn = ["shots"]; reversed.nodes[1].dependsOn = [];
  assert.throws(() => validateExecutionGraph(reversed), /later pipeline stage/);
});

test("reuses only unchanged completed nodes with durable artifacts during replanning", () => {
  const run = { artifacts: { "reference_analysis.json": { path: "/tmp/reference.json" } } };
  registerExecutionGraph(run, graph);
  transitionExecutionNode(run, { nodeId: "research", status: "complete", detail: "done", evidenceRefs: ["reference_analysis.json"] });
  const revision = structuredClone(graph); revision.graphId = "graph-2"; revision.revision = 2; revision.supersedesGraphId = "graph-1"; revision.nodes[1].config = { pacing: "fast" };
  registerExecutionGraph(run, revision);
  assert.equal(run.executionGraph.nodes.find((node) => node.nodeId === "research").status, "complete");
  assert.equal(run.executionGraph.nodes.find((node) => node.nodeId === "shots").status, "pending");
});

test("binds routed capabilities to their canonical DX owner", () => {
  const routedGraph = { graphId: "route-graph", revision: 1, intentSummary: "Trim an edit", selectedCapabilities: ["video.trim_reorder"], nodes: [{ nodeId: "trim", kind: "agent", stage: "edit", label: "Trim", owner: "DX-Editor", capability: "video.trim_reorder", dependsOn: [], inputArtifactRefs: ["semantic_timeline.json"], outputArtifactRefs: ["timeline_patch.json"], config: {} }] };
  const run = { artifacts: {}, capabilityRoute: { capabilities: [{ id: "video.trim_reorder", owner: "DX-Editor" }] } };
  registerExecutionGraph(run, routedGraph);
  const wrongOwner = structuredClone(routedGraph); wrongOwner.graphId = "route-graph-2"; wrongOwner.supersedesGraphId = "route-graph"; wrongOwner.nodes[0].owner = "DX-Director";
  assert.throws(() => registerExecutionGraph(run, wrongOwner), /must be owned by DX-Editor/);
});

test("derives selected capabilities from node declarations during registration", () => {
  const graphWithDrift = structuredClone(graph);
  graphWithDrift.selectedCapabilities = ["web_research"];
  const run = { artifacts: {} };
  registerExecutionGraph(run, graphWithDrift);
  assert.deepEqual(run.executionGraph.selectedCapabilities, ["web_research", "shot_planning"]);
});
