# Baseline Audit

Date: 2026-07-23
Repository: `@mosi/directorx-codex-plugin`
Branch: `main`
Commit baseline: `6a7bcaf` with the current Loop 10 slice still in the working tree.

## Observed facts

| Area | Evidence | Result |
| --- | --- | --- |
| Manifest | `.codex-plugin/plugin.json` and `.mcp.json` are present; configuration was not changed in this documentation slice | Outside this slice |
| Marketplace | `.agents/plugins/marketplace.json` selects `directorx@mosi` with `AVAILABLE` / `ON_INSTALL` | Present |
| Entry skill | `skills/directorx/agents/openai.yaml` is the only `allow_implicit_invocation: true` skill | One implicit entry |
| Specialist skills | 33 specialist skills are explicit-only and point to `directorx-production` | Preserved, with discoverability cost |
| Registered MCP tools | Static `name: "directorx_*"` definitions in `mcp/server.mjs` | 185 definitions |
| Default public Facades | Read-only default `tools/list` | 9 actual Facades: start, status, resume, decide, prepare, research, generate, review, recover |
| Legacy contracts | `directorx/legacyLooseContract: true` metadata | 174; still a P1 migration burden |
| Public output boundary | Public-result projection replaces unavailable `directorx_*` routes | Implemented; no legacy continuation should appear in a public result |
| Native protocol | `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, and resource templates exist in the runtime | Repository evidence only |
| Installation docs | Marketplace commands exist in both READMEs | Present |
| Runtime doctor | Planning profile reports identity, Node, workspace, and media binaries; host capabilities remain unverified outside a live Codex session | Expected host-dependent state |
| Regression suite | Final local verification ran `pnpm run ci` | 584 passing tests, 0 failures; validates plugin packaging, syntax, and tests locally |

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

The repository documents the static path. A fresh-host, installed-cache measurement is not yet automated; this is a backlog item rather than an assumed pass.

## Baseline risks

1. The legacy 185-tool compatibility profile remains available as an explicit development/migration opt-in, so it still needs a tight operational boundary.
2. Public preparation now uses a stable native `public-brief` gate, a canonical brief fingerprint, a persisted interaction, and a resolved-interaction/application check before it writes Intake, budget, route, or delivery promise. Its remaining P1 is not missing confirmation: `resolve` still trusts the Codex MCP host's raw answer envelope without a host-signed receipt.
3. The public run-mode application still accepts caller-supplied option-label-to-mode mappings; it needs a host-trusted canonical mapping boundary.
4. Edit, render, audit, repair, and delivery remain planned public Facades.
5. Host readiness cannot be proven from a repository-only inspection; it needs a live Codex session.
