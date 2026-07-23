# DirectorX Codex Plugin Evolution State

## Current loop

- Loop: 07
- Date: 2026-07-23
- Commit baseline: `69599f4`
- Release baseline: `v0.1.15`
- Status: `PUBLIC_GENERATION_RETRY_LOOP_CLOSED`
- Current focus: plugin discovery, MCP surface, installation truth, and recovery UX

## Last completed work

- Published `v0.1.15` with fast-start and billing-safe recovery changes.
- Added the `directorx_recover_production` inspect/apply facade.
- Removed `directorx_get_recovery_action` from the registered surface.
- Added the `directorx_get_production_status` compact status facade.
- Added the `directorx_resume_production` durable resume facade.
- Added the `directorx_research_video` reference-first research facade.
- Added the `directorx_generate_media` inspect/submit/poll facade over the existing billing-safe Provider gateway.
- Added the `directorx_review_media_candidate` inspect/review facade with atomic accept-and-select and evidence-bound repair compilation.
- Added replay-safe `prepare` to `directorx_generate_media`, including official pricing and attempt-budget enforcement.
- Full Loop 07 CI passed with 576 tests.

## This loop

- Completed Phase 0 baseline audit.
- Corrected stale README release references.
- Implemented the public MCP profile without changing the default compatibility behavior.
- Implemented and tested the first non-recovery public Facade against a durable Run.
- Implemented and tested resume against the same durable Run without creating a replacement Run.
- Implemented and tested idempotent research start against the minimum Intake contract.
- Implemented a compact generation projection that does not expose credentials or the full Run.
- Reused the existing durable submission reservation, official price quote, model approval, session credential, and duplicate-billing protections.
- Verified the read-only `inspect` action against a real durable Run without issuing a Provider request.
- Made candidate review replay-safe through a stable review fingerprint.
- Made accepted candidates enter editing in the same durable update.
- Made rejected candidates produce one single-variable repair plan without consuming another paid attempt.
- Routed repair retries back to `directorx_generate_media:prepare` instead of exposing `directorx_begin_generation_attempt`.
- Fixed next-action priority so an active prepared attempt proceeds to submission before older unselected candidates are reconsidered.
- Reused the same attempt implementation for compatibility and public calls.

## Exit condition for the next loop

Implement and verify the public `start` boundary. Do not claim the public profile is complete until a user can traverse start → research → generation → review → edit → delivery.
