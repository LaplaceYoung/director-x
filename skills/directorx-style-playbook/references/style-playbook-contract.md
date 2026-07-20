# Director X Style Playbook Contract

## Purpose

The Style Playbook is the executable visual-and-audio constitution derived from `Director.md`. It is not a moodboard, adjective list, provider prompt, or second creative brief.

## Required shape

```json
{
  "director_binding": {
    "fingerprint": "sha256:...",
    "inherited_directive_ids": ["DIR-VISUAL", "DIR-CAMERA"],
    "override_records": []
  },
  "style_thesis": "One sentence describing the audience-facing experience",
  "visual_language": "Observable image behavior",
  "world_rules": [],
  "cinematography_rules": [],
  "lighting_color_rules": [],
  "performance_rules": [],
  "edit_rhythm_rules": [],
  "audio_rules": [],
  "subtitle_rules": [],
  "negative_style_rules": [],
  "evaluation_rules": [],
  "learning_policy": {}
}
```

## Rule grammar

Each production rule should contain:

- `rule_id`: stable ID.
- `inherits`: Director directive IDs.
- `condition`: when the rule applies.
- `direction`: observable instruction.
- `story_function`: emotion, information, relationship, proof, or transition role.
- `evidence`: how a reviewer can verify it.
- `failure_signals`: concrete defects.
- `repair_delta`: smallest upstream correction.
- `source_pattern_ids`: research patterns informing the rule.
- `confidence`: researched, tested_once, repeated, or director_approved.

## Director1-derived principles

1. Start from emotion and story function, then choose framing, movement, light, and sound.
2. One shot carries one primary idea; remove shots with no narrative or information job.
3. Build entity, scene, prop, keyframe, voice, and style anchors before generation.
4. Ground named entities, logos, factual claims, product behavior, foreign text, specific actions, and requested references.
5. Prompt observable action and change through time; let references carry stable appearance.
6. Route by capability and control requirements. Simplify weaker-model tasks and strengthen anchors.
7. Generate bounded candidates, evaluate, select, and repair the smallest upstream cause.
8. Cut on action, preserve screen direction, and use audio bridges to carry continuity.
9. Fail closed at quality gates; do not pass defects downstream.

## Research-backed precision

- Camera movement begins with script intent and should add drama, mystery, attention guidance, or relationship change. “Move because movement looks cinematic” is invalid.
- J-cuts lead the next scene's audio before the picture; L-cuts carry the prior audio after the picture changes. Record overlap duration and narrative purpose.
- Generated-video evaluation must separate surface quality from intrinsic faithfulness: human fidelity, controllability, physics, commonsense, object permanence, relation stability, causal compliance, flicker, and transition completion.
- Initial and final state anchors reduce ambiguity for temporal compositional changes. Complex state changes should be split when completion cannot be reliably evaluated.

## Learning loop

`style_learning_log.json` records candidate evidence without silently mutating project style:

- hypothesis and affected rule;
- source run, shot, provider/model, prompt delta, and assets;
- measured/reviewed result;
- failure class or accepted improvement;
- promotion status and approver.

A lesson becomes a Style rule only when repeated across at least two relevant shots/runs or explicitly approved by the director/user. Provider-specific quirks remain model knowledge, not universal style.
