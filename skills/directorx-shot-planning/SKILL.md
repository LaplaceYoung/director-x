---
name: directorx-shot-planning
description: Create DirectorX shot plans, camera dependency graphs, scene breakdowns, and shot-level production loops. Use for storyboard planning, visual grammar, lens/movement choices, budget-aware shot difficulty, long-video camera nodes, and shotlist artifacts.
---

# DirectorX Shot Planning

Use this skill to translate scripts and references into executable shot plans.

## Workflow

1. Read script beats and platform profile.
2. Query `directorx_query_director_knowledge` with the active shot functions, model modes, and camera problem. Apply only evidence-located transfer rules; keep source videos, audio, prompts, logos, and protected creative expression out of production assets.
3. Assign each beat a shot purpose: hook, context, proof, transition, emotion, product, CTA, or continuity anchor.
4. Choose shot type, framing, movement, subject, background, and required asset. A camera move must change intimacy, spatial understanding, causal understanding, or proof strength; otherwise keep it locked.
5. Register the real `shotlist.json`, then call `directorx_compile_scene_coverage_plan`. For each scene define its action/eyeline/interaction axis, required geography/action/reaction/proof coverage, and every shot's coverage role, focal length plus intent, camera side/height/azimuth/distance, motivated blocking, foreground/midground/background, normalized lead/head/negative space, focus strategy, key direction, color temperature, real head/tail handles, and fallback.
6. Repair the coverage plan until `ready`. Missing geography, primary action, proof, reaction, blocking, real generated-video handles, stable light direction, or a valid shotlist SHA blocks Storyboard. Focal length, camera distance, and shot scale must be physically coherent; perspective is a camera-position relationship, not a focal-length label.
7. Use returned setup groups and execution waves to reduce setup churn and parallelize independent shots. Execution order may group a stable camera/light/model/reference setup, but it must preserve edit order identity and first/last-frame dependencies.
8. Score difficulty by subject consistency, motion complexity, text legibility, physics, lip sync, duration, and provider risk. Define attempt budget and fallback path per shot.
9. For every multi-shot sequence with recurring character, product, scene, UI, or style anchors, define camera ID, earlier parent shot/frame, `reuse|reference_recompose|transition_extract` handoff, canonical first frame, required last frame, and reference requirements.
10. After the user approves the exact video provider/model, call `directorx_compile_camera_continuity_graph` with its observed first/last-frame, transition-video, and reference limits. Never invent capability support or silently drop an end frame.
11. Dispatch `DX-Reference-Analyst` to inspect the actual eligible candidate images and call `directorx_review_camera_references` for every first/last-frame target. Rights/quality failures, future-shot references, removed forced anchors, or missing required entities block generation.
12. For every adjacent shot pair, record scene/location/time, screen direction, eye trace, motion vector, action phase, emotion/energy, recurring subjects, graphic anchors, and audio edge state. Call `directorx_compile_transition_language_plan` only after the scene coverage plan is ready.
13. Call `directorx_review_shot_sequence` after the transition plan is ready. The runtime hashes and rereads the real shotlist; every reviewed shot ID, order, purpose, duration, and target duration must match it. Supply narrative function, scale, movement and motivation, scene geography, axis and eyeline, action phase, emotional energy, information load, and caption units. Declare CTA/proof requirements from the approved script and pass the intended beat-level emotional arc.
14. Repair every blocker before generation. Axis, eyeline, action, duration, lighting, blocking, handles, and unmotivated movement failures may be waived only as an intentional exception with a specific Director reason and durable evidence reference; the review keeps the break visible as a warning.
15. Preserve returned match-action “继续…” prompt handoffs, J/L or ambience bridges, boundary frame requirements, renderer recipes, fallbacks, and review criteria.
16. Call `directorx_compile_shot_grounding_plan` against that same registered shotlist. Declare named entities, exact text, factual claim IDs, user assets, continuity sensitivity, generation mode, and model tier per shot. After `DX-Reference-Analyst` and `DX-Asset-Manager` finish the source/rights/quality tasks, call `directorx_finalize_shot_grounding`.
17. Compile visual prompts only after the scene coverage plan, sequence review, and grounding report are ready. Their shot order, purpose, duration, shotlist hash, review hash, grounding hash, and authorized per-shot generation anchors must match the approved sequence. Bind every later video request to its Camera Graph Clip node, transition boundary, ready sequence review, grounding evidence, and approved reference target IDs. Execute only tasks in the same returned wave concurrently.
18. Emit `shotlist.json`, `scene_coverage_plan.json`, `transition_language_plan.json`, `shot_sequence_review.json`, `shot_grounding_plan.json`, `shot_grounding_report.json`, `camera_dependency_graph.json`, `reference_selection_plan.json`, `long_video_dependency_graph.json` when applicable, and draw-loop criteria.

## Output Contract

```json
{
  "shot_id": "s01",
  "beat_id": "hook",
  "purpose": "make concept visible",
  "duration_seconds": 4,
  "coverage_role": "geography|master|primary_action|proof|insert|reaction|cutaway|bridge|hero|cta",
  "scene_axis": {},
  "camera": {},
  "blocking": [],
  "composition": {},
  "lighting": {},
  "handles": {"head_seconds": 0.5, "tail_seconds": 0.5},
  "camera_parent": {},
  "handoff_strategy": "reuse|reference_recompose|transition_extract",
  "first_frame_asset_ref": "",
  "last_frame_asset_ref": "",
  "last_frame_policy": "auto|required|forbidden",
  "reference_requirements": {},
  "subject": {},
  "motion": {},
  "difficulty": {},
  "fallback": {}
}
```

## Reference

Read `references/shot-planning-rubric.md` for shot functions, difficulty scoring, and graph rules.
