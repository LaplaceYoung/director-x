import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initProject,
  readCanvas,
  resolveProjectMediaPath,
  updateObjectPosition
} from "./lib/project.mjs";

const canvasHtmlPath = fileURLToPath(new URL("../app/canvas.html", import.meta.url));

export async function startCanvasServer({ projectPath, port = 0 }) {
  await initProject(projectPath);
  const html = await readFile(canvasHtmlPath, "utf8");
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        return send(response, 200, html, "text/html; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === "/api/canvas") {
        return json(response, 200, await readCanvas(projectPath));
      }
      if (request.method === "PATCH" && url.pathname.startsWith("/api/objects/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/objects/".length));
        const body = await readJsonBody(request);
        return json(response, 200, await updateObjectPosition(projectPath, id, body));
      }
      if (request.method === "GET" && url.pathname.startsWith("/media/")) {
        const storedPath = decodeURIComponent(url.pathname.slice("/media/".length));
        return await streamMedia(response, resolveProjectMediaPath(projectPath, storedPath));
      }
      return json(response, 404, { error: "Not found" });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`
  };
}
async function streamMedia(response, filePath) {
  const details = await stat(filePath);
  if (!details.isFile()) throw new Error("Media path is not a file.");
  response.writeHead(200, {
    "Content-Type": mimeType(filePath),
    "Content-Length": details.size,
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(response);
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function json(response, status, payload) {
  return send(response, status, `${JSON.stringify(payload)}\n`, "application/json; charset=utf-8");
}

function send(response, status, body, contentType) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function mimeType(filePath) {
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg"
  }[extname(filePath).toLowerCase()] || "application/octet-stream";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectPath = process.argv[2] || process.cwd();
  const { url } = await startCanvasServer({ projectPath });
  process.stdout.write(`${url}\n`);
}
