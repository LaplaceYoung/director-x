import test from "node:test";
import assert from "node:assert/strict";
import { DIRECTORX_MCP_SERVER, extractMcpDependencyNames, validateSkillMcpDependencyContract } from "../scripts/skill-mcp-dependencies.mjs";

test("extracts quoted and unquoted MCP server dependencies", () => {
  assert.deepEqual(extractMcpDependencyNames(`dependencies:\n  tools:\n    - type: mcp\n      value: directorx-production\n    - type: "mcp"\n      value: "research-server"`), ["directorx-production", "research-server"]);
});

test("accepts skill metadata bound to the bundled Director X server", () => {
  assert.deepEqual(validateSkillMcpDependencyContract({
    configuredServers: [DIRECTORX_MCP_SERVER],
    metadataFiles: [{ path: "skills/directorx/agents/openai.yaml", content: `dependencies:\n  tools:\n    - type: "mcp"\n      value: "${DIRECTORX_MCP_SERVER}"` }]
  }), []);
});

test("rejects missing, stale, and unconfigured MCP dependencies", () => {
  assert.deepEqual(validateSkillMcpDependencyContract({
    configuredServers: ["other-server"],
    metadataFiles: [
      { path: "skills/missing/agents/openai.yaml", content: "interface:\n  display_name: Missing" },
      { path: "skills/stale/agents/openai.yaml", content: `dependencies:\n  tools:\n    - type: mcp\n      value: ${DIRECTORX_MCP_SERVER}\n    - type: mcp\n      value: removed-server` }
    ]
  }), [
    "MCP configuration must include the directorx-production server required by Director X skills",
    "skills/missing/agents/openai.yaml must depend on the bundled directorx-production MCP server",
    "skills/stale/agents/openai.yaml references an unconfigured MCP server: directorx-production",
    "skills/stale/agents/openai.yaml references an unconfigured MCP server: removed-server"
  ]);
});
