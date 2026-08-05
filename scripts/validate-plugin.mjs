import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const manifest = await readJson(".codex-plugin/plugin.json");
const packageJson = await readJson("package.json");

requireText(manifest, "name");
requireText(manifest, "version");
requireText(manifest, "description");
requireText(manifest, "license");
requireText(manifest?.author, "name", "author.name");
requireText(manifest?.interface, "displayName", "interface.displayName");
requireText(manifest?.interface, "shortDescription", "interface.shortDescription");
requireText(manifest?.interface, "longDescription", "interface.longDescription");
requireText(manifest?.interface, "developerName", "interface.developerName");
requireText(manifest?.interface, "category", "interface.category");

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest?.name || "")) {
  errors.push("plugin name must be lower-case kebab-case");
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest?.version || "")) {
  errors.push("plugin version must be valid semver");
}
if (manifest?.version !== packageJson?.version) {
  errors.push("plugin and package versions must match");
}
if (manifest?.license !== packageJson?.license) {
  errors.push("plugin and package licenses must match");
}
if (manifest?.license !== "Apache-2.0") {
  errors.push("plugin license must be Apache-2.0");
}
if (manifest?.mcpServers) {
  errors.push("the new Director X foundation must not declare an MCP server");
}
if (manifest?.skills) await requirePath(manifest.skills, "skills");

const skill = await readText("skills/directorx/SKILL.md");
if (!skill.startsWith("---\n") || !/\nname:\s*directorx\s*\n/.test(skill)) {
  errors.push("skills/directorx/SKILL.md must contain valid directorx frontmatter");
}
if (!/request_user_input/.test(skill)) errors.push("Director X Skill must use Codex native request_user_input");
if (!/references\/native-questioning\.md/.test(skill)) {
  errors.push("Director X Skill must load the native questioning reference");
}
if (!/spawn_agent|native subagents/i.test(skill)) errors.push("Director X Skill must document native subagent use");
if (!/image[\s\S]*video[\s\S]*audio[\s\S]*text/.test(skill)) {
  errors.push("Director X Skill must restrict canvas content to image, video, audio, and text");
}

for (const path of [
  "skills/directorx-prompt-writer/SKILL.md",
  "skills/directorx-web-access/SKILL.md",
  "skills/directorx-reference-analyst/SKILL.md",
  "skills/directorx-asset-researcher/SKILL.md",
  "skills/directorx-visual-director/SKILL.md",
  "skills/directorx-remotion-editor/SKILL.md"
]) {
  await requirePath(`./${path}`, path);
}

for (const path of [
  "app/canvas.html",
  "remotion/index.jsx",
  "remotion/root.jsx",
  "remotion/composition.jsx",
  "scripts/directorx.mjs",
  "scripts/canvas-server.mjs",
  "scripts/analyze-video.mjs",
  "scripts/lib/generation-placeholders.mjs",
  "scripts/lib/provider-profiles.mjs",
  "scripts/lib/provider-request.mjs",
  "scripts/lib/video-analysis.mjs",
  "scripts/lib/remotion-project.mjs",
  "skills/directorx/references/providers.md",
  "skills/directorx/references/native-questioning.md",
  "runtime/THIRD_PARTY.md",
  "runtime/bin/darwin-universal/yt-dlp",
  "runtime/licenses/yt-dlp-UNLICENSE"
]) {
  await requirePath(`./${path}`, path);
}

const nativeQuestioning = await readText("skills/directorx/references/native-questioning.md");
if (!/one question at a time/i.test(nativeQuestioning)) {
  errors.push("native questioning must require one question at a time");
}
if (!/recommended answer/i.test(nativeQuestioning)) {
  errors.push("native questioning must require a recommended answer");
}
if (!/discoverable facts/i.test(nativeQuestioning)) {
  errors.push("native questioning must distinguish facts from user decisions");
}

await requireChecksum(
  "runtime/bin/darwin-universal/yt-dlp",
  "498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b"
);

if (errors.length) {
  process.stderr.write(`Director X validation failed:\n- ${errors.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`Director X ${manifest.version} plugin structure is valid.\n`);

async function readJson(path) {
  try {
    return JSON.parse(await readText(path));
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
    return {};
  }
}

async function readText(path) {
  return readFile(join(root, path), "utf8");
}

function requireText(value, key, label = key) {
  if (typeof value?.[key] !== "string" || !value[key].trim()) errors.push(`${label} is required`);
}

async function requirePath(relativePath, label) {
  if (!relativePath.startsWith("./")) {
    errors.push(`${label} must be a plugin-relative path`);
    return;
  }
  try {
    await access(resolve(root, relativePath));
  } catch {
    errors.push(`${label} points to a missing path`);
  }
}

async function requireChecksum(relativePath, expected) {
  try {
    const contents = await readFile(join(root, relativePath));
    const actual = createHash("sha256").update(contents).digest("hex");
    if (actual !== expected) errors.push(`${relativePath} checksum does not match the pinned release`);
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
  }
}
