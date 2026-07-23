# MCP Audit

## Surface snapshot

Measured through the stdio `tools/list` response from `mcp/server.mjs`:

```json
{
  "toolCount": 182,
  "publicFacadeNamesReserved": 16,
  "implementedPublicFacades": 6,
  "legacyLooseContracts": 174,
  "modelAndAppExplicitVisibility": 2,
  "appOnlyExplicitVisibility": 1
}
```

The current implementation treats all tools as registered and callable by the same registry. Metadata alone is not an audience boundary.

## Strengths

- Every registered tool now has an `outputSchema` after contract application.
- Safety annotations distinguish read-only, idempotent, open-world, and destructive operations.
- Recovery has a strict `inspect/apply` contract with an opaque token and idempotent replay.
- Tool failures are normalized into structured recovery-oriented payloads.
- Resource endpoints expose the canvas and durable artifacts.

## Gaps

- Default `tools/list` is far above the 15–30 target.
- Legacy tools are still directly callable; `_meta.ui.visibility` is not enforced by the registry.
- Most tools use a broad compatibility output contract rather than a precise intent result.
- Public Facade policy names future tools before they exist, so the score must count implemented Facades separately.
- Conversation UX still has to distinguish user-facing intent from internal activity for all legacy names.

## First implementation slice

`mcp/tool-registry.mjs` now supports `compatibility` and `public` profiles. The default remains `compatibility`; `DIRECTORX_TOOL_PROFILE=public` lists and dispatches only names in the reserved public Facade set. The boundary is enforced in both `list()` and `call()`.

The public profile currently contains six completed Facades: recovery, status, resume, research, generation, and candidate review. `directorx_generate_media` now covers `prepare/inspect/submit/poll`, so evidence-bound retries return to the same public gateway while retaining official pricing, attempt caps, and replay safety. This remains a migration slice, not a claim that the public profile is production-complete.

## Next implementation slice

Implement the public start boundary, then exercise the complete public path through editing and delivery.
