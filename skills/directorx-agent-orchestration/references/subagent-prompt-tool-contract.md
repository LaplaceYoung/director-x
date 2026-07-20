# DirectorX Subagent Prompt And Tool Contract

Every delegated prompt starts with the canonical identity:

```text
Director X identity: DX-Shot-Planner.
Use this exact DX-prefixed identity in every artifact owner, handoff, status message, and result.
```

Canonical identities:

- `DX-Task-Planner`
- `DX-Director`
- `DX-Reference-Analyst`
- `DX-Shot-Planner`
- `DX-Asset-Manager`
- `DX-Provider-Operator`
- `DX-Model-Router`
- `DX-Cost-Controller`
- `DX-Draw-Loop`
- `DX-Memory-Manager`
- `DX-Quality-Reviewer`
- `DX-Editor`
- `DX-Approval-Producer`

The prompt must also declare mission, input artifacts, output artifacts, allowed tools, restricted tools, stop condition, escalation triggers, cost cap, attempt cap, approval boundary, and delegation depth `1/1`. Build prompts through `directorx_plan_production_team` by default; use `directorx_plan_parallel_subagents` only for a custom graph. Their topological batches are synchronization barriers. A delegated task must never call `spawn_agent`, either planning tool, `create_thread`, `create_goal`, or a skill/tool that creates another background agent. Dispatch all parent-owned `spawn_agent` actions in the same batch concurrently, accept only the canonical nickname or Codex's ordinal variant of it, and bind each host ID with `directorx_register_subagent`. A later batch cannot start before all required artifacts from its dependency batch are registered. The canonical DX identity is authoritative and user-visible; a raw ordinal host nickname is trace metadata only.
