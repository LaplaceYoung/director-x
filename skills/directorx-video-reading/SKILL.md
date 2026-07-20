---
name: directorx-video-reading
description: Read local, uploaded, or explicitly authorized reference videos in Director X using adaptive transcript cues, keyframes, scene summaries, focused time ranges, or exhaustive full-frame evidence. Use when Codex must inspect what happens in a video, ground observations to timestamps, or put visual evidence onto the live canvas.
---

# Director X Video Reading

Turn a video into inspectable, timestamped production evidence. This skill extracts evidence; it does not make visual claims until Codex has opened the returned frames or contact sheet.

## Workflow

1. Resolve the source into the current durable Run.
   - For a project-local or user-uploaded file, pass its project-contained path or registered video artifact.
   - For a URL, first create and resolve the native `reference_download` interaction, call `directorx_record_reference_download_consent`, and then call `directorx_ingest_reference_video`. Never download inside the read tool.
2. Choose the smallest profile that can support the claim:
   - `transcript_only`: import SRT, VTT, or Director X transcript JSON; optionally pin a few cue frames.
   - `fast_keyframes`: rapid orientation and first visible result, capped at 50 frames with uniform fallback.
   - `scene_summary`: default visual reading, capped at 100 scene/evenly distributed frames with deduplication.
   - `full_frame_evidence`: every decoded frame plus independent frame-count parity; use only for claims covering the complete source.
3. Call `directorx_read_video`. Use `startSeconds` and `endSeconds` for a focused question rather than decoding unrelated material.
4. Prefer available native captions. Otherwise call `directorx_transcribe_media_with_whisper`, then pass the registered transcript artifact or project-contained transcript path into the read.
5. When the transcript reveals important beats, pass their timestamps as `cueTimestamps`. Cue frames are pinned ahead of sampled frames.
6. Open and inspect the contact sheet and relevant individual frame artifacts. Tie every observation to a timestamp or bounded range. Separate visible facts, spoken facts, and creative inference.
7. Keep the complete frame set folded behind the manifest. The canvas should show the source, contact sheet, transcript, and no more than the useful representative frames.
8. Preserve rights boundaries. A `reference_only` source remains reference-only through every derived frame and transcript artifact; do not move its pixels, audio, subtitles, or logos into the deliverable.

## Output Contract

The tool persists:

- `video_read_receipt.json`
- `video_read_manifest.json`
- timestamped JPEG evidence frames
- a bounded representative contact sheet
- optional normalized transcript JSON
- independent frame-identity evidence for `full_frame_evidence`

Read `references/video-reading-playbook.md` for profile selection, evidence language, and failure handling.
