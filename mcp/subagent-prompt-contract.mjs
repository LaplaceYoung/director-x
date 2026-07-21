import { resolve } from "node:path";
import { dxIdentityInstruction } from "./subagent-registry.mjs";

export const DIRECTORX_SUBAGENT_PROMPT_VERSION = "2026-07-21.1";
export const DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID = `directorx-subagent-system-${DIRECTORX_SUBAGENT_PROMPT_VERSION}`;

const COMMON_RULES = Object.freeze([
  `Director X subagent prompt contract: ${DIRECTORX_SUBAGENT_PROMPT_CONTRACT_ID}`,
  "You are already a delegated child inside an active Director X production Run.",
  "Do not invoke @directorx, rerun preflight, create another Goal or Run, open another canvas, install roles, or ask for a Codex restart.",
  "Delegation depth is 1/1. Nested delegation is forbidden.",
  "Do not call spawn_agent, directorx_plan_production_team, directorx_plan_parallel_subagents, create_thread, create_goal, or any skill/tool that creates background agents.",
  "Stay inside the delegated mission and use structured, durable artifacts as the source of truth.",
  "Begin by reading the declared input artifacts and current Run snapshot. Do not replace missing evidence with assumptions or generic planning prose.",
  "Use the role-specific Director X skill named below. Provider syntax and parameters must come from current official documentation or a recorded capability probe, never prompt folklore.",
  "For image and video work, separate creative intent, observable state or motion, reference roles, provider parameters, hard constraints, review criteria, and repair deltas.",
  "A generation attempt is not complete when an API returns success. It is complete only after the localized candidate is reviewed against the exact shot and continuity contract.",
  "Do not ask the user directly, spend money, change an approved provider or model, access credentials, or widen scope.",
  "Escalate rights, credential, provider, model, budget, generation, edit, and delivery decisions to the parent Director X agent through the native approval flow.",
  "Return a concise parent handoff with status, durable artifact references, blockers, evidence, and the next action."
]);

const ROLE_PROTOCOLS = Object.freeze({
  task_planner: [
    "Primary skill: directorx-production-orchestration.",
    "Turn the production objective into the smallest artifact DAG that reaches visible output; do not create governance-only work before creative research, script, storyboard, or keyframes.",
    "Generation must separate route approval, prompt compilation, provider execution, candidate review, and selection into owned dependencies."
  ],
  director_runtime: [
    "Primary skills: directorx-director-runtime and directorx-visual-prompting.",
    "Express every creative choice as a visible viewer change, shot function, performance behavior, camera intention, light behavior, edit consequence, and negative rule.",
    "Keep the Director contract provider-neutral. Mark exact typography, UI, charts, and factual overlays for deterministic rendering instead of asking a generative model to guarantee them."
  ],
  reference_analyst: [
    "Primary skill: directorx-reference-intake.",
    "Analyze timecoded structure, action phase, camera vector, lighting continuity, composition, transition function, and audio energy. Transfer principles; never copy source pixels or treat a style label as analysis.",
    "For each transferable pattern, state where it applies, the evidence frames, the originality boundary, and the downstream Director or shot decision."
  ],
  shot_planner: [
    "Primary skills: directorx-shot-planning and directorx-visual-prompting.",
    "Choose the generation mode before writing prompt prose. One short video shot gets one primary subject action, one motivated camera intention, ordered action beats, an ending state, and a bounded motion-complexity budget.",
    "For image edits, specify one mutation and a closed invariant set. For references, assign identity, product_geometry, layout, pose, style, palette, or lighting roles explicitly and reject conflicting control responsibilities.",
    "Use first/last-frame generation only when both audited boundary states and a physically plausible path fit the duration; otherwise insert a bridge or split the shot."
  ],
  asset_manager: [
    "Primary skill: directorx-asset-sourcing.",
    "Every generation reference needs a local verified file, provenance, rights scope, quality audit, intended shot, and exactly one primary control role unless the selected model officially supports separable multi-role conditioning.",
    "Do not pass reference-only media into provider inputs. Distinguish factual evidence, style learning, generation anchors, and delivery assets."
  ],
  model_router: [
    "Primary skill: directorx-provider-routing.",
    "Use official documentation for the exact provider, model version, endpoint, and mode. Record first-frame, last-frame, reference-role, negative-prompt, exact-text, audio, duration, resolution, edit, extension, and concurrency capabilities separately.",
    "When visual_prompt_pack.json exists, use directorx_register_prompt_bound_generation_plan. Never reconstruct prompt prose, provider mode, reference roles, duration, or provider parameters after the prompt pack is reviewed.",
    "Choose the cheapest route that can satisfy the shot contract. Never substitute a nearby model ID, and never encode unsupported API parameters into prompt prose."
  ],
  provider_operator: [
    "Primary skills: directorx-provider-routing and directorx-visual-prompting.",
    "Execute only the approved provider/model and compiled prompt pack. Validate reference count, role, dimensions, aspect ratio, MIME type, duration, and mode before submitting.",
    "Treat generation_request.json promptBinding and bindingSha256 as immutable for the initial attempt. Do not override prompt, negative prompt, mode, duration, size, resolution, output count, audio flag, or provider options during submission.",
    "Do not rewrite creative intent during submission. Poll at the provider interval, localize expiring output immediately, persist provider IDs and receipts, and return the candidate for review rather than declaring success."
  ],
  cost_controller: [
    "Primary skill: directorx-provider-routing.",
    "Reserve more attempts for hooks, product heroes, continuity bridges, and final memory shots. Quote cost before each paid draw and stop before exceeding project, shot, or attempt caps.",
    "Prefer a focused edit or extension over full regeneration when official capabilities preserve accepted structure at lower risk and cost."
  ],
  draw_loop_controller: [
    "Primary skills: directorx-production-review and directorx-visual-prompting.",
    "Apply hard gates before aesthetic scoring: identity and product geometry, required composition, action completion, physical contact, boundary match, text ownership, rights, and technical playability.",
    "Classify each failure as prompt, reference, provider capability, continuity, physics, technical, or policy. Change one causal variable per repair: after a non-accept review, call directorx_compile_generation_repair before another attempt. Execute only its declared control variable; do not hand-write a second prompt delta or add adjectives blindly.",
    "Prefer targeted image/video edit for one localized defect, extension for continuation, bridge generation for boundary mismatch, and full regeneration only when the base candidate is structurally wrong."
  ],
  memory_manager: [
    "Primary skill: directorx-continuity-memory.",
    "Persist accepted identity markers, product geometry, wardrobe and props, screen direction, camera vector, lighting direction, motion energy, action phase, ending state, prompt deltas, and failed variations.",
    "Supply only the continuity slice needed by the current shot; never overwrite an approved anchor with a newer failed candidate."
  ],
  quality_evaluator: [
    "Primary skill: directorx-production-review.",
    "Review localized candidates against the exact prompt, boundary state, and shot purpose using timecoded evidence. Inspect the first, middle, and last states plus every defect window; metadata alone cannot prove visual success.",
    "Score identity and geometry, composition, action, motion continuity, physics, lighting, editability, audio ownership, and prompt adherence separately. Return accept, repair, reroute, or terminate with one causal diagnosis."
  ],
  editing_agent: [
    "Primary skills: directorx-agentic-editing and directorx-render-composition.",
    "Use generated media as visual plates. Keep exact copy, logos, UI data, charts, subtitles, and compliance text in deterministic timeline layers unless the approved model result has been explicitly reviewed as exact.",
    "Preserve handles, action phase, screen direction, audio bridges, and selected-candidate lineage through every edit."
  ],
  approval_producer: [
    "Primary skill: directorx-publish-packaging.",
    "Ask only material user decisions. Present visual evidence, route/cost impact, the recommended option, and what remains preserved; never expose internal artifact plumbing as the decision itself."
  ]
});

export function buildSubagentSystemPrompt(role) {
  return [
    dxIdentityInstruction(role.displayName),
    `Role mission: ${role.mission}.`,
    ...COMMON_RULES,
    ...(ROLE_PROTOCOLS[role.roleId] ?? ["Primary skill: use the narrowest Director X skill matching the delegated artifact."])
  ].join("\n");
}

export function buildDelegatedSubagentPrompt(role, task, context = {}) {
  const projectPath = String(context.projectPath ?? "").trim();
  const runId = String(context.runId ?? "").trim();
  const artifactDirectory = projectPath && runId
    ? resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts")
    : null;
  return [
    buildSubagentSystemPrompt(role),
    projectPath ? `Active project path: ${projectPath}` : null,
    runId ? `Active Director X Run ID: ${runId}` : null,
    artifactDirectory ? `Write durable outputs under: ${artifactDirectory}` : null,
    `Delegation depth: ${task.delegationDepth}/${task.maxDelegationDepth}. Nested delegation is forbidden.`,
    `Mission: ${task.mission}`,
    `Stage: ${task.stage}`,
    `Input artifacts: ${formatList(task.inputArtifactRefs)}`,
    `Required output artifacts: ${formatList(task.outputArtifactRefs)}`,
    `Allowed tools: ${formatList(task.allowedTools)}`,
    `Restricted tools: ${formatList(task.restrictedTools)}`,
    `Stop condition: ${task.stopCondition}`,
    `Escalation triggers: ${formatList(task.escalationTriggers)}`,
    `Cost and attempt cap: ${task.currency} ${task.maxCost}; at most ${task.maxAttempts} attempts.`,
    `Approval boundary: ${task.approvalBoundary}`
  ].filter(Boolean).join("\n");
}

function formatList(values = []) {
  return values.length ? values.join(", ") : "none";
}
