# MCP Audit

## Surface snapshot

Measured through the stdio `tools/list` response from `mcp/server.mjs`:

```json
{
  "toolCount": 180,
  "publicFacadeNamesReserved": 16,
  "implementedPublicFacades": 4,
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

The public profile currently contains the completed `directorx_recover_production`, `directorx_get_production_status`, `directorx_resume_production`, and `directorx_research_video` Facades. Status, resume, and research have exact top-level output schemas; research starts after minimum Intake, exposes the parallel research handoff, and is idempotent on replay. This remains a migration slice, not a claim that the public profile is production-complete.

## Next implementation slice

Introduce an explicit audience/profile boundary in the registry, defaulting to the existing compatibility behavior until a public vertical slice is ready. Then migrate one complete path (start/resume/status or research) and assert both list and call enforcement.
