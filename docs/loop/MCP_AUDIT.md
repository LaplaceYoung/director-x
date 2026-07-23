# MCP Audit

## Surface snapshot

Measured through the stdio `tools/list` response from `mcp/server.mjs`:

```json
{
  "toolCount": 181,
  "publicFacadeNamesReserved": 16,
  "implementedPublicFacades": 5,
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

The public profile currently contains the completed `directorx_recover_production`, `directorx_get_production_status`, `directorx_resume_production`, `directorx_research_video`, and `directorx_generate_media` Facades. Generation provides a strict `inspect/submit/poll` boundary over the existing Provider gateway; it preserves durable submission reservation, official-price and approved-route checks, session-only credentials, and duplicate-billing protection. This remains a migration slice, not a claim that the public profile is production-complete.

## Next implementation slice

Add `directorx_review_media_candidate` so generated candidates can move through review, retry/reroute, and selection without exposing the low-level draw-loop tools. Then implement the public start boundary and exercise the full public lifecycle.
