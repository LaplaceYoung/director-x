---
name: directorx-agentic-editing
description: Plan and audit non-destructive Director X timeline edits as sparse edit graphs, evidence rough cuts, rational-time dry-run patches, material-change approvals, and durable receipts. Use for trimming, silence removal, splitting, reordering, replacing, transitions, audio gain or ducking, caption shifts, crop/resize, edit repairs, interchange, or any request that changes a video timeline.
---

# Director X Agentic Editing

Treat an edit as a versioned production decision, not an implicit file mutation. Keep the canvas observational and use Codex `request_user_input` for material approvals.

## Workflow

1. Confirm the Run is in the `edit` stage. Register an immutable canonical baseline with `directorx_register_timeline_revision`; its content hash and revision become the compare-and-swap boundary.
2. Resolve only ambiguities that materially alter narrative, duration, aspect ratio, music, rights, cost, or user-authored work.
3. Call `directorx_register_edit_intent`. Preserve the base timeline reference and revision, explicit user request, constraints, evidence, and desired outcome.
4. Call `directorx_compile_edit_graph` with the smallest acyclic graph. Every node must name its operation, dependencies, input/output artifacts, affected rational-time ranges, and evidence.
5. Call `directorx_register_timeline_patch` before mutation. Use stable object paths, half-open rational-time ranges, reversible operations where possible, and exact evidence references.
6. Inspect the timeline dry-run in the Director X canvas. Clicking an evidence item must target its own asset and source time; never seek every comparison player indiscriminately.
7. If the patch reports material changes, present its duration, narrative, media, rights, and rollback impact through Codex `request_user_input`. Do not accept a canvas click, free-form tool argument, or inferred preference as approval.
8. Call `directorx_commit_timeline_patch` only after the required native approval. The commit must recheck revision and content hash, replay the same server-side typed-operation validator used when the draft was saved, append a child Revision, preserve the original timeline, and write `edit_receipt.json`. Unknown clips, source/timeline overflow, duration mismatch, invalid timebases, video overlap, complete video deletion, and caption overflow fail closed. A changed head returns `conflict` without mutation.
9. Register the resulting semantic timeline, edit decisions, preview/render evidence, and review artifacts before completing `edit`.

## Post-production Director X Cut workflow

After a candidate passes `directorx_verify_final_media`, do not ask about manual editing in chat and do not request delivery approval yet:

1. Call `directorx_prepare_goal_completion`. Execute its `post_production_edit` `request_user_input` host action and resolve the same request ID.
2. If the user chooses direct delivery, leave the verified candidate unchanged and continue the normal delivery gate.
3. If the user chooses editing, call `directorx_start_opencut_editor` with the registered final-video artifact, measured duration, FPS, and resolved interaction ID. Execute `editorHostAction` to open `editorUrl` in the Codex side Browser and finish every active turn with `editorTurnEndAction` in `handoff` state.
4. On every resumed turn, call `directorx_get_opencut_editor_status` and execute its regenerated `editorHostAction`. This reconstructs the side-Browser binding after an MCP restart while preserving the durable editor session.
5. Director X Cut is a bounded local adapter informed by OpenCut Classic at commit `cf5e79e919144200294fb9fed22a222592a0aeea` under MIT. Its product surface is rebranded, but upstream attribution remains in `THIRD_PARTY_NOTICES.md` and the editor About panel. It never burns a forced Director X watermark into user output.
6. The browser editor exposes synchronized video, decoded waveform and caption tracks, timeline zoom, undo/redo, draft replay, trim, split, delete, reorder, embedded-audio gain, bounded ducking, normalized crop, adjacent crossfade/dip-to-black transitions, and caption shift. Source media and the canonical base Revision remain immutable. Splitting, deleting, trimming, or reordering must update or clear dependent transition/duck effects rather than leaving dangling references.
7. For silence removal, pause compression, or an automatic first cut, load `directorx-evidence-rough-cut` and call `directorx_propose_evidence_rough_cut` as `DX-Editor`. Use only registered interval evidence. The result is a saved draft and cannot commit itself.
8. After the editor reports a saved draft, call `directorx_import_opencut_edit_result`. Execute the returned `edit_change` native question. If the user chooses “返回继续调整”, the runtime archives that patch and restores the same editor session to its base timeline; do not create a duplicate session.
9. If the user approves, call `directorx_commit_timeline_patch` with the exact preview grant and interaction ID. A committed manual or agent-proposed patch invalidates the previous final review and delivery approval.
10. Call `directorx_render_opencut_timeline` for the committed canonical Revision. It compiles shell-free FFmpeg argv, preserves a versioned immutable source record, executes trim/order/crop/transition/gain/duck semantics, and writes `opencut_render_plan.json`, `opencut_render_receipt.json`, a new `delivery.video`, and `render_report.json`.
11. Call `directorx_verify_final_media` again. Only the exact newly hashed render plus a new `DX-Quality-Reviewer` disposition can mark the editor session complete and release the delivery question.

## Approval policy

Require native confirmation for narrative deletion, promised-duration or aspect-ratio changes, music/key-media replacement, rights changes, paid generation, manual-edit overrides, irreversible export, or publication.

Allow bounded reversible corrections without interruption only when they preserve approved intent, cost, rights, user locks, and delivery promises. Record them in the patch and receipt.

If the user declines, keep the Run resumable, mark the patch declined or superseded, and compile a new patch. Never silently weaken the requested outcome.

## Safety and failure behavior

- Never overwrite source media or the approved base timeline.
- Reject cycles, unknown operations or clips, invalid/overflowing ranges, inconsistent source/timeline durations, overlap, caption overflow, missing evidence, stale revisions, and unregistered artifacts.
- Treat `edit_receipt.json` as an audit receipt, not proof of a playable render. Rendering and final-media verification remain separate gates.
- If an adapter cannot execute an operation, preserve the dry-run and return a constrained fallback; do not claim commit success.
- Keep rollback additive: create a new revision or compensating patch rather than deleting history.
- Treat the loopback editor as a replaceable UI adapter. Director X owns media provenance, canonical timeline state, native approvals, render evidence, and completion policy.

## Required artifacts

- `edit_intent.json`
- `edit_graph.json`
- `timeline_patch.json`
- `edit_receipt.json`
- `semantic_timeline.json`
- `timeline_revision.json`
- `edit_decisions.json`
- `render_report.json`
- `opencut_editor_session.json`
- `opencut_project.json`
- `opencut_edit_result.json`
- `opencut_render_plan.json`
- `opencut_render_receipt.json`
- `rough_cut_proposal_<proposal-id>.json` when DX-Editor proposes a first cut
- `timeline_interchange_loss_report.json` and `roundtrip_validation.json` when crossing editor formats

Use `directorx-production-review` after execution to verify A/V sync, continuity, captions, loudness, defects, and edit fit against `Director.md`.
