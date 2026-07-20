---
name: directorx-reference-intake
description: Analyze user-provided reference videos, images, scripts, competitor links, platform examples, or creative inspirations for DirectorX. Use when extracting reusable hook, pacing, shot, subtitle, audio, visual, platform, and safety signals into reference_extraction_plan, style_playbook, shotlist, or platform publishing artifacts.
---

# DirectorX Reference Intake

Use this skill to convert references into transferable production structure. Preserve source attribution and transform patterns into DirectorX artifacts.

## Workflow

1. Use Codex web research for every production. Register an official-first `asset_search_plan.json`, then search authoritative brand/product/factual sources, public-domain and licensed image/video libraries, and strongly related platform/campaign sources; record URLs, dates, queries, provenance, rights, intended use, selection thresholds, and stop conditions.
2. Call `directorx_record_web_research`; identify reference type: finished video, raw clip, product page, script, image board, competitor post, public-library asset, platform trend, or user-uploaded asset.
3. Assess whether external video materially improves action, pacing, product use, camera grammar, visual style, sound, or platform fit. Brand/product films, genre-led work, unfamiliar visual domains, and reference-driven tasks default to `required`; `not_needed` must be justified by production evidence.
4. As `DX-Reference-Analyst`, search at least three strongly related popular or authoritative videos. Rank candidates by semantic relevance, authority/popularity evidence, transfer value, rights risk, technical accessibility, and diversity; do not simply choose the first search result.
5. Present the bounded candidates and learning goals to the user. Persist a native `reference_download` interaction, execute its returned Codex `request_user_input`, and ask whether the exact named sources may be downloaded locally for analysis. State whether the run will use the default bounded section or `fullReference: true`, explain the frame bound and local retention policy, and clarify that authorization is not a reuse-rights grant and no source pixels/audio will enter the deliverable.
6. If approved, call `directorx_record_reference_download_consent` with exact source URLs and IDs, then call `directorx_ingest_reference_video`. If declined, record the declined consent and continue with metadata/pages/thumbnails or licensed/public-domain alternatives. Never bypass private, login-only, or DRM access; ask for a user upload.
7. Immediately call `directorx_read_video` with `scene_summary` for a useful first visual result, or `fast_keyframes` when latency matters more than scene coverage. Use transcript cue timestamps when available. The ingest's complete frame directory stays folded behind its manifest.
8. Use `full_frame_evidence` only when the learning claim covers the complete source. It must produce every decoded frame, independent frame identity, EOF/count parity, and a bounded representative contact sheet; sparse scene-change frames are supplementary, never a substitute for frame-count-complete evidence.
9. As `DX-Asset-Manager`, call `directorx_audit_asset_quality` on every downloaded source or extracted visual selected for learning. Verify decode, dimensions, duration/audio where relevant, semantic relevance, visual/composition quality, artifacts, and rights scope before transferring any lesson downstream.
10. Inspect the actual video-read contact sheet, relevant timestamped frames, and available metadata/transcript/OCR/audio. Do not claim to have learned a source that was not opened and inspected; do not claim complete-source coverage without passing full-frame evidence.
11. For ingested video or user footage, use `directorx-media-evidence-retrieval`: register one source-hashed timebase index, run bounded queries for each learning goal, and finalize evidence bundles before transferring a rule into `Director.md`, style, shots, or editing.
12. Register selected sources and only useful inspection frames with `directorx_register_asset`; keep the complete frame set folded behind `reference_full_frame_manifest.jsonl`.
13. Separate factual observations from creative inference and extract reusable signals: first-frame hook, scene rhythm, camera grammar, product reveal, subtitle style, audio energy, CTA, visual motif, and platform fit.
14. Call `directorx_compile_reference_replication_plan` with evidence-frame indices, source beats, target shot functions, exact generation modes/tool routes, continuity rules, originality changes, fallbacks, and audio responsibilities.
15. Create a reference learning payload with `analyzedReferenceIds`, `observations`, `directorRules`, `styleUpdates`, `shotImpacts`, `blockedReuse`, and degraded-route notes. Every observation cites a source/frame/time range; every learned rule changes a downstream artifact or is discarded.
16. Call `directorx_compile_reference_learning_candidate` for reusable rules, using at least two valid full-frame indices, a bounded source range, transfer rule, originality rule, and blocked-reuse list. The candidate remains reference-only. Persist a `knowledge` interaction and call `directorx_promote_reference_learning` only when the exact Codex `request_user_input` answer approves project-library promotion.
17. Mark rights and usage limits: direct reuse, inspiration only, user-owned asset, licensed source, or citation-required source. Famous commercial videos default to `reference_only`; never move their pixels, audio, music, subtitles, or logos into delivery assets.
18. Produce a transfer plan that adapts structure to the user topic, brand, audience, budget, and platform.
19. Call `directorx_finalize_research` to compile the search plan, reference, quality-audit, analysis, asset, rights, learning, replication, tool-route, and style artifacts.

## Output Contract

```json
{
  "reference_id": "ref_001",
  "source_type": "finished_video",
  "rights_status": "inspiration_only",
  "transferable_patterns": [],
  "blocked_reuse": [],
  "platform_signals": {},
  "artifact_updates": []
}
```

## Reference

Read `references/reference-intake-playbook.md` for detailed extraction rubrics and platform-specific transfer rules.
