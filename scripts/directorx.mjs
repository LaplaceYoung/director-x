#!/usr/bin/env node

import { resolve } from "node:path";
import { addCanvasObject, inferObjectType, initProject } from "./lib/project.mjs";
import { startCanvasServer } from "./canvas-server.mjs";
import { analyzeVideo } from "./analyze-video.mjs";
import { doctorMediaTools } from "./lib/media-tools.mjs";
import { composeRemotionProject, renderRemotionProject } from "./lib/remotion-project.mjs";
import {
  configureProvider,
  doctorProvider,
  listProviders
} from "./lib/provider-profiles.mjs";
import { requestProvider } from "./lib/provider-request.mjs";
import { addGenerationPlaceholder } from "./lib/generation-placeholders.mjs";

const [command = "help", ...rawArgs] = process.argv.slice(2);
const providerAction = command === "provider" && rawArgs[0] && !rawArgs[0].startsWith("--")
  ? rawArgs.shift()
  : null;
const args = rawArgs;
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
  } else if (command === "placeholder") {
    const object = await addGenerationPlaceholder(projectPath, {
      modality: options.modality,
      mode: options.mode,
      title: options.title,
      prompt: options.prompt,
      negativePrompt: options.negative,
      aspectRatio: options["aspect-ratio"],
      needs: options.needs,
      durationSeconds: options.duration,
      resolution: options.resolution,
      fps: options.fps,
      outputCount: options["output-count"],
      quality: options.quality,
      format: options.format
    });
    process.stdout.write(`${JSON.stringify(object, null, 2)}\n`);
  } else if (command === "doctor") {
    const result = await doctorMediaTools();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } else if (command === "compose") {
    const result = await composeRemotionProject(projectPath, {
      title: options.title,
      width: options.width,
      height: options.height,
      fps: options.fps,
      secondsPerItem: options["seconds-per-item"]
    });
    process.stdout.write(`${JSON.stringify({ specPath: result.specPath, spec: result.spec }, null, 2)}\n`);
  } else if (command === "render") {
    const result = await renderRemotionProject(projectPath, {
      quality: options.quality,
      output: options.output
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === "provider" && providerAction === "configure") {
    const secretOption = ["key", "api-key", "secret", "token"].find((name) => options[name] !== undefined);
    if (secretOption) {
      throw new Error(`Do not pass --${secretOption}. Set the credential in --auth-env locally.`);
    }
    const profile = await configureProvider(projectPath, {
      id: options.id,
      provider: options.provider,
      modality: options.modality,
      model: options.model,
      docsUrl: options.docs,
      endpoint: options.endpoint,
      authHeader: options["auth-header"],
      authScheme: options["auth-scheme"],
      authEnv: options["auth-env"]
    });
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
  } else if (command === "provider" && providerAction === "list") {
    process.stdout.write(`${JSON.stringify(await listProviders(projectPath), null, 2)}\n`);
  } else if (command === "provider" && providerAction === "doctor") {
    if (!options.id) throw new Error("provider doctor requires --id ID");
    const result = await doctorProvider(projectPath, options.id);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.credentialAvailable) process.exitCode = 1;
  } else if (command === "provider" && providerAction === "request") {
    if (!options.id) throw new Error("provider request requires --id ID");
    if (!options.approved) throw new Error("provider request requires --approved after user confirmation");
    const result = await requestProvider(projectPath, {
      id: options.id,
      approved: true,
      method: options.method,
      endpoint: options.endpoint,
      bodyPath: options.body ? resolve(options.body) : undefined,
      output: options.output ? resolve(options.output) : undefined,
      title: options.title,
      timeoutMs: options.timeout
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
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
    "  directorx placeholder --project PATH --modality image|video --prompt TEXT [--title TITLE] [--mode MODE] [--negative TEXT] [--aspect-ratio 16:9|9:16|1:1|4:3|3:4] [--needs TAG,TAG] [--duration SEC] [--resolution VALUE] [--fps N] [--output-count N]",
    "  directorx doctor",
    "  directorx compose --project PATH [--title TITLE] [--width PX] [--height PX] [--fps FPS] [--seconds-per-item N]",
    "  directorx render --project PATH [--quality preview|final] [--output PROJECT_FILE]",
    "  directorx provider configure --project PATH --id ID --provider NAME --modality image|video --model MODEL --docs HTTPS_URL --auth-env ENV_NAME [--endpoint HTTPS_URL --auth-header HEADER --auth-scheme bearer|raw]",
    "  directorx provider list --project PATH",
    "  directorx provider doctor --project PATH --id ID",
    "  directorx provider request --project PATH --id ID --approved [--method GET|POST] [--body PROJECT_JSON] [--endpoint SAME_ORIGIN_URL] [--output PROJECT_FILE] [--title TITLE]",
    ""
  ].join("\n"));
}
