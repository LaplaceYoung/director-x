# Evolution Loop 08 Report

## Result

Phase 0 is complete and the eighth implementation slice is complete. The public lifecycle now starts through one durable Facade that opens the side canvas, asks for native Goal confirmation, creates one Codex Goal, creates one Director X Run, and binds the two without duplicate state.

README release badges and integration references point to `v0.1.15`. The public profile now contains seven completed Facades; compatibility mode remains available.

## Verification

- `pnpm validate:plugin` passed.
- stdio `initialize` / `tools/list` probe passed.
- Compatibility-mode `tools/list` contains 183 registered tools; public mode lists seven completed Facades.
- `node runtime/doctor-plugin.mjs --profile planning_only` completed truthfully with host capabilities marked unverified outside a live Codex session.
- `DIRECTORX_TOOL_PROFILE=public` lists exactly the seven completed Facades and rejects an internal tool at call time.
- The generation Facade `inspect` path was exercised against a durable Run and returned the missing-plan blocker without a Provider request.
- Candidate review integration covers atomic acceptance/selection, replay idempotency, and single-variable repair compilation.
- Generation integration covers repair → prepare → submit readiness and idempotent attempt replay.
- Start integration covers canvas claim → native input → native Goal → Run creation → Goal binding and idempotent create replay.
- Full CI after the native-start slice: 577 tests passed, 0 failed.

## Review outcome

No P0 was observed from repository evidence. The highest-value P1 is now the missing public edit/render boundary.

## Current score

82/100 progress score. This is not a DONE or release claim.
