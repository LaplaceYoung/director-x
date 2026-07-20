---
name: directorx-media-evidence-retrieval
description: Build source-hashed hierarchical video evidence indexes and bounded multimodal retrieval traces that support shot selection, reference learning, footage editing, factual claims, and evidence-canvas time jumps. Use for long videos, downloaded references, user footage, clip search, moment grounding, or any production decision that must cite source frames, speech, audio, OCR, objects, or actions.
---

# Director X Media Evidence Retrieval

Use one shared evidence index instead of letting each Agent independently summarize or rescan media.

## Workflow

1. Confirm the media is user-owned, licensed, public-domain, or explicitly authorized for bounded local reference analysis. Never treat download consent as reuse rights.
2. Normalize source identity with asset ID, stable URI, SHA-256, rational duration, rational frame rate, source timecode, and any proxy/transcode offset. Canonical time values use `{ value, rate }`; floating-point seconds are a canvas-only projection.
3. Index hierarchical `program`, `sequence`, `scene`, `shot`, and `moment` ranges as needed. Store every range as a half-open interval `[start, start + duration)` using rational start and duration values. Attach modalities, confidence-scored observations, evidence refs, embeddings, and analyzer version/config lineage.
4. Call `directorx_register_media_evidence_index`. Do not overwrite an index ID with different source content.
5. Turn each production information gap into a specific query: include shot function, subject/action, temporal behavior, composition, audio, rights, aspect ratio, quality, continuity, and cost constraints that materially affect selection.
6. Set four hard budgets: rounds, frames, decoded seconds, and monetary cost. Define coverage and top-score acceptance thresholds, then call `directorx_register_video_query_plan`.
7. Retrieve coarse candidates, rerank temporally and cross-modally, inspect only local ranges, and assess whether new evidence closes the declared gap. Record every round with `directorx_record_video_retrieval_trace`.
8. Stop with exactly one reason: `evidence_sufficient`, `budget_exhausted`, `no_new_evidence`, or `user_decision_required`. Preserve rejected and conflicting evidence.
9. Bind each downstream claim to selected moments through `directorx_finalize_evidence_bundle`. Include limitations, coverage and rights status.
10. Use the canvas Evidence Rail to inspect query status and jump to selected source times. If the rail shows `user_decision_required`, ask through Codex `request_user_input`; the canvas does not decide.

## Quality Rules

- Every observation has a source range and confidence; derived captions are not ground truth.
- The global index remains query-independent; queries create overlays and traces, not destructive index rewrites.
- No final claim may cite a moment that was not selected by its retrieval trace.
- Budget exhaustion and lack of new evidence fail closed; do not silently claim sufficient support.
- Reference-only pixels, audio, music, subtitles, logos, and copy remain excluded from delivery.
