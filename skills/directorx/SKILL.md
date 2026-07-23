---
name: directorx
description: Start or resume a durable Director X video-production Run. Use for requests to create, remake, edit, review, or deliver a video with Director X or @directorx. Do not use for general video advice, plugin development, or requests that do not start or continue production.
---

# Director X

Director X turns a video outcome into a durable production Run with a native Codex Goal, a live media canvas, and a small set of production actions. The user asks for a result; keep orchestration inside the plugin.

## Start or resume

- For a new production, collect only the current session's available agent types, host tools, and enabled Skills. Call `directorx_start_production` with `action: "begin"`, the project path, and an outcome that ends in a playable, reviewed video. Do not scan the workspace, inspect plugin caches, construct a Run, or plan the entire pipeline before this call.
- Execute the returned `hostAction` exactly. It is the authority for opening the side canvas and continuing boot. `request_user_input` and `create_goal` remain native Codex actions; preserve the returned preflight and Run identity in every continuation.
- For a known Run, call `directorx_get_production_status` for a compact update, then `directorx_resume_production` when it supplies the next action. Resume the existing Run; never create a replacement or replay finished work.
- When startup or resume cannot proceed because the required native host capability is unavailable, say what the user needs to do in plain language and preserve the Run. Do not silently replace Director X with a Markdown-only plan.

## Use native decisions once

Use `directorx_decide_production` for a durable production choice after boot. With `action: "request"`, it stores the question before returning the native `request_user_input` action. With `action: "resolve"`, pass only the raw answer envelope from that prompt.

- Ask only choices that materially change the result, rights, spend, provider, or final delivery.
- Do not repeat a question in chat, infer approval from prose, or create a second question because a turn resumed.
- Keep model Keys out of chat and durable artifacts. Follow the secure credential action returned by the production flow.
- If a public result says `request_stage_approval`, use this same decision action with `kind: "stage_approval"`. Persist an application that maps one explicit answer to the named stage; a deferred answer keeps the Run intact and does not start that stage.

## Progress through public production actions

Prefer the public Facades as the production spine:

1. `directorx_start_production` — establish one canvas, native Goal, and durable Run.
2. `directorx_get_production_status` / `directorx_resume_production` — understand and continue the saved state.
3. `directorx_decide_production` — request and resolve one native user decision.
4. `directorx_prepare_production` — request one server-owned native confirmation for the exact production brief, then create the minimum durable production setup. Execute its returned `request_user_input` action exactly; its follow-up sequence resolves the answer and continues preparation. A deferred brief writes no budget, route, or delivery promise, and a changed brief supersedes the stale confirmation instead of creating a second blocker.
5. `directorx_research_video` — start reference-first research as soon as that setup is ready.
6. `directorx_generate_media` — prepare, submit, and poll an approved generation attempt.
7. `directorx_review_media_candidate` — accept a usable candidate or create one evidence-bound repair plan.
8. `directorx_recover_production` — inspect then apply the one returned recovery action when a durable gate blocks work.

Never reconstruct a boot transaction from low-level tools. When the current public surface does not cover a later stage, use the current public action to continue and keep implementation-level MCP tools out of the conversation. Specialist Skills may add stage-specific directing and review guidance; they must not recreate the Goal, canvas, Run, or a completed result.

## Route by production stage

Load only the narrowest needed specialist Skill after the Run exists:

- Reference remake or analysis: `directorx-reference-intake`, then `directorx-asset-sourcing`. Download and understand the authorized video and audio first. Write or update `Director.md` only after the replication plan identifies what is retained, replaced, and newly staged.
- Narrative, visual direction, and shots: `directorx-script-craft`, `directorx-shot-planning`, `directorx-cinematography-audio`, and `directorx-visual-prompting`.
- Provider-specific execution: `directorx-provider-routing` and `directorx-production-orchestration`; research and first creative artifacts must not wait for optional governance documents.
- Edit and finish: `directorx-agentic-editing`, `directorx-evidence-rough-cut`, `directorx-timeline-interchange`, `directorx-render-composition`, `directorx-subtitle-localization`, `directorx-production-review`, `directorx-frame-audit-repair`, and `directorx-publish-packaging`.

Use parallel specialists only for independent, artifact-bound work. The parent Director keeps the single durable Run and shares visible research, media, script, storyboard, and review results on the canvas.

## User-facing conversation contract

Open with one short sentence that the production space is ready and the few result-changing choices will be collected. Do not announce every Skill read, tool call, file write, registration, or retry. Do not use engineering status templates. Do not print intermediate scripts, prompt packs, research logs, or full shot tables in chat by default. After startup, update only at a visible milestone, native decision, blocker, preview, or final delivery. The canvas should grow with real media and creative artifacts; internal activity, IDs, schemas, and tool names stay in details unless the user asks.

For a request to make a video, planning documents are milestones, never completion. Deliver only after a playable version exists, the required review evidence is recorded, and the user can identify the result and any material limitation.
