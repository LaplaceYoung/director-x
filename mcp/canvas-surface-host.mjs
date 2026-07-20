import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname } from "node:path";
import { pipeline } from "node:stream/promises";

const SURFACES = new Set(["canvas", "editor"]);
const VISIBILITY_STATES = new Set(["visible", "hidden", "prerender"]);

export function createCanvasSurfaceHost({ handleRequest, staleMs = 60_000, sessionTtlMs = 30 * 60 * 1000, cleanupIntervalMs = 60_000, shutdownGraceMs = 5_000, now = () => Date.now(), tokenFactory = randomUUID } = {}) {
  if (typeof handleRequest !== "function") throw new Error("Canvas Surface Host requires a request handler.");
  for (const [name, value] of Object.entries({ staleMs, sessionTtlMs, cleanupIntervalMs, shutdownGraceMs })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`);
  }
  const sessions = { canvas: new Map(), editor: new Map() };
  const activeStreams = new Set();
  let serverPromise = null;
  let closePromise = null;
  let cleanupTimer = null;

  function sessionMap(surface) {
    if (!SURFACES.has(surface)) throw new CanvasSurfaceHostError(400, "surface must be canvas or editor.");
    return sessions[surface];
  }

  async function start() {
    if (closePromise) throw new CanvasSurfaceHostError(503, "Canvas Surface Host is shutting down.");
    if (!serverPromise) {
      serverPromise = new Promise((resolve, reject) => {
        const server = createServer((request, response) => {
          Promise.resolve(handleRequest(request, response)).catch((error) => {
            if (response.headersSent) return response.destroy(error instanceof Error ? error : new Error(String(error)));
            response.writeHead(error?.statusCode ?? 500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          });
        });
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") return reject(new Error("Unable to bind Director X browser canvas."));
          cleanupTimer ??= setInterval(() => pruneExpired(), cleanupIntervalMs);
          cleanupTimer.unref?.();
          resolve({ server, origin: `http://127.0.0.1:${address.port}`, startedAt: new Date(now()).toISOString() });
        });
      });
    }
    try {
      return await serverPromise;
    } catch (error) {
      serverPromise = null;
      throw error;
    }
  }

  function bind(surface, sessionId, scope, { rotateClaim = false } = {}) {
    pruneExpired();
    if (!String(sessionId ?? "").trim()) throw new CanvasSurfaceHostError(400, "Surface session ID is required.");
    const map = sessionMap(surface);
    const previous = map.get(sessionId);
    const normalizedScope = normalizeScope(scope);
    const activityAt = new Date(now()).toISOString();
    const session = {
      surface,
      sessionId,
      scope: normalizedScope,
      claimToken: !previous || rotateClaim ? tokenFactory() : previous.claimToken,
      createdAt: previous?.createdAt ?? activityAt,
      reboundAt: previous ? activityAt : null,
      lastActivityAt: activityAt,
      documentServedAt: rotateClaim ? null : previous?.documentServedAt ?? null,
      hostClaimedAt: rotateClaim ? null : previous?.hostClaimedAt ?? null,
      canvasOpenedAt: rotateClaim ? null : previous?.canvasOpenedAt ?? null,
      lastSeenAt: rotateClaim ? null : previous?.lastSeenAt ?? null,
      visibilityState: rotateClaim ? "unknown" : previous?.visibilityState ?? "unknown",
      heartbeatCount: rotateClaim ? 0 : Number(previous?.heartbeatCount ?? 0),
      lastEvent: previous ? "rebound" : "bound"
    };
    map.set(sessionId, session);
    return descriptor(session);
  }

  function lookup(surface, sessionId, { claimToken, requireClaim = false } = {}) {
    pruneExpired();
    const session = internalSession(surface, sessionId);
    if (requireClaim && (!session.claimToken || claimToken !== session.claimToken)) throw new CanvasSurfaceHostError(403, "Director X canvas claim token is missing or invalid.");
    renew(session);
    return descriptor(session);
  }

  function internalSession(surface, sessionId) {
    const session = sessionMap(surface).get(sessionId);
    if (!session) throw new CanvasSurfaceHostError(404, `Unknown or expired Director X ${surface} surface session.`);
    return session;
  }

  function findCanvasByRun(projectPath, runId) {
    pruneExpired();
    const entries = [...sessionMap("canvas").entries()];
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [sessionId, session] = entries[index];
      if (session.scope.projectPath === projectPath && session.scope.runId === runId) return [sessionId, descriptor(session)];
    }
    return null;
  }

  function observe(surface, sessionId, { claimToken, visibility, event = "heartbeat" } = {}) {
    pruneExpired();
    const session = internalSession(surface, sessionId);
    if (!session.claimToken || claimToken !== session.claimToken) throw new CanvasSurfaceHostError(403, `Director X ${surface} claim token is missing or invalid.`);
    const observedAt = new Date(now()).toISOString();
    if (event === "boot" || event === "document_open") {
      session.hostClaimedAt ??= observedAt;
      session.canvasOpenedAt ??= session.hostClaimedAt;
      session.surface = surface === "canvas" ? "browser" : "editor";
    }
    session.lastSeenAt = observedAt;
    session.lastActivityAt = observedAt;
    session.visibilityState = VISIBILITY_STATES.has(visibility) ? visibility : "unknown";
    session.lastEvent = String(event || "heartbeat").slice(0, 64);
    session.heartbeatCount = Number(session.heartbeatCount ?? 0) + 1;
    return { descriptor: descriptor(session), health: health(session) };
  }

  function health(sessionOrSurface, sessionId, nowMs = now()) {
    const session = typeof sessionOrSurface === "string" ? internalSession(sessionOrSurface, sessionId) : sessionOrSurface;
    if (!session?.lastSeenAt) return {
      status: "awaiting_open",
      hostClaimed: Boolean(session?.hostClaimedAt),
      documentServedAt: session?.documentServedAt ?? null,
      hostClaimedAt: session?.hostClaimedAt ?? null,
      visibility: session?.visibilityState ?? "unknown",
      lastSeenAt: null,
      ageMs: null,
      heartbeatCount: Number(session?.heartbeatCount ?? 0),
      lastEvent: session?.lastEvent ?? null
    };
    const ageMs = Math.max(0, nowMs - Date.parse(session.lastSeenAt));
    return {
      status: session.visibilityState === "hidden" ? "hidden" : ageMs > staleMs ? "stale" : "connected",
      hostClaimed: Boolean(session.hostClaimedAt),
      documentServedAt: session.documentServedAt ?? null,
      hostClaimedAt: session.hostClaimedAt ?? null,
      visibility: session.visibilityState,
      lastSeenAt: session.lastSeenAt,
      ageMs,
      heartbeatCount: Number(session.heartbeatCount ?? 0),
      lastEvent: session.lastEvent ?? null
    };
  }

  function url(surface, sessionId, { origin } = {}) {
    const session = internalSession(surface, sessionId);
    if (!origin) throw new CanvasSurfaceHostError(500, "Canvas Surface Host URL requires a started service origin.");
    const value = new URL(surface === "canvas" ? "/directorx/canvas" : "/directorx/editor", origin);
    value.searchParams.set("session", sessionId);
    value.searchParams.set("claim", session.claimToken);
    return value.toString();
  }

  function markDocumentServed(surface, sessionId) {
    const session = internalSession(surface, sessionId);
    session.documentServedAt = new Date(now()).toISOString();
    session.lastActivityAt = session.documentServedAt;
    session.lastEvent = "document_served";
    return descriptor(session);
  }

  async function streamMedia(request, response, path, size) {
    const contentType = mediaContentType(path);
    if (extname(path).toLowerCase() === ".svg") return send(response, 415, { error: "Inline SVG preview is disabled on the Director X loopback origin." }, "application/json; charset=utf-8");
    const streamable = /^(video|audio)\//.test(contentType);
    const image = contentType.startsWith("image/");
    if (image && size > 25 * 1024 * 1024) return send(response, 413, { error: "Canvas image preview must be no larger than 25 MB." }, "application/json; charset=utf-8");
    if (!streamable && !image && size > 2 * 1024 * 1024) return send(response, 413, { error: "Canvas document preview must be no larger than 2 MB." }, "application/json; charset=utf-8");
    const headers = { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(streamable ? { "Accept-Ranges": "bytes" } : {}) };
    const requestedRange = request.headers.range;
    if (streamable && request.method === "GET" && requestedRange) {
      const range = parseByteRange(requestedRange, size);
      if (range.kind === "unsatisfiable") {
        response.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
        response.end();
        return;
      }
      if (range.kind === "range") {
        const { start: startOffset, end: endOffset } = range;
        response.writeHead(206, { ...headers, "Content-Range": `bytes ${startOffset}-${endOffset}/${size}`, "Content-Length": endOffset - startOffset + 1 });
        return await pipeFile(response, path, { start: startOffset, end: endOffset });
      }
    }
    response.writeHead(200, { ...headers, "Content-Length": size });
    return await pipeFile(response, path);
  }

  async function close({ graceMs = shutdownGraceMs } = {}) {
    if (closePromise) return await closePromise;
    if (!serverPromise) return;
    if (!Number.isFinite(graceMs) || graceMs <= 0) throw new CanvasSurfaceHostError(400, "Canvas Surface Host close graceMs must be positive and finite.");
    const activePromise = serverPromise;
    closePromise = (async () => {
      const active = await activePromise;
      await new Promise((resolveClose, rejectClose) => {
        const idleSweep = setInterval(() => active.server.closeIdleConnections?.(), Math.min(100, Math.max(10, graceMs / 10)));
        idleSweep.unref?.();
        const forceTimer = setTimeout(() => {
          for (const controller of activeStreams) controller.abort();
          active.server.closeAllConnections?.();
        }, graceMs);
        forceTimer.unref?.();
        active.server.close((error) => {
          clearInterval(idleSweep);
          clearTimeout(forceTimer);
          if (error) rejectClose(error); else resolveClose();
        });
      });
      if (serverPromise === activePromise) serverPromise = null;
      clearInterval(cleanupTimer);
      cleanupTimer = null;
      sessions.canvas.clear();
      sessions.editor.clear();
    })();
    try { await closePromise; }
    finally { closePromise = null; }
  }

  function pruneExpired(nowMs = now()) {
    let removed = 0;
    for (const map of Object.values(sessions)) {
      for (const [sessionId, session] of map) {
        const activityAt = Date.parse(session.lastActivityAt ?? session.createdAt);
        if (Number.isFinite(activityAt) && nowMs - activityAt >= sessionTtlMs) {
          map.delete(sessionId);
          removed += 1;
        }
      }
    }
    return removed;
  }

  return Object.freeze({ start, bind, lookup, findCanvasByRun, observe, health, url, markDocumentServed, streamMedia, pruneExpired, close });

  function renew(session) {
    session.lastActivityAt = new Date(now()).toISOString();
  }

  async function pipeFile(response, path, range) {
    const controller = new AbortController();
    activeStreams.add(controller);
    try {
      await pipeline(createReadStream(path, range), response, { signal: controller.signal });
    } catch (error) {
      if (error?.name !== "AbortError" && error?.code !== "ERR_STREAM_PREMATURE_CLOSE") throw error;
    } finally {
      activeStreams.delete(controller);
    }
  }
}

export class CanvasSurfaceHostError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "CanvasSurfaceHostError";
    this.statusCode = statusCode;
  }
}

export function parseByteRange(header, size) {
  if (typeof header !== "string" || !/^bytes=/i.test(header.trim())) return { kind: "ignore" };
  if (!Number.isSafeInteger(size) || size <= 0 || header.includes(",")) return { kind: "unsatisfiable" };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return { kind: "unsatisfiable" };
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) return { kind: "unsatisfiable" };
  return { kind: "range", start, end: Math.min(requestedEnd, size - 1) };
}

function mediaContentType(path) {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".json": "application/json; charset=utf-8", ".srt": "text/plain; charset=utf-8", ".vtt": "text/vtt; charset=utf-8" })[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function normalizeScope(scope = {}) {
  const allowed = new Set(["projectPath", "runId", "canvasUrl"]);
  for (const key of Object.keys(scope)) if (!allowed.has(key)) throw new CanvasSurfaceHostError(400, `Canvas Surface Host scope cannot contain business state: ${key}`);
  if (!String(scope.projectPath ?? "").trim()) throw new CanvasSurfaceHostError(400, "Canvas Surface Host scope requires projectPath.");
  return Object.freeze({ projectPath: scope.projectPath, runId: scope.runId ?? null, canvasUrl: scope.canvasUrl ?? null });
}

function descriptor(session) {
  return Object.freeze({
    surface: session.surface,
    sessionId: session.sessionId,
    scope: Object.freeze({ ...session.scope }),
    createdAt: session.createdAt,
    reboundAt: session.reboundAt,
    lastActivityAt: session.lastActivityAt,
    documentServedAt: session.documentServedAt,
    hostClaimedAt: session.hostClaimedAt,
    canvasOpenedAt: session.canvasOpenedAt,
    lastSeenAt: session.lastSeenAt,
    visibilityState: session.visibilityState,
    heartbeatCount: session.heartbeatCount,
    lastEvent: session.lastEvent
  });
}

function send(response, statusCode, body, contentType) {
  const payload = Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(statusCode, { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(payload);
}
