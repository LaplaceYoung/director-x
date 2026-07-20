---
name: directorx-benchmark-runner
description: Build and run repeatable Director X Video Agent benchmarks using production fixtures, programmatic verifiers, expert rubrics, execution lineage, cost and latency constraints, repeated trials, and baseline regression gates.
---

# Director X Benchmark Runner

Use this skill to prove that a model, prompt, tool route, pipeline, or harness change improves real video-production behavior.

## Workflow

1. Select a production task family such as generation, reference research, editing, audio/subtitle, continuity repair, or delivery QA.
2. Reuse routed capability IDs and register a versioned suite through `directorx_register_benchmark_suite`.
3. Define fixtures with concrete inputs, expected artifacts, executable checks, expert rubric dimensions, and hard cost/latency ceilings. Rubric weights must sum to one.
4. Use `directorx_list_benchmark_fixture_templates` for the rights-safe Repurpose, Sequencing, Repair, and Assembly contracts. Bind registered inputs and rights evidence through `directorx_instantiate_benchmark_template`; do not hand-copy a template into a weaker fixture. Fill media slots only with user-provided or rights-cleared sources; repair ground truth remains verifier-only.
5. Call `directorx_plan_benchmark_schedule` before the first rollout. Fix repeats, base seed, concurrency and total budget up front. Claim cells in schedule order; failed cells remain failed and count as zero rather than disappearing.
6. Execute each fixture through the normal Director X pipeline. Register every output and bind production lineage before scoring.
7. Call `directorx_list_benchmark_verifiers`, then `directorx_execute_benchmark_verifiers`. Use only declared built-ins: registered artifact, SHA-256, playable media, audio presence, duration range, minimum resolution, maximum file size, semantic timeline clip order, subtitle timing integrity, and measured loudness/true peak. Parameters such as expected clip order, media duration, permitted overlap, LUFS range, and true-peak ceiling belong to the fixture; do not invent a universal social-platform loudness target. The plugin emits `benchmark_verifier_receipt.json`; the Agent may not self-report programmatic results or run arbitrary verifier commands.
8. Score judgment dimensions from sampled evidence: intent adherence, story function, temporal consistency, motion/action completion, identity/object continuity, physical plausibility, edit fit, audio sync, and platform readiness.
9. Call `directorx_record_benchmark_trial` with the plugin verifier receipt; every expert score also needs durable evidence references. Then finalize the schedule cell; success requires that exact trial.
10. Repeat enough trials to expose stochastic variance, then call `directorx_compile_benchmark_report` against a named baseline, explicit tolerance, and maximum acceptable confidence-interval width. Treat `insufficient_precision` as unresolved evidence, not a pass.
11. Treat a regression as a review blocker. The report may propose investigation or future routing changes, but may not mutate the current approved route.
12. Use `directorx_get_benchmark_baselines` for cross-Run comparison. Pass only the active `baselineId` to report compilation; never supply baseline metrics from conversation text.
13. Promote or revoke a project baseline only through Codex `request_user_input` followed by `directorx_promote_benchmark_baseline` or `directorx_revoke_benchmark_baseline`. Revisions remain immutable and separate from creative continuity memory.
14. Call `directorx_export_observability_trace` when the Run needs external observability. The OTLP-compatible export contains identifiers, hashes, metrics and status only—never prompt/model content or credentials.

## Plugin Interaction Contract

- Benchmark setup and execution happen through MCP tools and normal DX agents.
- Progress, trial outcomes, score, cost, latency, and regression state appear on the browser canvas.
- Instantiated Suite contracts and every hard-verifier result appear as separate canvas nodes before expert scoring.
- Human rubric confirmation or accepting a route change remains a Codex-native `request_user_input` interaction.
- Provider credentials remain session-only and are never written into fixtures or reports.
- The canvas shows trace exports and baseline governance decisions, but baseline approval remains a Codex-native question.

## Evaluation rule

Use programmatic verifiers for objective facts and expert rubrics for creative or perceptual judgment. Never collapse a failed hard verifier into a passing average score.

Reports include a Wilson 95% interval for pass rate, a 95% mean-score interval, and sample standard deviation. A regression is declared only when the confidence interval clears the baseline tolerance; wide intervals remain `insufficient_precision`.
