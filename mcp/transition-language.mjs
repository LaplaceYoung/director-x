import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const DIRECTOR_TRANSITION_METHODS = Object.freeze([
  "cut",
  "cut_on_emotion",
  "match_action",
  "match_eyeline",
  "graphic_match",
  "whip_pan",
  "cross_dissolve",
  "dip_to_black",
  "bridge_frame",
  "shader"
]);

export const RENDER_TRANSITION_KINDS = Object.freeze([
  "cut",
  "crossfade",
  "dip_to_black",
  "fade_through_color",
  "slide",
  "wipe",
  "zoom_blur",
  "match_cut",
  "whip_pan",
  "shader"
]);

const METHODS = new Set(DIRECTOR_TRANSITION_METHODS);
const RENDERERS = new Set(["remotion", "hyperframes", "directorx-cut-ffmpeg"]);
const AUDIO_BRIDGES = new Set(["none", "j_cut", "l_cut", "room_tone", "music_hit"]);
const TRANSITION_EASINGS = new Set(["linear", "ease_in", "ease_out", "ease_in_out", "spring"]);

export function compileTransitionLanguagePlan(input) {
  if (!input?.planId || !input.sequenceId) throw new Error("Transition language plan requires planId and sequenceId.");
  const fps = integerBetween(input.fps ?? 30, 1, 120, "fps");
  const renderer = String(input.renderer ?? "").trim();
  if (!RENDERERS.has(renderer)) throw new Error(`Unsupported transition renderer: ${renderer || "missing"}`);
  if (!Array.isArray(input.shots) || input.shots.length < 2) throw new Error("Transition language plan requires at least two ordered shots.");
  const shots = input.shots.map((shot, index) => normalizeShot(shot, index));
  const shotIds = new Set(shots.map((shot) => shot.shotId));
  if (shotIds.size !== shots.length) throw new Error("Transition language plan shot IDs must be unique.");
  const overrides = normalizeOverrides(input.overrides ?? [], shotIds);
  const adjacentBoundaries = new Set(shots.slice(0, -1).map((shot, index) => `${shot.shotId}->${shots[index + 1].shotId}`));
  for (const boundaryId of overrides.keys()) if (!adjacentBoundaries.has(boundaryId)) throw new Error(`Transition override must target adjacent shots: ${boundaryId}`);
  const preferences = {
    maximumTransitionSeconds: boundedNumber(input.preferences?.maximumTransitionSeconds ?? 1, 0.2, 2, "preferences.maximumTransitionSeconds"),
    preferInvisibleCuts: input.preferences?.preferInvisibleCuts !== false,
    allowShader: input.preferences?.allowShader === true
  };
  const blockers = [];
  const warnings = [];
  const boundaries = [];

  for (let index = 0; index < shots.length - 1; index += 1) {
    const from = shots[index];
    const to = shots[index + 1];
    const boundaryId = `${from.shotId}->${to.shotId}`;
    const override = overrides.get(boundaryId);
    const decision = override
      ? decisionFromOverride(override, from, to, renderer, preferences)
      : inferDecision(from, to, renderer, preferences);
    const durationSeconds = transitionDuration(decision.directorMethod, decision.durationSeconds, preferences.maximumTransitionSeconds);
    const durationFrames = Math.max(decision.renderKind === "cut" || decision.renderKind === "match_cut" ? 0 : 1, Math.round(durationSeconds * fps));
    const continuityAnchors = continuityAnchorsFor(from, to);
    const boundaryBlockers = [];
    const boundaryWarnings = [];

    if (decision.directorMethod === "match_action" && !compatibleMotion(from, to)) boundaryBlockers.push("match_action_motion_mismatch");
    if (decision.directorMethod === "match_action" && (!from.actionKey || from.actionKey !== to.actionKey)) boundaryBlockers.push("match_action_key_missing");
    if (decision.directorMethod === "match_action" && !screenDirectionCompatible(from.screenDirection, to.screenDirection)) boundaryBlockers.push("match_action_screen_direction_mismatch");
    if (decision.directorMethod === "match_eyeline" && !eyeTraceCompatible(from.eyeTraceRegion, to.eyeTraceRegion)) boundaryWarnings.push("eyeline_requires_visual_review");
    if (decision.directorMethod === "shader" && (!preferences.allowShader || !["remotion", "hyperframes"].includes(renderer))) boundaryBlockers.push("shader_transition_not_available");
    if (decision.renderKind === "cut" && !decision.rationale) boundaryBlockers.push("direct_cut_requires_director_rationale");
    if (from.screenDirection && to.screenDirection && !screenDirectionCompatible(from.screenDirection, to.screenDirection) && !["dip_to_black", "cross_dissolve", "bridge_frame"].includes(decision.directorMethod)) {
      boundaryWarnings.push("screen_direction_reversal_requires_review");
    }

    blockers.push(...boundaryBlockers.map((code) => `${boundaryId}:${code}`));
    warnings.push(...boundaryWarnings.map((code) => `${boundaryId}:${code}`));
    boundaries.push({
      boundaryId,
      fromShotId: from.shotId,
      toShotId: to.shotId,
      directorMethod: decision.directorMethod,
      renderKind: decision.renderKind,
      durationSeconds,
      durationFrames,
      easing: decision.easing,
      rationale: decision.rationale,
      cutTrigger: decision.cutTrigger,
      continuityAnchors,
      screenDirection: { from: from.screenDirection, to: to.screenDirection, compatible: screenDirectionCompatible(from.screenDirection, to.screenDirection) },
      eyeTrace: { from: from.eyeTraceRegion, to: to.eyeTraceRegion, compatible: eyeTraceCompatible(from.eyeTraceRegion, to.eyeTraceRegion) },
      actionOverlapSeconds: decision.directorMethod === "match_action" ? boundedNumber(decision.actionOverlapSeconds ?? 0.18, 0.05, 0.8, `${boundaryId}.actionOverlapSeconds`) : 0,
      promptHandoff: buildPromptHandoff(decision.directorMethod, from, to),
      audioBridge: normalizeAudioBridge(decision.audioBridge, from, to),
      boundaryFrames: boundaryFramesFor(decision.directorMethod, from, to),
      rendererRecipe: rendererRecipe(decision, renderer),
      fallback: fallbackFor(decision.directorMethod, renderer),
      reviewCriteria: reviewCriteriaFor(decision.directorMethod),
      blockers: boundaryBlockers,
      warnings: boundaryWarnings
    });
  }

  return {
    schemaVersion: "1.0",
    planId: input.planId,
    sequenceId: input.sequenceId,
    renderer,
    fps,
    status: blockers.length ? "blocked" : "ready",
    preferences,
    shotOrder: shots.map((shot) => shot.shotId),
    boundaries,
    metrics: {
      boundaryCount: boundaries.length,
      invisibleCutCount: boundaries.filter((boundary) => ["cut", "match_cut"].includes(boundary.renderKind)).length,
      motionTransitionCount: boundaries.filter((boundary) => !["cut", "match_cut"].includes(boundary.renderKind)).length,
      audioBridgeCount: boundaries.filter((boundary) => boundary.audioBridge.kind !== "none").length
    },
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    compiledAt: new Date().toISOString()
  };
}

export async function writeTransitionLanguagePlan({ projectPath, runId, plan }) {
  const directory = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(directory, { recursive: true });
  const planArtifactRef = "transition_language_plan.json";
  const planPath = join(directory, planArtifactRef);
  const summaryArtifactRef = "transition_language_plan.md";
  const summaryPath = join(directory, summaryArtifactRef);
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(summaryPath, transitionPlanMarkdown(plan), { encoding: "utf8", mode: 0o600 });
  return {
    plan: { artifactRef: planArtifactRef, path: planPath },
    summary: { artifactRef: summaryArtifactRef, path: summaryPath }
  };
}

function transitionPlanMarkdown(plan) {
  const rows = plan.boundaries.map((boundary) => [
    boundary.fromShotId,
    boundary.toShotId,
    boundary.directorMethod,
    boundary.cutTrigger,
    boundary.audioBridge.kind,
    boundary.rationale
  ].map(tableCell).join(" | "));
  return [
    "# 导演转场与镜头衔接",
    "",
    `- 序列：${plan.sequenceId}`,
    `- 渲染路线：${plan.renderer}`,
    `- 状态：${plan.status}`,
    "",
    "| 前镜 | 后镜 | 导演方法 | 切点 | 声音桥 | 理由 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
    "",
    "## 边界审查",
    "",
    ...plan.boundaries.flatMap((boundary) => [
      `### ${boundary.fromShotId} → ${boundary.toShotId}`,
      "",
      `- 画面执行：${boundary.renderKind}，${boundary.durationFrames} 帧`,
      `- 连续性锚点：${boundary.continuityAnchors.join("、") || "无固定锚点"}`,
      `- 回退：${boundary.fallback.directorMethod} / ${boundary.fallback.renderKind}`,
      ...boundary.reviewCriteria.map((criterion) => `- 审查：${criterion}`),
      ""
    ])
  ].join("\n");
}

function normalizeShot(shot, index) {
  const shotId = String(shot?.shotId ?? "").trim();
  if (!shotId) throw new Error(`shots[${index}].shotId is required.`);
  return {
    ...structuredClone(shot),
    shotId,
    purpose: String(shot.purpose ?? "").trim(),
    shotSize: String(shot.shotSize ?? "medium").trim(),
    durationSeconds: positiveNumber(shot.durationSeconds, `shots[${index}].durationSeconds`),
    sceneId: String(shot.sceneId ?? "").trim(),
    locationKey: String(shot.locationKey ?? "").trim(),
    timeKey: String(shot.timeKey ?? "").trim(),
    screenDirection: optionalEnum(shot.screenDirection, ["left_to_right", "right_to_left", "toward_camera", "away_camera", "neutral"], `shots[${index}].screenDirection`),
    eyeTraceRegion: optionalEnum(shot.eyeTraceRegion, ["upper_left", "upper_center", "upper_right", "center_left", "center", "center_right", "lower_left", "lower_center", "lower_right"], `shots[${index}].eyeTraceRegion`),
    motionVector: optionalEnum(shot.motionVector, ["left", "right", "up", "down", "in", "out", "static"], `shots[${index}].motionVector`),
    actionKey: String(shot.actionKey ?? "").trim(),
    actionPhaseIn: optionalEnum(shot.actionPhaseIn, ["idle", "begin", "middle", "complete"], `shots[${index}].actionPhaseIn`),
    actionPhaseOut: optionalEnum(shot.actionPhaseOut, ["idle", "begin", "middle", "complete"], `shots[${index}].actionPhaseOut`),
    emotionIn: String(shot.emotionIn ?? "").trim(),
    emotionOut: String(shot.emotionOut ?? "").trim(),
    energyIn: boundedNumber(shot.energyIn ?? 0.5, 0, 1, `shots[${index}].energyIn`),
    energyOut: boundedNumber(shot.energyOut ?? 0.5, 0, 1, `shots[${index}].energyOut`),
    subjectIds: Array.isArray(shot.subjectIds) ? [...new Set(shot.subjectIds.map(String).filter(Boolean))] : [],
    graphicMatchKey: String(shot.graphicMatchKey ?? "").trim(),
    audio: {
      dialogueAtStart: Boolean(shot.audio?.dialogueAtStart),
      dialogueAtEnd: Boolean(shot.audio?.dialogueAtEnd),
      ambienceKey: String(shot.audio?.ambienceKey ?? "").trim()
    }
  };
}

function normalizeOverrides(items, shotIds) {
  if (!Array.isArray(items)) throw new Error("overrides must be an array.");
  const result = new Map();
  for (const [index, item] of items.entries()) {
    const fromShotId = String(item.fromShotId ?? "").trim();
    const toShotId = String(item.toShotId ?? "").trim();
    const directorMethod = String(item.directorMethod ?? "").trim();
    if (!shotIds.has(fromShotId) || !shotIds.has(toShotId)) throw new Error(`overrides[${index}] references an unknown shot.`);
    if (!METHODS.has(directorMethod)) throw new Error(`overrides[${index}] has unsupported directorMethod: ${directorMethod}`);
    const key = `${fromShotId}->${toShotId}`;
    if (result.has(key)) throw new Error(`Duplicate transition override: ${key}`);
    result.set(key, { ...structuredClone(item), fromShotId, toShotId, directorMethod });
  }
  return result;
}

function decisionFromOverride(override, from, to, renderer, preferences) {
  const decision = {
    directorMethod: override.directorMethod,
    renderKind: renderKindFor(override.directorMethod),
    durationSeconds: override.durationSeconds,
    rationale: String(override.rationale ?? "").trim(),
    cutTrigger: String(override.cutTrigger ?? "").trim(),
    actionOverlapSeconds: override.actionOverlapSeconds,
    easing: normalizeEasing(override.easing, override.directorMethod),
    audioBridge: override.audioBridge
  };
  if (!decision.rationale) decision.rationale = inferredRationale(decision.directorMethod, from, to);
  if (!decision.cutTrigger) decision.cutTrigger = defaultCutTrigger(decision.directorMethod);
  if (decision.directorMethod === "shader" && (!preferences.allowShader || !["remotion", "hyperframes"].includes(renderer))) decision.renderKind = "shader";
  return decision;
}

function inferDecision(from, to, renderer, preferences) {
  let directorMethod;
  if (chapterChanged(from, to)) directorMethod = from.timeKey && to.timeKey && from.timeKey !== to.timeKey ? "dip_to_black" : "cross_dissolve";
  else if (from.actionKey && from.actionKey === to.actionKey && from.actionPhaseOut === "middle" && ["middle", "complete"].includes(to.actionPhaseIn) && compatibleMotion(from, to)) directorMethod = "match_action";
  else if (from.emotionOut && to.emotionIn && from.emotionOut !== to.emotionIn && ["close_up", "extreme_close_up", "close"].includes(to.shotSize)) directorMethod = "cut_on_emotion";
  else if (from.graphicMatchKey && from.graphicMatchKey === to.graphicMatchKey) directorMethod = "graphic_match";
  else if (Math.max(from.energyOut, to.energyIn) >= 0.8 && compatibleMotion(from, to) && from.motionVector !== "static") directorMethod = "whip_pan";
  else if (sharesSubject(from, to) && eyeTraceCompatible(from.eyeTraceRegion, to.eyeTraceRegion) && from.shotSize !== to.shotSize) directorMethod = "match_eyeline";
  else directorMethod = preferences.preferInvisibleCuts ? "cut" : "cross_dissolve";
  if (directorMethod === "whip_pan" && renderer === "directorx-cut-ffmpeg") directorMethod = "whip_pan";
  return {
    directorMethod,
    renderKind: renderKindFor(directorMethod),
    rationale: inferredRationale(directorMethod, from, to),
    cutTrigger: defaultCutTrigger(directorMethod),
    easing: normalizeEasing(null, directorMethod),
    audioBridge: inferAudioBridge(from, to)
  };
}

function renderKindFor(method) {
  return {
    cut: "cut",
    cut_on_emotion: "cut",
    match_action: "match_cut",
    match_eyeline: "cut",
    graphic_match: "match_cut",
    whip_pan: "whip_pan",
    cross_dissolve: "crossfade",
    dip_to_black: "dip_to_black",
    bridge_frame: "crossfade",
    shader: "shader"
  }[method];
}

function transitionDuration(method, requested, maximum) {
  if (["cut", "cut_on_emotion", "match_eyeline", "match_action", "graphic_match"].includes(method)) return 0;
  const defaults = { whip_pan: 0.28, cross_dissolve: 0.6, dip_to_black: 0.55, bridge_frame: 0.45, shader: 0.5 };
  return round(Math.min(maximum, boundedNumber(requested ?? defaults[method] ?? 0.5, 0.05, 2, `${method}.durationSeconds`)));
}

function inferredRationale(method, from, to) {
  return {
    cut: `保持${from.purpose || from.shotId}到${to.purpose || to.shotId}的信息推进，不添加无意义装饰`,
    cut_on_emotion: `在${from.emotionOut || "情绪变化"}完成的瞬间切入${to.shotSize}，让反应成为剪辑动机`,
    match_action: `在动作中点切换机位，让${from.actionKey}在下一镜继续而不是重新开始`,
    match_eyeline: "保持主体视线落点与屏幕方向，利用景别变化形成不可见切口",
    graphic_match: `用共同图形锚点${from.graphicMatchKey}连接两个镜头`,
    whip_pan: "延续同向高速运动，以运动模糊遮蔽空间切换",
    cross_dissolve: "用短叠化表达同一语义或空间的柔性迁移",
    dip_to_black: "用短暂黑场明确时间、章节或叙事层级变化",
    bridge_frame: "插入中性过桥画面，修复空间或连续性无法直接对接的问题",
    shader: "使用受控图形着色转场表达世界观变化"
  }[method] ?? `${from.shotId}到${to.shotId}的导演化边界`;
}

function defaultCutTrigger(method) {
  return {
    cut: "information_complete",
    cut_on_emotion: "emotion_peak_or_reaction",
    match_action: "action_midpoint",
    match_eyeline: "eye_trace_lock",
    graphic_match: "shape_alignment",
    whip_pan: "maximum_motion_blur",
    cross_dissolve: "semantic_overlap",
    dip_to_black: "chapter_boundary",
    bridge_frame: "neutral_visual_anchor",
    shader: "graphic_state_change"
  }[method];
}

function inferAudioBridge(from, to) {
  if (to.audio.dialogueAtStart) return { kind: "j_cut", leadSeconds: 0.28 };
  if (from.audio.dialogueAtEnd) return { kind: "l_cut", tailSeconds: 0.35 };
  if (from.audio.ambienceKey && from.audio.ambienceKey === to.audio.ambienceKey) return { kind: "room_tone", overlapSeconds: 0.4 };
  return { kind: "none" };
}

function normalizeAudioBridge(value, from, to) {
  const source = value ?? inferAudioBridge(from, to);
  const kind = String(source.kind ?? "none");
  if (!AUDIO_BRIDGES.has(kind)) throw new Error(`Unsupported audio bridge: ${kind}`);
  return {
    kind,
    leadSeconds: kind === "j_cut" ? boundedNumber(source.leadSeconds ?? 0.28, 0.05, 1.5, "audioBridge.leadSeconds") : 0,
    tailSeconds: kind === "l_cut" ? boundedNumber(source.tailSeconds ?? 0.35, 0.05, 1.5, "audioBridge.tailSeconds") : 0,
    overlapSeconds: kind === "room_tone" ? boundedNumber(source.overlapSeconds ?? 0.4, 0.05, 2, "audioBridge.overlapSeconds") : 0
  };
}

function continuityAnchorsFor(from, to) {
  return [...new Set([
    ...from.subjectIds.filter((id) => to.subjectIds.includes(id)).map((id) => `subject:${id}`),
    from.locationKey && from.locationKey === to.locationKey ? `location:${from.locationKey}` : "",
    from.graphicMatchKey && from.graphicMatchKey === to.graphicMatchKey ? `graphic:${from.graphicMatchKey}` : "",
    from.actionKey && from.actionKey === to.actionKey ? `action:${from.actionKey}` : ""
  ].filter(Boolean))];
}

function buildPromptHandoff(method, from, to) {
  if (method !== "match_action") return { outgoing: "", incoming: "" };
  return {
    outgoing: `动作进行到中点：${from.actionKey}，保持${from.motionVector || "既定"}方向，动作尚未完成`,
    incoming: `继续${to.actionKey}，从中间状态接起并完成动作，不要重新开始`
  };
}

function boundaryFramesFor(method, from, to) {
  return {
    outgoingRequired: ["match_action", "graphic_match", "whip_pan", "bridge_frame"].includes(method),
    incomingRequired: ["match_action", "graphic_match", "whip_pan", "bridge_frame"].includes(method),
    extractionLabels: [`${from.shotId}:last_frame`, `${to.shotId}:first_frame`],
    bridgeFrameRequired: method === "bridge_frame"
  };
}

function rendererRecipe(decision, renderer) {
  if (renderer === "directorx-cut-ffmpeg") {
    const xfade = {
      crossfade: "fade",
      dip_to_black: "fadeblack",
      fade_through_color: "fadewhite",
      slide: "slideleft",
      wipe: "wipeleft",
      zoom_blur: "hblur",
      whip_pan: "slideleft"
    }[decision.renderKind];
    return decision.renderKind === "match_cut" || decision.renderKind === "cut"
      ? { engine: "ffmpeg", operation: "concat", transition: null, timing: { easing: decision.easing } }
      : { engine: "ffmpeg", operation: "xfade", transition: xfade ?? null, timing: { easing: decision.easing } };
  }
  return { engine: renderer, operation: decision.renderKind, transition: decision.renderKind, timing: { easing: decision.easing } };
}

function normalizeEasing(value, method) {
  const easing = String(value ?? defaultEasing(method));
  if (!TRANSITION_EASINGS.has(easing)) throw new Error(`Unsupported transition easing: ${easing}`);
  if (["cut", "cut_on_emotion", "match_action", "match_eyeline", "graphic_match"].includes(method)) return "linear";
  return easing;
}

function defaultEasing(method) {
  if (method === "cross_dissolve") return "linear";
  if (method === "whip_pan") return "ease_in_out";
  if (method === "dip_to_black") return "ease_in_out";
  if (method === "shader") return "ease_in_out";
  return "ease_in_out";
}

function fallbackFor(method, renderer) {
  if (method === "shader" && renderer === "directorx-cut-ffmpeg") return { directorMethod: "bridge_frame", renderKind: "crossfade" };
  if (method === "whip_pan") return { directorMethod: "match_action", renderKind: "match_cut" };
  if (["match_action", "graphic_match"].includes(method)) return { directorMethod: "cross_dissolve", renderKind: "crossfade" };
  return { directorMethod: "cut", renderKind: "cut" };
}

function reviewCriteriaFor(method) {
  const common = ["切点必须服务叙事动机", "前后镜头主体身份与空间方向不得无故漂移"];
  const specific = {
    match_action: ["逐帧检查动作中点连续，后一镜必须继续动作而非重启"],
    match_eyeline: ["检查视线落点和屏幕方向，避免跳轴"],
    graphic_match: ["检查轮廓、位置、尺度和亮度锚点对齐"],
    whip_pan: ["检查运动方向一致，模糊峰值覆盖边界且无闪帧"],
    cross_dissolve: ["检查叠化期间无双重主体冲突或曝光泵动"],
    dip_to_black: ["黑场长度足以表达章节变化但不破坏节奏"],
    bridge_frame: ["过桥帧必须提供真实空间或语义锚点"],
    shader: ["检查着色转场无撕裂、闪帧、色域越界"]
  }[method] ?? ["检查切点前后动作、情绪与信息密度"];
  return [...common, ...specific];
}

function chapterChanged(from, to) {
  return Boolean(
    (from.sceneId && to.sceneId && from.sceneId !== to.sceneId) ||
    (from.locationKey && to.locationKey && from.locationKey !== to.locationKey) ||
    (from.timeKey && to.timeKey && from.timeKey !== to.timeKey)
  );
}

function sharesSubject(from, to) {
  return from.subjectIds.some((id) => to.subjectIds.includes(id));
}

function compatibleMotion(from, to) {
  if (!from.motionVector || !to.motionVector) return true;
  if (from.motionVector === "static" || to.motionVector === "static") return false;
  return from.motionVector === to.motionVector;
}

function screenDirectionCompatible(from, to) {
  if (!from || !to || from === "neutral" || to === "neutral") return true;
  return from === to;
}

function eyeTraceCompatible(from, to) {
  if (!from || !to) return true;
  const column = (value) => value.split("_").at(-1);
  const fromColumn = column(from);
  const toColumn = column(to);
  if (fromColumn === "center" || toColumn === "center") return true;
  return fromColumn === toColumn;
}

function optionalEnum(value, allowed, field) {
  if (value === undefined || value === null || value === "") return "";
  if (!allowed.includes(value)) throw new Error(`${field} must be one of: ${allowed.join(", ")}.`);
  return value;
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive.`);
  return number;
}

function boundedNumber(value, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  return number;
}

function integerBetween(value, minimum, maximum, field) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function tableCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}
