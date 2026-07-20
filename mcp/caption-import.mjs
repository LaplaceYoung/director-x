import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

export async function importCaptionTrack(input) {
  const path = containedPath(input.projectPath, input.captionPath);
  const details = await stat(path);
  if (!details.isFile() || details.size <= 0 || details.size > 5_000_000) throw new Error("Caption input must be a non-empty project file no larger than 5 MB.");
  const extension = extname(path).toLowerCase();
  if (![".srt", ".vtt"].includes(extension)) throw new Error("Caption input must be .srt or .vtt.");
  const source = (await readFile(path, "utf8")).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const cues = parseCaptionText(source, extension.slice(1));
  if (!cues.length) throw new Error("Caption file contains no valid cues.");
  return { schemaVersion: "1.0", trackId: input.trackId, language: input.language, kind: "captions", sourcePath: input.captionPath, sourceFormat: extension.slice(1), cues };
}

export function parseCaptionText(source, format) {
  const normalized = format === "vtt" ? source.replace(/^WEBVTT[^\n]*\n+/, "") : source;
  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines[0].startsWith("NOTE") || lines[0] === "STYLE" || lines[0] === "REGION") continue;
    let timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(/^(\S+)\s+-->\s+(\S+)/);
    if (!timing) continue;
    const startMs = parseTimestamp(timing[1]), endMs = parseTimestamp(timing[2]);
    if (startMs === null || endMs === null || endMs <= startMs) throw new Error(`Invalid caption timing: ${lines[timingIndex]}`);
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (!text) continue;
    cues.push({ cueId: `cue-${String(cues.length + 1).padStart(4, "0")}`, range: { start: { value: startMs, rate: 1000 }, duration: { value: endMs - startMs, rate: 1000 } }, text });
  }
  return cues;
}

function parseTimestamp(value) {
  const match = value.replace(",", ".").match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0), minutes = Number(match[2]), seconds = Number(match[3]), millis = Number(match[4]);
  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

function containedPath(projectPath, path) {
  const root = resolve(projectPath), absolute = resolve(root, path), relation = relative(root, absolute);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Caption path must stay inside the project workspace.");
  return absolute;
}
