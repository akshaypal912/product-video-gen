import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStoryboard } from "../scripts/lib/storyboard.mjs";
import {
  isValidHexColor,
  normalizeIconGridIconColors,
  normalizeOllamaStoryboard,
  normalizeTextRevealLines,
  normalizeTextRevealScene,
  OLLAMA_ICON_COLOR_PALETTE,
  parseAndValidateOllamaStoryboard,
  splitLinesFromString,
} from "../server/lib/llm/ollama-storyboard-normalize.mjs";

function textRevealScene(lines) {
  return {
    type: "text-reveal",
    duration: 120,
    role: "friction",
    props: { lines },
    voiceover: { enabled: true, script: "Stop hopping between workflows." },
  };
}

function iconGridScene(iconColors, labels = ["LinkedIn", "HubSpot"]) {
  return {
    type: "icon-grid",
    duration: 72,
    role: "ecosystem",
    props: {
      caption: "Connect customer data across integrations.",
      iconColors,
      labels,
    },
    voiceover: { enabled: false, script: "" },
  };
}

function minimalStoryboard({ lines, iconColors, labels }) {
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
        duration: 48,
        role: "hook",
        props: { productName: "Tables" },
        voiceover: { enabled: false, script: "" },
      },
      textRevealScene(lines),
      iconGridScene(iconColors, labels),
      {
        type: "cta-outro",
        duration: 90,
        role: "cta",
        props: { headline: "Discover. Connect.", sub: "Work from one workspace." },
        voiceover: { enabled: true, script: "Start connecting today." },
      },
    ],
  };
}

test("lines already array → unchanged", () => {
  const lines = ["Scattered tools stall every deal.", "One workspace fixes it."];
  const scene = textRevealScene(lines);
  const normalized = normalizeTextRevealScene(scene);
  assert.deepEqual(normalized.props.lines, lines);
});

test("lines string → array", () => {
  const scene = textRevealScene("Scattered tools stall every deal.");
  const normalized = normalizeTextRevealScene(scene);
  assert.deepEqual(normalized.props.lines, ["Scattered tools stall every deal."]);
});

test("lines string splits on newlines", () => {
  assert.deepEqual(splitLinesFromString("Line one.\nLine two."), [
    "Line one.",
    "Line two.",
  ]);
});

test("lines string splits on sentence boundaries", () => {
  assert.deepEqual(
    splitLinesFromString("First sentence. Second sentence."),
    ["First sentence.", "Second sentence."],
  );
});

test("valid iconColors → unchanged", () => {
  const colors = ["#4FA6F7", "#7AA2FF", "#EF6C4D"];
  const scene = iconGridScene(colors);
  const normalized = normalizeIconGridIconColors(scene);
  assert.deepEqual(normalized.props.iconColors, colors);
});

test("invalid iconColors → valid hex", () => {
  const scene = iconGridScene(["blue", "linkedin"]);
  const normalized = normalizeIconGridIconColors(scene);
  assert.equal(normalized.props.iconColors.length, 2);
  for (const color of normalized.props.iconColors) {
    assert.equal(isValidHexColor(color), true);
  }
  assert.deepEqual(normalized.props.iconColors, [
    OLLAMA_ICON_COLOR_PALETTE[0],
    OLLAMA_ICON_COLOR_PALETTE[1],
  ]);
});

test("malformed hex values are normalized", () => {
  const scene = iconGridScene(["#GGG", "#12345", "1DA1F2", "rgb(255,0,0)"]);
  const normalized = normalizeIconGridIconColors(scene);
  assert.equal(normalized.props.iconColors.length, 4);
  for (const color of normalized.props.iconColors) {
    assert.equal(isValidHexColor(color), true);
  }
});

test("color count preserved", () => {
  const scene = iconGridScene(
    ["invalid", "also-bad", "nope"],
    ["LinkedIn", "HubSpot", "Tables"],
  );
  const normalized = normalizeIconGridIconColors(scene);
  assert.equal(normalized.props.iconColors.length, 3);
});

test("unrelated scene fields unchanged", () => {
  const storyboard = minimalStoryboard({
    lines: ["One intelligent workspace."],
    iconColors: ["bad", "worse"],
    labels: ["LinkedIn", "HubSpot"],
  });
  const hook = structuredClone(storyboard.scenes[0]);
  const cta = structuredClone(storyboard.scenes[3]);
  const normalized = normalizeOllamaStoryboard(storyboard);
  assert.deepEqual(normalized.scenes[0], hook);
  assert.deepEqual(normalized.scenes[3], cta);
  assert.equal(normalized.scenes[1].duration, 120);
  assert.equal(normalized.scenes[1].role, "friction");
});

test("normalization followed by AJV passes", () => {
  const storyboard = minimalStoryboard({
    lines: "Scattered tools stall every deal.",
    iconColors: ["LinkedIn Blue", "HubSpot Orange"],
    labels: ["LinkedIn", "HubSpot"],
  });
  const before = validateStoryboard(storyboard);
  assert.equal(before.ok, false);

  const normalized = normalizeOllamaStoryboard(storyboard);
  const after = validateStoryboard(normalized);
  assert.equal(after.ok, true, JSON.stringify(after.errors, null, 2));
  assert.deepEqual(normalized.scenes[1].props.lines, [
    "Scattered tools stall every deal.",
  ]);
});

test("parseAndValidateOllamaStoryboard normalizes before AJV", () => {
  const storyboard = minimalStoryboard({
    lines: "First line.\nSecond line.",
    iconColors: ["LinkedIn Blue", "#464646"],
    labels: ["LinkedIn", "HubSpot"],
  });
  const raw = JSON.stringify(storyboard);
  const before = validateStoryboard(storyboard);
  assert.equal(before.ok, false);

  const parsed = parseAndValidateOllamaStoryboard(raw);
  assert.equal(parsed.ok, true, parsed.details?.join("\n") || parsed.error);
  assert.deepEqual(parsed.storyboard.scenes[1].props.lines, [
    "First line.",
    "Second line.",
  ]);
  for (const color of parsed.storyboard.scenes[2].props.iconColors) {
    assert.equal(isValidHexColor(color), true);
  }
});

test("normalizeTextRevealLines leaves valid arrays untouched", () => {
  const lines = ["Keep", "These"];
  assert.deepEqual(normalizeTextRevealLines(lines), lines);
});
