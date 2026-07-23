# DirectorX Codex Plugin Evolution State

## Current loop

- Loop: 04
- Date: 2026-07-23
- Commit baseline: `93f174e`
- Release baseline: `v0.1.15`
- Status: `RESEARCH_FACADE_IMPLEMENTED`
- Current focus: plugin discovery, MCP surface, installation truth, and recovery UX

## Last completed work

- Published `v0.1.15` with fast-start and billing-safe recovery changes.
- Added the `directorx_recover_production` inspect/apply facade.
- Removed `directorx_get_recovery_action` from the registered surface.
- Added the `directorx_get_production_status` compact status facade.
- Added the `directorx_resume_production` durable resume facade.
- Added the `directorx_research_video` reference-first research facade.
- Full CI passed with 575 tests.

## This loop

- Completed Phase 0 baseline audit.
- Corrected stale README release references.
- Implemented the public MCP profile without changing the default compatibility behavior.
- Implemented and tested the first non-recovery public Facade against a durable Run.
- Implemented and tested resume against the same durable Run without creating a replacement Run.
- Implemented and tested idempotent research start against the minimum Intake contract.

## Exit condition for the next loop

Implement and verify the public `start` boundary or a generation/review Facade while preserving the existing legacy compatibility route. Do not claim the public profile is complete until a user can traverse a full public lifecycle path.
