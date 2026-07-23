# DirectorX Codex Plugin Evolution State

## Current loop

- Loop: 01
- Date: 2026-07-23
- Commit baseline: `ffa3a06`
- Release baseline: `v0.1.15`
- Status: `PUBLIC_PROFILE_SLICE_IMPLEMENTED`
- Current focus: plugin discovery, MCP surface, installation truth, and recovery UX

## Last completed work

- Published `v0.1.15` with fast-start and billing-safe recovery changes.
- Added the `directorx_recover_production` inspect/apply facade.
- Removed `directorx_get_recovery_action` from the registered surface.
- Full CI passed with 573 tests.

## This loop

- Completed Phase 0 baseline audit.
- Corrected stale README release references.
- Implemented the first P1 public MCP profile slice without changing the default compatibility behavior.

## Exit condition for the next loop

Implement and verify one narrow public-tool slice while preserving the existing legacy compatibility route. Do not claim the public profile is complete until `tools/list` and `tools/call` enforce the same audience boundary.
