#!/usr/bin/env node
/**
 * Product Launch Video render pipeline.
 *
 * storyboard.json
 *   → validate
 *   → generate local voiceover (if enabled)
 *   → populate → build/index.html
 *   → HyperFrames render → build/hyperframes-render.mp4
 *   → FFmpeg stream-copy remux → build/product-launch.mp4
 *
 * Usage:
 *   node scripts/render-video.mjs
 *   npm run render:video
 *
 * Environment:
 *   VIDEO_QUALITY   draft | standard | high  (default: draft)
 *   VOICEOVER_ALREADY_PREPARED=1  skip TTS (job runner already generated clips)

 *
 * Exit codes:
 *   0 — final MP4 written
 *   1 — validation / populate / HyperFrames / FFmpeg / I/O failure
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "./lib/storyboard.mjs";

const FPS = 30;
const HF_PIN = "hyperframes@0.8.22";
const COMPOSITION_REL = "build/index.html";
const INTERMEDIATE_REL = "build/hyperframes-render.mp4";
const FINAL_REL = "build/product-launch.mp4";

const ALLOWED_QUALITIES = new Set(["draft", "standard", "high"]);
const QUALITY = process.env.VIDEO_QUALITY || "draft";

const VALIDATE_SCRIPT = resolve(projectRoot, "scripts/validate-storyboard.mjs");
const VOICEOVER_SCRIPT = resolve(projectRoot, "scripts/generate-voiceover.mjs");
const POPULATE_SCRIPT = resolve(projectRoot, "scripts/populate-composition.mjs");
const COMPOSITION_PATH = resolve(projectRoot, COMPOSITION_REL);
const INTERMEDIATE_PATH = resolve(projectRoot, INTERMEDIATE_REL);
const FINAL_PATH = resolve(projectRoot, FINAL_REL);

function fail(message, detail) {
  console.error(message);
  if (detail) console.error(detail);
  process.exit(1);
}

/**
 * Run a fixed command with an argument array.
 * Never interpolates storyboard/product text into a shell string.
 *
 * On Windows, npm shims like `npx` need shell:true; args stay a fixed array
 * of constants (never storyboard/user text).
 */
function run(label, command, args, { shell = false } = {}) {
  console.log(`\n→ ${label}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
    shell,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      fail(
        `${label} failed: command not found: ${command}`,
        "Install the missing tool and ensure it is on PATH.",
      );
    }
    fail(`${label} failed: ${result.error.message}`);
  }

  if ((result.status ?? 1) !== 0) {
    fail(`${label} failed (exit ${result.status ?? 1}).`);
  }
}

function requireFfmpeg() {
  const probe = spawnSync("ffmpeg", ["-version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (probe.error?.code === "ENOENT") {
    fail(
      "FFmpeg is required for final MP4 finalization but was not found on PATH.",
      [
        "Install FFmpeg, then retry.",
        "Windows (winget): winget install Gyan.FFmpeg",
        "macOS (Homebrew): brew install ffmpeg",
        "Linux: use your package manager to install ffmpeg",
      ].join("\n"),
    );
  }

  if ((probe.status ?? 1) !== 0) {
    fail(
      "FFmpeg is present but could not be executed.",
      (probe.stderr || probe.stdout || "").trim() || undefined,
    );
  }
}

function assertNonEmptyFile(path, label) {
  if (!existsSync(path)) {
    fail(`${label} is missing: ${path}`);
  }
  const size = statSync(path).size;
  if (size <= 0) {
    fail(`${label} is empty: ${path}`);
  }
}

function probeFinal() {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size,format_name",
      "-show_entries",
      "stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames",
      "-of",
      "json",
      FINAL_PATH,
    ],
    { encoding: "utf8" },
  );

  if (result.error?.code === "ENOENT" || (result.status ?? 1) !== 0) {
    console.warn("ffprobe unavailable or failed; skipping metadata summary.");
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    console.warn("ffprobe returned non-JSON output; skipping metadata summary.");
    return null;
  }
}

function printSummary(meta) {
  console.log("\n✓ Render pipeline complete");
  console.log(`  Intermediate: ${INTERMEDIATE_REL}`);
  console.log(`  Final:        ${FINAL_REL}`);
  console.log(`  Quality:      ${QUALITY}`);
  console.log(`  FPS:          ${FPS}`);

  if (!meta) return;

  const video = (meta.streams || []).find((s) => s.codec_type === "video");
  const audio = (meta.streams || []).find((s) => s.codec_type === "audio");
  const duration = meta.format?.duration;
  if (video) {
    console.log(
      `  Resolution:   ${video.width || "?"}x${video.height || "?"}`,
    );
    console.log(`  Codec:        ${video.codec_name || "?"}`);
    console.log(`  Frame rate:   ${video.r_frame_rate || "?"}`);
    if (video.nb_frames) console.log(`  Frames:       ${video.nb_frames}`);
  }
  if (audio) {
    console.log(`  Audio:        ${audio.codec_name || "?"}`);
  } else {
    console.log("  Audio:        none");
  }
  if (duration != null) {
    console.log(`  Duration:     ${Number(duration).toFixed(3)}s`);
  }
  if (meta.format?.size) {
    console.log(`  Size:         ${meta.format.size} bytes`);
  }
}

function main() {
  if (!ALLOWED_QUALITIES.has(QUALITY)) {
    fail(
      `Invalid VIDEO_QUALITY="${QUALITY}".`,
      `Allowed values: ${[...ALLOWED_QUALITIES].join(", ")}`,
    );
  }

  // Fail fast if FFmpeg is missing — before spending time on HyperFrames.
  requireFfmpeg();

  run("Validate storyboard", process.execPath, [VALIDATE_SCRIPT]);

  if (process.env.VOICEOVER_ALREADY_PREPARED !== "1") {
    run("Generate voiceover", process.execPath, [VOICEOVER_SCRIPT]);
  }

  run("Populate composition", process.execPath, [POPULATE_SCRIPT]);

  if (!existsSync(COMPOSITION_PATH)) {
    fail(
      `Expected composition missing after populate: ${COMPOSITION_REL}`,
      "populate-composition.mjs must write build/index.html before render.",
    );
  }

  run(
    "HyperFrames render",
    "npx",
    [
      "--yes",
      HF_PIN,
      "render",
      "-c",
      COMPOSITION_REL,
      "--fps",
      String(FPS),
      "--quality",
      QUALITY,
      "--strict",
      "--output",
      INTERMEDIATE_REL,
    ],
    { shell: process.platform === "win32" },
  );

  assertNonEmptyFile(INTERMEDIATE_PATH, "HyperFrames intermediate MP4");

  // Finalize: remux HyperFrames output (video + mixed audio if present).
  run("FFmpeg finalize", "ffmpeg", [
    "-y",
    "-i",
    INTERMEDIATE_REL,
    "-c",
    "copy",
    FINAL_REL,
  ]);

  assertNonEmptyFile(FINAL_PATH, "Final MP4");
  printSummary(probeFinal());
}

main();
