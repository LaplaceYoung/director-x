# Layered Collage Playbook

## Source

- Ji Baiyu, “我用 Codex + Remotion，做了一条唐朝纸片分层动画”, X Article, 2026-07-13.
- Source post: `https://x.com/vbjby3/status/2076530524110369070`
- Article: `https://x.com/i/article/2076528939640782848`

The source demonstrates a local pipeline in which Codex coordinates storyboard, image generation, layer extraction, Remotion composition, TTS, subtitles, sound and FFmpeg review. Director X generalizes the method without copying the source project, characters, code, assets or exact visual expression.

## Reusable Production Pattern

1. Script and shot purpose first.
2. People-free background plate.
3. Separate character/object sheet with solid key background.
4. Crop and alpha extraction into independent PNGs.
5. Static staging before motion.
6. Four depth classes: background, rear, primary, foreground.
7. Narrative role motion: primary > secondary > tertiary.
8. Staggered entrances and explicit zIndex.
9. Voice-led duration plus music, chapter SFX and entrance SFX.
10. Remotion frame preview, final render, ffprobe and sampled-frame review.

## Safe Starting Presets

These are editable defaults, not hardcoded style:

| Role | Travel | Rise | Start scale | Purpose |
| --- | ---: | ---: | ---: | --- |
| primary | 78 | 55 | 0.86 | Strongest entrance and settle |
| secondary | 58 | 38 | 0.90 | Supports the primary action |
| tertiary | 38 | 22 | 0.95 | Preserves depth without stealing focus |

- Background scale drift: around 1%, adjusted by shot purpose.
- Entrance order: primary, secondary, tertiary/group completion.
- Visual stack: background → rear → middle → primary → foreground → captions/graphics.
- Use clean single-speaker reference audio without music when an authorized voice-clone route is selected.

## Configurable Alternatives

- Image: Codex ImageGen or any user-approved image provider.
- Alpha: FFmpeg chromakey, local segmentation, provider mask, or supplied PNG.
- Voice: MOSI, F5-TTS, approved external TTS, or human recording.
- Motion: paper-cut, editorial collage, infographic parallax, commercial cutout, archival reconstruction.
- Subject: history, education, business story, city development, relationship map, product narrative.

## Failure Repairs

- Flat image: split subjects into independent layers and increase real occlusion/parallax.
- Wrong hierarchy: change scale and z-order before increasing motion.
- Clipped body: regenerate full-body source or adjust crop; do not hide with framing by default.
- Green spill/holes: tune similarity/blend, regenerate cleaner background, or use a mask route.
- Everyone enters together: stagger delays by narrative role.
- Floating feet: align a shared ground plane and reduce rise/settle.
- Busy audio: duck music under voice and reserve strong impacts for primary beats.
- Subtitle collision: use one caption system and preserve subject/prop safe areas.
