# Frame Audit Detector And Repair Contract

## Evidence semantics

- Director X decodes every output frame to a bounded grayscale analysis frame and processes the stream with constant frame memory. `expectedFrameCount`, `auditedFrameCount`, coverage, and partial-frame evidence make decode completeness explicit.
- A separate FFprobe frame pass writes `frame_identity.jsonl` incrementally. The durable identity is source-media SHA-256 + stream index + decode ordinal + raw `best_effort_timestamp` ticks + stream time base. Ticks remain decimal strings outside JavaScript's safe integer range; display seconds are derived only. Equal PTS values retain distinct ordinals and are not defects by themselves.
- `ffprobe -count_frames` supplies independent `nb_read_frames` parity. Exhaustive analysis uses frame-rate passthrough and never inserts CFR conversion; nominal FPS is not VFR identity.
- FFmpeg `blackdetect` defines black intervals using black-pixel ratio, pixel-luma threshold, and duration; it emits timestamps and frame metadata. Director X treats black/white findings as inspection gates because a fade or deliberate blackout may be valid. Source: https://ffmpeg.org/ffmpeg-filters.html#blackdetect
- FFmpeg `freezedetect` uses mean absolute component differences, a noise floor, and minimum duration. Director X similarly requires a duration-bearing interval and exempts a hold only when the canonical timeline declares it. Source: https://ffmpeg.org/ffmpeg-filters.html#freezedetect
- FFmpeg `scdet` emits per-frame scene-change scores and recommends threshold calibration rather than assuming every large delta is a defect. A Director X flash finding therefore prompts transition inspection; it does not authorize deletion. Source: https://ffmpeg.org/ffmpeg-filters.html#scdet
- PySceneDetect separates content, adaptive, threshold, histogram, and perceptual-hash detectors and exposes rational/PTS-backed timecodes. It is a BSD-3-Clause optional route for future scene-boundary enrichment, not a required Director X dependency. Source: https://github.com/Breakthrough/PySceneDetect

## False-positive review

| Finding | Intentional cases | Required evidence before acceptance |
| --- | --- | --- |
| Black/white interval | fade, chapter break, deliberate blackout | adjacent-shot purpose and declared transition |
| Flash | strobe, hard graphic transition, lightning | Director rule plus frame-neighbour inspection |
| Freeze | title hold, product end card, still-image documentary beat | canonical hold/shot declaration and audio continuity |
| Low motion | screen recording, static lecture slide, restrained portrait | shot purpose and source diversity |
| Decode coverage | none for publish delivery | successful rerender or decoder/probe correction |

Every non-technical candidate requires registered before/trigger/after images selected by exact PTS or decode ordinal. A detector hit without identity-bound evidence is blocked, not guessed. Decode failure, count mismatch, backwards/missing PTS, and incomplete evidence are technical blockers and cannot receive an intentional/false-positive disposition.

## Repair boundary

The repair plan is observational. `DX-Quality-Reviewer` records one structured, versioned disposition per finding through `directorx_record_final_review_evidence`; reviewer judgment cannot mutate the timeline or grant user approval. `DX-Editor` represents confirmed defects as a repair branch or versioned timeline patch carrying `repairLineage` to the review ID/evidence, audit, repair plan, source-media hash, and finding IDs. Material edits use Codex-native approval. Commit invalidates current review/delivery state, and every repaired output receives a new media hash, exhaustive frame/PTS audit, and independent reviewer evidence.
