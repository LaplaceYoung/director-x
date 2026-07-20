---
name: directorx-execution-graph-planning
description: Convert resolved video intent into a capability-filtered, auditable Director X execution DAG and revise it after failures without replaying valid work. Use for multi-stage video tasks, custom pipelines, parallel DX subagents, tool selection, artifact handoffs, recovery, or canvas progress explanation.
---

# Director X Execution Graph Planning

Build the smallest complete execution graph after Intake, `Director.md`, Pipeline selection, and capability preflight.

## Workflow

1. Decompose resolved intent into explicit and implicit production sub-intents. Keep only capabilities needed to satisfy the approved delivery promise.
2. Map each sub-intent to one `agent`, `tool`, `review`, or `approval` node. Agent owners must use a canonical identity returned by `directorx_list_subagent_roles`.
3. Call `directorx_list_video_capabilities`, select only abilities required by the resolved intent, and persist them with `directorx_plan_capability_route`. Treat its owner, `agentType`, tool class, missing inputs, and interaction gate as binding.
4. Define each execution node's stage, routed capability, dependencies, input artifacts, output artifacts, and provider-neutral configuration. Give every output artifact exactly one producer.
5. Keep material user decisions in Codex `request_user_input`. Represent them as approval nodes only after Codex records the decision; the canvas never answers on the user's behalf.
6. Call `directorx_register_execution_graph`. Treat persisted `execution_graph.json` and its canvas projection as the authoritative plan.
7. Before work begins, call `directorx_transition_execution_node` with `running`. The Runtime rejects nodes whose dependencies are incomplete.
8. Register real output artifacts, then complete the node with those artifact refs as evidence. A chat summary is not node completion.
9. On failure, mark only the failed node, diagnose the failure class, and register a new graph revision with `supersedesGraphId`. Preserve stable node IDs for semantically unchanged work.
10. Never reuse a completed node unless its signature is unchanged and all durable output artifacts still exist. Let Runtime decide reuse.

## Graph Rules

- Keep the graph acyclic and artifact-facing.
- Prefer parallel branches when dependencies truly permit them.
- Do not activate unrelated Skills or tools just in case.
- Separate creative review, technical review, rights review, and user approval.
- Put bounded retries inside a node's configuration; do not represent every retry as a permanent stage.
- Replan when capability probes, provider failures, rights constraints, budget changes, or review evidence invalidate the active route.

## Canvas Contract

The canvas first shows the capability route (what Director X decided it needs and why), then the execution graph (how those abilities execute). Codex remains the conversational and approval surface; the route and graph are the observable control plane.
