#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectMediaRuntime } from "./media-runtime.mjs";

export async function doctorMediaRuntime(options = {}) {
  return await inspectMediaRuntime(options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const status = await doctorMediaRuntime();
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  process.exitCode = status.ready ? 0 : 1;
}
