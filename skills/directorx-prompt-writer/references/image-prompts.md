# Image prompts

## Key element mode

Use for reusable characters, products, props, or locations. Emphasize identity and construction, not dramatic action.

```text
[subject identity and stable physical definition], [neutral readable pose or object orientation], [wardrobe/product construction and materials], [distinctive anchors], [simple environment or clean reference background], [even readable lighting], [view and framing], [required aspect ratio]. Preserve [continuity locks]. Exclude [conflicts].
```

## Keyframe mode

Choose exactly one moment:

- start frame: state before motion
- end frame: immediate state after motion
- highlight frame: strongest dramatic or visual beat

```text
[shot size and camera position]. [subject] is [visible pose/action state] in [environment]. [foreground/midground/background and occlusion]. [lens and focus]. [key light direction, quality, contrast]. [dominant/secondary/accent colors]. [materials and atmosphere]. Preserve [identity and scene locks]. Exact visible text: "[text]" if required. Exclude [unwanted changes].
```

## Image-to-image mode

Name the transformation and preservation boundary separately:

```text
Transform: [one requested change].
Preserve exactly: [identity, geometry, wardrobe, composition, palette, text, or other locks].
May vary: [permitted dimensions].
```

Do not ask for a complete redesign while also demanding exact preservation.

## Review

- subject count and anatomy are correct
- identity/product geometry matches references
- action is readable in one still frame
- composition serves the shot purpose
- light directions are physically coherent
- palette has a clear hierarchy
- required text is exact
- no accidental text, watermark, logo, or extra object
