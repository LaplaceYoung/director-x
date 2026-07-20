# Routing Matrix

## Difficulty Levels

| Level | Shot Type | Route |
| --- | --- | --- |
| 1 | Static product, simple environment, no person | Low-cost image/video or stock path |
| 2 | Single person, simple action, light camera movement | Balanced video provider |
| 3 | Multiple subjects, dance, fight, complex action, strong continuity | High-quality provider with references |
| 4 | Opening hook, product hero, emotional turn, final memory shot | Premium route, stronger review, higher attempt cap |

## Production Paths

- `stock_video`
- `text_to_video`
- `image_to_video`
- `reference_to_video`
- `motion_graphics`
- `avatar_lipsync`
- `screen_demo`
- `bespoke_render`

## Capability Slots

| Slot | Capability | Routing role |
| --- | --- | --- |
| `llm` | `agent_backend` | plan, script, critique, artifact repair |
| `image` | `image_generation` | keyframe, reference, thumbnail, style frame |
| `video` | `video_generation` | text-to-video, image-to-video, reference-to-video |
| `tts` | `tts` | narration, character voice, timestamps |
| `music` | `music` | bed, loop, intro, outro, emotional cue |
| `sfx` | `sfx` | transition, object, UI, impact, ambience cue |
| `search` | `search` | factual research, stock media, reference lookup |
| `editing` | `editing` | semantic timeline, trim, subtitle, ducking plan |
| `rendering` | `rendering` | Remotion, FFmpeg, cloud render |
| `understanding` | `understanding` | reference analysis, frame QA, video review |

## Routing Rule

Choose the cheapest path that can satisfy the delivery promise, success criteria, and continuity constraints.
