# Evolution Loop 10 Report

## Result

The default public profile now exposes nine actual implementation Facades: start, status, resume, decide, prepare, research, generate, review, and recover. The 185-tool compatibility profile remains an explicit development/migration opt-in. The public surface is still incomplete: edit, render, audit, repair, and delivery remain planned public contracts.

`directorx_prepare_production` now asks once for native confirmation of the canonical material brief before it records Intake, budget, route, or delivery promise. The interaction stores the canonical brief and fingerprint under a stable `public-brief` gate; the raw native answer resolves through `directorx_decide_production`, then a host-action sequence resumes public preparation. The shared helper rejects a nonmatching or unapproved resolved interaction/application/fingerprint before it mutates production artifacts.

Public results no longer expose unavailable legacy tool routes. The same durable decision machinery applies run-mode and stage-approval state once, and preparation uses durable fingerprints to keep concurrent identical calls idempotent.

The installed default is now the public profile; compatibility requires explicit opt-in. Safety classification also has one source of truth, with timeline patch commits explicitly treated as material/destructive writes despite their reversible-revision implementation.

## Verification

- A read-only default stdio `tools/list` probe returned exactly nine Facades: `directorx_start_production`, `directorx_get_production_status`, `directorx_resume_production`, `directorx_decide_production`, `directorx_prepare_production`, `directorx_research_video`, `directorx_generate_media`, `directorx_review_media_candidate`, and `directorx_recover_production`.
- Static source count found 185 registered `directorx_*` tool definitions and 174 legacy loose contracts.
- Public-decision coverage exercises native Goal binding → run-mode decision → brief confirmation/defer/revise/confirm → concurrent prepare replay → stage approval → research, while asserting public results contain no unavailable tool name.
- Final local verification ran `pnpm run ci`: 584 passing tests, 0 failures.
- No CI run is claimed by this report.

## Review outcome

No P0 was observed from the current working tree. Public preparation's native confirmation/provenance gate is resolved. The remaining P1s are the un-attested trust in the Codex MCP host's raw `request_user_input` envelope and the caller-supplied public run-mode label-to-mode mapping.

## Current score

88/100 progress score. This is not a DONE or release claim.
