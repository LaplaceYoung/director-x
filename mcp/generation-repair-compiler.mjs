import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promptDialectForRoute } from "./director-generation-contracts.mjs";

export const generationRepairDefectTypes = Object.freeze([
  "prompt_ambiguity",
  "identity_or_geometry",
  "reference_conflict",
  "composition",
  "lighting_or_color",
  "motion_or_physics",
  "action_overload",
  "boundary_mismatch",
  "text_or_ui",
  "audio_ownership",
  "unsupported_capability",
  "provider_parameter",
  "provider_rejection",
  "policy_or_rights",
  "quality_general"
]);

const VISUAL_EVIDENCE_REQUIRED = new Set([
  "prompt_ambiguity", "identity_or_geometry", "reference_conflict", "composition", "lighting_or_color",
  "motion_or_physics", "action_overload", "boundary_mismatch", "text_or_ui", "quality_general"
]);

export function compileGenerationRepairPlan(run, input, now = new Date().toISOString()) {
  const generation = run?.generation;
  if (!generation) throw new Error("Compile a generation repair only after a generation plan exists.");
  const repairId = safeId(input.repairId, "repairId");
  const request = generation.requests?.find((item) => item.requestId === input.requestId);
  if (!request) throw new Error(`Unknown generation request: ${input.requestId}`);
  const candidate = generation.candidates?.find((item) => item.candidateId === input.candidateId && item.requestId === input.requestId);
  if (!candidate) throw new Error(`Unknown generation candidate: ${input.candidateId}`);
  if (!candidate.reviewedAt || !candidate.decision) throw new Error("Review the candidate before compiling a repair plan.");
  if (candidate.decision === "accept" || candidate.status === "selected") throw new Error("Accepted or selected candidates do not need a generation repair plan.");
  if (run.generationRepairs?.[repairId]) throw new Error(`Duplicate generation repair plan: ${repairId}`);

  const primaryDefect = normalizeDefect(input.primaryDefect ?? inferDefect(candidate));
  const evidenceRefs = uniqueStrings([...(input.evidenceRefs ?? []), ...(candidate.evidence ?? []).map((item) => item.frameRef)]);
  if (VISUAL_EVIDENCE_REQUIRED.has(primaryDefect) && !evidenceRefs.length) {
    throw new Error(`Generation repair ${primaryDefect} requires inspected candidate evidence.`);
  }

  const route = {
    providerId: generation.providerId,
    modelId: generation.modelId,
    mode: normalizeMode(request.mode)
  };
  const promptDialect = promptDialectForRoute(route);
  const budget = budgetState(request);
  const context = { run, generation, request, candidate, input, primaryDefect, evidenceRefs, route, promptDialect, budget };
  let repair = repairFor(context);
  if (repair.generationRequired && (!budget.attemptAvailable || !budget.attemptAffordable)) repair = budgetStopRepair(context);

  const preservedDimensions = preservedDimensionsFor(candidate.scores, input.preserveDimensions);
  const plan = {
    schemaVersion: "1.0",
    repairId,
    requestId: request.requestId,
    shotId: request.shotId,
    sourceCandidateId: candidate.candidateId,
    sourceAttemptId: candidate.attemptId,
    sourceReview: {
      reviewedAt: candidate.reviewedAt,
      decision: candidate.decision,
      qualityScore: candidate.qualityScore ?? null,
      criticalFloor: candidate.criticalFloor ?? null,
      failureType: candidate.failureType ?? null,
      reason: candidate.reviewReason ?? null
    },
    diagnosis: {
      primaryDefect,
      defectCodes: uniqueStrings((candidate.defects ?? []).map((item) => item.code)),
      evidenceRefs,
      explanation: repair.explanation
    },
    route: { ...route, promptDialect },
    invariantContract: {
      preservedDimensions,
      carryForwardRules: uniqueStrings(request.carryForwardRules),
      inputAnchorAssets: uniqueStrings(request.inputAnchorAssets),
      rule: "The next result must not regress a preserved dimension while changing the single declared control variable."
    },
    repair: {
      action: repair.action,
      controlVariable: repair.controlVariable,
      generationRequired: repair.generationRequired,
      promptPatch: repair.promptPatch ?? null,
      referencePatch: repair.referencePatch ?? null,
      providerParameterPatch: repair.providerParameterPatch ?? null,
      structuralPatch: repair.structuralPatch ?? null,
      editPatch: repair.editPatch ?? null
    },
    budget,
    execution: {
      disposition: repair.disposition,
      nextTool: repair.nextTool,
      requiresNativeApproval: repair.requiresNativeApproval,
      instructions: repair.instructions
    },
    stopConditions: [
      "Stop if the next candidate regresses any preserved dimension below its source score.",
      "Stop if the declared control variable cannot be isolated from another material change.",
      "Stop before exceeding the remaining shot attempt or cost cap.",
      "Reroute instead of repeating the same failed repair delta."
    ],
    createdAt: now
  };
  assertSingleVariablePlan(plan);
  return plan;
}

export async function writeGenerationRepairArtifacts({ projectPath, runId, plan }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const jsonArtifactRef = `generation_repair_${plan.repairId}.json`;
  const summaryArtifactRef = `generation_repair_${plan.repairId}.md`;
  const jsonPath = join(directory, jsonArtifactRef);
  const summaryPath = join(directory, summaryArtifactRef);
  await writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  await writeFile(summaryPath, renderSummary(plan), { mode: 0o600 });
  return {
    json: { artifactRef: jsonArtifactRef, path: jsonPath },
    summary: { artifactRef: summaryArtifactRef, path: summaryPath }
  };
}

function repairFor(context) {
  const { primaryDefect: defect, request, candidate, promptDialect } = context;
  if (defect === "text_or_ui") return repair({
    action: "compose_deterministic_overlay", controlVariable: "deterministic_text_or_ui_layer", generationRequired: false,
    disposition: "edit", nextTool: "directorx_compile_edit_graph", explanation: "Exact copy, UI, charts, and logos are deterministic composition responsibilities.",
    editPatch: { operation: "overlay", preserveGeneratedPlate: true, removeGeneratedTextFromPlate: true },
    instructions: "Keep the usable generated plate and move exact text or UI into the deterministic edit layer."
  });
  if (defect === "policy_or_rights") return repair({
    action: "resolve_rights_or_terminate", controlVariable: "rights_eligible_input", generationRequired: false,
    disposition: "request_approval", nextTool: "directorx_create_and_ask_native_question", requiresNativeApproval: true,
    explanation: "Rights and policy failures cannot be repaired by adding prompt language.",
    instructions: "Replace or remove the blocked input through the native rights decision before any new provider call."
  });
  if (["unsupported_capability", "provider_rejection", "provider_parameter"].includes(defect)) return repair({
    action: "reroute_or_correct_provider_contract", controlVariable: "provider_route_or_parameter_contract", generationRequired: false,
    disposition: "reroute", nextTool: "directorx_create_and_ask_native_question", requiresNativeApproval: true,
    explanation: "The failure is outside creative prompt control and requires an evidence-backed route or parameter correction.",
    providerParameterPatch: defect === "provider_parameter" ? { operation: "validate_against_capability_probe", maxChangedParameters: 1 } : null,
    instructions: "Do not spend another attempt on the same unsupported or rejected contract; confirm any provider/model change natively."
  });
  if (defect === "audio_ownership") return repair({
    action: "disable_unassigned_provider_audio", controlVariable: "provider_audio_generation", generationRequired: true,
    disposition: "retry", nextTool: "directorx_begin_generation_attempt",
    explanation: "The visual candidate can be retried without allowing the video provider to replace approved speech or music tracks.",
    providerParameterPatch: { operation: "set", parameter: "generateAudio", value: false },
    instructions: "Keep picture intent unchanged and disable only provider-native audio."
  });
  if (defect === "reference_conflict") return repair({
    action: "remove_conflicting_reference_role", controlVariable: "reference_role_assignment", generationRequired: true,
    disposition: "retry", nextTool: "directorx_begin_generation_attempt",
    explanation: "Competing reference responsibilities should be reduced before prompt prose changes.",
    referencePatch: { operation: "remove_conflicting_role", maxChangedBindings: 1, keepPrimaryIdentityAnchor: true },
    instructions: "Remove one conflicting control role and keep the accepted subject, camera, and lighting clauses unchanged."
  });
  if (defect === "identity_or_geometry") {
    const hasAnchor = (request.inputAnchorAssets ?? []).length > 0;
    return repair({
      action: hasAnchor ? "strengthen_primary_identity_reference" : "add_audited_identity_reference",
      controlVariable: "primary_identity_or_geometry_reference", generationRequired: hasAnchor,
      disposition: hasAnchor ? "retry" : "add_reference", nextTool: hasAnchor ? "directorx_begin_generation_attempt" : "directorx_finalize_shot_grounding",
      explanation: hasAnchor ? "Identity repair should strengthen one audited control role without rewriting the scene." : "Prompt repetition cannot replace a missing audited identity or product-geometry anchor.",
      referencePatch: { operation: hasAnchor ? "strengthen_role" : "add_audited_anchor", role: "identity_or_product_geometry", maxChangedBindings: 1 },
      instructions: hasAnchor ? "Preserve composition, camera, lighting, and action; change only the primary identity reference contract." : "Acquire and audit one identity or product-geometry anchor before another paid draw."
    });
  }
  if (defect === "boundary_mismatch") return repair({
    action: "insert_bridge_or_split_shot", controlVariable: "boundary_state_distance", generationRequired: false,
    disposition: "split", nextTool: "directorx_review_shot_sequence",
    explanation: "A physically implausible first/last-frame gap is a shot-design problem, not an adjective problem.",
    structuralPatch: { operation: "bridge_or_split", preserveBoundaryAssets: true, maxNewSegments: 1 },
    instructions: "Reduce the state distance with one bridge or split; do not regenerate unrelated boundaries."
  });
  if (defect === "action_overload") return repair({
    action: "split_or_remove_secondary_action", controlVariable: "primary_action_count", generationRequired: false,
    disposition: "split", nextTool: "directorx_review_shot_sequence",
    explanation: "The requested action density exceeds one short clip's reliable motion budget.",
    structuralPatch: { operation: "keep_one_primary_action", maxNewSegments: 1 },
    instructions: "Keep one primary action in this shot and move the secondary beat to one adjacent shot."
  });

  const promptRepair = promptRepairFor(defect, request, candidate, promptDialect);
  return repair({
    action: promptRepair.action, controlVariable: promptRepair.controlVariable, generationRequired: true,
    disposition: "retry", nextTool: "directorx_begin_generation_attempt", explanation: promptRepair.explanation,
    promptPatch: promptRepair.patch,
    instructions: "Apply only the compiled prompt patch. Preserve every invariant and provider parameter not named by the plan."
  });
}

function promptRepairFor(defect, request, candidate, promptDialect) {
  const action = String(request.promptLayers?.action ?? request.promptLayers?.subjectMotion ?? "the approved primary action").trim();
  const observation = candidate.defects?.find((item) => normalizeDefect(item.code, false) === defect)?.description ?? candidate.reviewReason ?? "the reviewed defect";
  const dialectPrefix = promptDialect.includes("flux") ? "Use positive desired-state language only. "
    : promptDialect.includes("runway") ? "Describe observable motion positively. "
      : promptDialect.includes("veo") ? "Keep API parameters outside prose. "
        : promptDialect.includes("image_edit") ? "Request one mutation and close the invariant set. "
          : "Describe one observable correction. ";
  const templates = {
    composition: { action: "adjust_composition_clause", variable: "composition_clause", delta: `Reframe only the composition to correct: ${observation}. Keep subject identity, action, lens intent, lighting, and environment unchanged.` },
    lighting_or_color: { action: "adjust_lighting_clause", variable: "lighting_clause", delta: `Correct only lighting or color continuity: ${observation}. Preserve subject, geometry, composition, action, and camera movement.` },
    motion_or_physics: { action: "simplify_motion_clause", variable: "subject_motion_clause", delta: `One physically plausible primary action only: ${action}. Correct ${observation}; preserve appearance, camera intention, setting, and ending composition.` },
    prompt_ambiguity: { action: "clarify_observable_action", variable: "observable_action_clause", delta: `Replace the ambiguous action with one visible behavior: ${action}. Preserve all established appearance and production constraints.` },
    quality_general: { action: "repair_weakest_review_dimension", variable: weakestDimension(candidate.scores), delta: `Correct only ${weakestDimension(candidate.scores)}: ${observation}. Preserve every higher-scoring reviewed dimension.` }
  };
  const selected = templates[defect] ?? templates.quality_general;
  return {
    action: selected.action,
    controlVariable: selected.variable,
    explanation: `The reviewed evidence isolates ${selected.variable} as the smallest controllable cause.`,
    patch: {
      operation: "replace_one_clause",
      positiveDelta: `${dialectPrefix}${selected.delta}`,
      negativeDelta: promptDialect.includes("flux") ? null : uniqueStrings(request.negativeConstraints).slice(0, 1),
      maxChangedClauses: 1
    }
  };
}

function budgetStopRepair(context) {
  const reason = !context.budget.attemptAvailable ? "The shot attempt cap is exhausted." : "The remaining shot budget is below the approved attempt cap.";
  return repair({
    action: "stop_or_request_budget_change", controlVariable: "approved_attempt_or_budget_cap", generationRequired: false,
    disposition: "request_approval", nextTool: "directorx_create_and_ask_native_question", requiresNativeApproval: true,
    explanation: reason,
    instructions: "Do not submit another provider request unless the user natively approves a material budget or attempt change."
  });
}

function repair(value) {
  return { requiresNativeApproval: false, promptPatch: null, referencePatch: null, providerParameterPatch: null, structuralPatch: null, editPatch: null, ...value };
}

function budgetState(request) {
  const attemptsRemaining = Math.max(0, Number(request.maxAttempts ?? 0) - Number(request.attemptCount ?? 0));
  const costRemaining = Math.max(0, Number(request.maxCost ?? 0) - Number(request.spent ?? 0));
  return {
    attemptsRemaining,
    costRemaining,
    attemptCostCap: Number(request.attemptCostCap ?? 0),
    attemptAvailable: attemptsRemaining > 0,
    attemptAffordable: costRemaining >= Number(request.attemptCostCap ?? 0)
  };
}

function preservedDimensionsFor(scores = {}, requested = []) {
  const reviewed = Object.entries(scores ?? {}).filter(([, score]) => Number.isFinite(score) && score >= 0.75).map(([name]) => name);
  return uniqueStrings([...reviewed, ...(requested ?? [])]);
}

function inferDefect(candidate) {
  const explicit = normalizeDefect(candidate.failureType, false);
  if (explicit) return explicit;
  for (const defect of candidate.defects ?? []) {
    const mapped = normalizeDefect(defect.code, false);
    if (mapped) return mapped;
  }
  const dimension = weakestDimension(candidate.scores);
  if (["continuity", "worldConsistency"].includes(dimension)) return "identity_or_geometry";
  if (["motion", "actionCompleteness"].includes(dimension)) return "motion_or_physics";
  if (dimension === "editFit") return "composition";
  if (dimension === "promptMatch") return "prompt_ambiguity";
  return "quality_general";
}

function normalizeDefect(value, strict = true) {
  const text = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const aliases = [
    [/rights|copyright|policy|safety/, "policy_or_rights"],
    [/unsupported|capability|model_limit/, "unsupported_capability"],
    [/provider.*reject|moderation|endpoint_reject/, "provider_rejection"],
    [/parameter|invalid_request|bad_request/, "provider_parameter"],
    [/text|typography|subtitle|logo|ui/, "text_or_ui"],
    [/identity|geometry|product_mismatch|character_drift|continuity/, "identity_or_geometry"],
    [/reference.*conflict|conflicting_reference/, "reference_conflict"],
    [/composition|framing|safe_area|crop/, "composition"],
    [/lighting|color|palette|exposure/, "lighting_or_color"],
    [/boundary|teleport|first_frame|last_frame/, "boundary_mismatch"],
    [/action.*overload|too_many_actions/, "action_overload"],
    [/motion|physics|jitter|contact|action/, "motion_or_physics"],
    [/audio|speech|music/, "audio_ownership"],
    [/prompt|ambiguity|instruction/, "prompt_ambiguity"],
    [/quality|artifact|visual/, "quality_general"]
  ];
  if (generationRepairDefectTypes.includes(text)) return text;
  const match = aliases.find(([pattern]) => pattern.test(text));
  if (match) return match[1];
  if (!strict) return null;
  throw new Error(`Unsupported generation repair defect: ${value}`);
}

function normalizeMode(mode) {
  if (mode === "image") return "text_to_image";
  if (mode === "keyframes_to_video") return "first_last_frame_video";
  return mode;
}

function weakestDimension(scores = {}) {
  const values = Object.entries(scores ?? {}).filter(([, score]) => Number.isFinite(score));
  if (!values.length) return "visualQuality";
  values.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return values[0][0];
}

function assertSingleVariablePlan(plan) {
  if (!plan.repair.controlVariable) throw new Error("Generation repair requires one controlVariable.");
  const patches = ["promptPatch", "referencePatch", "providerParameterPatch", "structuralPatch", "editPatch"].filter((field) => plan.repair[field]);
  if (patches.length > 1) throw new Error(`Generation repair may change only one surface, received: ${patches.join(", ")}`);
  if (plan.repair.generationRequired && patches.length !== 1) throw new Error("A generation retry requires exactly one executable patch.");
}

function safeId(value, label) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized.slice(0, 80);
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function renderSummary(plan) {
  return `# 生成修复计划 · ${plan.repairId}\n\n` +
    `- 镜头：${plan.shotId}\n- 来源候选：${plan.sourceCandidateId}\n- 主要问题：${plan.diagnosis.primaryDefect}\n` +
    `- 唯一修改变量：${plan.repair.controlVariable}\n- 修复动作：${plan.repair.action}\n- 下一步：${plan.execution.nextTool}\n` +
    `- 剩余尝试：${plan.budget.attemptsRemaining}\n- 剩余镜头预算：${plan.budget.costRemaining}\n\n` +
    `## 为什么这样修\n\n${plan.diagnosis.explanation}\n\n` +
    `## 保持不变\n\n${plan.invariantContract.preservedDimensions.length ? plan.invariantContract.preservedDimensions.map((item) => `- ${item}`).join("\n") : "- 当前没有达到保留阈值的评分维度；仍须保持已批准的镜头与连续性约束。"}\n\n` +
    `## 执行约束\n\n${plan.execution.instructions}\n`;
}
