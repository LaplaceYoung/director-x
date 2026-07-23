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

## 2026-07-23 — Status Facade returns a compact projection

Decision: `directorx_get_production_status` returns readiness, blockers, next action, creative SLA, and counts; it does not return `publicSnapshot(run)`.

Reason: a status check should help Codex choose the next user-facing action without filling context with provider, canvas, artifact, or internal execution state.

## 2026-07-23 — Resume Facade rebinds, it does not recreate

Decision: `directorx_resume_production` reads the existing checkpoint, rebinds the side Browser, and returns the existing resume action plan. It never creates a new Run or writes a replacement checkpoint.

Reason: resume is a recovery boundary; duplicating a Run or replaying completed work would recreate the long-running workflow failure this loop is designed to remove.

## 2026-07-23 — Research Facade starts after minimum Intake

Decision: `directorx_research_video` can start only after the existing minimum Intake and approval-independent research prerequisites are valid. Provider keys and paid generation approvals remain deferred.

Reason: reference download, media understanding, asset search, and first-script work must begin before provider setup becomes a production black hole.

## 2026-07-23 — Generation Facade reuses the paid-call boundary

Decision: `directorx_generate_media` exposes `inspect`, `submit`, and `poll`, but delegates paid execution to the existing durable Provider gateway instead of implementing a second generation path.

Reason: generation must retain official-price checks, exact approved provider/model routes, session-only credentials, submission reservation, and idempotency protection. A new orchestration path would increase duplicate-billing and state-divergence risk.

## 2026-07-23 — Candidate acceptance includes selection

Decision: `directorx_review_media_candidate` selects an accepted candidate for editing in the same durable mutation. Non-accepted candidates receive one evidence-bound repair plan keyed by a stable review fingerprint.

Reason: review and selection are one user intent after the candidate passes the quality threshold. Separating them creates a resumability gap; allowing repeated repair compilation creates duplicate state and unnecessary retries.

## 2026-07-23 — Generation preparation belongs to the generation Facade

Decision: add `prepare` to `directorx_generate_media` and route public repair results there. Compatibility calls to `directorx_begin_generation_attempt` use the same implementation.

Reason: opening a priced, bounded attempt is part of generating media. Exposing it as a separate public tool forces Codex to understand internal draw-loop bookkeeping and creates a recovery gap between review and retry.
