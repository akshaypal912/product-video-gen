import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, test } from "node:test";
import { resolveLlmProvider, getLlmStatus } from "../server/lib/storyboard-generation.mjs";
import { projectRoot } from "../scripts/lib/storyboard.mjs";

const originalProvider = process.env.LLM_PROVIDER;

afterEach(() => {
  if (originalProvider == null) {
    delete process.env.LLM_PROVIDER;
  } else {
    process.env.LLM_PROVIDER = originalProvider;
  }
});

test("unset LLM_PROVIDER selects mistral", () => {
  delete process.env.LLM_PROVIDER;
  const resolved = resolveLlmProvider();
  assert.equal(resolved.ok, true);
  assert.equal(resolved.name, "mistral");
});

test("LLM_PROVIDER=mistral selects mistral", () => {
  process.env.LLM_PROVIDER = "mistral";
  const resolved = resolveLlmProvider();
  assert.equal(resolved.ok, true);
  assert.equal(resolved.name, "mistral");
});

test("LLM_PROVIDER=ollama selects ollama", () => {
  process.env.LLM_PROVIDER = "ollama";
  const resolved = resolveLlmProvider();
  assert.equal(resolved.ok, true);
  assert.equal(resolved.name, "ollama");
  const status = getLlmStatus();
  assert.equal(status.provider, "ollama");
  assert.equal(status.configured, true);
});

test("LLM_PROVIDER is case-insensitive", () => {
  process.env.LLM_PROVIDER = "OLLAMA";
  assert.equal(resolveLlmProvider().name, "ollama");
});

test("unknown LLM_PROVIDER is rejected", () => {
  process.env.LLM_PROVIDER = "opencode";
  const resolved = resolveLlmProvider();
  assert.equal(resolved.ok, false);
  assert.equal(resolved.status, 400);
  assert.match(resolved.error, /Unknown LLM_PROVIDER/);
});

test("Mistral storyboard path does not fill Ollama voiceover", () => {
  const src = readFileSync(
    resolve(projectRoot, "server/lib/mistral-storyboard.mjs"),
    "utf8",
  );
  assert.equal(src.includes("fillOllamaVoiceoverScripts"), false);
});
