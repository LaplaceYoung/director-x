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

test("declares the host tool needed to open the side Browser canvas", async () => {
  const metadata = await readFile(join(pluginRoot, "skills", "directorx", "agents", "openai.yaml"), "utf8");
  const orchestrationMetadata = await readFile(join(pluginRoot, "skills", "directorx-production-orchestration", "agents", "openai.yaml"), "utf8");
  const skill = await readFile(join(pluginRoot, "skills", "directorx", "SKILL.md"), "utf8");
  const orchestrationSkill = await readFile(join(pluginRoot, "skills", "directorx-production-orchestration", "SKILL.md"), "utf8");
  assert.match(metadata, /dependencies:\s*[\s\S]*type:\s*["']?mcp["']?[\s\S]*value:\s*["']?node_repl["']?/);
  assert.match(orchestrationMetadata, /dependencies:\s*[\s\S]*type:\s*["']?mcp["']?[\s\S]*value:\s*["']?node_repl["']?/);
  assert.match(skill, /browser-client\.mjs/);
  assert.match(skill, /Do not use the MCP App inline surface during preflight/);
  assert.match(orchestrationSkill, /load the main `directorx` skill and complete its canvas-first boot sequence/i);
});

test("documents optional native DX roles and restart-free typed or collaboration compatibility", async () => {
  const readme = await readFile(join(pluginRoot, "README.md"), "utf8");
  await access(join(pluginRoot, "scripts", "install-user-agents.mjs"));
  assert.match(readme, /~\/\.codex\/agents/);
  assert.match(readme, /install-user-agents\.mjs/);
  assert.match(readme, /built-in `default`, `worker`, and `explorer`/i);
  assert.match(readme, /task_name\/fork_turns\/message/);
  assert.match(readme, /None of these compatibility paths block Goal entry or require a restart/i);
  assert.match(readme, /claim-token `boot` heartbeat/);
  assert.match(readme, /plain HTTP GET or forged token cannot satisfy the gate/);
});

test("ships a standalone Chinese installation and production guide", async () => {
  const readme = await readFile(join(pluginRoot, "README.md"), "utf8");
  const guide = await readFile(join(pluginRoot, "USAGE.zh-CN.md"), "utf8");
  assert.match(readme, /USAGE\.zh-CN\.md/);
  assert.match(guide, /一键安装方式/);
  assert.match(guide, /request_user_input/);
  assert.match(guide, /MOSS-TTS/);
  assert.match(guide, /quick、standard 与 complex/);
  assert.match(guide, /render_quality_contract\.json/);
  assert.match(guide, /full_frame_audit_required/);
});

test("bundles an evidence-grounded directing knowledge seed", async () => {
  const seed = JSON.parse(await readFile(join(pluginRoot, "knowledge", "director-knowledge-seed.json"), "utf8"));
  const readme = await readFile(join(pluginRoot, "README.md"), "utf8");
  assert.ok(seed.entries.length >= 5);
  assert.ok(seed.entries.every((entry) => entry.principles.every((principle) => principle.evidenceLocator && principle.transferRule)));
  assert.ok(seed.entries.every((entry) => entry.rights.blockedReuse.length));
  assert.match(readme, /directorx_query_director_knowledge/);
});
