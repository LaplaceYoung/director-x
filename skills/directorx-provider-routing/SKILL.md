---
name: directorx-provider-routing
description: Design DirectorX provider routing, capability catalogs, cost controls, shot difficulty scoring, draw-loop budgets, provider interfaces, and fallback policies. Use when work touches model selection, vendor switching, pricing, route decisions, or provider API boundaries.
---

# DirectorX Provider Routing

## Overview

Use this skill when a task changes how DirectorX chooses models, controls cost, evaluates provider capabilities, or swaps API suppliers.

## Workflow

1. Read `references/routing-matrix.md` and the current Run's provider, budget, delivery-promise, and readiness artifacts. When developing inside the DirectorX source repository, `constraints/provider-interfaces.md` is optional deeper context; installed plugin operation must not depend on it.
2. Identify the requested provider capability: agent backend, image, video, TTS, music, SFX, search, editing, rendering, or understanding.
3. For image or video generation, call `directorx_list_media_providers` with the required media type and mode before presenting choices. Distinguish first-party `direct` APIs from `gateway` routes and do not invent unsupported model IDs. If the user names a supplier/model outside that catalog, call `directorx_get_custom_media_provider_intake`, use its two native questions to capture the exact supplier and model, and do not select a nearby built-in model as a substitute.
4. At production start, confirm the exact image, video, and voice routes through Codex `request_user_input` before creative execution. For built-in routes, call `directorx_get_media_provider_setup`, pass its `keySetupInteraction` through `directorx_create_and_ask_native_question`, and collect the actual secret only in the secure canvas password field; this calls `directorx_set_session_credential` and configures the expected current-process environment variable without writing the Key to chat, artifacts, Run state, receipts, logs, or Git. For a custom route, call `directorx_get_custom_media_provider_intake`, require the user to provide the exact supplier/model plus an official HTTPS API documentation or homepage URL through the native question, have the parent `DX-Director` search and open only those official sources, record the real host search/open receipts with `directorx_record_provider_api_research`, and register one model-specific adapter with `directorx_register_custom_media_provider_adapter`. Keep this receipt separate from brand/asset `web_research_receipt.json`. Adapters are declarative HTTPS JSON mappings: no generated code, SDK installation, shell, arbitrary authentication headers, private origins, or undocumented fields. The parent Director also owns capability routing, fallback selection, and budget quotes; no separate model-routing or budget agent is required. Use `directorx_get_custom_media_provider_setup` after resume and resolve its `keySetupInteraction` natively. For speech, call `directorx_get_mosi_voice_setup` first and pass its `selectionQuestion` unchanged to `request_user_input`; `MOSS-TTS (Recommended)` must remain first and routes to `https://platform.mosi.cn` only after native acceptance. `MOSS-TTS-Nano (Local)` is the supported no-Key alternative when its CLI is already configured; approve `openmoss.moss-tts-nano.local` / `moss-tts-nano` and use `directorx_generate_local_moss_tts_nano_voiceover` with authorized local prompt speech. Do not install the local runtime implicitly.
5. After `capability_route.json` exists, inventory the actual Codex host, Director X MCP, enabled app, local-runtime, and approved-provider tools with `directorx_register_tool_inventory`. Record source, permissions, task support, status, capability scope, observed quality/reliability, estimated cost, and p50 latency; never infer an enabled app from plugin installation alone.
6. Call `directorx_plan_tool_route` with the user-approved budget and hard quality/latency constraints. Compare quality, balanced, and economy candidates and expose confirmation count. A missing permission or quality floor is a blocker, not a soft score.
7. Do not trust a static provider catalog alone. Call `directorx_probe_provider_capability` for the selected exact provider/model and record availability, supported generation modes, current limits, credential readiness, official/runtime evidence, and expiry.
8. Score each shot for difficulty and importance.
9. Allocate budget from project to attempt level.
10. Choose a production path with primary provider, backup providers, max attempts, max cost, required references, and fallback policy.
11. Define approval gates for delivery-promise changes.
12. Confirm and persist picture, video, and voice routes independently through Codex `request_user_input`. Use exact provider/model IDs for active modalities and an explicit `notUsed=true` decision for a modality excluded from the approved production route. A generic model approval is insufficient.
13. When `visual_prompt_pack.json` exists, register the approved route through `directorx_register_prompt_bound_generation_plan`. Pass the freshly verified prompt-pack SHA-256 and only shot budgets/provider parameters; the tool derives prompt prose, negative policy, mode, duration, anchors, continuity, review, and repair contracts from the pack and records immutable hashes in `generation_request.json`. Use `directorx_register_generation_plan` only for non-visual compatibility routes without a Director X prompt pack. Registration fails when the modality-specific decision, runtime probe, or requested generation mode is absent. Keep image and video requests in separate generation plans because each plan binds one approved provider/model route. Begin every draw with `directorx_begin_generation_attempt` so cost and attempt limits are checked before provider execution.
14. For a built-in provider route, call `directorx_submit_media_generation`; if it returns a non-terminal job, call `directorx_poll_media_generation` once per provider interval until terminal. These tools derive provider, model and prompt from the approved Run, immediately localize expiring results, and register the candidate. Use the manual `directorx_submit_provider_job`/`directorx_update_provider_job` pair only for a connected provider not implemented by the built-in gateway.
15. Review every localized candidate before selection. A successful API response is not an accepted shot.
16. Record current queue and concurrency evidence with `directorx_record_provider_capacity` when a provider is constrained, saturated, unavailable, or materially different from the inventory estimate. Capacity evidence informs future routing and never silently replaces a user-approved provider/model.
17. For multiple generated video segments, route only to a provider/mode that can consume both approved start and end anchors. Register the segment continuity plan before the generation plan; every request must use `keyframes_to_video`, and rerouting to a provider without that capability requires a new native model decision and a Director-approved production redesign.

## Shot Difficulty Inputs

- Person complexity.
- Action complexity.
- Camera movement complexity.
- Subject count.
- Continuity requirement.
- Physical realism requirement.
- Text or logo precision.
- Style intensity.
- Duration.
- Shot importance.

## Route Output

Return route decisions with:

- Shot id.
- Production path.
- Difficulty and importance.
- Provider capability requirements.
- Primary and backup provider ids.
- Max attempts and max cost.
- Required references.
- Fallback policy.
- User approval gates.

Runtime rule: provider/model IDs in the generation plan must match the latest user-approved decision. The first attempt must match the prompt-pack binding exactly; do not restate or override prompt, negative prompt, mode, duration, dimensions, output count, audio flag, or provider parameters at submission. A reroute requires a new approval decision before another attempt.

Probe evidence may be an official models/capabilities response, a credential-safe dry run, or a host capability declaration. Never claim support from marketing copy alone. A degraded probe must expose the limitation on the canvas and in fallback planning.

## References

Read `references/routing-matrix.md` when defining route logic or provider capability records.
