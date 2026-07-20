# Asset Sourcing Checklist

## Asset Categories

- `company_logo`: official brand mark or a reference-only candidate pending an official user asset.
- `product_interface`: official product UI screenshots or screen captures.
- `product_image`: photos, packshots, CAD/3D renders, and official product visuals.
- `landmark`: factual place/context imagery such as a city skyline or named building.
- `office`, `team`: official company environment and people imagery with consent/rights notes.
- `visual_reference`: art, composition, palette, or scene reference that is not reused as delivery pixels.
- People: avatar, host photo, character board, consent records.
- Scene: backgrounds, locations, props, texture plates.
- Audio: narration, music bed, stingers, SFX, room tone.
- Typography: font, subtitle style, cover title style.
- Evidence: screenshots, references, citations, source links.

## Rights Labels

- `user_owned`: uploaded or explicitly provided by user.
- `project_generated`: created by DirectorX provider during run.
- `licensed`: usable under recorded license.
- `public_domain`: reusable under recorded public-domain evidence.
- `attribution`: reusable only with recorded attribution terms.
- `reference_only`: usable as cited information or inspiration; pixels cannot enter delivery.
- `unknown`: downloaded for inspection but blocked from delivery until rights are resolved.
- `blocked`: replace before render/export.

## Web Acquisition Gate

- Open the original source page; do not use a search-results thumbnail URL.
- Prefer a public original PNG, JPEG, WebP, or GIF over an authenticated or signed CDN URL.
- Persist source page URL, resolved image URL, retrieval time, SHA-256, local path, rights evidence, intended use, attribution, and fallback.
- Call `directorx_acquire_web_image_asset`; a link alone does not satisfy the asset inventory.
- Call `directorx_audit_visual_asset_coverage`; required categories must have real local files before research finalizes.

## Technical Checks

- Vertical video target: 1080x1920 preferred.
- Keep subtitle background clean in lower safe area.
- Use edit-layer typography for readable text.
- Music and SFX need loop, ducking, and loudness notes.
