# Remotion production

Prefer readable, ordinary React and TypeScript compositions.

Start with the smallest template that can deliver the approved idea:

- image and video sequencing
- titles, subtitles, and lyrics
- basic transforms and opacity animation
- cuts, fades, wipes, and simple masks
- audio placement, gain, and fades
- landscape and portrait output

Render a low-resolution preview first. Put the playable preview on the canvas, collect concrete feedback, then render the final version. Do not build a visual timeline editor inside Director X.

Create the initial sequence from current canvas objects:

```bash
node <plugin-root>/scripts/directorx.mjs compose --project <project-path>
```

Render the review copy:

```bash
node <plugin-root>/scripts/directorx.mjs render --project <project-path> --quality preview
```

After concrete feedback, update the canvas inputs, rerun `compose`, then render with `--quality final`. Rendered files must stay inside the project and are added back to the canvas automatically. Existing Remotion outputs are excluded from later input specs to prevent recursive renders.
