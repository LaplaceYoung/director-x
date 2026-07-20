export const DIRECTORX_MCP_SERVER = "directorx-production";

export function extractMcpDependencyNames(metadata) {
  return [...String(metadata ?? "").matchAll(/-\s+type:\s*["']?mcp["']?\s+value:\s*["']?([^"'\n]+)["']?/g)]
    .map((match) => match[1].trim());
}

export function validateSkillMcpDependencyContract({ configuredServers, metadataFiles, requiredServer = DIRECTORX_MCP_SERVER }) {
  const servers = new Set(configuredServers ?? []);
  const errors = [];
  if (!servers.has(requiredServer)) errors.push(`MCP configuration must include the ${requiredServer} server required by Director X skills`);
  for (const metadataFile of metadataFiles ?? []) {
    const dependencies = extractMcpDependencyNames(metadataFile.content);
    if (!dependencies.includes(requiredServer)) errors.push(`${metadataFile.path} must depend on the bundled ${requiredServer} MCP server`);
    for (const dependency of dependencies) if (!servers.has(dependency)) errors.push(`${metadataFile.path} references an unconfigured MCP server: ${dependency}`);
  }
  return errors;
}
