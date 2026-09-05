#!/usr/bin/env node
/**
 * Minimal Product Launch Video HTTP API (Node.js built-in http only).
 *
 * DEVELOPMENT ONLY:
 * - In-memory job store (lost on restart)
 * - Serialized renders (one at a time) sharing build/ outputs
 * - Runtime storyboard generation: Mistral or local Ollama (LLM_PROVIDER)
 * - Cursor/OpenCode/Grok are not called from this server
 * - Allowlisted static files from web/ (not a general file server)
 *
 * Usage:
 *   npm run server
 *   PORT=8787 npm run server
 */
import "./lib/load-env.mjs";
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactPathFor,
  enqueueStoryboardJob,
  getPublicJob,
  isValidJobId,
} from "./lib/video-service.mjs";
import { getTtsStatus } from "./lib/tts.mjs";
import { generateStoryboardFromDescription, getLlmStatus } from "./lib/storyboard-generation.mjs";

const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../web");
const WEB_FILES = new Map([
  ["/", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { name: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { name: "styles.css", type: "text/css; charset=utf-8" }],
]);

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = 1_000_000;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        reject(Object.assign(new Error("Request body is required."), { status: 400 }));
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

function requestPathname(rawUrl) {
  try {
    const parsed = new URL(rawUrl || "/", "http://127.0.0.1");
    return decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
}

function matchRoute(method, url) {
  const path = requestPathname(url);
  if (path == null) {
    return { name: "badRequest" };
  }

  // Reject traversal attempts before any filesystem lookup.
  if (path.includes("..") || path.includes("\\") || path.includes("\0")) {
    return { name: "notFound" };
  }

  if (method === "GET" && path === "/health") {
    return { name: "health" };
  }

  if (method === "POST" && path === "/api/videos/generate") {
    return { name: "generateVideo" };
  }

  if (method === "POST" && path === "/api/videos") {
    return { name: "createVideo" };
  }

  const download = path.match(/^\/api\/videos\/([^/]+)\/download$/);
  if (method === "GET" && download) {
    return { name: "downloadVideo", jobId: download[1] };
  }

  const getJob = path.match(/^\/api\/videos\/([^/]+)$/);
  if (method === "GET" && getJob) {
    return { name: "getVideo", jobId: getJob[1] };
  }

  if ((method === "GET" || method === "HEAD") && WEB_FILES.has(path)) {
    return { name: "static", path };
  }

  if (method === "GET" && path === "/favicon.ico") {
    return { name: "favicon" };
  }

  return { name: "notFound" };
}

function isInsideWebDir(filePath) {
  const root = WEB_DIR.endsWith(sep) ? WEB_DIR : WEB_DIR + sep;
  return filePath === WEB_DIR || filePath.startsWith(root);
}

function handleStatic(res, urlPath, method) {
  const spec = WEB_FILES.get(urlPath);
  if (!spec) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const filePath = resolve(WEB_DIR, spec.name);
  if (!isInsideWebDir(filePath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const size = statSync(filePath).size;
  res.writeHead(200, {
    "Content-Type": spec.type,
    "Content-Length": size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

async function handleCreateVideo(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message });
    return;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    sendJson(res, 400, { error: "Request body must be a JSON object." });
    return;
  }

  // Direct storyboard path only — product descriptions use /api/videos/generate.
  if (
    body.generateWithCursor === true ||
    body.useGrok === true ||
    body.llm === true ||
    typeof body.prompt === "string" ||
    typeof body.productDescription === "string"
  ) {
    sendJson(res, 400, {
      error:
        'This endpoint accepts a storyboard object only. Use POST /api/videos/generate for a product description. Cursor/Grok is not callable from this API.',
    });
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(body, "storyboard")) {
    sendJson(res, 400, {
      error: 'Missing "storyboard". Expected { "storyboard": { "scenes": [...] } }.',
    });
    return;
  }

  const result = enqueueStoryboardJob(body.storyboard);
  if (!result.ok) {
    sendJson(res, result.status, {
      error: result.error,
      details: result.details || undefined,
    });
    return;
  }

  sendJson(res, 202, result.job);
}

async function handleGenerateVideo(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message });
    return;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    sendJson(res, 400, { error: "Request body must be a JSON object." });
    return;
  }

  const generated = await generateStoryboardFromDescription(
    body.productDescription,
  );
  if (!generated.ok) {
    sendJson(res, generated.status, {
      error: generated.error,
      details: generated.details || undefined,
    });
    return;
  }

  const result = enqueueStoryboardJob(generated.storyboard);
  if (!result.ok) {
    sendJson(res, result.status, {
      error: result.error,
      details: result.details || undefined,
    });
    return;
  }

  sendJson(res, 202, result.job);
}

function handleGetVideo(res, jobId) {
  if (!isValidJobId(jobId)) {
    sendJson(res, 400, { error: "Invalid job id." });
    return;
  }
  const job = getPublicJob(jobId);
  if (!job) {
    sendJson(res, 404, { error: "Job not found." });
    return;
  }
  sendJson(res, 200, job);
}

function handleDownload(res, jobId) {
  if (!isValidJobId(jobId)) {
    sendJson(res, 400, { error: "Invalid job id." });
    return;
  }

  const job = getPublicJob(jobId);
  if (!job) {
    sendJson(res, 404, { error: "Job not found." });
    return;
  }
  if (job.status !== "completed") {
    sendJson(res, 409, {
      error: `Video is not ready (status: ${job.status}).`,
    });
    return;
  }

  let artifact;
  try {
    artifact = artifactPathFor(jobId);
  } catch {
    sendJson(res, 400, { error: "Invalid job id." });
    return;
  }

  if (!existsSync(artifact)) {
    sendJson(res, 404, { error: "Artifact not found." });
    return;
  }

  const size = statSync(artifact).size;
  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Length": size,
    "Content-Disposition": `attachment; filename="product-launch-${jobId}.mp4"`,
    "Cache-Control": "no-store",
  });
  createReadStream(artifact).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const route = matchRoute(req.method || "GET", req.url || "/");

    if (route.name === "badRequest") {
      sendJson(res, 400, { error: "Invalid request URL." });
      return;
    }

    if (route.name === "health") {
      const tts = getTtsStatus();
      const llm = getLlmStatus();
      sendJson(res, 200, {
        ok: true,
        service: "product-video-gen",
        jobs: "in-memory",
        llm: llm.provider,
        llmConfigured: llm.configured,
        tts: {
          engine: tts.engine,
          enabled: tts.enabled,
          configured: tts.configured,
        },
      });
      return;
    }

    if (route.name === "generateVideo") {
      await handleGenerateVideo(req, res);
      return;
    }

    if (route.name === "createVideo") {
      await handleCreateVideo(req, res);
      return;
    }

    if (route.name === "getVideo") {
      handleGetVideo(res, route.jobId);
      return;
    }

    if (route.name === "downloadVideo") {
      handleDownload(res, route.jobId);
      return;
    }

    if (route.name === "static") {
      handleStatic(res, route.path, req.method || "GET");
      return;
    }

    if (route.name === "favicon") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (err) {
    sendJson(res, 500, { error: "Internal server error." });
    console.error(err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Product Launch Video API listening on http://${HOST}:${PORT}`);
  console.log("UI:        GET  /");
  console.log("Endpoints:");
  console.log("  GET  /health");
  console.log("  POST /api/videos");
  console.log("  POST /api/videos/generate");
  console.log("  GET  /api/videos/:jobId");
  console.log("  GET  /api/videos/:jobId/download");
  console.log("");
  console.log("Jobs are in-memory only (lost on restart).");
  console.log("Renders are serialized (one at a time).");
  const llm = getLlmStatus();
  if (llm.provider === "ollama") {
    console.log(`Storyboard LLM: ollama (${llm.model})`);
  } else if (llm.provider === "mistral") {
    console.log(
      `Storyboard LLM: mistral (${llm.configured ? "configured" : "MISTRAL_API_KEY not set"})`,
    );
  } else {
    console.log("Storyboard LLM: unknown (set LLM_PROVIDER to ollama or mistral)");
  }
  const tts = getTtsStatus();
  console.log(
    `Local Piper TTS: ${tts.configured ? "configured" : "not configured"}`,
  );
});
