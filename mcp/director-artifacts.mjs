import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

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
    "> Director X project-level creative source of truth. Derived from the Director1.md main loop, asset-first consistency, director-language prompt compilation, eval-select, and Grounding principles.",
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
    "## Web Research And Reference Plan", "", text(director.researchPlan),
    "",
    "## Negative Rules", "", bullets(director.negativeRules),
    "",
    "## Review Bar", "", bullets(director.reviewCriteria),
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
