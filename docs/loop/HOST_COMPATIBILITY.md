# Host Compatibility Audit

## Protocol observations

- `initialize` negotiates protocol version `2025-11-05` and declares tools/resources.
- `notifications/initialized` is accepted.
- `tools/list` and `tools/call` are available over stdio.
- Canvas and artifact resources are listed and readable.
- Shutdown handles SIGINT, SIGTERM, and stdin end.

## Host-dependent checks

The setup doctor intentionally separates repository identity from live host evidence. In a repository-only run, Goal, native input, durable loop, and DX agent readiness are `installed_unverified`; this is truthful and should not be converted to a pass.

Required fresh-host test:

1. Install from `directorx@mosi` into a clean Codex profile.
2. Fully restart Codex.
3. Confirm the entry skill is discovered.
4. Confirm native Goal and native input are available.
5. Confirm the side Browser canvas opens before any production question.
6. Confirm the same Run remains addressable after MCP restart.

This test is not yet automated in the standalone repository.

## Compatibility risks

- MCP Apps capability negotiation is not yet implemented; the side Browser remains the primary canvas and inline UI is a fallback.
- Plugin cache and current session readiness are separate facts and require a restart after role installation.
- A second MCP runtime must not be started to repair or inspect a Run.
