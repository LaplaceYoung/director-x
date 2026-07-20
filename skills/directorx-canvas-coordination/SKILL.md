---
name: directorx-canvas-coordination
description: Coordinate the Director X browser canvas with Codex-native Goal, request_user_input, subagent, artifact, media-preview, evidence, and progress interactions without creating a second chat or approval system.
---

# Director X Canvas Coordination

Use this skill whenever a production Run opens, updates, or diagnoses the Director X browser canvas.

## Surface Contract

- Codex conversation owns intent, questions, explanations, approvals, Goal lifecycle, tool calls, and user-visible completion.
- Director X canvas owns production objects, lineage, media previews, stage evidence, DX agent status, costs, frame handoffs, events, and resumable inspection.
- Director X Core owns durable Run state and enforcement. The browser is a projection, never the source of truth.
- Credentials are the only sensitive input accepted in the canvas because they must stay outside model-visible chat. All creative and commercial decisions remain Codex-native.

## Workflow

1. `directorx_capability_preflight` starts the local canvas service. Open its exact side Browser URL immediately, set in-app Browser visibility to true, and only after the page's claim-token `boot` heartbeat makes `canvasSurfaceHealth.hostClaimed=true` call `directorx_get_preflight_status` to obtain the first native question. A plain URL fetch, link preview, or health check is not an opened side Browser. Browser is Skill-backed, so an empty direct tool-name search is not evidence of unavailability; initialize the official Browser runtime directly. Preflight never allows `directorx_open_inline_canvas`; inline fallback is reserved for a durable Run whose side Browser opened earlier and later disconnected. On every resumed turn, first call the model-visible `directorx_get_run_snapshot`, then execute its ordered `resumeActionPlan`: claim/hydrate/verify the canvas and active Director X Cut tabs, release terminal DX hosts, present any native question, dispatch only the ready same-stage batch, and finally preserve the returned surfaces. A stale tab binding means reacquire or create a tab from the still-valid in-app Browser binding; only a browser-disconnected error invalidates that binding. Hidden surfaces remain healthy background surfaces. The final Browser action of an active turn must be `browser.tabs.finalize({keep:[{tab,status:"handoff"}]})`; use `deliverable` only after final delivery, and make no later Browser call in that turn. MCP App output templates are inline fallback UI and must not be mistaken for the side Browser.
   Before a durable Run exists, the same recovery rule uses the persisted preflight transaction: call `directorx_get_preflight_status` with the original `preflightId`, open its newly issued URL, and follow `bootTransaction.nextRequiredAction`. A recovered Goal acceptance stays accepted; only the ephemeral Browser claim is repeated.
2. Before material work, record an event and project the responsible stage/agent/object.
3. After creating a real artifact or media file, register it. The runtime keeps complete evidence internally, while the Storyboard asset library projects only generated Markdown and essential real image, video, and audio files. JSON, receipts, checkpoints, telemetry, lineage, provider probes, benchmark data, and frame-audit evidence belong in Activity/Review. Add an explicit canvas object only for richer lineage or state; never add decorative or speculative nodes.
4. When a gate blocks progress, persist it with `directorx_request_user_interaction`, execute the returned `request_user_input` host action, and resolve that same request ID. The canvas may show the pending question and reason but must not present a competing approval form, duplicate the request, or infer an answer.
5. Keep canonical `DX-xxxxx` agent identities, active/blocked/complete status, mission and artifact handoff visible.
6. Show missing required evidence for the current stage. A stage is not visually complete until its registered artifacts satisfy the Pipeline contract.
7. For long-form work, project ordered segment nodes and frame-handoff edges from durable IDs.
8. After compaction/restart, resume from `directorx_get_run_snapshot`; do not reconstruct state from browser DOM or reuse a stale loopback URL. Treat Run/editor IDs as durable and tab/URL bindings as ephemeral. The returned surface health is diagnostic evidence, not production truth.

## Interaction Rules

- Keep the Codex conversation on the concise consumer layer. Do not narrate canvas synchronization, artifact registration, event recording, checkpoint replay, MCP calls, IDs, paths, schemas, JSON, or agent dispatch. The Run snapshot's `userFacingSummary` is the default wording source for milestone updates.
- Emit at most one conversational update per material stage transition. If work lasts long enough to require an additional update, use one short sentence describing the creative outcome in progress, not the technical operation.
- The canvas inspector and Activity view show friendly summaries first. Artifact references, raw metadata, event types, batch IDs, and diagnostics live under collapsed “制作详情”; they are not the default reading experience.
- Never place budget, provider, model, reference-download, delivery, or strategy approval buttons in the canvas.
- Never add a canvas chat box, autonomous “continue” button, fake progress percentage, or optimistic completion state.
- A canvas selection may inspect an object; it does not mutate the Run unless a dedicated audited tool exists.
- Display exact artifact references, event sequence, costs, agent ownership, and blockers in plain language.
- Connection errors preserve the last projection and clearly mark it stale; they do not reset the Run.
- Live refresh never overwrites user inspection state. Fit-to-canvas is explicit; the browser stores pan/zoom, active view, filter, search, selected object, A/B selection, sync lock, timeline viewport, and review playhead under the durable Run ID so an MCP restart or fresh loopback URL does not reset navigation. Restore only bounded local inspection values and discard IDs no longer present in the Run.

## Required Views

- Workflow: a compact stage spine with stage-local approvals, active/blocked DX agents, budget and completion gates. Keep diagnostics and completed execution internals off the graph, and use stage-aligned branches rather than all-to-all edges.
- Storyboard: only four separate libraries—generated Markdown, images, videos, and audio. It contains no JSON, evidence rail, timeline controls, execution receipts, frame-audit stills, or generic artifact cards.
- Review: A/B video inspection, evidence rail, edit dry-run, synchronized transport, subtitles, waveform and timecoded defects.
- Activity: pending Codex-native interactions, missing evidence, ordered Run events, and durable DX batch dispatch counts/status. Dispatch diagnostics stay here rather than becoming creative Storyboard assets.
- Review candidate inspection: select up to two real videos for local-only A/B playback, lock their time axes, jump to evidence/defect timecodes, and inspect repair lineage. These controls never select a production candidate or approve delivery.
- Unified review timeline: render durable shot intervals, subtitle cues, normalized waveform peaks, and evidence markers from `av_review_timeline.json`; seeking is local inspection and never edits the timeline.
- Waveform and caption nodes must come from executable analysis/import receipts. The canvas renders min/max peak pairs and parsed cues; it never invents waveform amplitude or subtitle timing.
- Long-video waveform views query the persisted pyramid by visible range and pixel width. The loopback canvas API may read these immutable chunks locally; changing audio or timeline state still requires an audited model-visible tool.

## Quality Gate

- Every visible state derives from the current Run snapshot.
- Every pending decision names `codex_request_user_input` as its interaction surface.
- Every pending decision has one stable request ID; changed questions supersede prior requests and repeated refreshes do not create new ones.
- Every final render exposes `frame_audit_report.json` with exhaustive decoded-frame coverage and timecoded defects before delivery approval appears.
- Every completed stage has registered evidence.
- Every media preview resolves to a real reachable path.
- Every A/B marker comes from durable review evidence or a defect record; the canvas does not invent quality annotations.
- Every DX agent maps to a canonical registered identity.
