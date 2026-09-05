/**
 * Build scene-timed voiceover assets for a validated storyboard.
 *
 * Priority:
 * 1. Manual audio/voice/narration.wav|mp3
 * 2. Piper TTS into build/audio/voice/ when voiceover is enabled
 * 3. No narration when voiceover is disabled
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { projectRoot } from "./storyboard.mjs";
import { computeSceneTimeline, framesToSeconds } from "./timeline.mjs";
import {
  GENERATED_VOICE_DIR,
  findManualNarration,
  generateVoiceover,
  isTtsEnabled,
  lengthScaleFor,
} from "./tts.mjs";
import {
  DEFAULT_SENTENCE_SILENCE,
  planVoiceoverFit,
  voiceoverFitErrorMessage,
} from "./voiceover-fit.mjs";

export const VOICE_MANIFEST_REL = "build/audio/voice/manifest.json";
const VOICE_MANIFEST_PATH = resolve(projectRoot, VOICE_MANIFEST_REL);
const VOICE_OFFSET_FRAMES = 4;

export function isVoiceoverRequested(storyboard) {
  if (storyboard?.audio?.voiceover?.enabled === true) return true;
  return (storyboard?.scenes || []).some(
    (scene) => scene?.voiceover?.enabled === true,
  );
}

function topVoiceover(storyboard) {
  return storyboard?.audio?.voiceover &&
    typeof storyboard.audio.voiceover === "object"
    ? storyboard.audio.voiceover
    : {};
}

function sceneScript(scene, topOn) {
  const vo =
    scene?.voiceover && typeof scene.voiceover === "object"
      ? scene.voiceover
      : {};
  const script = typeof vo.script === "string" ? vo.script.trim() : "";
  if (vo.enabled === false) return null;
  if (vo.enabled === true) {
    return { script, required: true };
  }
  if (topOn && script) {
    return { script, required: false };
  }
  return null;
}

export function collectNarrationCues(storyboard) {
  const top = topVoiceover(storyboard);
  const topOn = top.enabled === true;
  const { timed, totalFrames, totalSeconds } = computeSceneTimeline(
    storyboard.scenes,
  );
  const cues = [];

  timed.forEach((entry) => {
    const picked = sceneScript(entry.scene, topOn);
    if (!picked) return;
    cues.push({
      index: entry.index,
      startFrames: entry.startFrames + VOICE_OFFSET_FRAMES,
      durationFrames: Math.max(entry.durationFrames - VOICE_OFFSET_FRAMES, 1),
      script: picked.script,
      required: picked.required,
    });
  });

  return {
    topOn,
    topScript: typeof top.script === "string" ? top.script.trim() : "",
    pace: top.pace || "natural",
    timed,
    totalFrames,
    totalSeconds,
    cues,
  };
}

function writeManifest(payload) {
  mkdirSync(GENERATED_VOICE_DIR, { recursive: true });
  writeFileSync(VOICE_MANIFEST_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

function readManifest() {
  if (!existsSync(VOICE_MANIFEST_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(VOICE_MANIFEST_PATH, "utf8"));
    if (!data || !Array.isArray(data.clips)) return null;
    return data;
  } catch {
    return null;
  }
}

function clearGeneratedVoiceDir() {
  mkdirSync(GENERATED_VOICE_DIR, { recursive: true });
  for (const name of readdirSync(GENERATED_VOICE_DIR)) {
    if (!/^(scene-\d+|full)\.wav$/i.test(name) && name !== "manifest.json") {
      continue;
    }
    unlinkSync(resolve(GENERATED_VOICE_DIR, name));
  }
}

function probeDurationSeconds(path) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      const duration = Number.parseFloat(stdout.trim());
      if (code !== 0 || !Number.isFinite(duration) || duration <= 0) {
        resolvePromise(null);
        return;
      }
      resolvePromise(duration);
    });
    child.on("error", () => resolvePromise(null));
  });
}

function throwFitError(job, wavSec) {
  const label =
    typeof job.index === "number" ? `scene ${job.index + 1}` : "narration";
  const error = new Error(
    voiceoverFitErrorMessage({
      sceneLabel: label,
      wavSec,
      slotSec: job.maxSec,
    }),
  );
  error.code = "TTS_DOES_NOT_FIT";
  throw error;
}

async function synthesizeIntoSlot(job, { pace, generateFn, probeFn }) {
  const baseScale = lengthScaleFor({ pace });
  await generateFn({
    text: job.script,
    outputPath: job.outputPath,
    pace,
    lengthScale: baseScale,
    sentenceSilence: DEFAULT_SENTENCE_SILENCE,
  });
  let probed = await probeFn(job.outputPath);
  if (!probed || probed < 0.05) {
    const error = new Error("Generated narration is missing or too short.");
    error.code = "TTS_EMPTY_OUTPUT";
    throw error;
  }

  const first = planVoiceoverFit({
    wavSec: probed,
    slotSec: job.maxSec,
    lengthScale: baseScale,
  });
  if (!first.ok) throwFitError(job, probed);

  if (first.action === "resynthesize") {
    await generateFn({
      text: job.script,
      outputPath: job.outputPath,
      pace,
      lengthScale: first.lengthScale,
      sentenceSilence: first.sentenceSilence,
    });
    probed = await probeFn(job.outputPath);
    if (!probed || probed < 0.05) {
      const error = new Error("Generated narration is missing or too short.");
      error.code = "TTS_EMPTY_OUTPUT";
      throw error;
    }
    // After one speed/silence retry, the contract is slot fit — not the planning cap.
    if (probed > job.maxSec) {
      throwFitError(job, probed);
    }
    return probed;
  }

  if (probed > job.maxSec) {
    throwFitError(job, probed);
  }

  return probed;
}

/**
 * @param {object} storyboard
 * @param {{
 *   generateVoiceover?: Function,
 *   probeDurationSeconds?: Function,
 *   findManualNarration?: Function,
 *   isTtsEnabled?: Function,
 *   skipFilesystem?: boolean,
 * }} [options]
 * @returns {Promise<{
 *   mode: "disabled" | "manual" | "generated"
 *   clips: Array<{ rel: string, startSec: number, durationSec: number }>
 * }>}
 */
export async function prepareVoiceover(storyboard, options = {}) {
  const generateFn =
    typeof options.generateVoiceover === "function"
      ? options.generateVoiceover
      : generateVoiceover;
  const probeFn =
    typeof options.probeDurationSeconds === "function"
      ? options.probeDurationSeconds
      : probeDurationSeconds;
  const findManual =
    typeof options.findManualNarration === "function"
      ? options.findManualNarration
      : findManualNarration;
  const ttsOn =
    typeof options.isTtsEnabled === "function"
      ? options.isTtsEnabled
      : isTtsEnabled;
  const skipFilesystem = options.skipFilesystem === true;

  const requested = isVoiceoverRequested(storyboard);
  if (!requested) {
    return { mode: "disabled", clips: [] };
  }

  const manual = findManual();
  if (manual) {
    const { totalSeconds } = computeSceneTimeline(storyboard.scenes);
    const probed = await probeFn(manual.abs);
    const result = {
      mode: "manual",
      clips: [
        {
          rel: manual.rel,
          startSec: 0,
          durationSec:
            probed && probed > 0 ? Math.min(probed, totalSeconds) : totalSeconds,
        },
      ],
    };
    if (!skipFilesystem) writeManifest(result);
    return result;
  }

  if (!ttsOn()) {
    const error = new Error(
      "Voiceover is enabled but local TTS is disabled (TTS_ENABLED=false), and no manual narration file was found.",
    );
    error.code = "TTS_DISABLED";
    throw error;
  }

  const plan = collectNarrationCues(storyboard);
  const jobs = [];

  if (plan.cues.length > 0) {
    for (const cue of plan.cues) {
      if (!cue.script) {
        const error = new Error(
          `Voiceover is enabled for scene ${cue.index + 1} but the script is empty.`,
        );
        error.code = "TTS_EMPTY_SCRIPT";
        throw error;
      }
      jobs.push({
        index: cue.index,
        script: cue.script,
        startSec: framesToSeconds(cue.startFrames),
        maxSec: framesToSeconds(cue.durationFrames),
        outputPath: resolve(GENERATED_VOICE_DIR, `scene-${cue.index}.wav`),
      });
    }
  } else if (plan.topOn) {
    if (!plan.topScript) {
      const error = new Error("Voiceover is enabled but the script is empty.");
      error.code = "TTS_EMPTY_SCRIPT";
      throw error;
    }
    jobs.push({
      script: plan.topScript,
      startSec: 0,
      maxSec: plan.totalSeconds,
      outputPath: resolve(GENERATED_VOICE_DIR, "full.wav"),
    });
  } else {
    const error = new Error(
      "Voiceover is enabled but no narration script was provided.",
    );
    error.code = "TTS_EMPTY_SCRIPT";
    throw error;
  }

  if (!skipFilesystem) clearGeneratedVoiceDir();

  const clips = [];
  try {
    for (const job of jobs) {
      const probed = await synthesizeIntoSlot(job, {
        pace: plan.pace,
        generateFn,
        probeFn,
      });
      clips.push({
        rel: `build/audio/voice/${basename(job.outputPath)}`,
        startSec: job.startSec,
        durationSec: probed,
      });
    }
  } catch (err) {
    if (!skipFilesystem) clearGeneratedVoiceDir();
    throw err;
  }

  const result = { mode: "generated", clips };
  if (!skipFilesystem) writeManifest(result);
  return result;
}

export function existingGeneratedClips(storyboard) {
  if (!isVoiceoverRequested(storyboard)) return [];
  const manifest = readManifest();
  if (manifest?.clips?.length) {
    return manifest.clips.filter((clip) => {
      if (!clip || typeof clip.rel !== "string") return false;
      const abs = resolve(projectRoot, clip.rel);
      return existsSync(abs) && statSync(abs).size > 0;
    });
  }
  const manual = findManualNarration();
  if (manual) {
    const { totalSeconds } = computeSceneTimeline(storyboard.scenes);
    return [
      {
        rel: manual.rel,
        startSec: 0,
        durationSec: totalSeconds,
      },
    ];
  }

  const plan = collectNarrationCues(storyboard);
  const clips = [];
  if (plan.cues.length > 0) {
    for (const cue of plan.cues) {
      const rel = `build/audio/voice/scene-${cue.index}.wav`;
      const abs = resolve(projectRoot, rel);
      if (!existsSync(abs) || statSync(abs).size <= 0) continue;
      clips.push({
        rel,
        startSec: framesToSeconds(cue.startFrames),
        durationSec: framesToSeconds(cue.durationFrames),
      });
    }
    return clips;
  }
  const fullRel = "build/audio/voice/full.wav";
  const fullAbs = resolve(projectRoot, fullRel);
  if (existsSync(fullAbs) && statSync(fullAbs).size > 0) {
    return [
      {
        rel: fullRel,
        startSec: 0,
        durationSec: plan.totalSeconds,
      },
    ];
  }
  return [];
}
