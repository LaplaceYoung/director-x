# Claude Video compatibility study

Research date: 2026-07-21

Upstream: [bradautomates/claude-video](https://github.com/bradautomates/claude-video)

Snapshot: `83da59fa78c3eee9e20f515fe75c438bb5166efd`
License: MIT

## Decision

Director X adopts the upstream project's strongest video-reading interaction patterns, but rewrites the runtime in the plugin's existing Node ESM architecture. It does not embed a Python/Claude-specific execution path or create another source of production state.

| Upstream capability | Director X decision | Director X implementation |
| --- | --- | --- |
| Local file and URL input | Adapt | Local files are project-contained; URLs pass native consent and existing reference ingest first. |
| Transcript-first reading | Adapt | Import SRT/VTT/Director X JSON; otherwise use the existing local Whisper adapter. |
| Efficient keyframes | Reuse concept | `fast_keyframes`, 50-frame cap, uniform fallback below four candidates. |
| Balanced scene sampling | Reuse concept | `scene_summary`, 100-frame cap, uniform fallback below eight candidates. |
| Focused time ranges | Reuse concept | Duration-aware focused budgets up to two frames per second. |
| Explicit FPS | Adapt | Optional fixed-cadence sampling for sampled profiles, validated at `0 < fps <= 2`; automatic cadence remains the default. |
| Transcript cue images | Reuse concept | User/model-selected timestamps are pinned ahead of sampled frames. |
| Small grayscale deduplication | Rewrite | Node/FFmpeg 16×16 grayscale mean absolute difference against the last retained frame. |
| Long-video sparse-scan warning | Adapt | Persist coverage span and average interval, then recommend a focused range for detailed claims. |
| Host-safe image sizing | Reuse constraint | Preserve aspect ratio and clamp extracted evidence frames to 1998 pixels high. |
| Uncapped token-burner mode | Reject | Replaced by bounded `full_frame_evidence` with independent decoded-frame parity. |
| Claude `Read` protocol | Reject | Evidence is persisted as Run artifacts and inspected through Codex/canvas media surfaces. |
| Automatic Homebrew installs | Reject | The Director X setup doctor and approval-gated managed runtime own dependencies. |
| API keys in a separate config file | Reject | Credentials remain session-scoped through the existing Director X credential boundary. |

## Director X additions

- one stable MCP Runtime and one durable Run as the source of truth;
- video, contact sheet, transcript, frame, receipt, and lineage nodes on the live canvas;
- `reference_only` propagation and explicit download authorization;
- shell-free process execution with argv arrays and project containment;
- exhaustive mode with independent FFprobe/decoded-frame identity evidence;
- actionable coverage metadata projected into the durable Run and live canvas;
- no new production dependency and no Python language fork.

## Attribution

The implementation records its upstream influence in every video-read receipt. The upstream MIT license is included under `third_party/claude-video/LICENSE` and summarized in `THIRD_PARTY_NOTICES.md`.
