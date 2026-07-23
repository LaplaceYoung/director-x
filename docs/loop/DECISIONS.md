# Evolution Loop Decisions

## 2026-07-23 — Keep skills, reduce exposed tools first

Decision: do not delete or merge the 34 skills in the first loop.

Reason: the entry skill is already the only implicit skill, and the specialist files encode real artifact contracts. Deleting them before adding a tested intent route would remove production knowledge without improving the user path.

## 2026-07-23 — Metadata is not an access boundary

Decision: treat `_meta.ui.visibility` as presentation metadata only until the registry enforces the same audience in `tools/list` and `tools/call`.

Reason: the current registry indexes every definition and dispatches any registered name. The next tool-surface change must make the boundary executable.

## 2026-07-23 — Preserve compatibility during migration

Decision: add a public profile without removing the compatibility profile in the same change.

Reason: existing runs, tests, and expert operators need a rollback path; public discovery can improve without silently breaking known low-level workflows.
