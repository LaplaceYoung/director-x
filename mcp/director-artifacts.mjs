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

function directive(id, domain, instruction) { return { id, domain, instruction: text(instruction) }; }
function listDirectives(prefix, domain, values) { return (values ?? []).map((value, index) => directive(`${prefix}-${index + 1}`, domain, value)); }

function runArtifactDir(projectPath, runId) {
  if (!/^dx-[a-z0-9-]+$/i.test(runId)) throw new Error("Invalid Director X run ID.");
  return resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
}

function field(label, value) { return `- **${label}:** ${text(value)}`; }
function text(value) { return String(value ?? "Not specified").replace(/\r/g, "").trim(); }
function bullets(values) { return Array.isArray(values) && values.length ? values.map((value) => `- ${text(value)}`).join("\n") : "- Not specified"; }
