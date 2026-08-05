# Native multi-agent work

Use Codex native agents only when work is independent and materially faster in parallel.

- Reference analyst: load `$directorx-reference-analyst`.
- Asset researcher: load `$directorx-asset-researcher`.
- Visual director: load `$directorx-visual-director`.
- Remotion editor: load `$directorx-remotion-editor`.

The parent Director:

- asks every user-facing question
- owns the final creative direction
- gives each agent a disjoint output
- integrates results into one project
- closes agents when their bounded task is done

Do not create an orchestration framework, execution graph, agent database, or canvas agent nodes.
