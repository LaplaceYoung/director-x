---
name: directorx-asset-sourcing
description: Plan and audit assets for DirectorX video production, including user uploads, stock media, generated keyframes, product materials, music, SFX, fonts, logos, citations, rights checks, and asset_plan artifacts.
---

# DirectorX Asset Sourcing

Use this skill to build a rights-aware asset plan for video production.

## Workflow

1. Inventory required assets from `Director.md`, script, shotlist, style, audio, subtitle, and platform needs.
2. In parallel with `DX-Reference-Analyst`, call `directorx_register_asset_search_plan`, then actually execute Codex web search and open current, strongly relevant source pages. Search official sources first, then public-domain and clearly licensed image/video libraries, then platform/community sources when they add reference value. Persist host search/open receipts through `directorx_record_web_research`; a query written into JSON without real host execution and plugin page verification is not research. For brand/company work, explicitly look for the official Logo, product UI/product imagery, and every named location or landmark needed by the story.
3. Open the original source page and resolve a public original-image HTTPS URL. Never acquire a search-result thumbnail, hotlinked proxy, authenticated URL, or unexplained CDN result.
4. Before downloading editorial, social, reference-only, unknown-rights, or otherwise uncertain material, create a native `reference_download` interaction with gate key `asset-download:<assetId>`, execute the returned Codex `request_user_input`, and pass its resolved request ID to `directorx_acquire_web_image_asset`. Approval authorizes bounded local analysis only; it never grants reuse rights. For `yt-dlp`, use the separate source-scoped reference-video consent gate.
5. Call `directorx_acquire_web_image_asset` for each selected web image. It must return a locally saved file, SHA-256, source page, resolved image URL, retrieval time, rights status, license evidence, attribution, intended use, fallback, and any required native authorization before the asset counts as acquired.
6. Use `directorx_register_asset` for user uploads, generated media, or already-local files. Classify every item as user-owned, generated, stock, public-domain, licensed, cited reference, or unavailable. Public visibility does not imply commercial reuse rights.
7. As `DX-Asset-Manager`, call `directorx_audit_asset_quality` for every selected downloaded image/video before it enters research conclusions, prompt anchors, generation references, or the edit. Probe the real file and score relevance, visual quality, composition, artifacts, dimensions, aspect, duration, audio, and rights fit for either `reference_analysis` or `delivery`.
8. Call `directorx_audit_visual_asset_coverage` against the categories required by `Director.md` and the story. The audit reopens the real raster and verifies its SHA-256, receipt, contained path, rights label, license/attribution evidence, and passing quality audit; a caller-asserted local path cannot pass. Do not finalize research while required Logo, product/interface, location/landmark, or visual-reference coverage is missing.
9. After the real `shotlist.json` exists, call `directorx_compile_shot_grounding_plan`. Execute every per-shot named-entity, Logo/product/interface, person/location/landmark, exact-text, factual-claim, continuity, user-asset, and weak-model task. Then call `directorx_finalize_shot_grounding` with durable evidence and explicit transfer rules. A reference-only item may support fact/style learning but cannot become a generation anchor; `generation_anchor` and `delivery_asset` resolutions require a local file, compatible rights, and the ready quality audit from step 7.
10. Define acquisition route, provider slot, cost range, rights note, and fallback. Record technical constraints: aspect ratio, resolution, alpha, frame rate, loudness, file format, and safe area.
11. Emit `asset_plan.json`, `shot_grounding_plan.json`, and `shot_grounding_report.json`, then update provider routing. Do not treat reference-only images as delivery pixels; retain them as visible, cited learning assets and generate/license a replacement.

## Output Contract

```json
{
  "asset_id": "asset_001",
  "role": "thumbnail_background",
  "source_route": "generated",
  "rights_status": "project_generated",
  "technical_requirements": {},
  "fallback": {}
}
```

## Reference

Read `references/asset-sourcing-checklist.md` for asset categories and rights notes.
