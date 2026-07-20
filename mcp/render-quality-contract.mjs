import { compileTransitionExecutionContract } from "./transition-execution-contract.mjs";

const SUPPORTED_RENDERERS = new Set(["remotion", "hyperframes", "directorx-cut-ffmpeg"]);
const NATURAL_TRANSITIONS = new Set(["crossfade", "dip_to_black", "fade_through_color", "slide", "wipe", "zoom_blur", "match_cut", "whip_pan", "shader"]);

export function compileRenderQualityContract(input) {
  const durationSeconds = positiveNumber(input.durationSeconds, "durationSeconds");
  const intentionalOutroSeconds = boundedNumber(input.intentionalOutroSeconds ?? 0, 0, Math.min(10, durationSeconds), "intentionalOutroSeconds");
  const renderer = String(input.renderer ?? "").trim();
  const narration = normalizeNarration(input.narration, durationSeconds);
  const captions = normalizeTimedItems(input.captions ?? [], "captions", durationSeconds);
  const visualClips = normalizeTimedItems(input.visualClips ?? [], "visualClips", durationSeconds);
  const transitions = normalizeTransitions(input.transitions ?? []);
  const blockers = [];
  const warnings = [];

  if (!SUPPORTED_RENDERERS.has(renderer)) blockers.push(`unsupported_renderer:${renderer || "missing"}`);
  const expectedSpeechEnd = durationSeconds - intentionalOutroSeconds;
  const narrationTailGap = round(expectedSpeechEnd - narration.endSeconds);
  if (narration.endSeconds > durationSeconds + 0.05) blockers.push("narration_exceeds_video_duration");
  if (narrationTailGap > 2.5) blockers.push(`narration_tail_gap:${narrationTailGap}>2.5`);
  else if (narrationTailGap > 1.25) warnings.push(`narration_tail_gap:${narrationTailGap}`);

  const pace = readingPace(narration);
  if (pace.metric === "characters_per_second" && pace.value > 6) blockers.push(`narration_speed:${pace.value}_cps>6`);
  if (pace.metric === "words_per_minute" && pace.value > 200) blockers.push(`narration_speed:${pace.value}_wpm>200`);
  if (pace.value > 0 && ((pace.metric === "characters_per_second" && pace.value < 2) || (pace.metric === "words_per_minute" && pace.value < 90))) warnings.push(`narration_pace_slow:${pace.value}_${pace.metric}`);

  const captionCoverage = evaluateCaptionCoverage(captions, narration);
  blockers.push(...captionCoverage.blockers);
  warnings.push(...captionCoverage.warnings);

  const transitionCoverage = evaluateTransitionCoverage(visualClips, transitions, renderer);
  blockers.push(...transitionCoverage.blockers);
  warnings.push(...transitionCoverage.warnings);
  const transitionPlanBinding = evaluateTransitionPlanBinding(
    visualClips,
    transitions,
    input.transitionLanguagePlan,
    input.requireDirectorPlan === true,
    renderer
  );
  blockers.push(...transitionPlanBinding.blockers);
  warnings.push(...transitionPlanBinding.warnings);
  const transitionExecution = compileTransitionExecutionContract({
    renderer,
    durationSeconds,
    visualClips,
    transitions,
    transitionLanguagePlan: input.transitionLanguagePlan,
    required: input.requireDirectorPlan === true
  });
  blockers.push(...transitionExecution.blockers);
  warnings.push(...transitionExecution.warnings);

  return {
    schemaVersion: "1.0",
    status: blockers.length ? "blocked" : "ready",
    renderer,
    durationSeconds,
    intentionalOutroSeconds,
    narration,
    captions,
    visualClips,
    transitions,
    metrics: {
      narrationTailGapSeconds: narrationTailGap,
      readingPace: pace,
      captionCoverage,
      transitionCoverage,
      transitionPlanBinding,
      transitionExecution
    },
    transitionExecution,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    checkedAt: new Date().toISOString()
  };
}

export function assertRenderQualityReady(run, renderer) {
  const contract = run.renderQualityContract;
  if (!contract) throw new Error("Register render_quality_contract.json before rendering.");
  if (contract.status !== "ready") throw new Error(`Render quality contract is blocked: ${(contract.blockers ?? []).join(", ")}`);
  if (contract.renderer !== renderer) throw new Error(`Render quality contract targets ${contract.renderer}, not ${renderer}.`);
  return contract;
}

function normalizeNarration(value, durationSeconds) {
  if (!value || typeof value !== "object") throw new Error("narration is required.");
  const startSeconds = boundedNumber(value.startSeconds ?? 0, 0, durationSeconds, "narration.startSeconds");
  const endSeconds = boundedNumber(value.endSeconds, startSeconds, durationSeconds + 1, "narration.endSeconds");
  const text = String(value.text ?? "").trim();
  if (!text) throw new Error("narration.text is required.");
  const language = ["zh", "en", "mixed"].includes(value.language) ? value.language : "mixed";
  return { startSeconds, endSeconds, text, language };
}

function normalizeTimedItems(items, field, durationSeconds) {
  if (!Array.isArray(items)) throw new Error(`${field} must be an array.`);
  return items.map((item, index) => {
    const startSeconds = boundedNumber(item.startSeconds, 0, durationSeconds, `${field}[${index}].startSeconds`);
    const endSeconds = boundedNumber(item.endSeconds, startSeconds, durationSeconds + 0.25, `${field}[${index}].endSeconds`);
    if (endSeconds <= startSeconds) throw new Error(`${field}[${index}] must have positive duration.`);
    return { ...item, startSeconds, endSeconds };
  }).sort((left, right) => left.startSeconds - right.startSeconds);
}

function normalizeTransitions(items) {
  if (!Array.isArray(items)) throw new Error("transitions must be an array.");
  return items.map((item, index) => {
    const kind = String(item.kind ?? "").trim();
    if (!kind) throw new Error(`transitions[${index}].kind is required.`);
    const durationSeconds = boundedNumber(item.durationSeconds ?? 0, 0, 2, `transitions[${index}].durationSeconds`);
    return { ...item, kind, durationSeconds };
  });
}

function readingPace(narration) {
  const duration = Math.max(0.1, narration.endSeconds - narration.startSeconds);
  if (narration.language === "en") {
    const words = narration.text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
    return { metric: "words_per_minute", value: round((words / duration) * 60), units: words };
  }
  const characters = narration.text.replace(/[\s\p{P}\p{S}]/gu, "").length;
  return { metric: "characters_per_second", value: round(characters / duration), units: characters };
}

function evaluateCaptionCoverage(captions, narration) {
  const blockers = [];
  const warnings = [];
  if (!captions.length) return { passed: false, coverageRatio: 0, blockers: ["captions_missing"], warnings };
  const first = captions[0];
  const last = captions.at(-1);
  if (first.startSeconds - narration.startSeconds > 0.5) blockers.push("caption_lead_gap>0.5");
  if (narration.endSeconds - last.endSeconds > 0.75) blockers.push("caption_tail_gap>0.75");
  let covered = 0;
  let cursor = narration.startSeconds;
  for (const caption of captions) {
    if (caption.startSeconds - cursor > 1) blockers.push(`caption_gap:${round(cursor)}-${round(caption.startSeconds)}`);
    covered += Math.max(0, Math.min(narration.endSeconds, caption.endSeconds) - Math.max(narration.startSeconds, caption.startSeconds));
    cursor = Math.max(cursor, caption.endSeconds);
  }
  const narrationDuration = Math.max(0.1, narration.endSeconds - narration.startSeconds);
  const coverageRatio = round(Math.min(1, covered / narrationDuration));
  if (coverageRatio < 0.92) blockers.push(`caption_coverage:${coverageRatio}<0.92`);
  else if (coverageRatio < 0.98) warnings.push(`caption_coverage:${coverageRatio}`);
  return { passed: blockers.length === 0, coverageRatio, blockers, warnings };
}

function evaluateTransitionCoverage(clips, transitions, renderer) {
  const blockers = [];
  const warnings = [];
  const boundaries = Math.max(0, clips.length - 1);
  const imageLed = clips.filter((clip) => ["image", "still"].includes(clip.kind)).length >= Math.max(2, Math.ceil(clips.length / 2));
  if (imageLed && !["remotion", "hyperframes"].includes(renderer)) blockers.push("image_led_video_requires_motion_renderer");
  if (!boundaries) return { passed: blockers.length === 0, boundaries, coveredBoundaries: 0, directCutRatio: 0, blockers, warnings };
  const byBoundary = new Map(transitions.map((transition) => [`${transition.fromClipId}->${transition.toClipId}`, transition]));
  let directCuts = 0;
  let coveredBoundaries = 0;
  for (let index = 0; index < clips.length - 1; index += 1) {
    const from = clips[index];
    const to = clips[index + 1];
    const transition = byBoundary.get(`${from.clipId}->${to.clipId}`);
    if (!transition) {
      blockers.push(`transition_missing:${from.clipId}->${to.clipId}`);
      continue;
    }
    coveredBoundaries += 1;
    if (transition.kind === "cut") {
      directCuts += 1;
      if (!String(transition.rationale ?? "").trim()) blockers.push(`direct_cut_without_rationale:${from.clipId}->${to.clipId}`);
    } else if (transition.kind === "match_cut") {
      if (!String(transition.rationale ?? "").trim()) blockers.push(`match_cut_without_rationale:${from.clipId}->${to.clipId}`);
    } else {
      if (!NATURAL_TRANSITIONS.has(transition.kind)) blockers.push(`unsupported_transition:${transition.kind}`);
      if (transition.durationSeconds < 0.2 || transition.durationSeconds > 1.2) blockers.push(`transition_duration:${transition.kind}:${transition.durationSeconds}`);
      if (transition.kind === "shader" && !["remotion", "hyperframes"].includes(renderer)) blockers.push("shader_transition_requires_motion_renderer");
    }
  }
  const directCutRatio = round(directCuts / boundaries);
  if (imageLed && directCutRatio > 0.35) blockers.push(`image_led_direct_cut_ratio:${directCutRatio}>0.35`);
  else if (directCutRatio > 0.5) warnings.push(`direct_cut_ratio:${directCutRatio}`);
  return { passed: blockers.length === 0, boundaries, coveredBoundaries, directCutRatio, blockers, warnings };
}

function evaluateTransitionPlanBinding(clips, transitions, plan, required, renderer) {
  const blockers = [];
  const warnings = [];
  const expectedBoundaries = Math.max(0, clips.length - 1);
  if (!expectedBoundaries) return { passed: true, required, expectedBoundaries, boundBoundaries: 0, blockers, warnings };
  if (!plan) {
    if (required) blockers.push("transition_language_plan_missing");
    else warnings.push("transition_language_plan_not_bound");
    return { passed: blockers.length === 0, required, expectedBoundaries, boundBoundaries: 0, blockers, warnings };
  }
  if (plan.status !== "ready") blockers.push(`transition_language_plan_${plan.status ?? "invalid"}`);
  if (plan.renderer && plan.renderer !== renderer) blockers.push(`transition_language_plan_renderer_mismatch:${plan.renderer}!=${renderer}`);
  const planned = new Map((plan.boundaries ?? []).map((boundary) => [boundary.boundaryId ?? `${boundary.fromShotId}->${boundary.toShotId}`, boundary]));
  const actual = new Map(transitions.map((transition) => [`${transition.fromClipId}->${transition.toClipId}`, transition]));
  let boundBoundaries = 0;
  for (let index = 0; index < clips.length - 1; index += 1) {
    const key = `${clips[index].clipId}->${clips[index + 1].clipId}`;
    const rendered = actual.get(key);
    const expected = planned.get(rendered?.transitionBoundaryId ?? key);
    if (!expected) {
      blockers.push(`director_transition_missing:${key}`);
      continue;
    }
    if (!rendered) continue;
    boundBoundaries += 1;
    if (expected.renderKind !== rendered.kind) blockers.push(`director_transition_kind_mismatch:${key}:${expected.renderKind}!=${rendered.kind}`);
    const tolerance = 1 / Math.max(1, Number(plan.fps) || 30) + 0.01;
    if (Math.abs(Number(expected.durationSeconds ?? 0) - Number(rendered.durationSeconds ?? 0)) > tolerance) {
      blockers.push(`director_transition_duration_mismatch:${key}`);
    }
    if (rendered.directorMethod && rendered.directorMethod !== expected.directorMethod) blockers.push(`director_transition_method_mismatch:${key}`);
    if (!rendered.directorMethod) warnings.push(`director_transition_method_not_recorded:${key}`);
  }
  return { passed: blockers.length === 0, required, planId: plan.planId ?? null, expectedBoundaries, boundBoundaries, blockers, warnings };
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

function round(value) {
  return Math.round(value * 1000) / 1000;
}
