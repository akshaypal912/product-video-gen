import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { projectRoot } from "../scripts/lib/storyboard.mjs";
import { isVoiceoverRequested, prepareVoiceover } from "../scripts/lib/voiceover.mjs";
import { VALID_STORYBOARD } from "./helpers.mjs";
import {
  applyOllamaVoiceoverPolicy,
  disableOllamaShortSceneVoiceover,
} from "../server/lib/llm/ollama-voiceover-fill.mjs";
import {
  ollamaSceneRequiresVoiceover,
  sceneVoiceoverAudioSlotSeconds,
  validateOllamaDirectorOutput,
  wordCount,
} from "../server/lib/llm/ollama-director-rules.mjs";

const TABLES_DESCRIPTION =
  "Tables is an AI-powered customer intelligence platform that helps sales teams discover and connect with the right prospects faster. It provides access to 297M+ professional profiles and connects customer data across LinkedIn and HubSpot, helping teams replace fragmented workflows with one intelligent workspace.";

function e2eLikeBoard() {
  return {
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
        duration: 54,
        role: "hook",
        props: { productName: "Tables" },
        voiceover: {
          enabled: true,
          script: "Sales teams discover and connect.",
        },
      },
      {
        type: "text-reveal",
        duration: 66,
        role: "friction",
        props: { lines: ["Sales teams struggle with fragmented workflows."] },
        voiceover: { enabled: true, script: "placeholder" },
      },
      {
        type: "stat-callout",
        duration: 120,
        role: "benefit",
        props: { value: "297", suffix: "M+", label: "professional profiles" },
        voiceover: { enabled: true, script: "placeholder" },
      },
      {
        type: "icon-grid",
        duration: 72,
        role: "ecosystem",
        props: {
          caption: "Connect customer data across LinkedIn and HubSpot",
          iconColors: ["#1DA1F2", "#4267B2"],
          labels: ["LinkedIn", "HubSpot"],
        },
        voiceover: { enabled: true, script: "placeholder" },
      },
      {
        type: "cta-outro",
        duration: 54,
        role: "cta",
        props: {
          headline: "Start your free trial today",
          sub: "Discover the power of Tables",
        },
        voiceover: { enabled: true, script: "placeholder" },
      },
    ],
  };
}

test("54-frame hook disables voiceover", () => {
  const board = e2eLikeBoard();
  const policy = applyOllamaVoiceoverPolicy(board, TABLES_DESCRIPTION);
  assert.equal(policy.scenes[0].voiceover.enabled, false);
  assert.ok(sceneVoiceoverAudioSlotSeconds(54) < 2.5);
  const directed = validateOllamaDirectorOutput(policy, TABLES_DESCRIPTION);
  assert.equal(directed.ok, true, directed.details?.join("\n"));
});

test("66-frame scene disables voiceover", () => {
  const board = e2eLikeBoard();
  const policy = applyOllamaVoiceoverPolicy(board, TABLES_DESCRIPTION);
  assert.equal(policy.scenes[1].voiceover.enabled, false);
  assert.ok(sceneVoiceoverAudioSlotSeconds(66) < 2.5);
});

test("72-frame scene disables voiceover", () => {
  const board = e2eLikeBoard();
  const policy = applyOllamaVoiceoverPolicy(board, TABLES_DESCRIPTION);
  assert.equal(policy.scenes[3].voiceover.enabled, false);
  assert.ok(sceneVoiceoverAudioSlotSeconds(72) < 2.5);
});

test("120-frame scene keeps voiceover enabled with a filled script", () => {
  const board = e2eLikeBoard();
  const policy = applyOllamaVoiceoverPolicy(board, TABLES_DESCRIPTION);
  assert.equal(policy.scenes[2].voiceover.enabled, true);
  assert.ok(ollamaSceneRequiresVoiceover(policy.scenes[2]));
  assert.ok(wordCount(policy.scenes[2].voiceover.script) >= 3);
  const directed = validateOllamaDirectorOutput(policy, TABLES_DESCRIPTION);
  assert.equal(directed.ok, true, directed.details?.join("\n"));
});

test("disabled short scenes skip Piper synthesis", async () => {
  const board = e2eLikeBoard();
  const policy = applyOllamaVoiceoverPolicy(board, TABLES_DESCRIPTION);
  let calls = 0;
  await prepareVoiceover(policy, {
    skipFilesystem: true,
    findManualNarration: () => null,
    isTtsEnabled: () => true,
    generateVoiceover: async () => {
      calls += 1;
    },
    probeDurationSeconds: async () => 2.5,
  });
  assert.equal(calls, 1);
});

test("BGM remains when short scenes disable voiceover", () => {
  const board = e2eLikeBoard();
  const policy = applyOllamaVoiceoverPolicy(board, TABLES_DESCRIPTION);
  assert.equal(policy.audio.music.enabled, true);
  assert.equal(isVoiceoverRequested(policy), true);
});

test("enabled VO on a short slot is rejected by director checks", () => {
  const board = e2eLikeBoard();
  const disabled = disableOllamaShortSceneVoiceover(board);
  disabled.scenes[0].voiceover.enabled = true;
  disabled.scenes[0].voiceover.script = "Discover prospects faster.";
  const directed = validateOllamaDirectorOutput(disabled, TABLES_DESCRIPTION);
  assert.equal(directed.ok, false);
  assert.match(directed.details.join("\n"), /must have voiceover disabled/i);
});

test("fill does not introduce unsupported facts on longer scenes", () => {
  const board = structuredClone(VALID_STORYBOARD);
  board.scenes.forEach((scene) => {
    scene.duration = 120;
  });
  const policy = applyOllamaVoiceoverPolicy(board, TABLES_DESCRIPTION);
  const blob = JSON.stringify(policy.scenes.map((s) => s.voiceover));
  assert.equal(/salesforce/i.test(blob), false);
  assert.equal(/slack/i.test(blob), false);
  assert.equal(blob.includes("400M"), false);
  const directed = validateOllamaDirectorOutput(policy, TABLES_DESCRIPTION);
  assert.equal(directed.ok, true, directed.details?.join("\n"));
});

test("Mistral provider module does not import Ollama VO fill", () => {
  const src = readFileSync(
    resolve(projectRoot, "server/lib/mistral-storyboard.mjs"),
    "utf8",
  );
  assert.equal(src.includes("ollama-voiceover-fill"), false);
  assert.equal(src.includes("fillOllamaVoiceoverScripts"), false);
  assert.equal(src.includes("cta-voiceover-repair"), false);
});
