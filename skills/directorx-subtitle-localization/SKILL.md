---
name: directorx-subtitle-localization
description: Design Chinese subtitles, bilingual captions, terminology localization, mobile readability, SRT/ASS timing, subtitle emphasis, safe-area placement, and platform-specific caption rules for DirectorX videos.
---

# DirectorX Subtitle Localization

Use this skill to create platform-ready subtitles and localized on-screen text.

## Workflow

1. Read script lines, TTS timing, platform profile, and safe-area rules.
2. Segment subtitles by spoken rhythm and mobile readability.
3. Apply terminology rules: keep proper nouns stable, explain technical terms visually, avoid over-translation.
4. Mark emphasis tokens sparingly for covers, hooks, and key claims.
5. Generate SRT/ASS-ready timing notes and collision checks.
6. Record platform variants for Douyin, Kuaishou, Bilibili, Xiaohongshu, and WeChat Channels.

## Output Contract

```json
{
  "subtitle_id": "sub_v1",
  "language": "zh-CN",
  "platform": "douyin",
  "segments": [],
  "style": {},
  "safe_area": {},
  "risk_notes": []
}
```

## Reference

Read `references/subtitle-localization-guide.md` for segmentation and platform style rules.
