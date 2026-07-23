# Evolution Loop 07 Report

## Result

Phase 0 is complete and the seventh implementation slice is complete. The public generation lifecycle now covers attempt preparation, submission, polling, review, selection, and repair-driven retry.

README release badges and integration references point to `v0.1.15`. The six-tool public profile is unchanged in size, but generation now absorbs the remaining low-level attempt boundary; compatibility mode remains available.

## Verification

- `pnpm validate:plugin` passed.
- stdio `initialize` / `tools/list` probe passed.
- Compatibility-mode `tools/list` measured 182 registered tools; public mode lists six Facades.
- `node runtime/doctor-plugin.mjs --profile planning_only` completed truthfully with host capabilities marked unverified outside a live Codex session.
- `DIRECTORX_TOOL_PROFILE=public` lists exactly the six completed Facades and rejects an internal tool at call time.
- The generation Facade `inspect` path was exercised against a durable Run and returned the missing-plan blocker without a Provider request.
- Candidate review integration covers atomic acceptance/selection, replay idempotency, and single-variable repair compilation.
- Generation integration covers repair → prepare → submit readiness and idempotent attempt replay.
- Full CI after the generation-retry slice: 576 tests passed, 0 failed.

## Review outcome

No P0 was observed from repository evidence. The highest-value P1 is now the missing public start boundary.

## Current score

81/100 progress score. This is not a DONE or release claim.
