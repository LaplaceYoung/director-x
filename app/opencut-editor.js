const surfaceParams = new URLSearchParams(location.search);
const session = surfaceParams.get("session");
const claimToken = surfaceParams.get("claim");
const state = {
  data: null,
  clips: [],
  captions: [],
  selection: null,
  operations: [],
  undoStack: [],
  redoStack: [],
  playhead: 0,
  playing: false,
  sourceUrl: null,
  canvasUrl: null,
  pixelsPerSecond: 64,
  waveform: null,
  waveformDescriptor: null,
  waveformSegments: [],
  waveformRequest: 0,
  waveformTimer: null,
  waveformScheduledSignature: null,
  waveformLoadedSignature: null,
  waveformLoading: false,
  waveformError: null,
  waveformCache: new Map(),
  lastSavedSignature: null,
  dirty: false
};

const $ = (selector) => document.querySelector(selector);
const surfaceUrl = (path, values = {}) => { const query = new URLSearchParams({ session, claim: claimToken }); for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null) query.set(key, String(value)); return path + "?" + query; };
const claimHeaders = (headers = {}) => ({ ...headers, "X-DirectorX-Claim": claimToken });
const seconds = (time) => Number(time?.value ?? 0) / Number(time?.rate ?? 1);
const frames = (value) => Math.max(0, Math.round(value * state.data.source.fps));
const rational = (value) => ({ value: frames(value), rate: state.data.source.fps });
const rangeOf = (clip) => ({ start: { ...clip.timelineRange.start }, duration: { ...clip.timelineRange.duration } });
const uid = (prefix) => prefix + "-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
const selectedVideo = () => state.selection?.kind === "video" ? state.clips.find((clip) => clip.clipId === state.selection.id) ?? null : null;
const selectedCaption = () => state.selection?.kind === "caption" ? state.captions.find((clip) => clip.clipId === state.selection.id) ?? null : null;
const timelineDuration = () => Math.max(0, ...state.clips.map((clip) => seconds(clip.timelineRange.start) + seconds(clip.timelineRange.duration)));

function fmt(value) {
  const safe = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 1000);
  return String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0") + "." + String(ms).padStart(3, "0");
}

async function load() {
  if (!session) return setStatus("缺少编辑会话", "warn");
  const response = await fetch(surfaceUrl("/directorx/api/editor-state", { visibility: document.visibilityState }), { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "无法载入剪辑会话");
  state.data = data;
  state.clips = structuredClone(data.timeline.tracks.find((track) => track.kind === "video")?.clips ?? []);
  state.captions = structuredClone(data.timeline.tracks.find((track) => track.kind === "caption")?.clips ?? []);
  state.operations = structuredClone(data.draft?.operations ?? []);
  for (const operation of state.operations) replayOperation(operation);
  state.selection = state.clips[0] ? { kind: "video", id: state.clips[0].clipId } : state.captions[0] ? { kind: "caption", id: state.captions[0].clipId } : null;
  state.sourceUrl = surfaceUrl("/directorx/api/editor-media");
  state.canvasUrl = data.canvasUrl;
  state.waveformDescriptor = data.waveform ?? { mode: "unavailable", staticWindow: null };
  state.waveform = state.waveformDescriptor.staticWindow ?? data.reviewTimeline?.audioTracks?.[0]?.waveformWindow ?? null;
  state.lastSavedSignature = data.draft ? operationSignature() : null;
  $("#player").src = state.sourceUrl;
  $("#project-name").textContent = data.project.metadata.name;
  $("#zoom").value = state.pixelsPerSecond;
  render();
  seek(0, true);
  setStatus(data.draft ? "已恢复上次草稿，可继续调整" : "源文件保持只读", data.draft ? "good" : "");
}

async function surfaceHeartbeat(event = "heartbeat") {
  if (!session) return;
  try {
    await fetch("/directorx/api/surface-heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session, claimToken, surface: "editor", visibility: document.visibilityState, event }),
      cache: "no-store",
      keepalive: true
    });
  } catch {}
}

function render() {
  renderAssets();
  renderTimeline();
  renderInspector();
  updateTransport();
  updateHistoryButtons();
}

function renderAssets() {
  $("#asset-count").textContent = state.data.assets.length;
  $("#assets").innerHTML = state.data.assets.map((asset) =>
    '<button class="asset ' + (asset.active ? "active" : "") + '" disabled><span class="thumb">' +
    escapeHtml(asset.mediaKind.toUpperCase()) + '</span><span><strong>' + escapeHtml(asset.label) +
    '</strong><small>' + escapeHtml(asset.path) + "</small></span></button>"
  ).join("");
}

function renderTimeline() {
  const total = Math.max(0.001, timelineDuration());
  const scroll = $("#timeline-scroll");
  const usableViewport = Math.max(720, scroll.clientWidth - 76);
  const bodyWidth = Math.max(usableViewport, total * state.pixelsPerSecond);
  $("#timeline-inner").style.width = (bodyWidth + 76) + "px";
  renderRuler(total, bodyWidth);
  $("#video-track").innerHTML = state.clips.map((clip, index) => {
    const start = seconds(clip.timelineRange.start) * state.pixelsPerSecond;
    const width = Math.max(3, seconds(clip.timelineRange.duration) * state.pixelsPerSecond);
    const active = state.selection?.kind === "video" && state.selection.id === clip.clipId;
    return '<button class="clip ' + (active ? "selected" : "") + '" data-video-id="' + escapeHtml(clip.clipId) +
      '" style="left:' + start + "px;width:" + width + 'px"><strong>' + (index + 1) + ". " +
      escapeHtml(clip.label ?? clip.clipId) + "</strong><small>" + fmt(seconds(clip.sourceRange.start)) +
      " → " + fmt(seconds(clip.sourceRange.start) + seconds(clip.sourceRange.duration)) + "</small></button>";
  }).join("");
  $("#caption-track").innerHTML = state.captions.map((clip) => {
    const start = seconds(clip.timelineRange.start) * state.pixelsPerSecond;
    const width = Math.max(3, seconds(clip.timelineRange.duration) * state.pixelsPerSecond);
    const active = state.selection?.kind === "caption" && state.selection.id === clip.clipId;
    return '<button class="caption ' + (active ? "selected" : "") + '" data-caption-id="' + escapeHtml(clip.clipId) +
      '" style="left:' + start + "px;width:" + width + 'px"><strong>' +
      escapeHtml(clip.metadata?.text ?? clip.label ?? clip.clipId) + "</strong><small>" +
      fmt(seconds(clip.timelineRange.start)) + "</small></button>";
  }).join("");
  $("#scrub").max = total;
  $("#scrub").value = Math.min(state.playhead, total);
  document.querySelectorAll("[data-video-id]").forEach((button) => button.addEventListener("click", () => {
    state.selection = { kind: "video", id: button.dataset.videoId };
    seek(seconds(selectedVideo().timelineRange.start), true);
    render();
  }));
  document.querySelectorAll("[data-caption-id]").forEach((button) => button.addEventListener("click", () => {
    state.selection = { kind: "caption", id: button.dataset.captionId };
    seek(seconds(selectedCaption().timelineRange.start), false);
    render();
  }));
  drawWaveform(bodyWidth, total);
  scheduleWaveformViewport();
  positionPlayhead();
}

function renderRuler(total, bodyWidth) {
  const interval = state.pixelsPerSecond >= 120 ? 1 : state.pixelsPerSecond >= 60 ? 2 : state.pixelsPerSecond >= 36 ? 5 : 10;
  const ticks = [];
  for (let at = 0; at <= total + 0.001; at += interval) {
    ticks.push('<span class="tick" style="left:' + (at * state.pixelsPerSecond) + 'px"><span>' + fmt(at).slice(0, 5) + "</span></span>");
  }
  $("#ruler").style.width = bodyWidth + "px";
  $("#ruler").innerHTML = ticks.join("");
}

function drawWaveform(bodyWidth, total) {
  const canvas = $("#waveform");
  const empty = $("#waveform-empty");
  const viewport = visibleTimelineViewport(total);
  const dynamic = state.waveformSegments.filter((segment) => segment.timelineStartSeconds < viewport.endSeconds && segment.timelineStartSeconds + segment.timelineDurationSeconds > viewport.startSeconds);
  const fallback = state.waveformDescriptor?.mode !== "viewport_pyramid" && !dynamic.length && state.waveform?.peaks?.length && state.waveform.peaks.length % 2 === 0
    ? [{ timelineStartSeconds: seconds(state.waveform.range?.start), timelineDurationSeconds: seconds(state.waveform.range?.duration), window: state.waveform }]
    : [];
  const segments = dynamic.length ? dynamic : fallback;
  if (!segments.length) {
    canvas.hidden = true;
    empty.hidden = false;
    empty.textContent = state.waveformLoading ? "正在载入可见范围波形…" : state.waveformError ? "波形载入失败，可滚动后重试" : "未生成真实波形证据";
    return;
  }
  canvas.hidden = false;
  empty.hidden = true;
  const cssHeight = 64;
  const cssWidth = Math.max(1, Math.min(bodyWidth, (viewport.endSeconds - viewport.startSeconds) * state.pixelsPerSecond));
  const internalWidth = Math.max(256, Math.min(4096, Math.round(cssWidth)));
  const ratio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
  canvas.width = Math.round(internalWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.left = (viewport.startSeconds * state.pixelsPerSecond) + "px";
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, internalWidth, cssHeight);
  context.fillStyle = "#111917";
  context.fillRect(0, 0, internalWidth, cssHeight);
  context.strokeStyle = "#67b99a";
  context.globalAlpha = 0.9;
  context.lineWidth = 1;
  const center = cssHeight / 2;
  context.beginPath();
  for (const segment of segments) {
    const waveform = segment.window;
    const pairCount = waveform.peaks.length / 2;
    for (let index = 0; index < pairCount; index += 1) {
      const at = segment.timelineStartSeconds + ((index + 0.5) / pairCount) * segment.timelineDurationSeconds;
      const x = (at - viewport.startSeconds) / Math.max(.001, viewport.endSeconds - viewport.startSeconds) * internalWidth;
      if (x < -1 || x > internalWidth + 1) continue;
      const min = Math.max(-1, Math.min(1, waveform.peaks[index * 2]));
      const max = Math.max(-1, Math.min(1, waveform.peaks[index * 2 + 1]));
      context.moveTo(x, center - max * (center - 5));
      context.lineTo(x, center - min * (center - 5));
    }
  }
  context.stroke();
}

function visibleTimelineViewport(total = timelineDuration()) {
  const scroll = $("#timeline-scroll");
  const startPixels = Math.max(0, scroll.scrollLeft - 76);
  const endPixels = Math.max(startPixels + 1, Math.min(total * state.pixelsPerSecond, scroll.scrollLeft + scroll.clientWidth - 76));
  const startSeconds = Math.min(total, startPixels / state.pixelsPerSecond);
  const endSeconds = Math.max(startSeconds + Math.min(total || .001, 1 / state.data.source.fps), Math.min(total, endPixels / state.pixelsPerSecond));
  return { startSeconds, endSeconds: Math.min(total, endSeconds) };
}

function waveformViewportPlan() {
  if (state.waveformDescriptor?.mode !== "viewport_pyramid") return null;
  const viewport = visibleTimelineViewport();
  const spans = state.clips.flatMap((clip) => {
    const clipStart = seconds(clip.timelineRange.start);
    const clipEnd = clipStart + seconds(clip.timelineRange.duration);
    const start = Math.max(viewport.startSeconds, clipStart);
    const end = Math.min(viewport.endSeconds, clipEnd);
    if (end <= start) return [];
    const sourceStart = seconds(clip.sourceRange.start) + start - clipStart;
    const sourceEnd = Math.min(Number(state.waveformDescriptor.durationSeconds), sourceStart + end - start);
    return sourceEnd > sourceStart ? [{ timelineStartSeconds: start, timelineDurationSeconds: sourceEnd - sourceStart, sourceStartSeconds: sourceStart, sourceDurationSeconds: sourceEnd - sourceStart }] : [];
  });
  const merged = [];
  const tolerance = 1 / state.data.source.fps + .0001;
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && Math.abs(previous.timelineStartSeconds + previous.timelineDurationSeconds - span.timelineStartSeconds) <= tolerance && Math.abs(previous.sourceStartSeconds + previous.sourceDurationSeconds - span.sourceStartSeconds) <= tolerance) {
      previous.timelineDurationSeconds += span.timelineDurationSeconds;
      previous.sourceDurationSeconds += span.sourceDurationSeconds;
    } else merged.push({ ...span });
  }
  const signature = JSON.stringify({ waveformId: state.waveformDescriptor.waveformId, pixelsPerSecond: state.pixelsPerSecond, viewport: [viewport.startSeconds.toFixed(3), viewport.endSeconds.toFixed(3)], spans: merged.map((span) => [span.timelineStartSeconds.toFixed(3), span.timelineDurationSeconds.toFixed(3), span.sourceStartSeconds.toFixed(3)]) });
  return { viewport, spans: merged.slice(0, 48), signature };
}

function scheduleWaveformViewport(force = false) {
  const plan = waveformViewportPlan();
  if (!plan || !plan.spans.length) return;
  if (!force && (plan.signature === state.waveformScheduledSignature || plan.signature === state.waveformLoadedSignature)) return;
  clearTimeout(state.waveformTimer);
  state.waveformScheduledSignature = plan.signature;
  const request = ++state.waveformRequest;
  state.waveformTimer = setTimeout(() => void loadWaveformViewport(plan, request), 70);
}

async function loadWaveformViewport(plan, request) {
  if (request !== state.waveformRequest) return;
  const cached = state.waveformCache.get(plan.signature);
  if (cached) {
    state.waveformSegments = cached;
    state.waveformLoadedSignature = plan.signature;
    state.waveformLoading = false;
    state.waveformError = null;
    drawWaveform(Math.max(720, timelineDuration() * state.pixelsPerSecond), timelineDuration());
    return;
  }
  state.waveformLoading = true;
  state.waveformError = null;
  drawWaveform(Math.max(720, timelineDuration() * state.pixelsPerSecond), timelineDuration());
  try {
    const segments = await Promise.all(plan.spans.map(async (span) => {
      const query = new URLSearchParams({
        session,
        claim: claimToken,
        waveformId: state.waveformDescriptor.waveformId,
        start: String(span.sourceStartSeconds),
        duration: String(span.sourceDurationSeconds),
        pixelWidth: String(Math.max(64, Math.min(4096, Math.ceil(span.timelineDurationSeconds * state.pixelsPerSecond))))
      });
      const response = await fetch(state.waveformDescriptor.endpoint + "?" + query, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法载入波形视口");
      return { ...span, window: result };
    }));
    if (request !== state.waveformRequest) return;
    state.waveformSegments = segments;
    state.waveformLoadedSignature = plan.signature;
    state.waveformCache.set(plan.signature, segments);
    while (state.waveformCache.size > 40) state.waveformCache.delete(state.waveformCache.keys().next().value);
  } catch (error) {
    if (request !== state.waveformRequest) return;
    state.waveformError = error.message;
    state.waveformScheduledSignature = null;
  } finally {
    if (request === state.waveformRequest) {
      state.waveformLoading = false;
      drawWaveform(Math.max(720, timelineDuration() * state.pixelsPerSecond), timelineDuration());
    }
  }
}

function renderInspector() {
  const video = selectedVideo();
  const caption = selectedCaption();
  $("#selection-label").textContent = video?.clipId ?? caption?.clipId ?? "未选择";
  if (!video && !caption) {
    $("#inspector").innerHTML = '<p class="hint">请选择视频片段或字幕。</p>';
    return;
  }
  if (caption) {
    const start = seconds(caption.timelineRange.start);
    const length = seconds(caption.timelineRange.duration);
    $("#inspector").innerHTML = '<section><h2>字幕时间</h2><p class="hint">' +
      escapeHtml(caption.metadata?.text ?? caption.label ?? caption.clipId) +
      '</p><label class="field"><span>开始 / 秒</span><input id="caption-start" type="number" min="0" step="' +
      (1 / state.data.source.fps).toFixed(4) + '" value="' + start.toFixed(3) +
      '"></label><p class="hint">时长 ' + fmt(length) +
      '</p><button id="apply-caption-shift">应用位移</button></section><section><h2>证据状态</h2><p class="hint">字幕来自 A/V 审片时间轴；只保存时间位移或删除，不伪造转写文本。</p></section>';
    $("#apply-caption-shift").addEventListener("click", applyCaptionShift);
    return;
  }
  const sourceIn = seconds(video.sourceRange.start);
  const sourceOut = sourceIn + seconds(video.sourceRange.duration);
  const gain = (video.effects ?? []).find((item) => item.kind === "gain")?.db ?? 0;
  const duck = (video.effects ?? []).find((item) => item.kind === "duck");
  const crop = (video.effects ?? []).find((item) => item.kind === "crop") ?? { x: 0, y: 0, width: 1, height: 1 };
  const transition = (video.effects ?? []).find((item) => item.kind === "transition");
  const nextVideo = state.clips[state.clips.indexOf(video) + 1];
  $("#inspector").innerHTML = '<section><h2>修剪范围</h2><label class="field"><span>源入点 / 秒</span><input id="trim-in" type="number" min="0" step="' +
    (1 / state.data.source.fps).toFixed(4) + '" value="' + sourceIn.toFixed(3) +
    '"></label><label class="field"><span>源出点 / 秒</span><input id="trim-out" type="number" min="0" step="' +
    (1 / state.data.source.fps).toFixed(4) + '" value="' + sourceOut.toFixed(3) +
    '"></label><button id="apply-trim">应用修剪</button></section><section><h2>源音频</h2><label class="field"><span>增益 / dB</span><input id="gain" type="number" min="-60" max="12" step="0.5" value="' +
    gain + '"></label><button id="apply-gain">应用增益</button></section><section><h2>旁白压低</h2><label class="field"><span>压低 / dB</span><input id="duck-gain" type="number" min="-60" max="0" step="0.5" value="' +
    (duck?.db ?? -9) + '"></label><label class="field"><span>Attack / ms</span><input id="duck-attack" type="number" min="0" max="10000" step="10" value="' +
    (duck?.attackMs ?? 120) + '"></label><label class="field"><span>Release / ms</span><input id="duck-release" type="number" min="0" max="10000" step="10" value="' +
    (duck?.releaseMs ?? 240) + '"></label><button id="apply-duck">压低本段音频</button></section><section><h2>画面裁切</h2><label class="field"><span>X / 0–1</span><input id="crop-x" type="number" min="0" max="1" step="0.01" value="' + crop.x + '"></label><label class="field"><span>Y / 0–1</span><input id="crop-y" type="number" min="0" max="1" step="0.01" value="' + crop.y + '"></label><label class="field"><span>宽 / 0–1</span><input id="crop-width" type="number" min="0.01" max="1" step="0.01" value="' + crop.width + '"></label><label class="field"><span>高 / 0–1</span><input id="crop-height" type="number" min="0.01" max="1" step="0.01" value="' + crop.height + '"></label><button id="apply-crop">应用裁切</button></section><section><h2>镜头过渡</h2><label class="field"><span>类型</span><select id="transition-kind"><option value="crossfade"' +
    (transition?.transitionKind === "crossfade" ? " selected" : "") + '>交叉淡化</option><option value="dip_to_black"' + (transition?.transitionKind === "dip_to_black" ? " selected" : "") + '>黑场淡化</option></select></label><label class="field"><span>时长 / 秒</span><input id="transition-duration" type="number" min="' + (1 / state.data.source.fps).toFixed(4) + '" max="5" step="' + (1 / state.data.source.fps).toFixed(4) + '" value="' + (transition ? seconds(transition.duration) : .5) + '"></label><button id="apply-transition"' + (nextVideo ? "" : " disabled") + '>应用到下一镜头</button><p class="hint">' + (nextVideo ? "目标：" + escapeHtml(nextVideo.clipId) : "末段没有相邻镜头") + '</p></section><section><h2>不可变来源</h2><p class="hint">' +
    escapeHtml(state.data.source.artifactRef) + "<br>" + escapeHtml(state.data.session.sourceSha256 ?? "未提供哈希") + "</p></section>";
  $("#apply-trim").addEventListener("click", applyTrim);
  $("#apply-gain").addEventListener("click", applyGain);
  $("#apply-duck").addEventListener("click", applyDuck);
  $("#apply-crop").addEventListener("click", applyCrop);
  $("#apply-transition").addEventListener("click", applyTransition);
}

function beginMutation() {
  state.undoStack.push(snapshot());
  if (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack = [];
}

function snapshot() {
  return structuredClone({ clips: state.clips, captions: state.captions, selection: state.selection, operations: state.operations, playhead: state.playhead });
}

function restore(value) {
  state.clips = structuredClone(value.clips);
  state.captions = structuredClone(value.captions);
  state.selection = structuredClone(value.selection);
  state.operations = structuredClone(value.operations);
  state.playhead = value.playhead;
  state.dirty = operationSignature() !== state.lastSavedSignature;
  render();
  seek(state.playhead, false);
  setStatus(state.dirty ? state.operations.length + " 项修改尚未保存" : "已恢复到已保存草稿", state.dirty ? "warn" : "good");
}

function undo() {
  const previous = state.undoStack.pop();
  if (!previous) return;
  state.redoStack.push(snapshot());
  restore(previous);
}

function redo() {
  const next = state.redoStack.pop();
  if (!next) return;
  state.undoStack.push(snapshot());
  restore(next);
}

function updateHistoryButtons() {
  $("#undo").disabled = !state.undoStack.length;
  $("#redo").disabled = !state.redoStack.length;
}

function normalizeStarts() {
  let start = 0;
  for (const clip of state.clips) {
    const delta = start - seconds(clip.timelineRange.start);
    clip.timelineRange.start = rational(start);
    clip.effects = (clip.effects ?? []).map((effect) => effect.kind === "duck" ? { ...effect, range: { ...structuredClone(effect.range), start: rational(seconds(effect.range.start) + delta) } } : effect);
    start += seconds(clip.timelineRange.duration);
  }
}

function clearTransitions() {
  state.operations = state.operations.filter((operation) => operation.operation !== "transition");
  state.clips.forEach((clip) => { clip.effects = (clip.effects ?? []).filter((effect) => effect.kind !== "transition"); });
}

function addOperation(operation) {
  const value = {
    operationId: uid("oc-op"),
    path: "/tracks/" + (operation.trackId ?? "video-main") + "/clips/" + operation.clipId,
    evidenceRefs: ["manual-editor"],
    reversible: true,
    ...operation
  };
  delete value.trackId;
  state.operations = compactOperations([...state.operations, value]);
  state.dirty = true;
  setStatus(state.operations.length + " 项修改尚未保存", "warn");
}

function compactOperations(items) {
  let output = [];
  const replaceable = new Set(["trim", "reorder", "transition", "audio_gain", "audio_duck", "caption_shift", "crop"]);
  for (const operation of items) {
    if (operation.operation === "delete") {
      output = output.filter((item) => item.clipId !== operation.clipId || !replaceable.has(item.operation));
    }
    if (replaceable.has(operation.operation)) {
      const index = output.findIndex((item) => item.clipId === operation.clipId && item.operation === operation.operation);
      if (index >= 0) {
        output[index] = operation;
        continue;
      }
    }
    output.push(operation);
  }
  return output;
}

function reorderOperations() {
  state.clips.forEach((clip) => addOperation({
    operation: "reorder",
    clipId: clip.clipId,
    value: { targetTrackId: "video-main", timelineStart: { ...clip.timelineRange.start } },
    affectedRanges: [rangeOf(clip)]
  }));
}

function applyTrim() {
  const clip = selectedVideo();
  const sourceIn = Number($("#trim-in").value);
  const sourceOut = Number($("#trim-out").value);
  if (!clip || !Number.isFinite(sourceIn) || !Number.isFinite(sourceOut) || sourceIn < 0 || sourceOut <= sourceIn || sourceOut > state.data.source.durationSeconds + 0.05) return setStatus("修剪范围无效", "warn");
  beginMutation();
  const oldRange = rangeOf(clip);
  const newDuration = sourceOut - sourceIn;
  clip.sourceRange = { start: rational(sourceIn), duration: rational(newDuration) };
  clip.timelineRange.duration = rational(newDuration);
  clip.effects = (clip.effects ?? []).map((effect) => effect.kind === "duck" ? { ...effect, range: rangeOf(clip) } : effect);
  addOperation({ operation: "trim", clipId: clip.clipId, value: { sourceRange: structuredClone(clip.sourceRange), timelineRange: structuredClone(clip.timelineRange) }, affectedRanges: [oldRange] });
  normalizeStarts();
  reorderOperations();
  render();
  seek(Math.min(state.playhead, timelineDuration()), false);
}

function applyGain() {
  const clip = selectedVideo();
  const gainDb = Number($("#gain").value);
  if (!clip || !Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12) return setStatus("音频增益无效", "warn");
  beginMutation();
  clip.effects = [...(clip.effects ?? []).filter((item) => item.kind !== "gain"), { kind: "gain", db: gainDb }];
  addOperation({ operation: "audio_gain", clipId: clip.clipId, value: { gainDb }, affectedRanges: [rangeOf(clip)] });
  $("#player").volume = Math.min(1, Math.pow(10, gainDb / 20));
  renderInspector();
  updateHistoryButtons();
}

function applyDuck() {
  const clip = selectedVideo();
  const gainDb = Number($("#duck-gain").value), attackMs = Number($("#duck-attack").value), releaseMs = Number($("#duck-release").value);
  if (!clip || !Number.isFinite(gainDb) || gainDb < -60 || gainDb > 0 || !Number.isFinite(attackMs) || attackMs < 0 || attackMs > 10000 || !Number.isFinite(releaseMs) || releaseMs < 0 || releaseMs > 10000) return setStatus("旁白压低参数无效", "warn");
  beginMutation();
  const range = rangeOf(clip);
  clip.effects = [...(clip.effects ?? []).filter((item) => item.kind !== "duck"), { kind: "duck", db: gainDb, attackMs, releaseMs, range: structuredClone(range) }];
  addOperation({ operation: "audio_duck", clipId: clip.clipId, value: { gainDb, attackMs, releaseMs, range: structuredClone(range) }, affectedRanges: [range] });
  renderInspector(); updateHistoryButtons();
}

function applyCrop() {
  const clip = selectedVideo();
  const crop = { x: Number($("#crop-x").value), y: Number($("#crop-y").value), width: Number($("#crop-width").value), height: Number($("#crop-height").value) };
  if (!clip || !Object.values(crop).every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) return setStatus("裁切矩形必须位于画面内", "warn");
  beginMutation();
  clip.effects = [...(clip.effects ?? []).filter((item) => item.kind !== "crop"), { kind: "crop", ...crop }];
  addOperation({ operation: "crop", clipId: clip.clipId, value: crop, affectedRanges: [rangeOf(clip)] });
  renderInspector(); updateHistoryButtons();
}

function applyTransition() {
  const clip = selectedVideo(), index = state.clips.indexOf(clip), next = state.clips[index + 1];
  const durationSeconds = Number($("#transition-duration").value), transitionKind = $("#transition-kind").value;
  if (!clip || !next || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > Math.min(seconds(clip.timelineRange.duration), seconds(next.timelineRange.duration)) / 2) return setStatus("过渡时长不能超过任一相邻镜头的一半", "warn");
  beginMutation();
  const duration = rational(durationSeconds);
  clip.effects = [...(clip.effects ?? []).filter((item) => item.kind !== "transition"), { kind: "transition", transitionKind, duration, toClipId: next.clipId }];
  addOperation({ operation: "transition", clipId: clip.clipId, value: { transitionKind, duration, toClipId: next.clipId }, affectedRanges: [rangeOf(clip), rangeOf(next)] });
  renderInspector(); updateHistoryButtons();
}

function applyCaptionShift() {
  const caption = selectedCaption();
  const start = Number($("#caption-start").value);
  if (!caption || !Number.isFinite(start) || start < 0 || start + seconds(caption.timelineRange.duration) > timelineDuration() + 0.05) return setStatus("字幕时间超出成片范围", "warn");
  beginMutation();
  const oldRange = rangeOf(caption);
  caption.timelineRange.start = rational(start);
  addOperation({ operation: "caption_shift", clipId: caption.clipId, trackId: "captions-main", value: { timelineStart: { ...caption.timelineRange.start } }, affectedRanges: [oldRange] });
  render();
  seek(start, false);
}

function splitAtPlayhead() {
  let clip = selectedVideo();
  if (!clip) clip = clipAt(state.playhead);
  if (!clip) return;
  const start = seconds(clip.timelineRange.start);
  const offset = state.playhead - start;
  const clipDuration = seconds(clip.timelineRange.duration);
  if (offset <= 1 / state.data.source.fps || offset >= clipDuration - 1 / state.data.source.fps) return setStatus("播放头需位于视频片段内部", "warn");
  beginMutation();
  const index = state.clips.indexOf(clip);
  const left = structuredClone(clip);
  const right = structuredClone(clip);
  const leftId = uid("clip");
  const rightId = uid("clip");
  left.clipId = leftId;
  right.clipId = rightId;
  left.timelineRange.duration = rational(offset);
  left.sourceRange.duration = rational(offset);
  right.timelineRange.start = rational(start + offset);
  right.timelineRange.duration = rational(clipDuration - offset);
  right.sourceRange.start = rational(seconds(clip.sourceRange.start) + offset);
  right.sourceRange.duration = rational(clipDuration - offset);
  left.effects = (left.effects ?? []).filter((effect) => effect.kind !== "transition").map((effect) => effect.kind === "duck" ? { ...effect, range: rangeOf(left) } : effect);
  right.effects = (right.effects ?? []).map((effect) => effect.kind === "duck" ? { ...effect, range: rangeOf(right) } : effect);
  addOperation({ operation: "split", clipId: clip.clipId, value: { splitOffset: rational(offset), leftClipId: leftId, rightClipId: rightId }, affectedRanges: [rangeOf(clip)] });
  state.clips.splice(index, 1, left, right);
  state.selection = { kind: "video", id: rightId };
  normalizeStarts();
  render();
}

function moveSelected(delta) {
  const clip = selectedVideo();
  const index = state.clips.indexOf(clip);
  const target = index + delta;
  if (!clip || target < 0 || target >= state.clips.length) return;
  beginMutation();
  clearTransitions();
  [state.clips[index], state.clips[target]] = [state.clips[target], state.clips[index]];
  normalizeStarts();
  reorderOperations();
  render();
  seek(seconds(selectedVideo().timelineRange.start), true);
}

function deleteSelected() {
  const video = selectedVideo();
  const caption = selectedCaption();
  if (!video && !caption) return;
  if (video && state.clips.length <= 1) return setStatus("至少保留一个视频片段", "warn");
  beginMutation();
  const target = video ?? caption;
  const trackId = video ? "video-main" : "captions-main";
  addOperation({ operation: "delete", clipId: target.clipId, trackId, value: {}, affectedRanges: [rangeOf(target)] });
  if (video) {
    state.operations = state.operations.filter((operation) => operation.operation !== "transition" || operation.value?.toClipId !== video.clipId);
    state.clips.forEach((clip) => { clip.effects = (clip.effects ?? []).filter((effect) => effect.kind !== "transition" || effect.toClipId !== video.clipId); });
    const index = state.clips.indexOf(video);
    state.clips.splice(index, 1);
    state.selection = { kind: "video", id: state.clips[Math.min(index, state.clips.length - 1)].clipId };
    normalizeStarts();
    reorderOperations();
  } else {
    const index = state.captions.indexOf(caption);
    state.captions.splice(index, 1);
    state.selection = state.captions.length ? { kind: "caption", id: state.captions[Math.min(index, state.captions.length - 1)].clipId } : { kind: "video", id: state.clips[0].clipId };
  }
  render();
  seek(Math.min(state.playhead, timelineDuration()), false);
}

function replayOperation(operation) {
  const videoIndex = state.clips.findIndex((clip) => clip.clipId === operation.clipId);
  const captionIndex = state.captions.findIndex((clip) => clip.clipId === operation.clipId);
  const collection = videoIndex >= 0 ? state.clips : state.captions;
  const index = videoIndex >= 0 ? videoIndex : captionIndex;
  if (index < 0) throw new Error("草稿引用了不存在的片段：" + operation.clipId);
  const clip = collection[index];
  if (operation.operation === "trim") {
    clip.sourceRange = structuredClone(operation.value.sourceRange);
    clip.timelineRange = structuredClone(operation.value.timelineRange);
  } else if (operation.operation === "split") {
    const offset = seconds(operation.value.splitOffset);
    const left = structuredClone(clip);
    const right = structuredClone(clip);
    left.clipId = operation.value.leftClipId;
    right.clipId = operation.value.rightClipId;
    left.sourceRange.duration = rational(offset);
    left.timelineRange.duration = rational(offset);
    right.sourceRange.start = rational(seconds(clip.sourceRange.start) + offset);
    right.sourceRange.duration = rational(seconds(clip.sourceRange.duration) - offset);
    right.timelineRange.start = rational(seconds(clip.timelineRange.start) + offset);
    right.timelineRange.duration = rational(seconds(clip.timelineRange.duration) - offset);
    collection.splice(index, 1, left, right);
  } else if (operation.operation === "delete") {
    collection.splice(index, 1);
  } else if (operation.operation === "reorder" || operation.operation === "caption_shift") {
    clip.timelineRange.start = structuredClone(operation.value.timelineStart);
    collection.sort((a, b) => seconds(a.timelineRange.start) - seconds(b.timelineRange.start));
  } else if (operation.operation === "audio_gain") {
    clip.effects = [...(clip.effects ?? []).filter((item) => item.kind !== "gain"), { kind: "gain", db: operation.value.gainDb }];
  } else if (operation.operation === "audio_duck") {
    clip.effects = [...(clip.effects ?? []).filter((item) => item.kind !== "duck"), { kind: "duck", db: operation.value.gainDb, attackMs: operation.value.attackMs, releaseMs: operation.value.releaseMs, range: structuredClone(operation.value.range) }];
  } else if (operation.operation === "crop") {
    clip.effects = [...(clip.effects ?? []).filter((item) => item.kind !== "crop"), { kind: "crop", ...structuredClone(operation.value) }];
  } else if (operation.operation === "transition") {
    clip.effects = [...(clip.effects ?? []).filter((item) => item.kind !== "transition"), { kind: "transition", ...structuredClone(operation.value) }];
  }
}

function clipAt(time) {
  return state.clips.find((clip) => time >= seconds(clip.timelineRange.start) - 0.001 && time < seconds(clip.timelineRange.start) + seconds(clip.timelineRange.duration) - 0.001) ?? state.clips.at(-1);
}

function captionAt(time) {
  return state.captions.find((caption) => time >= seconds(caption.timelineRange.start) && time < seconds(caption.timelineRange.start) + seconds(caption.timelineRange.duration));
}

function seek(value, selectVideo) {
  if (!state.data) return;
  state.playhead = Math.max(0, Math.min(Number(value) || 0, timelineDuration()));
  const clip = clipAt(state.playhead);
  if (clip) {
    if (selectVideo) state.selection = { kind: "video", id: clip.clipId };
    const local = Math.max(0, state.playhead - seconds(clip.timelineRange.start));
    $("#player").currentTime = seconds(clip.sourceRange.start) + local;
    const gain = (clip.effects ?? []).find((item) => item.kind === "gain")?.db ?? 0;
    $("#player").volume = Math.min(1, Math.pow(10, gain / 20));
  }
  updateTransport();
  renderTimeline();
  renderInspector();
}

function updateTransport() {
  $("#time").textContent = fmt(state.playhead) + " / " + fmt(timelineDuration());
  $("#toggle").textContent = state.playing ? "暂停" : "播放";
  const caption = captionAt(state.playhead);
  $("#caption-preview").textContent = caption?.metadata?.text ?? caption?.label ?? "";
  $("#caption-preview").hidden = !caption;
  positionPlayhead();
}

function positionPlayhead() {
  if (!state.data) return;
  $("#playhead").style.left = (76 + state.playhead * state.pixelsPerSecond) + "px";
}

async function togglePlayback() {
  const player = $("#player");
  if (state.playing) {
    player.pause();
    state.playing = false;
  } else {
    if (state.playhead >= timelineDuration() - 0.02) seek(0, true);
    state.playing = true;
    await player.play();
  }
  updateTransport();
}

function stepClip(direction) {
  const active = clipAt(state.playhead);
  const index = Math.max(0, state.clips.findIndex((clip) => clip.clipId === active?.clipId));
  const target = Math.max(0, Math.min(state.clips.length - 1, index + direction));
  state.selection = { kind: "video", id: state.clips[target].clipId };
  seek(seconds(state.clips[target].timelineRange.start), true);
  render();
}

function operationSignature() {
  return JSON.stringify(state.operations);
}

async function saveDraft() {
  if (!state.operations.length) return setStatus("当前没有待保存修改", "warn");
  const signature = operationSignature();
  if (!state.dirty && signature === state.lastSavedSignature) return setStatus("草稿已是最新版本", "good");
  $("#save").disabled = true;
  try {
    const hasVideoDurationChange = state.operations.some((item) => ["trim", "split"].includes(item.operation) || (item.operation === "delete" && item.path.includes("/video-main/")));
    const hasNarrativeDelete = state.operations.some((item) => item.operation === "delete");
    const materialChanges = ["manual_edit_override", ...(hasVideoDurationChange ? ["duration_change"] : []), ...(hasNarrativeDelete ? ["narrative_delete"] : [])];
    const response = await fetch("/directorx/api/editor-draft", {
      method: "POST",
      headers: claimHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        session,
        editorSessionId: state.data.session.editorSessionId,
        baseRevision: state.data.session.baseRevision,
        baseContentHash: state.data.session.baseContentHash,
        summary: "Director X Cut 时间线草稿 · " + state.operations.length + " 项修改",
        materialChanges: [...new Set(materialChanges)],
        operations: state.operations
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "保存失败");
    state.lastSavedSignature = signature;
    state.dirty = false;
    setStatus("草稿已保存，请回到 Codex 原生确认后提交", "good");
  } catch (error) {
    setStatus(error.message, "warn");
  } finally {
    $("#save").disabled = false;
  }
}

function changeZoom(value) {
  const scroll = $("#timeline-scroll");
  const old = state.pixelsPerSecond;
  const centerTime = Math.max(0, (scroll.scrollLeft + scroll.clientWidth / 2 - 76) / old);
  state.pixelsPerSecond = Number(value);
  renderTimeline();
  scroll.scrollLeft = Math.max(0, 76 + centerTime * state.pixelsPerSecond - scroll.clientWidth / 2);
  scheduleWaveformViewport(true);
}

function setStatus(message, kind = "") {
  $("#status").textContent = message;
  $("#status").className = "status " + kind;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

$("#toggle").addEventListener("click", () => void togglePlayback());
$("#previous").addEventListener("click", () => stepClip(-1));
$("#next").addEventListener("click", () => stepClip(1));
$("#undo").addEventListener("click", undo);
$("#redo").addEventListener("click", redo);
$("#split").addEventListener("click", splitAtPlayhead);
$("#move-left").addEventListener("click", () => moveSelected(-1));
$("#move-right").addEventListener("click", () => moveSelected(1));
$("#delete").addEventListener("click", deleteSelected);
$("#scrub").addEventListener("input", (event) => seek(event.target.value, true));
$("#zoom").addEventListener("input", (event) => changeZoom(event.target.value));
$("#timeline-scroll").addEventListener("scroll", () => scheduleWaveformViewport());
$("#save").addEventListener("click", () => void saveDraft());
$("#back-canvas").addEventListener("click", () => { if (state.canvasUrl) location.href = state.canvasUrl; });
$("#about").addEventListener("click", () => $("#about-dialog").showModal());
$("#close-about").addEventListener("click", () => $("#about-dialog").close());
$("#player").addEventListener("pause", () => {
  if (state.playing && $("#player").ended) return;
  state.playing = false;
  updateTransport();
});
$("#player").addEventListener("timeupdate", () => {
  if (!state.playing) return;
  const clip = clipAt(state.playhead);
  if (!clip) return;
  const local = $("#player").currentTime - seconds(clip.sourceRange.start);
  const clipDuration = seconds(clip.sourceRange.duration);
  state.playhead = seconds(clip.timelineRange.start) + Math.max(0, local);
  if (local >= clipDuration - 0.025) {
    const index = state.clips.indexOf(clip);
    if (index < state.clips.length - 1) {
      state.selection = { kind: "video", id: state.clips[index + 1].clipId };
      seek(seconds(state.clips[index + 1].timelineRange.start), true);
      void $("#player").play();
    } else {
      state.playing = false;
      $("#player").pause();
      state.playhead = timelineDuration();
    }
  }
  updateTransport();
});
window.addEventListener("resize", () => renderTimeline());
document.addEventListener("visibilitychange", () => void surfaceHeartbeat("visibilitychange"));
window.addEventListener("pagehide", () => void surfaceHeartbeat("pagehide"));
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  } else if (event.code === "Space") {
    event.preventDefault();
    void togglePlayback();
  } else if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    splitAtPlayhead();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelected();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    seek(state.playhead + (event.key === "ArrowLeft" ? -1 : 1) / state.data.source.fps, true);
  }
});

void surfaceHeartbeat("boot");
setInterval(() => void surfaceHeartbeat("heartbeat"), 5000);
load().catch((error) => setStatus(error.message, "warn"));
