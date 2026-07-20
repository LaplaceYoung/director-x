# Render Composition Guide

## Pattern Selection

Choose the smallest deterministic Remotion pattern that carries the approved story function:

| Pattern | Use | Required evidence |
| --- | --- | --- |
| `product_hero` | product reveal, feature proof, brand close | product asset, safe-area layout, approved copy |
| `kinetic_typography` | verbal hook, emphasis, quote, chapter | word/line timing, semantic emphasis, reading-speed review |
| `data_story` | charts, counters, comparisons, progress | source data, unit/axis labels, claim-to-proof binding |
| `screen_demo` | software workflow or feature proof | real capture/state source, cursor plan, readable crop |
| `audiogram` | interview, podcast, voice-led content | decoded audio, word timing, real waveform data |
| `brand_end_card` | final identity and CTA | approved Logo, exact legal text, CTA, hold duration |

Do not start from an unrestricted generic composition when one registered pattern fits. Do not execute arbitrary model-generated React; validate imports, assets, frame determinism, network access, and runtime side effects first.

## Layer Order

1. Background video or generated scene.
2. Overlays and product graphics.
3. Transitions and effects.
4. Captions and cover text.
5. Dialogue/narration.
6. Music bed.
7. SFX accents.

Each scene consumes a typed `SceneSpec`:

```ts
type SceneSpec = {
  id: string;
  from: number;
  durationInFrames: number;
  purpose: "hook" | "setup" | "proof" | "turn" | "payoff" | "cta";
  media: MediaRef[];
  graphics: GraphicCue[];
  copy: CopyCue[];
  captions: CaptionCue[];
  audio: AudioCue[];
  transitionIn?: TransitionSpec;
  transitionOut?: TransitionSpec;
};
```

The Player and final renderer must consume the same props. A preview-only mutation or render-only fallback is drift and must be recorded.

## Motion Rules

- Derive motion from `frame`, `fps`, local scene time, and semantic cues.
- Use `interpolate()` for deterministic position, opacity, crop, mask, color, and progress.
- Use `spring()` only when the object needs physical weight; tune damping to avoid decorative bounce.
- Drive waveforms and audio-reactive graphics from decoded audio analysis, never random geometry.
- Animate typography by semantic unit: word, phrase, line, or number. Do not apply one entrance preset to every token.
- Keep exact brand text, data, prices, UI labels, and legal copy in HTML/CSS/SVG layers rather than generated pixels.

## Transition and Overlay Rules

- A `TransitionSeries.Transition` overlaps scenes and shortens total duration.
- A `TransitionSeries.Overlay` spans the cut without changing adjacent scene duration.
- Compile total duration after transition overlap; fail before render when it differs from the semantic timeline.
- Select a boundary from story evidence: action, eye trace, shape, position, motion, light, sound, or chapter change.
- A hard cut is valid. A generic dissolve is not automatically smoother or more cinematic.
- Transition duration cannot exceed either adjacent scene, and transitions/overlays cannot be stacked in the same boundary slot.

## Preflight Checks

- All referenced files exist.
- Duration matches platform profile tolerance.
- Transition overlap is reconciled against the approved duration.
- Player props and render props have the same schema and values.
- Model-generated Remotion code passed import, asset, network, and determinism validation.
- Captions do not collide with key visual subjects.
- Audio ducking preserves speech clarity.
- Opening, scene midpoints, transition midpoints, longest-caption frames, and the end card pass sanity renders.
- Export metadata records provider, command, timestamp, and file hashes when available.

## Final Quality Gates

- Decode every expected frame; sparse samples are not delivery evidence.
- Inspect before / trigger / after evidence around every transition boundary.
- Reject unexplained black/white frames, flashes, freezes, duplicate runs, subtitle tails, A/V drift, and source repetition.
- Treat intentional holds, title cards, flashes, and low-motion scenes as reviewer dispositions, not detector auto-fixes.
- Verify integrated loudness, true peak, narration coverage, music ducking, and rights evidence.

## Common Repairs

- Missing clip: use fallback image motion or regenerate shot.
- Audio too loud: duck music under narration.
- Caption overflow: shorten line, split line, reduce emphasis tokens.
- Blank render: inspect Remotion props and asset paths first.
- Slideshow feel: add internal scene changes, product/data layers, audio-driven motion, or replace the source shot; do not add more dissolves.
- Unmotivated transition: replace with a hard cut or bind it to action, shape, movement, light, or sound evidence.
- Duration drift: recompute TransitionSeries overlap instead of trimming the end silently.
