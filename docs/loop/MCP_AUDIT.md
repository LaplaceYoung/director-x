# MCP Audit

## Surface snapshot

The following values come from the current working tree: a read-only default stdio `tools/list` call for the public set, and static definition/metadata counts for the compatibility set.

```json
{
  "toolCount": 185,
  "implementedPublicFacades": 9,
  "legacyLooseContracts": 174,
  "modelAndAppExplicitVisibility": 2,
  "appOnlyExplicitVisibility": 1
}
```

The public profile is the executable default boundary. The legacy registry remains available only through explicit `DIRECTORX_TOOL_PROFILE=compatibility` opt-in for development or migration workflows.

## Strengths

- Every registered tool has an `outputSchema` after contract application.
- Safety annotations distinguish read-only, idempotent, open-world, and destructive operations.
- One exported `DIRECTORX_DESTRUCTIVE_TOOL_NAMES` set now supplies the safety classification used by both contracts and policy. `directorx_commit_timeline_patch` is explicitly destructive/material despite its reversible-revision implementation.
- Recovery has a strict `inspect/apply` contract with an opaque token and idempotent replay.
- Tool failures are normalized into structured recovery-oriented payloads.
- Resource endpoints expose the canvas and durable artifacts.
- The public profile lists exactly nine actual Facades: `directorx_start_production`, `directorx_get_production_status`, `directorx_resume_production`, `directorx_decide_production`, `directorx_prepare_production`, `directorx_research_video`, `directorx_generate_media`, `directorx_review_media_candidate`, and `directorx_recover_production`.
- Public result projection scrubs unavailable legacy `directorx_*` continuations instead of returning a tool name that a public-only conversation cannot call.
- Native decision applications durably apply run mode, public brief confirmation, and stage approval exactly once after the raw Codex answer is resolved.

## Gaps

- Explicit compatibility `tools/list` is far above the 15–30 target.
- Legacy tools are still directly callable through the explicit compatibility profile; `_meta.ui.visibility` is not a compatibility access boundary.
- Most legacy tools use a broad compatibility output contract rather than a precise intent result.
- Edit, render, audit, repair, and delivery have planned Facade names but are not publicly listable until they are implemented end to end.
- Public preparation's native confirmation gate is implemented: it uses one stable `public-brief` gate, persists the canonical brief and fingerprint, and verifies the resolved interaction/application/approved answer before it writes the production promise. **P1 remains at the host trust boundary:** `resolve` accepts the raw Codex MCP `request_user_input` envelope without a host-signed receipt.
- **P1:** the public run-mode decision still receives its option-label-to-mode mapping from the caller. The mapping must become host-trusted or independently canonicalized so user-visible wording cannot change durable runtime semantics.
- Conversation UX still has to distinguish user-facing intent from internal activity for all legacy names.

## Current implementation slice

`mcp/tool-registry.mjs` supports `public` and `compatibility` profiles. The default and the `.mcp.json` launch environment select `public`, which lists and dispatches only the nine implemented public Facades. `DIRECTORX_TOOL_PROFILE=compatibility` is the explicit migration/development opt-in. The boundary is enforced in both `list()` and `call()`.

`directorx_start_production` owns one durable preflight transaction while returning native `request_user_input` and `create_goal` host actions; it never claims MCP can execute those Codex-native operations itself. `directorx_decide_production` owns later durable request/resolve boundaries and applies the stored typed state before moving on. `directorx_prepare_production` uses a native brief-confirmation request with one stable `public-brief` gate, keeps the canonical brief/fingerprint in the persisted interaction, continues as a host-action sequence only after resolution, and reuses the in-process `prepareFastStartIntake` compiler. It verifies the resolved interaction, application, fingerprint, and approved answer before the helper writes Intake, budget, route, or delivery state. `directorx_generate_media` covers `prepare/inspect/submit/poll`, so evidence-bound retries return to the same public gateway while retaining official pricing, attempt caps, and replay safety. This remains a migration slice, not a claim that the public profile is production-complete.

## Next implementation slice

Close the P1 host-receipt and run-mode-mapping trust boundaries, then implement the first evidence-bound rough-cut Facade using the public decision boundary and exercise the complete public path through delivery.
