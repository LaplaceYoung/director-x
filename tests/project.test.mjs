import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  addCanvasObject,
  initProject,
  readCanvas,
  updateObjectPosition
} from "../scripts/lib/project.mjs";
import { doctorMediaTools, inspectMediaTool } from "../scripts/lib/media-tools.mjs";
import { composeRemotionProject } from "../scripts/lib/remotion-project.mjs";
import {
  buildShotRanges,
  colorSystemSvg,
  extractDominantColors,
  parseSceneCutTimes
} from "../scripts/lib/video-analysis.mjs";
import {
  configureProvider,
  doctorProvider,
  listProviders
} from "../scripts/lib/provider-profiles.mjs";
import { requestProvider } from "../scripts/lib/provider-request.mjs";
import {
  addGenerationPlaceholder,
  buildGenerationPlaceholder
} from "../scripts/lib/generation-placeholders.mjs";

test("initializes a canvas and stores only supported content objects", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-"));
  const canvas = await initProject(projectPath);
  assert.deepEqual(canvas.objects, []);

  const mediaRoot = join(projectPath, ".directorx", "media");
  await mkdir(mediaRoot, { recursive: true });
  const imagePath = join(mediaRoot, "frame.jpg");
  await writeFile(imagePath, "test");

  const image = await addCanvasObject(projectPath, {
    type: "image",
    title: "Reference frame",
    path: imagePath
  });
  const text = await addCanvasObject(projectPath, {
    type: "text",
    title: "Storyboard",
    text: "Shot 1"
  });

  assert.equal(image.type, "image");
  assert.equal(text.type, "text");
  assert.equal((await readCanvas(projectPath)).objects.length, 2);
});

test("persists canvas positions", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-"));
  const object = await addCanvasObject(projectPath, {
    type: "text",
    text: "Move me"
  });
  await updateObjectPosition(projectPath, object.id, { x: 420, y: 240 });
  const [stored] = (await readCanvas(projectPath)).objects;
  assert.equal(stored.x, 420);
  assert.equal(stored.y, 240);
});

test("rejects unsupported canvas object types", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-"));
  await assert.rejects(
    addCanvasObject(projectPath, { type: "workflow", text: "No" }),
    /Unsupported canvas object type/
  );
});

test("adds a generation placeholder with prompt, model recommendations, and specs", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-placeholder-"));
  const object = await addGenerationPlaceholder(projectPath, {
    modality: "video",
    title: "Shot 03 — rooftop reveal",
    prompt: "Opening on the product silhouette, the camera slowly cranes upward as the skyline appears.",
    aspectRatio: "16:9",
    needs: "camera,identity,audio,multishot",
    durationSeconds: 6,
    resolution: "1080p",
    fps: 24
  });

  assert.equal(object.type, "text");
  assert.equal(object.metadata.kind, "generation-placeholder");
  assert.equal(object.metadata.status, "awaiting-generation-access");
  assert.equal(object.metadata.desiredSpecs.durationSeconds, 6);
  assert.equal(object.metadata.recommendations[0].model, "Kling 3.0 / Kling Omni family");
  assert.equal(object.metadata.recommendations[1].model, "Seedance 2.5 family");
  const veo = object.metadata.recommendations.find((item) => item.model === "veo-3.1-generate-001");
  const sora = object.metadata.recommendations.find((item) => item.model === "sora-2");
  assert.equal(veo.specs.durationSeconds, 6);
  assert.equal(sora.specs.durationSeconds, 8);
  assert.match(object.text, /WAITING FOR GENERATION ACCESS/);
  assert.match(object.text, /RECOMMENDED ROUTES/);
  assert.match(object.text, /do not silently switch to Remotion/i);
});

test("considers Happy Horse only as an unverified need-matched candidate", () => {
  const placeholder = buildGenerationPlaceholder({
    modality: "video",
    prompt: "Use a local open-source audiovisual model for this image-to-video shot.",
    needs: "open-source,experimental,audio"
  });
  const happyHorse = placeholder.recommendations.find((item) => item.provider === "Happy Horse");
  assert.ok(happyHorse);
  assert.equal(happyHorse.docsUrl, null);
  assert.match(happyHorse.status, /unverified candidate/);
});

test("recommends Seedream routes for matching image-generation needs", () => {
  const placeholder = buildGenerationPlaceholder({
    modality: "image",
    prompt: "Create a 4K multi-reference character keyframe with exact poster text.",
    needs: "4k,multi-reference,identity,text"
  });
  assert.equal(placeholder.recommendations[0].model, "Seedream 4.0");
  assert.ok(placeholder.recommendations.some((item) => item.model === "Seedream 5.0 Lite"));
});

test("validates generation placeholder inputs", () => {
  assert.throws(
    () => buildGenerationPlaceholder({ modality: "audio", prompt: "Test" }),
    /modality must be image or video/
  );
  assert.throws(
    () => buildGenerationPlaceholder({ modality: "video", prompt: "Test", aspectRatio: "1:1" }),
    /support 16:9 or 9:16/
  );
  assert.throws(
    () => buildGenerationPlaceholder({ modality: "image" }),
    /prompt is required/
  );
});

test("media tools prefer explicit environment configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "directorx-tools-"));
  const toolPath = join(root, "ffmpeg");
  await writeFile(toolPath, "#!/bin/sh\necho custom-ffmpeg\n");
  await chmod(toolPath, 0o755);

  const result = await inspectMediaTool("ffmpeg", {
    env: { DIRECTORX_FFMPEG: toolPath, PATH: "" },
    pluginRoot: root,
    homeDir: root
  });

  assert.equal(result.available, true);
  assert.equal(result.path, toolPath);
  assert.equal(result.source, "environment");
});

test("media doctor reports managed tool availability without installing anything", async () => {
  const root = await mkdtemp(join(tmpdir(), "directorx-doctor-"));
  const runtimeRoot = join(root, "runtime", "bin", `${process.platform}-${process.arch}`);
  await mkdir(runtimeRoot, { recursive: true });
  for (const name of ["ffmpeg", "ffprobe"]) {
    const toolPath = join(runtimeRoot, name);
    await writeFile(toolPath, `#!/bin/sh\necho ${name}-test\n`);
    await chmod(toolPath, 0o755);
  }

  const result = await doctorMediaTools({
    env: { PATH: "" },
    pluginRoot: root,
    homeDir: root
  });

  assert.equal(result.ok, true);
  assert.equal(result.tools.ffmpeg.source, "plugin-runtime");
  assert.equal(result.tools.ffprobe.source, "plugin-runtime");
  assert.equal(result.tools["yt-dlp"].available, false);
});

test("media tools resolve packaged dependencies and the macOS universal yt-dlp", async () => {
  const root = await mkdtemp(join(tmpdir(), "directorx-packaged-tools-"));
  const ffmpegPackage = join(root, "node_modules", "ffmpeg-static");
  const runtimeRoot = join(root, "runtime", "bin", "darwin-universal");
  await Promise.all([
    mkdir(ffmpegPackage, { recursive: true }),
    mkdir(runtimeRoot, { recursive: true })
  ]);
  const ffmpegPath = join(ffmpegPackage, "ffmpeg");
  const ytdlpPath = join(runtimeRoot, "yt-dlp");
  await writeFile(join(root, "package.json"), "{\"type\":\"module\"}\n");
  await writeFile(
    join(ffmpegPackage, "package.json"),
    "{\"name\":\"ffmpeg-static\",\"main\":\"index.cjs\"}\n"
  );
  await writeFile(join(ffmpegPackage, "index.cjs"), `module.exports = ${JSON.stringify(ffmpegPath)};\n`);
  await writeFile(ffmpegPath, "#!/bin/sh\necho ffmpeg-packaged\n");
  await writeFile(ytdlpPath, "#!/bin/sh\necho yt-dlp-packaged\n");
  await Promise.all([chmod(ffmpegPath, 0o755), chmod(ytdlpPath, 0o755)]);

  const ffmpeg = await inspectMediaTool("ffmpeg", {
    env: { PATH: "" },
    pluginRoot: root,
    homeDir: root
  });
  const ytdlp = await inspectMediaTool("yt-dlp", {
    env: { PATH: "" },
    pluginRoot: root,
    homeDir: root,
    platform: "darwin",
    arch: "arm64"
  });

  assert.equal(ffmpeg.path, ffmpegPath);
  assert.equal(ffmpeg.source, "plugin-dependency");
  assert.equal(ytdlp.path, ytdlpPath);
  assert.equal(ytdlp.source, "plugin-runtime");
});

test("builds a minimal Remotion spec from canvas media and text", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-remotion-"));
  const mediaRoot = join(projectPath, ".directorx", "media");
  await mkdir(mediaRoot, { recursive: true });
  const imagePath = join(mediaRoot, "cover.jpg");
  await writeFile(imagePath, "test");
  await addCanvasObject(projectPath, {
    type: "image",
    title: "Cover",
    path: imagePath
  });
  await addCanvasObject(projectPath, {
    type: "text",
    title: "Title",
    text: "Hello Director X"
  });
  await addGenerationPlaceholder(projectPath, {
    modality: "video",
    title: "Future generated shot",
    prompt: "A generated shot that must not appear in the Remotion fallback."
  });
  await addCanvasObject(projectPath, {
    type: "video",
    title: "Old preview",
    path: imagePath,
    metadata: { renderer: "remotion", quality: "preview" }
  });

  const result = await composeRemotionProject(projectPath, {
    width: 641,
    height: 359,
    fps: 24,
    secondsPerItem: 2
  });

  assert.equal(result.spec.width, 642);
  assert.equal(result.spec.height, 360);
  assert.equal(result.spec.durationInFrames, 96);
  assert.equal(result.spec.clips.length, 2);
  assert.equal(result.spec.clips[0].src, "media/000-cover.jpg");
});

test("parses scene cuts and builds continuous shot ranges", () => {
  const cuts = parseSceneCutTimes([
    "showinfo pts_time:1.250",
    "showinfo pts_time:3.5",
    "showinfo pts_time:3.500"
  ].join("\n"));
  const shots = buildShotRanges(5, cuts);

  assert.deepEqual(cuts, [1.25, 3.5]);
  assert.deepEqual(
    shots.map((shot) => [shot.startSeconds, shot.endSeconds]),
    [[0, 1.25], [1.25, 3.5], [3.5, 5]]
  );
  assert.equal(shots[1].representativeSeconds, 2.375);
});

test("extracts a compact color system and renders an SVG card", () => {
  const pixels = Buffer.from([
    240, 80, 40,
    242, 82, 42,
    20, 24, 30,
    21, 25, 31,
    50, 120, 200
  ]);
  const colors = extractDominantColors(pixels, 3);
  const svg = colorSystemSvg("Reference & palette", colors);

  assert.equal(colors.length, 3);
  assert.equal(colors[0].role, "dominant");
  assert.match(svg, /Reference &amp; palette/);
  assert.match(svg, /<svg/);
});

test("stores provider metadata without storing credentials", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-provider-"));
  const profile = await configureProvider(projectPath, {
    id: "example-image",
    provider: "Example",
    modality: "image",
    model: "image-v1",
    docsUrl: "https://example.com/docs",
    endpoint: "https://api.example.com/images",
    authHeader: "Authorization",
    authScheme: "bearer",
    authEnv: "EXAMPLE_API_KEY"
  });

  assert.equal(profile.id, "example-image");
  assert.equal((await listProviders(projectPath)).length, 1);
  const contents = await readFile(join(projectPath, ".directorx", "providers.json"), "utf8");
  assert.doesNotMatch(contents, /actual-secret/);

  const missing = await doctorProvider(projectPath, profile.id, { env: {} });
  const available = await doctorProvider(projectPath, profile.id, {
    env: { EXAMPLE_API_KEY: "actual-secret" }
  });
  assert.equal(missing.credentialAvailable, false);
  assert.equal(available.credentialAvailable, true);
  assert.equal(available.readyForAdapter, true);
  assert.doesNotMatch(JSON.stringify(available), /actual-secret/);
});

test("rejects provider secrets and insecure documentation URLs", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-provider-"));
  await assert.rejects(
    configureProvider(projectPath, {
      id: "unsafe",
      provider: "Unsafe",
      modality: "video",
      model: "video-v1",
      docsUrl: "http://example.com/docs",
      authEnv: "UNSAFE_API_KEY"
    }),
    /must use HTTPS/
  );
  await assert.rejects(
    configureProvider(projectPath, {
      id: "unsafe",
      provider: "Unsafe",
      modality: "video",
      model: "video-v1",
      docsUrl: "https://example.com/docs",
      authEnv: "UNSAFE_API_KEY",
      apiKey: "actual-secret"
    }),
    /Do not pass apiKey/
  );
});

test("sends an approved provider request without persisting credentials", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-provider-request-"));
  await configureProvider(projectPath, {
    id: "example-image",
    provider: "Example",
    modality: "image",
    model: "image-v1",
    docsUrl: "https://example.com/docs",
    endpoint: "https://api.example.com/images",
    authHeader: "X-Api-Key",
    authScheme: "raw",
    authEnv: "EXAMPLE_API_KEY"
  });
  let received;
  const result = await requestProvider(projectPath, {
    id: "example-image",
    approved: true,
    body: { model: "image-v1", prompt: "A red paper kite" },
    env: { EXAMPLE_API_KEY: "actual-secret" },
    fetchImpl: async (url, options) => {
      received = { url, options };
      return new Response(Buffer.from("fake-png"), {
        status: 200,
        headers: { "Content-Type": "image/png" }
      });
    }
  });

  assert.equal(received.url, "https://api.example.com/images");
  assert.equal(received.options.headers["X-Api-Key"], "actual-secret");
  assert.equal(result.ok, true);
  assert.match(result.responsePath, /\.png$/);
  const state = await readFile(join(projectPath, result.recordPath), "utf8");
  const request = await readFile(join(projectPath, result.requestPath), "utf8");
  assert.doesNotMatch(state, /actual-secret/);
  assert.doesNotMatch(request, /actual-secret/);
  assert.equal((await readCanvas(projectPath)).objects.at(-1).type, "image");
});

test("blocks unapproved, credential-bearing, and cross-origin provider requests", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-provider-request-"));
  await configureProvider(projectPath, {
    id: "example-video",
    provider: "Example",
    modality: "video",
    model: "video-v1",
    docsUrl: "https://example.com/docs",
    endpoint: "https://api.example.com/videos",
    authHeader: "Authorization",
    authScheme: "bearer",
    authEnv: "EXAMPLE_API_KEY"
  });
  const base = {
    id: "example-video",
    env: { EXAMPLE_API_KEY: "actual-secret" },
    fetchImpl: async () => {
      throw new Error("must not fetch");
    }
  };
  await assert.rejects(requestProvider(projectPath, base), /explicit user approval/);
  await assert.rejects(
    requestProvider(projectPath, {
      ...base,
      approved: true,
      body: { api_key: "inline-secret" }
    }),
    /must not contain credentials/
  );
  await assert.rejects(
    requestProvider(projectPath, {
      ...base,
      approved: true,
      method: "GET",
      endpoint: "https://attacker.example/jobs/1"
    }),
    /configured origin/
  );
  await assert.rejects(
    requestProvider(projectPath, {
      ...base,
      approved: true,
      method: "GET",
      endpoint: "https://api.example.com/jobs/1?access_token=inline-secret"
    }),
    /credential query parameters/
  );
});

test("redacts a credential echoed by a provider error", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-provider-redaction-"));
  await configureProvider(projectPath, {
    id: "example-image",
    provider: "Example",
    modality: "image",
    model: "image-v1",
    docsUrl: "https://example.com/docs",
    endpoint: "https://api.example.com/images",
    authHeader: "X-Api-Key",
    authScheme: "raw",
    authEnv: "EXAMPLE_API_KEY"
  });
  const result = await requestProvider(projectPath, {
    id: "example-image",
    approved: true,
    body: { prompt: "test" },
    env: { EXAMPLE_API_KEY: "actual-secret" },
    fetchImpl: async () => new Response(
      JSON.stringify({ error: "rejected actual-secret" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    )
  });
  const response = await readFile(join(projectPath, result.responsePath), "utf8");
  assert.doesNotMatch(response, /actual-secret/);
  assert.match(response, /\[REDACTED\]/);
});
