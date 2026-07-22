import test from "node:test";
import assert from "node:assert/strict";
import { markProviderSubmissionRetry, markProviderSubmissionUncertain, reconcileProviderSubmission, requestProviderJobCancellation, reserveProviderSubmission, submitProviderJob, updateProviderJob } from "./provider-jobs.mjs";

function run() { return { taskTransport: { transport: "provider_job_polling" }, generation: { attempts: [{ requestId: "r1", attemptId: "a1", status: "running" }], providerJobs: [] } }; }

test("reuses an idempotent provider submission and tracks monotonic progress", () => {
  const state = run();
  const input = { requestId: "r1", attemptId: "a1", providerJobId: "job-1", idempotencyKey: "dx:r1:a1" };
  assert.equal(submitProviderJob(state, input).created, true);
  assert.equal(submitProviderJob(state, input).created, false);
  updateProviderJob(state, { providerJobId: "job-1", status: "queued", progress: .1 });
  updateProviderJob(state, { providerJobId: "job-1", status: "running", progress: .5 });
  assert.throws(() => updateProviderJob(state, { providerJobId: "job-1", status: "running", progress: .4 }), /transition|monotonic/);
  assert.throws(() => updateProviderJob(state, { providerJobId: "job-1", status: "succeeded", progress: 1 }), /resultRef/);
  updateProviderJob(state, { providerJobId: "job-1", status: "succeeded", progress: 1, resultRef: "provider://result/1" });
});

test("distinguishes cancellation request from terminal cancellation", () => {
  const state = run(); submitProviderJob(state, { requestId: "r1", attemptId: "a1", providerJobId: "job-1", idempotencyKey: "key" });
  requestProviderJobCancellation(state, "job-1");
  assert.equal(state.generation.providerJobs[0].status, "cancel_requested");
  updateProviderJob(state, { providerJobId: "job-1", status: "cancelled", progress: 0 });
  assert.equal(state.generation.attempts[0].status, "cancelled");
});

test("supports synchronous and queue-to-success provider responses with secret-free routing metadata", () => {
  const synchronous = run();
  submitProviderJob(synchronous, { requestId: "r1", attemptId: "a1", providerJobId: "sync-a1", idempotencyKey: "sync", providerId: "openai", modelId: "gpt-image-1.5", mediaType: "image", mode: "text_to_image", candidateId: "c1", accountedCost: 0.04, credentialRef: "session-env:OPENAI_API_KEY" });
  updateProviderJob(synchronous, { providerJobId: "sync-a1", status: "succeeded", progress: 1, resultRef: "candidate:c1", providerState: { contentUrl: "https://api.openai.com/v1/videos/sync-a1/content" } });
  assert.equal(synchronous.generation.providerJobs[0].providerId, "openai");
  assert.equal(synchronous.generation.providerJobs[0].status, "succeeded");

  const queued = run();
  submitProviderJob(queued, { requestId: "r1", attemptId: "a1", providerJobId: "job-2", idempotencyKey: "queue" });
  updateProviderJob(queued, { providerJobId: "job-2", status: "queued", progress: .05 });
  updateProviderJob(queued, { providerJobId: "job-2", status: "succeeded", progress: 1, resultRef: "candidate:c2" });
  assert.equal(queued.generation.providerJobs[0].status, "succeeded");
});

test("persists a provider submission before the remote job id exists and reconciles it once", () => {
  const state = run();
  const reserved = reserveProviderSubmission(state, {
    submissionId: "submission:1", requestId: "r1", attemptId: "a1", idempotencyKey: "dx:r1:a1",
    submitRetryPolicy: "provider_idempotency_key", providerId: "openai", modelId: "gpt-image-1.5",
    mediaType: "image", mode: "text_to_image", candidateId: "c1", accountedCost: 0.04,
    credentialRef: "session-env:OPENAI_API_KEY"
  }, "2026-07-22T00:00:00.000Z");
  assert.equal(reserved.created, true);
  assert.equal(reserved.job.status, "submission_pending");
  assert.equal(reserved.job.providerJobId, null);
  assert.equal(state.generation.attempts[0].providerSubmissionId, "submission:1");

  const reconciled = reconcileProviderSubmission(state, {
    submissionId: "submission:1", providerJobId: "job-1", providerState: { pollUrl: "https://api.openai.com/v1/jobs/job-1" }
  }, "2026-07-22T00:00:01.000Z");
  assert.equal(reconciled.reconciled, true);
  assert.equal(reconciled.job.status, "submitted");
  assert.equal(reconciled.job.submissionOutcome, "confirmed");
  assert.equal(state.generation.attempts[0].providerJobId, "job-1");
  assert.equal(reconcileProviderSubmission(state, { submissionId: "submission:1", providerJobId: "job-1" }).reconciled, false);
  assert.throws(() => reconcileProviderSubmission(state, { submissionId: "submission:1", providerJobId: "job-other" }), /already bound/);
});

test("retries only verified idempotent submissions and blocks unsafe duplicate billing", () => {
  const safe = run();
  reserveProviderSubmission(safe, { submissionId: "submission:safe", requestId: "r1", attemptId: "a1", idempotencyKey: "safe", submitRetryPolicy: "provider_idempotency_key", providerId: "openai" });
  markProviderSubmissionUncertain(safe, "submission:safe", new Error("timeout"));
  assert.equal(safe.generation.providerJobs[0].submissionOutcome, "unknown");
  markProviderSubmissionRetry(safe, "submission:safe");
  assert.equal(safe.generation.providerJobs[0].submissionAttempts, 2);

  const unsafe = run();
  reserveProviderSubmission(unsafe, { submissionId: "submission:unsafe", requestId: "r1", attemptId: "a1", idempotencyKey: "unsafe", submitRetryPolicy: "manual_reconciliation", providerId: "runway" });
  markProviderSubmissionUncertain(unsafe, "submission:unsafe", new Error("network reset"));
  assert.throws(() => markProviderSubmissionRetry(unsafe, "submission:unsafe"), /no verified idempotency-key retry/);
  assert.equal(unsafe.generation.providerJobs[0].submissionAttempts, 1);
});
