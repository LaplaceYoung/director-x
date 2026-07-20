---
name: directorx-render-composition
description: Plan and verify DirectorX rendering, Remotion composition, FFmpeg assembly, audio mix, caption burn-in, preview outputs, render bundles, frame checks, and export evidence artifacts.
---

# DirectorX Render Composition

Use this skill to turn selected clips, audio, captions, and graphics into a previewable render bundle.

## Workflow

1. Read `semantic_timeline`, `selected_clips`, `edit_decisions`, caption plan, and platform profile.
2. Verify all source assets exist and match expected duration, resolution, and format.
3. Map layers: video, dialogue, music, SFX, captions, transitions, effects, color. Every multi-shot boundary must bind to the ready `transition_language_plan.json`.
4. When more than one generated video is selected, require `segment_continuity_plan.json`, one real decoded first/last-frame record per segment, a passed `boundary_continuity_report.json`, and `segment_stitch_plan.json`. Reject clip-order, hash, or boundary-evidence mismatches before composition.
5. Define Remotion props and FFmpeg post-processing steps from the audited stitch order. Multi-segment props must expose `directorxSegmentStitch` with `planArtifactRef=segment_stitch_plan.json`, `boundaryReportRef=boundary_continuity_report.json`, the approved `sequenceId`, and exact ordered `clipArtifactRefs`; runtime hashes and validates this binding. Carry ambience/music with J/L cuts or explicit overlap; a visual crossfade is not a substitute for continuity evidence.
6. Register `render_quality_contract.json` with the exact Director boundary ID, `directorMethod`, `renderKind`, cut trigger, easing, duration/overlap frames, source handles, boundary-frame refs, audio bridge and runtime adapter. The resulting `transitionExecution.contractFingerprint` is the renderer contract. Missing boundaries, action/graphic match drift, insufficient handles, missing J/L execution, unsupported custom adapters, duration drift, and unapproved renderer substitutions block render.
7. For Remotion or HyperFrames, bind that fingerprint, plan/sequence identity and exact boundary order in the same JSON props/binding file passed to the renderer. The render report must retain the validated props hash through final-media verification.
8. Create render evidence: preview path, canonical timeline source, duration, stream/frame counts, loudness, caption sync, bitrate, platform target, segment-continuity gate result, and transition-execution binding.
9. After every candidate render, call `directorx_verify_final_media` to decode every frame into bounded analysis metrics. Persist `frame_audit_report.json` with expected/audited counts, coverage, blank/flash/freeze/motion evidence, exemptions, A/V duration alignment, and flagged timecodes. Sparse frame samples are visual evidence only and cannot satisfy this gate.
10. Populate numeric measured loudness and true-peak fields; attach nonblank evidence frames only for flagged defects and review landmarks rather than persisting every full-resolution frame.
11. Run the shared AV evidence validator at `render`, then `delivery` after final review.
12. Repair and rerender any blocked interval or segment boundary; do not ask for delivery approval before `DX-Quality-Reviewer` accepts the exhaustive report.
13. After the first passed candidate, resolve the native `post_production_edit` gate. If a Director X Cut draft is committed, treat the previous render/review as superseded and call `directorx_render_opencut_timeline`. Its FFmpeg plan must bind the committed Revision/content hash and execute supported trim/order/crop/transition/gain/duck effects with shell-free argv. Then rerun exhaustive frame/audio verification before delivery. A manual-edit receipt or render plan by itself is never final-media evidence.

## Output Contract

```json
{
  "render_id": "render_001",
  "timeline_source": "semantic_timeline.json",
  "outputs": [],
  "preflight": [],
  "quality_checks": [],
  "known_limits": []
}
```

## Reference

Read `references/render-composition-guide.md` for layer order and preflight checks.

From the repository root, validate the artifact bundle with:

```bash
pnpm exec tsx skills/directorx-av-production-evidence/scripts/validate-av-evidence.ts --stage render --bundle .directorx/runs/<run-id>/artifacts
```
