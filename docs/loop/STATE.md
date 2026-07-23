# DirectorX Codex Plugin Evolution State

## Current loop

- Loop: 10
- Date: 2026-07-23
- Commit baseline: `6a7bcaf`; this audit records the current uncommitted working tree.
- Release baseline: `v0.1.15`
- Status: `PUBLIC_PREPARATION_FACADE_IMPLEMENTED`
- Current focus: a small, truthful public MCP surface with durable approvals and resumable production state.

## Last completed work

- The default profile now lists nine actual Facades: start, status, resume, decide, prepare, research, generate, review, and recover. The 185-tool compatibility surface is an explicit migration/development opt-in.
- `directorx_start_production` keeps the side canvas, native Goal confirmation, Run creation, and Goal binding in one replay-safe boot transaction; `create_goal` and `request_user_input` remain explicit Codex host actions.
- `directorx_decide_production` persists one native decision before display, accepts only the raw Codex answer envelope, and routes its resolution back through the same public Facade.
- `directorx_generate_media` retains the existing pricing, approval, attempt-budget, provider, and replay protections; candidate review still accepts-and-selects or compiles one evidence-bound repair plan in the same durable Run.
- The entry Skill remains the one implicit, outcome-led route and loads specialist guidance only after a Run exists.

## This loop

- Added `directorx_prepare_production` as the ninth implemented public Facade. It first asks once for Codex-native confirmation of the exact canonical brief, then atomically prepares minimum Intake, pipeline state, Director artifacts, and the production-complexity plan before research.
- Reused the existing in-process `prepareFastStartIntake` compiler rather than calling a low-level MCP tool from the public Facade.
- Added a stable `public-brief` gate plus a canonical-brief fingerprint inside the durable preparation transaction, so revised briefs supersede the old pending question and concurrent identical `prepare` calls reuse one prepared state instead of writing duplicate artifacts.
- Extended the public decision application to persist both the selected run mode and a selected stage approval before the Run proceeds; replayed resolutions do not apply either state twice.
- Scrubbed public result projections so returned `directorx_*` routes resolve only to a listed public Facade or a plain-language action, never to an unavailable legacy tool.
- Switched the registry fallback and plugin launch environment to the public profile; compatibility is now explicit opt-in rather than the installed default.
- Unified destructive-tool classification in `DIRECTORX_DESTRUCTIVE_TOOL_NAMES`; `directorx_commit_timeline_patch` is now explicitly material/destructive even though it creates a reversible revision.
- Final local verification ran `pnpm run ci` successfully (584 passing tests, 0 failures), including plugin packaging, syntax, public-preparation decision coverage, and the default public surface. This is local evidence, not a claim about remote CI.

## Exit condition for the next loop

1. Close the remaining native-decision P1s: resolve currently trusts the Codex MCP host's raw `request_user_input` envelope without a host-signed receipt, and the public run-mode application still accepts caller-supplied answer-to-mode wording/mapping.
2. Implement `directorx_build_rough_cut` as a single-source, evidence-bound public edit boundary using the existing public decision Facade for post-production approval.
3. Do not call the public profile complete until a user can traverse start → prepare → research → generation → review → edit → delivery without an internal tool handoff.
