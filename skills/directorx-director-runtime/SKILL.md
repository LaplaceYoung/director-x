---
name: directorx-director-runtime
description: Maintain Director.md and Director Runtime behavior for DirectorX. Use when editing video type guides, shot language, cinematography rules, memory protocol, budget-aware directing, search protocol, quality review, editing protocol, or model-facing director outputs.
---

# DirectorX Director Runtime

## Overview

Use this skill when work touches the director core: `Director.md`, video type strategy, shot planning, long-video memory, prompt transformation, or creative review rules.

## Workflow

1. Read `references/director1-core-contract.md`, then create the project-level `Director.md`. The generated document must carry the Director Agent role, input/output contract, C1–C6 operating principles, Step0–Step9 main loop, shot-plan contract, routing, Grounding, eval-select, continuity, audio, QC rollback, and approval rules defined by `Director1.md`.
2. Classify the requested video type and production objective.
3. If strategy-changing fields are ambiguous, ask up to three necessary structured questions. Translate the resolved language into audience response, hook, beats, shot scale, movement, composition, light, palette, performance, sound, rhythm, continuity, and negative rules.
4. Call `directorx_record_intent_resolution`, then `directorx_write_director_document`. Treat the returned `Director.md`, `director_contract.json`, and fingerprint as required intake evidence. Do not reduce Director.md to a brief, moodboard, or generic prompt strategy.
5. Invoke `directorx-style-playbook` after research. Style operationalizes Director intent and may not contradict it without an approved override record.
6. Require every downstream artifact to cite the active Director fingerprint and inherited directive IDs.
7. Version each model-facing prompt as a prompt contract with a stable ID and SHA-256. Runtime generation lineage must bind that prompt contract and the active Director fingerprint before execution telemetry is accepted.
8. Include memory fields whenever continuity matters.
9. Include provider hints only as capability requirements, leaving vendor choice to routing.
10. Include review criteria for every shot or stage output.
11. Require `transition_language_plan.json` for every multi-shot sequence. Each boundary must inherit Director intent and identify its action/emotion/eyeline/graphic evidence, screen direction, audio bridge, executable renderer kind, fallback, and review bar.

## Director Output Requirements

- Video type and rationale.
- Core emotion or business objective.
- Style playbook anchors.
- Shotlist with purpose, duration, camera, composition, color, audio, and success criteria.
- Memory injection and update notes.
- Search needs for references or model capability facts.
- Quality review criteria.
- Editing implications.
- Motivated boundary language: cut trigger, action overlap, J/L bridge, first/last-frame handoff, renderer recipe, and fallback.
- Resolved user decisions and explicitly labeled safe inferences.
- Web research questions, visual-asset needs, reference-video assessment, and rights boundaries.
- Style constitution: thesis, world behavior, texture/material, typography/graphics, and temporal grammar.
- Fingerprinted inheritance rules for Style, script, shots, prompts, edit, and review.

## Video Type Defaults

- Vlog: authenticity, continuity, natural rhythm.
- Commercial: product clarity, hook, hero shot, brand memory.
- Microfilm: motivation, emotional progression, scene continuity.
- Dance: full-body readability, beat alignment, limb integrity.
- Education/explainer: structure, synchronized voice/subtitles, relevant visuals.

## References

Read `references/director-output-schema.md` when designing or changing structured outputs.
