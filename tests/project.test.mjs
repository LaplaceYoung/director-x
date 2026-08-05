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
