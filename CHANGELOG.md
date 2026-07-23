# Changelog

All notable public changes to Director X are recorded here.

## [Unreleased]

### Documentation

- Updated the installation and release references to `v0.1.15`.
- Started the plugin evolution-loop audit under `docs/loop/`.

### MCP surface

- Added a compact `directorx_get_production_status` Facade and tested it against a durable Run.
- Added the second completed Facade to the opt-in public tool profile while preserving compatibility mode.

### Changed

- Started plugin productization work around marketplace installation, validation, CI, public tool contracts, and progressive disclosure.
- Bound surfaced Director X skills to the bundled `directorx-production` MCP server and reject stale or unconfigured skill dependencies during plugin validation.
- Completed UI metadata for every bundled Director X skill, with one implicit entrypoint and explicit-only specialist skills to prevent workflow fragments from bypassing the main production Run.
- Added a profile-aware first-run setup doctor, approval-gated repairs, and a verified two-second zero-Key local media smoke test that can appear on the setup canvas.
- Added adaptive video reading with transcript cues, keyframe and scene sampling, focused ranges, deduplication, exhaustive frame-count evidence, and live canvas artifacts, informed by `bradautomates/claude-video` and rewritten in Node ESM.
- Completed `claude-video` compatibility details with bounded explicit FPS sampling, long-video sparse-coverage guidance, and a 1998-pixel evidence-frame height clamp.
- Added a deterministic local video-evidence search tool that ranks registered observations, persists candidate results, and projects them to the Evidence Rail without treating candidates as approved claims.
- Added bounded review-only evidence clip materialization with source-hash verification, playable MP4 output, human-review receipts, retrieval lineage, and canvas media projection; derivatives remain ineligible for delivery.
- Added durable, timecoded side-canvas review notes with idempotent capture, explicit non-approval semantics, Run projection, ownership acknowledgement, and evidence-required resolution.
- Added bounded MCP Resource Templates for SHA-verified, Run-scoped document and media previews without exposing mutable filesystem access.
- Centralized MCP safety annotations so Codex can distinguish read-only queries, runtime mutations, external provider calls, idempotent submissions, and destructive cancellation or revocation actions.
- Bound reviewed visual prompt packs to generation requests with SHA-256 lineage and first-attempt drift protection for prompts, provider modes, parameters, and pricing usage.

## [0.1.0] - 2026-07-21

### Added

- Added an evidence-driven generation repair compiler that turns candidate review failures into one-variable prompt, reference, provider-parameter, shot-structure, edit, reroute, or stop decisions before another paid draw.

- Native Codex Goal integration and durable Director X production Runs.
- Dedicated DX production agents with bounded parallel orchestration and artifact handoffs.
- Media-first side canvas, Director X Cut, provider routing, budget controls, recovery, editing, and exhaustive final-frame review.
- Provider-specific image and video prompt dialects with typed reference roles and causal draw-loop repair.

### Notes

- This is the first public early-access baseline.
- The complete Pi Agent Harness-based Video Harness and Electron desktop application remain in development.

[Unreleased]: https://github.com/LaplaceYoung/director-x/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LaplaceYoung/director-x/releases/tag/v0.1.0
