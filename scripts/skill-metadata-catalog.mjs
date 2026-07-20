export function validateSkillMetadataCatalog({ skillNames, metadataFiles, entrySkill = "directorx" }) {
  const errors = [];
  const metadataBySkill = new Map();
  const displayNames = new Map();
  for (const metadataFile of metadataFiles ?? []) {
    const skillName = metadataSkillName(metadataFile.path);
    if (!skillName) {
      errors.push(`${metadataFile.path} is not a skill agents/openai.yaml path`);
      continue;
    }
    metadataBySkill.set(skillName, metadataFile);
    const displayName = yamlString(metadataFile.content, "display_name");
    const shortDescription = yamlString(metadataFile.content, "short_description");
    const defaultPrompt = yamlString(metadataFile.content, "default_prompt");
    const implicit = yamlBoolean(metadataFile.content, "allow_implicit_invocation");
    if (!displayName) errors.push(`${metadataFile.path} must declare interface.display_name`);
    if (!shortDescription) errors.push(`${metadataFile.path} must declare interface.short_description`);
    if (!defaultPrompt) errors.push(`${metadataFile.path} must declare interface.default_prompt`);
    if (shortDescription && shortDescription.length > 100) errors.push(`${metadataFile.path} short_description must be at most 100 characters`);
    if (implicit === null) errors.push(`${metadataFile.path} must declare policy.allow_implicit_invocation as true or false`);
    if (skillName === entrySkill && implicit !== true) errors.push(`${metadataFile.path} must allow implicit invocation for the Director X entry skill`);
    if (skillName !== entrySkill && implicit !== false) errors.push(`${metadataFile.path} must disable implicit invocation for specialist skills`);
    if (displayName) {
      const previous = displayNames.get(displayName);
      if (previous) errors.push(`${metadataFile.path} duplicates display_name from ${previous}: ${displayName}`);
      else displayNames.set(displayName, metadataFile.path);
    }
  }
  for (const skillName of skillNames ?? []) if (!metadataBySkill.has(skillName)) errors.push(`skills/${skillName}/agents/openai.yaml is required for every bundled skill`);
  for (const skillName of metadataBySkill.keys()) if (!(skillNames ?? []).includes(skillName)) errors.push(`skills/${skillName}/agents/openai.yaml has no matching SKILL.md`);
  return errors;
}

function metadataSkillName(path) {
  return String(path ?? "").match(/^skills\/([^/]+)\/agents\/openai\.yaml$/)?.[1] ?? null;
}

function yamlString(metadata, key) {
  return String(metadata ?? "").match(new RegExp(`^\\s*${key}:\\s*["']([^"']+)["']\\s*$`, "m"))?.[1]?.trim() ?? null;
}

function yamlBoolean(metadata, key) {
  const value = String(metadata ?? "").match(new RegExp(`^\\s*${key}:\\s*(true|false)\\s*$`, "m"))?.[1];
  return value === "true" ? true : value === "false" ? false : null;
}
