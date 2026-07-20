---
name: directorx-checkpoint-recovery
description: Configure Director X autonomy, write replayable checkpoints, resume interrupted Codex video productions, preserve approvals and costs, and prevent duplicate provider work after compaction, restart, tool failure, or user pause.
---

# Director X Checkpoint Recovery

Use this skill for long-running productions, resumed threads, interrupted provider calls, stage failures, Codex compaction, or any Run whose active state is uncertain.

## Run Modes

- `guided_autonomy`: recommended default. Continue low-risk research, writing, local analysis, artifact creation and review; stop at hard gates.
- `stage_approval`: ask through `request_user_input` before each major stage. Record the answer with `directorx_approve_stage`.
- `full_automation`: continue inside the approved delivery promise, provider/model and budget; hard gates still stop execution.

The user must select the mode through `request_user_input`, then call `directorx_configure_run_mode`. Never infer full automation from phrases such as “继续” or “直接做”.

## Checkpoint Rules

1. Stage transitions automatically write `checkpoint_replay.json`.
2. Also call `directorx_checkpoint_run` after a partial provider result, approval wait, expensive generation batch, manual user selection, degraded route, recoverable failure, or before ending an active turn.
3. A checkpoint records stage states, approvals, stage approvals, decision IDs, artifact refs, event cursor, costs and supersession.
4. Do not store credentials, generated binary bytes or chat transcript in checkpoint state.

## Resume Protocol

1. Call `directorx_resume_run`; do not create a replacement Run.
2. Read the returned latest checkpoint, current stage, blockers, registered artifacts, approvals, costs and event cursor.
3. Reconcile in-flight provider attempts before retrying. If a receipt or candidate exists, register/review it instead of paying for a duplicate call.
4. Reconcile `provider_jobs.json` first. Reuse the stored idempotency key, poll non-terminal jobs, and distinguish `cancel_requested` from `cancelled`; never submit a replacement while the prior outcome is unknown.
5. If the action plan exposes one batched native interaction, execute its single `request_user_input` action and then every returned `afterAnswer` resolution action before dispatching new work. Only independent image, video, voice, and music route requests may be batched, with at most three questions; Goal, run mode, budget, credential, rights, stage, edit, knowledge, and delivery gates remain standalone.
6. Validate that artifact paths still exist and Director/Style fingerprints remain current.
7. Continue the earliest incomplete required output, preserving approved delivery promises and stop conditions.
8. Project the resume checkpoint and exact next action onto the canvas.

## Hard Gates In Every Mode

- Budget or paid-call increase
- Provider/model selection or reroute
- Reference download authorization
- Voice/likeness consent
- Material delivery-promise change
- Final candidate and final delivery

## Failure Policy

- Missing artifact: regenerate only the missing artifact and supersede its stale dependents.
- Provider timeout with unknown outcome: reconcile provider status before retry.
- Expired credential: reopen the session credential panel; keep the Run and attempt state.
- Stale Director fingerprint: block downstream reuse and recompile affected artifacts.
- Budget exhaustion: propose scope/quality alternatives through `request_user_input`.
