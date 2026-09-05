/**
 * Pure planner: fit a measured Piper WAV into a fixed scene audio slot.
 * Scene timeline is never rewritten here.
 *
 * Piper --length-scale: smaller = faster. speed ≈ 1 / lengthScale.
 */

export const VOICE_FIT_SAFETY = 0.96;
/** Fastest allowed speech (~1.25×). Below this sounds rushed. */
export const MIN_PIPER_LENGTH_SCALE = 0.8;
export const MAX_FIT_SPEED = Number((1 / MIN_PIPER_LENGTH_SCALE).toFixed(3));
export const DEFAULT_SENTENCE_SILENCE = 0.18;
export const FIT_SENTENCE_SILENCE = 0.05;

export function fitCapSeconds(slotSec) {
  const slot = Number(slotSec);
  if (!Number.isFinite(slot) || slot <= 0) return 0;
  return slot * VOICE_FIT_SAFETY;
}

/**
 * @param {{ wavSec: number, slotSec: number, lengthScale: number }} input
 * @returns {{
 *   ok: boolean,
 *   action: "keep" | "resynthesize" | "fail",
 *   lengthScale?: number,
 *   sentenceSilence?: number,
 *   durationSec?: number,
 *   wavSec?: number,
 *   slotSec?: number,
 *   cap?: number,
 *   requiredLengthScale?: number,
 *   reason?: string,
 * }}
 */
export function planVoiceoverFit({ wavSec, slotSec, lengthScale }) {
  const wav = Number(wavSec);
  const slot = Number(slotSec);
  const scale = Number(lengthScale);
  const cap = fitCapSeconds(slot);

  if (!(wav > 0) || !(slot > 0) || !(scale > 0)) {
    return { ok: false, action: "fail", reason: "invalid-duration", wavSec: wav, slotSec: slot };
  }

  if (wav <= cap) {
    return {
      ok: true,
      action: "keep",
      lengthScale: scale,
      durationSec: wav,
      wavSec: wav,
      slotSec: slot,
      cap,
    };
  }

  const requiredLengthScale = Number((scale * (cap / wav)).toFixed(3));
  if (requiredLengthScale < MIN_PIPER_LENGTH_SCALE) {
    return {
      ok: false,
      action: "fail",
      reason: "too-long",
      wavSec: wav,
      slotSec: slot,
      cap,
      requiredLengthScale,
      lengthScale: scale,
    };
  }

  return {
    ok: true,
    action: "resynthesize",
    lengthScale: Math.max(requiredLengthScale, MIN_PIPER_LENGTH_SCALE),
    sentenceSilence: FIT_SENTENCE_SILENCE,
    wavSec: wav,
    slotSec: slot,
    cap,
  };
}

export function voiceoverFitErrorMessage({ sceneLabel, wavSec, slotSec }) {
  const wav = Number(wavSec).toFixed(2);
  const slot = Number(slotSec).toFixed(2);
  return (
    `Voiceover${sceneLabel ? ` for ${sceneLabel}` : ""} is ${wav}s but the scene audio slot is ${slot}s. ` +
    `It cannot fit at a natural speaking rate (max ~${MAX_FIT_SPEED}×). Shorten the script.`
  );
}
