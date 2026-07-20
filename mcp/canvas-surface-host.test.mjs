import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvasSurfaceHost, parseByteRange } from "./canvas-surface-host.mjs";

test("starts one loopback server and closes it through the host interface", async () => {
  const host = createCanvasSurfaceHost({ handleRequest(_request, response) { response.end("ok"); } });
  const [first, second] = await Promise.all([host.start(), host.start()]);
  assert.equal(first.origin, second.origin);
  assert.equal(await (await fetch(first.origin)).text(), "ok");
  await host.close();
});

test("issues and rotates claims for both side-browser surfaces", async () => {
  const tokens = ["claim-1", "claim-2", "editor-claim"];
  const host = createCanvasSurfaceHost({ handleRequest() {}, tokenFactory: () => tokens.shift() });
  host.bind("canvas", "canvas-1", { projectPath: "/tmp/project" });
  assert.match(await host.url("canvas", "canvas-1", { origin: "http://127.0.0.1:1234" }), /claim=claim-1/);
  host.bind("canvas", "canvas-1", { projectPath: "/tmp/project", runId: "run-1" }, { rotateClaim: true });
  assert.match(host.url("canvas", "canvas-1", { origin: "http://127.0.0.1:1234" }), /claim=claim-2/);
  host.bind("editor", "editor-1", { projectPath: "/tmp/project", runId: "run-1" });
  assert.match(host.url("editor", "editor-1", { origin: "http://127.0.0.1:1234" }), /claim=editor-claim/);
});

test("requires the current claim for canvas boot and preserves hidden surfaces", () => {
  let nowMs = Date.parse("2026-07-17T00:00:00.000Z");
  const host = createCanvasSurfaceHost({ handleRequest() {}, now: () => nowMs, tokenFactory: () => "claim" });
  host.bind("canvas", "canvas-1", { projectPath: "/tmp/project" });
  assert.throws(() => host.observe("canvas", "canvas-1", { event: "boot", claimToken: "wrong", visibility: "visible" }), (error) => error.statusCode === 403);
  const opened = host.observe("canvas", "canvas-1", { event: "boot", claimToken: "claim", visibility: "visible" });
  assert.equal(opened.health.hostClaimed, true);
  assert.equal(opened.health.status, "connected");
  nowMs += 120_000;
  const hidden = host.observe("canvas", "canvas-1", { event: "visibility", claimToken: "claim", visibility: "hidden" });
  assert.equal(hidden.health.status, "hidden");
  nowMs += 120_000;
  assert.equal(host.health("canvas", "canvas-1").status, "hidden");
});

test("requires claims on editor heartbeats and expires inactive sessions", () => {
  let nowMs = Date.parse("2026-07-17T00:00:00.000Z");
  const host = createCanvasSurfaceHost({ handleRequest() {}, now: () => nowMs, sessionTtlMs: 1_000, tokenFactory: () => "editor-claim" });
  host.bind("editor", "editor-1", { projectPath: "/tmp/project", runId: "run-1" });
  assert.throws(() => host.observe("editor", "editor-1", { event: "document_open", claimToken: "wrong", visibility: "visible" }), (error) => error.statusCode === 403);
  assert.equal(host.observe("editor", "editor-1", { event: "document_open", claimToken: "editor-claim", visibility: "visible" }).health.status, "connected");
  nowMs += 1_000;
  assert.equal(host.pruneExpired(), 1);
  assert.throws(() => host.lookup("editor", "editor-1"), (error) => error.statusCode === 404);
});

test("rebind and document access renew the surface lease", () => {
  let nowMs = Date.parse("2026-07-17T00:00:00.000Z");
  const host = createCanvasSurfaceHost({ handleRequest() {}, now: () => nowMs, sessionTtlMs: 1_000, tokenFactory: () => "claim" });
  host.bind("canvas", "canvas-1", { projectPath: "/tmp/project" });
  nowMs += 900;
  host.markDocumentServed("canvas", "canvas-1");
  nowMs += 900;
  assert.equal(host.pruneExpired(), 0);
  host.bind("canvas", "canvas-1", { projectPath: "/tmp/project", runId: "run-1" });
  nowMs += 999;
  assert.equal(host.pruneExpired(), 0);
  nowMs += 1;
  assert.equal(host.pruneExpired(), 1);
});

test("periodically sweeps expired canvas and editor sessions", async () => {
  const host = createCanvasSurfaceHost({ handleRequest(_request, response) { response.end("ok"); }, sessionTtlMs: 10, cleanupIntervalMs: 5 });
  await host.start();
  host.bind("canvas", "canvas-1", { projectPath: "/tmp/project" });
  host.bind("editor", "editor-1", { projectPath: "/tmp/project", runId: "run-1" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.throws(() => host.lookup("canvas", "canvas-1"), (error) => error.statusCode === 404);
  assert.throws(() => host.lookup("editor", "editor-1"), (error) => error.statusCode === 404);
  await host.close();
});

test("closes idempotently and invalidates prior bindings", async () => {
  const host = createCanvasSurfaceHost({ handleRequest(_request, response) { response.end("ok"); } });
  const { origin } = await host.start();
  host.bind("canvas", "canvas-1", { projectPath: "/tmp/project" });
  await Promise.all([host.close(), host.close()]);
  assert.throws(() => host.lookup("canvas", "canvas-1"), (error) => error.statusCode === 404);
  const restarted = await host.start();
  assert.match(restarted.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(typeof origin, "string");
  await host.close();
});

test("rejects restart while graceful shutdown is still draining", async () => {
  let finishResponse;
  let resolveStarted;
  const started = new Promise((resolve) => { resolveStarted = resolve; });
  const host = createCanvasSurfaceHost({
    handleRequest(_request, response) {
      response.write("partial");
      finishResponse = () => response.end("-done");
      resolveStarted();
    },
    shutdownGraceMs: 1_000
  });
  const { origin } = await host.start();
  const responsePromise = fetch(origin);
  await started;
  const closing = host.close();
  await assert.rejects(host.start(), (error) => error.statusCode === 503);
  finishResponse();
  assert.equal(await (await responsePromise).text(), "partial-done");
  await closing;
});

test("finds the newest matching binding", () => {
  const host = createCanvasSurfaceHost({ handleRequest() {} });
  host.bind("canvas", "old", { projectPath: "/tmp/p", runId: "run" });
  host.bind("canvas", "new", { projectPath: "/tmp/p", runId: "run" });
  assert.equal(host.findCanvasByRun("/tmp/p", "run")[0], "new");
});

test("returns immutable transport descriptors and rejects business state", () => {
  const host = createCanvasSurfaceHost({ handleRequest() {} });
  const descriptor = host.bind("canvas", "canvas-1", { projectPath: "/tmp/p", runId: "run" });
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.scope), true);
  assert.throws(() => host.bind("canvas", "bad", { projectPath: "/tmp/p", goalInteraction: {} }), /cannot contain business state/);
});

test("streams bounded byte ranges for local media", async () => {
  const directory = await mkdtemp(join(tmpdir(), "directorx-surface-host-"));
  const mediaPath = join(directory, "sample.mp4");
  await writeFile(mediaPath, "0123456789");
  let host;
  host = createCanvasSurfaceHost({ handleRequest(request, response) { return host.streamMedia(request, response, mediaPath, 10); } });
  const { origin } = await host.start();
  const response = await fetch(origin, { headers: { Range: "bytes=2-5" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await response.text(), "2345");
  const openEnded = await fetch(origin, { headers: { Range: "bytes=6-" } });
  assert.equal(openEnded.status, 206);
  assert.equal(await openEnded.text(), "6789");
  const suffix = await fetch(origin, { headers: { Range: "bytes=-4" } });
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), "6789");
  const caseInsensitive = await fetch(origin, { headers: { Range: "Bytes=0-1" } });
  assert.equal(caseInsensitive.status, 206);
  assert.equal(await caseInsensitive.text(), "01");
  const ignoredUnit = await fetch(origin, { headers: { Range: "items=0-1" } });
  assert.equal(ignoredUnit.status, 200);
  assert.equal(await ignoredUnit.text(), "0123456789");
  const unsatisfiable = await fetch(origin, { headers: { Range: "bytes=10-" } });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get("content-range"), "bytes */10");
  await host.close();
});

test("parses closed, open-ended, and suffix byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=2-5", 10), { kind: "range", start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=6-", 10), { kind: "range", start: 6, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-4", 10), { kind: "range", start: 6, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-40", 10), { kind: "range", start: 0, end: 9 });
  assert.deepEqual(parseByteRange("Bytes=0-1", 10), { kind: "range", start: 0, end: 1 });
  assert.deepEqual(parseByteRange("items=0-1", 10), { kind: "ignore" });
  assert.deepEqual(parseByteRange("bytes=10-", 10), { kind: "unsatisfiable" });
  assert.deepEqual(parseByteRange("bytes=0-1,4-5", 10), { kind: "unsatisfiable" });
  assert.deepEqual(parseByteRange("bytes=-0", 10), { kind: "unsatisfiable" });
});

test("rejects inline SVG on the loopback origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "directorx-surface-svg-"));
  const mediaPath = join(directory, "unsafe.svg");
  await writeFile(mediaPath, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  let host;
  host = createCanvasSurfaceHost({ handleRequest(request, response) { return host.streamMedia(request, response, mediaPath, 70); } });
  const { origin } = await host.start();
  const response = await fetch(origin);
  assert.equal(response.status, 415);
  assert.match(await response.text(), /SVG preview is disabled/);
  await host.close();
});
