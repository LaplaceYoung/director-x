---
name: directorx-production-review
description: Review DirectorX production outputs including shot candidates, draw-loop attempts, continuity drift, edit decisions, render reports, and final QA. Use when work touches generated video evaluation, clip selection, memory updates after review, cost stop conditions, or editing quality gates.
---

# DirectorX Production Review

## Overview

Use this skill to judge whether generated assets can move forward, need retry, need rerouting, or need a user-facing tradeoff decision.

## Workflow

1. Read the relevant shot spec, route decision, budget state, memory state, and delivery promise.
2. Review the output against success criteria.
3. For video, sample evidence frames/intervals and bind every material finding to `timeSeconds`, `frameRef`, dimension, and observation. Score world consistency and action completeness in addition to surface quality.
4. Decide: accept, retry with prompt delta, switch provider, create reference, split shot, simplify action, request approval, or stop.
5. Update attempt log, shot review report, continuity report, selected clips, and memory patch.
6. Preserve approved delivery promise and budget constraints.
7. Record each candidate through `directorx_review_generation_candidate`, then select only an accepted candidate through `directorx_select_generation_candidate`. A mean score cannot hide a critical dimension below 0.5.
8. When defects are local and repairable, call `directorx_create_repair_branch` with explicit time/region scope. The repair output must be a new file and candidate registered through `directorx_complete_repair_branch`; review it independently before selection. Never overwrite the source candidate.
9. Use the canvas A/B inspector to synchronize the source and repaired candidates and jump to durable defect/evidence timecodes. Read every open `canvasReviewNotes` item from the Run snapshot as user-authored production feedback. Acknowledge ownership through `directorx_update_canvas_review_note`, convert the note into a bounded repair or edit action, and resolve it only after the resulting evidence artifacts are registered. Preserve the original note body. Canvas feedback is never an approval, never satisfies a gate, and never replaces `directorx_select_generation_candidate` or native final approval in Codex.
10. After an output artifact is registered, call `directorx_bind_execution_lineage` before recording telemetry. Bind the canonical `DX-xxxxx` owner, capability, tool, provider, exact model version, prompt-contract ID and SHA-256, active Director fingerprint, and SHA-256 input/output artifact entities. Never learn from an execution whose lineage cannot be reproduced.
11. After a tool reaches a terminal result, call `directorx_record_tool_execution` with the lineage binding ID, actual cost, latency, outcome, failure class, quality score, and durable review evidence. Successful media outputs without timecoded review evidence may not become learning samples.
12. At the Review stage, call `directorx_compile_route_feedback`. Treat `route_regret_report.json` as an empirical prediction-error proxy, not causal counterfactual regret. Review every proposed patch through a durable `knowledge` interaction and pass its resolved request ID to `directorx_review_model_knowledge_patch`. Use the same native gate for revocation. Accepted knowledge affects future routes only; it may never mutate the current approved route.
13. Final review is tier-aware and owned by `DX-Quality-Reviewer`. Call `directorx_verify_final_media` with `preview`, `review`, or `publish`; require `frame_audit_report.json` from constant-memory exhaustive decoded-frame coverage and `frame_identity.jsonl` from an independent PTS pass. The identity stream binds media SHA-256, stream index, decode ordinal, raw timestamp ticks, time base, count parity, and VFR cadence; raw int64 ticks must remain strings outside safe integer range. Also verify canonical semantic-timeline source diversity, A/V duration alignment, EBU R128 integrated loudness and true peak, declared Mock components, rights clearance, and technical playback. One background repeated under changing subtitles is one visual cluster, not multiple shots.
14. Blank/white/flash/freeze/low-motion signals are review candidates. Inspect identity-verified before/trigger/after frames, canonical clip/ranges, nearby audio/captions, and `Director.md`. Decode, coverage, timestamp-identity, or missing-evidence failures are technical blockers and cannot be visually waived.
15. Inspect `scene_coverage_conformance_report.json` before frame-finding acceptance. Every planned shot must bind canonical timeline clips, real source handles, exhaustive frame coverage, and PTS identity. Inspect the registered first/middle/last evidence frames for camera, lens and distance intent, blocking and action phase, composition depth, lighting, movement motivation, edit fit, fallback validity, and coverage-role fulfillment; then call `directorx_record_scene_coverage_review`. Technical blockers cannot be waived.
16. Call `directorx_record_final_review_evidence` with one structured disposition and evidence-backed reason per frame-audit finding only after scene coverage is `conformant`. Persist both the current alias and `final_review_evidence/<reviewId>.json`; do not request delivery or post-production approval before structured reviewer acceptance.
17. When review confirms a defect, load `directorx-frame-audit-repair`. Any repair branch or Director X Cut patch must carry `repairLineage` to the versioned review, audit, repair plan, source-media hash, and finding IDs. Material changes require native approval. Commit invalidates current review/delivery state; rerender and repeat the full audit/reviewer cycle on the new media hash.

## Review Layers

- Artifact reviewer: schema, completeness, downstream consumability.
- Prompt reviewer: camera language, conflicts, provider fit.
- Shot reviewer: quality, subject consistency, action, style, continuity.
- Continuity reviewer: timeline, entity, voice, music, and scene drift.
- Cost reviewer: budget, attempt value, stop conditions.
- Edit reviewer: pacing, story logic, beat sync, voice/subtitle alignment.
- Render reviewer: exhaustive decoded-frame coverage, corruption/blank/flash/freeze/motion defects, playback, duration, resolution, visual-cluster coverage, timeline/source diversity, A/V alignment, EBU R128 loudness, true peak, Mock/placeholder status, rights, and export integrity.

## Failure Types

- `prompt_unclear`
- `shot_too_complex`
- `provider_weakness`
- `reference_missing`
- `budget_insufficient`
- `video_type_mismatch`
- `entity_drift`
- `style_drift`
- `motion_failure`
- `edit_mismatch`

## References

Read `references/review-rubric.md` when defining scoring rules or review reports.
