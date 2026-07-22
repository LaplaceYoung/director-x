# Director X Landing Page Anti-Slop Audit

Date: 2026-07-22  
Reference: [Kill AI Slop](https://killaislop.com/)

## Scope

This audit compares the public Director X landing page with the visual and writing failure patterns catalogued by Kill AI Slop. The goal is not to copy the reference site. It is to remove generic trend signals and make the interface read as a video-production instrument.

## Accepted evidence

1. `01-killaislop-reference.png` — reference page captured at the audit viewport.
2. `02-directorx-before-hero.png` — Director X hero before the cleanup.
3. `03-directorx-before-capabilities.png` — Director X capability section before the cleanup.

## What already works

- The page uses real product screenshots and two playable production outputs.
- One signal orange is used consistently.
- The bilingual structure and Chinese font stack are explicit.
- The Three.js scene describes a production graph instead of supplying decorative particles alone.

## High-impact problems

### 1. Competing visual uniforms

The hero combined editorial cream paper, terminal typography, a sci-fi HUD, a Three.js graph, crosshairs, a loader, magnetic buttons, tilt, and kinetic type. Each motif was individually polished, but together they obscured the product identity.

### 2. Decorative hierarchy

Repeated section indices, uppercase eyebrow labels, scene counters, mode buttons, and a large background `CAPABILITIES` word added hierarchy without adding meaning.

### 3. Equal-weight capability wall

Nine bordered feature cards gave every capability the same visual priority and reproduced the familiar SaaS feature-grid pattern. The capabilities are a production chain, so they should read as a continuous operational index.

### 4. Template-shaped copy

Long display sentences and contrast formulas such as “not one model call” made the writing sound generated. Display copy should be short; explanatory copy should state the product behavior directly.

### 5. Motion without production meaning

Pointer replacement, magnetic buttons, generic tilt, character-by-character entrances, and an artificial loader increased motion volume without explaining media creation or lineage.

## First implementation pass

- Removed the custom pointer, loader, chapter rail, scene HUD, scene mode toggles, decorative section indices, magnetic buttons, generic tilt, kinetic characters, and depth-text effect.
- Kept scroll reveals, the production graph, canvas progression, real media playback, and the future-harness orbit because those motions are tied to production state or media.
- Rewrote the hero, canvas, capability, and roadmap headlines in both languages.
- Rebuilt the capability wall as a border-light production index with progressive reveal.
- Added regression assertions for the removed patterns and copy formulas.

## Remaining risks

- The page is still long and contains three large dark chapters; the next pass should tune pacing after real browser review.
- The Three.js graph is semantic at a concept level but still uses abstract geometry. A later pass can map node materials to actual media thumbnails.
- The future-harness section intentionally retains a stronger speculative language; it needs to remain clearly separated from currently shipped plugin capabilities.
