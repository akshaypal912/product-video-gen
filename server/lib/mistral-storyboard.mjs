/**
 * Runtime storyboard generation via Mistral.
 * Responsibility: product description → candidate storyboard JSON only.
 * Authoritative validation remains scripts/lib/storyboard.mjs.
 */
import { Mistral } from "@mistralai/mistralai";
import {
  ConnectionError,
  MistralError,
  RequestTimeoutError,
} from "@mistralai/mistralai/models/errors";
import {
  directorUserMessage,
  loadDirectorSystemPrompt,
  normalizeProductDescription,
  parseAndValidateStoryboard,
} from "./llm/director.mjs";

export const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";
const TIMEOUT_MS = 45_000;
const MAX_TOKENS = 3_200;
const NARRATIVE_ROLES = [
  "hook",
  "friction",
  "problem",
  "reveal",
  "proof",
  "ecosystem",
  "benefit",
  "cta",
  "close",
];

/**
 * Simplified JSON Schema for Mistral structured output.
 * The full AJV schema (if/then, $defs) is not a strict-mode subset;
 * this shape is a generation constraint only — not the validator.
 */
const MISTRAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["audio", "scenes"],
  properties: {
    audio: {
      type: "object",
      additionalProperties: false,
      required: ["music", "voiceover"],
      properties: {
        music: {
          type: "object",
          additionalProperties: false,
          required: ["enabled", "mood"],
          properties: {
            enabled: { type: "boolean" },
            mood: { type: "string" },
          },
        },
        voiceover: {
          type: "object",
          additionalProperties: false,
          required: ["enabled", "script", "tone", "pace"],
          properties: {
            enabled: { type: "boolean" },
            script: { type: "string" },
            tone: { type: "string" },
            pace: { type: "string", enum: ["natural", "measured", "urgent"] },
          },
        },
      },
    },
    scenes: {
      type: "array",
      minItems: 4,
      maxItems: 6,
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "duration", "role", "props", "voiceover"],
            properties: {
              type: { type: "string", enum: ["logo-intro"] },
              duration: { type: "integer", minimum: 30, maximum: 180 },
              role: {
                type: "string",
                enum: NARRATIVE_ROLES,
              },
              voiceover: {
                type: "object",
                additionalProperties: false,
                required: ["enabled", "script"],
                properties: {
                  enabled: { type: "boolean" },
                  script: { type: "string" },
                },
              },
              props: {
                type: "object",
                additionalProperties: false,
                required: ["productName"],
                properties: {
                  productName: { type: "string", minLength: 1, maxLength: 80 },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "duration", "role", "props", "voiceover"],
            properties: {
              type: { type: "string", enum: ["text-reveal"] },
              duration: { type: "integer", minimum: 30, maximum: 180 },
              role: {
                type: "string",
                enum: NARRATIVE_ROLES,
              },
              voiceover: {
                type: "object",
                additionalProperties: false,
                required: ["enabled", "script"],
                properties: {
                  enabled: { type: "boolean" },
                  script: { type: "string" },
                },
              },
              props: {
                type: "object",
                additionalProperties: false,
                required: ["lines"],
                properties: {
                  lines: {
                    type: "array",
                    minItems: 1,
                    maxItems: 3,
                    items: { type: "string", minLength: 1, maxLength: 100 },
                  },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "duration", "role", "props", "voiceover"],
            properties: {
              type: { type: "string", enum: ["stat-callout"] },
              duration: { type: "integer", minimum: 30, maximum: 180 },
              role: {
                type: "string",
                enum: NARRATIVE_ROLES,
              },
              voiceover: {
                type: "object",
                additionalProperties: false,
                required: ["enabled", "script"],
                properties: {
                  enabled: { type: "boolean" },
                  script: { type: "string" },
                },
              },
              props: {
                type: "object",
                additionalProperties: false,
                required: ["value", "suffix", "label"],
                properties: {
                  value: { type: "string", minLength: 1, maxLength: 40 },
                  suffix: { type: "string", minLength: 0, maxLength: 20 },
                  label: { type: "string", minLength: 1, maxLength: 80 },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "duration", "role", "props", "voiceover"],
            properties: {
              type: { type: "string", enum: ["icon-grid"] },
              duration: { type: "integer", minimum: 30, maximum: 180 },
              role: {
                type: "string",
                enum: NARRATIVE_ROLES,
              },
              voiceover: {
                type: "object",
                additionalProperties: false,
                required: ["enabled", "script"],
                properties: {
                  enabled: { type: "boolean" },
                  script: { type: "string" },
                },
              },
              props: {
                type: "object",
                additionalProperties: false,
                required: ["caption", "iconColors", "labels"],
                properties: {
                  caption: { type: "string", minLength: 1, maxLength: 100 },
                  iconColors: {
                    type: "array",
                    minItems: 2,
                    maxItems: 6,
                    items: {
                      type: "string",
                      pattern:
                        "^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$",
                    },
                  },
                  labels: {
                    type: "array",
                    minItems: 2,
                    maxItems: 6,
                    items: { type: "string", minLength: 1, maxLength: 32 },
                  },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "duration", "role", "props", "voiceover"],
            properties: {
              type: { type: "string", enum: ["cta-outro"] },
              duration: { type: "integer", minimum: 30, maximum: 180 },
              role: {
                type: "string",
                enum: NARRATIVE_ROLES,
              },
              voiceover: {
                type: "object",
                additionalProperties: false,
                required: ["enabled", "script"],
                properties: {
                  enabled: { type: "boolean" },
                  script: { type: "string" },
                },
              },
              props: {
                type: "object",
                additionalProperties: false,
                required: ["headline", "sub"],
                properties: {
                  headline: { type: "string", minLength: 1, maxLength: 120 },
                  sub: { type: "string", minLength: 1, maxLength: 160 },
                },
              },
            },
          },
        ],
      },
    },
  },
};

function getApiKey() {
  const key = process.env.MISTRAL_API_KEY;
  return typeof key === "string" ? key.trim() : "";
}

export function getMistralModel() {
  const model = process.env.MISTRAL_MODEL;
  if (typeof model === "string" && model.trim()) return model.trim();
  return DEFAULT_MISTRAL_MODEL;
}

export function isMistralConfigured() {
  return getApiKey().length > 0;
}

function contentToString(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object" && typeof content.text === "string") {
    return content.text;
  }
  return "";
}

function mapMistralError(err) {
  if (err instanceof RequestTimeoutError) {
    return {
      status: 504,
      error: "Storyboard generation timed out. Please try again.",
    };
  }
  if (err instanceof ConnectionError) {
    return {
      status: 502,
      error: "Storyboard generation failed: could not reach the model provider.",
    };
  }
  if (err instanceof MistralError) {
    const code = err.statusCode;
    if (code === 401 || code === 403) {
      return {
        status: 502,
        error: "Storyboard generation failed: authentication error.",
      };
    }
    if (code === 429) {
      return {
        status: 429,
        error:
          "Storyboard generation is temporarily rate-limited. Please try again later.",
      };
    }
    if (code >= 500) {
      return {
        status: 502,
        error: "Storyboard generation failed. Please try again later.",
      };
    }
    return {
      status: 502,
      error: "Storyboard generation failed.",
    };
  }
  return {
    status: 502,
    error: "Storyboard generation failed.",
  };
}

function isSchemaRejected(err) {
  if (!(err instanceof MistralError)) return false;
  if (err.statusCode !== 400 && err.statusCode !== 422) return false;
  const body = String(err.body || err.message || "").toLowerCase();
  return (
    body.includes("schema") ||
    body.includes("response_format") ||
    body.includes("json_schema")
  );
}

async function chatComplete(client, model, messages, useJsonSchema) {
  return client.chat.complete({
    model,
    messages,
    temperature: 0.4,
    maxTokens: MAX_TOKENS,
    responseFormat: useJsonSchema
      ? {
          type: "json_schema",
          jsonSchema: {
            name: "storyboard",
            schemaDefinition: MISTRAL_JSON_SCHEMA,
            strict: true,
          },
        }
      : { type: "json_object" },
  });
}

/**
 * @param {unknown} productDescription
 * @returns {Promise<
 *   | { ok: true, storyboard: object }
 *   | { ok: false, status: number, error: string, details?: string[] }
 * >}
 */
export async function generateStoryboardFromDescription(productDescription) {
  const normalized = normalizeProductDescription(productDescription);
  if (!normalized.ok) return normalized;

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error:
        "Storyboard generation is not configured. Set MISTRAL_API_KEY on the server.",
    };
  }

  const model = getMistralModel();
  const client = new Mistral({ apiKey, timeoutMs: TIMEOUT_MS });
  const messages = [
    { role: "system", content: loadDirectorSystemPrompt() },
    {
      role: "user",
      content: directorUserMessage(normalized.description),
    },
  ];

  let response;
  try {
    try {
      response = await chatComplete(client, model, messages, true);
    } catch (err) {
      if (!isSchemaRejected(err)) throw err;
      response = await chatComplete(client, model, messages, false);
    }
  } catch (err) {
    const mapped = mapMistralError(err);
    console.error("Mistral storyboard request failed", {
      status: mapped.status,
      providerStatus:
        err instanceof MistralError ? err.statusCode : undefined,
    });
    return { ok: false, ...mapped };
  }

  const raw = contentToString(response?.choices?.[0]?.message?.content);
  return parseAndValidateStoryboard(raw);
}
