#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnosePluginHealth, PLUGIN_HEALTH_PROFILES } from "./plugin-health.mjs";

export async function doctorPlugin(options = {}) {
  return await diagnosePluginHealth({
    projectPath: options.projectPath ?? process.cwd(),
    profile: options.profile ?? "zero_key_edit",
    sourceKind: options.sourceKind ?? "local",
    transcriptionRequested: Boolean(options.transcriptionRequested),
    expectedPluginVersion: options.expectedPluginVersion
  });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--profile") options.profile = argv[++index];
    else if (value === "--project") options.projectPath = argv[++index];
    else if (value === "--url-input") options.sourceKind = "url";
    else if (value === "--transcription") options.transcriptionRequested = true;
    else throw new Error(`Unknown Director X doctor option: ${value}`);
  }
  if (options.profile && !PLUGIN_HEALTH_PROFILES.includes(options.profile)) throw new Error(`Unknown Director X health profile: ${options.profile}`);
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const status = await doctorPlugin(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  process.exitCode = status.status === "blocked" ? 1 : 0;
}
