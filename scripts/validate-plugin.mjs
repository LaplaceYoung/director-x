import { access, readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkillMcpDependencyContract } from "./skill-mcp-dependencies.mjs";
import { validateSkillMetadataCatalog } from "./skill-metadata-catalog.mjs";
import { DIRECTORX_PUBLIC_FACADE_NAMES } from "../mcp/tool-surface-policy.mjs";

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

if ((manifest?.interface?.displayName ?? "").length > 30) errors.push("interface.displayName must be at most 30 characters");
if ((manifest?.interface?.shortDescription ?? "").length > 30) errors.push("interface.shortDescription must be at most 30 characters");

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest?.name ?? "")) errors.push("plugin name must be lower-case kebab-case");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest?.version ?? "")) errors.push("plugin version must be valid semver");
if ((manifest?.version ?? "").split("+")[0] !== packageJson?.version) errors.push("plugin and package base versions must match");
if (manifest?.mcpServers) await requirePath(manifest.mcpServers, "mcpServers");
if (manifest?.skills) await requirePath(manifest.skills, "skills");
await validateSkillMcpDependencies(mcpConfig);
await validateInstalledPublicToolSurface(mcpConfig);
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
if (marketplace?.name !== "mosi") errors.push("marketplace.name must match the documented mosi selector");
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
  if (!content.includes("directorx@mosi")) errors.push(`${file} must document the real marketplace selector`);
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

async function validateInstalledPublicToolSurface(config) {
  const server = config?.mcpServers?.["directorx-production"];
  if (!server) {
    errors.push(".mcp.json must configure directorx-production");
    return;
  }
  if (server?.env?.DIRECTORX_TOOL_PROFILE !== "public") {
    errors.push("directorx-production must default DIRECTORX_TOOL_PROFILE to public");
    return;
  }
  if (server.command !== "node" || !Array.isArray(server.args) || server.args.length !== 1 || server.args[0] !== "./mcp/server.mjs") {
    errors.push("directorx-production must use the repository-local Node MCP server for public-surface validation");
    return;
  }
  const cwd = resolve(pluginRoot, server.cwd ?? ".");
  try {
    const response = await runMcpToolsList({ command: server.command, args: server.args, cwd, env: { ...process.env, ...server.env } });
    const names = (response?.result?.tools ?? []).map((tool) => tool?.name).sort();
    const expected = [...DIRECTORX_PUBLIC_FACADE_NAMES].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) errors.push(`installed public MCP surface mismatch: expected ${expected.length} Facades, received ${names.length}`);
  } catch (error) {
    errors.push(`installed public MCP surface could not start: ${error.message}`);
  }
}

async function runMcpToolsList({ command, args, cwd, env }) {
  const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  try {
    return await new Promise((resolveResponse, rejectResponse) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      const timeout = setTimeout(() => finish(rejectResponse, new Error("timed out after 2 seconds")), 2_000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        const lines = stdout.split("\n");
        stdout = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const message = JSON.parse(line);
            if (message?.id === "validate-public-surface") finish(resolveResponse, message);
          } catch {
            // MCP stdout can contain no non-JSON content; preserve it for the
            // next complete line rather than making validation flaky on chunks.
          }
        }
      });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", (error) => finish(rejectResponse, error));
      child.once("exit", (code, signal) => finish(rejectResponse, new Error(`exited before tools/list (code=${code}, signal=${signal}, stderr=${stderr.trim()})`)));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "validate-public-surface", method: "tools/list", params: {} })}\n`);
    });
  } finally {
    child.kill("SIGTERM");
  }
}
