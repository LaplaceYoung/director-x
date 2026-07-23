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

## 2026-07-23 — Public startup coordinates native actions without impersonating them

Decision: `directorx_start_production` owns the durable preflight, interaction resolution, Run creation, and Goal binding, but returns `request_user_input` and `create_goal` as explicit Codex host actions.

Reason: MCP cannot truthfully invoke Codex-native Goal or input UI by itself. Keeping those boundaries visible preserves the native experience, while routing every MCP continuation back through one Facade prevents repeated questions, duplicate Runs, and public dependence on hidden low-level tools.

## 2026-07-23 — Entry Skill is a focused outcome route, not a runtime manual

Decision: replace the 251-line entry Skill's direct boot and stage choreography with a concise start/resume route that follows public Facade host actions and loads specialist Skills only after a Run exists.

Reason: OpenAI's [Build plugins](https://learn.chatgpt.com/docs/build-plugins) and [Build Skills](https://learn.chatgpt.com/docs/build-skills) guidance favors a workflow-first plugin, a clear scope boundary, and progressive disclosure. The old entry named 84 low-level tools and was incompatible with the public profile that the plugin was already migrating toward. The new entry keeps user intent at the top level and leaves implementation detail inside the MCP runtime or an explicit stage Skill.

## 2026-07-23 — Native production decisions get one public Facade

Decision: add `directorx_decide_production` with strict `request` and `resolve` branches. Its returned native action resolves back through the same Facade, never through `directorx_resolve_user_interaction`.

Reason: upcoming public editing needs a durable `post_production_edit` choice. Leaving the native decision boundary low-level would either leak an internal tool into the public profile or tempt the host to repeat a question. The Facade persists first, deduplicates request replay, accepts only the raw Codex answer envelope, and replays a resolved request safely.

## 2026-07-23 — Public means actual, executable Facades

Decision: the public profile lists only the nine implemented Facades—start, status, resume, decide, prepare, research, generate, review, and recover. Future edit/render/audit/delivery names remain a separate planned list until each has a complete public contract.

Reason: a model cannot safely act on a roadmap name that `tools/list` cannot return. The registry enforces the same public boundary in both listing and dispatch, and public result projection must not leak a legacy continuation back across it.

## 2026-07-23 — Public preparation confirms the canonical brief before mutation

Decision: `directorx_prepare_production` first creates one native `public-brief` Intake gate. Its interaction stores the canonical brief and a fingerprint; the native answer resolves through `directorx_decide_production`, then a returned host-action sequence resumes the same public prepare call.

Reason: a material brief determines Intake, budget, route, and delivery promise. The shared `prepareFastStartIntake` helper verifies the resolved interaction, typed application, matching pipeline/fingerprint, and approved answer before it mutates those artifacts. A stable gate supersedes an older pending brief question rather than creating parallel actionable prompts, and identical retries remain idempotent.

## 2026-07-23 — Keep the remaining decision trust assumptions visible

Decision: record two remaining P1s rather than calling native decisions cryptographically complete: the resolver trusts the raw Codex MCP `request_user_input` envelope without a host-signed receipt, and public run-mode semantics are still supplied by the caller's label-to-mode mapping.

Reason: persistence and replay safety prove that the runtime applies a recorded answer once; they do not independently attest its host origin or prove that presentation wording cannot remap a durable run mode. These boundaries need a host-trusted receipt and canonical mapping before the decision protocol can be considered fully hardened.

## 2026-07-23 — Make the public Facade surface the default

Decision: set the registry fallback and `.mcp.json` launch environment to the `public` profile. Retain the 185-tool compatibility surface only behind explicit `DIRECTORX_TOOL_PROFILE=compatibility` opt-in for development or migration.

Reason: a migration surface does not improve first-use discovery while the default still exposes every low-level tool. An explicit opt-in preserves existing expert escape hatches without making them the model's normal decision surface.

## 2026-07-23 — Classify material timeline writes from one source

Decision: export `DIRECTORX_DESTRUCTIVE_TOOL_NAMES` from the safety policy and reuse it when contracts are applied. Mark `directorx_commit_timeline_patch` as destructive/material even though it creates a reversible revision rather than overwriting the source timeline.

Reason: contracts and safety policy must not silently override one another's classification. A reversible implementation can still make a material user-visible change and therefore needs the explicit destructive-write guard and confirmation semantics.

## 2026-07-23 — Canonicalize public run-mode semantics in the server

Decision: `directorx_decide_production` replaces caller-supplied run-mode questions and label-to-mode selections with one server-owned canonical question. The selected label maps to `RUN_MODES` by the canonical option order.

Reason: a public decision must not let presentation wording or an untrusted mapping alter durable execution semantics. Stage approvals remain caller-shaped because their stage and approval wording are intentionally specific to the current pipeline boundary.
