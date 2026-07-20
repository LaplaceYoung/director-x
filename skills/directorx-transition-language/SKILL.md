---
name: directorx-transition-language
description: Compile Director X multi-shot boundaries into motivated visual and audio transitions, executable renderer recipes, fallbacks, and review gates.
---

# Director X Transition Language

For every multi-shot sequence, read `Director.md`, `shotlist.json`, `keyframe_storyboard.json`, and `continuity_plan.json`.

Choose each boundary from evidence:

- action midpoint → `match_action`
- reaction/emotion peak → `cut_on_emotion`
- stable subject + eye trace + screen direction → `match_eyeline`
- aligned shape/position/scale/light → `graphic_match`
- compatible high-energy motion → `whip_pan`
- semantic overlap → `cross_dissolve`
- chapter/location/time change → `dip_to_black`
- broken direct continuity → `bridge_frame`
- intentional graphic-world change with Remotion/HyperFrames → `shader`

Call `directorx_compile_transition_language_plan` before Storyboard completion. Preserve its prompt handoffs, J/L or ambience bridge, boundary-frame requirements, renderer recipe, fallback, and review criteria. Match-action prompts must say “继续…” in the incoming shot and must not restart the action.

Bind every rendered boundary back to `transition_language_plan.json` through `render_quality_contract.json`. The contract must compile an exact cut frame or transition window, easing, timeline overlap, outgoing/incoming source handles, required boundary-frame refs, J/L or room-tone offsets, runtime adapter identity, and renderer instruction. Do not render when any of those fields or boundary order drifts from the approved plan.

For Remotion, pass a JSON props file whose `directorxTransitionExecution` binding contains the current contract fingerprint, plan/sequence identity, and exact ordered boundary IDs. `TransitionSeries.Transition` shortens the composition by its overlap duration; reconcile that overlap against the semantic timeline instead of trimming the outro. Custom zoom-blur, whip-pan, shader, dip-to-black, or fade-through-color transitions require a named runtime adapter.

After render, inspect before/trigger/after frames and audio around every boundary. Repair action restart, jump axis, eye-trace jump, flash, double exposure, freeze, or audio discontinuity before delivery.
