# Native multi-agent work

Use Codex native agents only when work is independent and materially faster in parallel.

- `dx-reference-analyst`: load `$directorx-reference-analyst`.
- `dx-asset-researcher`: load `$directorx-asset-researcher`.
- `dx-visual-director`: load `$directorx-visual-director`.
- `dx-remotion-editor`: load `$directorx-remotion-editor`.

Prefix every delegated task with its canonical role label, for example `[dx-asset-researcher]`, and use that label in progress updates, output filenames, and handoff notes. Reuse the same label for follow-up work in the same task.

Codex native subagent display nicknames are host-controlled. When the available `spawn_agent` tool has no nickname field, Director X cannot rename the displayed system nickname; the stable `dx-*` task label is the supported identity layer. Never invent or misreport a renamed system nickname.

The parent Director:

- asks every user-facing question
- owns the final creative direction
- gives each agent a disjoint output
- integrates results into one project
- closes agents when their bounded task is done

Do not create an orchestration framework, execution graph, agent database, or canvas agent nodes.
