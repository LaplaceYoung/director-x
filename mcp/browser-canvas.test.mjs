import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

test("browser canvas ships local-only A/B playback and timecoded evidence navigation", async () => {
  const html = await readFile(new URL("../app/browser-canvas.html", import.meta.url), "utf8");
  assert.match(html, /候选 A\/B 导演检查/);
  assert.match(html, /data-compare-player/);
  assert.match(html, /data-jump-time/);
  assert.match(html, /时间轴已锁定/);
  assert.match(html, /成片准备好后，这里会显示镜头、字幕、声音和审片标记/);
  assert.match(html, /data-timeline-time/);
  assert.match(html, /timeline\.audioTracks/);
  assert.match(html, /requestVideoFrameCallback/);
  assert.match(html, /monitorComparisonDrift/);
  assert.match(html, /data-timeline-action="zoom-in"/);
  assert.match(html, /loadWaveformViewport/);
  assert.match(html, /waveformRequest/);
  assert.match(html, /内容依据/);
  assert.match(html, /data-evidence-time/);
  assert.match(html, /data-evidence-target-node/);
  assert.match(html, /function seekEvidence/);
  assert.match(html, /evidenceTargetNode/);
  assert.match(html, /node\.type === "audio"/);
  assert.match(html, /document-preview/);
  assert.match(html, /md\|txt\|json\|srt\|vtt/);
  assert.match(html, /直接关系/);
  assert.match(html, /assetRelations/);
  assert.match(html, /按媒介检查生产内容/);
  assert.match(html, /制作团队/);
  assert.match(html, /activity\.agentBatches/);
  assert.match(html, /renderEvidenceRail/);
  assert.match(html, /renderDefectEvidence/);
  assert.match(html, /frame_evidence\//);
  assert.match(html, /detectorDisposition/);
  assert.match(html, /不会改变成片或最终选择/);
  assert.match(html, /<details class="advanced-details">/);
  assert.match(html, /<summary>\$\{escapeHtml\(summary\)\}<\/summary>/);
  assert.match(html, /type="hidden" required/);
  assert.doesNotMatch(html, /<h3>可追溯数据<\/h3>/);
  assert.doesNotMatch(html, /会话环境变量（由 Director X 锁定）/);
  assert.doesNotMatch(html, /批准候选|确认交付/);
  assert.match(html, /添加时间码反馈/);
  assert.match(html, /\/directorx\/api\/review-note/);
  assert.match(html, /clientNoteId/);
  assert.match(html, /这只是制作反馈，不是批准或交付确认/);
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test("preserves a user-controlled viewport across live state refreshes", async () => {
  const html = await readFile(new URL("../app/browser-canvas.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /if \(!state\.pointer && canvas\.viewport\) state\.transform/);
  assert.match(html, /viewportInitialized/);
  assert.match(html, /localStorage/);
  assert.match(html, /directorx:canvas-ui:/);
  assert.match(html, /\/directorx\/api\/canvas-ui-state/);
  assert.match(html, /data\.canvas\?\.uiState/);
  assert.match(html, /function flushUiState/);
  assert.match(html, /uiStorageKey\(runId/);
  assert.match(html, /selectedId: state\.selectedId/);
  assert.match(html, /compareIds: state\.compareIds/);
  assert.match(html, /timelineViewport: state\.timelineViewport/);
  assert.match(html, /reviewCurrentTime: state\.reviewTransport\.currentTime/);
  assert.match(html, /validIds\.has/);
  assert.match(html, /zoomAroundPoint/);
});

test("opens on a media-first relation view and keeps specialist review views available", async () => {
  const html = await readFile(new URL("../app/browser-canvas.html", import.meta.url), "utf8");
  assert.match(html, /data-view="media"/);
  assert.match(html, /生产画布/);
  assert.match(html, /mediaGraph/);
  assert.match(html, /media-preview/);
  assert.match(html, /生产画布/);
  assert.match(html, /data-view="storyboard"/);
  assert.match(html, /storyboard-board/);
  assert.match(html, /音频", audio/);
  assert.match(html, /文本", documents/);
  assert.match(html, /production-pulse/);
  assert.match(html, /创作产出已停滞/);
  assert.match(html, /renderProductionPulse/);
  assert.match(html, /if \(pulse\) pulse\.outerHTML = renderProductionPulse\(creativeSla\)/);
  assert.match(html, /media-edge/);
  assert.match(html, /data-view="review"/);
  assert.match(html, /documents = assets\.filter/);
  assert.match(html, /images = assets\.filter/);
  assert.match(html, /videos = assets\.filter/);
  assert.match(html, /audio = assets\.filter/);
  assert.match(html, /当前没有\$\{label\}内容/);
  assert.match(html, /\["media", "storyboard", "review"\]\.includes\(state\.view\) \? "asset" : "all"/);
  assert.doesNotMatch(html, /\["视觉与镜头"/);
});

test("supports a durable collapsible object rail", async () => {
  const html = await readFile(new URL("../app/browser-canvas.html", import.meta.url), "utf8");
  assert.match(html, /data-rail="expanded"/);
  assert.match(html, /id="rail-collapse"/);
  assert.match(html, /aria-controls="object-rail"/);
  assert.match(html, /railCollapsed: state\.railCollapsed/);
  assert.match(html, /function toggleRail/);
  assert.match(html, /dataset\.rail = state\.railCollapsed/);
});

test("lets the user collapse and reopen the selected media preview", async () => {
  const html = await readFile(new URL("../app/browser-canvas.html", import.meta.url), "utf8");
  assert.match(html, /id="media-preview-toggle"/);
  assert.match(html, /收起预览/);
  assert.match(html, /展开预览/);
  assert.match(html, /function toggleMediaPreview/);
  assert.match(html, /mediaPreviewCollapsed: state\.mediaPreviewCollapsed/);
  assert.match(html, /if \(state\.view === "media"\) state\.mediaPreviewCollapsed = false/);
  assert.match(html, /media-preview\.collapsed \.media-preview-content/);
});

test("fills the direct file preview with real local image, video, audio, and text files", async () => {
  const html = await readFile(new URL("../app/browser-canvas.html", import.meta.url), "utf8");
  assert.match(html, /const isFileDemo = location\.protocol === "file:"/);
  assert.match(html, /function createFileDemoState/);
  assert.match(html, /真实本地文件演示/);
  assert.match(html, /directorx-waic-moss-promo-v2\.mp4/);
  assert.match(html, /directorx-waic-moss-promo-v4\.mp4/);
  assert.match(html, /directorx-waic-moss-promo-audio\.m4a/);
  assert.match(html, /creative-brief\.md/);
  const [video, audio, poster, logo, brief] = await Promise.all([
    readFile(new URL("../site/assets/demos/directorx-waic-moss-promo-v2.mp4", import.meta.url)),
    readFile(new URL("../assets/canvas-demo/directorx-waic-moss-promo-audio.m4a", import.meta.url)),
    readFile(new URL("../site/assets/demos/directorx-waic-moss-promo-v4-poster.jpg", import.meta.url)),
    readFile(new URL("../assets/brand/directorx-logo.png", import.meta.url)),
    readFile(new URL("../assets/canvas-demo/creative-brief.md", import.meta.url), "utf8")
  ]);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  assert.equal(audio.subarray(4, 8).toString("ascii"), "ftyp");
  assert.deepEqual([...poster.subarray(0, 2)], [0xff, 0xd8]);
  assert.equal(logo.subarray(1, 4).toString("ascii"), "PNG");
  assert.match(brief, /Creative intent/);
  const manifest = JSON.parse(await readFile(new URL("../assets/canvas-demo/asset-manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.assets.length, 7);
  for (const asset of manifest.assets) {
    const bytes = await readFile(new URL(`../${asset.path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
  }
});

test("keeps the side-browser surface alive without treating a hidden tab as disconnected", async () => {
  const html = await readFile(new URL("../app/browser-canvas.html", import.meta.url), "utf8");
  assert.match(html, /\/directorx\/api\/surface-heartbeat/);
  assert.match(html, /surface: "canvas"/);
  assert.match(html, /const claimToken = params\.get\("claim"\)/);
  assert.match(html, /X-DirectorX-Claim/);
  assert.match(html, /surfaceUrl\("\/directorx\/api\/state"/);
  assert.match(html, /surfaceUrl\("\/directorx\/api\/media"/);
  assert.match(html, /document\.visibilityState/);
  assert.match(html, /visibilitychange/);
  assert.match(html, /pagehide/);
  assert.match(html, /后台保持/);
});

test("keeps the last projection visible while a single-flight refresh recovers", async () => {
  const html = await readFile(new URL("../app/browser-canvas.html", import.meta.url), "utf8");
  assert.match(html, /class="connection-banner"/);
  assert.match(html, /data-connection="stale"/);
  assert.match(html, /当前内容已保留并正在自动恢复/);
  assert.match(html, /refreshInFlight/);
  assert.match(html, /if \(state\.refreshInFlight\) return false/);
  assert.match(html, /new AbortController\(\)/);
  assert.match(html, /setTimeout\(\(\) => controller\.abort\(\), 8000\)/);
  assert.match(html, /signal: controller\.signal/);
  assert.match(html, /state\.lastSuccessfulSyncAt = new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(html, /catch \{ \$\("#sync"\)\.textContent = "连接已中断/);
});
