import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const PROBE_STATUSES = new Set(["available", "degraded", "unavailable"]);

export function recordProviderCapabilityProbe(run, input, now = new Date().toISOString()) {
  if (!PROBE_STATUSES.has(input.status)) throw new Error(`Unsupported provider probe status: ${input.status}`);
  if (!input.capabilities?.length) throw new Error("A provider probe must report at least one capability.");
  if (!input.evidence?.trim()) throw new Error("A provider probe requires auditable evidence.");
  run.providerCapabilities ??= {};
  const key = `${input.providerId}:${input.modelId}`;
  const snapshot = {
    providerId: input.providerId, modelId: input.modelId, status: input.status,
    capabilities: [...new Set(input.capabilities)].sort(), limits: input.limits ?? {},
    evidence: input.evidence, probedAt: now, expiresAt: input.expiresAt ?? null,
    credentialReady: input.credentialReady === true
  };
  run.providerCapabilities[key] = snapshot;
  return snapshot;
}

export function assertProviderCapability(run, { providerId, modelId, requests }, now = new Date()) {
  const snapshot = run.providerCapabilities?.[`${providerId}:${modelId}`];
  if (!snapshot) throw new Error(`Probe provider capability before routing generation: ${providerId}/${modelId}.`);
  if (snapshot.status === "unavailable") throw new Error(`Provider route is unavailable: ${providerId}/${modelId}.`);
  if (snapshot.expiresAt && new Date(snapshot.expiresAt) <= now) throw new Error(`Provider capability probe expired for ${providerId}/${modelId}.`);
  const missing = [...new Set(requests.map((request) => request.mode))].filter((mode) => !snapshot.capabilities.includes(mode));
  if (missing.length) throw new Error(`Provider route lacks required capabilities: ${missing.join(", ")}.`);
  return snapshot;
}

export async function writeProviderCapabilitySnapshot({ projectPath, runId, snapshots }) {
  const dir = resolve(projectPath, ".directorx", "plugin-runs", runId, "artifacts");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "provider_capability_snapshot.json");
  await writeFile(path, `${JSON.stringify({ schemaVersion: "1.0", runId, snapshots: Object.values(snapshots) }, null, 2)}\n`, { mode: 0o600 });
  return { artifactRef: "provider_capability_snapshot.json", path };
}
