# Plugin UX Audit

## First-use path

The main Skill now establishes a compact public route: start or resume one production Run → follow the returned native Goal action → resolve the run-mode decision → submit a brief for native confirmation → prepare → approve a stage when the selected mode requires it → research. The internal preflight remains inside the start Facade.

## Positive evidence

- Default prompts describe real outcomes instead of internal tools.
- The canvas is a durable Run projection rather than an independent browser-only state store.
- Recovery returns one executable action and preserves completed artifacts.
- Specialist skills are explicit-only, reducing accidental workflow fragments.
- The entry describes user intent and clear non-goals instead of exposing Browser-cache bootstrapping, raw Run creation, or low-level interaction IDs.
- Native decisions return through one public Facade, so a resumed production does not need to reconstruct or repeat a question.
- A public preparation request creates one native brief-confirmation prompt before it writes Intake, budget, route, or delivery promise. It uses a stable `public-brief` gate, canonical brief/fingerprint persistence, and a resolved-interaction/application check; a deferred answer leaves those artifacts absent.
- The same persistent decision application records run mode, exact brief fingerprint, and stage approval before the Run advances; replays do not apply those transitions twice.
- Public results no longer reveal unavailable legacy tool routes, and public preparation reuses the compatibility compiler with an idempotent fingerprint in its durable transaction.

## Friction

- The default model-facing surface is now the nine public Facades; the 185-tool compatibility surface remains an explicit migration/development opt-in.
- Internal activity tools can still be selected directly by name when compatibility mode is deliberately enabled.
- The distinction between “production action” and “Canvas/app support” is not enforced at transport level.
- Installation success and live-host readiness are documented, but a clean-host timing benchmark is missing.
- **P1:** the runtime accepts the Codex MCP host's raw `request_user_input` envelope when resolving a native decision, but has no host-signed receipt to independently attest that answer. This is a host-trust boundary, not a missing public brief-confirmation flow.
- **P1:** run-mode semantics are selected through a caller-supplied option-label-to-mode mapping. That mapping needs a host-trusted or independently canonical source so presentation wording cannot alter the persisted mode.

## UX acceptance for the next slice

- A model-visible public profile has only the nine completed Facades.
- An unavailable legacy name fails as unavailable instead of executing silently.
- Internal activity remains visible to the Canvas/app profile.
- Public results explain the next user decision without exposing provider or persistence internals.
- The native brief prompt displays the canonical material brief fields, its stored fingerprint matches that brief, and revised briefs safely supersede the older pending prompt.
- A host-signed receipt (or equivalent attestation) binds the native answer to the stored request before public resolution is accepted.
- Run-mode uses a canonical, host-trusted answer-to-mode mapping rather than caller-supplied wording.
- Generation inspection returns request, attempt, job, candidate, blocker, and next-action counts without leaking credentials or the full Run.
- Candidate review turns accept → select and fail → repair-plan into one user-facing action, with stable replay behavior.
- Repair retries return to `directorx_generate_media:prepare`; the user-facing lifecycle no longer exposes attempt bookkeeping.
- Public startup returns one next action at a time and keeps all MCP continuations inside `directorx_start_production`; only native `request_user_input` and `create_goal` remain host actions.
- Replaying the public create action reuses the same Run and Goal binding instead of asking again or creating parallel state.
- Public decision request → native input → public resolution preserves one request ID and does not expose the legacy interaction resolver.
