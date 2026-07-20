import test from "node:test";
import assert from "node:assert/strict";
import { validateSkillMetadataCatalog } from "../scripts/skill-metadata-catalog.mjs";

const metadata = (skillName, { displayName = skillName, implicit = false } = {}) => ({
  path: `skills/${skillName}/agents/openai.yaml`,
  content: `interface:\n  display_name: "${displayName}"\n  short_description: "Focused Director X capability"\n  default_prompt: "Run this bounded Director X capability."\npolicy:\n  allow_implicit_invocation: ${implicit}`
});

test("accepts a complete catalog with one implicit entry skill", () => {
  assert.deepEqual(validateSkillMetadataCatalog({
    skillNames: ["directorx", "directorx-review"],
    metadataFiles: [metadata("directorx", { displayName: "Director X", implicit: true }), metadata("directorx-review", { displayName: "Director X Review" })]
  }), []);
});

test("rejects missing metadata, duplicate names, and unsafe specialist invocation", () => {
  assert.deepEqual(validateSkillMetadataCatalog({
    skillNames: ["directorx", "directorx-review", "directorx-render"],
    metadataFiles: [
      metadata("directorx", { displayName: "Director X", implicit: false }),
      metadata("directorx-review", { displayName: "Director X", implicit: true }),
      metadata("orphan", { displayName: "Orphan" })
    ]
  }), [
    "skills/directorx/agents/openai.yaml must allow implicit invocation for the Director X entry skill",
    "skills/directorx-review/agents/openai.yaml must disable implicit invocation for specialist skills",
    "skills/directorx-review/agents/openai.yaml duplicates display_name from skills/directorx/agents/openai.yaml: Director X",
    "skills/directorx-render/agents/openai.yaml is required for every bundled skill",
    "skills/orphan/agents/openai.yaml has no matching SKILL.md"
  ]);
});
