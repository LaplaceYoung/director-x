import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ENTITY_KINDS = new Set(["logo", "product", "person", "landmark", "location", "action", "style", "foreign_text", "interface", "fact"]);
const MODEL_TIERS = new Set(["weak", "standard", "strong"]);
const RESOLUTION_STATUSES = new Set(["resolved", "fallback_generated", "blocked"]);
const RIGHTS_USES = new Set(["fact_only", "reference_only", "generation_anchor", "delivery_asset"]);
const GENERATION_RIGHTS = new Set(["user_owned", "owned", "licensed", "public_domain", "attribution", "generated", "project_generated"]);

export function compileShotGroundingPlan(input, now = new Date().toISOString()) {
  if (!input?.planId?.trim() || !input?.sequenceId?.trim()) throw new Error("Shot grounding requires planId and sequenceId.");
  if (!Array.isArray(input.shots) || !input.shots.length) throw new Error("Shot grounding requires a non-empty ordered shot list.");
  const shotIds = new Set();
  const shots = input.shots.map((shot, index) => normalizeShot(shot, index));
  for (const shot of shots) {
    if (shotIds.has(shot.shotId)) throw new Error(`Duplicate shot grounding ID: ${shot.shotId}`);
    shotIds.add(shot.shotId);
  }
  const tasks = shots.flatMap((shot) => groundingTasksForShot(input.planId, shot));
  return {
    schemaVersion: "1.0",
    planId: input.planId,
    sequenceId: input.sequenceId,
    status: tasks.length ? "awaiting_research" : "ready",
    decision: tasks.length ? "required" : "not_required",
    sourcePolicy: {
      priority: ["user_assets", "official_sources", "public_domain", "licensed_libraries", "generated_fallback"],
      searchRequirement: "Open and verify the source page; a search-result thumbnail is never a usable asset.",
      rightsRequirement: "Download, reuse, and delivery rights are distinct decisions.",
      qualityRequirement: "Any local visual generation anchor requires a ready DX-Asset-Manager quality audit."
    },
    shots,
    tasks,
    taskCount: tasks.length,
    requiredTaskCount: tasks.filter((task) => task.required).length,
    createdAt: now
  };
}

export function bindShotGroundingPlanToShotlist(plan, {
  artifactRef = "shotlist.json",
  sha256,
  shotlist
}) {
  if (!plan?.planId || !Array.isArray(plan.shots)) throw new Error("A compiled shot grounding plan is required.");
  if (!/^[a-f0-9]{64}$/i.test(String(sha256 ?? ""))) throw new Error("Shot grounding binding requires the verified shotlist SHA-256.");
  if (!shotlist || !Array.isArray(shotlist.shots) || !shotlist.shots.length) throw new Error("Registered shotlist.json must contain a non-empty shots array.");
  const actual = shotlist.shots.map((shot, index) => normalizeShotlistShot(shot, index));
  if (JSON.stringify(actual.map((shot) => shot.shotId)) !== JSON.stringify(plan.shots.map((shot) => shot.shotId))) {
    throw new Error("Shot grounding order must exactly match registered shotlist.json.");
  }
  const expectedById = new Map(plan.shots.map((shot) => [shot.shotId, shot]));
  for (const shot of actual) {
    const expected = expectedById.get(shot.shotId);
    if (normalizeText(shot.purpose) !== normalizeText(expected.purpose)) throw new Error(`${shot.shotId} grounding purpose drifts from shotlist.json.`);
    if (Math.abs(shot.durationSeconds - expected.durationSeconds) > 0.001) throw new Error(`${shot.shotId} grounding duration drifts from shotlist.json.`);
  }
  return {
    ...structuredClone(plan),
    sourceBinding: {
      artifactRef,
      sha256: String(sha256).toLowerCase(),
      shotCount: actual.length,
      status: "ready"
    }
  };
}

export function finalizeShotGrounding(run, input, now = new Date().toISOString()) {
  const plan = run?.shotGroundingPlan;
  if (!plan?.planId || plan.planId !== input?.planId) throw new Error("Finalize the active shot grounding plan.");
  if (plan.sourceBinding?.status !== "ready") throw new Error("Shot grounding must be bound to the registered shotlist before finalization.");
  if (!Array.isArray(input.resolutions)) throw new Error("Shot grounding finalization requires resolutions.");
  const resolutions = new Map();
  for (const value of input.resolutions) {
    if (!plan.tasks.some((task) => task.taskId === value.taskId) || resolutions.has(value.taskId)) throw new Error(`Unknown or duplicate grounding task resolution: ${value.taskId}`);
    if (!RESOLUTION_STATUSES.has(value.status)) throw new Error(`${value.taskId} has unsupported grounding status.`);
    if (!RIGHTS_USES.has(value.rightsUse)) throw new Error(`${value.taskId} has unsupported rightsUse.`);
    const assetRefs = uniqueStrings(value.assetRefs);
    const evidenceRefs = uniqueStrings(value.evidenceRefs);
    if (value.status !== "blocked" && !evidenceRefs.length) throw new Error(`${value.taskId} requires durable evidenceRefs.`);
    if (["generation_anchor", "delivery_asset"].includes(value.rightsUse) && !assetRefs.length) throw new Error(`${value.taskId} requires at least one local assetRef for ${value.rightsUse}.`);
    if (!String(value.transferRule ?? "").trim()) throw new Error(`${value.taskId} requires a transferRule.`);
    for (const evidenceRef of evidenceRefs) assertKnownEvidence(run, evidenceRef, value.taskId);
    if (["generation_anchor", "delivery_asset"].includes(value.rightsUse)) {
      for (const assetRef of assetRefs) assertAuthorizedGenerationAsset(run, assetRef, value.taskId);
    }
    resolutions.set(value.taskId, {
      taskId: value.taskId,
      status: value.status,
      assetRefs,
      evidenceRefs,
      transferRule: value.transferRule.trim(),
      rightsUse: value.rightsUse,
      notes: value.notes?.trim() ?? null
    });
  }
  const missingRequiredTaskIds = plan.tasks.filter((task) => task.required && !resolutions.has(task.taskId)).map((task) => task.taskId);
  const blockedTaskIds = [...resolutions.values()].filter((value) => value.status === "blocked").map((value) => value.taskId);
  const shots = plan.shots.map((shot) => {
    const tasks = plan.tasks.filter((task) => task.shotId === shot.shotId);
    const shotResolutions = tasks.map((task) => resolutions.get(task.taskId)).filter(Boolean);
    const missingTaskIds = tasks.filter((task) => task.required && !resolutions.has(task.taskId)).map((task) => task.taskId);
    const blocked = shotResolutions.filter((value) => value.status === "blocked").map((value) => value.taskId);
    return {
      shotId: shot.shotId,
      taskIds: tasks.map((task) => task.taskId),
      status: missingTaskIds.length || blocked.length ? "blocked" : "ready",
      missingTaskIds,
      blockedTaskIds: blocked,
      evidenceRefs: uniqueStrings(shotResolutions.flatMap((value) => value.evidenceRefs)),
      authorizedGenerationAnchorRefs: uniqueStrings(shotResolutions.filter((value) => value.rightsUse === "generation_anchor").flatMap((value) => value.assetRefs)),
      deliveryAssetRefs: uniqueStrings(shotResolutions.filter((value) => value.rightsUse === "delivery_asset").flatMap((value) => value.assetRefs)),
      transferRules: uniqueStrings(shotResolutions.map((value) => value.transferRule))
    };
  });
  const blocked = missingRequiredTaskIds.length || blockedTaskIds.length || shots.some((shot) => shot.status === "blocked");
  return {
    schemaVersion: "1.0",
    reportId: input.reportId,
    planId: plan.planId,
    sequenceId: plan.sequenceId,
    status: blocked ? "blocked" : "ready",
    decision: plan.decision,
    sourceBinding: structuredClone(plan.sourceBinding),
    resolutions: [...resolutions.values()],
    missingRequiredTaskIds,
    blockedTaskIds,
    shots,
    authorizedGenerationAnchorRefs: uniqueStrings(shots.flatMap((shot) => shot.authorizedGenerationAnchorRefs)),
    evidenceRefs: uniqueStrings(shots.flatMap((shot) => shot.evidenceRefs)),
    finalizedAt: now
  };
}

export async function writeShotGroundingArtifacts({ projectPath, runId, plan, report = null }) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Director X run ID.");
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const outputs = {};
  if (plan) {
    outputs.plan = await write(directory, "shot_grounding_plan.json", `${JSON.stringify(plan, null, 2)}\n`);
    outputs.planSummary = await write(directory, "shot_grounding_plan.md", groundingPlanMarkdown(plan));
  }
  if (report) {
    outputs.report = await write(directory, "shot_grounding_report.json", `${JSON.stringify(report, null, 2)}\n`);
    outputs.reportSummary = await write(directory, "shot_grounding_report.md", groundingReportMarkdown(report));
  }
  return outputs;
}

function groundingTasksForShot(planId, shot) {
  const tasks = [];
  for (const entity of shot.namedEntities) {
    tasks.push(task(planId, shot, `entity:${entity.kind}:${entity.entityId}`, {
      trigger: `named_${entity.kind}`,
      query: `${entity.name} ${sourceHint(entity.kind)} official visual reference`,
      targetKind: entity.kind,
      usageRole: usageRole(entity.kind),
      required: true
    }));
  }
  for (const text of shot.exactText) {
    tasks.push(task(planId, shot, `exact-text:${safeId(text)}`, {
      trigger: "exact_text",
      query: `Verify exact on-screen text and official spelling: ${text}`,
      targetKind: "foreign_text",
      usageRole: "fact_and_overlay_verification",
      required: true
    }));
  }
  for (const claimId of shot.factualClaimIds) {
    tasks.push(task(planId, shot, `claim:${safeId(claimId)}`, {
      trigger: "factual_claim",
      query: `Find primary evidence for factual claim ${claimId} used in ${shot.shotId}`,
      targetKind: "fact",
      usageRole: "fact_verification",
      required: true
    }));
  }
  for (const assetRef of shot.userAssetRefs) {
    tasks.push(task(planId, shot, `user-asset:${safeId(assetRef)}`, {
      trigger: "user_asset",
      query: `Validate registered user asset ${assetRef} for ${shot.shotId}`,
      targetKind: "user_asset",
      usageRole: "generation_anchor_candidate",
      required: true
    }));
  }
  if (shot.continuitySensitive) {
    tasks.push(task(planId, shot, "continuity", {
      trigger: "continuity_sensitive",
      query: `Collect identity, scene, lighting, wardrobe, product, and camera anchors for ${shot.shotId}`,
      targetKind: "continuity",
      usageRole: "continuity_anchor",
      required: true
    }));
  }
  if (shot.modelTier === "weak" && shot.namedEntities.length) {
    tasks.push(task(planId, shot, "weak-model", {
      trigger: "weak_model_named_entity",
      query: `Prepare simplified unambiguous visual anchors for named entities in ${shot.shotId}`,
      targetKind: "model_support",
      usageRole: "generation_anchor_candidate",
      required: true
    }));
  }
  return dedupeTasks(tasks);
}

function task(planId, shot, suffix, value) {
  return {
    taskId: `${safeId(planId)}:${safeId(shot.shotId)}:${safeId(suffix)}`,
    shotId: shot.shotId,
    ...value,
    sourcePriority: ["user_assets", "official_sources", "public_domain", "licensed_libraries", "generated_fallback"],
    rightsPolicy: value.usageRole.includes("generation_anchor") || value.usageRole.includes("continuity")
      ? "Use local audited assets only; reference-only media may inform transfer rules but cannot enter generation pixels."
      : "Preserve source evidence and use only within its declared rights scope.",
    qualityPolicy: "DX-Asset-Manager must approve relevance, visual quality, composition, artifacts, and technical fitness before visual use."
  };
}

function normalizeShot(shot, index) {
  if (!shot?.shotId?.trim() || !shot?.purpose?.trim()) throw new Error(`Shot grounding item ${index + 1} requires shotId and purpose.`);
  if (!Number.isFinite(shot.durationSeconds) || shot.durationSeconds <= 0) throw new Error(`${shot.shotId} requires a positive durationSeconds.`);
  const modelTier = shot.modelTier ?? "standard";
  if (!MODEL_TIERS.has(modelTier)) throw new Error(`${shot.shotId} has unsupported modelTier.`);
  const namedEntities = (shot.namedEntities ?? []).map((entity) => {
    if (!entity?.entityId?.trim() || !entity?.name?.trim() || !ENTITY_KINDS.has(entity.kind)) throw new Error(`${shot.shotId} has an invalid named entity.`);
    return { entityId: entity.entityId.trim(), name: entity.name.trim(), kind: entity.kind };
  });
  return {
    shotId: shot.shotId.trim(),
    order: shot.order ?? index + 1,
    purpose: shot.purpose.trim(),
    visualDescription: shot.visualDescription?.trim() ?? "",
    durationSeconds: shot.durationSeconds,
    generationMode: shot.generationMode?.trim() ?? null,
    modelTier,
    namedEntities,
    exactText: uniqueStrings(shot.exactText),
    factualClaimIds: uniqueStrings(shot.factualClaimIds),
    userAssetRefs: uniqueStrings(shot.userAssetRefs),
    continuitySensitive: shot.continuitySensitive === true
  };
}

function normalizeShotlistShot(shot, index) {
  const shotId = shot.shotId ?? shot.shot_id ?? shot.id;
  const purpose = shot.purpose ?? shot.function ?? shot.intent ?? shot.visual;
  const durationSeconds = Number(shot.durationSeconds ?? shot.duration_seconds ?? shot.duration ?? parseDuration(shot.time));
  if (!String(shotId ?? "").trim() || !String(purpose ?? "").trim() || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`shotlist.json shot ${index + 1} requires stable shotId, purpose, and duration.`);
  }
  return { shotId: String(shotId).trim(), purpose: String(purpose).trim(), durationSeconds };
}

function assertKnownEvidence(run, ref, taskId) {
  const known = Boolean(run.artifacts?.[ref])
    || (run.assets ?? []).some((asset) => [asset.id, asset.artifactRef].includes(ref))
    || (run.references ?? []).some((reference) => [reference.referenceId, reference.clipArtifactRef].includes(ref));
  if (!known) throw new Error(`${taskId} references unknown evidence ${ref}.`);
}

function assertAuthorizedGenerationAsset(run, assetRef, taskId) {
  const asset = (run.assets ?? []).find((item) => [item.id, item.artifactRef].includes(assetRef));
  if (!asset?.localPath) throw new Error(`${taskId} generation asset ${assetRef} is not a registered local asset.`);
  if (!GENERATION_RIGHTS.has(asset.rightsStatus)) throw new Error(`${taskId} generation asset ${assetRef} has incompatible rights: ${asset.rightsStatus}.`);
  const audit = Object.values(run.assetQualityAudits ?? {}).find((value) =>
    value.status === "ready" && [value.assetRef, value.artifactRef].some((ref) => [asset.id, asset.artifactRef, assetRef].includes(ref))
  );
  if (!audit) throw new Error(`${taskId} generation asset ${assetRef} requires a ready DX-Asset-Manager quality audit.`);
}

function groundingPlanMarkdown(plan) {
  const rows = plan.tasks.length
    ? plan.tasks.map((item) => `| ${item.shotId} | ${item.trigger} | ${item.query} | ${item.usageRole} | ${item.required ? "必须" : "可选"} |`).join("\n")
    : "| - | 无 | 本镜头序列不需要外部 Grounding | - | - |";
  return `# 逐镜头 Grounding 计划\n\n- 序列：${plan.sequenceId}\n- 状态：${plan.status}\n- 任务数：${plan.taskCount}\n\n| 镜头 | 触发原因 | 检索/验证任务 | 用途 | 要求 |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
}

function groundingReportMarkdown(report) {
  const rows = report.shots.map((shot) => `| ${shot.shotId} | ${shot.status} | ${shot.evidenceRefs.join(", ") || "-"} | ${shot.authorizedGenerationAnchorRefs.join(", ") || "-"} |`).join("\n");
  return `# 逐镜头 Grounding 完成报告\n\n- 序列：${report.sequenceId}\n- 状态：${report.status}\n- 已授权生成锚点：${report.authorizedGenerationAnchorRefs.length}\n\n| 镜头 | 状态 | 证据 | 可进入生成的锚点 |\n| --- | --- | --- | --- |\n${rows}\n`;
}

async function write(directory, artifactRef, content) {
  const path = join(directory, artifactRef);
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  return { artifactRef, path };
}

function usageRole(kind) {
  if (["logo", "product", "person", "landmark", "location", "interface"].includes(kind)) return "generation_anchor_candidate";
  if (kind === "fact" || kind === "foreign_text") return "fact_and_overlay_verification";
  if (kind === "style") return "reference_only_style_learning";
  return "motion_and_action_reference";
}

function sourceHint(kind) {
  if (kind === "logo") return "brand identity";
  if (kind === "interface") return "product UI";
  if (["location", "landmark"].includes(kind)) return "location photography";
  if (kind === "person") return "identity";
  return kind.replaceAll("_", " ");
}

function dedupeTasks(tasks) {
  const seen = new Set();
  return tasks.filter((value) => !seen.has(value.taskId) && seen.add(value.taskId));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function safeId(value) {
  const result = String(value ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
  if (!result) throw new Error("Grounding identifier is required.");
  return result;
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function parseDuration(value) {
  const match = String(value ?? "").match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/);
  return match ? Number(match[2]) - Number(match[1]) : Number.NaN;
}
