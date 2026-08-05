import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { initProject, projectPaths } from "./project.mjs";

const MODALITIES = new Set(["image", "video"]);
const SECRET_FIELDS = ["apiKey", "key", "secret", "token"];

export async function configureProvider(projectPath, input) {
  rejectSecrets(input);
  const profile = normalizeProfile(input);
  await initProject(projectPath);
  const registry = await readProviderRegistry(projectPath);
  const existing = registry.providers.find((item) => item.id === profile.id);
  const now = new Date().toISOString();
  const stored = {
    ...existing,
    ...profile,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  registry.providers = [
    ...registry.providers.filter((item) => item.id !== stored.id),
    stored
  ].sort((left, right) => left.id.localeCompare(right.id));
  await writeProviderRegistry(projectPath, registry);
  return stored;
}

export async function listProviders(projectPath) {
  return (await readProviderRegistry(projectPath)).providers;
}

export async function doctorProvider(projectPath, id, options = {}) {
  const providers = await listProviders(projectPath);
  const profile = providers.find((item) => item.id === id);
  if (!profile) throw new Error(`Provider profile not found: ${id}`);
  const env = options.env || process.env;
  return {
    id: profile.id,
    provider: profile.provider,
    modality: profile.modality,
    model: profile.model,
    docsUrl: profile.docsUrl,
    endpoint: profile.endpoint || null,
    authEnv: profile.authEnv,
    credentialAvailable: Boolean(env[profile.authEnv]),
    readyForAdapter: Boolean(profile.endpoint && env[profile.authEnv])
  };
}

export async function readProviderRegistry(projectPath) {
  const { providersPath } = projectPaths(projectPath);
  try {
    const registry = JSON.parse(await readFile(providersPath, "utf8"));
    if (registry?.version !== 1 || !Array.isArray(registry.providers)) {
      throw new Error("Unsupported provider registry format.");
    }
    return registry;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { version: 1, providers: [] };
  }
}

function normalizeProfile(input) {
  const id = required(input.id, "id");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("Provider id must be lower-case kebab-case.");
  }
  const modality = required(input.modality, "modality");
  if (!MODALITIES.has(modality)) {
    throw new Error("Provider modality must be image or video.");
  }
  const docsUrl = validateHttpsUrl(required(input.docsUrl, "docsUrl"), "Official documentation URL");
  const endpoint = input.endpoint
    ? validateHttpsUrl(String(input.endpoint), "Provider endpoint")
    : undefined;
  const authEnv = required(input.authEnv, "authEnv");
  if (!/^[A-Z][A-Z0-9_]*$/.test(authEnv)) {
    throw new Error("Provider authEnv must be an uppercase environment variable name.");
  }
  return {
    id,
    provider: required(input.provider, "provider"),
    modality,
    model: required(input.model, "model"),
    docsUrl,
    ...(endpoint ? { endpoint } : {}),
    authEnv
  };
}

async function writeProviderRegistry(projectPath, registry) {
  const { providersPath } = projectPaths(projectPath);
  await mkdir(dirname(providersPath), { recursive: true });
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    providers: registry.providers
  };
  await writeFile(providersPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

function rejectSecrets(input) {
  for (const field of SECRET_FIELDS) {
    if (input[field] !== undefined) {
      throw new Error(`Do not pass ${field} to Director X. Store credentials in the configured environment variable.`);
    }
  }
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Provider ${label} is required.`);
  return value.trim();
}

function validateHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  return url.toString();
}
