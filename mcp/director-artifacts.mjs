import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

export const DIRECTOR1_OPERATING_PRINCIPLES = Object.freeze([
  "C1 · Draw then control: establish space, subjects, camera, and anchors before spending attempts.",
  "C2 · Prompt as directing: write observable story change, action, camera, light, and performance; do not stack abstract adjectives.",
  "C3 · Asset-first consistency: lock character views, scene anchors, product/props, keyframes, voice, and reference roles before dependent shots.",
  "C4 · Subtract and retain: use restraint, motivated color, breathing room, and believable imperfections; persist effective rules as reusable skills.",
  "C5 · CLI/API first: prefer declared provider APIs and local media tools with receipts over GUI imitation; GUI is a bounded fallback.",
  "C6 · Control compensates for model limits: simplify prompts and strengthen references for weak models; reserve stronger routes for difficult shots."
]);

export const DIRECTOR1_MAIN_LOOP = Object.freeze([
  "Step0 · Intent and hook: resolve logline, objective, audience, and one hook (abnormal event, emotional conflict, information gap, healing emotion, or visual spectacle); protect the first three seconds.",
  "Step1 · Beats and shots: expand the script into purposeful beats and shots with scale, subject position, action, emotion, and duration; keep generated segments within provider limits.",
  "Step1.5 · Grounding: search named entities, logos, product use, specific actions, foreign text, factual claims, requested styles, and platform patterns; convert evidence into bounded references or deterministic layers.",
  "Step2 · Assets and continuity: acquire or generate character views, scene anchors, product/prop references, keyframes, audio anchors, and the asset reference table before dependent shots.",
  "Step3 · Single-shot direction: decide scale, angle, movement, composition, lighting, blocking, performance, audio role, and success criteria.",
  "Step4 · Prompt compilation: state who is where, what changes, how the camera moves, and how light/performance evolves; references carry stable appearance and layout.",
  "Step5 · Capability routing: route by capability, reference control, difficulty, cost, and fallback; use evidence-backed provider/model choices within budget.",
  "Step6 · Bounded generation and eval-select: inspect candidates, score against the shot contract, and repair the smallest upstream cause.",
  "Step7 · Assembly and continuation: use action overlap, screen-direction continuity, first/last-frame handoff, motivated cuts, J/L bridges, and executable transitions.",
  "Step8 · Audio: assign voice, music, ambience, SFX, captions, ducking, and loudness targets.",
  "Step9 · QC and learning: score story, visual integrity, continuity, rights, facts, A/V, budget, and delivery; route failures back to the owning step and retain effective repairs."
]);

export const DIRECTOR1_SHOT_PLAN_CONTRACT = Object.freeze([
  "Primary deliverable: project manifest plus one structured shot object per shot (shots.jsonl).",
  "Every shot carries purpose, duration, subject, scene, scale, camera, composition, lighting, color, action, performance, audio, capability requirements, asset references, continuity constraints, success criteria, and a repair surface.",
  "Every asset reference declares one control role (identity, product geometry, layout, pose, style, palette, lighting, first frame, or last frame).",
  "Every downstream artifact inherits the active Director fingerprint and directive IDs."
]);

export async function writeIntentResolution({ projectPath, runId, resolution }) {
  const dir = runArtifactDir(projectPath, runId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "intent_resolution.json");
  const artifact = { schemaVersion: "1.0", runId, recordedAt: new Date().toISOString(), ...resolution };
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return { path, artifactRef: "intent_resolution.json", clarity: artifact.clarity };
}

export async function writeIntakeConfirmation({ projectPath, runId, intake }) {
  const dir = runArtifactDir(projectPath, runId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "intake_confirmation.json");
  const artifact = { schemaVersion: "1.0", runId, confirmedAt: new Date().toISOString(), ...intake };
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return { path, artifactRef: "intake_confirmation.json" };
}

export async function writeProjectBrief({ projectPath, runId, brief }) {
  const dir = runArtifactDir(projectPath, runId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "project_brief.json");
  const artifact = compileProjectBrief(runId, brief);
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return { path, artifactRef: "project_brief.json", artifact };
}

export async function writeDeliveryPromise({ projectPath, runId, brief, delivery }) {
  const dir = runArtifactDir(projectPath, runId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "delivery_promise.json");
  const artifact = compileDeliveryPromise(runId, brief, delivery);
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return { path, artifactRef: "delivery_promise.json", artifact };
}

export async function writeDirectorDocument({ projectPath, runId, director }) {
  const dir = runArtifactDir(projectPath, runId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "Director.md");
  const contract = compileDirectorContract(runId, director);
  const contractPath = join(dir, "director_contract.json");
  const lines = [
    "# Director.md",
    "",
    "> Director X project-level creative operating system. It is the executable Director Agent contract derived from Director1.md: intent becomes a controllable shot pipeline, not a decorative prompt or planning report.",
    "",
    "## Director Agent Role",
    "",
    "Act as director, producer, and storyboard lead. Translate audience response and business intent into beats, shots, assets, prompts, model requirements, candidate evaluation, continuity, audio, editing, and QC. The project Director.md is the source of truth for creative intent and production rules; downstream artifacts must cite its contract fingerprint.",
    "",
    "## Input Contract",
    "",
    "Required: logline and script or beats. Recommended: style, aspect ratio, duration, platform, available models, assets, constraints, and references. Missing optional values must be explicit safe inferences. Long scripts are split by episode or chapter; a single model request never carries the whole long-form script.",
    "",
    "## Output Contract",
    "",
    ...DIRECTOR1_SHOT_PLAN_CONTRACT,
    "",
    "## Operating Principles",
    "",
    ...DIRECTOR1_OPERATING_PRINCIPLES.flatMap((item) => [`- ${item}`]),
    "",
    "## Director Main Loop",
    "",
    ...DIRECTOR1_MAIN_LOOP.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Production Intent",
    "",
    field("Title", director.title), field("Logline", director.logline), field("Audience", director.audience), field("Platform", director.platform), field("Duration", director.duration), field("Aspect ratio", director.aspectRatio), field("Business / creative objective", director.objective),
    "",
    "## Director's Interpretation",
    "", text(director.directorInterpretation),
    "",
    "## Hook And Beat Progression",
    "", field("Opening hook", director.hook), text(director.beatProgression),
    "",
    "## Visual Grammar",
    "", field("Visual language", director.visualLanguage), field("Camera grammar", director.cameraGrammar), field("Composition", director.composition), field("Lighting and color", director.lightingColor), field("Performance direction", director.performanceDirection),
    "",
    "## Audio And Edit Grammar",
    "", field("Voice and sound", director.audioDirection), field("Music", director.musicDirection), field("Edit rhythm", director.editRhythm),
    "",
    "## Continuity Anchors", "", bullets(director.continuityAnchors),
    "",
    "## Style Constitution", "",
    field("Style thesis", director.styleThesis),
    field("World behavior", director.worldBehavior),
    field("Texture and material", director.textureMaterial),
    field("Typography and graphics", director.typographyGraphics),
    field("Temporal grammar", director.temporalGrammar),
    "",
    "## Shot Inheritance Contract", "",
    "Every script beat, shot, prompt, candidate review, edit decision, and delivery review MUST cite the Director contract fingerprint and list the directive IDs it inherits or intentionally overrides.",
    "",
    field("Contract fingerprint", contract.fingerprint),
    "",
    "## Director-Level Prompt Strategy", "", text(director.promptStrategy),
    "",
    "## Capability Routing",
    "",
    field("Image route", director.modelRoutes?.image),
    field("Video route", director.modelRoutes?.video),
    field("Voice route", director.modelRoutes?.tts),
    field("Batch / CLI route", director.modelRoutes?.cli),
    "Route by capability, reference control, shot difficulty, cost, and fallback. Provider choices require official capability or pricing evidence before paid generation.",
    "",
    "## Web Research And Reference Plan", "", text(director.researchPlan),
    "",
    "## Candidate Eval And Repair",
    "",
    "Generate bounded candidates, inspect first/middle/last states and relevant technical evidence, score against the shot contract, and change one causal variable per repair. A local defect must not trigger a full-project restart.",
    "",
    "## Negative Rules", "", bullets(director.negativeRules),
    "",
    "## QC Gate And Rollback", "", bullets(director.reviewCriteria),
    "",
    "A shot passes only when story purpose, action completion, identity/geometry, composition, continuity, technical playability, rights, and audio/caption requirements are evidenced. Asset or continuity failures return to Step2; prompt failures return to Step4; candidate failures return to Step6; provider failures return to Step5. Known defects cannot be carried forward merely to preserve schedule.",
    "",
    "## Approval Boundaries", "", bullets(director.approvalBoundaries),
    ""
  ];
  await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, { mode: 0o600 });
  return { path, artifactRef: "Director.md", contractPath, contractArtifactRef: "director_contract.json", fingerprint: contract.fingerprint, directiveIds: contract.directives.map((item) => item.id) };
}

export function compileDirectorContract(runId, director) {
  const directives = [
    directive("DIR-ROLE", "director", "Director.md is the operating system for a director, producer, and storyboard lead; it produces a controllable shot pipeline, not decorative prompt prose."),
    directive("DIR-INPUT", "contract", "Required input is a logline plus script or beats; missing optional values are explicit safe inferences and long scripts are split."),
    directive("DIR-OUTPUT", "contract", DIRECTOR1_SHOT_PLAN_CONTRACT.join(" ")),
    ...listDirectives("DIR-PRINCIPLE", "director", DIRECTOR1_OPERATING_PRINCIPLES),
    ...listDirectives("DIR-LOOP", "pipeline", DIRECTOR1_MAIN_LOOP),
    directive("DIR-HOOK", "story", director.hook),
    directive("DIR-BEATS", "story", director.beatProgression),
    directive("DIR-VISUAL", "style", director.visualLanguage),
    directive("DIR-CAMERA", "camera", director.cameraGrammar),
    directive("DIR-COMPOSITION", "camera", director.composition),
    directive("DIR-LIGHT-COLOR", "style", director.lightingColor),
    directive("DIR-PERFORMANCE", "performance", director.performanceDirection),
    directive("DIR-AUDIO", "audio", director.audioDirection),
    directive("DIR-MUSIC", "audio", director.musicDirection),
    directive("DIR-EDIT", "edit", director.editRhythm),
    directive("DIR-PROMPT", "generation", director.promptStrategy),
    directive("DIR-ROUTING", "generation", "Route by capability, reference control, difficulty, cost, and fallback with official capability and pricing evidence."),
    directive("DIR-EVAL", "review", "Generate bounded candidates, inspect evidence, score against the shot contract, and repair one causal variable at a time."),
    directive("DIR-QC", "review", "QC is closed by default; failures return to the owning step and known defects cannot be carried forward."),
    ...listDirectives("DIR-CONTINUITY", "continuity", director.continuityAnchors),
    ...listDirectives("DIR-NEGATIVE", "negative", director.negativeRules),
    ...listDirectives("DIR-REVIEW", "review", director.reviewCriteria)
  ].filter((item) => item.instruction !== "Not specified");
  const canonical = {
    schemaVersion: "1.0",
    runId,
    source: "Director.md",
    sourceMethod: "Director1.md main loop",
    intent: { title: text(director.title), logline: text(director.logline), objective: text(director.objective), audience: text(director.audience), platform: text(director.platform), duration: text(director.duration), aspectRatio: text(director.aspectRatio) },
    styleConstitution: {
      thesis: text(director.styleThesis), worldBehavior: text(director.worldBehavior), textureMaterial: text(director.textureMaterial),
      typographyGraphics: text(director.typographyGraphics), temporalGrammar: text(director.temporalGrammar)
    },
    directives,
    inheritance: {
      requiredBy: ["style_playbook.json", "script_or_outline.json", "shotlist.json", "generation_request.json", "selected_clips.json", "semantic_timeline.json", "final_review.json"],
      citationFields: ["director_contract_fingerprint", "inherited_directive_ids", "override_records"],
      overrideRule: "Any intentional deviation must name the directive, rationale, scope, reviewer, and approval state."
    }
  };
  return { ...canonical, fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}` };
}

export function compileProjectBrief(runId, brief) {
  const durationSeconds = Number(brief.durationSeconds);
  const amount = Number(brief.budgetCap?.amount);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Project brief durationSeconds must be positive.");
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Project brief budget amount cannot be negative.");
  if (!brief.runMode) throw new Error("Project brief requires a user-confirmed run mode.");
  return {
    schemaVersion: "1.0",
    project_brief_id: `PB-${runId}`,
    source_artifact_run_id: runId,
    video_type: text(brief.videoType),
    target_platform: text(brief.targetPlatform),
    budget_cap: { currency: text(brief.budgetCap.currency), amount },
    duration_seconds: durationSeconds,
    quality_target: text(brief.qualityTarget),
    run_mode: text(brief.runMode),
    created_at: new Date().toISOString()
  };
}

export function compileDeliveryPromise(runId, brief, delivery) {
  const minimumFinalScore = score(delivery.minimumFinalScore, "minimumFinalScore");
  const minimumShotScore = score(delivery.minimumShotScore, "minimumShotScore");
  const requiredArtifacts = nonEmptyList(delivery.requiredArtifacts, "requiredArtifacts");
  const requiredTracks = nonEmptyList(delivery.requiredTracks, "requiredTracks");
  const primaryProductionPath = text(delivery.primaryProductionPath);
  return {
    schemaVersion: "1.0",
    delivery_promise_id: `DP-${runId}`,
    source_artifact_run_id: runId,
    delivery_promise: {
      target_platform: brief.target_platform,
      duration_seconds: brief.duration_seconds,
      quality_target: brief.quality_target,
      promise: text(delivery.promise),
      primary_viewer_outcome: text(delivery.primaryViewerOutcome)
    },
    quality_floor: {
      minimum_final_score: minimumFinalScore,
      minimum_shot_score: minimumShotScore,
      required_artifacts: requiredArtifacts,
      required_tracks: requiredTracks
    },
    approved_production_paths: [
      { path: primaryProductionPath, scope: "primary", approval_state: "approved", evidence_ref: "intake_confirmation.json" },
      { path: "remotion_composite_repair", scope: "repair_and_packaging", approval_state: "approved", evidence_ref: "semantic_timeline.json" }
    ],
    forbidden_fallbacks: [
      { fallback: "static_slide_only", reason: "Motion and audio cannot fall below the approved quality floor.", approval_required_to_override: true },
      { fallback: "unlicensed_reference_reuse", reason: "Reference media cannot become delivery media without reuse rights.", approval_required_to_override: true }
    ],
    requires_user_approval_before: [
      { change: "duration_seconds", reason: "Duration changes pacing, cost, and platform fit.", gate: "delivery_promise_change" },
      { change: "target_platform", reason: "Platform changes framing, safe areas, rhythm, and packaging.", gate: "delivery_promise_change" },
      { change: "quality_floor", reason: "A quality downgrade changes the accepted delivery promise.", gate: "delivery_promise_change" },
      { change: "production_path", reason: "A provider or render path change can alter cost and reliability.", gate: "provider_reroute" }
    ],
    created_at: new Date().toISOString()
  };
}

function directive(id, domain, instruction) { return { id, domain, instruction: text(instruction) }; }
function listDirectives(prefix, domain, values) { return (values ?? []).map((value, index) => directive(`${prefix}-${index + 1}`, domain, value)); }

function runArtifactDir(projectPath, runId) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Director X run ID.");
  return resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
}

function field(label, value) { return `- **${label}:** ${text(value)}`; }
function text(value) { return String(value ?? "Not specified").replace(/\r/g, "").trim(); }
function bullets(values) { return Array.isArray(values) && values.length ? values.map((value) => `- ${text(value)}`).join("\n") : "- Not specified"; }
function score(value, field) { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${field} must be between 0 and 1.`); return number; }
function nonEmptyList(values, field) { if (!Array.isArray(values) || !values.length || values.some((value) => !String(value ?? "").trim())) throw new Error(`${field} must contain at least one non-empty value.`); return values.map(text); }
