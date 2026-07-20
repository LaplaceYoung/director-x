# Reference Intake Playbook

## Extraction Rubric

| Dimension | What to capture | Artifact target |
| --- | --- | --- |
| Hook | First frame, first line, promise, conflict, curiosity gap | `script_or_outline`, `platform_publishing_profile` |
| Pacing | Beat interval, shot length, pause placement, acceleration | `semantic_timeline`, `edit_decisions` |
| Camera | Framing, lens feel, motion, blocking, reveal order | `shotlist`, `style_playbook` |
| Visual System | Palette, texture, lighting, typography, product placement | `style_playbook`, `visual_prompt` |
| Audio | Music energy, ducking moments, voice tone, SFX accents | `audio_plan`, `semantic_timeline` |
| Subtitle | Density, line length, emphasis, platform-safe area | `subtitle_plan`, `platform_publishing_profile` |
| CTA | Comment hook, save reason, follow reason, purchase path | `publish_package` |

## Full-Frame Recreation Evidence

- Use yt-dlp only after source-scoped native authorization.
- Limit third-party reference analysis to the approved section; use a user upload when the link is private, login-only, DRM-protected, or unsupported.
- FFprobe enumerates every decoded frame and preserves rational timing/PTS evidence.
- FFmpeg extracts every decoded frame with stable lexical names. The extracted count must equal the independently probed count.
- Keep thousands of frames behind `reference_full_frame_manifest.jsonl`; expose only the clip, contact sheet, useful evidence frames, extracted audio, and recreation documents on the canvas.
- `reference_replication_plan.json` binds each learned hook/beat to source ranges and frame indices, then maps it to an original target shot, exact generation mode/provider/model, continuity strategy, audio responsibility, fallback, and review criteria.

## Transfer Rules

- Transfer structure, timing, and functional ideas.
- Rewrite topic, claims, text, and visual expression in DirectorX language.
- Use source clips only when user owns rights or the license is explicit.
- Record source URL, capture date, and license note in provenance.
- Default third-party work to structure-only adaptation: do not reuse pixels, clips, voice likeness, music, subtitles, logos, copy, or protected character identity.

## Agentic Research Gate

1. Search before asking for download permission so the user approves named sources, not a blank cheque.
2. Rank at least three candidates and explain the expected learning value of each.
3. Ask through `request_user_input`; authorization is scoped to exact URLs, local analysis, bounded duration, and the stated retention policy.
4. Record authorization with `directorx_record_reference_download_consent` before `yt-dlp` execution.
5. Inspect extracted evidence and emit `reference_learning_report.json`. Download alone is not learning.
6. Connect every promoted insight to a Director directive, Style rule, shot, audio cue, edit decision, or explicit rejection.

## Learning Report Minimum

- `analyzedReferenceIds`: sources actually inspected.
- `observations`: source/frame/time-range evidence, separated from inference.
- `directorRules`: transferable narrative, camera, sound, pacing, or performance rules.
- `styleUpdates`: observable condition/direction/evidence/failure/repair rules.
- `shotImpacts`: affected shot IDs and intended change.
- `blockedReuse`: pixels, clips, audio, music, subtitles, logos, copy, or protected likeness that cannot transfer.
- `degradedRoute`: refusal, access failure, missing transcript, or metadata-only analysis.
- Convert every reference insight into an artifact field that another agent can consume.

## Domestic Platform Focus

- Douyin: strong first-frame context, dense subtitle, audio-driven retention, comment trigger.
- Kuaishou: practical utility, trust signal, conversational tone, less polished human texture.
- Bilibili: structured explanation, chapter-like flow, terminology accuracy, lower subtitle pressure.
- Xiaohongshu: cover-title clarity, lifestyle proof, list-like structure, save/share cue.
- WeChat Channels: trustworthy pacing, public-account linkage, moderate subtitle density.
