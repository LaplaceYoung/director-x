# Cinematography And Audio Playbook

## Shot Language Skill Cards

| Card | Rule | Artifact fields |
| --- | --- | --- |
| Narrative shot | Bind each shot to one emotion or information beat before choosing camera. | `story_beat`, `emotion`, `visual_question`, `subject_priority` |
| Spatial setup | Scene changes need space, direction, subject position, entrance, or exit. | `establishing_shot`, `screen_direction`, `location_anchor` |
| Character intimacy | Move closer for emotional proximity; adjust height for power relation. | `shot_size`, `camera_height`, `lens_mm`, `depth_of_field` |
| Isolation/pressure | Use negative space, hard light, wide composition, and subject offset. | `negative_space_ratio`, `key_light`, `composition_balance` |
| Motivated movement | Movement must reveal, follow, pressure, release, disorient, connect, or transition. | `movement_type`, `movement_reason`, `start_frame`, `end_frame`, `easing` |
| Continuity | Maintain axis, eyeline, action, props, clothing, light direction, and screen direction. | `axis_of_action`, `eyeline`, `match_on_action`, `continuity_anchor` |

## Prompt Schema

```json
{
  "scene_intent": "what the viewer should feel or understand",
  "story_beat": "information or emotion turn",
  "subject": "primary and secondary subject",
  "shot_size": "extreme wide / wide / medium / close-up / extreme close-up",
  "camera_position": "front / profile / over-shoulder / high / low / eye-level",
  "lens_language": "wide intimacy / normal realism / telephoto compression",
  "composition": "centered / rule-of-thirds / negative-space / layered-depth",
  "movement": {
    "type": "static / push-in / pull-back / tracking / pan / tilt / handheld / crane",
    "motivation": "reveal / follow / pressure / release / disorient / connect",
    "speed": "slow / medium / fast",
    "easing": "linear / ease-in / ease-out"
  },
  "duration_seconds": 2.5,
  "edit_role": "establish / reaction / insert / transition / climax",
  "audio_cue": "dialogue-led / music-hit / ambience-led / silence",
  "continuity": {
    "screen_direction": "left-to-right",
    "axis": "maintain",
    "props": ["same object position", "same wardrobe", "same lighting direction"]
  }
}
```

## Camera Movement Rules

- Static: clarity, observation, tension, compression.
- Push-in: realization, temptation, pressure, importance.
- Pull-back: loss, reveal, isolation, scale.
- Tracking: goal, journey, process, spatial relation.
- Handheld: instability, documentary feeling, subjective urgency.
- Crane/drone: scale, fate, transition, location shift.

## Music Spotting Map

```json
{
  "cue_id": "M01",
  "start_tc": "00:00:00.000",
  "end_tc": "00:00:18.000",
  "hit_points": ["00:00:03.000 hook reveal", "00:00:12.000 graph transformation"],
  "mood_change": "curiosity to confidence",
  "music_role": "pulse under explanation",
  "rights_status": "royalty_free_or_generated",
  "mix_note": "duck 8 dB under narration"
}
```

## Mix Rules

- Narration/dialogue is primary.
- Music supports pace and emotion, then ducks under speech.
- SFX marks transitions, object changes, impacts, or UI actions.
- Ambience should create space without masking voice.
- Remotion can prototype volume curves with frame functions.
- FFmpeg can batch mix with `amix`, `sidechaincompress`, `afade`, `acrossfade`, and `loudnorm`.
- Track loudness and true peak in render reports. Use platform specs when available.

## Review Checklist

- Shot intent is explicit.
- Subject hierarchy is readable.
- Movement motivation is stated.
- Continuity anchors are preserved.
- Beat timing matches edit and music hits.
- Cue map includes timecodes, hit points, mood, rights, and mix notes.
- Voice remains intelligible after music and SFX.
- Subtitles sync with narration.
- Render evidence includes ffprobe, frame samples, audio duration, and loudness notes.

## Source Anchors

- ASC shot craft references: https://theasc.com/article/shot-craft-where-do-you-put-the-camera/, https://theasc.com/article/shot-craft-analyzing-a-script/, https://theasc.com/article/shot-craft-the-cinematographers-reel/
- Film editing reference: https://open.library.okstate.edu/introfilmtv/part/editing/
- Remotion timing, audio, transition, and render references: https://www.remotion.dev/docs/use-current-frame, https://www.remotion.dev/docs/audio/volume, https://www.remotion.dev/docs/transitions/transitionseries, https://www.remotion.dev/docs/renderer/render-media
- Music supervision references: https://www.documentary.org/feature/keeping-your-films-soundtrack-track-why-you-may-need-music-supervisor, https://www.berklee.edu/careers/roles/music-supervisor-filmtv, https://www.guildofmusicsupervisors.com/what-is-a-music-supervisor
- Audio ducking and loudness references: https://helpx.adobe.com/premiere/desktop/add-audio-effects/adjust-volume-and-levels/automatically-duck-audio.html, https://ffmpeg.org/ffmpeg-filters.html, https://tech.ebu.ch/docs/r/r128v4_0.pdf
