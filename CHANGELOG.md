# Changelog

All notable public changes to Director X are recorded here.

## [Unreleased]

### Changed

- Started plugin productization work around marketplace installation, validation, CI, public tool contracts, and progressive disclosure.
- Bound surfaced Director X skills to the bundled `directorx-production` MCP server and reject stale or unconfigured skill dependencies during plugin validation.
- Completed UI metadata for every bundled Director X skill, with one implicit entrypoint and explicit-only specialist skills to prevent workflow fragments from bypassing the main production Run.
- Added a profile-aware first-run setup doctor, approval-gated repairs, and a verified two-second zero-Key local media smoke test that can appear on the setup canvas.

## [0.1.0] - 2026-07-21

### Added

- Native Codex Goal integration and durable Director X production Runs.
- Dedicated DX production agents with bounded parallel orchestration and artifact handoffs.
- Media-first side canvas, Director X Cut, provider routing, budget controls, recovery, editing, and exhaustive final-frame review.
- Provider-specific image and video prompt dialects with typed reference roles and causal draw-loop repair.

### Notes

- This is the first public early-access baseline.
- The complete Pi Agent Harness-based Video Harness and Electron desktop application remain in development.

[Unreleased]: https://github.com/LaplaceYoung/director-x/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LaplaceYoung/director-x/releases/tag/v0.1.0
