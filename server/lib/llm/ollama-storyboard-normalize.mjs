/**
 * Ollama-only schema-compatible repairs before AJV validation.
 * Safe structural/type normalization only — no narrative rewrites.
 */
import {
  formatValidationErrors,
  validateStoryboard,
} from "../../../scripts/lib/storyboard.mjs";
import { parseStoryboardJson } from "./director.mjs";

/** Matches schemas/storyboard.schema.json #/$defs/hexColor */
export const HEX_COLOR_PATTERN = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

const MAX_TEXT_REVEAL_LINES = 3;

/** Premium theme / icon-grid palette (deterministic fallbacks). */
export const OLLAMA_ICON_COLOR_PALETTE = Object.freeze([
  "#4FA6F7",
  "#7AA2FF",
  "#EF6C4D",
  "#6B7CFF",
  "#2DBE8C",
  "#1DA1F2",
]);

export function isValidHexColor(value) {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value.trim());
}

export function paletteFallbackColor(index, used = new Set()) {
  for (let offset = 0; offset < OLLAMA_ICON_COLOR_PALETTE.length; offset += 1) {
    const color =
      OLLAMA_ICON_COLOR_PALETTE[
        (index + offset) % OLLAMA_ICON_COLOR_PALETTE.length
      ];
    if (!used.has(color)) return color;
  }
  return OLLAMA_ICON_COLOR_PALETTE[index % OLLAMA_ICON_COLOR_PALETTE.length];
}

function isValidLinesArray(lines) {
  return (
    Array.isArray(lines) &&
    lines.length >= 1 &&
    lines.length <= MAX_TEXT_REVEAL_LINES &&
    lines.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

/**
 * Split a single string into 1–3 lines using newlines, then sentence boundaries.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLinesFromString(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return [];

  const byNewline = trimmed
    .split(/\r?\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (byNewline.length > 1) {
    return byNewline.slice(0, MAX_TEXT_REVEAL_LINES);
  }

  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length > 1) {
    return sentences.slice(0, MAX_TEXT_REVEAL_LINES);
  }

  return [trimmed];
}

/**
 * Normalize text-reveal props.lines to a string array when Qwen returns a string.
 * @param {unknown} lines
 */
export function normalizeTextRevealLines(lines) {
  if (isValidLinesArray(lines)) {
    return lines.map((line) => line.trim());
  }
  if (typeof lines === "string" && lines.trim()) {
    return splitLinesFromString(lines);
  }
  return lines;
}

export function normalizeTextRevealScene(scene) {
  if (scene?.type !== "text-reveal") return scene;
  const props =
    scene.props && typeof scene.props === "object" ? scene.props : null;
  if (!props) return scene;

  const lines = normalizeTextRevealLines(props.lines);
  if (lines === props.lines) return scene;

  return {
    ...scene,
    props: {
      ...props,
      lines,
    },
  };
}

export function normalizeIconGridIconColors(scene) {
  if (scene?.type !== "icon-grid") return scene;
  const props =
    scene.props && typeof scene.props === "object" ? scene.props : null;
  if (!props) return scene;

  const labels = Array.isArray(props.labels) ? props.labels : [];
  const rawColors = Array.isArray(props.iconColors) ? props.iconColors : [];
  const count = rawColors.length > 0 ? rawColors.length : labels.length;
  if (count === 0) return scene;

  const used = new Set();
  const iconColors = [];
  for (let index = 0; index < count; index += 1) {
    const raw = rawColors[index];
    if (isValidHexColor(raw)) {
      const color = raw.trim();
      iconColors.push(color);
      used.add(color);
      continue;
    }
    const fallback = paletteFallbackColor(index, used);
    iconColors.push(fallback);
    used.add(fallback);
  }

  return {
    ...scene,
    props: {
      ...props,
      iconColors,
    },
  };
}

/**
 * Apply all Ollama-only schema repairs to one scene.
 * @param {object} scene
 */
export function normalizeOllamaStoryboardScene(scene) {
  return normalizeIconGridIconColors(normalizeTextRevealScene(scene));
}

/**
 * Ollama-only: repair common Qwen type/format mistakes on a parsed storyboard.
 * @param {object} storyboard
 */
export function normalizeOllamaStoryboard(storyboard) {
  if (
    !storyboard ||
    typeof storyboard !== "object" ||
    !Array.isArray(storyboard.scenes)
  ) {
    return storyboard;
  }
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => normalizeOllamaStoryboardScene(scene)),
  };
}

/** @deprecated Use normalizeOllamaStoryboard */
export const normalizeOllamaStoryboardIconColors = normalizeOllamaStoryboard;

/**
 * AJV-validate an already-normalized Ollama storyboard candidate.
 * @param {object} candidate
 * @returns {{ ok: true, storyboard: object } | { ok: false, status: number, error: string, details?: string[] }}
 */
export function validateOllamaStoryboardSchema(candidate) {
  const validation = validateStoryboard(candidate);
  if (!validation.ok) {
    return {
      ok: false,
      status: 422,
      error:
        "Storyboard generation failed: the model output did not match the storyboard schema.",
      details: formatValidationErrors(validation.errors).map((line) =>
        line.replace(/^\s*-\s*/, ""),
      ),
    };
  }

  return { ok: true, storyboard: candidate };
}

/**
 * Parse Qwen JSON, normalize, then AJV-validate (Ollama path only).
 * @param {unknown} raw
 * @returns {{ ok: true, storyboard: object } | { ok: false, status: number, error: string, details?: string[] }}
 */
export function parseAndValidateOllamaStoryboard(raw) {
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

  candidate = normalizeOllamaStoryboard(candidate);
  return validateOllamaStoryboardSchema(candidate);
}
