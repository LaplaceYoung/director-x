---
name: directorx
description: Create, understand, remake, edit, or finish a video in Codex with the Director X infinite media canvas. Use when the user wants an MV, promo, short film, reference-video analysis, AI image/video generation, or Remotion composition.
---

# Director X

Director X is a lightweight Codex-native video workspace. Keep the conversation in Codex, use Codex's native tools, and put only useful images, video, audio, and production text on the side canvas.

## Start immediately

1. Run `node <plugin-root>/scripts/directorx.mjs init --project <project-path>`.
2. Run `node <plugin-root>/scripts/directorx.mjs doctor` before media download or analysis.
3. Run `node <plugin-root>/scripts/directorx.mjs canvas --project <project-path>` in a persistent terminal.
4. Open the returned loopback URL in the Codex side Browser and keep that tab available.
5. Use native `request_user_input` only for choices that materially change the result. Do not invent a second interaction protocol.

## Work with Codex, not around it

- Use Codex web search/fetch first. Load `$directorx-web-access` when a page requires browser rendering, login state, scrolling, DOM inspection, or media URL extraction.
- Use `yt-dlp` only after the source and download intent are clear. Preserve source URLs and warn about rights; downloading does not grant reuse rights.
- Use Codex native subagents for independent specialist work. The parent remains the director and the only agent that asks the user questions or decides the final direction.
- Never display agents, workflow nodes, approvals, provider jobs, logs, or internal state on the canvas.

## Understand reference video

For a local video or an approved URL, run:

```bash
node <plugin-root>/scripts/directorx.mjs analyze \
  --project <project-path> \
  --input <video-or-url> \
  --title "<reference title>"
```

Read `references/video-understanding.md` before analysis. Inspect the contact sheet first, then denser frame ranges shot by shot. Analyze timing, composition, camera motion, subject motion, typography, lighting, color, transitions, audio, and transferable creative principles. Add concise findings, storyboard text, and useful visual references to the canvas.

## Direct and produce

- Load `$directorx-prompt-writer` before writing image or video prompts.
- Read `references/multi-agent.md` before delegating research, visual direction, or editing.
- Read `references/remotion.md` before composition.
- Read `references/providers.md` before configuring or calling an image/video generation provider.
- Ask whether the user has an image/video generation provider only when generation is needed. Ask for provider name, model, official documentation, and whether a key is available through native questions. Never ask the user to paste an API key into chat; read it only from the configured local environment variable.
- If the user requires generated media but has no usable key, do not replace the requested generation route with Remotion. Add one generation placeholder per required image or shot to the canvas. Each placeholder must contain the approved prompt, negative constraints, desired output specs, recommended models, and official documentation links.
- A plan, analysis, script, or storyboard is never completion. After the user answers a question, continue in the same task toward a playable video.

## Canvas contract

Add objects with:

```bash
node <plugin-root>/scripts/directorx.mjs add \
  --project <project-path> \
  --type text \
  --title "Storyboard" \
  --text "<markdown-content>" \
  --depends-on <optional-upstream-node-id>
```

The canvas contains only:

- image
- video
- audio
- text: brief, research, lyrics, script, screenplay, storyboard, shot list, visual system, prompt, or edit note

Keep technical artifacts in `.directorx/`; put them on the canvas only when they help the user understand or make a creative decision.

Use Markdown for structured production text. Nodes may stay isolated or depend on upstream material. Dependencies must remain acyclic. Connect existing nodes with:

```bash
node <plugin-root>/scripts/directorx.mjs connect \
  --project <project-path> \
  --from <upstream-node-id> \
  --to <dependent-node-id>
```

## Generation placeholders

Create a placeholder after the shot prompt is production-ready:

```bash
node <plugin-root>/scripts/directorx.mjs placeholder \
  --project <project-path> \
  --modality video \
  --title "Shot 03 — rooftop reveal" \
  --aspect-ratio 16:9 \
  --needs camera,identity,audio,multishot \
  --duration 6 \
  --resolution 1080p \
  --fps 24 \
  --prompt "<approved production prompt>"
```

The placeholder is a structured text object with `metadata.kind=generation-placeholder`. It remains visible and movable on the canvas but is excluded from Remotion composition. Model routes are ranked from shot needs such as `identity`, `multishot`, `complex-motion`, `camera`, `lip-sync`, `audio`, `first-last-frame`, `physics`, `multi-reference`, `text`, `editing`, and `open-source`. Replace it with the generated image or video when access becomes available.
