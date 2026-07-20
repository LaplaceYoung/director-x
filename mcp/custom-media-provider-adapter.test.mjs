import test from "node:test";
import assert from "node:assert/strict";
import {
  customAuthHeaders,
  customProviderIntake,
  customProviderSetup,
  normalizeCustomMediaJob,
  prepareCustomMediaSubmit,
  registerCustomMediaProviderAdapter,
  validateCustomMediaProviderAdapter
} from "./custom-media-provider-adapter.mjs";
import { getMediaProvider, listMediaProviders, prepareMediaSubmit } from "./media-provider-gateway.mjs";

function adapter(overrides = {}) {
  return {
    providerId: "custom.acme-video",
    displayName: "Acme Video",
    providerKind: "direct",
    model: {
      modelId: "acme-video-v2",
      displayName: "Acme Video V2",
      mediaType: "video",
      modes: ["text_to_video", "keyframes_to_video"],
      supports: { firstLastFrame: true }
    },
    api: {
      baseUrl: "https://api.acme.example/v1",
      protocol: "json_async_poll",
      submitPath: "/generations",
      pollPath: "/tasks/{jobId}",
      pollingIntervalMs: 4000,
      headers: { "X-API-Version": "2026-07-01" }
    },
    auth: {
      scheme: "bearer",
      headerName: "Authorization",
      prefix: "Bearer",
      credentialEnv: "ACME_VIDEO_API_KEY"
    },
    setupUrl: "https://console.acme.example/api-keys",
    docs: {
      sources: [{
        sourceId: "acme-video-api",
        url: "https://docs.acme.example/video-api",
        sourceType: "official_api_docs",
        verificationStatus: "verified",
        observedAt: "2026-07-16T00:00:00.000Z",
        evidenceSummary: "Official submit, poll, auth, request and response fields."
      }],
      hostExecutions: [{ action: "search", tool: "web.search_query" }, { action: "open", tool: "web.open" }]
    },
    request: {
      defaults: { input: {}, options: {} },
      fieldMap: {
        modelId: "model",
        prompt: "input.prompt",
        imageUrls: "input.keyframes",
        durationSeconds: "options.duration",
        aspectRatio: "options.aspect_ratio"
      }
    },
    response: {
      jobIdPath: "task.id",
      statusPath: "task.status",
      progressPath: "task.progress",
      errorMessagePath: "task.error.message",
      resultUrlPaths: ["task.output.video_url"],
      statusMap: { waiting: "queued", processing: "running", complete: "succeeded", error: "failed" }
    },
    ...overrides
  };
}

test("returns native provider and exact-model intake before custom adaptation", () => {
  const intake = customProviderIntake("video");
  assert.equal(intake.interaction.kind, "provider_input");
  assert.equal(intake.interaction.questions.length, 2);
  assert.equal(intake.interaction.questions[0].id, "video_provider_name");
  assert.equal(intake.interaction.questions[1].id, "video_model_name");
  assert.equal(intake.researchContract.sourcePolicy, "official_api_docs_only");
  assert.deepEqual(intake.researchContract.requiredHostActions, ["web.search_query", "web.open"]);
});

test("registers and compiles an official-doc declarative provider without executable code", () => {
  const registered = registerCustomMediaProviderAdapter(adapter());
  const prepared = prepareCustomMediaSubmit(registered, {
    providerId: registered.providerId,
    modelId: registered.model.modelId,
    mode: "keyframes_to_video",
    prompt: "A controlled camera move",
    imageUrls: ["https://assets.example/first.png", "https://assets.example/last.png"],
    durationSeconds: 8,
    aspectRatio: "16:9"
  });
  assert.equal(prepared.url, "https://api.acme.example/v1/generations");
  assert.deepEqual(prepared.body, {
    input: {
      prompt: "A controlled camera move",
      keyframes: ["https://assets.example/first.png", "https://assets.example/last.png"]
    },
    options: { duration: 8, aspect_ratio: "16:9" },
    model: "acme-video-v2"
  });
  assert.deepEqual(customAuthHeaders(registered, "session-secret"), {
    accept: "application/json",
    "content-type": "application/json",
    Authorization: "Bearer session-secret"
  });
});

test("exposes registered custom providers through the normal media gateway", () => {
  registerCustomMediaProviderAdapter(adapter({ providerId: "custom.acme-gateway" }));
  assert.equal(getMediaProvider("custom.acme-gateway").models[0].modelId, "acme-video-v2");
  assert.ok(listMediaProviders({ mediaType: "video", mode: "keyframes_to_video" }).some((entry) => entry.providerId === "custom.acme-gateway"));
  const prepared = prepareMediaSubmit({
    providerId: "custom.acme-gateway",
    modelId: "acme-video-v2",
    mode: "text_to_video",
    prompt: "Shanghai at dawn"
  });
  assert.equal(prepared.body.input.prompt, "Shanghai at dawn");
  assert.equal(prepared.body.model, "acme-video-v2");
});

test("normalizes async status and returns a native secure key setup", () => {
  const registered = validateCustomMediaProviderAdapter(adapter());
  const queued = normalizeCustomMediaJob(registered, { task: { id: "job-7", status: "processing", progress: 31 } });
  assert.equal(queued.providerJobId, "job-7");
  assert.equal(queued.status, "running");
  assert.equal(queued.progress, 0.31);
  assert.equal(queued.providerState.pollUrl, "https://api.acme.example/v1/tasks/job-7");
  const done = normalizeCustomMediaJob(registered, { task: { id: "job-7", status: "complete", output: { video_url: "https://cdn.acme.example/out.mp4" } } });
  assert.equal(done.status, "succeeded");
  assert.deepEqual(done.resultUrls, ["https://cdn.acme.example/out.mp4"]);

  const setup = customProviderSetup(registered, false);
  assert.equal(setup.keySetupRequired, true);
  assert.equal(setup.keySetupInteraction.kind, "provider_input");
  assert.equal(setup.keySetupInteraction.questions[0].options[0].label, "我已有 Key (Recommended)");
  assert.equal(setup.keySetupAnswerActions["我已有 Key (Recommended)"][0].type, "focus_canvas_credential");
  assert.equal(setup.keySetupAnswerActions["前往供应商控制台"][0].keepProductionCanvas, true);
});

test("supports synchronous inline image JSON without exposing executable adapter code", () => {
  const inline = validateCustomMediaProviderAdapter(adapter({
    providerId: "custom.acme-image",
    model: { modelId: "acme-image", displayName: "Acme Image", mediaType: "image", modes: ["text_to_image"], supports: {} },
    api: { ...adapter().api, protocol: "json_sync", submitPath: "/images", pollPath: undefined },
    response: {
      jobIdPath: "id",
      statusPath: "status",
      resultUrlPaths: [],
      inlineBase64Paths: ["data.0.b64"],
      inlineMimeType: "image/png",
      statusMap: {}
    }
  }));
  const result = normalizeCustomMediaJob(inline, { id: "image-1", data: [{ b64: "aGVsbG8=" }] });
  assert.equal(result.status, "succeeded");
  assert.equal(result.inlineAssets[0].mimeType, "image/png");
  assert.equal(result.inlineAssets[0].base64Data, "aGVsbG8=");
});

test("rejects unsafe origins, arbitrary request fields, and unverifiable docs", () => {
  assert.throws(() => validateCustomMediaProviderAdapter(adapter({
    api: { ...adapter().api, baseUrl: "http://127.0.0.1:8080" }
  })), /credential-free HTTPS origin|local or private/);
  assert.throws(() => validateCustomMediaProviderAdapter(adapter({
    request: { defaults: {}, fieldMap: { modelId: "model", prompt: "prompt", apiKey: "auth.key" } }
  })), /source field is not allowed/);
  assert.throws(() => validateCustomMediaProviderAdapter(adapter({
    docs: { ...adapter().docs, sources: [{ ...adapter().docs.sources[0], verificationStatus: "claimed" }] }
  })), /verified official_api_docs/);
  assert.throws(() => validateCustomMediaProviderAdapter(adapter({
    auth: { ...adapter().auth, headerName: "Cookie", prefix: "" }
  })), /headerName is not allowed/);
});
