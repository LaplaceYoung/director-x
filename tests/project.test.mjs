import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  addCanvasObject,
  initProject,
  readCanvas,
  updateObjectPosition
} from "../scripts/lib/project.mjs";

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
