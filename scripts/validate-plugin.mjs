import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkillMcpDependencyContract } from "./skill-mcp-dependencies.mjs";
import { validateSkillMetadataCatalog } from "./skill-metadata-catalog.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const manifest = await readJson(".codex-plugin/plugin.json");
const packageJson = await readJson("package.json");
const marketplace = await readJson(".agents/plugins/marketplace.json");
const mcpConfig = await readJson(".mcp.json");

requireText(manifest, "name");
requireText(manifest, "version");
requireText(manifest, "description");
requireText(manifest?.author, "name", "author.name");
requireText(manifest?.interface, "displayName", "interface.displayName");
requireText(manifest?.interface, "shortDescription", "interface.shortDescription");
requireText(manifest?.interface, "longDescription", "interface.longDescription");
requireText(manifest?.interface, "developerName", "interface.developerName");
requireText(manifest?.interface, "category", "interface.category");

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest?.name ?? "")) errors.push("plugin name must be lower-case kebab-case");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest?.version ?? "")) errors.push("plugin version must be valid semver");
if ((manifest?.version ?? "").split("+")[0] !== packageJson?.version) errors.push("plugin and package base versions must match");
if (manifest?.mcpServers) await requirePath(manifest.mcpServers, "mcpServers");
if (manifest?.skills) await requirePath(manifest.skills, "skills");
await validateSkillMcpDependencies(mcpConfig);
for (const key of ["composerIcon", "logo", "logoDark"]) {
  if (manifest?.interface?.[key]) await requirePath(manifest.interface[key], `interface.${key}`);
}
for (const [index, screenshot] of (manifest?.interface?.screenshots ?? []).entries()) {
  await requirePath(screenshot, `interface.screenshots[${index}]`);
  if (!screenshot.endsWith(".png")) errors.push(`interface.screenshots[${index}] must be a PNG`);
}
for (const key of ["homepage", "repository"]) requireHttpsWhenPresent(manifest, key);
for (const key of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) requireHttpsWhenPresent(manifest?.interface, key, `interface.${key}`);
if ((manifest?.interface?.defaultPrompt ?? []).length > 3) errors.push("interface.defaultPrompt supports at most three entries");
for (const [index, prompt] of (manifest?.interface?.defaultPrompt ?? []).entries()) {
  if (typeof prompt !== "string" || prompt.length > 128) errors.push(`interface.defaultPrompt[${index}] must be a string of at most 128 characters`);
}

requireText(marketplace, "name", "marketplace.name");
if (marketplace?.name !== "openmoss-local") errors.push("marketplace.name must match the documented openmoss-local selector");
const entry = marketplace?.plugins?.find((plugin) => plugin?.name === manifest?.name);
if (!entry) errors.push(`marketplace must contain plugin ${manifest?.name ?? "<unknown>"}`);
if (entry) {
  if (entry?.policy?.installation !== "AVAILABLE") errors.push("marketplace installation policy must be AVAILABLE");
  if (!new Set(["ON_INSTALL", "ON_USE"]).has(entry?.policy?.authentication)) errors.push("marketplace authentication policy is invalid");
  requireText(entry, "category", "marketplace.plugins[].category");
  if (entry?.source?.source === "local") {
    const sourceRoot = resolve(pluginRoot, entry.source.path ?? "");
    await requireAbsolutePath(join(sourceRoot, ".codex-plugin", "plugin.json"), "marketplace local source");
  } else if (entry?.source?.source === "url") {
    const url = entry?.source?.url ?? "";
    if (!(url === "./" || /^https:\/\//.test(url))) errors.push("marketplace URL source must be ./ or HTTPS");
  } else errors.push("marketplace plugin source must be local or url");
}

for (const file of ["README.md", "README.zh-CN.md"]) {
  const content = await readText(file);
  if (!content.includes("directorx@openmoss-local")) errors.push(`${file} must document the real marketplace selector`);
  if (!content.includes("codex plugin marketplace add")) errors.push(`${file} must document marketplace installation`);
}
for (const file of [".codex-plugin/plugin.json", ".agents/plugins/marketplace.json", "README.md", "README.zh-CN.md"]) {
  if (/\[TODO:|TODO_PLACEHOLDER/.test(await readText(file))) errors.push(`${file} contains a placeholder`);
}

if (errors.length) {
  console.error(`Director X plugin validation failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Director X plugin ${manifest.name}@${manifest.version} is structurally valid and available from ${marketplace.name}.`);

async function readJson(relativePath) {
  try { return JSON.parse(await readText(relativePath)); }
  catch (error) { errors.push(`${relativePath}: ${error.message}`); return {}; }
}
async function readText(relativePath) { return readFile(join(pluginRoot, relativePath), "utf8"); }
function requireText(value, key, label = key) {
  if (typeof value?.[key] !== "string" || !value[key].trim()) errors.push(`${label} is required`);
}
function requireHttpsWhenPresent(value, key, label = key) {
  if (value?.[key] !== undefined && !/^https:\/\//.test(value[key])) errors.push(`${label} must use HTTPS`);
}
async function requirePath(relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath.startsWith("./")) {
    errors.push(`${label} must be a ./-relative plugin path`);
    return;
  }
  await requireAbsolutePath(resolve(pluginRoot, relativePath), label);
}
async function requireAbsolutePath(path, label) {
  try { await access(path); }
  catch { errors.push(`${label} points to a missing path: ${path}`); }
}

async function validateSkillMcpDependencies(config) {
  const entries = await readdir(join(pluginRoot, "skills"), { withFileTypes: true });
  const skillNames = entries.filter((item) => item.isDirectory()).map((item) => item.name);
  const metadataFiles = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const relativePath = join("skills", entry.name, "agents", "openai.yaml");
    try { metadataFiles.push({ path: relativePath, content: await readText(relativePath) }); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      errors.push(`${relativePath}: ${error.message}`);
    }
  }
  errors.push(...validateSkillMetadataCatalog({ skillNames, metadataFiles }));
  errors.push(...validateSkillMcpDependencyContract({ configuredServers: Object.keys(config?.mcpServers ?? {}), metadataFiles }));
}
