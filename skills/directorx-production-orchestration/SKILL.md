---
name: directorx-production-orchestration
description: Post-boot orchestration for an active Director X Run. If selected directly from an @directorx plugin invocation, first load the main directorx skill and complete its side-canvas-first startup before any pipeline or production action.
---

# DirectorX Production Orchestration

Use this skill as the run-control layer only after the main `directorx` entry skill has started the canvas service, opened the side Browser, obtained post-open preflight status, created the native Goal, created the Run, and bound the Goal.

If this skill is selected directly because the user invoked `@directorx`, load the main `directorx` skill and complete its canvas-first boot sequence immediately. Do not call `directorx_list_pipelines`, inspect the workspace, ask a question, or perform production work before that sequence completes.

## Workflow

1. Verify the Run has a bound native Goal and a connected or handed-off side Browser canvas. Then call `directorx_list_pipelines`, inspect the brief and load the task-specific bundled skill docs. Do not depend on repository-only docs when the plugin is installed outside the DirectorX source tree.
   Treat `resumeActionPlan.productionBootstrap` as the continuous startup-to-team state: Goal binding, complexity plan, execution graph, production-team compilation, and the first ready parallel dispatch each expose one exact next action. Do not infer readiness from chat history or dispatch before the state reaches `ready_for_parallel_dispatch`.
2. Diagnose only material ambiguity. Use `directorx_create_and_ask_native_question` for at most three strategy-changing questions, then confirm Intake, write the intent resolution, plan complexity, and call `directorx_prepare_fast_start_intake` when available. For ordinary production this also writes the initial Director.md; for `reference-replication`, Director.md is intentionally deferred until the downloaded media has been understood and the replication/shot blueprint is complete. Immediately call `directorx_begin_reference_research`; research, reference analysis, asset search, and the first script must start before deferred execution graphs, tool inventories, detailed budgets, audio responsibility, or team receipts are complete. Provider and Key approvals remain Generation gates, never a reason to hold the research lane.
3. Classify the request into a production mode: commercial short video, reference-to-video, cinematic trailer, explainer, screen demo, avatar, footage-led edit, clip factory, localization, documentary montage, character animation, or hybrid.
4. Create a `run_mode` native interaction and ask the user to choose `guided_autonomy` (recommended), `stage_approval`, or `full_automation` through its `request_user_input` host action. Resolve it, then call `directorx_configure_run_mode` with the interaction ID. Full automation never removes hard gates.
5. Select the matching built-in pipeline with `directorx_select_pipeline`; treat its eight stages as the minimum manifest. Use `reference-replication` when the user asks to recreate a source video: its media bundle and replication plan precede generation, and its difference report follows exhaustive review. Extend outputs and reviewers for the production mode without deleting core gates.
6. Compile `production_complexity_plan.json` before planning subagents or generation. Treat `maxSubagentTasksPerStage` and `candidateCapPerShot` as hard runtime caps; quick uses compressed passes and must be reclassified before adding more departments or draw-loop attempts.
7. Run mandatory Codex web research and asset discovery at the depth selected by the complexity policy. Produce research, reference-video assessment, reference manifest, asset manifest, rights ledger, and search receipts before provider/tool preflight.
7. Run provider/tool preflight through Provider Registry and Tool Registry. Required permissions apply to the route as a whole, not every tool independently. A blocked route must be repaired before execution; never treat it as harmless when Codex-native or plugin runtime capabilities were omitted from inventory.
8. Use durable native interactions and Codex `request_user_input` to confirm picture, video, and voice provider/model routes independently, including an explicit unused choice where applicable. Record `image_model`, `video_model`, and `voice_model` decisions with matching resolved interaction IDs before generation; never collapse them into one model approval.
9. Record major decisions in `decision_log`: pipeline, provider family, render runtime, composition mode, music/voice route, sample/full-run policy, and user approvals.
10. Execute stage by stage. Call `directorx_get_stage_requirements` first, then use `directorx_register_stage_package` to validate, hash, register, and optionally complete a coherent package atomically. Use individual artifact registration only for isolated late evidence. In `stage_approval` mode, resolve a `stage_approval` interaction and pass its ID to `directorx_approve_stage` before beginning each stage. Completion requires real registered evidence, never schema-count placeholder files.
11. Stage transitions automatically write `checkpoint_replay.json`; call `directorx_checkpoint_run` for partial progress, approval wait, expensive batches, recoverable failure, user pause, and rerun.
12. Before external video generation, call `directorx_negotiate_task_transport` with the raw structured initialize/request capability, protocol generation, host build, and a cost-free behavior probe result. Flat capability strings are only hints and never sufficient. Until client capability, behavior probe, and Director X task methods all pass, persist and use the durable Provider Job polling fallback.
13. Treat external video generation as an asynchronous job: call `directorx_submit_provider_job` once with a stable idempotency key, poll with `directorx_update_provider_job`, and never infer completion from elapsed time. If status is `input_required`, create one stable `provider_input` interaction, resolve it through Codex, and do not resume the job until that request is resolved. Cancellation is requested with `directorx_cancel_provider_job` and remains non-terminal until the provider reports `cancelled`, `succeeded`, or `failed`.
14. Before research finalization, call `directorx_validate_research_package` and resolve its complete error list in one pass. Route each stage through quality review before downstream consumption.
15. Resume with `directorx_resume_run` using artifact refs, stage status, approval status, cost snapshot, event cursor, and supersession chain. Reconcile in-flight jobs before retrying.
16. Before Codex Goal completion, call `directorx_verify_final_media` with an explicit `preview`, `review`, or `publish` tier, require `DX-Quality-Reviewer` to inspect `frame_audit_report.json`, then call `directorx_prepare_goal_completion`. A Run remains active until exhaustive decoded-frame coverage, blank/flash/freeze/motion, canonical timeline diversity, A/V alignment, EBU R128 audio, rights, placeholder, and technical checks pass; all eight stages are complete; a real delivery video is registered; and the user explicitly approves the verified tier through the durable delivery interaction.

## Output Artifacts

- `pipeline_manifest.json`
- `decision_log.json`
- `checkpoint_replay.json`
- `tool_registry.json`
- `model_routing_plan.json`
- `budget_plan.json`
- `final_review.json`
