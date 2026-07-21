import test from "node:test";
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));

test("bundles every relative reference named by an installed skill", async () => {
  const skillsRoot = join(pluginRoot, "skills");
  const skillNames = (await readdir(skillsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const missing = [];
  for (const skillName of skillNames) {
    const skillPath = join(skillsRoot, skillName, "SKILL.md");
    const markdown = await readFile(skillPath, "utf8");
    const references = [...markdown.matchAll(/`(references\/[A-Za-z0-9._/-]+)`/g)].map((match) => match[1]);
    for (const reference of references) {
      try { await access(join(dirname(skillPath), reference)); }
      catch { missing.push(`${skillName}/${reference}`); }
    }
  }
  assert.deepEqual(missing, []);
});

test("keeps the plugin runtime dependency-free and repository-relative", async () => {
  const mcp = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8"));
  const server = mcp.mcpServers["directorx-production"];
  assert.equal(server.command, "node");
  assert.deepEqual(server.args, ["./mcp/server.mjs"]);
  assert.equal(server.cwd, ".");
});

test("ships an installable repository marketplace with matching public instructions", async () => {
  const plugin = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const marketplace = JSON.parse(await readFile(join(pluginRoot, ".agents", "plugins", "marketplace.json"), "utf8"));
  const readme = await readFile(join(pluginRoot, "README.md"), "utf8");
  const chineseReadme = await readFile(join(pluginRoot, "README.zh-CN.md"), "utf8");
  assert.equal(marketplace.name, "mosi");
  assert.equal(marketplace.interface.displayName, "MOSI");
  assert.deepEqual(marketplace.plugins.map((entry) => entry.name), [plugin.name]);
  assert.deepEqual(marketplace.plugins[0].source, { source: "local", path: "./" });
  assert.deepEqual(marketplace.plugins[0].policy, { installation: "AVAILABLE", authentication: "ON_INSTALL" });
  assert.match(readme, /directorx@mosi/);
  assert.match(chineseReadme, /directorx@mosi/);
});

test("runs plugin validation in CI", async () => {
  const packageJson = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8"));
  const workflow = await readFile(join(pluginRoot, ".github", "workflows", "ci.yml"), "utf8");
  await access(join(pluginRoot, "scripts", "validate-plugin.mjs"));
  assert.match(packageJson.scripts["validate:plugin"], /validate-plugin\.mjs/);
  assert.match(packageJson.scripts.ci, /validate:plugin/);
  assert.match(workflow, /pnpm validate:plugin/);
  assert.match(workflow, /pnpm test/);
  assert.match(workflow, /brew install ffmpeg/);
});

test("ships a standalone setup doctor and approval-gated MCP repair path", async () => {
  const packageJson = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8"));
  const setupSkill = await readFile(join(pluginRoot, "skills", "directorx-setup-doctor", "SKILL.md"), "utf8");
  const server = await readFile(join(pluginRoot, "mcp", "server.mjs"), "utf8");
  await access(join(pluginRoot, "runtime", "doctor-plugin.mjs"));
  await access(join(pluginRoot, "runtime", "plugin-health.mjs"));
  await access(join(pluginRoot, "runtime", "plugin-repair.mjs"));
  await access(join(pluginRoot, "runtime", "plugin-smoke-test.mjs"));
  assert.match(packageJson.scripts.doctor, /doctor-plugin\.mjs/);
  assert.match(packageJson.scripts["install:runtime"], /install-media-runtime\.mjs/);
  assert.match(setupSkill, /directorx_diagnose_setup/);
  assert.match(setupSkill, /directorx_repair_setup/);
  assert.match(setupSkill, /request_user_input/);
  assert.match(setupSkill, /zero-Key/);
  assert.match(server, /name: "directorx_diagnose_setup"/);
  assert.match(server, /name: "directorx_repair_setup"/);
});

test("fails closed when the Director X MCP runtime is unavailable", async () => {
  const skill = await readFile(join(pluginRoot, "skills", "directorx", "SKILL.md"), "utf8");
  assert.match(skill, /If `directorx_capability_preflight` is absent[\s\S]*fail closed/);
  assert.match(skill, /do not create a substitute Markdown package/);
  assert.match(skill, /A new thread alone does not reload plugin MCP processes/);
});

test("keeps production conversation concise and consumer-facing", async () => {
  const skill = await readFile(join(pluginRoot, "skills", "directorx", "SKILL.md"), "utf8");
  const canvasSkill = await readFile(join(pluginRoot, "skills", "directorx-canvas-coordination", "SKILL.md"), "utf8");
  assert.match(skill, /User-facing conversation contract/);
  assert.match(skill, /Do not announce every Skill read, tool call, file write/);
  assert.match(skill, /Do not use engineering status templates/);
  assert.match(skill, /Do not print intermediate scripts, prompt packs, research logs/);
  assert.match(canvasSkill, /concise consumer layer/);
  assert.match(canvasSkill, /collapsed “制作详情”/);
});

test("binds every surfaced Director X skill to the bundled production MCP server", async () => {
  const mcpConfig = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8"));
  assert.ok(mcpConfig.mcpServers["directorx-production"]);
  const skillEntries = await readdir(join(pluginRoot, "skills"), { withFileTypes: true });
  const skillNames = skillEntries.filter((item) => item.isDirectory()).map((entry) => entry.name).sort();
  const metadataFiles = [];
  for (const skillName of skillNames) {
    const path = join(pluginRoot, "skills", skillName, "agents", "openai.yaml");
    try { metadataFiles.push({ skillName, path, content: await readFile(path, "utf8") }); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  assert.equal(metadataFiles.length, skillNames.length);
  for (const metadata of metadataFiles) {
    assert.match(metadata.content, /interface:\s*[\s\S]*display_name:\s*["'][^"']+["']/);
    assert.match(metadata.content, /interface:\s*[\s\S]*short_description:\s*["'][^"']+["']/);
    assert.match(metadata.content, /interface:\s*[\s\S]*default_prompt:\s*["'][^"']+["']/);
    assert.match(metadata.content, /dependencies:\s*[\s\S]*type:\s*["']?mcp["']?[\s\S]*value:\s*["']?directorx-production["']?/);
    assert.doesNotMatch(metadata.content, /value:\s*["']?node_repl["']?/);
    if (metadata.skillName === "directorx") {
      assert.match(metadata.content, /allow_implicit_invocation:\s*true/);
    } else {
      assert.match(metadata.content, /allow_implicit_invocation:\s*false/);
    }
  }
  const skill = await readFile(join(pluginRoot, "skills", "directorx", "SKILL.md"), "utf8");
  const orchestrationSkill = await readFile(join(pluginRoot, "skills", "directorx-production-orchestration", "SKILL.md"), "utf8");
  assert.match(skill, /browser-client\.mjs/);
  assert.match(skill, /Do not use the MCP App inline surface during preflight/);
  assert.match(orchestrationSkill, /load the main `directorx` skill and complete its canvas-first boot sequence/i);
});

test("presents the public plugin around native Goals, DX agents, and the live canvas", async () => {
  const readme = await readFile(join(pluginRoot, "README.md"), "utf8");
  await access(join(pluginRoot, "scripts", "install-user-agents.mjs"));
  await access(join(pluginRoot, "assets", "brand", "directorx-logo.png"));
  await access(join(pluginRoot, "assets", "screenshots", "live-production-canvas.jpg"));
  await access(join(pluginRoot, "assets", "screenshots", "native-goal-and-input.jpg"));
  await access(join(pluginRoot, "assets", "screenshots", "dx-specialist-agents.jpg"));
  await access(join(pluginRoot, "site", "assets", "demos", "directorx-waic-moss-promo-v4.mp4"));
  await access(join(pluginRoot, "site", "assets", "demos", "directorx-waic-moss-promo-v2.mp4"));
  await access(join(pluginRoot, "site", "assets", "demos", "directorx-waic-moss-promo-v4-poster.jpg"));
  await access(join(pluginRoot, "site", "assets", "demos", "directorx-waic-moss-promo-v2-poster.jpg"));
  assert.match(readme, /Native Codex Goals/);
  assert.match(readme, /Dedicated DX Agents/);
  assert.match(readme, /Live Production Canvas/);
  assert.match(readme, /Pi Agent Harness/);
  assert.match(readme, /Electron application/);
  assert.match(readme, /Zero-Key Demo Results/);
  assert.match(readme, /platform\.mosi\.cn/);
  assert.match(readme, /OpenMOSS\/MOSS-TTS-Nano/);
});

test("ships a standalone Chinese project README", async () => {
  const readme = await readFile(join(pluginRoot, "README.md"), "utf8");
  const chineseReadme = await readFile(join(pluginRoot, "README.zh-CN.md"), "utf8");
  assert.match(readme, /README\.zh-CN\.md/);
  assert.match(chineseReadme, /Codex 原生 Goal/);
  assert.match(chineseReadme, /专用 DX 子智能体/);
  assert.match(chineseReadme, /实时侧边栏画布/);
  assert.match(chineseReadme, /Pi Agent Harness/);
  assert.match(chineseReadme, /Electron/);
  assert.match(chineseReadme, /codex plugin marketplace add/);
  assert.match(chineseReadme, /0-Key Demo 成果/);
  assert.match(chineseReadme, /platform\.mosi\.cn/);
  assert.match(chineseReadme, /OpenMOSS\/MOSS-TTS-Nano/);
});

test("ships the public landing page and deployment workflow", async () => {
  const landing = await readFile(join(pluginRoot, "site", "index.html"), "utf8");
  const motion = await readFile(join(pluginRoot, "site", "main.js"), "utf8");
  const { locales } = await import(new URL("../site/i18n.js", import.meta.url));
  const plugin = JSON.parse(await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const workflow = await readFile(join(pluginRoot, ".github", "workflows", "pages.yml"), "utf8");
  await access(join(pluginRoot, "site", "assets", "directorx-logo.png"));
  await access(join(pluginRoot, "site", "assets", "live-production-canvas.jpg"));
  await access(join(pluginRoot, "site", "robots.txt"));
  await access(join(pluginRoot, "site", "sitemap.xml"));
  await access(join(pluginRoot, "site", "llms.txt"));
  assert.match(landing, /Direct the Goal/);
  assert.match(landing, /Dedicated crew/);
  assert.match(landing, /Live canvas/);
  assert.match(landing, /data-locale="zh-CN"/);
  assert.match(landing, /Review theater/);
  assert.match(landing, /One word,.*one world\./);
  assert.match(landing, /Video Agent Harness/);
  assert.match(landing, /video-harness/);
  assert.match(landing, /assets\/demos\/directorx-waic-moss-promo-v4\.mp4/);
  assert.match(motion, /three@0\.185\.1/);
  assert.match(motion, /resolveSceneTrack/);
  assert.match(motion, /updateSceneLabels/);
  assert.match(landing, /SoftwareApplication/);
  assert.match(landing, /Open-Source AI Video Production Harness for Codex/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.equal(plugin.homepage, "https://laplaceyoung.github.io/director-x/");
  const translationKeys = [...landing.matchAll(/data-i18n(?:-html|-aria-label)?="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(translationKeys.length > 80);
  for (const locale of Object.values(locales)) {
    assert.deepEqual([...new Set(translationKeys)].filter((key) => !(key in locale.copy)), []);
    assert.ok(Object.keys(locale.chapterNames).length >= 8);
    assert.equal(Object.keys(locale.sceneLabels).length, 9);
  }
});

test("bundles an evidence-grounded directing knowledge seed", async () => {
  const seed = JSON.parse(await readFile(join(pluginRoot, "knowledge", "director-knowledge-seed.json"), "utf8"));
  const readme = await readFile(join(pluginRoot, "README.md"), "utf8");
  assert.ok(seed.entries.length >= 5);
  assert.ok(seed.entries.every((entry) => entry.principles.every((principle) => principle.evidenceLocator && principle.transferRule)));
  assert.ok(seed.entries.every((entry) => entry.rights.blockedReuse.length));
  assert.match(readme, /evidence/);
});
