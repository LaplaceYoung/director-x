# Plugin UX Audit

## First-use path

The main skill establishes the correct order: preflight → side Browser canvas → native Goal → required native questions → production Run. This matches the intended Codex-native experience.

## Positive evidence

- Default prompts describe real outcomes instead of internal tools.
- The canvas is a durable Run projection rather than an independent browser-only state store.
- Recovery returns one executable action and preserves completed artifacts.
- Specialist skills are explicit-only, reducing accidental workflow fragments.

## Friction

- 183 compatibility-mode tool descriptors make the model-facing surface harder to understand than the product itself.
- Many internal activity tools can still be selected directly by name.
- The distinction between “production action” and “Canvas/app support” is not enforced at transport level.
- Installation success and live-host readiness are documented, but a clean-host timing benchmark is missing.

## UX acceptance for the next slice

- A model-visible public profile has only the completed Facades.
- An unavailable legacy name fails as unavailable instead of executing silently.
- Internal activity remains visible to the Canvas/app profile.
- Public results explain the next user decision without exposing provider or persistence internals.
- Generation inspection returns request, attempt, job, candidate, blocker, and next-action counts without leaking credentials or the full Run.
- Candidate review turns accept → select and fail → repair-plan into one user-facing action, with stable replay behavior.
- Repair retries return to `directorx_generate_media:prepare`; the user-facing lifecycle no longer exposes attempt bookkeeping.
- Public startup returns one next action at a time and keeps all MCP continuations inside `directorx_start_production`; only native `request_user_input` and `create_goal` remain host actions.
- Replaying the public create action reuses the same Run and Goal binding instead of asking again or creating parallel state.
