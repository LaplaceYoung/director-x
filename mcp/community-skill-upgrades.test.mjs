import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const plugin = new URL("..", import.meta.url);

test("bundles evidence rough-cut and timeline-interchange skills with disclosed references", async () => {
  const roughSkill = new URL("skills/directorx-evidence-rough-cut/SKILL.md", plugin);
  const interchangeSkill = new URL("skills/directorx-timeline-interchange/SKILL.md", plugin);
  await access(new URL("skills/directorx-evidence-rough-cut/references/evidence-rough-cut-playbook.md", plugin));
  await access(new URL("skills/directorx-timeline-interchange/references/timeline-interchange-contract.md", plugin));
  const rough = await readFile(roughSkill, "utf8");
  const interchange = await readFile(interchangeSkill, "utf8");
  assert.match(rough, /directorx_propose_evidence_rough_cut/);
  assert.match(rough, /DX-Editor/);
  assert.match(rough, /requiresNativeApproval=true/);
  assert.match(interchange, /sourceRange/);
  assert.match(interchange, /timelineRange/);
  assert.match(interchange, /roundtrip_validation\.json/);
  assert.match(interchange, /directorx_export_timeline_interchange/);
  assert.match(interchange, /directorx\.timeline\+json/);
});

test("routes automatic first cuts through DX-Editor and the native approval boundary", async () => {
  const mainSkill = await readFile(new URL("skills/directorx/SKILL.md", plugin), "utf8");
  const editingSkill = await readFile(new URL("skills/directorx-agentic-editing/SKILL.md", plugin), "utf8");
  const server = await readFile(new URL("mcp/server.mjs", plugin), "utf8");
  assert.match(mainSkill, /directorx-evidence-rough-cut/);
  assert.match(mainSkill, /directorx-timeline-interchange/);
  assert.match(editingSkill, /registered interval evidence/);
  assert.match(server, /name: "directorx_propose_evidence_rough_cut"/);
  assert.match(server, /owner: \{ const: "DX-Editor"/);
  assert.match(server, /name: "directorx_export_timeline_interchange"/);
});

test("bundles the evidence-only frame-audit repair skill and canvas handoff", async () => {
  const skillUrl = new URL("skills/directorx-frame-audit-repair/SKILL.md", plugin);
  await access(new URL("skills/directorx-frame-audit-repair/references/frame-audit-contract.md", plugin));
  const skill = await readFile(skillUrl, "utf8");
  const mainSkill = await readFile(new URL("skills/directorx/SKILL.md", plugin), "utf8");
  const server = await readFile(new URL("mcp/server.mjs", plugin), "utf8");
  assert.match(skill, /frame_audit_repair_plan\.json/);
  assert.match(skill, /DX-Quality-Reviewer/);
  assert.match(skill, /request_user_input/);
  assert.match(mainSkill, /directorx-frame-audit-repair/);
  assert.match(server, /frame_audit_repair_plan\.json/);
  assert.match(server, /av_review_timeline\.json/);
});
