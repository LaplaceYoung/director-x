# Director X

Director X is being rebuilt from scratch as a lightweight, Codex-native video creation plugin.

The plugin gives Codex:

- an infinite side canvas containing only images, video, audio, and production text;
- reference-video acquisition and analysis with `yt-dlp`, FFmpeg, and FFprobe;
- focused visual prompt-writing guidance derived from professional image and video workflows;
- Codex-native user questions and specialist subagents;
- simple Remotion composition and rendering.

Director X does not add a workflow engine, database, MCP orchestration layer, custom chat system, or agent state graph.

## Current foundation

Initialize a project:

```bash
node scripts/directorx.mjs init --project /path/to/project
```

Start the canvas:

```bash
node scripts/directorx.mjs canvas --project /path/to/project
```

Analyze a local or approved remote reference:

```bash
node scripts/directorx.mjs analyze \
  --project /path/to/project \
  --input /path/to/reference.mp4 \
  --title "Reference film"
```

Add production text or project-owned media:

```bash
node scripts/directorx.mjs add \
  --project /path/to/project \
  --type text \
  --title "Storyboard" \
  --text "Shot 1..."
```

## Development

Requires Node.js 22 or newer.

```bash
npm run check
npm test
npm run validate:plugin
```

The managed FFmpeg/FFprobe/yt-dlp runtime and Remotion templates are the next implementation milestones.
