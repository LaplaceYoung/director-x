---
name: directorx-script-craft
description: Write, revise, and structure DirectorX video scripts for Chinese platforms. Use for hooks, narration, dialogue, educational explainers, product demos, short drama scenes, Xiaohongshu notes, Bilibili chapters, Douyin/Kuaishou short-video scripts, retention beats, CTAs, and script-to-shot artifacts.
---

# DirectorX Script Craft

Use this skill to turn user intent into platform-native scripts that downstream shot, audio, subtitle, and publishing agents can execute.

## Workflow

1. Classify video type: explainer, product, review, vlog, short drama, tutorial, interview, screen demo, avatar talk, or mixed format.
2. Select platform pattern and duration band.
3. Write a beat map before prose: hook, setup, proof, turn, payoff, CTA.
4. Split script into timestamped lines with speaker, visual intent, subtitle priority, and sound cue.
5. Create alternate openings for short-video platforms and a calmer opening for Bilibili or WeChat.
6. Add compliance notes for claims, medical/financial/legal sensitivity, minors, copyright, and platform risk.
7. Before Script completes, call `directorx_compile_claim_proof_map`. Every factual line requires a named proof shot, an observable visual/audio proof, and durable source evidence. Vision or opinion lines without proof require an explicit disclosure. Remove or soften unsupported claims instead of illustrating them with generic AI imagery.

## Output Contract

```json
{
  "script_id": "script_v1",
  "platform": "douyin",
  "duration_seconds": 60,
  "beats": [],
  "lines": [],
  "subtitle_priority_terms": [],
  "cta_options": [],
  "risk_notes": []
}
```

The stage also requires `claim_to_proof_map.json`; a script file alone is not a production-ready handoff.

## Reference

Read `references/script-patterns.md` for platform beat maps, hook formulas, and revision checks.
