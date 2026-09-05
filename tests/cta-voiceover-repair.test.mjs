import assert from "node:assert/strict";
import { test } from "node:test";
import { VALID_STORYBOARD } from "./helpers.mjs";
import {
  repairCtaVoiceover,
  needsCtaVoiceoverRepair,
} from "../server/lib/llm/cta-voiceover-repair.mjs";
import { validateOllamaDirectorOutput } from "../server/lib/llm/ollama-director-rules.mjs";
import { copiesExactOnScreenCopy } from "../server/lib/llm/ollama-director-rules.mjs";
import { disableOllamaShortSceneVoiceover } from "../server/lib/llm/ollama-voiceover-fill.mjs";

const SHORT_DESCRIPTION =
  "Tables is an AI-powered customer intelligence platform that helps sales teams discover and connect with the right prospects faster.";

const TABLES_DESCRIPTION =
  "Tables is an AI-powered customer intelligence platform that helps sales teams discover and connect with the right prospects faster. It provides access to 297M+ professional profiles and connects customer data across LinkedIn and HubSpot, helping teams replace fragmented workflows with one intelligent workspace.";

function cloneBoard() {
  return structuredClone(VALID_STORYBOARD);
}

function snapshotExceptCtaScript(board) {
  const copy = structuredClone(board);
  for (const scene of copy.scenes) {
    if (scene.type === "cta-outro" || scene.role === "cta" || scene.role === "close") {
      if (scene.voiceover) delete scene.voiceover.script;
    }
  }
  return copy;
}

test("exact CTA/headline duplication is repaired", () => {
  const board = cloneBoard();
  const cta = board.scenes.at(-1);
  cta.props.headline = "Start connecting today.";
  cta.props.sub = "Tables";
  cta.voiceover.script = "Start connecting today.";
  assert.equal(needsCtaVoiceoverRepair(cta), true);

  const repaired = repairCtaVoiceover(board, SHORT_DESCRIPTION);
  const next = repaired.scenes.at(-1);
  assert.notEqual(next.voiceover.script, "Start connecting today.");
  assert.equal(next.props.headline, "Start connecting today.");
  assert.equal(next.props.sub, "Tables");
  assert.equal(next.duration, cta.duration);
  assert.equal(next.role, "cta");
  assert.equal(
    copiesExactOnScreenCopy(next.voiceover.script, [
      next.props.headline,
      next.props.sub,
    ]),
    false,
  );
  const directed = validateOllamaDirectorOutput(
    disableOllamaShortSceneVoiceover(repaired),
    SHORT_DESCRIPTION,
  );
  assert.equal(directed.ok, true, directed.details?.join("\n"));
});

test("exact CTA/sub duplication is repaired", () => {
  const board = cloneBoard();
  const cta = board.scenes.at(-1);
  cta.voiceover.script = cta.props.sub;
  const repaired = repairCtaVoiceover(board, SHORT_DESCRIPTION);
  const next = repaired.scenes.at(-1);
  assert.notEqual(next.voiceover.script, cta.props.sub);
  assert.equal(next.props.sub, "Work from one workspace.");
  const directed = validateOllamaDirectorOutput(
    disableOllamaShortSceneVoiceover(repaired),
    SHORT_DESCRIPTION,
  );
  assert.equal(directed.ok, true, directed.details?.join("\n"));
});

test("punctuation-only CTA difference is repaired", () => {
  const board = cloneBoard();
  const cta = board.scenes.at(-1);
  cta.props.headline = "Grow faster";
  cta.props.sub = "Start connecting today!";
  cta.voiceover.script = "Start connecting today.";
  const repaired = repairCtaVoiceover(board, SHORT_DESCRIPTION);
  const next = repaired.scenes.at(-1);
  assert.notEqual(next.voiceover.script, "Start connecting today.");
  assert.equal(next.props.sub, "Start connecting today!");
  const directed = validateOllamaDirectorOutput(
    disableOllamaShortSceneVoiceover(repaired),
    SHORT_DESCRIPTION,
  );
  assert.equal(directed.ok, true, directed.details?.join("\n"));
});

test("non-duplicate CTA is unchanged", () => {
  const board = cloneBoard();
  const original = JSON.stringify(board);
  const repaired = repairCtaVoiceover(board, SHORT_DESCRIPTION);
  assert.equal(repaired, board);
  assert.equal(JSON.stringify(repaired), original);
  assert.equal(repaired.scenes.at(-1).voiceover.script, "Start connecting today.");
});

test("non-CTA scenes are unchanged", () => {
  const board = cloneBoard();
  board.scenes.at(-1).voiceover.script = board.scenes.at(-1).props.headline;
  const before = snapshotExceptCtaScript(board);
  const repaired = repairCtaVoiceover(board, TABLES_DESCRIPTION);
  assert.deepEqual(snapshotExceptCtaScript(repaired), before);
  assert.equal(repaired.scenes[0].voiceover.script, board.scenes[0].voiceover.script);
  assert.equal(repaired.scenes[1].props.lines[0], "Scattered tools stall every deal.");
  assert.equal(repaired.audio.music.enabled, true);
});

test("repaired CTA reuses existing benefit language when it fits", () => {
  const board = cloneBoard();
  board.scenes.at(-1).voiceover.script = board.scenes.at(-1).props.headline;
  const repaired = repairCtaVoiceover(board, SHORT_DESCRIPTION);
  assert.equal(repaired.scenes.at(-1).voiceover.script, "One intelligent workspace.");
});

test("repair does not introduce Salesforce or invented stats", () => {
  const board = cloneBoard();
  board.scenes.at(-1).voiceover.script = board.scenes.at(-1).props.headline;
  const repaired = repairCtaVoiceover(board, SHORT_DESCRIPTION);
  const blob = JSON.stringify(repaired);
  assert.equal(/salesforce/i.test(blob), false);
  assert.equal(blob.includes("297"), false);
});
