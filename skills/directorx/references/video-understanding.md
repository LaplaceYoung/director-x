# Video understanding

Use FFprobe and FFmpeg as evidence preparation for Codex, not as a substitute for visual judgment.

1. Preserve the original source and provenance.
2. Separate audio at 48 kHz.
3. Run `directorx analyze`. It extracts every frame for references up to five minutes and a 2 fps proxy for longer material.
4. Review the generated evidence in this order:
   - `contact-sheet.jpg` for the whole-film structure
   - every `shot-board-*.jpg` page
   - `shots.json` and `shot-list.md`
   - dense frame ranges around motion, typography, and transitions
   - `color-system.svg` against the source frames
   - separated audio against the source video
5. Treat automatic scene boundaries and sampled colors as hypotheses. Verify them against the playable source.
6. Inspect each shot for:
   - time range and duration
   - narrative purpose
   - shot size and composition
   - camera and subject motion
   - lighting, contrast, color, texture
   - typography and UI
   - transition and edit rhythm
   - dialogue, music, effects, silence, and beat sync
7. Separate transferable technique from protected expression. Recreate principles, not source pixels, brand assets, performances, or copy.
8. Put the reference, audio, shot boards, color card, completed shot analysis, visual system, and original remake plan on the canvas.
9. Keep the generated `metadata.kind=color-card` node visible and connected to its reference. It is a required creative-decision artifact, not disposable extraction output.
