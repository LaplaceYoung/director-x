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

## Visual Production Prompt Requirements

Every generation-facing delegated prompt must name:

- the exact input artifact paths and Run ID;
- the shot IDs and generation mode it owns;
- the current continuity and failure-memory keys it must preserve;
- typed reference bindings and what each reference controls;
- the exact output artifacts and their downstream consumer;
- the provider/model/version/endpoint evidence required before execution;
- hard review gates, scored criteria, cost cap, attempt cap, and stop condition;
- the allowed repair surface: prompt, reference, provider parameter, edit, extension, bridge, reroute, or regeneration.

The prompt must require the agent to read the declared artifacts before acting. It must prohibit generic planning prose, undocumented model folklore, unregistered provider inputs, silent creative rewrites, and treating an HTTP/API success as candidate acceptance.

## Minimum Generation Role Tool Scope

| Role | Required responsibility |
| --- | --- |
| `DX-Shot-Planner` | read scene coverage and continuity, create shot sequence, authorize grounding, compile the visual prompt pack |
| `DX-Model-Router` | inspect the model catalog and provider setup, research official capability evidence, probe the exact mode, write the generation plan |
| `DX-Provider-Operator` | inspect the Run, verify setup, reserve the attempt, submit the compiled request, poll, persist evidence, and localize the candidate |
| `DX-Draw-Loop` | inspect the candidate and attempt history, apply hard gates, review/compare candidates, choose one causal repair delta |
| `DX-Quality-Reviewer` | inspect timecoded visual evidence, validate coverage and continuity, issue the candidate or final disposition |

Tools remain least-privilege. A role receives the capabilities above only for its declared shots and stage; it does not inherit unrelated asset, approval, publishing, or delegation tools.
