import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { addCanvasObject, inferObjectType, projectPaths } from "./project.mjs";
import { listProviders } from "./provider-profiles.mjs";

const MEDIA_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/quicktime", ".mov"]
]);

export async function requestProvider(projectPath, options = {}) {
  if (options.approved !== true) {
    throw new Error("Provider request requires explicit user approval.");
  }
  const profile = (await listProviders(projectPath)).find((item) => item.id === options.id);
  if (!profile) throw new Error(`Provider profile not found: ${options.id}`);
  if (!profile.endpoint || !profile.authHeader || !profile.authScheme) {
    throw new Error(`Provider profile ${profile.id} is missing endpoint or authentication metadata.`);
  }

  const env = options.env || process.env;
  const credential = env[profile.authEnv];
  if (!credential) throw new Error(`Provider credential is unavailable in ${profile.authEnv}.`);
  const endpoint = resolveEndpoint(profile.endpoint, options.endpoint);
  const method = String(options.method || "POST").toUpperCase();
  if (!["GET", "POST"].includes(method)) throw new Error("Provider method must be GET or POST.");
  const body = method === "GET" ? null : await readRequestBody(projectPath, options);
  rejectSecretFields(body);
  if (body !== null && JSON.stringify(body).includes(credential)) {
    throw new Error("Provider request body must not contain the configured credential.");
  }

  const runRoot = join(
    projectPaths(projectPath).stateRoot,
    "provider-runs",
    `${Date.now()}-${safeName(profile.id)}`
  );
  await mkdir(runRoot, { recursive: true });
  const requestPath = join(runRoot, "request.json");
  await writeFile(requestPath, `${JSON.stringify({
    provider: profile.id,
    model: profile.model,
    endpoint,
    method,
    body
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  const headers = {
    Accept: "application/json, image/*, video/*",
    [profile.authHeader]: profile.authScheme === "bearer" ? `Bearer ${credential}` : credential
  };
  if (body !== null) headers["Content-Type"] = "application/json";
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(endpoint, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(normalizeTimeout(options.timeoutMs))
  });
  const contentType = String(response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const payload = Buffer.from(await response.arrayBuffer());
  const responsePath = chooseResponsePath(projectPath, runRoot, contentType, options.output);
  await mkdir(dirname(responsePath), { recursive: true });
  await writeFile(responsePath, formatPayload(payload, contentType, credential), { mode: 0o600 });

  const record = {
    provider: profile.id,
    model: profile.model,
    endpoint,
    method,
    status: response.status,
    ok: response.ok,
    contentType: contentType || null,
    requestPath: relative(projectPaths(projectPath).root, requestPath),
    responsePath: relative(projectPaths(projectPath).root, responsePath),
    createdAt: new Date().toISOString()
  };
  const recordPath = join(runRoot, "run.json");
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  const outputType = inferObjectType(responsePath);
  if (response.ok && MEDIA_EXTENSIONS.has(contentType) && ["image", "video"].includes(outputType)) {
    await addCanvasObject(projectPath, {
      type: outputType,
      title: options.title || `${profile.provider} ${profile.model}`,
      path: responsePath,
      metadata: {
        provider: profile.id,
        model: profile.model,
        providerRun: relative(projectPaths(projectPath).root, recordPath)
      }
    });
  }
  return {
    ...record,
    recordPath: relative(projectPaths(projectPath).root, recordPath)
  };
}

async function readRequestBody(projectPath, options) {
  if (options.body !== undefined) return options.body;
  if (!options.bodyPath) throw new Error("Provider POST request requires a JSON body file.");
  const path = assertInsideProject(projectPath, options.bodyPath, "Provider request body");
  return JSON.parse(await readFile(path, "utf8"));
}

function resolveEndpoint(configuredEndpoint, override) {
  const configured = new URL(configuredEndpoint);
  if (!override) return configured.toString();
  const requested = new URL(override);
  if (requested.protocol !== "https:") throw new Error("Provider endpoint override must use HTTPS.");
  if (requested.username || requested.password) {
    throw new Error("Provider endpoint override must not contain URL credentials.");
  }
  for (const key of requested.searchParams.keys()) {
    if (/(?:api[-_]?key|authorization|credential|secret|signature|access[-_]?token)$/i.test(key)) {
      throw new Error("Provider endpoint override must not contain credential query parameters.");
    }
  }
  if (requested.origin !== configured.origin) {
    throw new Error("Provider endpoint override must use the configured origin.");
  }
  return requested.toString();
}

function chooseResponsePath(projectPath, runRoot, contentType, output) {
  if (output) return assertInsideProject(projectPath, output, "Provider response");
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    return join(runRoot, "response.json");
  }
  if (contentType.startsWith("text/")) return join(runRoot, "response.txt");
  return join(runRoot, `response${MEDIA_EXTENSIONS.get(contentType) || ".bin"}`);
}

function formatPayload(payload, contentType, credential) {
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    try {
      const formatted = `${JSON.stringify(JSON.parse(payload.toString("utf8")), null, 2)}\n`;
      return formatted.replaceAll(credential, "[REDACTED]");
    } catch {
      return payload.toString("utf8").replaceAll(credential, "[REDACTED]");
    }
  }
  if (contentType.startsWith("text/")) {
    return payload.toString("utf8").replaceAll(credential, "[REDACTED]");
  }
  return payload;
}

function rejectSecretFields(value, path = "body") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/(?:api[-_]?key|authorization|credential|secret|access[-_]?token)$/i.test(key)) {
      throw new Error(`Provider request body must not contain credentials: ${path}.${key}`);
    }
    rejectSecretFields(child, `${path}.${key}`);
  }
}

function assertInsideProject(projectPath, filePath, label) {
  const root = projectPaths(projectPath).root;
  const target = resolve(filePath);
  const child = relative(root, target);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error(`${label} path must stay inside the project.`);
  }
  return target;
}

function normalizeTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 1000 && timeout <= 600000 ? timeout : 120000;
}

function safeName(value) {
  return basename(String(value))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "") || "provider";
}
