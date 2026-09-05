#!/usr/bin/env node
/**
 * Generate local Piper voiceover clips for the current storyboard.
 *
 * Usage:
 *   node scripts/generate-voiceover.mjs [storyboard-path]
 */
import { resolve } from "node:path";
import {
  formatValidationErrors,
  loadAndValidateStoryboard,
  projectRoot,
} from "./lib/storyboard.mjs";
import { prepareVoiceover } from "./lib/voiceover.mjs";

async function main() {
  const storyboardPath = resolve(
    projectRoot,
    process.argv[2] || "storyboard.json",
  );
  const loaded = loadAndValidateStoryboard(storyboardPath);
  if (!loaded.ok) {
    console.error("Refusing to generate voiceover: storyboard validation failed.");
    for (const line of formatValidationErrors(loaded.errors)) {
      console.error(line);
    }
    process.exit(1);
  }

  try {
    const result = await prepareVoiceover(loaded.data);
    if (result.mode === "disabled") {
      console.log("Voiceover disabled. Skipping TTS.");
      return;
    }
    if (result.mode === "manual") {
      console.log("Using manual narration asset (TTS skipped).");
      for (const clip of result.clips) {
        console.log(`  ${clip.rel} @ ${clip.startSec}s (${clip.durationSec}s)`);
      }
      return;
    }
    console.log("Generated local Piper voiceover:");
    for (const clip of result.clips) {
      console.log(`  ${clip.rel} @ ${clip.startSec}s (${clip.durationSec}s)`);
    }
  } catch (err) {
    console.error(err?.message || "Voiceover generation failed.");
    process.exit(1);
  }
}

main();
