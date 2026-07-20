#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installCodexAgentRoles } from "../mcp/codex-agent-roles.mjs";

export async function installDirectorXUserAgents(projectPath = process.cwd()) {
  return await installCodexAgentRoles(resolve(projectPath));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await installDirectorXUserAgents(process.argv[2]);
  process.stdout.write(`${JSON.stringify({
    installScope: result.installScope,
    agentsDirectory: result.userAgentsDirectory,
    installedCount: result.roles.length,
    diskReady: result.diskReady,
    effectiveAfter: result.effectiveAfter
  }, null, 2)}\n`);
}
