/**
 * Local Ollama storyboard provider.
 * Calls Ollama's HTTP API directly (POST /api/chat). No OpenCode/Cursor.
 */
import {
  loadOllamaDirectorSystemPrompt,
  normalizeProductDescription,
  ollamaUserMessage,
  parseStoryboardJson,
} from "./llm/director.mjs";
import {
  normalizeOllamaStoryboard,
  validateOllamaStoryboardSchema,
} from "./llm/ollama-storyboard-normalize.mjs";
import { validateOllamaDirectorOutput } from "./llm/ollama-director-rules.mjs";
import { applyOllamaVoiceoverPolicy, disableOllamaShortSceneVoiceover } from "./llm/ollama-voiceover-fill.mjs";
import { repairCtaVoiceover } from "./llm/cta-voiceover-repair.mjs";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:3b";
export const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000;
export const DEFAULT_OLLAMA_TEMPERATURE = 0.1;
export const DEFAULT_OLLAMA_NUM_PREDICT = 1400;
export const DEFAULT_OLLAMA_NUM_CTX = 4096;
export const DEFAULT_OLLAMA_SEED = 42;

export function getOllamaModel() {
  const model = process.env.OLLAMA_MODEL;
  if (typeof model === "string" && model.trim()) return model.trim();
  return DEFAULT_OLLAMA_MODEL;
}

export function getOllamaTimeoutMs() {
  const raw = Number(process.env.OLLAMA_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 1_000) return Math.floor(raw);
  return DEFAULT_OLLAMA_TIMEOUT_MS;
}

export function getOllamaTemperature() {
  const raw = Number(process.env.OLLAMA_TEMPERATURE);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
  return DEFAULT_OLLAMA_TEMPERATURE;
}

export function getOllamaNumPredict() {
  const raw = Number(process.env.OLLAMA_NUM_PREDICT);
  if (Number.isFinite(raw) && raw >= 256 && raw <= 3200) {
    return Math.floor(raw);
  }
  return DEFAULT_OLLAMA_NUM_PREDICT;
}

export function getOllamaNumCtx() {
  const raw = Number(process.env.OLLAMA_NUM_CTX);
  if (Number.isFinite(raw) && raw >= 2048 && raw <= 32768) {
    return Math.floor(raw);
  }
  return DEFAULT_OLLAMA_NUM_CTX;
}

export function getOllamaGenerationOptions() {
  return {
    temperature: getOllamaTemperature(),
    num_predict: getOllamaNumPredict(),
    num_ctx: getOllamaNumCtx(),
    seed: DEFAULT_OLLAMA_SEED,
  };
}

/**
 * @returns {{ ok: true, baseUrl: string } | { ok: false, status: number, error: string }}
 */
export function getOllamaBaseUrl() {
  const raw = (
    typeof process.env.OLLAMA_BASE_URL === "string" &&
    process.env.OLLAMA_BASE_URL.trim()
      ? process.env.OLLAMA_BASE_URL
      : DEFAULT_OLLAMA_BASE_URL
  )
    .trim()
    .replace(/\/+$/, "");

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      ok: false,
      status: 503,
      error:
        "Ollama is not configured. Set OLLAMA_BASE_URL to an http(s) URL such as http://127.0.0.1:11434.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      status: 503,
      error:
        "Ollama is not configured. OLLAMA_BASE_URL must be an http(s) URL.",
    };
  }
  return { ok: true, baseUrl: raw };
}

/**
 * Ollama post-AJV pipeline (order is contractual):
 * applyOllamaVoiceoverPolicy → repairCtaVoiceover → disableOllamaShortSceneVoiceover → validateOllamaDirectorOutput
 *
 * Short-scene disable runs again after CTA repair so repair cannot re-enable VO on <2.5s slots.
 *
 * @param {object} storyboard AJV-valid storyboard from Qwen
 * @param {string} description normalized product description
 * @returns {Promise<
 *   | { ok: true, storyboard: object }
 *   | { ok: false, status: number, error: string, details?: string[] }
 * >}
 */
export function finalizeOllamaStoryboard(storyboard, description) {
  const filled = applyOllamaVoiceoverPolicy(storyboard, description);
  const repaired = repairCtaVoiceover(filled, description);
  const silenced = disableOllamaShortSceneVoiceover(repaired);
  const directed = validateOllamaDirectorOutput(silenced, description);
  if (!directed.ok) return directed;
  return { ok: true, storyboard: silenced };
}

/**
 * Ollama pre-AJV pipeline (order is contractual):
 * parseStoryboardJson → normalizeOllamaStoryboard → validateOllamaStoryboardSchema
 *
 * @param {unknown} raw
 * @returns {{ ok: true, storyboard: object } | { ok: false, status: number, error: string, details?: string[] }}
 */
export function parseNormalizeAndValidateOllamaStoryboard(raw) {
  let candidate;
  try {
    candidate = parseStoryboardJson(raw);
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Storyboard generation failed: the model returned invalid JSON.",
    };
  }

  const normalized = normalizeOllamaStoryboard(candidate);
  return validateOllamaStoryboardSchema(normalized);
}

function chatUrl(baseUrl) {
  return `${baseUrl}/api/chat`;
}

function isUnavailableError(err) {
  const code = err?.cause?.code || err?.code;
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_SOCKET" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  ) {
    return true;
  }
  const message = String(err?.message || "").toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("fetch failed") ||
    message.includes("network")
  );
}

function isTimeoutError(err) {
  return err?.name === "TimeoutError" || err?.name === "AbortError";
}

function isMissingModel(status, errorText) {
  const text = String(errorText || "").toLowerCase();
  if (status === 404) return true;
  return (
    text.includes("not found") ||
    text.includes("does not exist") ||
    text.includes("try pulling")
  );
}

async function readErrorText(response) {
  try {
    const text = await response.text();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.error === "string") return parsed.error;
    } catch {
      // use raw text
    }
    return text.slice(0, 400);
  } catch {
    return "";
  }
}

function contentToString(content) {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * @param {unknown} productDescription
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<
 *   | { ok: true, storyboard: object }
 *   | { ok: false, status: number, error: string, details?: string[] }
 * >}
 */
export async function generateStoryboardWithOllama(
  productDescription,
  options = {},
) {
  const normalized = normalizeProductDescription(productDescription);
  if (!normalized.ok) return normalized;

  const base = getOllamaBaseUrl();
  if (!base.ok) return base;

  const model = getOllamaModel();
  const timeoutMs = getOllamaTimeoutMs();
  const fetchImpl =
    typeof options.fetchImpl === "function" ? options.fetchImpl : fetch;

  const payload = {
    model,
    stream: false,
    format: "json",
    options: getOllamaGenerationOptions(),
    messages: [
      { role: "system", content: loadOllamaDirectorSystemPrompt() },
      { role: "user", content: ollamaUserMessage(normalized.description) },
    ],
  };

  let response;
  try {
    response = await fetchImpl(chatUrl(base.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      return {
        ok: false,
        status: 504,
        error: "Storyboard generation timed out. Please try again.",
      };
    }
    if (isUnavailableError(err)) {
      return {
        ok: false,
        status: 503,
        error:
          "Ollama is not running. Start Ollama locally and retry (http://127.0.0.1:11434).",
      };
    }
    console.error("Ollama storyboard request failed", {
      status: 503,
    });
    return {
      ok: false,
      status: 503,
      error:
        "Ollama is not running. Start Ollama locally and retry (http://127.0.0.1:11434).",
    };
  }

  if (!response.ok) {
    const errorText = await readErrorText(response);
    if (isMissingModel(response.status, errorText)) {
      return {
        ok: false,
        status: 503,
        error: `Ollama model "${model}" was not found. Pull it with: ollama pull ${model}`,
      };
    }
    console.error("Ollama storyboard request failed", {
      status: 502,
      providerStatus: response.status,
    });
    return {
      ok: false,
      status: 502,
      error: "Storyboard generation failed.",
    };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Storyboard generation failed: the model returned invalid JSON.",
    };
  }

  const raw = contentToString(body?.message?.content);
  const parsed = parseNormalizeAndValidateOllamaStoryboard(raw);
  if (!parsed.ok) return parsed;
  return finalizeOllamaStoryboard(parsed.storyboard, normalized.description);
}
