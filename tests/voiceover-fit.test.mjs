import assert from "node:assert/strict";
import { test } from "node:test";
import { VALID_STORYBOARD } from "./helpers.mjs";
import {
  FIT_SENTENCE_SILENCE,
  MIN_PIPER_LENGTH_SCALE,
  planVoiceoverFit,
  VOICE_FIT_SAFETY,
} from "../scripts/lib/voiceover-fit.mjs";
import {
  collectNarrationCues,
  prepareVoiceover,
} from "../scripts/lib/voiceover.mjs";
import { framesToSeconds } from "../scripts/lib/timeline.mjs";

function oneSceneBoard() {
  return {
    audio: {
      voiceover: { enabled: true, pace: "natural" },
    },
    scenes: [
      {
        type: "text-reveal",
        duration: 60,
        role: "hook",
        props: { lines: ["Find prospects faster."] },
        voiceover: {
          enabled: true,
          script: "Find the right people faster with Tables.",
        },
      },
    ],
  };
}

function slotSecFor(board) {
  const cues = collectNarrationCues(board).cues;
  return framesToSeconds(cues[0].durationFrames);
}

function timingSnapshot(board) {
  const { cues, totalFrames, totalSeconds } = collectNarrationCues(board);
  return {
    totalFrames,
    totalSeconds,
    cues: cues.map((c) => ({
      index: c.index,
      startFrames: c.startFrames,
      durationFrames: c.durationFrames,
    })),
  };
}

function pipelineHooks({ durations, generateCalls }) {
  let i = 0;
  return {
    skipFilesystem: true,
    findManualNarration: () => null,
    isTtsEnabled: () => true,
    generateVoiceover: async (opts) => {
      generateCalls.push(opts);
    },
    probeDurationSeconds: async () => {
      const value = durations[i];
      i += 1;
      return value;
    },
  };
}

test("planner keeps WAV shorter than the safety cap", () => {
  const plan = planVoiceoverFit({
    wavSec: 1.2,
    slotSec: 1.67,
    lengthScale: 1,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.action, "keep");
  assert.equal(plan.durationSec, 1.2);
});

test("planner resynthesizes when WAV is slightly over the cap", () => {
  const slotSec = 1.67;
  const wavSec = 1.9;
  const plan = planVoiceoverFit({ wavSec, slotSec, lengthScale: 1 });
  assert.equal(plan.ok, true);
  assert.equal(plan.action, "resynthesize");
  assert.ok(plan.lengthScale < 1);
  assert.ok(plan.lengthScale >= MIN_PIPER_LENGTH_SCALE);
  assert.equal(plan.sentenceSilence, FIT_SENTENCE_SILENCE);
  const expected = Number(((slotSec * VOICE_FIT_SAFETY) / wavSec).toFixed(3));
  assert.equal(plan.lengthScale, expected);
});

test("planner fails when WAV needs more than ~1.25× speed", () => {
  const plan = planVoiceoverFit({
    wavSec: 2.95,
    slotSec: 1.67,
    lengthScale: 1,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.action, "fail");
  assert.equal(plan.reason, "too-long");
});

test("WAV shorter than slot is kept at measured duration (no truncation, no stretch)", async () => {
  const board = oneSceneBoard();
  const before = timingSnapshot(board);
  const slot = slotSecFor(board);
  const generateCalls = [];
  const result = await prepareVoiceover(
    board,
    pipelineHooks({ durations: [1.2], generateCalls }),
  );
  assert.equal(result.mode, "generated");
  assert.equal(result.clips.length, 1);
  assert.equal(result.clips[0].durationSec, 1.2);
  assert.ok(result.clips[0].durationSec < slot);
  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0].sentenceSilence, 0.18);
  assert.deepEqual(timingSnapshot(board), before);
});

test("WAV slightly longer is refit with Piper length-scale and then kept whole", async () => {
  const board = oneSceneBoard();
  const before = timingSnapshot(board);
  const slot = slotSecFor(board);
  const generateCalls = [];
  const fitted = slot * 0.9;
  const result = await prepareVoiceover(
    board,
    pipelineHooks({ durations: [slot * 1.12, fitted], generateCalls }),
  );
  assert.equal(result.mode, "generated");
  assert.equal(result.clips[0].durationSec, fitted);
  assert.ok(result.clips[0].durationSec <= slot);
  assert.notEqual(result.clips[0].durationSec, slot);
  assert.equal(generateCalls.length, 2);
  assert.ok(generateCalls[1].lengthScale < generateCalls[0].lengthScale);
  assert.ok(generateCalls[1].lengthScale >= MIN_PIPER_LENGTH_SCALE);
  assert.equal(generateCalls[1].sentenceSilence, FIT_SENTENCE_SILENCE);
  assert.deepEqual(timingSnapshot(board), before);
});

test("WAV much longer fails clearly instead of silent truncation", async () => {
  const board = oneSceneBoard();
  const before = timingSnapshot(board);
  const slot = slotSecFor(board);
  const generateCalls = [];
  await assert.rejects(
    () =>
      prepareVoiceover(
        board,
        pipelineHooks({ durations: [2.95], generateCalls }),
      ),
    (err) => {
      assert.equal(err.code, "TTS_DOES_NOT_FIT");
      assert.match(err.message, /2\.95s/);
      assert.match(err.message, new RegExp(`${slot.toFixed(2)}s`));
      assert.match(err.message, /Shorten the script/);
      return true;
    },
  );
  assert.equal(generateCalls.length, 1);
  assert.deepEqual(timingSnapshot(board), before);
});

test("manual narration fallback still works and does not change scene timing", async () => {
  const board = structuredClone(VALID_STORYBOARD);
  const before = timingSnapshot(board);
  const { totalSeconds } = collectNarrationCues(board);
  const result = await prepareVoiceover(board, {
    skipFilesystem: true,
    isTtsEnabled: () => false,
    findManualNarration: () => ({
      abs: "audio/voice/narration.wav",
      rel: "audio/voice/narration.wav",
    }),
    probeDurationSeconds: async () => 4.5,
    generateVoiceover: async () => {
      throw new Error("Piper must not run when manual narration is present");
    },
  });
  assert.equal(result.mode, "manual");
  assert.equal(result.clips[0].rel, "audio/voice/narration.wav");
  assert.equal(result.clips[0].startSec, 0);
  assert.equal(result.clips[0].durationSec, 4.5);
  assert.ok(result.clips[0].durationSec <= totalSeconds);
  assert.deepEqual(timingSnapshot(board), before);
});
