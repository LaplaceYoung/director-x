# Longform Adaptation Guide

## Hierarchy

`project -> episode -> sequence -> scene -> beat -> shot -> camera_node -> asset_node`.

## Memory Buckets

- Character: appearance, voice, goal, relationship, state changes.
- Location: layout, lighting, geography, entry/exit directions.
- Object: product details, props, ownership, transformations.
- Story: promises, reveals, callbacks, unresolved questions.
- Style: palette, camera grammar, music motif, subtitle system.

## Review Strategy

- Use best-of-k for identity, key reveal, action, product proof, and emotional climax.
- Check continuity before editing to avoid hiding core story breaks.

## First/Last-Frame Segment Chain

- Keep model clips short enough for reliable motion and identity control; duration is provider-dependent and must come from the approved routing record.
- Segment 1 starts from an approved storyboard keyframe. Its accepted final frame becomes the immutable start anchor for segment 2.
- Repeat sequentially. Never launch dependent segments in parallel before their input end frame exists.
- Preserve subject identity, pose/action phase, screen direction, lens feel, camera velocity, depth layout, lighting direction, time of day, weather, product state, and graphic state.
- Include 0.2–0.8 seconds of planned action overlap when a match-on-action join is intended; trim duplicate action during editing.
- Prefer a hard match cut when boundary similarity is strong. Use a short dissolve only for motivated time/space changes. Generate a bridge clip when geometry or motion cannot be repaired editorially.
- Review a boundary window containing the last 8–12 frames of segment N and first 8–12 frames of segment N+1.
- Audio is not segmented mechanically with video. Carry room tone, music, SFX tails, and dialogue prelap across the join.

## Camera Dependency And Reference Review

- Group recurring compositions into stable camera IDs and bind every child shot to an earlier parent shot/frame.
- Same-camera continuation normally uses `reuse`; a motivated new angle uses `reference_recompose`; a generated camera move uses `transition_extract`.
- The compiler may expose independent branches in one execution wave, but a segment that consumes another segment's accepted end frame remains sequential.
- Before multimodal review, reject references with failed quality evidence, unusable rights, duplicate identity, or a source shot later than the target shot.
- `DX-Reference-Analyst` reviews the actual images, retains forced parent-frame anchors, and records evidence for identity, spatial, environment, and style fit.
- Every generation request binds the Camera Graph Clip task and all approved first/last-frame reference target IDs.

## Required Artifacts

- `longform_segment_plan.json`: ordered beats, duration and generation request per segment.
- `frame_handoff_manifest.json`: exact end-frame-to-start-frame lineage and boundary acceptance criteria.
- `longform_stitch_plan.json`: selected clip paths, candidate IDs, transition decisions, boundary reviews, audio continuity and render strategy.
- Record accepted deviations as explicit creative decisions.
