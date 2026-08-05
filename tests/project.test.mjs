import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
