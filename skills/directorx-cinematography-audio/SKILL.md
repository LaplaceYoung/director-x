---
name: directorx-cinematography-audio
description: Apply professional cinematography, shot language, camera movement, continuity, edit rhythm, music supervision, audio ducking, loudness, and quality review rules to DirectorX prompts, shotlists, Remotion timelines, and final review.
---

# DirectorX Cinematography And Audio

Use this skill when a video needs production-grade shot language, camera movement, composition, continuity, edit rhythm, soundtrack choice, audio mix, or final audiovisual review.

## Workflow

1. Read `references/cinematography-audio-playbook.md`.
2. Bind every shot to a story beat, viewer emotion, and information function.
3. Choose shot size, camera position, lens language, composition, movement, and edit role.
4. Add continuity anchors: scene axis, screen direction, eyeline, props, wardrobe, lighting direction, color temperature, and action match.
5. Compile `scene_coverage_plan.json` against the real shotlist before transitions. Require geography/action/reaction/proof coverage as needed; bind focal length to camera distance and shot scale, blocking to action phases, composition to foreground/midground/background and negative-space purpose, lighting to scene continuity, and every generated-video edit point to real head/tail handles.
6. Define the intended emotional-energy curve and information density by beat. Use shot duration, scale, movement, reaction, and silence to shape that curve rather than applying a uniform pace.
7. Call `directorx_review_shot_sequence` after the coverage and adjacent-transition plans are ready. Treat 180-degree direction, eyeline, matching action, duration coverage, lighting continuity, edit handles, and movement motivation as evidence-bearing checks; treat scale variety and rhythmic contrast as intention-aware review dimensions.
7. Build a music spotting map and audio mix plan.
8. Express cue gain, fades, LUFS targets, true-peak limits, and measurement methods as machine-readable fields.
9. Feed Remotion/FFmpeg requirements to rendering and review artifacts.
10. Run `directorx-av-production-evidence` at the `mix` gate before render handoff.
11. After real shot, subtitle, waveform, and evidence data exist, call `directorx_register_av_review_timeline`. Waveform peaks must be measured/derived data, markers must carry evidence references, and intervals must stay within probed media duration.
12. Use `directorx_analyze_media_waveform` to decode only the visible/review window with local FFmpeg. It emits bounded normalized min/max pairs; do not synthesize waveform bars from target loudness values.
13. Use `directorx_import_caption_track` for project-contained `.vtt` or `.srt` files. Imported cues use RationalTime milliseconds and remain source artifacts; timeline registration projects them without rewriting the original subtitle file.
14. For long videos, call `directorx_build_waveform_pyramid` once after media probing. It decodes bounded chunks and stores four min/max resolution levels. Use `directorx_get_waveform_window` for the visible time range and pixel width instead of decoding the source again.

## Output Requirements

- Shot intent and story beat.
- Camera and composition language.
- Movement motivation and easing.
- Continuity constraints.
- Edit role and timing.
- Music cue map.
- Dialogue/music/SFX mix plan.
- Review checklist.
- `audio_cue_sheet.json` with numeric timing, gain, LUFS, and true-peak fields.
- Evidence handoff to `semantic_timeline.json`, `render_report.json`, and `final_review.json`.

## Quality Bar

- Every camera move needs narrative motivation.
- Every multi-shot sequence needs ready `scene_coverage_plan.json` and `shot_sequence_review.json`; intentional discontinuity must name its emotional/story purpose and evidence.
- Dialogue clarity wins over music energy.
- Every music cue needs mood, hit points, rights status, and mix note.
- Final review must include continuity, rhythm, loudness, subtitle sync, and render evidence.
- Measurements must come from the assembled output; target values are not measured evidence.
