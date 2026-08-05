# Video prompts

## Temporal structure

A video prompt describes change:

1. reference mapping
2. opening state
3. camera behavior
4. primary subject action
5. environmental and secondary motion
6. ordered beats
7. ending state
8. continuity and audio constraints

```text
References: [which input controls identity, wardrobe, product, scene, first frame, last frame, or audio].
Opening: [visible initial state].
Camera: [one clear movement or a short ordered sequence].
Subject: [physical action with direction, speed, amplitude, and expression changes].
Space: [environmental motion, depth changes, occlusion, light changes].
Beats: [first observable beat, then next beat, then final beat].
Ending: [stable final state suitable for the next edit].
Preserve: [continuity locks].
Audio: [model owns audio / external master audio / silent generation].
Exclude: [identity drift, geometry changes, unwanted text, extra subjects, unwanted audio].
```

## Motion rules

- Prefer one dominant camera intent per shot.
- Describe body motion by parts, direction, force, and sequence.
- Keep subject and camera movement distinguishable.
- Replace vague speed words with observable motion when possible.
- Use exact timecodes only if the provider documents reliable time control.
- For complex action, split the shot instead of stacking instructions.
- Design the final pose, camera direction, and environmental motion as a handoff to the next shot.

## Image-to-video

Animate what the source image can support. If limbs, product sides, or background depth are missing, reduce motion or create a better reference first.

Do not restate every visual property already fixed by the start frame. Spend prompt space on motion, temporal change, and preservation.

## Audio-driven video

Treat approved audio as the timing master:

- map visible reactions and actions to actual audio events
- do not invent dialogue, lyrics, effects, or musical changes
- do not request duplicate music or voice when audio is supplied externally
- keep the shot range continuous with the master timeline
- regenerate the shot when sync fails; do not silently rewrite approved audio

## Multi-shot generation

Use only when the provider explicitly supports it and the beats form one coherent generation unit. Mark cut order clearly, but avoid compressing unrelated locations, identities, and actions into one request.
