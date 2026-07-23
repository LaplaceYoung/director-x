# Baseline Audit

Date: 2026-07-23
Repository: `@mosi/directorx-codex-plugin`
Branch: `main`
Commit: `ffa3a06`

## Observed facts

| Area | Evidence | Result |
| --- | --- | --- |
| Manifest | `.codex-plugin/plugin.json` and `.mcp.json` validate | Pass |
| Marketplace | `.agents/plugins/marketplace.json` selects `directorx@mosi` with `AVAILABLE` / `ON_INSTALL` | Pass |
| Entry skill | `skills/directorx/agents/openai.yaml` is the only `allow_implicit_invocation: true` skill | Pass |
| Specialist skills | 33 specialist skills are explicit-only and point to `directorx-production` | Pass with discoverability cost |
| MCP tools | `tools/list` returns 177 tools | P1 gap |
| Public Facades | 16 names are reserved in policy; only `directorx_recover_production` is implemented | P1 gap |
| Legacy contracts | 174 tools carry `directorx/legacyLooseContract: true` | P1 gap |
| Native protocol | `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, and resource templates are implemented | Pass at transport level |
| Installation docs | Marketplace commands exist in both READMEs | Pass |
| Release docs | README badges and integration line were stale at `v0.1.14` | Fixed in loop 01 |
| Runtime doctor | Planning profile reports identity, Node, workspace, and media binaries; host capabilities are unverified outside a live Codex session | Expected host-dependent state |
| Regression suite | `pnpm run ci` passed: 575 tests, 0 failures | Pass |

## Installation path

The documented path is:

```text
marketplace add repository
→ plugin add directorx@mosi
→ fully restart Codex
→ implicit Director X skill discovery
→ MCP initialize/tools/list
→ native Goal + side Browser canvas
```

The repository validates the static path. A fresh-host, installed-cache measurement is not yet automated; this is a backlog item rather than an assumed pass.

## Baseline risks

1. The model receives a very large low-level tool descriptor set.
2. The reserved public Facade list is ahead of the implementation.
3. Legacy tools remain callable even when not intended as user-facing entry points.
4. Host readiness cannot be proven from a repository-only test; it needs a live Codex session.
