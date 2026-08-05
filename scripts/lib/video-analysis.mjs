export function parseSceneCutTimes(stderr) {
  const times = [];
  for (const match of String(stderr).matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) times.push(value);
  }
  return [...new Set(times.map((value) => Number(value.toFixed(3))))].sort((a, b) => a - b);
}

export function buildShotRanges(durationSeconds, cutTimes) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Video duration must be a positive number.");
  }
  const boundaries = [
    0,
    ...cutTimes.filter((time) => time > 0.08 && time < duration - 0.08),
    duration
  ];
  const shots = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end - start < 0.08) continue;
    shots.push({
      id: `shot-${String(shots.length + 1).padStart(3, "0")}`,
      index: shots.length + 1,
      startSeconds: round(start),
      endSeconds: round(end),
      durationSeconds: round(end - start),
      representativeSeconds: round(start + (end - start) * 0.5)
    });
  }
  return shots;
}

export function extractDominantColors(buffer, maxColors = 12) {
  const buckets = new Map();
  for (let index = 0; index + 2 < buffer.length; index += 3) {
    const red = buffer[index];
    const green = buffer[index + 1];
    const blue = buffer[index + 2];
    const key = `${red >> 4}:${green >> 4}:${blue >> 4}`;
    const current = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
    current.count += 1;
    current.red += red;
    current.green += green;
    current.blue += blue;
    buckets.set(key, current);
  }

  const candidates = [...buckets.values()]
    .map((bucket) => ({
      count: bucket.count,
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count)
    }))
    .sort((a, b) => b.count - a.count);

  const selected = [];
  for (const color of candidates) {
    if (selected.some((item) => colorDistance(item, color) < 38)) continue;
    selected.push(color);
    if (selected.length >= maxColors) break;
  }

  const total = selected.reduce((sum, color) => sum + color.count, 0) || 1;
  return selected.map((color, index) => ({
    rank: index + 1,
    hex: rgbToHex(color),
    rgb: [color.red, color.green, color.blue],
    sampledShare: Number((color.count / total).toFixed(4)),
    role: index === 0 ? "dominant" : index < 5 ? "supporting" : "accent"
  }));
}

export function colorSystemSvg(title, colors) {
  const safeTitle = escapeXml(title);
  const swatchWidth = 240;
  const swatchHeight = 118;
  const width = swatchWidth * 4;
  const rows = Math.max(1, Math.ceil(colors.length / 4));
  const height = 92 + rows * swatchHeight;
  const swatches = colors.map((color, index) => {
    const x = (index % 4) * swatchWidth;
    const y = 92 + Math.floor(index / 4) * swatchHeight;
    const textColor = readableTextColor(color.rgb);
    return [
      `<rect x="${x}" y="${y}" width="${swatchWidth}" height="${swatchHeight}" fill="${color.hex}"/>`,
      `<text x="${x + 18}" y="${y + 46}" fill="${textColor}" font-size="24" font-family="ui-monospace, monospace">${color.hex}</text>`,
      `<text x="${x + 18}" y="${y + 78}" fill="${textColor}" opacity="0.82" font-size="15" font-family="sans-serif">${color.role}</text>`
    ].join("");
  }).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#11100e"/>`,
    `<text x="24" y="38" fill="#f5f0e8" font-size="24" font-family="sans-serif" font-weight="600">${safeTitle}</text>`,
    `<text x="24" y="66" fill="#9e978c" font-size="14" font-family="sans-serif">Sampled palette — verify creative roles against the reference frames</text>`,
    swatches,
    "</svg>"
  ].join("");
}

export function shotListMarkdown(title, shots, relativeShotRoot) {
  const lines = [
    `# ${title} — shot evidence`,
    "",
    "Scene boundaries are FFmpeg estimates. Codex must verify every boundary and fill the creative analysis from the source frames and audio.",
    "",
    "| Shot | Time range | Duration | Evidence frame | Codex analysis |",
    "| --- | --- | ---: | --- | --- |"
  ];
  for (const shot of shots) {
    lines.push(
      `| ${shot.id} | ${formatTime(shot.startSeconds)}–${formatTime(shot.endSeconds)} | ${shot.durationSeconds.toFixed(3)}s | ${relativeShotRoot}/${shot.id}.jpg | purpose; framing; camera; subject motion; light/color; transition; audio |`
    );
  }
  lines.push(
    "",
    "## Required synthesis",
    "",
    "- Narrative and information structure",
    "- Shot-duration distribution and edit rhythm",
    "- Camera and subject-motion grammar",
    "- Lighting, contrast, palette, texture, and typography system",
    "- Audio events, silence, accents, and audiovisual synchronization",
    "- Transferable creative rules",
    "- Protected expression and assets that must not be copied",
    "- Original remake plan"
  );
  return `${lines.join("\n")}\n`;
}

export function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const remaining = value - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(3).padStart(6, "0")}`;
}

function round(value) {
  return Number(value.toFixed(3));
}

function colorDistance(left, right) {
  return Math.sqrt(
    (left.red - right.red) ** 2 +
    (left.green - right.green) ** 2 +
    (left.blue - right.blue) ** 2
  );
}

function rgbToHex(color) {
  return `#${[color.red, color.green, color.blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function readableTextColor([red, green, blue]) {
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 145 ? "#11100e" : "#FFFFFF";
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
