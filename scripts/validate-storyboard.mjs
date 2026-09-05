#!/usr/bin/env node
/**
 * Validate a Product Launch Video storyboard against schemas/storyboard.schema.json.
 *
 * Usage:
 *   node scripts/validate-storyboard.mjs [path/to/storyboard.json]
 *
 * Exit codes:
 *   0 — valid
 *   1 — invalid or I/O error
 */
import { resolve } from "node:path";
import {
  formatValidationErrors,
  loadAndValidateStoryboard,
  projectRoot,
} from "./lib/storyboard.mjs";

const storyboardPath = resolve(projectRoot, process.argv[2] || "storyboard.json");

const result = loadAndValidateStoryboard(storyboardPath);

if (result.ok) {
  console.log(`OK  ${storyboardPath}`);
  console.log(`    ${result.data.scenes.length} scene(s)`);
  process.exit(0);
}

console.error(`INVALID  ${storyboardPath}`);
for (const line of formatValidationErrors(result.errors)) {
  console.error(line);
}
process.exit(1);
