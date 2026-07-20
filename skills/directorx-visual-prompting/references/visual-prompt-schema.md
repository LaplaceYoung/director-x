# Visual Prompt Schema

## Select the Generation Mode First

| Mode | Prompt responsibility |
| --- | --- |
| `text_to_image` | stable visual state, subject, scene, composition, light, material, typography intent |
| `image_edit` | one requested mutation plus a closed set of invariants |
| `text_to_video` | visible state plus subject, camera, environment, timing, and audio responsibility |
| `image_to_video` | what moves after the input frame; do not re-describe established appearance |
| `first_last_frame_video` | one physically plausible path between two audited boundary states |
| `video_extension` | inherit the previous ending action phase, identity, camera vector, light, and audio tail |

Never compile one universal prompt and send it to every mode.

## Image Prompt Layer Order

1. Delivery purpose and shot function.
2. Subject and required identity or product invariants.
3. Action, pose, or stable state.
4. Setting, props, and spatial relationships.
5. Camera framing, viewpoint, composition, and lens feel.
6. Lighting direction and quality, color, material, and texture.
7. Exact-text intent and the elements reserved for deterministic overlays.
8. Reference roles, mutable fields, and fields that must remain unchanged.
9. Platform constraints: frame, safe area, subtitle space.
10. Provider-specific exclusion policy and review criteria.

Allowed reference roles:

```text
identity
product_geometry
layout
pose
style
palette
lighting
```

Every reference must have a rights/quality-audited local asset and one declared role. A reference may have two roles only when the model supports that combination and the review can score them separately.

Represent the control contract explicitly:

```json
{
  "referenceBindings": [
    {
      "assetRef": "asset://product-front",
      "role": "product_geometry",
      "preserve": ["silhouette", "button positions", "material finish"],
      "mutable": ["background", "camera distance"]
    },
    {
      "assetRef": "asset://campaign-style",
      "role": "style",
      "preserve": ["graphic treatment", "contrast rhythm"],
      "mutable": ["subject", "layout"]
    }
  ]
}
```

## Video Prompt Layers

```json
{
  "mode": "image_to_video",
  "visual_state": {},
  "subject_motion": {},
  "camera_motion": {},
  "scene_motion": {},
  "action_beats": [],
  "ending_state": {},
  "scene_physics": [],
  "audio_contract": {},
  "negative_policy": {},
  "reference_bindings": [],
  "evaluation_contract": {}
}
```

- One short clip gets one primary subject action and one camera intention.
- Translate emotion into visible performance: breath, gaze, posture, hand tension, pace, and reaction.
- Keep subject, camera, and scene motion in separate fields and detect direction or speed conflicts.
- Timestamps are allowed only when every action can plausibly fit the selected duration.
- Exact dialogue, narration, music, subtitles, Logo, and product data stay out when another approved track owns them.

## First/Last-Frame State Contract

Both boundaries record:

```text
identity
pose
action_phase
gaze
screen_position
screen_direction
prop_state
lighting_direction
camera_pose
camera_vector
motion_energy
audio_tail
```

The transition prompt describes the path, not two unrelated states. Insert a bridge frame or split the shot when the gap is implausible for the duration. Incoming match-action shots say “continue the action” and may not restart it.

## Provider Policies

- OpenAI Image: compile explicit sections and one mutation per edit; high input fidelity is not a pixel lock. Treat recurring identity, exact text, and precise layout as review risks, and move deterministic typography/UI to composition.
- OpenAI Sora: describe shot type, subject, action, setting, and lighting. `input_reference` establishes the first frame; reusable character assets are a separate control. Extensions inherit the source clip, and focused edits should change one thing.
- FLUX.2: place required subject/action first, use medium-length prose by default, assign explicit roles to multiple references, and express exclusions as positive desired states because it has no negative prompt.
- Midjourney: Style Reference controls visual treatment, Omni Reference controls a person/object, and both are version/weight dependent.
- Stable Diffusion / ComfyUI: checkpoint, seed, steps, CFG, sampler, denoise, ControlNet, and LoRA are workflow parameters and evidence.
- Runway Gen-4.5: prefer positive, observable motion; I2V text focuses on motion already absent from the input frame.
- Veo: combine subject, action, style, camera, composition, lens, ambiance, and pacing. Keep API parameters such as last frame, seed, sample count, and negative prompt outside prose; list unwanted elements rather than writing negative instructions.
- Luma keyframes: boundary frames define states; prompt defines the intermediate path.

## Repair Patterns

Candidate review does not authorize an improvised retry. Call `directorx_compile_generation_repair` and execute only its declared `controlVariable`. If the compiler routes the defect to editing, grounding, shot design, provider approval, or a stop condition, do not convert that decision back into a prompt regeneration.

| Failure | Repair action |
| --- | --- |
| Identity drift | Restate invariant markers and remove conflicting style terms. |
| Product mismatch | Add product geometry, logo placement, color, and forbidden variants. |
| Text artifacts | Remove generated text from image/video; reserve typography for edit layer. |
| Motion jitter | Reduce action complexity and shorten duration. |
| Subtitle collision | Reserve lower-middle safe area and simplify background. |
| Low contrast | Increase separation between subject, background, and caption area. |
| Action overload | Keep one primary action, shorten duration, or split into shots. |
| Action restart | Carry outgoing action phase into the incoming prompt using continuation language. |
| Boundary teleport | Insert a bridge frame or reduce the difference between start and end state. |
| Reference conflict | Remove competing roles and assign one reference per control responsibility. |
| Provider rejection | Check model/version/endpoint capability before changing creative intent. |

## Provider Notes

Keep provider-specific syntax and hard parameters in adapter metadata. The durable artifact expresses capability needs, references, boundary state, and constraints in Director X terms.

The compiled artifact records `generationStrategy.promptDialect` separately from capability evidence. A model can support image-to-video while still requiring a different prompt dialect, reference-role limit, or negative-policy adapter than another image-to-video model.

Official baselines used for these transfer rules:

- OpenAI Image generation guide: `https://developers.openai.com/api/docs/guides/image-generation`
- OpenAI Video generation guide: `https://developers.openai.com/api/docs/guides/video-generation`
- Black Forest Labs FLUX.2 prompting guide: `https://docs.bfl.ai/guides/prompting_guide_flux2`
- Google Veo video generation guide: `https://ai.google.dev/gemini-api/docs/video`
- Google video prompt guide: `https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/video-gen-prompt-guide`

## Candidate Review

Apply hard gates before aesthetic scoring:

- exact subject and product identity;
- required composition and safe area;
- readable or overlay-routed text;
- action completion and physical contact;
- first/last-frame state match;
- no unassigned dialogue, music, or captions;
- rights and policy eligibility.

Then score prompt adherence, composition, identity/geometry, motion, physics, light/color, editability, cost, and latency. Keep every candidate and failed attempt; do not preserve only the winner.
