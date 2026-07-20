# Video Reading Playbook

## Profile matrix

| Profile | Use | Visual coverage claim | Default bound |
| --- | --- | --- | --- |
| `transcript_only` | Dialogue, narration, named moments | Transcript segments plus explicitly pinned cue frames only | 0 frames, or cue count |
| `fast_keyframes` | First-pass orientation | Selected keyframes, with uniform fallback | 50 |
| `scene_summary` | Default structure, pacing, composition, product/action survey | Scene-change and evenly distributed sampled evidence | 100 |
| `full_frame_evidence` | Defect audits or claims about the whole source | Every decoded frame with independent EOF/count parity | 3600 |

Use a focused range for questions such as “what changes between 00:14 and 00:22?”. Focused reads can sample up to two frames per second within the declared bound. Set `fps` only when a fixed cadence is materially useful; an explicit value switches sampled profiles to uniform extraction and is capped at 2 FPS. If the requested cadence would exceed `maxFrames`, narrow the time range or explicitly raise the bound rather than accepting partial leading coverage.

For sampled reads longer than ten minutes, inspect `coverage.sparseScan`. A sparse whole-video pass is useful for orientation, but `coverage.recommendedNextAction` must be followed with `startSeconds` and `endSeconds` before making detailed claims about a specific beat.

## Evidence language

- Say “the sampled evidence shows” for `fast_keyframes` and `scene_summary`.
- Say “the transcript states” for transcript-derived facts.
- Say “the exhaustive decode shows” only when `fullFrameCoverage.passed` is true.
- Treat inferred intent, emotion, brand positioning, and causality as interpretation, not visible fact.

## Failure handling

- Fewer than four keyframes: use uniform sampling.
- Fewer than eight scene candidates: use uniform sampling.
- Near-duplicate frames: compare 16×16 grayscale evidence against the last retained frame.
- Frame count above the exhaustive bound: switch to `scene_summary` or explicitly raise the bound within 3600.
- Explicit FPS above the frame budget: narrow `startSeconds`/`endSeconds` or raise `maxFrames`; never silently truncate the end of the range.
- No captions: create a local Whisper transcript, then rerun or attach cue timestamps.
- `sparseScan=true`: preserve the overview, then perform a focused range read for the relevant moment.
- Extremely tall source frames: keep the original aspect ratio while clamping extracted evidence to a host-safe height of 1998 pixels.
- URL without persisted consent: stop and use the existing native reference-download gate.
- DRM, private, or login-only source: ask for a user upload; do not bypass access controls.

## Upstream influence

The profile vocabulary, duration-aware budgets, explicit sampling cadence, keyframe/scene fallback, transcript cue frames, small grayscale deduplication, long-video coverage warning, and image-height safety bound were informed by `bradautomates/claude-video` at commit `83da59fa78c3eee9e20f515fe75c438bb5166efd` (MIT). Director X rewrites these ideas in Node ESM and integrates them with persistent Runs, native authorization, canvas artifacts, rights metadata, and exhaustive frame identity.
