---
name: directorx-web-access
description: Extend Codex web access for Director X research when a page needs browser rendering, login state, DOM inspection, scrolling, interaction, or media URL extraction.
---

# Director X Web Access

Use Codex's native web search and fetch capabilities first. Escalate to this skill only when the target requires a real Chromium session, dynamic rendering, login state, interaction, or direct media inspection.

This skill vendors the small CDP bridge from `eze-is/web-access` so Director X can research references without adding an MCP server or a browser automation framework.

## Before browser control

1. Prefer first-party sources and preserve their URLs.
2. Do not silently operate a logged-in account.
3. Tell the user: browser automation can trigger site protections or account restrictions, and the risk cannot be eliminated.
4. Create new background tabs. Do not take over or close the user's existing tabs.
5. Close only the tabs created for the task.

## Start the bridge

Resolve this skill's directory, then run:

```bash
node <skill-root>/scripts/check-deps.mjs
```

Node.js 22 or newer is required. Follow the command's exit status:

- `0`: the local proxy is ready.
- `2`: ask which detected browser should be used, then either pass `--browser chrome|edge` or save the preference in the generated `config.env`.
- `1`: follow the concrete recovery message. Ask the user only if browser permission or login is required.

The proxy listens on `127.0.0.1:3456` by default. Read `references/cdp-api.md` before using its endpoints.

## Research routing

- Search/discovery: Codex native web search.
- Known public page: Codex native fetch.
- Raw public HTML or media metadata: `curl`.
- Dynamic or logged-in page: CDP bridge.
- Downloadable video/audio selected by the user: `yt-dlp`, preserving the source URL.
- Previously visited/internal page: `scripts/find-url.mjs`.

For media pages, inspect the DOM for original image/video URLs before taking screenshots. A browser screenshot is a fallback for rendered state, not the preferred source asset.

## Multi-agent use

Delegate only independent research targets. Each subagent creates and closes its own background tab. The parent agent owns synthesis, user questions, rights warnings, and the final creative decision.

## Source and license

See `UPSTREAM.md`. Vendored scripts remain available under their upstream MIT terms.
