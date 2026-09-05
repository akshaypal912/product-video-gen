/**
 * Re-export the local TTS adapter for the HTTP server.
 * Implementation lives in scripts/lib/tts.mjs so the CLI pipeline can share it.
 */
export {
  assertTtsReady,
  findManualNarration,
  generateVoiceover,
  getTtsStatus,
  isTtsEnabled,
} from "../../scripts/lib/tts.mjs";
