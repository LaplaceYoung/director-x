---
name: directorx-visual-prompting
description: Design DirectorX image/video generation prompts for shots, keyframes, thumbnails, style frames, product scenes, character continuity, negative constraints, provider-specific prompt packs, and draw-loop repair prompts.
---

# DirectorX Visual Prompting

Use this skill to convert shot plans into model-ready visual prompts with continuity and repair instructions.

## Workflow

1. Start from `shotlist`, `style_playbook`, `production_memory`, and platform safe area.
2. Query `directorx_query_director_knowledge` for the exact model mode and camera problem. Prefer official model-specific transfer rules over generic prompt folklore.
3. Select one explicit generation mode: `text_to_image`, `image_edit`, `text_to_video`, `image_to_video`, `first_last_frame_video`, or `video_extension`. Never reuse one universal prompt across these modes.
4. Write image-state prompts in this order: purpose, subject, action, setting, camera, composition, light, style, constraints. Write image-to-video prompts primarily as observable subject, environment, camera, timing, direction, speed, and ending-state motion. First/last-frame prompts must bind both registered frame refs and the physical path between them. Extension prompts inherit the complete source clip state and describe only the continuation.
5. Separate prompt layers: creative intent, observable state or motion, typed references, hard constraints, continuity memory, platform constraints, provider parameters, negative policy, and review contract.
6. Bind every provider reference with `referenceBindings`: `assetRef`, one control `role`, fields to `preserve`, and fields allowed to be `mutable`. Do not ask one image to control identity, pose, layout, and style unless the exact provider mode supports multi-role references and review criteria score each role independently.
7. Use official provider/model documents to declare `generationStrategy.promptDialect`, `negativePromptPolicy`, exact-text support, audio support, reference handling, and researched date. Exact brand copy, data, UI labels, and CTA text move to a Remotion overlay whenever the model cannot guarantee them.
8. Reconcile speech, music, and ambience responsibility with `audio_responsibility_plan.json`; a video model may not regenerate narration or music already owned by another track.
9. Classify failures causally: prompt ambiguity, reference conflict, unsupported capability, provider parameter error, identity/geometry drift, composition, motion/physics, boundary mismatch, text, policy/rights, or provider rejection. Repair one controllable variable per attempt so the result teaches the next attempt.
10. Require a ready `shot_grounding_report.json` bound to the same real shotlist before prompt compilation. A shot may use only its own `authorizedGenerationAnchorRefs`; facts, style learnings, or reference-only media stay in evidence/transfer rules and never enter provider reference inputs.
11. Call `directorx_compile_visual_prompt_pack` before Storyboard completes. It must bind the shotlist, sequence-review, and grounding-report hashes. Attach review criteria and draw-loop stop conditions.
12. After the pack is reviewed and its file SHA-256 is verified, hand it to `directorx_register_prompt_bound_generation_plan`. Do not copy prompt prose or provider mode into a second free-form plan; the binding tool compiles `generation_request.json` and locks the initial attempt to the exact prompt, negative policy, duration, mode, parameters, and route.

## Prompt Construction Rules

- Text-to-image: put the required subject and action first, then setting, composition, camera, light, material, style, and constraints.
- Image edit: request one mutation and explicitly close the invariant set; high reference fidelity is still not a pixel lock.
- Text-to-video: describe one observable subject action, one camera intention, scene motion, timing, and an ending state that can be edited.
- Image-to-video: treat the input image as established appearance; prompt what moves, how it moves, what remains fixed, and how the shot ends.
- First/last-frame video: validate both boundary states and describe one physically plausible path. Split the shot or insert a bridge when the distance cannot fit the duration.
- Video extension: inherit identity, composition, camera vector, action phase, light, physics, and audio tail from the complete source; describe only the continuation.

## Draw-Loop Repair Order

1. Reject policy, rights, missing evidence, and unsupported-mode failures without spending another generation attempt.
2. Prefer deterministic post-production for exact text, UI, subtitles, logos, simple crop/color fixes, and audio ownership conflicts.
3. Prefer focused image edit, video edit, extension, or a bridge when most of the candidate is usable.
4. Change one prompt clause, one reference role, or one provider parameter and rerun the same route.
5. Reroute only when capability evidence shows the current model cannot satisfy the shot.
6. Regenerate from scratch only when the candidate has no reusable state or the selected route is fundamentally wrong.

## Output Contract

```json
{
  "shot_id": "s01",
  "provider_slot": "video",
  "prompt_layers": {},
  "referenceBindings": [],
  "generationStrategy": {
    "promptDialect": "provider_and_mode_specific",
    "repairPreference": ["edit", "extend", "bridge", "reroute", "regenerate"]
  },
  "negative_constraints": [],
  "continuity_keys": [],
  "review_criteria": [],
  "repair_prompts": []
}
```

`visual_prompt_pack.json` is the authoritative provider-executable handoff. `generation_request.json` must be mechanically derived from its verified SHA-256 through `directorx_register_prompt_bound_generation_plan`; free-text prompts in chat or only inside the shot list do not satisfy the stage. `shot_grounding_plan.json` and `shot_grounding_report.json` are mandatory upstream evidence.

## Reference

Read `references/visual-prompt-schema.md` for prompt layer templates and repair patterns.
