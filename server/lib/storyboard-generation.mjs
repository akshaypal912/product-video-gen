/**
 * Storyboard LLM facade.
 * Selects Mistral or Ollama from LLM_PROVIDER. Never falls back silently.
 * Cursor/OpenCode are not providers.
 */
import {
  generateStoryboardFromDescription as generateWithMistral,
  getMistralModel,
  isMistralConfigured,
} from "./mistral-storyboard.mjs";
import {
  generateStoryboardWithOllama,
  getOllamaModel,
} from "./ollama-storyboard.mjs";

export const LLM_PROVIDERS = Object.freeze(["mistral", "ollama"]);

/**
 * @returns {{ ok: true, name: "mistral" | "ollama" } | { ok: false, status: number, error: string }}
 */
export function resolveLlmProvider() {
  const raw = process.env.LLM_PROVIDER;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!value || value === "mistral") {
    return { ok: true, name: "mistral" };
  }
  if (value === "ollama") {
    return { ok: true, name: "ollama" };
  }
  return {
    ok: false,
    status: 400,
    error: `Unknown LLM_PROVIDER "${String(raw).trim()}". Use "ollama" or "mistral".`,
  };
}

export function getLlmStatus() {
  const resolved = resolveLlmProvider();
  if (!resolved.ok) {
    return {
      provider: "unknown",
      configured: false,
    };
  }
  if (resolved.name === "ollama") {
    return {
      provider: "ollama",
      configured: true,
      model: getOllamaModel(),
    };
  }
  return {
    provider: "mistral",
    configured: isMistralConfigured(),
    model: getMistralModel(),
  };
}

/**
 * Product description → validated storyboard JSON.
 * @param {unknown} productDescription
 * @param {{ fetchImpl?: typeof fetch }} [options] Ollama-only test hook
 */
export async function generateStoryboardFromDescription(
  productDescription,
  options = {},
) {
  const resolved = resolveLlmProvider();
  if (!resolved.ok) return resolved;

  if (resolved.name === "ollama") {
    return generateStoryboardWithOllama(productDescription, options);
  }

  return generateWithMistral(productDescription);
}
