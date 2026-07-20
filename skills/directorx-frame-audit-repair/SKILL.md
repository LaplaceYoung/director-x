---
name: directorx-frame-audit-repair
description: Localize final-video frame-audit failures into timecoded Director X Cut repair work. Use for black/white frames, flashes, freezes, incomplete decode coverage, unexpectedly static output, or any failed exhaustive final-media review.
---

# Director X Frame Audit Repair

Frame QA is a localization loop: decode every frame, map each finding to the canonical timeline, inspect intent, repair the smallest interval, and prove the rerender.

## Procedure

1. Call `directorx_verify_final_media` for the intended delivery tier. Completion means `frame_audit_report.json` records exact expected/decoded parity and `frame_identity.jsonl` streams one PTS/time-base identity per decoded frame. Screenshots, sparse samples, nominal-FPS estimates, and unsafe int64 coercion do not satisfy this step.
2. Inspect `frame_audit_repair_plan.json`. Every finding must carry source-media SHA-256, PTS ticks/time base, source and parent-timeline ranges, severity, repair action, and—when resolvable—a `trackId`, `clipId`, and media reference.
3. Use the canvas Review timeline to inspect every candidate against its registered before/trigger/after frames, video, nearby shots, captions, waveform, and `Director.md`. Read [the detector and false-positive contract](references/frame-audit-contract.md) when a black frame, flash, freeze, or static interval could be intentional.
4. Dispatch the canonical `DX-Quality-Reviewer`, then call `directorx_record_final_review_evidence`. Every finding receives exactly one structured disposition, rationale, and evidence set. Keep the versioned `final_review_evidence/<reviewId>.json`; a Codex ordinal host suffix is trace metadata only.
5. Choose one evidence-backed action: rerender the canonical timeline, create a bounded repair branch, or open Director X Cut and compile a reversible patch. A repair patch must carry `repairLineage` and each operation must cite its finding plus the versioned review evidence. The finding never mutates the timeline itself.
6. Execute Codex `request_user_input` before any material trim, replacement, narrative change, or delivery-promise change. Commit only the inspected patch and preserve the source revision.
7. A commit invalidates current review and delivery state but preserves versioned history. Rerender to a new media hash, call `directorx_verify_final_media` again, dispatch a fresh `DX-Quality-Reviewer` disposition, and complete only when the repaired markers are gone or explicitly intentional and the requested tier passes.

## Required artifacts

- `frame_audit_report.json`
- `frame_identity.jsonl`
- `frame_audit_repair_plan.json`
- identity-verified `frame_evidence/*.png` for visual candidates
- `av_review_timeline.json`
- `final_review_evidence/<reviewId>.json`
- `timeline_revision.json` or `semantic_timeline.json`
- repair branch or timeline patch evidence when a change is made
- a fresh `final_review.json` after rerender
