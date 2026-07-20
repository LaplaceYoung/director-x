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

## Generation Mode Routing

| Mode | Capability evidence required | Prompt dialect responsibility |
| --- | --- | --- |
| `text_to_image` | output size/aspect, text limits, seed/determinism, content policy | subject-first or provider section order, exclusion policy |
| `image_edit` | input fidelity, mask/edit support, reference count and size | one mutation plus explicit invariants |
| `text_to_video` | duration, aspect, resolution, native audio, motion limits | observable subject/camera/scene motion and ending state |
| `image_to_video` | first-frame/reference semantics, accepted dimensions, duration | motion-only delta from established appearance |
| `first_last_frame_video` | distinct boundary-frame support and constraints | one plausible path between audited states |
| `video_extension` | source clip compatibility and maximum extension | continuation of inherited action/camera/audio state |

## Prompt Dialect Evidence

Record prompt dialect as adapter evidence, not a generic model label:

- OpenAI Image: focused edits and explicit invariant sections; input fidelity is not a pixel lock.
- OpenAI Sora: observable shot description; first-frame input, reusable characters, focused edits, and extensions are distinct controls.
- FLUX.2: subject/action first, medium prose by default, positive constraints, explicit multi-reference roles.
- Google Veo: cinematic components in prose; boundary frames and negative elements remain API-level controls.
- Runway: positive observable motion; image-to-video avoids re-describing appearance fixed by the input frame.
- Seedance/Wan and other providers: store exact model/version/mode documentation and probe evidence before assigning a dialect.

Capability evidence answers whether a route can execute. Prompt-dialect evidence answers how Director X must compile the same creative contract for that route. Keep both, because a successful API request is not evidence that the provider received an effective prompt.
