# Evolution Loop Backlog

## P0

None observed in the repository-only audit. A live-host installation test is still required before treating installation as proven.

## P1

1. Implement `directorx_review_media_candidate` with exact outputs for accept, retry, reroute, and stop decisions while preserving the existing draw-loop cost caps.
2. Implement the public `start` Facade and exercise start → research → generation → review as one durable lifecycle. `get_production_status`, `resume_production`, `research_video`, and `generate_media` are complete migration slices.
3. Make the installed-cache and fresh Codex session test executable and record elapsed time to first successful call.
4. Convert the remaining recovery, start, resume, and progress skill instructions to the public Facade contract.

## P2

1. Reduce model-visible conversation text for legacy activity tools.
2. Add MCP Apps capability negotiation while retaining side Browser fallback.
3. Add an explicit installation troubleshooting page with actual host-state examples.

## P3

1. Consolidate specialist skill descriptions after usage evidence exists.
2. Add dashboard charts to the evolution report only if they improve a decision.
