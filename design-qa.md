# Canvas UI design QA

## Visual truth

- Graph canvas: `/var/folders/jf/l5k4gml17sg391snm99_5nzm0000gn/T/codex-clipboard-9c632b52-27d9-4011-931c-ffa1db86d3f5.png`
- Collapsible element rail: `/var/folders/jf/l5k4gml17sg391snm99_5nzm0000gn/T/codex-clipboard-980911dc-16ab-4196-a4a3-bebd3c14f401.png`
- Storyboard columns: `/var/folders/jf/l5k4gml17sg391snm99_5nzm0000gn/T/codex-clipboard-8c786081-a680-4420-8f15-c31bd7259da5.png`

## Implementation under review

- Page: `app/browser-canvas.html`
- State: local file preview without a durable Run query
- Viewport: unavailable from the in-app Browser
- Implementation screenshot: unavailable

## Comparison checklist

| Area | Intended behavior | Verification |
| --- | --- | --- |
| Left rail | Expand and collapse while preserving the active view and selection | Covered by state/unit tests; rendered interaction not verified |
| Production canvas | Media-first spatial graph with playable previews, lineage edges, focus and dimming | Structure and fixtures covered by tests; rendered comparison blocked |
| Storyboard | Audio/text, image and video columns with media metadata and relationships | Structure covered by tests; rendered comparison blocked |
| Typography | Dense Chinese-first hierarchy with compact metadata labels | Code-reviewed only |
| Spacing and responsive layout | Desktop split workspace plus mobile rail and preview sheet | Code-reviewed only |
| Color and imagery | Dark production surface, semantic status color, real media thumbnails | Code-reviewed only |
| Copy | Production objects and media relationships remain the primary language | Covered by fixture assertions |
| Console | No runtime errors while switching views, selecting media or collapsing the rail | Not verified |

## Blocker

The in-app Browser rejected DOM and screenshot access for the current `file://` page under its navigation security policy. No alternate browser or local-server workaround was used. A normal plugin loopback canvas URL is required for rendered comparison, interaction checks and console inspection.

## Final result

**Blocked** — implementation and automated checks can pass, but visual parity and interaction QA remain unverified until the canvas is opened through the plugin runtime.
