import { requireTaskTransport } from "./task-transport.mjs";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const TRANSITIONS = {
  submitted: new Set(["queued", "running", "input_required", "succeeded", "failed", "cancel_requested", "cancelled"]),
  queued: new Set(["running", "input_required", "succeeded", "failed", "cancel_requested", "cancelled"]),
  running: new Set(["input_required", "succeeded", "failed", "cancel_requested", "cancelled"]),
  input_required: new Set(["queued", "running", "succeeded", "failed", "cancel_requested"]),
  cancel_requested: new Set(["cancelled", "succeeded", "failed"])
};

export function reserveProviderSubmission(run, input, now = new Date().toISOString()) {
  const taskTransport = requireTaskTransport(run);
  const generation = requireGeneration(run);
  const attempt = generation.attempts.find((item) => item.attemptId === input.attemptId && item.requestId === input.requestId);
  if (!attempt || attempt.status !== "running") throw new Error("Reserve a provider submission only for an active generation attempt.");
  generation.providerJobs ??= [];
  const duplicate = generation.providerJobs.find((job) => job.idempotencyKey === input.idempotencyKey);
  if (duplicate) {
    if (duplicate.requestId !== input.requestId || duplicate.attemptId !== input.attemptId) throw new Error("Idempotency key already belongs to another attempt.");
    return { job: duplicate, created: false };
  }
  if (generation.providerJobs.some((job) => job.submissionId === input.submissionId)) throw new Error(`Duplicate provider submission ID: ${input.submissionId}`);
  const job = {
    submissionId: input.submissionId, providerJobId: null,
    requestId: input.requestId, attemptId: input.attemptId, idempotencyKey: input.idempotencyKey,
    status: "submission_pending", progress: 0, submissionOutcome: "pending",
    submitRetryPolicy: input.submitRetryPolicy, submissionAttempts: 1,
    reservedAt: now, submittedAt: null, updatedAt: now, lastSubmitStartedAt: now,
    lastSubmissionError: null, lastPolledAt: null, inputRequest: null,
    resultRef: null, error: null, cancelRequestedAt: null, terminalAt: null,
    providerId: input.providerId ?? null, modelId: input.modelId ?? null,
    mediaType: input.mediaType ?? null, mode: input.mode ?? null,
    candidateId: input.candidateId ?? null, accountedCost: input.accountedCost ?? null,
    providerState: {}, resultUrls: [], credentialRef: input.credentialRef ?? null,
    transport: taskTransport.transport
  };
  generation.providerJobs.push(job);
  attempt.providerSubmissionId = input.submissionId;
  return { job, created: true };
}

export function markProviderSubmissionRetry(run, submissionId, now = new Date().toISOString()) {
  const job = findSubmission(run, submissionId);
  if (job.status !== "submission_pending") throw new Error(`Provider submission ${submissionId} is already reconciled.`);
  if (job.submitRetryPolicy !== "provider_idempotency_key") throw new Error("Provider submission outcome is unknown and this provider has no verified idempotency-key retry; inspect the provider dashboard before reconciling or retrying.");
  job.submissionAttempts += 1;
  job.lastSubmitStartedAt = now;
  job.updatedAt = now;
  return job;
}

export function markProviderSubmissionUncertain(run, submissionId, error, now = new Date().toISOString()) {
  const job = findSubmission(run, submissionId);
  if (job.status !== "submission_pending") return job;
  job.submissionOutcome = "unknown";
  job.lastSubmissionError = { code: "provider_submission_unknown", message: String(error?.message ?? error).slice(0, 1_000) };
  job.updatedAt = now;
  return job;
}

export function reconcileProviderSubmission(run, input, now = new Date().toISOString()) {
  const job = findSubmission(run, input.submissionId);
  if (job.providerJobId) {
    if (job.providerJobId !== input.providerJobId) throw new Error(`Provider submission ${input.submissionId} is already bound to ${job.providerJobId}.`);
    return { job, reconciled: false };
  }
  if (run.generation.providerJobs.some((candidate) => candidate !== job && candidate.providerJobId === input.providerJobId)) throw new Error(`Duplicate provider job ID: ${input.providerJobId}`);
  job.providerJobId = input.providerJobId;
  job.status = "submitted";
  job.submissionOutcome = "confirmed";
  job.submittedAt = now;
  job.updatedAt = now;
  job.lastSubmissionError = null;
  job.providerState = input.providerState ?? {};
  job.resultUrls = input.resultUrls ?? [];
  const attempt = run.generation.attempts.find((item) => item.attemptId === job.attemptId && item.requestId === job.requestId);
  if (attempt) attempt.providerJobId = input.providerJobId;
  return { job, reconciled: true };
}

export function submitProviderJob(run, input, now = new Date().toISOString()) {
  const taskTransport = requireTaskTransport(run);
  const generation = requireGeneration(run);
  const attempt = generation.attempts.find((item) => item.attemptId === input.attemptId && item.requestId === input.requestId);
  if (!attempt || attempt.status !== "running") throw new Error("Submit a provider job only for an active generation attempt.");
  generation.providerJobs ??= [];
  const duplicate = generation.providerJobs.find((job) => job.idempotencyKey === input.idempotencyKey);
  if (duplicate) {
    if (duplicate.requestId !== input.requestId || duplicate.attemptId !== input.attemptId) throw new Error("Idempotency key already belongs to another attempt.");
    return { job: duplicate, created: false };
  }
  if (generation.providerJobs.some((job) => job.providerJobId === input.providerJobId)) throw new Error(`Duplicate provider job ID: ${input.providerJobId}`);
  const job = {
    providerJobId: input.providerJobId, requestId: input.requestId, attemptId: input.attemptId,
    idempotencyKey: input.idempotencyKey, status: "submitted", progress: 0,
    submittedAt: now, updatedAt: now, lastPolledAt: null, inputRequest: null,
    resultRef: null, error: null, cancelRequestedAt: null, terminalAt: null,
    providerId: input.providerId ?? null, modelId: input.modelId ?? null,
    mediaType: input.mediaType ?? null, mode: input.mode ?? null,
    candidateId: input.candidateId ?? null, accountedCost: input.accountedCost ?? null,
    providerState: input.providerState ?? {}, resultUrls: input.resultUrls ?? [],
    credentialRef: input.credentialRef ?? null
  };
  job.transport = taskTransport.transport;
  generation.providerJobs.push(job);
  attempt.providerJobId = input.providerJobId;
  return { job, created: true };
}

export function updateProviderJob(run, input, now = new Date().toISOString()) {
  const job = findJob(run, input.providerJobId);
  if (TERMINAL.has(job.status)) {
    if (job.status === input.status) return job;
    throw new Error(`Provider job ${job.providerJobId} is already terminal: ${job.status}.`);
  }
  if (input.status !== job.status && !TRANSITIONS[job.status]?.has(input.status)) throw new Error(`Invalid provider job transition: ${job.status} -> ${input.status}.`);
  if (!Number.isFinite(input.progress) || input.progress < job.progress || input.progress > 1) throw new Error("Provider job progress must be monotonic between 0 and 1.");
  if (input.status === "input_required" && !input.inputRequest?.instruction) throw new Error("input_required must include a user-facing instruction.");
  if (input.status === "succeeded" && (input.progress !== 1 || !input.resultRef)) throw new Error("A succeeded provider job requires progress 1 and a resultRef.");
  if (input.status === "failed" && !input.error?.code) throw new Error("A failed provider job requires a stable error code.");
  job.status = input.status; job.progress = input.progress; job.updatedAt = now; job.lastPolledAt = now;
  job.inputRequest = input.status === "input_required" ? input.inputRequest : null;
  job.resultRef = input.resultRef ?? job.resultRef;
  job.error = input.error ?? null;
  if (input.providerState) job.providerState = input.providerState;
  if (input.resultUrls) job.resultUrls = input.resultUrls;
  if (input.status === "cancel_requested") job.cancelRequestedAt = now;
  if (TERMINAL.has(input.status)) job.terminalAt = now;
  const attempt = run.generation.attempts.find((item) => item.attemptId === job.attemptId);
  if (input.status === "failed" || input.status === "cancelled") { attempt.status = input.status; attempt.completedAt = now; }
  return job;
}

export function requestProviderJobCancellation(run, providerJobId, now = new Date().toISOString()) {
  const job = findJob(run, providerJobId);
  if (TERMINAL.has(job.status)) throw new Error(`Cannot cancel terminal provider job: ${job.status}.`);
  return updateProviderJob(run, { providerJobId, status: "cancel_requested", progress: job.progress }, now);
}

export function providerJobArtifact(runId, generation) {
  return { schemaVersion: "1.0", runId, jobs: generation.providerJobs ?? [] };
}

function findJob(run, id) { const job = run.generation?.providerJobs?.find((item) => item.providerJobId === id); if (!job) throw new Error(`Unknown provider job: ${id}`); return job; }
function findSubmission(run, id) { const job = run.generation?.providerJobs?.find((item) => item.submissionId === id); if (!job) throw new Error(`Unknown provider submission: ${id}`); return job; }
function requireGeneration(run) { if (!run.generation) throw new Error("Register a generation plan first."); return run.generation; }
