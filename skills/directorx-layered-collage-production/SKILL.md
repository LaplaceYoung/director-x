---
name: directorx-layered-collage-production
description: Produce configurable layered paper-cut, collage, parallax, historical explainer, relationship, commercial-story, and flat-asset animation videos through ImageGen, chroma/alpha extraction, narrative staging, role motion, TTS, Remotion, and FFmpeg QA.
---

# Director X Layered Collage Production

Use this skill when the visual idea can be decomposed into background, rear, primary subject, and foreground layers that move independently.

## Required Pipeline

1. Resolve script, aspect ratio, fps, duration, narrative hierarchy, image provider, extraction route, TTS route, voice/likeness rights, and budget through Codex-native confirmation.
2. Select `layered-collage`. Call `directorx_register_layered_collage_plan` before generating assets.
3. Design shots first. Define subject scale, facing direction, eyeline, shared ground plane, occlusion, safe area, entrance order, and audio cue for every layer.
4. Generate people-free background plates. Generate complete characters/objects separately or as a clean source sheet with explicit facing, full body, unclipped hands/feet, paper outline, solid key background, no text/watermark/shadow/scene.
5. For a source sheet, call `directorx_extract_chroma_layers` with reviewed crop rectangles and key settings. Inspect every transparent PNG for spill, holes, clipping, halos, duplicate limbs, and residual background.
6. In Remotion, build the entire scene as a static composition first. Call `directorx_review_layered_collage_phase` with `phase=static_layout`; do not animate until subject hierarchy, overlap, ground contact and subtitle-safe areas pass with frame evidence.
7. Apply motion by narrative role, not uniformly: primary has the strongest travel/settle, secondary supports, tertiary moves least, background uses restrained drift, and foreground may move faster for depth.
8. Stagger entrances. Preserve a clear reveal order instead of filling the frame at once.
9. Build depth through z-order, scale, overlap, paper edge and restrained shadow. Keep text/captions above visual layers without covering faces, hands, feet or story props.
10. Generate/record voiceover and let approved narration timing define scene timing. Mix four explicit audio layers: voiceover, music, chapter SFX and role-aware entrance SFX. Record `phase=motion_audio` with preview evidence; a failed or missing gate blocks Remotion rendering.
11. Preview frame-by-frame in Remotion. Render, probe with FFmpeg/ffprobe and inspect every configured QA frame. Record `phase=final_media` before completing review or presenting delivery approval.

## Configuration Contract

- `generationRoute`: Codex ImageGen or user-approved external provider/model; background and character policies remain separate.
- `extractionRoute`: FFmpeg chromakey, local alpha tool, provider mask, or manually supplied transparent assets.
- `ttsRoute`: MOSI, local F5-TTS, another approved provider, or user recording. Voice cloning requires explicit rights/consent.
- `roleMotion`: configurable primary/secondary/tertiary distance, rise, scale, delay, easing and settle behavior.
- `audioLayers`: provider/path, volume, ducking, loop and cue policy per layer.
- `composition`: Remotion entry point, composition ID, props/script path, QA seconds and output path.
- `styleProfile`: paper edge, outline, shadow, texture, palette and depth treatment; it is a preset, not a hardcoded Tang visual style.
- `captionPolicy`: one-caption-system rule, safe area, line length, font and contrast.
- `qualityPolicy`: editable static-layout, motion/audio and final-media checklists shown as three gates on the production canvas.

All model/provider, voice-clone consent, budget and material strategy decisions stay in Codex `request_user_input`. The canvas visualizes configuration, layers, evidence and gate state; it does not replace native user confirmation.

## Quality Gates

- Background plates contain no baked-in primary subjects.
- Every movable subject is an independent alpha asset.
- Static layout passes before animation work.
- Primary, secondary and tertiary scale hierarchy is visibly distinct.
- Facing, eyeline, feet, overlap and zIndex are intentional.
- Entrances are staggered and SFX land on their actual frames.
- Voiceover remains intelligible above music; captions do not compete with embedded text.
- Final media has expected duration, resolution and audio stream, with sampled-frame evidence.

## Reference

Read `references/layered-collage-playbook.md` for the source-derived pattern and reusable defaults.
