import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { generateStoryboardFromDescription } from "../server/lib/storyboard-generation.mjs";
import {
  finalizeOllamaStoryboard,
  generateStoryboardWithOllama,
  parseNormalizeAndValidateOllamaStoryboard,
} from "../server/lib/ollama-storyboard.mjs";
import { parseAndValidateStoryboard } from "../server/lib/llm/director.mjs";
import { isValidHexColor } from "../server/lib/llm/ollama-storyboard-normalize.mjs";
import { validateOllamaDirectorOutput } from "../server/lib/llm/ollama-director-rules.mjs";
import { validateStoryboard } from "../scripts/lib/storyboard.mjs";
import {
  VALID_STORYBOARD,
  jsonResponse,
  mockFetch,
  ollamaChatResponse,
} from "./helpers.mjs";

const original = {
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_MODEL: process.env.OLLAMA_MODEL,
  OLLAMA_TEMPERATURE: process.env.OLLAMA_TEMPERATURE,
  OLLAMA_NUM_PREDICT: process.env.OLLAMA_NUM_PREDICT,
  OLLAMA_NUM_CTX: process.env.OLLAMA_NUM_CTX,
  OLLAMA_TIMEOUT_MS: process.env.OLLAMA_TIMEOUT_MS,
};

beforeEach(() => {
  process.env.LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  process.env.OLLAMA_MODEL = "qwen2.5-coder:3b";
  delete process.env.OLLAMA_TEMPERATURE;
  delete process.env.OLLAMA_NUM_PREDICT;
  delete process.env.OLLAMA_NUM_CTX;
  delete process.env.OLLAMA_TIMEOUT_MS;
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

const DESCRIPTION =
  "Tables is an AI-powered customer intelligence platform that helps sales teams discover and connect with the right prospects faster.";

const TABLES_DESCRIPTION =
  "Tables is an AI-powered customer intelligence platform that helps sales teams discover and connect with the right prospects faster. It provides access to 297M+ professional profiles and connects customer data across LinkedIn and HubSpot, helping teams replace fragmented workflows with one intelligent workspace.";

test("Ollama request posts to /api/chat with director prompt and JSON format", async () => {
  const { fetchImpl, calls } = mockFetch(async () =>
    ollamaChatResponse(JSON.stringify(VALID_STORYBOARD)),
  );

  const result = await generateStoryboardWithOllama(DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "qwen2.5-coder:3b");
  assert.equal(body.stream, false);
  assert.equal(body.format, "json");
  assert.equal(body.options.temperature, 0.1);
  assert.equal(body.options.num_predict, 1400);
  assert.equal(body.options.num_ctx, 4096);
  assert.equal(body.options.seed, 42);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /Output ONLY a JSON object/i);
  assert.match(body.messages[0].content, /max\(8, ceil\(seconds\*2\)\)/);
  assert.match(body.messages[0].content, /not a silent logo/i);
  assert.match(
    body.messages[0].content,
    /hook, friction, problem, reveal, proof, ecosystem, benefit, cta, close/,
  );
  assert.match(body.messages[0].content, /props MUST always be a JSON object/i);
  assert.match(body.messages[0].content, /No markdown, fences, reasoning, or wrappers/);
  assert.ok(body.messages[0].content.length < 2800);
  assert.equal(body.messages[0].content.includes("```json"), false);
  assert.equal(body.messages[1].role, "user");
  assert.match(body.messages[1].content, /Tables is an AI-powered/);
  assert.match(body.messages[1].content, /Use only these facts/);
  assert.match(body.messages[1].content, /Return only the storyboard JSON/);
  assert.equal(body.messages[1].content.includes(DESCRIPTION), true);
});

test("Ollama generation options can be set from the environment", async () => {
  process.env.OLLAMA_TEMPERATURE = "0.2";
  process.env.OLLAMA_NUM_PREDICT = "900";
  process.env.OLLAMA_NUM_CTX = "3072";
  const { fetchImpl, calls } = mockFetch(async () =>
    ollamaChatResponse(JSON.stringify(VALID_STORYBOARD)),
  );

  const result = await generateStoryboardWithOllama(DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, true);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.options.temperature, 0.2);
  assert.equal(body.options.num_predict, 900);
  assert.equal(body.options.num_ctx, 3072);
  assert.equal(body.format, "json");
});

test("valid Ollama JSON is validated and returned", async () => {
  const { fetchImpl } = mockFetch(async () =>
    ollamaChatResponse(JSON.stringify(VALID_STORYBOARD)),
  );

  const result = await generateStoryboardFromDescription(DESCRIPTION, {
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.storyboard.scenes.length, 4);
  assert.equal(result.storyboard.scenes[0].type, "logo-intro");
  assert.equal(result.storyboard.scenes.at(-1).type, "cta-outro");
  assert.equal(result.storyboard.audio.voiceover.enabled, true);
  assert.equal(result.storyboard.scenes[0].voiceover.enabled, false);
  assert.equal(result.storyboard.scenes[2].voiceover.enabled, true);
});

test("invalid JSON from Ollama returns a controlled 502", async () => {
  const { fetchImpl } = mockFetch(async () =>
    ollamaChatResponse("this is not json"),
  );

  const result = await generateStoryboardWithOllama(DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.match(result.error, /invalid JSON/);
});

test("Ollama unavailable returns 503", async () => {
  const err = new Error("fetch failed");
  err.cause = { code: "ECONNREFUSED" };
  const { fetchImpl, calls } = mockFetch(async () => {
    throw err;
  });

  const result = await generateStoryboardWithOllama(DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /Ollama is not running/);
  assert.equal(calls.length, 1);
});

test("missing Ollama model returns a clear 503", async () => {
  const { fetchImpl } = mockFetch(async () =>
    jsonResponse(404, {
      error: "model 'qwen2.5-coder:3b' not found, try pulling it first",
    }),
  );

  const result = await generateStoryboardWithOllama(DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /qwen2.5-coder:3b/);
  assert.match(result.error, /not found/i);
});

test("storyboard validation failure returns 422 with details", async () => {
  const invalid = {
    scenes: [
      {
        type: "cta-outro",
        duration: 60,
        props: { headline: "Nope", sub: "Wrong start" },
      },
    ],
  };
  const { fetchImpl } = mockFetch(async () =>
    ollamaChatResponse(JSON.stringify(invalid)),
  );

  const result = await generateStoryboardWithOllama(DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.error, /did not match the storyboard schema/);
  assert.ok(Array.isArray(result.details));
  assert.ok(result.details.length > 0);
});

test("invalid role and non-object props are rejected by AJV", async () => {
  const invalid = {
    audio: {
      music: { enabled: true, mood: "premium cinematic saas" },
      voiceover: {
        enabled: true,
        script: "short spoken film",
        tone: "confident, warm, premium",
        pace: "natural",
      },
    },
    scenes: [
      {
        type: "logo-intro",
        duration: 48,
        role: "opening",
        props: '{"productName":"Tables"}',
        voiceover: { enabled: true, script: "Find prospects faster." },
      },
      {
        type: "text-reveal",
        duration: 60,
        role: "pain-point",
        props: "scattered tools",
        voiceover: { enabled: true, script: "Stop hopping between workflows." },
      },
      {
        type: "text-reveal",
        duration: 120,
        role: "value",
        props: ["One intelligent workspace."],
        voiceover: {
          enabled: true,
          script: "Connect the right people in one place.",
        },
      },
      {
        type: "stat-callout",
        duration: 150,
        role: "metric",
        props: "297M+",
        voiceover: { enabled: true, script: "Reach more of the right people." },
      },
      {
        type: "cta-outro",
        duration: 48,
        role: "end",
        props: '{"headline":"Go","sub":"Now"}',
        voiceover: { enabled: true, script: "Start connecting today." },
      },
    ],
  };
  const { fetchImpl, calls } = mockFetch(async () =>
    ollamaChatResponse(JSON.stringify(invalid)),
  );

  const result = await generateStoryboardWithOllama(DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.error, /did not match the storyboard schema/);
  assert.ok(Array.isArray(result.details));
  const details = result.details.join("\n");
  assert.match(details, /\/scenes\/0\/role/);
  assert.match(details, /allowed values/);
  assert.match(details, /\/scenes\/0\/props/);
  assert.match(details, /must be object/);
  assert.equal(calls.length, 1);
});

test("Ollama disables voiceover on short hook after schema validation", async () => {
  const invalid = structuredClone(VALID_STORYBOARD);
  invalid.scenes[0].voiceover = { enabled: false, script: "" };
  const { fetchImpl } = mockFetch(async () =>
    ollamaChatResponse(JSON.stringify(invalid)),
  );

  const result = await generateStoryboardWithOllama(DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, true, result.details?.join("\n") || result.error);
  assert.equal(result.storyboard.scenes[0].voiceover.enabled, false);
});

test("duplicate CTA voiceover is repaired before director checks", async () => {
  const duplicate = structuredClone(VALID_STORYBOARD);
  duplicate.scenes.at(-1).duration = 90;
  duplicate.scenes.at(-1).voiceover.script = duplicate.scenes.at(-1).props.headline;
  const rawDirector = validateOllamaDirectorOutput(duplicate, TABLES_DESCRIPTION);
  assert.equal(rawDirector.ok, false);
  const { fetchImpl } = mockFetch(async () =>
    ollamaChatResponse(JSON.stringify(duplicate)),
  );

  const result = await generateStoryboardWithOllama(TABLES_DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, true, result.details?.join("\n") || result.error);
  assert.notEqual(
    result.storyboard.scenes.at(-1).voiceover.script,
    duplicate.scenes.at(-1).props.headline,
  );
  assert.equal(
    result.storyboard.scenes.at(-1).props.headline,
    duplicate.scenes.at(-1).props.headline,
  );
});

test("invalid Qwen VO is replaced before director validation", async () => {
  const qwen = structuredClone(VALID_STORYBOARD);
  qwen.scenes[0].duration = 54;
  qwen.scenes[0].voiceover = {
    enabled: true,
    script: "Discover and connect with the right prospects faster today now",
  };
  qwen.scenes[1].duration = 66;
  qwen.scenes[1].voiceover = {
    enabled: true,
    script: "Sales teams waste time hopping between scattered tools every single day",
  };
  const rawDirector = validateOllamaDirectorOutput(qwen, TABLES_DESCRIPTION);
  assert.equal(rawDirector.ok, false);

  const { fetchImpl } = mockFetch(async () => ollamaChatResponse(JSON.stringify(qwen)));
  const result = await generateStoryboardWithOllama(TABLES_DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, true, result.details?.join("\n") || result.error);
  assert.equal(result.storyboard.scenes[0].voiceover.enabled, false);
  assert.equal(result.storyboard.scenes[1].voiceover.enabled, false);
});

test("short scenes get VO disabled before director validation", () => {
  const qwen = structuredClone(VALID_STORYBOARD);
  qwen.scenes[0].duration = 54;
  qwen.scenes[0].voiceover = { enabled: true, script: "Find prospects faster." };
  qwen.scenes[1].duration = 66;
  qwen.scenes[1].voiceover = {
    enabled: true,
    script: "Stop hopping between workflows every day.",
  };
  qwen.scenes[2].duration = 72;
  qwen.scenes[2].voiceover = {
    enabled: true,
    script: "Connect the right people in one intelligent workspace.",
  };
  assert.equal(validateOllamaDirectorOutput(qwen, TABLES_DESCRIPTION).ok, false);

  const finalized = finalizeOllamaStoryboard(qwen, TABLES_DESCRIPTION);
  assert.equal(finalized.ok, true, finalized.details?.join("\n") || finalized.error);
  assert.equal(finalized.storyboard.scenes[0].voiceover.enabled, false);
  assert.equal(finalized.storyboard.scenes[1].voiceover.enabled, false);
  assert.equal(finalized.storyboard.scenes[2].voiceover.enabled, false);
});

test("120-frame scenes get deterministic VO fill before director validation", () => {
  const qwen = structuredClone(VALID_STORYBOARD);
  qwen.scenes[2].duration = 120;
  qwen.scenes[2].voiceover = {
    enabled: true,
    script:
      "This ridiculously long voiceover from Qwen will never pass director checks at all",
  };
  assert.equal(validateOllamaDirectorOutput(qwen, TABLES_DESCRIPTION).ok, false);

  const finalized = finalizeOllamaStoryboard(qwen, TABLES_DESCRIPTION);
  assert.equal(finalized.ok, true, finalized.details?.join("\n") || finalized.error);
  assert.equal(finalized.storyboard.scenes[2].voiceover.enabled, true);
  assert.notEqual(
    finalized.storyboard.scenes[2].voiceover.script,
    qwen.scenes[2].voiceover.script,
  );
});

test("final repaired storyboard passes director checks", async () => {
  const qwen = structuredClone(VALID_STORYBOARD);
  qwen.scenes[0].duration = 54;
  qwen.scenes[0].voiceover = {
    enabled: true,
    script: "Discover and connect with the right prospects faster today now",
  };
  qwen.scenes[1].duration = 66;
  qwen.scenes[1].voiceover = {
    enabled: true,
    script: "Sales teams waste time hopping between scattered tools every single day",
  };
  qwen.scenes[2].duration = 120;
  qwen.scenes[2].voiceover = {
    enabled: true,
    script:
      "This ridiculously long voiceover from Qwen will never pass director checks at all",
  };
  qwen.scenes.at(-1).duration = 90;
  qwen.scenes.at(-1).voiceover.script = qwen.scenes.at(-1).props.headline;
  assert.equal(validateOllamaDirectorOutput(qwen, TABLES_DESCRIPTION).ok, false);

  const { fetchImpl } = mockFetch(async () => ollamaChatResponse(JSON.stringify(qwen)));
  const result = await generateStoryboardWithOllama(TABLES_DESCRIPTION, { fetchImpl });
  assert.equal(result.ok, true, result.details?.join("\n") || result.error);
  const directed = validateOllamaDirectorOutput(
    result.storyboard,
    TABLES_DESCRIPTION,
  );
  assert.equal(directed.ok, true, directed.details?.join("\n"));
});

test("short CTA with generated VO is disabled before director validation", () => {
  const board = structuredClone(VALID_STORYBOARD);
  board.scenes.forEach((scene, index) => {
    if (index < board.scenes.length - 1) {
      scene.duration = 120;
      scene.voiceover.enabled = true;
    }
  });
  const cta = board.scenes.at(-1);
  cta.duration = 42;
  cta.voiceover = {
    enabled: true,
    script: cta.props.headline,
  };

  const result = finalizeOllamaStoryboard(board, TABLES_DESCRIPTION);
  assert.equal(result.ok, true, result.details?.join("\n") || result.error);
  assert.equal(result.storyboard.scenes.at(-1).voiceover.enabled, false);
  assert.equal(result.storyboard.scenes.at(-1).voiceover.script, "");
});

test("Ollama disables voiceover on a 54-frame hook", async () => {
  const board = structuredClone(VALID_STORYBOARD);
  board.scenes[0].duration = 54;
  board.scenes[0].voiceover.script =
    "Discover and connect with the right prospects faster.";
  const { fetchImpl } = mockFetch(async () =>
    ollamaChatResponse(JSON.stringify(board)),
  );

  const result = await generateStoryboardWithOllama(
    "Tables is an AI-powered customer intelligence platform that helps sales teams discover and connect with the right prospects faster. It provides access to 297M+ professional profiles and connects customer data across LinkedIn and HubSpot, helping teams replace fragmented workflows with one intelligent workspace.",
    { fetchImpl },
  );
  assert.equal(result.ok, true, result.details?.join("\n") || result.error);
  assert.equal(result.storyboard.scenes[0].voiceover.enabled, false);
});

test("Qwen string lines and invalid iconColors are normalized before AJV", async () => {
  const qwen = {
    audio: {
      music: { enabled: true, mood: "premium cinematic saas" },
      voiceover: {
        enabled: true,
        script: "short spoken film",
        tone: "confident, warm, premium",
        pace: "natural",
      },
    },
    scenes: [
      {
        type: "logo-intro",
        duration: 48,
        role: "hook",
        props: { productName: "Tables" },
        voiceover: { enabled: false, script: "" },
      },
      {
        type: "text-reveal",
        duration: 66,
        role: "friction",
        props: {
          lines: "Sales teams struggle with fragmented workflows.",
        },
        voiceover: { enabled: false, script: "" },
      },
      {
        type: "stat-callout",
        duration: 120,
        role: "benefit",
        props: { value: "297", suffix: "M+", label: "professional profiles" },
        voiceover: {
          enabled: true,
          script: "Tables provides access to 297M+ professional profiles.",
        },
      },
      {
        type: "icon-grid",
        duration: 72,
        role: "ecosystem",
        props: {
          caption: "Connect customer data across LinkedIn and HubSpot",
          iconColors: ["LinkedIn Blue", "HubSpot Orange"],
          labels: ["LinkedIn", "HubSpot"],
        },
        voiceover: { enabled: false, script: "" },
      },
      {
        type: "cta-outro",
        duration: 90,
        role: "cta",
        props: { headline: "Discover. Connect.", sub: "Work from one workspace." },
        voiceover: { enabled: true, script: "Start connecting today." },
      },
    ],
  };
  const raw = JSON.stringify(qwen);

  const rawAjv = validateStoryboard(qwen);
  assert.equal(rawAjv.ok, false);
  assert.match(
    JSON.stringify(rawAjv.errors),
    /\/scenes\/1\/props\/lines.*must be array/,
  );
  assert.match(
    JSON.stringify(rawAjv.errors),
    /\/scenes\/3\/props\/iconColors\/0.*pattern/,
  );

  const directorPath = parseAndValidateStoryboard(raw);
  assert.equal(directorPath.ok, false);
  assert.equal(directorPath.status, 422);

  const normalizedPath = parseNormalizeAndValidateOllamaStoryboard(raw);
  assert.equal(
    normalizedPath.ok,
    true,
    normalizedPath.details?.join("\n") || normalizedPath.error,
  );
  assert.ok(Array.isArray(normalizedPath.storyboard.scenes[1].props.lines));
  for (const color of normalizedPath.storyboard.scenes[3].props.iconColors) {
    assert.equal(isValidHexColor(color), true);
  }

  const { fetchImpl } = mockFetch(async () => ollamaChatResponse(raw));
  const result = await generateStoryboardWithOllama(TABLES_DESCRIPTION, {
    fetchImpl,
  });
  assert.equal(result.ok, true, result.details?.join("\n") || result.error);
  assert.ok(Array.isArray(result.storyboard.scenes[1].props.lines));
  for (const color of result.storyboard.scenes[3].props.iconColors) {
    assert.equal(isValidHexColor(color), true);
  }
});

test("Ollama does not retry after a failed request", async () => {
  const { fetchImpl, calls } = mockFetch(async () => {
    throw Object.assign(new Error("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
  });

  await generateStoryboardWithOllama(DESCRIPTION, { fetchImpl });
  assert.equal(calls.length, 1);
});
