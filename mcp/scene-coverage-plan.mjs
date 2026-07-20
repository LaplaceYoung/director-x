import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const SCENE_COVERAGE_ROLES = Object.freeze([
  "geography",
  "master",
  "primary_action",
  "proof",
  "insert",
  "reaction",
  "cutaway",
  "bridge",
  "hero",
  "cta"
]);

export const CAMERA_SIDES = Object.freeze(["axis_a", "axis_b", "neutral", "overhead"]);
export const CAMERA_HEIGHTS = Object.freeze(["ground", "low", "eye", "high", "overhead"]);
export const FRAME_REGIONS = Object.freeze(["left", "center", "right", "foreground", "background", "offscreen"]);
export const FACING_DIRECTIONS = Object.freeze(["camera_left", "camera_right", "camera", "away", "profile", "neutral"]);
export const LIGHT_DIRECTIONS = Object.freeze(["front", "front_left", "front_right", "side_left", "side_right", "back", "top", "ambient"]);
export const MEDIA_MODES = Object.freeze(["generated_video", "live_action", "still_motion", "screen_capture", "motion_graphics"]);
export const AXIS_TYPES = Object.freeze(["eyeline", "movement", "interaction", "product_demo", "neutral"]);
export const LENS_INTENTS = Object.freeze(["spatial", "natural", "intimate", "compressed", "macro"]);
export const FOCUS_STRATEGIES = Object.freeze(["deep", "subject_isolation", "rack_focus", "intentional_flatness"]);
export const NEGATIVE_SPACE_PURPOSES = Object.freeze(["text", "tension", "scale", "isolation", "none"]);

const KNOWLEDGE_BASIS = Object.freeze([
  {
    principleId: "coverage-protects-performance-and-edit",
    sourceTitle: "Shot Craft: Analyzing a Script",
    sourceUrl: "https://theasc.com/articles/shot-craft-analyzing-a-script",
    transferRule: "Give every scene geography, action, reaction, proof, and safety coverage according to its dramatic and editorial needs instead of collecting decorative angles."
  },
  {
    principleId: "lens-and-distance-control-perspective",
    sourceTitle: "Shot Craft: Large-Format Cinematography — A Close-Up",
    sourceUrl: "https://theasc.com/articles/shot-craft-large-format-cinematography-a-close-up",
    transferRule: "Treat focal length, subject distance, and camera height as one perspective decision and keep changes intentional across adjacent shots."
  },
  {
    principleId: "lighting-continuity-is-spatial-continuity",
    sourceTitle: "ARRI Behind the Scenes of The Wandering Earth",
    sourceUrl: "https://www.arri.com/news-en/arri-behind-the-scenes-of-the-wandering-earth",
    transferRule: "Preserve key direction, contrast intent, and color-temperature logic within one scene unless the story visibly motivates a reset."
  },
  {
    principleId: "real-handles-not-repeated-frames",
    sourceTitle: "Clip handles settings in Premiere",
    sourceUrl: "https://helpx.adobe.com/premiere/desktop/add-video-effects/apply-video-transitions/clip-handles-settings.html",
    transferRule: "Require real source frames outside edit points; repeated or frozen boundary frames do not satisfy motion-transition handles."
  }
]);

export function compileSceneCoveragePlan(input) {
  if (!input?.planId || !input.sequenceId) throw new Error("Scene coverage planning requires planId and sequenceId.");
  if (!Array.isArray(input.scenes) || !input.scenes.length) throw new Error("Scene coverage planning requires at least one scene.");
  if (!Array.isArray(input.shots) || input.shots.length < 2) throw new Error("Scene coverage planning requires at least two shots.");
  const targetDurationSeconds = positiveNumber(input.targetDurationSeconds, "targetDurationSeconds");
  const qualityThreshold = boundedNumber(input.qualityThreshold ?? 78, 60, 95, "qualityThreshold");
  const scenes = input.scenes.map(normalizeScene);
  const shots = input.shots.map(normalizeShot).sort((left, right) => left.order - right.order);
  const blockers = [];
  const warnings = [];
  const repairs = [];

  validateOrderAndDuration(shots, targetDurationSeconds, blockers, repairs);
  validateSceneMembership(scenes, shots, blockers, repairs);
  validateCoverage(scenes, shots, blockers, warnings, repairs);
  validateShotExecution(shots, blockers, warnings, repairs);
  validateAdjacency(shots, blockers, warnings, repairs);

  const setupGroups = compileSetupGroups(shots);
  const executionWaves = compileExecutionWaves(scenes, shots, setupGroups);
  const dimensions = scoreDimensions(scenes, shots, blockers, warnings, setupGroups);
  const overallScore = round(
    dimensions.coverageCompleteness * 0.3
    + dimensions.spatialContinuity * 0.2
    + dimensions.editSafety * 0.2
    + dimensions.compositionDepth * 0.15
    + dimensions.setupEfficiency * 0.15
  );
  const status = blockers.length === 0 && overallScore >= qualityThreshold ? "ready" : "revision_required";
  if (!blockers.length && overallScore < qualityThreshold) {
    repairs.push(repair("coverage_quality_below_threshold", shots.map((shot) => shot.shotId), `补足覆盖、景深层次或剪辑余量，使场景覆盖评分达到 ${qualityThreshold}。`, "镜头生成前先解决可剪性和摄影一致性。", "blocker"));
  }

  return {
    schemaVersion: "1.0",
    planId: input.planId,
    sequenceId: input.sequenceId,
    status,
    qualityThreshold,
    targetDurationSeconds,
    actualDurationSeconds: round(sum(shots.map((shot) => shot.durationSeconds))),
    shotOrder: shots.map((shot) => shot.shotId),
    shotContract: shots.map((shot) => ({
      shotId: shot.shotId,
      order: shot.order,
      sceneId: shot.sceneId,
      purpose: shot.purpose,
      durationSeconds: shot.durationSeconds,
      coverageRole: shot.coverageRole,
      setupKey: shot.setupKey
    })),
    sourceBinding: null,
    scenes: scenes.map((scene) => compileSceneReport(scene, shots.filter((shot) => shot.sceneId === scene.sceneId))),
    shots,
    setupGroups,
    executionWaves,
    dimensions,
    overallScore,
    metrics: {
      sceneCount: scenes.length,
      shotCount: shots.length,
      setupCount: setupGroups.length,
      averageShotsPerSetup: round(shots.length / setupGroups.length),
      generatedVideoShotCount: shots.filter((shot) => shot.mediaMode === "generated_video").length,
      fallbackCoverageCount: shots.filter((shot) => shot.fallbackShotId || ["insert", "cutaway", "bridge"].includes(shot.coverageRole)).length
    },
    blockers: uniqueIssues(blockers),
    warnings: uniqueIssues(warnings),
    repairs: uniqueRepairs(repairs),
    knowledgeEntryIds: uniqueStrings(input.knowledgeEntryIds ?? []),
    knowledgeBasis: KNOWLEDGE_BASIS,
    compiledAt: new Date().toISOString()
  };
}

export function bindSceneCoveragePlanToShotlist(plan, { artifactRef = "shotlist.json", sha256, shotlist }) {
  if (!plan?.planId || !Array.isArray(plan.shotContract)) throw new Error("A compiled scene coverage plan is required.");
  if (!/^[a-f0-9]{64}$/i.test(String(sha256 ?? ""))) throw new Error("Shotlist binding requires the verified artifact SHA-256.");
  if (!shotlist || !Array.isArray(shotlist.shots) || !shotlist.shots.length) throw new Error("Registered shotlist.json must contain a non-empty shots array.");
  const actual = shotlist.shots.map((shot, index) => ({
    shotId: requiredString(shot?.shot_id ?? shot?.shotId, `shotlist.shots[${index}].shot_id`),
    purpose: requiredString(shot?.purpose, `shotlist.shots[${index}].purpose`),
    durationSeconds: positiveNumber(shot?.duration_seconds ?? shot?.durationSeconds, `shotlist.shots[${index}].duration_seconds`)
  }));
  const issues = [];
  const expectedOrder = plan.shotContract.map((shot) => shot.shotId);
  const actualOrder = actual.map((shot) => shot.shotId);
  if (JSON.stringify(expectedOrder) !== JSON.stringify(actualOrder)) issues.push(issue("coverage_shot_order_mismatch", [...new Set([...expectedOrder, ...actualOrder])], "场景覆盖方案与真实 shotlist.json 的镜头顺序不一致。"));
  const actualById = new Map(actual.map((shot) => [shot.shotId, shot]));
  for (const expected of plan.shotContract) {
    const found = actualById.get(expected.shotId);
    if (!found) {
      issues.push(issue("coverage_shot_missing", [expected.shotId], `${expected.shotId} 不存在于真实 shotlist.json。`));
      continue;
    }
    if (Math.abs(found.durationSeconds - expected.durationSeconds) > 0.001) issues.push(issue("coverage_duration_drift", [expected.shotId], `${expected.shotId} 的时长与真实镜头表不一致。`));
    if (normalizeText(found.purpose) !== normalizeText(expected.purpose)) issues.push(issue("coverage_purpose_drift", [expected.shotId], `${expected.shotId} 的叙事目的与真实镜头表不一致。`));
  }
  const next = structuredClone(plan);
  next.sourceBinding = {
    artifactRef,
    sha256: String(sha256).toLowerCase(),
    shotCount: actual.length,
    status: issues.length ? "revision_required" : "ready"
  };
  next.blockers = uniqueIssues([...(next.blockers ?? []), ...issues]);
  if (issues.length) {
    next.status = "revision_required";
    next.repairs = uniqueRepairs([...(next.repairs ?? []), repair("coverage_binding_mismatch", issues.flatMap((item) => item.shotIds), "以真实 shotlist.json 重新编译场景覆盖方案。", "摄影、生成与剪辑必须绑定同一镜头身份、顺序、目的和时长。", "blocker")]);
  }
  return next;
}

export async function writeSceneCoveragePlan({ projectPath, runId, plan }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const planArtifactRef = "scene_coverage_plan.json";
  const planPath = join(directory, planArtifactRef);
  const summaryArtifactRef = "scene_coverage_plan.md";
  const summaryPath = join(directory, summaryArtifactRef);
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(summaryPath, sceneCoverageMarkdown(plan), { encoding: "utf8", mode: 0o600 });
  return {
    plan: { artifactRef: planArtifactRef, path: planPath },
    summary: { artifactRef: summaryArtifactRef, path: summaryPath }
  };
}

function validateOrderAndDuration(shots, targetDurationSeconds, blockers, repairs) {
  const ids = shots.map((shot) => shot.shotId);
  const orders = shots.map((shot) => shot.order);
  if (new Set(ids).size !== ids.length) blockers.push(issue("duplicate_shot_id", ids, "镜头 ID 必须唯一。"));
  if (new Set(orders).size !== orders.length || orders.some((order, index) => order !== index + 1)) blockers.push(issue("non_contiguous_shot_order", ids, "镜头顺序必须从 1 开始连续编号。"));
  const actual = sum(shots.map((shot) => shot.durationSeconds));
  const tolerance = Math.max(0.25, targetDurationSeconds * 0.01);
  if (Math.abs(actual - targetDurationSeconds) > tolerance) blockers.push(issue("coverage_duration_mismatch", ids, `镜头合计 ${round(actual)} 秒，与目标 ${targetDurationSeconds} 秒不一致。`));
  if (blockers.length) repairs.push(repair("coverage_identity_or_duration", ids, "修正镜头身份、顺序与时长后重新编译。", "覆盖方案必须稳定绑定最终时间结构。", "blocker"));
}

function validateSceneMembership(scenes, shots, blockers, repairs) {
  const sceneIds = new Set(scenes.map((scene) => scene.sceneId));
  const unknown = shots.filter((shot) => !sceneIds.has(shot.sceneId));
  if (unknown.length) {
    blockers.push(issue("unknown_scene_reference", unknown.map((shot) => shot.shotId), "镜头引用了未声明的场景。"));
    repairs.push(repair("unknown_scene_reference", unknown.map((shot) => shot.shotId), "补充场景定义或修正 sceneId。", "场景级摄影与布光规则需要稳定归属。", "blocker"));
  }
  for (const scene of scenes) {
    if (!shots.some((shot) => shot.sceneId === scene.sceneId)) blockers.push(issue("empty_scene", [], `${scene.sceneId} 没有镜头。`));
  }
}

function validateCoverage(scenes, shots, blockers, warnings, repairs) {
  for (const scene of scenes) {
    const sceneShots = shots.filter((shot) => shot.sceneId === scene.sceneId);
    const roles = new Set(sceneShots.map((shot) => shot.coverageRole));
    const required = [];
    if (scene.requiresGeography && sceneShots.length > 1) required.push(["geography", "master"]);
    if (scene.requiresAction) required.push(["primary_action"]);
    if (scene.requiresReaction) required.push(["reaction"]);
    if (scene.requiresProof) required.push(["proof", "insert"]);
    for (const alternatives of required) {
      if (!alternatives.some((role) => roles.has(role))) {
        blockers.push(issue(`scene_${alternatives[0]}_coverage_missing`, sceneShots.map((shot) => shot.shotId), `${scene.sceneId} 缺少 ${alternatives.join("/")} 覆盖。`));
        repairs.push(repair(`scene_${alternatives[0]}_coverage_missing`, sceneShots.map((shot) => shot.shotId), `为 ${scene.sceneId} 增加 ${alternatives.join(" 或 ")} 镜头。`, "覆盖必须服务空间、动作、情绪或证明责任。", "blocker"));
      }
    }
    if (scene.requiresAction && sceneShots.length >= 3 && !["insert", "cutaway", "bridge"].some((role) => roles.has(role))) {
      warnings.push(issue("action_scene_has_no_edit_safety", sceneShots.map((shot) => shot.shotId), `${scene.sceneId} 没有插入、切出或桥接镜头，动作生成失败时缺少剪辑安全垫。`));
      repairs.push(repair("action_scene_has_no_edit_safety", sceneShots.map((shot) => shot.shotId), "补充一个动作细节、环境反应或图形桥接镜头。", "AI 视频更需要可替换的安全覆盖。", "warning"));
    }
  }
}

function validateShotExecution(shots, blockers, warnings, repairs) {
  const shotIds = new Set(shots.map((shot) => shot.shotId));
  for (const shot of shots) {
    if (shot.mediaMode === "generated_video") {
      const minimum = shot.transitionCritical ? 0.5 : 0.35;
      if (shot.handles.headSeconds < minimum || shot.handles.tailSeconds < minimum) {
        blockers.push(issue("generated_video_handles_insufficient", [shot.shotId], `${shot.shotId} 的首尾剪辑余量不足 ${minimum}s。`));
        repairs.push(repair("generated_video_handles_insufficient", [shot.shotId], `把首尾可用动作余量各扩展到至少 ${minimum}s。`, "生成片段必须给转场、动作匹配和音频桥留出安全帧。", "blocker"));
      }
    }
    if (shot.coverageRole === "primary_action" && !shot.blocking.length) {
      blockers.push(issue("action_blocking_missing", [shot.shotId], `${shot.shotId} 没有主体调度。`));
      repairs.push(repair("action_blocking_missing", [shot.shotId], "明确主体起止位置、朝向、屏幕方向与动作阶段。", "没有 blocking 就无法稳定设计动作与首尾帧。", "blocker"));
    }
    const depthLayers = [shot.composition.foreground, shot.composition.midground, shot.composition.background].filter(Boolean).length;
    if (["hero", "proof", "reaction", "geography"].includes(shot.coverageRole) && depthLayers < 2) {
      warnings.push(issue("composition_depth_thin", [shot.shotId], `${shot.shotId} 缺少前中后景层次。`));
      repairs.push(repair("composition_depth_thin", [shot.shotId], "至少定义两个空间层次，并说明主体与负空间的关系。", "层次能强化空间、产品地位和镜头运动视差。", "warning"));
    }
    if (shot.fallbackShotId && !shotIds.has(shot.fallbackShotId)) blockers.push(issue("fallback_shot_missing", [shot.shotId], `${shot.shotId} 指向不存在的备用镜头 ${shot.fallbackShotId}。`));
  }
}

function validateAdjacency(shots, blockers, warnings, repairs) {
  for (let index = 0; index < shots.length - 1; index += 1) {
    const from = shots[index];
    const to = shots[index + 1];
    if (from.sceneId !== to.sceneId) continue;
    const ids = [from.shotId, to.shotId];
    if (!from.lightingReset && !to.lightingReset && from.lighting.keyDirection !== to.lighting.keyDirection) {
      blockers.push(issue("key_light_direction_break", ids, `${from.shotId} → ${to.shotId} 在同一场景中无解释地改变主光方向。`));
      repairs.push(repair("key_light_direction_break", ids, "统一主光方向，或加入可见场景/时间/光源重置。", "光向变化会破坏空间和时间连续性。", "blocker"));
    }
    const temperatureDelta = Math.abs(from.lighting.colorTemperatureK - to.lighting.colorTemperatureK);
    if (!from.lightingReset && !to.lightingReset && temperatureDelta > 1500) {
      blockers.push(issue("color_temperature_break", ids, `${from.shotId} → ${to.shotId} 的色温跳变 ${temperatureDelta}K。`));
    } else if (temperatureDelta > 800) {
      warnings.push(issue("color_temperature_drift", ids, `${from.shotId} → ${to.shotId} 的色温变化 ${temperatureDelta}K。`));
    }
    const lensRatio = Math.max(from.lensMm, to.lensMm) / Math.min(from.lensMm, to.lensMm);
    const distanceRatio = Math.max(from.cameraDistanceMeters, to.cameraDistanceMeters) / Math.min(from.cameraDistanceMeters, to.cameraDistanceMeters);
    if (lensRatio >= 2.25 && from.shotSize === to.shotSize && distanceRatio < 1.35) {
      warnings.push(issue("lens_distance_contract_inconsistent", ids, `${from.shotId} → ${to.shotId} 声明相似景别和近似机距，却大幅改变焦段，摄影参数可能无法同时成立。`));
      repairs.push(repair("lens_distance_contract_inconsistent", ids, "重新核对画幅、机距、焦段和景别；若要改变透视，应明确移动机位及其叙事目的。", "透视主要由机位与主体/背景距离关系决定，焦段负责视场与取景。", "warning"));
    }
    const azimuthDelta = angleDelta(from.cameraAzimuthDegrees, to.cameraAzimuthDegrees);
    if (from.shotSize === to.shotSize && azimuthDelta > 0 && azimuthDelta < 30) {
      warnings.push(issue("camera_angle_change_too_small", ids, `${from.shotId} → ${to.shotId} 同景别机位只变化 ${round(azimuthDelta)}°，可能形成无意跳切。`));
      repairs.push(repair("camera_angle_change_too_small", ids, "扩大机位变化、改变景别，或记录明确的 jump-cut 意图。", "相似构图需要足够的信息或视角增量。", "warning"));
    }
  }
}

function compileSetupGroups(shots) {
  const groups = new Map();
  for (const shot of shots) {
    if (!groups.has(shot.setupKey)) groups.set(shot.setupKey, []);
    groups.get(shot.setupKey).push(shot.shotId);
  }
  return [...groups.entries()].map(([setupKey, shotIds], index) => ({
    setupId: `setup-${String(index + 1).padStart(2, "0")}`,
    setupKey,
    shotIds,
    parallelizable: shotIds.length > 1,
    executionNote: shotIds.length > 1 ? "共享机位、光向和色温，可批量生成或拍摄。" : "独立摄影设置。"
  }));
}

function compileExecutionWaves(scenes, shots, setupGroups) {
  const setupByShot = new Map(setupGroups.flatMap((group) => group.shotIds.map((shotId) => [shotId, group.setupId])));
  return scenes.map((scene, index) => {
    const sceneShots = shots.filter((shot) => shot.sceneId === scene.sceneId);
    return {
      waveId: `coverage-wave-${String(index + 1).padStart(2, "0")}`,
      sceneId: scene.sceneId,
      shotIds: sceneShots.map((shot) => shot.shotId),
      setupIds: uniqueStrings(sceneShots.map((shot) => setupByShot.get(shot.shotId))),
      dependsOn: index === 0 ? [] : [`coverage-wave-${String(index).padStart(2, "0")}`],
      parallelGroups: uniqueStrings(sceneShots.map((shot) => setupByShot.get(shot.shotId)))
    };
  });
}

function scoreDimensions(scenes, shots, blockers, warnings, setupGroups) {
  const requiredCount = scenes.reduce((count, scene) => count + Number(scene.requiresGeography) + Number(scene.requiresAction) + Number(scene.requiresReaction) + Number(scene.requiresProof), 0);
  const missingCoverage = blockers.filter((item) => /coverage_missing/.test(item.code)).length;
  const continuityIssues = [...blockers, ...warnings].filter((item) => /light|temperature|perspective/.test(item.code)).length;
  const handleFailures = blockers.filter((item) => item.code === "generated_video_handles_insufficient").length;
  const deepShots = shots.filter((shot) => [shot.composition.foreground, shot.composition.midground, shot.composition.background].filter(Boolean).length >= 2).length;
  return {
    coverageCompleteness: clampScore(requiredCount ? 100 * (1 - missingCoverage / requiredCount) : 100),
    spatialContinuity: clampScore(100 - continuityIssues * 18),
    editSafety: clampScore(100 - handleFailures * 25 - warnings.filter((item) => item.code === "action_scene_has_no_edit_safety").length * 15),
    compositionDepth: clampScore((deepShots / shots.length) * 100),
    setupEfficiency: clampScore(55 + Math.min(45, ((shots.length - setupGroups.length) / Math.max(1, shots.length - 1)) * 45))
  };
}

function compileSceneReport(scene, shots) {
  const roles = uniqueStrings(shots.map((shot) => shot.coverageRole));
  return {
    ...scene,
    shotIds: shots.map((shot) => shot.shotId),
    coverageRoles: roles,
    coverageMatrix: {
      geography: roles.some((role) => ["geography", "master"].includes(role)),
      action: roles.includes("primary_action"),
      reaction: roles.includes("reaction"),
      proof: roles.some((role) => ["proof", "insert"].includes(role)),
      editSafety: roles.some((role) => ["insert", "cutaway", "bridge"].includes(role))
    }
  };
}

function normalizeScene(scene, index) {
  return {
    sceneId: requiredString(scene?.sceneId, `scenes[${index}].sceneId`),
    purpose: requiredString(scene?.purpose, `scenes[${index}].purpose`),
    axisId: requiredString(scene?.axisId, `scenes[${index}].axisId`),
    axisType: requiredEnum(scene?.axisType, AXIS_TYPES, `scenes[${index}].axisType`),
    defaultScreenDirection: requiredString(scene?.defaultScreenDirection, `scenes[${index}].defaultScreenDirection`),
    requiresGeography: scene?.requiresGeography !== false,
    requiresAction: scene?.requiresAction === true,
    requiresReaction: scene?.requiresReaction === true,
    requiresProof: scene?.requiresProof === true,
    primarySubjectIds: uniqueStrings(scene?.primarySubjectIds ?? [])
  };
}

function normalizeShot(shot, index) {
  const sceneId = requiredString(shot?.sceneId, `shots[${index}].sceneId`);
  const lensMm = boundedNumber(shot?.lensMm, 8, 300, `shots[${index}].lensMm`);
  const cameraSide = requiredEnum(shot?.cameraSide, CAMERA_SIDES, `shots[${index}].cameraSide`);
  const cameraHeight = requiredEnum(shot?.cameraHeight, CAMERA_HEIGHTS, `shots[${index}].cameraHeight`);
  const lighting = shot?.lighting ?? {};
  const handles = shot?.handles ?? {};
  const composition = shot?.composition ?? {};
  const setupKey = `${sceneId}:${cameraSide}:${cameraHeight}:${lensBucket(lensMm)}:${requiredEnum(lighting.keyDirection, LIGHT_DIRECTIONS, `shots[${index}].lighting.keyDirection`)}:${boundedNumber(lighting.colorTemperatureK, 1500, 12000, `shots[${index}].lighting.colorTemperatureK`)}`;
  return {
    shotId: requiredString(shot?.shotId, `shots[${index}].shotId`),
    order: integerBetween(shot?.order, 1, 10000, `shots[${index}].order`),
    sceneId,
    beatId: requiredString(shot?.beatId, `shots[${index}].beatId`),
    purpose: requiredString(shot?.purpose, `shots[${index}].purpose`),
    coverageRole: requiredEnum(shot?.coverageRole, SCENE_COVERAGE_ROLES, `shots[${index}].coverageRole`),
    durationSeconds: positiveNumber(shot?.durationSeconds, `shots[${index}].durationSeconds`),
    mediaMode: requiredEnum(shot?.mediaMode, MEDIA_MODES, `shots[${index}].mediaMode`),
    shotSize: requiredString(shot?.shotSize, `shots[${index}].shotSize`),
    lensMm,
    lensIntent: requiredEnum(shot?.lensIntent, LENS_INTENTS, `shots[${index}].lensIntent`),
    cameraSide,
    cameraHeight,
    cameraAzimuthDegrees: boundedNumber(shot?.cameraAzimuthDegrees, -180, 180, `shots[${index}].cameraAzimuthDegrees`),
    cameraDistanceMeters: positiveNumber(shot?.cameraDistanceMeters, `shots[${index}].cameraDistanceMeters`),
    movement: requiredString(shot?.movement, `shots[${index}].movement`),
    movementMotivation: String(shot?.movementMotivation ?? "").trim(),
    blocking: (shot?.blocking ?? []).map((item, blockingIndex) => normalizeBlocking(item, index, blockingIndex)),
    composition: {
      foreground: String(composition.foreground ?? "").trim(),
      midground: String(composition.midground ?? "").trim(),
      background: String(composition.background ?? "").trim(),
      leadRoom: boundedNumber(composition.leadRoom ?? 0.5, 0, 1, `shots[${index}].composition.leadRoom`),
      headroom: boundedNumber(composition.headroom ?? 0.5, 0, 1, `shots[${index}].composition.headroom`),
      negativeSpace: boundedNumber(composition.negativeSpace ?? 0.25, 0, 1, `shots[${index}].composition.negativeSpace`),
      negativeSpacePurpose: requiredEnum(composition.negativeSpacePurpose ?? "none", NEGATIVE_SPACE_PURPOSES, `shots[${index}].composition.negativeSpacePurpose`),
      focusStrategy: requiredEnum(composition.focusStrategy ?? "subject_isolation", FOCUS_STRATEGIES, `shots[${index}].composition.focusStrategy`)
    },
    lighting: {
      keyDirection: requiredEnum(lighting.keyDirection, LIGHT_DIRECTIONS, `shots[${index}].lighting.keyDirection`),
      colorTemperatureK: boundedNumber(lighting.colorTemperatureK, 1500, 12000, `shots[${index}].lighting.colorTemperatureK`),
      contrastRatio: boundedNumber(lighting.contrastRatio ?? 2, 1, 64, `shots[${index}].lighting.contrastRatio`)
    },
    lightingReset: shot?.lightingReset === true,
    handles: {
      headSeconds: nonNegativeNumber(handles.headSeconds ?? 0, `shots[${index}].handles.headSeconds`),
      tailSeconds: nonNegativeNumber(handles.tailSeconds ?? 0, `shots[${index}].handles.tailSeconds`)
    },
    transitionCritical: shot?.transitionCritical === true,
    fallbackShotId: String(shot?.fallbackShotId ?? "").trim(),
    setupKey
  };
}

function normalizeBlocking(item, shotIndex, blockingIndex) {
  return {
    subjectId: requiredString(item?.subjectId, `shots[${shotIndex}].blocking[${blockingIndex}].subjectId`),
    startRegion: requiredEnum(item?.startRegion, FRAME_REGIONS, `shots[${shotIndex}].blocking[${blockingIndex}].startRegion`),
    endRegion: requiredEnum(item?.endRegion, FRAME_REGIONS, `shots[${shotIndex}].blocking[${blockingIndex}].endRegion`),
    facing: requiredEnum(item?.facing, FACING_DIRECTIONS, `shots[${shotIndex}].blocking[${blockingIndex}].facing`),
    screenDirection: requiredString(item?.screenDirection, `shots[${shotIndex}].blocking[${blockingIndex}].screenDirection`),
    actionKey: requiredString(item?.actionKey, `shots[${shotIndex}].blocking[${blockingIndex}].actionKey`),
    actionPhaseIn: requiredString(item?.actionPhaseIn, `shots[${shotIndex}].blocking[${blockingIndex}].actionPhaseIn`),
    actionPhaseOut: requiredString(item?.actionPhaseOut, `shots[${shotIndex}].blocking[${blockingIndex}].actionPhaseOut`),
    motivation: requiredString(item?.motivation, `shots[${shotIndex}].blocking[${blockingIndex}].motivation`)
  };
}

function sceneCoverageMarkdown(plan) {
  return [
    "# 场景覆盖与摄影执行方案",
    "",
    `- 序列：${plan.sequenceId}`,
    `- 状态：${plan.status}`,
    `- 总分：${plan.overallScore} / 100`,
    `- 镜头：${plan.metrics.shotCount} · 场景：${plan.metrics.sceneCount} · 摄影设置：${plan.metrics.setupCount}`,
    "",
    "## 场景覆盖",
    "",
    "| 场景 | 空间 | 动作 | 反应 | 证明 | 剪辑安全 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...plan.scenes.map((scene) => `| ${cell(scene.sceneId)} | ${mark(scene.coverageMatrix.geography)} | ${mark(scene.coverageMatrix.action)} | ${mark(scene.coverageMatrix.reaction)} | ${mark(scene.coverageMatrix.proof)} | ${mark(scene.coverageMatrix.editSafety)} |`),
    "",
    "## 摄影设置与并行执行",
    "",
    ...plan.setupGroups.map((group) => `- ${group.setupId}：${group.shotIds.join("、")}；${group.executionNote}`),
    "",
    "## 审查发现",
    "",
    ...(plan.blockers.length || plan.warnings.length
      ? [...plan.blockers.map((item) => `- 阻塞 · ${item.code}：${item.message}`), ...plan.warnings.map((item) => `- 提醒 · ${item.code}：${item.message}`)]
      : ["- 场景覆盖、摄影连续性与剪辑余量可进入后续镜头审查。"]),
    "",
    "## 修复顺序",
    "",
    ...(plan.repairs.length ? plan.repairs.map((item, index) => `${index + 1}. ${item.priority === "blocker" ? "先修" : "优化"}：${item.action}`) : ["1. 无需修复。"]),
    "",
    "## 方法依据",
    "",
    ...plan.knowledgeBasis.map((item) => `- [${item.sourceTitle}](${item.sourceUrl})：${item.transferRule}`),
    ""
  ].join("\n");
}

function lensBucket(lensMm) {
  if (lensMm < 24) return "ultra_wide";
  if (lensMm < 40) return "wide";
  if (lensMm < 65) return "normal";
  if (lensMm < 105) return "portrait";
  return "telephoto";
}

function angleDelta(from, to) {
  const delta = Math.abs(from - to) % 360;
  return Math.min(delta, 360 - delta);
}

function issue(code, shotIds, message) { return { code, shotIds: uniqueStrings(shotIds), message }; }
function repair(code, shotIds, action, rationale, priority) { return { code, shotIds: uniqueStrings(shotIds), action, rationale, priority }; }
function uniqueIssues(items) { return uniqueBy(items, (item) => `${item.code}:${[...item.shotIds].sort().join(",")}`); }
function uniqueRepairs(items) { return uniqueBy(items, (item) => `${item.code}:${[...item.shotIds].sort().join(",")}`); }
function uniqueBy(items, key) { const seen = new Set(); return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }
function requiredString(value, name) { const normalized = String(value ?? "").trim(); if (!normalized) throw new Error(`${name} is required.`); return normalized; }
function requiredEnum(value, values, name) { const normalized = requiredString(value, name); if (!values.includes(normalized)) throw new Error(`${name} must be one of: ${values.join(", ")}`); return normalized; }
function positiveNumber(value, name) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a positive number.`); return number; }
function nonNegativeNumber(value, name) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be zero or positive.`); return number; }
function boundedNumber(value, minimum, maximum, name) { const number = Number(value); if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`); return number; }
function integerBetween(value, minimum, maximum, name) { const number = Number(value); if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`); return number; }
function uniqueStrings(items) { if (!Array.isArray(items)) throw new Error("Expected an array of strings."); return [...new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean))]; }
function normalizeText(value) { return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase(); }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function round(value) { return Math.round(value * 100) / 100; }
function clampScore(value) { return round(Math.max(0, Math.min(100, value))); }
function cell(value) { return String(value).replaceAll("|", "\\|"); }
function mark(value) { return value ? "✓" : "—"; }
