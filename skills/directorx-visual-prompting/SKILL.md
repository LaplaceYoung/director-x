---
name: directorx-visual-prompting
description: Design DirectorX image/video generation prompts for shots, keyframes, thumbnails, style frames, product scenes, character continuity, negative constraints, provider-specific prompt packs, and draw-loop repair prompts.
---

# DirectorX Visual Prompting

Use this skill to convert shot plans into model-ready visual prompts with continuity and repair instructions.

## Workflow

1. Start from `shotlist`, `style_playbook`, `production_memory`, and platform safe area.
2. Query `directorx_query_director_knowledge` for the exact model mode and camera problem. Prefer official model-specific transfer rules over generic prompt folklore.
3. Select one explicit generation mode: `text_to_image`, `image_edit`, `text_to_video`, `image_to_video`, or `first_last_frame_video`. Never reuse one universal prompt across these modes.
3. Write image-state prompts in this order: purpose, subject, action, setting, camera, composition, light, style, constraints. Write image-to-video prompts primarily as observable subject, environment, camera, timing, direction, speed, and ending-state motion. First/last-frame prompts must bind both registered frame refs and the physical path between them.
4. Separate prompt layers: creative intent, hard constraints, continuity memory, platform constraints, provider options, negative prompt.
5. Use official provider/model documents to declare `negativePromptPolicy`, exact-text support, audio support, reference handling, and researched date. Exact brand copy, data, UI labels, and CTA text move to a Remotion overlay whenever the model cannot guarantee them.
6. Reconcile speech, music, and ambience responsibility with `audio_responsibility_plan.json`; a video model may not regenerate narration or music already owned by another track.
7. Add repair prompts for likely failures: identity drift, text artifacts, broken hands, product mismatch, subtitle collision, motion jitter, low contrast, first-frame mismatch, last-frame mismatch, and unusable ending state.
8. Require a ready `shot_grounding_report.json` bound to the same real shotlist before prompt compilation. A shot may use only its own `authorizedGenerationAnchorRefs`; facts, style learnings, or reference-only media stay in evidence/transfer rules and never enter provider reference inputs.
9. Call `directorx_compile_visual_prompt_pack` before Storyboard completes. It must bind the shotlist, sequence-review, and grounding-report hashes. Attach review criteria and draw-loop stop conditions.

## Output Contract

```json
{
  "shot_id": "s01",
  "provider_slot": "video",
  "prompt_layers": {},
  "negative_constraints": [],
  "continuity_keys": [],
  "review_criteria": [],
  "repair_prompts": []
}
```

`visual_prompt_pack.json` is the authoritative provider-executable handoff. Free-text prompts in chat or only inside the shot list do not satisfy the stage. `shot_grounding_plan.json` and `shot_grounding_report.json` are mandatory upstream evidence.

## Reference

Read `references/visual-prompt-schema.md` for prompt layer templates and repair patterns.
