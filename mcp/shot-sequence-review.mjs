import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const SHOT_SEQUENCE_FUNCTIONS = Object.freeze([
  "hook",
  "anchor",
  "context",
  "setup",
  "proof",
  "texture",
  "transition",
  "emotion",
  "product",
  "reaction",
  "payoff",
  "cta",
  "continuity_anchor"
]);

export const SHOT_SEQUENCE_SIZES = Object.freeze([
  "extreme_wide",
  "wide",
  "full",
  "medium",
  "medium_close",
  "close",
  "extreme_close",
  "insert",
  "pov",
  "over_shoulder"
]);

export const SHOT_SEQUENCE_MOVEMENTS = Object.freeze([
  "locked",
  "pan",
  "tilt",
  "dolly_in",
  "dolly_out",
  "track",
  "arc",
  "crane",
  "handheld",
  "whip_pan",
  "zoom",
  "parallax"
]);

const ACTION_PHASES = Object.freeze(["idle", "setup", "initiation", "midpoint", "impact", "reaction", "resolution"]);
const SCREEN_DIRECTIONS = new Set(["left_to_right", "right_to_left", "toward_camera", "away_camera", "neutral"]);
const EYELINE_DIRECTIONS = new Set(["camera_left", "camera_right", "center", "up", "down"]);
const AXIS_RESET_METHODS = new Set(["dip_to_black", "cross_dissolve", "bridge_frame"]);
const MOVING_CAMERA = new Set(SHOT_SEQUENCE_MOVEMENTS.filter((movement) => movement !== "locked"));
const PROOF_FUNCTIONS = new Set(["proof", "product", "payoff"]);
const ESTABLISHING_SIZES = new Set(["extreme_wide", "wide", "full"]);

const KNOWLEDGE_BASIS = Object.freeze([
  {
    principleId: "continuity-axis-eyeline-action",
    sourceTitle: "Continuity Editing and the 180 Degree Rule",
    sourceUrl: "https://www.studiobinder.com/blog/what-is-continuity-editing-in-film/",
    transferRule: "Preserve axis, eyeline, and action phase unless a visible reset or evidence-backed intentional break explains the discontinuity."
  },
  {
    principleId: "rhythm-duration-emotion",
    sourceTitle: "How Does an Editor Control the Rhythm of a Film?",
    sourceUrl: "https://www.studiobinder.com/blog/how-does-an-editor-control-the-rhythm-of-a-film/",
    transferRule: "Treat shot duration as an emotional rhythm variable: shorten or lengthen relative to the sequence baseline for a stated dramatic reason."
  },
  {
    principleId: "camera-movement-story-function",
    sourceTitle: "Storyboard Camera Movement",
    sourceUrl: "https://www.studiobinder.com/blog/storyboard-camera-movement/",
    transferRule: "Name every camera move in the storyboard and bind it to a narrative or attention-directing motivation."
  }
]);

export function reviewShotSequence(input, transitionPlan = null) {
  if (!input?.reviewId || !input.sequenceId) throw new Error("Shot sequence review requires reviewId and sequenceId.");
  if (!Array.isArray(input.shots) || input.shots.length < 2) throw new Error("Shot sequence review requires at least two shots.");
  const targetDurationSeconds = positiveNumber(input.targetDurationSeconds, "targetDurationSeconds");
  const qualityThreshold = boundedNumber(input.qualityThreshold ?? 72, 50, 95, "qualityThreshold");
  const shots = input.shots.map(normalizeShot);
  const exceptions = normalizeExceptions(input.intentionalExceptions ?? [], shots);
  const blockers = [];
  const warnings = [];
  const repairs = [];

  validateOrder(shots, blockers, repairs);
  const orderedShots = [...shots].sort((left, right) => left.order - right.order);
  validateDuration(orderedShots, targetDurationSeconds, blockers, repairs);
  validateTransitionPlan(orderedShots, input.sequenceId, transitionPlan, blockers, repairs);
  validateShotMotivation(orderedShots, exceptions, blockers, warnings, repairs);
  validateNarrativeCoverage(orderedShots, input, exceptions, blockers, warnings, repairs);
  validateSceneCoverage(orderedShots, exceptions, warnings, repairs);
  const adjacency = reviewAdjacency(orderedShots, transitionPlan, exceptions, blockers, warnings, repairs);
  validateRepetition(orderedShots, exceptions, warnings, repairs);
  validateEmotionalShape(orderedShots, input.targetEmotionalArc ?? [], exceptions, warnings, repairs);

  const dimensions = scoreDimensions({
    shots: orderedShots,
    targetEmotionalArc: input.targetEmotionalArc ?? [],
    blockers,
    warnings
  });
  const overallScore = round(
    dimensions.narrativeFunction * 0.18
    + dimensions.coverage * 0.13
    + dimensions.visualVariation * 0.13
    + dimensions.continuity * 0.2
    + dimensions.rhythm * 0.14
    + dimensions.emotionalArc * 0.12
    + dimensions.movementMotivation * 0.1
  );
  const status = blockers.length === 0 && overallScore >= qualityThreshold ? "ready" : "revision_required";

  if (blockers.length === 0 && overallScore < qualityThreshold) {
    repairs.push(repair("sequence_quality_below_threshold", orderedShots.map((shot) => shot.shotId), "重新分配镜头功能、尺度、节奏或情绪能量，使序列达到导演审查阈值。", `当前 ${overallScore}，要求至少 ${qualityThreshold}。`, "blocker"));
  }

  return {
    schemaVersion: "1.0",
    reviewId: input.reviewId,
    sequenceId: input.sequenceId,
    status,
    qualityThreshold,
    targetDurationSeconds,
    actualDurationSeconds: round(sum(orderedShots.map((shot) => shot.durationSeconds))),
    shotOrder: orderedShots.map((shot) => shot.shotId),
    shotContract: orderedShots.map((shot) => ({
      shotId: shot.shotId,
      order: shot.order,
      beatId: shot.beatId,
      purpose: shot.purpose,
      function: shot.function,
      durationSeconds: shot.durationSeconds
    })),
    sourceBinding: null,
    dimensions,
    overallScore,
    metrics: sequenceMetrics(orderedShots, adjacency),
    emotionalArc: buildEmotionalArc(orderedShots, input.targetEmotionalArc ?? []),
    adjacency,
    blockers: uniqueIssues(blockers),
    warnings: uniqueIssues(warnings),
    repairs: uniqueRepairs(repairs),
    intentionalExceptions: [...exceptions.values()],
    knowledgeEntryIds: uniqueStrings(input.knowledgeEntryIds ?? []),
    knowledgeBasis: KNOWLEDGE_BASIS,
    reviewedAt: new Date().toISOString()
  };
}

export function bindShotSequenceReviewToShotlist(review, { artifactRef = "shotlist.json", sha256, shotlist }) {
  if (!review?.reviewId || !Array.isArray(review.shotContract)) throw new Error("A compiled shot sequence review is required.");
  if (!/^[a-f0-9]{64}$/i.test(String(sha256 ?? ""))) throw new Error("Shotlist binding requires the verified artifact SHA-256.");
  if (!shotlist || typeof shotlist !== "object" || !Array.isArray(shotlist.shots) || !shotlist.shots.length) {
    throw new Error("Registered shotlist.json must contain a non-empty shots array.");
  }
  const normalized = shotlist.shots.map((shot, index) => normalizeShotlistBindingShot(shot, index));
  const issues = [];
  const repairs = [];
  const expected = review.shotContract;
  if (normalized.length !== expected.length) {
    issues.push(issue("shotlist_shot_count_mismatch", expected.map((shot) => shot.shotId), `审查包含 ${expected.length} 镜，但真实 shotlist.json 包含 ${normalized.length} 镜。`));
  }
  const actualOrder = normalized.map((shot) => shot.shotId);
  if (JSON.stringify(actualOrder) !== JSON.stringify(review.shotOrder)) {
    issues.push(issue("shotlist_order_mismatch", [...new Set([...review.shotOrder, ...actualOrder])], "导演审查顺序与真实 shotlist.json 的镜头顺序不一致。"));
  }
  const actualById = new Map(normalized.map((shot) => [shot.shotId, shot]));
  for (const expectedShot of expected) {
    const actual = actualById.get(expectedShot.shotId);
    if (!actual) {
      issues.push(issue("shotlist_shot_missing", [expectedShot.shotId], `${expectedShot.shotId} 不存在于真实 shotlist.json。`));
      continue;
    }
    if (Math.abs(actual.durationSeconds - expectedShot.durationSeconds) > 0.001) {
      issues.push(issue("shotlist_duration_drift", [expectedShot.shotId], `${expectedShot.shotId} 审查时长 ${expectedShot.durationSeconds}s 与真实镜头表 ${actual.durationSeconds}s 不一致。`));
    }
    if (normalizeText(actual.purpose) !== normalizeText(expectedShot.purpose)) {
      issues.push(issue("shotlist_purpose_drift", [expectedShot.shotId], `${expectedShot.shotId} 的叙事目的与真实镜头表不一致。`));
    }
  }
  const declaredTarget = optionalPositiveNumber(shotlist.target_duration_seconds ?? shotlist.targetDurationSeconds, "shotlist.target_duration_seconds");
  if (declaredTarget !== null && Math.abs(declaredTarget - review.targetDurationSeconds) > Math.max(0.25, review.targetDurationSeconds * 0.01)) {
    issues.push(issue("shotlist_target_duration_drift", review.shotOrder, `真实镜头表目标时长 ${declaredTarget}s 与审查目标 ${review.targetDurationSeconds}s 不一致。`));
  }
  if (issues.length) {
    repairs.push(repair(
      "shotlist_review_binding_mismatch",
      [...new Set(issues.flatMap((item) => item.shotIds))],
      "以真实 shotlist.json 为唯一来源重新编译转场和镜头序列审查，不要在工具参数中临时改写镜头。",
      "导演审查、模型提示词和渲染必须引用同一份镜头表内容与哈希。",
      "blocker"
    ));
  }
  const next = structuredClone(review);
  next.sourceBinding = {
    artifactRef,
    sha256: String(sha256).toLowerCase(),
    shotCount: normalized.length,
    targetDurationSeconds: declaredTarget,
    status: issues.length ? "revision_required" : "ready"
  };
  next.blockers = uniqueIssues([...(next.blockers ?? []), ...issues]);
  next.repairs = uniqueRepairs([...(next.repairs ?? []), ...repairs]);
  if (issues.length) next.status = "revision_required";
  return next;
}

export async function writeShotSequenceReview({ projectPath, runId, review }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const reviewArtifactRef = "shot_sequence_review.json";
  const reviewPath = join(directory, reviewArtifactRef);
  const summaryArtifactRef = "shot_sequence_review.md";
  const summaryPath = join(directory, summaryArtifactRef);
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(summaryPath, shotSequenceReviewMarkdown(review), { encoding: "utf8", mode: 0o600 });
  return {
    review: { artifactRef: reviewArtifactRef, path: reviewPath },
    summary: { artifactRef: summaryArtifactRef, path: summaryPath }
  };
}

function validateOrder(shots, blockers, repairs) {
  const ids = shots.map((shot) => shot.shotId);
  if (new Set(ids).size !== ids.length) {
    blockers.push(issue("duplicate_shot_id", ids, "镜头 ID 必须唯一。"));
    repairs.push(repair("duplicate_shot_id", ids, "为重复镜头分配唯一 ID。", "镜头关系和审查证据必须能稳定指向单一镜头。", "blocker"));
  }
  const orders = shots.map((shot) => shot.order);
  if (new Set(orders).size !== orders.length || [...orders].sort((a, b) => a - b).some((value, index) => value !== index + 1)) {
    blockers.push(issue("non_contiguous_shot_order", ids, "镜头顺序必须从 1 开始且连续、唯一。"));
    repairs.push(repair("non_contiguous_shot_order", ids, "按最终叙事顺序重新编号镜头。", "非连续顺序会让转场、节奏和渲染绑定产生歧义。", "blocker"));
  }
}

function validateDuration(shots, targetDurationSeconds, blockers, repairs) {
  const actual = sum(shots.map((shot) => shot.durationSeconds));
  const tolerance = Math.max(0.25, targetDurationSeconds * 0.01);
  if (Math.abs(actual - targetDurationSeconds) > tolerance) {
    blockers.push(issue("sequence_duration_mismatch", shots.map((shot) => shot.shotId), `镜头合计 ${round(actual)} 秒，与目标 ${targetDurationSeconds} 秒不一致。`));
    repairs.push(repair("sequence_duration_mismatch", shots.map((shot) => shot.shotId), `调整镜头时长，使合计落在 ${round(targetDurationSeconds - tolerance)}–${round(targetDurationSeconds + tolerance)} 秒。`, "成片节奏必须先满足交付时长。", "blocker"));
  }
}

function validateTransitionPlan(shots, sequenceId, transitionPlan, blockers, repairs) {
  if (!transitionPlan) {
    blockers.push(issue("transition_language_plan_missing", shots.map((shot) => shot.shotId), "镜头序列审查需要先完成导演转场方案。"));
    repairs.push(repair("transition_language_plan_missing", shots.map((shot) => shot.shotId), "先编译相邻镜头的导演转场与声音桥，再重新审查序列。", "镜头排列与镜头边界必须使用同一套连续性证据。", "blocker"));
    return;
  }
  if (transitionPlan.status !== "ready") blockers.push(issue("transition_language_plan_not_ready", shots.map((shot) => shot.shotId), "导演转场方案仍有阻塞项。"));
  if (transitionPlan.sequenceId !== sequenceId) blockers.push(issue("transition_sequence_mismatch", shots.map((shot) => shot.shotId), "转场方案与当前镜头序列 ID 不一致。"));
  const order = shots.map((shot) => shot.shotId);
  if (JSON.stringify(transitionPlan.shotOrder ?? []) !== JSON.stringify(order)) {
    blockers.push(issue("transition_shot_order_mismatch", order, "转场方案的镜头顺序与当前审查顺序不一致。"));
    repairs.push(repair("transition_shot_order_mismatch", order, "用当前最终镜头顺序重新编译转场方案。", "旧的边界方案不能约束新的镜头排列。", "blocker"));
  }
}

function validateShotMotivation(shots, exceptions, blockers, warnings, repairs) {
  for (const shot of shots) {
    if (MOVING_CAMERA.has(shot.movement) && shot.movementMotivation.length < 6) {
      addWithException({
        ruleId: "unmotivated_camera_movement",
        shotIds: [shot.shotId],
        message: `${shot.shotId} 使用 ${shot.movement}，但没有足够明确的叙事动机。`,
        action: "说明该运动如何揭示信息、改变关系、跟随动作或推动情绪；否则改为 locked。",
        rationale: "镜头运动应改变观众感知，而不是作为装饰。",
        exceptions,
        blockers,
        warnings,
        repairs,
        hard: true
      });
    }
    const density = shot.captionUnits / shot.durationSeconds;
    if (density > 7) {
      addWithException({
        ruleId: "caption_density_unreadable",
        shotIds: [shot.shotId],
        message: `${shot.shotId} 的字幕/信息密度为 ${round(density)} 单位/秒，超过可执行上限。`,
        action: "减少屏幕文字、延长镜头，或把信息拆到下一镜。",
        rationale: "观众需要同时处理画面、旁白和字幕。",
        exceptions,
        blockers,
        warnings,
        repairs,
        hard: true
      });
    } else if (density > 5.5 || (shot.informationLoad >= 0.85 && shot.durationSeconds < 2.5)) {
      warnings.push(issue("shot_information_overload", [shot.shotId], `${shot.shotId} 的信息量接近可读性上限。`));
      repairs.push(repair("shot_information_overload", [shot.shotId], "降低单镜信息量，或为关键证据增加停留时间。", "高密度镜头需要更清晰的视觉层级。", "warning"));
    }
  }
}

function validateNarrativeCoverage(shots, input, exceptions, blockers, warnings, repairs) {
  if (input.requireCta === true && !shots.some((shot) => shot.function === "cta")) {
    blockers.push(issue("required_cta_missing", shots.map((shot) => shot.shotId), "该序列要求 CTA，但镜头表中没有 CTA 镜头。"));
    repairs.push(repair("required_cta_missing", [shots.at(-1).shotId], "增加或改写收束镜头，使行动提示可见、可听且可截图复用。", "交付承诺要求明确行动出口。", "blocker"));
  }
  if (input.requireProof === true && !shots.some((shot) => PROOF_FUNCTIONS.has(shot.function))) {
    blockers.push(issue("required_proof_missing", shots.map((shot) => shot.shotId), "该序列包含事实或产品主张，但没有证明镜头。"));
    repairs.push(repair("required_proof_missing", shots.map((shot) => shot.shotId), "加入可观察过程、结果、产品状态或来源证据镜头。", "旁白主张必须由画面承担证明责任。", "blocker"));
  }
  for (const run of repeatedRuns(shots, (shot) => shot.function)) {
    if (run.value === "texture" && run.items.length >= 3 && !hasException(exceptions, "texture_run_intentional", run.items.map((shot) => shot.shotId))) {
      warnings.push(issue("texture_run_without_progress", run.items.map((shot) => shot.shotId), "连续氛围镜头没有推进事实、动作或情绪。"));
      repairs.push(repair("texture_run_without_progress", run.items.map((shot) => shot.shotId), "把其中一镜替换为证明、反应或因果推进镜头。", "质感镜头不能代替叙事进展。", "warning"));
    }
  }
}

function validateSceneCoverage(shots, exceptions, warnings, repairs) {
  const byScene = groupBy(shots, (shot) => shot.sceneId);
  for (const [sceneId, sceneShots] of byScene) {
    if (sceneShots.length < 3) continue;
    const first = sceneShots[0];
    if (!first.establishesSpace && !ESTABLISHING_SIZES.has(first.shotSize) && !hasException(exceptions, "withhold_geography_intentional", [first.shotId])) {
      warnings.push(issue("scene_geography_not_established", [first.shotId], `${sceneId} 在多镜头展开前没有建立空间关系。`));
      repairs.push(repair("scene_geography_not_established", [first.shotId], "增加环境锚点、宽镜头或明确的空间声音；若故意隐藏空间，请记录导演理由。", "空间锚点能降低后续视线与轴线理解成本。", "warning"));
    }
  }
}

function reviewAdjacency(shots, transitionPlan, exceptions, blockers, warnings, repairs) {
  const boundaries = new Map((transitionPlan?.boundaries ?? []).map((boundary) => [boundary.boundaryId, boundary]));
  const reports = [];
  for (let index = 0; index < shots.length - 1; index += 1) {
    const from = shots[index];
    const to = shots[index + 1];
    const boundaryId = `${from.shotId}->${to.shotId}`;
    const transition = boundaries.get(boundaryId);
    const findings = [];

    if (from.sceneId === to.sceneId && reversesHorizontalDirection(from.screenDirection, to.screenDirection) && !axisReset(from, to, transition)) {
      addWithException({
        ruleId: "screen_direction_break",
        shotIds: [from.shotId, to.shotId],
        message: `${boundaryId} 在同一空间直接反转左右运动方向，且没有中性镜头、可见越轴或重置转场。`,
        action: "保持同侧轴线，或插入中性/正面/环境切镜，或让摄影机在连续镜头中可见越轴。",
        rationale: "无提示穿轴会让人物与运动关系突然翻转。",
        exceptions,
        blockers,
        warnings,
        repairs,
        hard: true
      });
      findings.push("screen_direction_break");
    }

    if (from.sceneId === to.sceneId && from.primarySubjectId && to.primarySubjectId && from.primarySubjectId !== to.primarySubjectId
      && from.eyelineDirection && from.eyelineDirection === to.eyelineDirection && !axisReset(from, to, transition)) {
      addWithException({
        ruleId: "eyeline_match_break",
        shotIds: [from.shotId, to.shotId],
        message: `${boundaryId} 的对切主体朝同一画面方向看，空间关系不成立。`,
        action: "让对切主体使用相反视线方向，或先建立新的空间关系。",
        rationale: "视线匹配承担人物关系和场景地理信息。",
        exceptions,
        blockers,
        warnings,
        repairs,
        hard: true
      });
      findings.push("eyeline_match_break");
    }

    if (from.sceneId === to.sceneId && from.actionKey && from.actionKey === to.actionKey
      && phaseIndex(to.actionPhase) < phaseIndex(from.actionPhase) && !hasException(exceptions, "action_restart_intentional", [from.shotId, to.shotId])) {
      blockers.push(issue("action_phase_regression", [from.shotId, to.shotId], `${boundaryId} 把同一动作从 ${from.actionPhase} 倒退到 ${to.actionPhase}。`));
      repairs.push(repair("action_phase_regression", [from.shotId, to.shotId], "把后镜提示词改为继续动作，或调整镜头顺序和切点。", "动作匹配需要从前镜已发生的阶段继续。", "blocker"));
      findings.push("action_phase_regression");
    }

    if (sameSubjectAndSetup(from, to) && angleDelta(from.cameraAngleDegrees, to.cameraAngleDegrees) < 30
      && ["cut", "match_cut"].includes(transition?.renderKind)) {
      warnings.push(issue("jump_cut_angle_risk", [from.shotId, to.shotId], `${boundaryId} 对同一主体的机位变化小于 30°，存在无意跳切风险。`));
      repairs.push(repair("jump_cut_angle_risk", [from.shotId, to.shotId], "改变机位角度、镜头尺度，或明确把跳切作为节奏语言。", "相近构图直接切换容易被观众感知为画面跳动。", "warning"));
      findings.push("jump_cut_angle_risk");
    }

    const energyDelta = to.emotionalEnergy - from.emotionalEnergy;
    if (energyDelta > 0.2 && to.durationSeconds > from.durationSeconds * 1.35) {
      warnings.push(issue("energy_rise_duration_drag", [from.shotId, to.shotId], `${boundaryId} 情绪明显升高，但后镜时长反而大幅增加。`));
      repairs.push(repair("energy_rise_duration_drag", [to.shotId], "缩短后镜，或在长镜内部设计构图/动作变化支撑升能。", "节奏变化需要与情绪意图一致。", "warning"));
      findings.push("energy_rise_duration_drag");
    }
    if (energyDelta < -0.2 && to.durationSeconds < from.durationSeconds * 0.65) {
      warnings.push(issue("energy_release_too_short", [from.shotId, to.shotId], `${boundaryId} 情绪回落，但没有给观众足够的释放停留。`));
      repairs.push(repair("energy_release_too_short", [to.shotId], "延长反应、余韵或收束镜头，或降低回落幅度。", "情绪释放需要可感知的时间。", "warning"));
      findings.push("energy_release_too_short");
    }

    reports.push({
      boundaryId,
      fromShotId: from.shotId,
      toShotId: to.shotId,
      transitionMethod: transition?.directorMethod ?? null,
      renderKind: transition?.renderKind ?? null,
      continuityStatus: findings.some((finding) => ["screen_direction_break", "eyeline_match_break", "action_phase_regression"].includes(finding)) ? "revision_required" : "ready",
      energyDelta: round(energyDelta),
      durationRatio: round(to.durationSeconds / from.durationSeconds),
      findings
    });
  }
  return reports;
}

function validateRepetition(shots, exceptions, warnings, repairs) {
  for (const [ruleId, label, selector] of [
    ["shot_size_repetition", "镜头尺度", (shot) => shot.shotSize],
    ["camera_movement_repetition", "摄影机运动", (shot) => shot.movement]
  ]) {
    for (const run of repeatedRuns(shots, selector)) {
      if (run.items.length < 3 || hasException(exceptions, ruleId, run.items.map((shot) => shot.shotId))) continue;
      warnings.push(issue(ruleId, run.items.map((shot) => shot.shotId), `连续 ${run.items.length} 镜使用相同${label} ${run.value}，视觉句法趋于单调。`));
      repairs.push(repair(ruleId, run.items.map((shot) => shot.shotId), `根据叙事重点改变其中一镜的${label}，或记录重复的形式意图。`, "变化应服务注意力和情绪，而不是随机装饰。", "warning"));
    }
  }
}

function validateEmotionalShape(shots, targets, exceptions, warnings, repairs) {
  if (shots.length < 4 || targets.length) return;
  const energies = shots.map((shot) => shot.emotionalEnergy);
  if (Math.max(...energies) - Math.min(...energies) < 0.12 && !hasException(exceptions, "flat_affect_intentional", shots.map((shot) => shot.shotId))) {
    warnings.push(issue("emotional_flatline", shots.map((shot) => shot.shotId), "整段情绪能量几乎没有变化。"));
    repairs.push(repair("emotional_flatline", shots.map((shot) => shot.shotId), "为钩子、证明、反应与收束设置可辨识的能量起伏。", "情绪曲线应体现信息优先级和叙事转折。", "warning"));
  }
}

function scoreDimensions({ shots, targetEmotionalArc, blockers, warnings }) {
  const blockerCodes = new Set(blockers.map((item) => item.code));
  const warningCodes = new Set(warnings.map((item) => item.code));
  const distinctSizes = new Set(shots.map((shot) => shot.shotSize)).size;
  const distinctMovements = new Set(shots.map((shot) => shot.movement)).size;
  const motivated = shots.filter((shot) => shot.movement === "locked" || shot.movementMotivation.length >= 6).length;
  const functionCoverage = new Set(shots.map((shot) => shot.function)).size;
  const establishingScenes = [...groupBy(shots, (shot) => shot.sceneId).values()].filter((sceneShots) => sceneShots.length < 3 || sceneShots[0].establishesSpace || ESTABLISHING_SIZES.has(sceneShots[0].shotSize)).length;
  const sceneCount = groupBy(shots, (shot) => shot.sceneId).size;
  const continuityIssueCount = [...blockerCodes, ...warningCodes].filter((code) => /direction|eyeline|action_phase|jump_cut|transition/.test(code)).length;
  const rhythmIssueCount = [...blockerCodes, ...warningCodes].filter((code) => /duration|density|information|energy|repetition/.test(code)).length;
  const emotionalArc = emotionalArcScore(shots, targetEmotionalArc);
  return {
    narrativeFunction: clampScore(55 + Math.min(45, functionCoverage * 9) - (warningCodes.has("texture_run_without_progress") ? 15 : 0)),
    coverage: clampScore(sceneCount ? (establishingScenes / sceneCount) * 100 : 100),
    visualVariation: clampScore(((distinctSizes / Math.min(4, shots.length)) * 55) + ((distinctMovements / Math.min(4, shots.length)) * 45)),
    continuity: clampScore(100 - continuityIssueCount * 22),
    rhythm: clampScore(100 - rhythmIssueCount * 13),
    emotionalArc,
    movementMotivation: clampScore((motivated / shots.length) * 100)
  };
}

function emotionalArcScore(shots, targets) {
  if (Array.isArray(targets) && targets.length) {
    const byBeat = groupBy(shots, (shot) => shot.beatId);
    const errors = targets.map((target, index) => {
      const beatId = String(target?.beatId ?? "").trim();
      if (!beatId) throw new Error(`targetEmotionalArc[${index}].beatId is required.`);
      const targetEnergy = boundedNumber(target.targetEnergy, 0, 1, `targetEmotionalArc[${index}].targetEnergy`);
      const beatShots = byBeat.get(beatId) ?? [];
      if (!beatShots.length) return 1;
      return Math.abs(average(beatShots.map((shot) => shot.emotionalEnergy)) - targetEnergy);
    });
    return clampScore(100 * (1 - average(errors)));
  }
  const energies = shots.map((shot) => shot.emotionalEnergy);
  const range = Math.max(...energies) - Math.min(...energies);
  return clampScore(55 + Math.min(45, (range / 0.35) * 45));
}

function sequenceMetrics(shots, adjacency) {
  return {
    shotCount: shots.length,
    sceneCount: groupBy(shots, (shot) => shot.sceneId).size,
    averageShotDurationSeconds: round(average(shots.map((shot) => shot.durationSeconds))),
    shortestShotSeconds: Math.min(...shots.map((shot) => shot.durationSeconds)),
    longestShotSeconds: Math.max(...shots.map((shot) => shot.durationSeconds)),
    distinctShotSizes: new Set(shots.map((shot) => shot.shotSize)).size,
    distinctMovements: new Set(shots.map((shot) => shot.movement)).size,
    emotionalEnergyRange: round(Math.max(...shots.map((shot) => shot.emotionalEnergy)) - Math.min(...shots.map((shot) => shot.emotionalEnergy))),
    adjacencyRevisionCount: adjacency.filter((boundary) => boundary.continuityStatus !== "ready").length
  };
}

function buildEmotionalArc(shots, targets) {
  const targetMap = new Map((targets ?? []).map((target) => [String(target.beatId), target.targetEnergy]));
  return shots.map((shot) => ({
    shotId: shot.shotId,
    beatId: shot.beatId,
    energy: shot.emotionalEnergy,
    targetEnergy: targetMap.has(shot.beatId) ? targetMap.get(shot.beatId) : null,
    durationSeconds: shot.durationSeconds,
    function: shot.function
  }));
}

function normalizeShot(shot, index) {
  const shotId = String(shot?.shotId ?? "").trim();
  if (!shotId) throw new Error(`shots[${index}].shotId is required.`);
  const functionName = requiredEnum(shot.function, SHOT_SEQUENCE_FUNCTIONS, `shots[${index}].function`);
  const shotSize = requiredEnum(shot.shotSize, SHOT_SEQUENCE_SIZES, `shots[${index}].shotSize`);
  const movement = requiredEnum(shot.movement, SHOT_SEQUENCE_MOVEMENTS, `shots[${index}].movement`);
  return {
    shotId,
    order: integerBetween(shot.order, 1, 10000, `shots[${index}].order`),
    beatId: requiredString(shot.beatId, `shots[${index}].beatId`),
    sceneId: requiredString(shot.sceneId, `shots[${index}].sceneId`),
    purpose: requiredString(shot.purpose, `shots[${index}].purpose`),
    function: functionName,
    durationSeconds: positiveNumber(shot.durationSeconds, `shots[${index}].durationSeconds`),
    shotSize,
    movement,
    movementMotivation: String(shot.movementMotivation ?? "").trim(),
    screenDirection: optionalEnum(shot.screenDirection, SCREEN_DIRECTIONS, `shots[${index}].screenDirection`),
    eyelineDirection: optionalEnum(shot.eyelineDirection, EYELINE_DIRECTIONS, `shots[${index}].eyelineDirection`),
    primarySubjectId: String(shot.primarySubjectId ?? "").trim(),
    subjectIds: uniqueStrings(shot.subjectIds ?? []),
    actionKey: String(shot.actionKey ?? "").trim(),
    actionPhase: requiredEnum(shot.actionPhase ?? "idle", ACTION_PHASES, `shots[${index}].actionPhase`),
    emotionalEnergy: boundedNumber(shot.emotionalEnergy ?? 0.5, 0, 1, `shots[${index}].emotionalEnergy`),
    informationLoad: boundedNumber(shot.informationLoad ?? 0.5, 0, 1, `shots[${index}].informationLoad`),
    captionUnits: integerBetween(shot.captionUnits ?? 0, 0, 10000, `shots[${index}].captionUnits`),
    cameraAngleDegrees: optionalBoundedNumber(shot.cameraAngleDegrees, -180, 180, `shots[${index}].cameraAngleDegrees`),
    establishesSpace: shot.establishesSpace === true,
    crossesAxisVisibly: shot.crossesAxisVisibly === true
  };
}

function normalizeShotlistBindingShot(shot, index) {
  const shotId = requiredString(shot?.shot_id ?? shot?.shotId, `shotlist.shots[${index}].shot_id`);
  return {
    shotId,
    durationSeconds: positiveNumber(shot.duration_seconds ?? shot.durationSeconds, `shotlist.shots[${index}].duration_seconds`),
    purpose: requiredString(shot.purpose, `shotlist.shots[${index}].purpose`)
  };
}

function normalizeExceptions(items, shots) {
  if (!Array.isArray(items)) throw new Error("intentionalExceptions must be an array.");
  const shotIds = new Set(shots.map((shot) => shot.shotId));
  const result = new Map();
  for (const [index, item] of items.entries()) {
    const ruleId = requiredString(item?.ruleId, `intentionalExceptions[${index}].ruleId`);
    const ids = uniqueStrings(item.shotIds ?? []);
    if (!ids.length || ids.some((shotId) => !shotIds.has(shotId))) throw new Error(`intentionalExceptions[${index}] must reference known shots.`);
    const reason = requiredString(item.reason, `intentionalExceptions[${index}].reason`);
    const evidenceRefs = uniqueStrings(item.evidenceRefs ?? []);
    if (reason.length < 8 || !evidenceRefs.length) throw new Error(`intentionalExceptions[${index}] requires a specific reason and evidenceRefs.`);
    const key = `${ruleId}:${[...ids].sort().join(",")}`;
    result.set(key, { ruleId, shotIds: ids, reason, evidenceRefs });
  }
  return result;
}

function addWithException({ ruleId, shotIds, message, action, rationale, exceptions, blockers, warnings, repairs, hard }) {
  if (hasException(exceptions, ruleId, shotIds)) {
    warnings.push(issue(`${ruleId}_intentional`, shotIds, `${message} 已记录导演有意破格及证据。`));
    return;
  }
  (hard ? blockers : warnings).push(issue(ruleId, shotIds, message));
  repairs.push(repair(ruleId, shotIds, action, rationale, hard ? "blocker" : "warning"));
}

function hasException(exceptions, ruleId, shotIds) {
  const expected = [...shotIds].sort();
  return [...exceptions.values()].some((item) => item.ruleId === ruleId && expected.every((shotId) => item.shotIds.includes(shotId)));
}

function axisReset(from, to, transition) {
  return from.screenDirection === "neutral"
    || to.screenDirection === "neutral"
    || from.crossesAxisVisibly
    || to.crossesAxisVisibly
    || AXIS_RESET_METHODS.has(transition?.directorMethod);
}

function reversesHorizontalDirection(from, to) {
  return (from === "left_to_right" && to === "right_to_left") || (from === "right_to_left" && to === "left_to_right");
}

function sameSubjectAndSetup(from, to) {
  return from.sceneId === to.sceneId
    && from.primarySubjectId
    && from.primarySubjectId === to.primarySubjectId
    && from.shotSize === to.shotSize
    && from.cameraAngleDegrees !== null
    && to.cameraAngleDegrees !== null;
}

function angleDelta(from, to) {
  if (from === null || to === null) return 180;
  const delta = Math.abs(from - to) % 360;
  return Math.min(delta, 360 - delta);
}

function phaseIndex(phase) {
  return ACTION_PHASES.indexOf(phase);
}

function repeatedRuns(items, selector) {
  const runs = [];
  for (const item of items) {
    const value = selector(item);
    const last = runs.at(-1);
    if (last?.value === value) last.items.push(item);
    else runs.push({ value, items: [item] });
  }
  return runs;
}

function groupBy(items, selector) {
  const result = new Map();
  for (const item of items) {
    const key = selector(item);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(item);
  }
  return result;
}

function issue(code, shotIds, message) {
  return { code, shotIds: uniqueStrings(shotIds), message };
}

function repair(code, shotIds, action, rationale, priority) {
  return { code, shotIds: uniqueStrings(shotIds), priority, action, rationale };
}

function uniqueIssues(items) {
  return uniqueBy(items, (item) => `${item.code}:${[...item.shotIds].sort().join(",")}`);
}

function uniqueRepairs(items) {
  return uniqueBy(items, (item) => `${item.code}:${[...item.shotIds].sort().join(",")}`);
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function shotSequenceReviewMarkdown(review) {
  const dimensionRows = Object.entries(review.dimensions).map(([name, score]) => `| ${name} | ${score} |`);
  const issueLines = review.blockers.length || review.warnings.length
    ? [
        ...review.blockers.map((item) => `- 阻塞 · ${item.code} · ${item.shotIds.join(" → ")}：${item.message}`),
        ...review.warnings.map((item) => `- 提醒 · ${item.code} · ${item.shotIds.join(" → ")}：${item.message}`)
      ]
    : ["- 未发现需要修改的镜头序列问题。"];
  return [
    "# 导演级镜头序列审查",
    "",
    `- 序列：${review.sequenceId}`,
    `- 状态：${review.status}`,
    `- 总分：${review.overallScore} / 100`,
    `- 时长：${review.actualDurationSeconds}s / ${review.targetDurationSeconds}s`,
    "",
    "## 评分",
    "",
    "| 维度 | 分数 |",
    "| --- | ---: |",
    ...dimensionRows,
    "",
    "## 镜头情绪曲线",
    "",
    "| 镜头 | 功能 | 情绪能量 | 时长 |",
    "| --- | --- | ---: | ---: |",
    ...review.emotionalArc.map((point) => `| ${tableCell(point.shotId)} | ${tableCell(point.function)} | ${point.energy} | ${point.durationSeconds}s |`),
    "",
    "## 审查发现",
    "",
    ...issueLines,
    "",
    "## 修复顺序",
    "",
    ...(review.repairs.length ? review.repairs.map((item, index) => `${index + 1}. ${item.priority === "blocker" ? "先修" : "优化"} ${item.shotIds.join(" → ")}：${item.action}`) : ["1. 当前镜头排列可进入生成。"]),
    "",
    "## 方法依据",
    "",
    ...review.knowledgeBasis.map((item) => `- [${item.sourceTitle}](${item.sourceUrl})：${item.transferRule}`),
    ""
  ].join("\n");
}

function requiredString(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function requiredEnum(value, values, name) {
  const normalized = requiredString(value, name);
  if (!values.includes(normalized)) throw new Error(`${name} must be one of: ${values.join(", ")}`);
  return normalized;
}

function optionalEnum(value, values, name) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value);
  if (!values.has(normalized)) throw new Error(`${name} must be one of: ${[...values].join(", ")}`);
  return normalized;
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a positive number.`);
  return number;
}

function optionalPositiveNumber(value, name) {
  if (value === undefined || value === null || value === "") return null;
  return positiveNumber(value, name);
}

function boundedNumber(value, minimum, maximum, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  return number;
}

function optionalBoundedNumber(value, minimum, maximum, name) {
  if (value === undefined || value === null || value === "") return null;
  return boundedNumber(value, minimum, maximum, name);
}

function integerBetween(value, minimum, maximum, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return number;
}

function uniqueStrings(items) {
  if (!Array.isArray(items)) throw new Error("Expected an array of strings.");
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values) {
  return values.length ? sum(values) / values.length : 0;
}

function clampScore(value) {
  return round(Math.max(0, Math.min(100, value)));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function tableCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
