import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCaptionTrack, parseCaptionText } from "./caption-import.mjs";

test("parses SRT and WebVTT cues into rational milliseconds", () => {
  const srt = parseCaptionText("1\n00:00:01,200 --> 00:00:03,040\n你好\n", "srt");
  assert.deepEqual(srt[0].range, { start: { value: 1200, rate: 1000 }, duration: { value: 1840, rate: 1000 } });
  const vtt = parseCaptionText("WEBVTT\n\ncue-a\n00:01.000 --> 00:02.500 align:center\nHello", "vtt");
  assert.equal(vtt[0].text, "Hello");
});

test("imports only project-contained caption files", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "directorx-caption-"));
  await writeFile(join(projectPath, "captions.vtt"), "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n");
  const track = await importCaptionTrack({ projectPath, captionPath: "captions.vtt", trackId: "sub-en", language: "en" });
  assert.equal(track.cues.length, 1);
  await assert.rejects(() => importCaptionTrack({ projectPath, captionPath: "../outside.srt", trackId: "x", language: "en" }), /inside/);
});
