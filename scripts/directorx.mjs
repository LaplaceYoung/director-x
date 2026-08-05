#!/usr/bin/env node

import { resolve } from "node:path";
import { addCanvasObject, inferObjectType, initProject } from "./lib/project.mjs";
import { startCanvasServer } from "./canvas-server.mjs";
import { analyzeVideo } from "./analyze-video.mjs";

const [command = "help", ...args] = process.argv.slice(2);
const options = parseArgs(args);
const projectPath = resolve(options.project || process.cwd());

try {
  if (command === "init") {
    await initProject(projectPath);
    process.stdout.write(`Initialized Director X in ${projectPath}\n`);
  } else if (command === "canvas") {
    const { url } = await startCanvasServer({ projectPath, port: Number(options.port || 0) });
    process.stdout.write(`${url}\n`);
  } else if (command === "add") {
    const filePath = options.path ? resolve(options.path) : null;
    const type = options.type || (filePath ? inferObjectType(filePath) : "text");
    const object = await addCanvasObject(projectPath, {
      type,
      title: options.title,
      path: filePath,
      text: options.text,
      sourceUrl: options.source
    });
    process.stdout.write(`${JSON.stringify(object, null, 2)}\n`);
  } else if (command === "analyze") {
    if (!options.input) throw new Error("analyze requires --input <video-or-url>");
    const result = await analyzeVideo({ projectPath, input: options.input, title: options.title });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHelp();
  }
} catch (error) {
  process.stderr.write(`Director X: ${error.message}\n`);
  process.exitCode = 1;
}
function parseArgs(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    output[key] = next && !next.startsWith("--") ? values[++index] : true;
  }
  return output;
}

function printHelp() {
  process.stdout.write([
    "Director X",
    "",
    "  directorx init [--project PATH]",
    "  directorx canvas [--project PATH] [--port PORT]",
    "  directorx add --project PATH [--type image|video|audio|text] [--path FILE] [--text TEXT] [--title TITLE]",
    "  directorx analyze --project PATH --input VIDEO_OR_URL [--title TITLE]",
    ""
  ].join("\n"));
}
