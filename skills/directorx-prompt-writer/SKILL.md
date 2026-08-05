---
name: directorx-prompt-writer
description: Write production-ready, provider-aware prompts for image and video generation, continuity assets, keyframes, audio-driven shots, and single-variable retries.
---

# Director X Prompt Writer

Turn an approved brief, storyboard beat, and available references into prompts that a generation model can execute. Do not replace creative decisions with adjective piles.

Read:

- `references/visual-language.md`
- `references/image-prompts.md`
- `references/video-prompts.md`
- `references/repair-loop.md`

## Required inputs

Collect or infer only what materially affects the output:

- delivery format: duration, aspect ratio, resolution target
- subject and visible action
- environment and time
- visual direction
- shot purpose and place in the edit
- available image, video, and audio references
- continuity anchors
- audio ownership
- provider, model, and relevant official documentation

If provider behavior is unknown, ask for its official documentation before writing provider-specific syntax. Never assume one model's reference tags, duration limits, audio behavior, or negative-prompt format applies to another.

## Prompt pipeline

1. Separate facts from creative choices.
2. Reuse approved assets before proposing generation.
3. Lock identity, wardrobe, product geometry, location, palette, and typography only when they must persist.
4. Choose the prompt mode:
   - key element
   - start, end, or highlight keyframe
   - text-to-image
   - image-to-image
   - text-to-video
   - image-to-video
   - audio-driven video
5. Write only visible or audible instructions the model owns.
6. Adapt syntax and limits to the chosen provider's official documentation.
7. Add a short quality checklist and explicit exclusions.

## Output

Return:

```text
Intent:
References:
Continuity locks:
Prompt:
Negative constraints:
Expected first frame:
Expected final state:
Review checklist:
```

When the user works in Chinese, write prompt prose in Chinese unless the provider documentation or the user requires another language. Keep exact dialogue, lyrics, and on-screen text in their intended output language.
