import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  durableMediaJob,
  listMediaProviders,
  mediaProviderSetup,
  normalizeMediaJob,
  pollMediaGeneration,
  prepareMediaSubmit,
  resolveGeneratedMedia,
  resolveMediaCredential,
  submitMediaGeneration,
  mediaSubmissionRetryPolicy,
  writeGeneratedMedia
} from "./media-provider-gateway.mjs";

test("lists friendly direct and gateway model choices without credentials", () => {
  const providers = listMediaProviders();
  assert.ok(providers.some((provider) => provider.providerId === "openai" && provider.providerKind === "direct"));
  assert.ok(providers.some((provider) => provider.providerId === "fal" && provider.providerKind === "gateway"));
  assert.ok(listMediaProviders({ mediaType: "video", mode: "keyframes_to_video" }).every((provider) => provider.models.every((model) => model.mediaType === "video" && model.modes.includes("keyframes_to_video"))));
  assert.equal(JSON.stringify(providers).includes("test-secret"), false);
});

test("returns setup guidance and resolves only current-process credentials", () => {
  const setup = mediaProviderSetup("openai", "sora-2", "text_to_video", false);
  assert.equal(setup.credentialPolicy, "session_only_not_persisted");
  assert.equal(setup.nextAction, "ask_user_for_key_then_call_directorx_set_session_credential");
  assert.equal(setup.keySetupRequired, true);
  assert.equal(setup.keySetupInteraction.kind, "provider_input");
  assert.equal(setup.keySetupInteraction.questions[0].id, "openai_key_setup");
  assert.equal(setup.keySetupAnswerActions["我已有 Key (Recommended)"][0].type, "focus_canvas_credential");
  const resolved = resolveMediaCredential("openai", new Map([["openai", { envName: "OPENAI_API_KEY" }]]), { OPENAI_API_KEY: "test-secret" });
  assert.deepEqual(resolved, { value: "test-secret", envName: "OPENAI_API_KEY", credentialRef: "session-env:OPENAI_API_KEY" });
  assert.throws(() => resolveMediaCredential("runway", new Map(), {}), /current-session credential/);
});

test("only retries remote submission when the provider has a verified idempotency key", () => {
  assert.equal(mediaSubmissionRetryPolicy("openai"), "provider_idempotency_key");
  assert.equal(mediaSubmissionRetryPolicy("runway"), "manual_reconciliation");
  assert.equal(mediaSubmissionRetryPolicy("custom-provider"), "manual_reconciliation");
});

test("prepares exact first-party and gateway routes", () => {
  assert.deepEqual(prepareMediaSubmit({ providerId: "openai", modelId: "sora-2", mode: "image_to_video", prompt: "move", imageUrls: ["data:image/png;base64,aGVsbG8="] }).multipartFields, {
    model: "sora-2", prompt: "move", seconds: "4", size: "720x1280", input_reference: JSON.stringify({ image_url: "data:image/png;base64,aGVsbG8=" })
  });
  assert.deepEqual(prepareMediaSubmit({ providerId: "google_gemini", modelId: "veo-3.1-generate-preview", mode: "keyframes_to_video", prompt: "bridge", imageUrls: ["data:image/png;base64,aGVsbG8="], endImageUrl: "data:image/png;base64,d29ybGQ=" }).body.instances[0], {
    prompt: "bridge",
    image: { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
    lastFrame: { inlineData: { mimeType: "image/png", data: "d29ybGQ=" } }
  });
  assert.equal(prepareMediaSubmit({ providerId: "fal", modelId: "fal-ai/flux/schnell", mode: "text_to_image", prompt: "frame" }).url, "https://queue.fal.run/fal-ai/flux/schnell");
  assert.deepEqual(prepareMediaSubmit({ providerId: "dashscope", modelId: "wan2.7-i2v", mode: "keyframes_to_video", prompt: "bridge", imageUrls: ["data:image/png;base64,aGVsbG8="], endImageUrl: "data:image/png;base64,d29ybGQ=" }).body.input.media, [
    { type: "first_frame", url: "data:image/png;base64,aGVsbG8=" },
    { type: "last_frame", url: "data:image/png;base64,d29ybGQ=" }
  ]);
  assert.equal(prepareMediaSubmit({ providerId: "volcengine_ark", modelId: "doubao-seedance-2-0-260128", mode: "text_to_video", prompt: "silent visual plate" }).body.generate_audio, false);
  assert.equal(prepareMediaSubmit({ providerId: "volcengine_ark", modelId: "doubao-seedance-2-0-260128", mode: "text_to_video", prompt: "native soundtrack", generateAudio: true }).body.generate_audio, true);
  assert.throws(() => prepareMediaSubmit({ providerId: "replicate", modelId: "../unsafe", mode: "text_to_image", prompt: "frame", allowUnlistedModel: true }), /Unsafe|invalid|catalog/);
});

test("submits synchronous image output and strips base64 from durable job state", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse({ data: [{ b64_json: "aGVsbG8=" }] });
  };
  const job = await submitMediaGeneration({ providerId: "openai", modelId: "gpt-image-1.5", mode: "text_to_image", prompt: "frame", attemptId: "a1", idempotencyKey: "dx-a1" }, { credential: "test-secret", fetchImpl });
  assert.equal(job.status, "succeeded");
  assert.equal(job.inlineAssets[0].base64Data, "aGVsbG8=");
  assert.equal(request.options.headers.authorization, "Bearer test-secret");
  assert.equal(request.options.headers["Idempotency-Key"], "dx-a1");
  assert.equal(JSON.stringify(durableMediaJob(job)).includes("aGVsbG8="), false);
});

test("polls MiniMax and resolves its file URL into local project media", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("query/video_generation")) return jsonResponse({ task_id: "task-1", status: "Success", file_id: "file-1" });
    if (url.includes("files/retrieve")) return jsonResponse({ file: { download_url: "https://cdn.example.com/result.mp4" } });
    if (url === "https://cdn.example.com/result.mp4") return new Response(Buffer.from("video-bytes"), { status: 200, headers: { "content-type": "video/mp4", "content-length": "11" } });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const queued = normalizeMediaJob("minimax", { task_id: "task-1", status: "Queueing" });
  const completed = await pollMediaGeneration(queued, { credential: "test-secret", fetchImpl });
  assert.equal(completed.status, "succeeded");
  const asset = await resolveGeneratedMedia(completed, { credential: "test-secret", fetchImpl });
  assert.equal(Buffer.from(asset.data).toString(), "video-bytes");

  const projectPath = await mkdtemp(join(tmpdir(), "dx-media-provider-"));
  try {
    const written = await writeGeneratedMedia({ projectPath, runId: "run-1", candidateId: "candidate-1", mediaType: "video", asset });
    assert.equal(written.mimeType, "video/mp4");
    assert.equal((await readFile(written.path)).toString(), "video-bytes");
  } finally { await rm(projectPath, { recursive: true, force: true }); }
  assert.deepEqual(calls, [
    "https://api.minimaxi.com/v1/query/video_generation?task_id=task-1",
    "https://api.minimaxi.com/v1/files/retrieve?file_id=file-1",
    "https://cdn.example.com/result.mp4"
  ]);
});

test("requires fal queue URLs and preserves them across status polling", async () => {
  const queued = normalizeMediaJob("fal", { request_id: "req-1", status_url: "https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/status", response_url: "https://queue.fal.run/fal-ai/flux/schnell/requests/req-1" });
  const completed = await pollMediaGeneration(queued, { credential: "test-secret", fetchImpl: async () => jsonResponse({ status: "COMPLETED" }) });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.providerState.resultUrl, queued.providerState.resultUrl);
  assert.throws(() => normalizeMediaJob("fal", { request_id: "req-2" }), /status_url and response_url/);
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
