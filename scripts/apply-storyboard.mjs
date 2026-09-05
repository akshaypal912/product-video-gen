#!/usr/bin/env node
/**
 * Validate a candidate storyboard and atomically write storyboard.json.
 *
 * This is NOT an LLM runtime. Cursor / Grok generate the JSON interactively;
 * this script only parses, validates, and writes.
 *
 * Usage:
 *   node scripts/apply-storyboard.mjs path/to/candidate.json
 *   node scripts/apply-storyboard.mjs -                 # read JSON from stdin
 *   npm run apply:storyboard -- path/to/candidate.json
 *
 * Exit codes:
 *   0 — storyboard.json written
 *   1 — usage / parse / validation / write failure
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  formatValidationErrors,
  projectRoot,
  validateStoryboard,
} from "./lib/storyboard.mjs";

const STORYBOARD_PATH = resolve(projectRoot, "storyboard.json");

function printUsage() {
  console.error(`Usage:
  node scripts/apply-storyboard.mjs <candidate.json>
  node scripts/apply-storyboard.mjs -                 # read JSON from stdin

  npm run apply:storyboard -- <candidate.json>

This script does not call any LLM. Provide storyboard JSON produced in Cursor
(for example by Grok 4.5 using prompts/storyboard-director.md), then apply it
here so validation protects storyboard.json.`);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function extractJsonText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";
  const fenced = trimmed.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

function parseCandidate(raw) {
  const jsonText = extractJsonText(raw);
  if (!jsonText) {
    throw new Error("Candidate storyboard was empty.");
  }
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    const preview =
      jsonText.length > 800 ? `${jsonText.slice(0, 800)}…` : jsonText;
    const error = new Error(`Failed to parse candidate JSON: ${err.message}`);
    error.preview = preview;
    throw error;
  }
}

function atomicWriteJson(targetPath, value) {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tmpPath = resolve(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.tmp`,
  );
  writeFileSync(tmpPath, payload, "utf8");
  try {
    renameSync(tmpPath, targetPath);
  } catch {
    // Windows cannot always rename over an existing destination.
    copyFileSync(tmpPath, targetPath);
    unlinkSync(tmpPath);
  }
}

function summarize(data) {
  const types = data.scenes.map((scene) => scene.type);
  const totalFrames = data.scenes.reduce(
    (sum, scene) => sum + scene.duration,
    0,
  );
  console.log(`Wrote ${STORYBOARD_PATH}`);
  console.log(`Scenes: ${data.scenes.length}`);
  console.log(`Order: ${types.join(" → ")}`);
  console.log(
    `Total: ${totalFrames} frames (${(totalFrames / 30).toFixed(1)}s @ 30 FPS)`,
  );
}

async function resolveCandidateRaw(argv) {
  if (argv.length === 0) {
    printUsage();
    process.exit(1);
  }

  if (argv.length === 1 && argv[0] === "-") {
    return readStdin();
  }

  if (argv[0] === "--help" || argv[0] === "-h") {
    printUsage();
    process.exit(0);
  }

  const candidatePath = resolve(process.cwd(), argv[0]);
  try {
    return readFileSync(candidatePath, "utf8");
  } catch (err) {
    console.error(`Failed to read candidate: ${candidatePath}`);
    console.error(err.message);
    process.exit(1);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const raw = await resolveCandidateRaw(argv);

  let storyboard;
  try {
    storyboard = parseCandidate(raw);
  } catch (err) {
    console.error(err.message);
    if (err.preview) {
      console.error("Candidate preview:");
      console.error(err.preview);
    }
    console.error("storyboard.json was NOT modified.");
    process.exit(1);
  }

  const validation = validateStoryboard(storyboard);
  if (!validation.ok) {
    console.error("Candidate storyboard failed validation.");
    console.error("storyboard.json was NOT modified.");
    for (const line of formatValidationErrors(validation.errors)) {
      console.error(line);
    }
    process.exit(1);
  }

  const existingSnapshot = existsSync(STORYBOARD_PATH)
    ? readFileSync(STORYBOARD_PATH, "utf8")
    : null;

  try {
    atomicWriteJson(STORYBOARD_PATH, storyboard);
  } catch (err) {
    console.error("Failed to write storyboard.json.");
    console.error(err.message);
    if (existingSnapshot != null) {
      try {
        writeFileSync(STORYBOARD_PATH, existingSnapshot, "utf8");
      } catch {
        /* best-effort restore */
      }
    }
    process.exit(1);
  }

  summarize(storyboard);
}

main().catch((err) => {
  console.error(`Unexpected failure: ${err.message}`);
  process.exit(1);
});
