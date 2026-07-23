# Evolution Loop 13 Report

## Result

The default public profile now exposes nine actual implementation Facades: start, status, resume, decide, prepare, research, generate, review, and recover. The 185-tool compatibility profile remains an explicit development/migration opt-in. The public surface is still incomplete: edit, render, audit, repair, and delivery remain planned public contracts.

`directorx_prepare_production` now asks once for native confirmation of the canonical material brief before it records Intake, budget, route, or delivery promise. The interaction stores the canonical brief and fingerprint under a stable `public-brief` gate; the raw native answer resolves through `directorx_decide_production`, then a host-action sequence resumes public preparation. The shared helper rejects a nonmatching or unapproved resolved interaction/application/fingerprint before it mutates production artifacts.

Public results no longer expose unavailable legacy tool routes. The same durable decision machinery applies run-mode and stage-approval state once, and preparation uses durable fingerprints to keep concurrent identical calls idempotent.

This loop removes caller control over public run-mode semantics. The server now owns the run-mode question, stable labels, and label-to-mode mapping; custom caller wording cannot remap `guided_autonomy`, `stage_approval`, or `full_automation`. Stage approval remains explicitly bound to its current pipeline stage and persisted answer mapping.

This loop adds the first public `directorx_build_rough_cut` Facade slice. `inspect` returns selected-candidate and editor readiness; `propose` reuses the existing DX-Editor evidence rough-cut compiler with fixed ownership. The boundary creates only a reversible draft and never commits a timeline; native edit approval remains separate.

The installed default is now the public profile; compatibility requires explicit opt-in. Safety classification also has one source of truth, with timeline patch commits explicitly treated as material/destructive writes despite their reversible-revision implementation.

## Verification

- A read-only default stdio `tools/list` probe now returns ten Facades, including `directorx_build_rough_cut`.
- Static source count found 185 registered `directorx_*` tool definitions and 174 legacy loose contracts.
- Public-decision coverage exercises native Goal binding → canonical run-mode decision → brief confirmation/defer/revise/confirm → concurrent prepare replay → stage approval → research, while asserting public results contain no unavailable tool name and custom run-mode wording cannot change the persisted question.
- The focused native interaction and public decision suites pass 19/19, including the rough-cut blocked-state route.
- Final local verification ran `pnpm run ci`: 584 passing tests, 0 failures.
- No CI run is claimed by this report.

## Review outcome

No P0 was observed from the current working tree. Public preparation's native confirmation/provenance gate is resolved. The remaining P1 is the un-attested trust in the Codex MCP host's raw `request_user_input` envelope.

## Current score

90/100 progress score. This is not a DONE or release claim.
