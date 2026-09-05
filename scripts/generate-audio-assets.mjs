#!/usr/bin/env node
/**
 * Generate free, local, deterministic BGM + SFX with FFmpeg lavfi.
 * No paid APIs. Voiceover files are never synthesized here.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "./lib/storyboard.mjs";

const MUSIC_DIR = resolve(projectRoot, "audio/music");
const SFX_DIR = resolve(projectRoot, "audio/sfx");
const VOICE_DIR = resolve(projectRoot, "audio/voice");

function run(label, args) {
  console.log(`→ ${label}`);
  const result = spawnSync("ffmpeg", ["-y", ...args], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.error?.code === "ENOENT") {
    console.error("FFmpeg is required to generate local audio assets.");
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    console.error(`${label} failed.`);
    process.exit(1);
  }
}

function main() {
  mkdirSync(MUSIC_DIR, { recursive: true });
  mkdirSync(SFX_DIR, { recursive: true });
  mkdirSync(VOICE_DIR, { recursive: true });

  run("Background pad", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=98:sample_rate=48000:duration=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=147:sample_rate=48000:duration=24",
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=d=24:c=pink:r=48000:a=0.04",
    "-filter_complex",
    "[0]volume=0.10[a];[1]volume=0.06[b];[2]highpass=f=180,lowpass=f=720,volume=0.12[c];[a][b][c]amix=inputs=3:duration=longest,alimiter=limit=0.18,afade=t=in:d=1.4,afade=t=out:st=21.5:d=2.4",
    resolve(MUSIC_DIR, "bed.wav"),
  ]);

  run("Whoosh", [
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=d=0.55:c=white:r=48000:a=0.35",
    "-af",
    "highpass=f=500,lowpass=f=4200,afade=t=in:d=0.06,afade=t=out:d=0.38,volume=0.45",
    resolve(SFX_DIR, "whoosh.wav"),
  ]);

  run("Sweep", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=420:sample_rate=48000:duration=0.42",
    "-af",
    "afade=t=in:d=0.04,afade=t=out:d=0.28,volume=0.18,lowpass=f=1800",
    resolve(SFX_DIR, "sweep.wav"),
  ]);

  run("Impact", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=70:sample_rate=48000:duration=0.32",
    "-af",
    "afade=t=in:d=0.01,afade=t=out:d=0.28,volume=0.38",
    resolve(SFX_DIR, "impact.wav"),
  ]);

  run("Tick", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000:duration=0.06",
    "-af",
    "afade=t=in:d=0.005,afade=t=out:d=0.05,volume=0.12",
    resolve(SFX_DIR, "tick.wav"),
  ]);

  run("Connect", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000:duration=0.09",
    "-af",
    "afade=t=in:d=0.008,afade=t=out:d=0.07,volume=0.16",
    resolve(SFX_DIR, "connect.wav"),
  ]);

  run("Rise", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:sample_rate=48000:duration=0.7",
    "-af",
    "afade=t=in:d=0.12,afade=t=out:d=0.4,volume=0.2,lowpass=f=1400",
    resolve(SFX_DIR, "rise.wav"),
  ]);

  console.log("\nLocal audio assets written to audio/music and audio/sfx.");
  console.log("Voiceover is not generated. Place files in audio/voice/ if needed.");
}

main();
