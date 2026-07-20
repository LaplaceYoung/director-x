---
name: directorx-evidence-rough-cut
description: Build an evidence rough cut for silence removal, pause compression, inactive-footage removal, interview cleanup, or an agent-proposed first edit. Use when DX-Editor should turn registered A/V evidence into a reversible Director X Cut draft without bypassing Codex approval.
---

# Director X Evidence Rough Cut

An evidence rough cut is a proposal, not a hidden edit. `DX-Editor` may compress verified inactivity while the canonical timeline, source media, and final decision stay with Director X and the user.

## Procedure

1. Start or recover Director X Cut through `directorx_start_opencut_editor` or `directorx_get_opencut_editor_status`. Execute the returned `editorHostAction`. Continue only when one active editor session is bound to a registered final-video artifact.
2. Resolve inactive intervals from registered artifacts or A/V review markers. Each interval needs a source time range, reason, and real `evidenceRefs`; completion means every proposed interval resolves to durable Run evidence.
3. Set context margins and a minimum removal duration. Read [the interval and caption playbook](references/evidence-rough-cut-playbook.md) when intervals overlap, captions touch a boundary, or footage exceeds one simple track.
4. Call `directorx_propose_evidence_rough_cut` with `owner=DX-Editor`. Completion means the tool returns `draft_ready`, a bounded operation count, removed/output duration estimates, and `requiresNativeApproval=true`.
5. Inspect the proposed video, waveform, captions, cut ranges, and evidence relations in Director X Cut and the production canvas. Repair a partial-caption collision or unknown evidence reference before continuing.
6. Call `directorx_import_opencut_edit_result`, execute its exact Codex `request_user_input` action, and resolve the same request ID. A return-to-editor answer keeps the draft adjustable; an approval permits `directorx_commit_timeline_patch` with the exact preview grant.
7. Re-render and run `directorx_verify_final_media`. Completion means the edited file—not the previous candidate—passes exhaustive frame, A/V, subtitle, continuity, rights, and tier checks.

## Guardrails

- `DX-Editor` owns the proposal; only the native `edit_change` interaction authorizes commit.
- Context margins preserve speech attacks, breaths, reaction beats, room tone, and edit handles.
- A caption wholly inside a removed range is deleted; a caption after it shifts by the exact removed duration; a caption crossing a boundary blocks the proposal.
- A saved user draft is never silently replaced by an agent draft.
- Silence probability alone is insufficient when visuals carry meaning. Add visual inactivity evidence or keep the interval.

## Required evidence

- `audio_analysis_report.json` or another registered inactivity artifact
- `av_review_timeline.json` when captions or review markers exist
- `rough_cut_proposal_<proposal-id>.json`
- `opencut_edit_result.json`
- `timeline_patch.json`
- `edit_receipt.json` after approval
