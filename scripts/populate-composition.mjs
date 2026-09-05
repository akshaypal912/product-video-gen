#!/usr/bin/env node
/**
 * Translate a validated storyboard.json into a HyperFrames master composition.
 *
 * Usage:
 *   node scripts/populate-composition.mjs [storyboard-path]
 *
 * Writes:
 *   build/index.html
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ALLOWED_SCENE_TYPES,
  formatValidationErrors,
  loadAndValidateStoryboard,
  projectRoot,
} from "./lib/storyboard.mjs";
import { computeSceneTimeline, FPS, OVERLAP_FRAMES, framesToSecondsAttr } from "./lib/timeline.mjs";
import {
  existingGeneratedClips,
  isVoiceoverRequested,
} from "./lib/voiceover.mjs";

const OUTPUT_REL = "build/index.html";
const MASTER_ID = "product-launch";

const SCENE_TEMPLATES = Object.freeze({
  "logo-intro": "compositions/scenes/logo-intro.html",
  "text-reveal": "compositions/scenes/text-reveal.html",
  "stat-callout": "compositions/scenes/stat-callout.html",
  "icon-grid": "compositions/scenes/icon-grid.html",
  "cta-outro": "compositions/scenes/cta-outro.html",
});

const JSON_STRING_PROPS = Object.freeze({
  "text-reveal": Object.freeze(["lines"]),
  "icon-grid": Object.freeze(["iconColors", "labels"]),
});

const SFX_BY_TYPE = Object.freeze({
  "logo-intro": [{ file: "audio/sfx/whoosh.wav", offsetFrames: 4, duration: 0.55 }],
  "text-reveal": [{ file: "audio/sfx/sweep.wav", offsetFrames: 6, duration: 0.42 }],
  "stat-callout": [
    { file: "audio/sfx/impact.wav", offsetFrames: 4, duration: 0.32 },
    { file: "audio/sfx/tick.wav", offsetFrames: 18, duration: 0.06 },
    { file: "audio/sfx/tick.wav", offsetFrames: 30, duration: 0.06 },
    { file: "audio/sfx/tick.wav", offsetFrames: 42, duration: 0.06 },
  ],
  "icon-grid": [
    { file: "audio/sfx/connect.wav", offsetFrames: 18, duration: 0.09 },
    { file: "audio/sfx/connect.wav", offsetFrames: 28, duration: 0.09 },
  ],
  "cta-outro": [{ file: "audio/sfx/rise.wav", offsetFrames: 8, duration: 0.7 }],
});

function escapeAttrJson(value) {
  return JSON.stringify(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeSingleQuotedAttr(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

function toVariableValues(type, props, role) {
  const jsonStringKeys = new Set(JSON_STRING_PROPS[type] || []);
  const values = {};
  for (const [key, value] of Object.entries(props)) {
    if (jsonStringKeys.has(key)) {
      values[key] = JSON.stringify(value);
    } else if (typeof value === "string") {
      values[key] = value;
    } else {
      values[key] = JSON.stringify(value);
    }
  }
  if (typeof role === "string" && role.trim()) {
    values.role = role.trim();
  }
  return values;
}

function compositionSrcFor(type) {
  const src = SCENE_TEMPLATES[type];
  if (!src) throw new Error(`Refusing unknown scene type: ${type}`);
  return src;
}

function extractThemeTokens(css) {
  const match = css.match(/:root\s*\{([^}]+)\}/);
  if (!match) throw new Error("theme.css is missing a :root block");
  const tokens = [];
  const re = /(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(match[1]))) {
    tokens.push({ name: m[1], value: m[2].trim() });
  }
  if (tokens.length === 0) {
    throw new Error("theme.css :root block has no custom properties");
  }
  return tokens;
}

function themeHostCss(tokens) {
  const decls = tokens.map((t) => `        ${t.name}: ${t.value};`).join("\n");
  return `      html,
      body,
      #root,
      [data-composition-src] {
${decls}
      }`;
}

function padType(type) {
  const width = Math.max(...ALLOWED_SCENE_TYPES.map((t) => t.length));
  return type.padEnd(width, " ");
}

function buildHost({ index, type, startFrames, durationFrames, props, role }) {
  const startSec = framesToSecondsAttr(startFrames);
  const durationSec = framesToSecondsAttr(durationFrames);
  const src = compositionSrcFor(type);
  const variableValues = JSON.stringify(toVariableValues(type, props, role));
  const trackIndex = index + 1;

  return `      <div
        id="scene-${index}"
        class="clip"
        data-composition-id="${type}"
        data-composition-src="${src}"
        data-start="${startSec}"
        data-duration="${durationSec}"
        data-track-index="${trackIndex}"
        data-width="1920"
        data-height="1080"
        data-variable-values='${escapeSingleQuotedAttr(variableValues)}'
      ></div>`;
}

function htmlAudioSrc(path) {
  if (!existsSync(resolve(projectRoot, path))) return null;
  // HyperFrames serves the project root as the base URL. Do not use "../".
  return path.replaceAll("\\", "/");
}

function buildDuckAutomation(clips, totalSeconds) {
  const points = [{ t: 0, v: 1 }];
  const sorted = [...clips].sort((a, b) => a.startSec - b.startSec);
  for (const clip of sorted) {
    const start = Math.max(0, clip.startSec - 0.08);
    const end = Math.min(totalSeconds, clip.startSec + clip.durationSec + 0.18);
    const last = points[points.length - 1];
    if (last.t < start) points.push({ t: Number(start.toFixed(3)), v: 1 });
    points.push({ t: Number(start.toFixed(3)), v: 0.38 });
    points.push({ t: Number(end.toFixed(3)), v: 0.38 });
    points.push({ t: Number(end.toFixed(3)), v: 1 });
  }
  return { version: 1, lanes: [{ target: "volume", points }] };
}

function buildAudio({ scenes, totalFrames, audioConfig, voiceClips }) {
  const tags = [];
  let track = 20;
  const totalSec = framesToSecondsAttr(totalFrames);
  const totalSeconds = Number(totalSec);
  const musicEnabled = audioConfig?.music?.enabled !== false;
  const bed = musicEnabled ? htmlAudioSrc("audio/music/bed.wav") : null;
  const hasVoice = voiceClips.length > 0;
  if (bed) {
    const duck = hasVoice
      ? `\n        data-automation="${escapeAttrJson(buildDuckAutomation(voiceClips, totalSeconds))}"`
      : "";
    tags.push(`      <audio
        id="audio-bed"
        src="${bed}"
        data-start="0"
        data-duration="${totalSec}"
        data-volume="${hasVoice ? "0.14" : "0.22"}"
        data-audio-group="music"
        data-track-index="${track}"${duck}
      ></audio>`);
    track += 1;
  }

  scenes.forEach((scene, index) => {
    const cues = SFX_BY_TYPE[scene.type] || [];
    cues.forEach((cue, cueIndex) => {
      const src = htmlAudioSrc(cue.file);
      if (!src) return;
      const start = framesToSecondsAttr(scene.startFrames + cue.offsetFrames);
      tags.push(`      <audio
        id="sfx-${index}-${cueIndex}"
        src="${src}"
        data-start="${start}"
        data-duration="${cue.duration}"
        data-volume="0.28"
        data-audio-group="sfx"
        data-track-index="${track}"
      ></audio>`);
      track += 1;
    });
  });

  voiceClips.forEach((clip, index) => {
    const src = htmlAudioSrc(clip.rel);
    if (!src) return;
    tags.push(`      <audio
        id="audio-voice-${index}"
        src="${src}"
        data-start="${clip.startSec}"
        data-duration="${clip.durationSec}"
        data-volume="0.94"
        data-track-index="${track}"
        data-audio-group="voiceover"
      ></audio>`);
    track += 1;
  });

  return tags.join("\n\n");
}

function buildTransitionScript(scenes) {
  const overlap = OVERLAP_FRAMES / FPS;
  const lines = [
    '        window.__timelines = window.__timelines || {};',
    `        const tl = gsap.timeline({ paused: true });`,
  ];
  scenes.forEach((scene, index) => {
    if (index === 0) return;
    const at = framesToSecondsAttr(scene.startFrames);
    const prev = index - 1;
    lines.push(
      `        tl.to("#scene-${prev}", { opacity: 0, scale: 1.035, duration: ${overlap}, ease: "sine.inOut" }, ${at});`,
    );
    lines.push(
      `        tl.fromTo("#scene-${index}", { opacity: 0, scale: 0.985 }, { opacity: 1, scale: 1, duration: ${overlap}, ease: "sine.inOut" }, ${at});`,
    );
  });
  lines.push(`        window.__timelines["${MASTER_ID}"] = tl;`);
  return lines.join("\n");
}

function buildHtml({ scenes, totalFrames, themeTokens, audioConfig, voiceClips }) {
  const totalSec = framesToSecondsAttr(totalFrames);
  const hosts = scenes
    .map((scene, index) => buildHost({ index, ...scene }))
    .join("\n\n");
  const audio = buildAudio({
    scenes,
    totalFrames,
    audioConfig,
    voiceClips,
  });

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Product Launch</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <link rel="stylesheet" href="theme.css" />
    <style>
      body,
      html {
        margin: 0;
        padding: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }

${themeHostCss(themeTokens)}

      #root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: var(--color-background);
      }

      .clip {
        position: absolute;
        inset: 0;
      }

      #scene-0 { opacity: 1; }
      [id^="scene-"]:not(#scene-0) { opacity: 0; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="${MASTER_ID}"
      data-width="1920"
      data-height="1080"
      data-start="0"
      data-duration="${totalSec}"
      data-fps="${FPS}"
    >
${hosts}

${audio}

      <script>
${buildTransitionScript(scenes)}
      </script>
    </div>
  </body>
</html>
`;
}

function printSummary({ storyboardPath, outputPath, scenes, totalFrames }) {
  console.log(`Generated ${outputPath}`);
  console.log("");
  console.log(`Source: ${storyboardPath}`);
  console.log("");
  console.log("Scenes:");
  scenes.forEach((scene, index) => {
    const end = scene.startFrames + scene.durationFrames;
    console.log(
      `${index + 1}. ${padType(scene.type)}  ${scene.startFrames}-${end}`,
    );
  });
  console.log("");
  console.log("Total:");
  console.log(`${totalFrames} frames`);
  const seconds = totalFrames / FPS;
  console.log(
    `${Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(10)))} seconds`,
  );
  console.log(`@ ${FPS} FPS`);
}

function main() {
  const storyboardPath = resolve(
    projectRoot,
    process.argv[2] || "storyboard.json",
  );
  const outputPath = resolve(projectRoot, OUTPUT_REL);

  const result = loadAndValidateStoryboard(storyboardPath);
  if (!result.ok) {
    console.error("Refusing to generate composition: storyboard validation failed.");
    console.error(`INVALID  ${storyboardPath}`);
    for (const line of formatValidationErrors(result.errors)) {
      console.error(line);
    }
    process.exit(1);
  }

  const themeCss = readFileSync(resolve(projectRoot, "theme.css"), "utf8");
  const themeTokens = extractThemeTokens(themeCss);

  const timeline = computeSceneTimeline(result.data.scenes);
  const scenes = timeline.timed.map((entry) => ({
    type: entry.type,
    durationFrames: entry.durationFrames,
    startFrames: entry.startFrames,
    props: entry.scene.props,
    role: entry.scene.role,
  }));
  const totalFrames = timeline.totalFrames;

  const voiceClips = isVoiceoverRequested(result.data)
    ? existingGeneratedClips(result.data)
    : [];
  if (isVoiceoverRequested(result.data) && voiceClips.length === 0) {
    console.error(
      "Voiceover is enabled but no narration audio was found. Run TTS first or place audio/voice/narration.wav.",
    );
    process.exit(1);
  }

  const html = buildHtml({
    scenes,
    totalFrames,
    themeTokens,
    audioConfig: result.data.audio || {},
    voiceClips,
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  copyFileSync(
    resolve(projectRoot, "theme.css"),
    resolve(projectRoot, "build/theme.css"),
  );
  writeFileSync(outputPath, html, "utf8");

  printSummary({
    storyboardPath,
    outputPath: OUTPUT_REL.replaceAll("\\", "/"),
    scenes,
    totalFrames,
  });
}

main();
