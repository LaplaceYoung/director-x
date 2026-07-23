# DirectorX Codex Plugin Evolution State

## Current loop

- Loop: 08
- Date: 2026-07-23
- Commit baseline: `d1108d0`
- Release baseline: `v0.1.15`
- Status: `PUBLIC_NATIVE_START_FACADE_IMPLEMENTED`
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
- Added `directorx_start_production` as the single public boot transaction across canvas claim, native Goal confirmation, Run creation, and Goal binding.
- Kept `create_goal` and `request_user_input` as explicit Codex host actions rather than simulating them inside MCP.
- Made Run creation and Goal binding replay-safe so the host cannot duplicate the Run or binding event.

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
- Reused the existing capability preflight, durable interaction, Run store, and Goal-binding implementations for both compatibility and public calls.
- Rewrote public host-action continuations to call only `directorx_start_production` plus native Codex host tools.
- Added a strict start output contract and idempotent safety annotation.
- Full Loop 08 CI passed with 577 tests.

## Exit condition for the next loop

Implement and verify the first public edit/render boundary. Do not claim the public profile is complete until a user can traverse start → research → generation → review → edit → delivery.
