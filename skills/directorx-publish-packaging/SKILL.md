---
name: directorx-publish-packaging
description: Package DirectorX outputs for domestic platforms, including titles, covers, descriptions, tags, hashtags, CTAs, derivative cuts, compliance notes, export filenames, and publish_package artifacts.
---

# DirectorX Publish Packaging

Use this skill to turn a rendered video into platform-ready publishing materials.

## Workflow

1. Read final review, platform profile, semantic timeline, script, cover frames, and risk notes.
2. Create title variants: search-friendly, curiosity-driven, utility-driven, and brand-safe.
3. Select cover frame or cover composition and write cover text within platform constraints.
4. Produce description, hashtags, topic tags, interaction prompt, and pinned comment.
5. Define derivative versions: shorter cut, longer Bilibili cut, Xiaohongshu note version, WeChat repost version.
6. Emit publish package with file paths, metadata, compliance warnings, and missing items.

## Output Contract

```json
{
  "platform": "xiaohongshu",
  "title_options": [],
  "cover_options": [],
  "description": "",
  "hashtags": [],
  "interaction_prompt": "",
  "derivative_versions": []
}
```

## Reference

Read `references/publish-packaging-guide.md` for platform packaging patterns.
