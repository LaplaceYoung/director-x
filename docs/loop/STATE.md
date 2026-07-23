# DirectorX Codex Plugin Evolution State

## Current loop

- Loop: 06
- Date: 2026-07-23
- Commit baseline: `25242f0`
- Release baseline: `v0.1.15`
- Status: `CANDIDATE_REVIEW_FACADE_IMPLEMENTED`
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
- Full Loop 06 CI passed with 576 tests.

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

## Exit condition for the next loop

Implement and verify the public `start` boundary, then remove remaining low-level generation-attempt setup from the public lifecycle. Do not claim the public profile is complete until a user can traverse start → research → generation → review → edit → delivery.
