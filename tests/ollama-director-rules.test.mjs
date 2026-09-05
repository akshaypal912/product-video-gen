import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "../scripts/lib/storyboard.mjs";
import { VALID_STORYBOARD } from "./helpers.mjs";
import {
  maxVoiceoverWords,
  validateOllamaDirectorOutput,
  voiceoverFitsScene,
  wordCount,
} from "../server/lib/llm/ollama-director-rules.mjs";
import { applyOllamaVoiceoverPolicy, disableOllamaShortSceneVoiceover } from "../server/lib/llm/ollama-voiceover-fill.mjs";

const TABLES_DESCRIPTION =
  "Tables is an AI-powered customer intelligence platform that helps sales teams discover and connect with the right prospects faster. It provides access to 297M+ professional profiles and connects customer data across LinkedIn and HubSpot, helping teams replace fragmented workflows with one intelligent workspace.";

const SHORT_DESCRIPTION =
  "Tables is an AI-powered customer intelligence platform that helps sales teams discover and connect with the right prospects faster.";

function cloneBoard() {
  return structuredClone(VALID_STORYBOARD);
}

function directorBoard() {
  return disableOllamaShortSceneVoiceover(cloneBoard());
}

test("Ollama director prompt stays compact and encodes 3B constraints", () => {
  const prompt = readFileSync(
    resolve(projectRoot, "prompts/storyboard-director-ollama.md"),
    "utf8",
  );
  assert.ok(prompt.length < 2800);
  assert.match(prompt, /Output ONLY a JSON object/i);
  assert.match(prompt, /3-5 words/);
  assert.match(prompt, /54f→5/);
  assert.match(prompt, /max\(8, ceil\(seconds\*2\)\)/);
  assert.match(prompt, /Never invent/i);
  assert.match(prompt, /Salesforce/i);
  assert.match(prompt, /not a silent logo/i);
  assert.match(prompt, /Never copy an entire on-screen sentence/i);
  assert.match(
    prompt,
    /hook, friction, problem, reveal, proof, ecosystem, benefit, cta, close/,
  );
  assert.match(prompt, /props MUST always be a JSON object/i);
  assert.match(prompt, /"type":"...","duration":60,"role":"hook","props":\{\}/);
  assert.match(prompt, /wrappers \(storyboard, result, output, data\)/);
  assert.equal(prompt.includes("```json"), false);
});

test("max voiceover words is duration-aware: short scenes cap at 3-5, longer keep 2.0 wps + 8 floor", () => {
  assert.equal(maxVoiceoverWords(54), 5);
  assert.equal(maxVoiceoverWords(66), 8);
  assert.equal(maxVoiceoverWords(108), 8);
  assert.equal(maxVoiceoverWords(150), 10);
  assert.equal(wordCount("Find prospects faster."), 3);
  assert.equal(voiceoverFitsScene("Find prospects faster.", 54), true);
  assert.equal(voiceoverFitsScene("Find the right people faster.", 54), true);
  assert.equal(voiceoverFitsScene("Find the right people faster with Tables now.", 54), false);
  assert.equal(
    voiceoverFitsScene(
      "Discover and connect with the right prospects faster today.",
      66,
    ),
    false,
  );
});

test("54 frames rejects enabled voiceover", () => {
  const board = cloneBoard();
  board.scenes[0].duration = 54;
  board.scenes[0].voiceover.enabled = true;
  board.scenes[0].voiceover.script = "Find the right people faster with Tables now.";
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /must have voiceover disabled/i);
});

test("54 frames allows disabled voiceover", () => {
  const board = directorBoard();
  board.scenes[0].duration = 54;
  board.scenes[0].voiceover = { enabled: false, script: "" };
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, true, result.details?.join("\n"));
});

test("66 frames rejects enabled voiceover", () => {
  const board = cloneBoard();
  board.scenes[1].duration = 66;
  board.scenes[1].voiceover.enabled = true;
  board.scenes[1].voiceover.script = "Stop hopping tools.";
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /must have voiceover disabled/i);
});
test("66 frames on a long slot allows a short script but rejects long speech", () => {
  const board = directorBoard();
  board.scenes[1].duration = 90;
  board.scenes[1].voiceover.enabled = true;
  board.scenes[1].voiceover.script = "Stop hopping tools.";
  assert.equal(wordCount(board.scenes[1].voiceover.script), 3);
  let result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, true, result.details?.join("\n"));

  board.scenes[1].voiceover.script =
    "Stop hopping between tools that scatter every deal you still work on.";
  assert.equal(wordCount(board.scenes[1].voiceover.script), 12);
  result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /allows at most 8/);
});
test("very long voiceover on a long slot scene is still rejected", () => {
  const board = directorBoard();
  board.scenes[1].duration = 90;
  board.scenes[1].voiceover.enabled = true;
  board.scenes[1].voiceover.script =
    "Discover and connect with the right prospects faster across every disconnected workflow you still use today.";
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /allows at most 8/);
});

test("compliant storyboard passes director rules after Ollama VO policy", () => {
  const result = validateOllamaDirectorOutput(
    applyOllamaVoiceoverPolicy(cloneBoard(), SHORT_DESCRIPTION),
    SHORT_DESCRIPTION,
  );
  assert.equal(result.ok, true);
});

test("silent hook on a long slot is rejected", () => {
  const board = directorBoard();
  board.scenes[2].voiceover = { enabled: false, script: "" };
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.details.join("\n"), /needs voiceover.enabled true/i);
});

test("silent hook on a short slot is allowed when disabled", () => {
  const board = directorBoard();
  board.scenes[0].duration = 54;
  board.scenes[0].voiceover = { enabled: false, script: "" };
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, true, result.details?.join("\n"));
});

test("friction feature dump is rejected", () => {
  const board = cloneBoard();
  board.scenes[1].props.lines = [
    "Discover and connect with the right prospects faster.",
    "Access 297M+ professional profiles.",
    "Connect customer data across LinkedIn and HubSpot.",
  ];
  const result = validateOllamaDirectorOutput(board, TABLES_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /feature dump/i);
});

test("voiceover that copies on-screen copy is rejected", () => {
  const board = directorBoard();
  board.scenes[1].duration = 90;
  board.scenes[1].voiceover.enabled = true;
  board.scenes[1].voiceover.script = board.scenes[1].props.lines[0];
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /must not duplicate on-screen copy/i);
});

test("non-CTA voiceover that embeds a full on-screen sentence is rejected", () => {
  const board = directorBoard();
  board.scenes[1].duration = 90;
  board.scenes[1].voiceover.enabled = true;
  board.scenes[1].voiceover.script = `${board.scenes[1].props.lines[0]} now.`;
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /must not duplicate on-screen copy/i);
});

test("exact CTA headline duplication is rejected", () => {
  const board = directorBoard();
  const cta = board.scenes.at(-1);
  cta.duration = 90;
  cta.voiceover.enabled = true;
  cta.props.headline = "Start connecting today.";
  cta.props.sub = "Tables";
  cta.voiceover.script = "Start connecting today.";
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /must not duplicate on-screen copy/i);
});

test("identical CTA sentence with different punctuation is rejected", () => {
  const board = directorBoard();
  const cta = board.scenes.at(-1);
  cta.duration = 90;
  cta.voiceover.enabled = true;
  cta.props.headline = "Grow faster";
  cta.props.sub = "Start connecting today!";
  cta.voiceover.script = "Start connecting today.";
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /must not duplicate on-screen copy/i);
});

test("CTA voiceover with a few shared words still passes", () => {
  const board = directorBoard();
  const cta = board.scenes.at(-1);
  cta.duration = 90;
  cta.voiceover.enabled = true;
  cta.props.headline = "Start connecting with the right prospects";
  cta.props.sub = "Work from one intelligent workspace.";
  cta.voiceover.script = "Start connecting today.";
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, true, result.details?.join("\n"));
});

test("complementary CTA voiceover that extends on-screen copy still passes", () => {
  const board = directorBoard();
  const cta = board.scenes.at(-1);
  cta.duration = 90;
  cta.voiceover.enabled = true;
  cta.props.headline = "Discover. Connect.";
  cta.props.sub = "Work from one intelligent workspace.";
  cta.voiceover.script = "Start connecting today.";
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, true, result.details?.join("\n"));
});

test("CTA voiceover that adds a word to the on-screen sub still passes", () => {
  const board = directorBoard();
  const cta = board.scenes.at(-1);
  cta.duration = 90;
  cta.voiceover.enabled = true;
  cta.props.headline = "Discover. Connect.";
  cta.props.sub = "Work from one intelligent workspace.";
  cta.voiceover.script = "Work from one workspace today.";
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, true, result.details?.join("\n"));
});

test("eight words on 108 frames is accepted", () => {
  const board = directorBoard();
  board.scenes[2].duration = 108;
  board.scenes[2].voiceover.enabled = true;
  board.scenes[2].voiceover.script = "Keep all buying context in one workspace now.";
  assert.equal(wordCount(board.scenes[2].voiceover.script), 8);
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, true, result.details?.join("\n"));
});

test("CTA voiceover that repeats earlier narration is rejected", () => {
  const board = directorBoard();
  board.scenes[0].duration = 90;
  board.scenes[0].voiceover.enabled = true;
  board.scenes[0].voiceover.script = "Find prospects faster.";
  board.scenes.at(-1).duration = 90;
  board.scenes.at(-1).voiceover.enabled = true;
  board.scenes.at(-1).voiceover.script = board.scenes[0].voiceover.script;
  const result = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /must be unique/i);
});

test("unsupported integration names are rejected", () => {
  const board = cloneBoard();
  board.scenes.splice(3, 0, {
    type: "icon-grid",
    duration: 90,
    role: "ecosystem",
    props: {
      caption: "Connect your stack",
      iconColors: ["#7AA2FF", "#EF6C4D", "#33FF57"],
      labels: ["LinkedIn", "HubSpot", "Salesforce"],
    },
    voiceover: { enabled: true, script: "Keep LinkedIn beside HubSpot." },
  });
  const result = validateOllamaDirectorOutput(board, TABLES_DESCRIPTION);
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /Salesforce/i);
});

test("icon-grid labels must appear in the description and must not repeat", () => {
  const board = cloneBoard();
  board.scenes.splice(3, 0, {
    type: "icon-grid",
    duration: 90,
    role: "ecosystem",
    props: {
      caption: "One workspace",
      iconColors: ["#7AA2FF", "#EF6C4D", "#33FF57"],
      labels: ["LinkedIn", "LinkedIn", "LinkedIn"],
    },
    voiceover: { enabled: true, script: "Keep profiles beside your CRM." },
  });
  const result = validateOllamaDirectorOutput(board, TABLES_DESCRIPTION);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /do not repeat an integration name/i);
});

test("named integrations from the description are allowed", () => {
  const board = directorBoard();
  board.scenes.splice(3, 0, {
    type: "icon-grid",
    duration: 90,
    role: "ecosystem",
    props: {
      caption: "One intelligent workspace",
      iconColors: ["#4FA6F7", "#7AA2FF", "#EF6C4D"],
      labels: ["LinkedIn", "Tables", "HubSpot"],
    },
    voiceover: { enabled: true, script: "Keep buying context together." },
  });
  const result = validateOllamaDirectorOutput(board, TABLES_DESCRIPTION);
  assert.equal(result.ok, true, result.details?.join("\n"));
});

test("invented statistics are rejected", () => {
  const board = directorBoard();
  board.scenes.splice(3, 0, {
    type: "stat-callout",
    duration: 150,
    role: "proof",
    props: { value: "297", suffix: "M+", label: "Right prospects, faster." },
    voiceover: {
      enabled: true,
      script: "Reach more of the right people from one workspace.",
    },
  });
  const invented = validateOllamaDirectorOutput(board, SHORT_DESCRIPTION);
  assert.equal(invented.ok, false);
  assert.match(invented.details.join("\n"), /not in the product description/i);

  const allowed = validateOllamaDirectorOutput(board, TABLES_DESCRIPTION);
  assert.equal(allowed.ok, true, allowed.details?.join("\n"));
});
