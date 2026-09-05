/**
 * Ollama/Qwen director quality rules.
 * Applied only after AJV schema validation on the Ollama path.
 * Does not change the schema or the Mistral provider.
 */
import { FPS, framesToSeconds } from "../../../scripts/lib/timeline.mjs";

export const STORYBOARD_FPS = FPS;
/** Conservative Piper proxy vs ~2.5 conversational wps. Used for scenes ≥ 2s. */
export const TARGET_VOICEOVER_WORDS_PER_SEC = 2.0;
/** Floor only for scenes that are at least 2 seconds. Not applied to hook/CTA shorts. */
export const MIN_VOICEOVER_WORDS = 8;
/** Scene duration below this uses a Piper-fit cap of 3–5 words (no 8-word floor). */
export const SHORT_SCENE_SECONDS = 2;
export const SHORT_SCENE_MAX_WORDS = 5;
export const SHORT_SCENE_MIN_WORDS = 3;
/** Slightly denser proxy so ~1.8s (54f) caps at 5, not 8. */
export const SHORT_SCENE_WORDS_PER_SEC = 2.5;
/** Matches scripts/lib/voiceover.mjs VOICE_OFFSET_FRAMES. */
export const SCENE_VOICE_OFFSET_FRAMES = 4;
/** Ollama: do not synthesize VO when the scene audio slot is below this. */
export const OLLAMA_MIN_VO_AUDIO_SLOT_SEC = 2.5;

/** Known product/platform names we reject unless they appear in the description. */
export const KNOWN_PLATFORM_NAMES = Object.freeze([
  "salesforce",
  "slack",
  "zendesk",
  "intercom",
  "pipedrive",
  "hubspot",
  "linkedin",
  "snowflake",
  "tableau",
  "shopify",
  "stripe",
  "mailchimp",
  "asana",
  "jira",
  "notion",
  "gmail",
  "outlook",
  "whatsapp",
  "facebook",
  "instagram",
]);

export function wordCount(text) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length;
}

export function sceneDurationSeconds(durationFrames) {
  const frames = Number(durationFrames);
  if (!Number.isFinite(frames) || frames <= 0) return 0;
  return framesToSeconds(frames);
}

/** Available Piper slot: scene duration minus the voice offset used at render time. */
export function sceneVoiceoverAudioSlotSeconds(durationFrames) {
  const frames = Number(durationFrames);
  if (!Number.isFinite(frames) || frames <= 0) return 0;
  return framesToSeconds(
    Math.max(frames - SCENE_VOICE_OFFSET_FRAMES, 1),
  );
}

export function ollamaSceneRequiresVoiceover(scene) {
  const slot = sceneVoiceoverAudioSlotSeconds(scene?.duration);
  return slot >= OLLAMA_MIN_VO_AUDIO_SLOT_SEC;
}

/**
 * Duration-aware word cap at 30 FPS.
 * Under 2s: 3–5 words (54f / 1.8s → 5). No 8-word floor.
 * 2s+: max(8, ceil(durationSec * 2.0)) — 66f → 8, 108f → 8, 150f → 10.
 */
export function maxVoiceoverWords(durationFrames) {
  const sec = sceneDurationSeconds(durationFrames);
  if (sec <= 0) return 0;
  if (sec < SHORT_SCENE_SECONDS) {
    const fromRate = Math.ceil(sec * SHORT_SCENE_WORDS_PER_SEC);
    return Math.min(
      SHORT_SCENE_MAX_WORDS,
      Math.max(SHORT_SCENE_MIN_WORDS, fromRate),
    );
  }
  const fromRate = Math.ceil(sec * TARGET_VOICEOVER_WORDS_PER_SEC);
  return Math.max(MIN_VOICEOVER_WORDS, fromRate);
}

/** Conservative spoken duration proxy: wordCount / 2.0 wps. */
export function estimatedSpeechSeconds(words) {
  const count = Number(words);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return count / TARGET_VOICEOVER_WORDS_PER_SEC;
}

export function voiceoverFitsScene(script, durationFrames) {
  const words = wordCount(script);
  const budget = maxVoiceoverWords(durationFrames);
  return words <= budget && estimatedSpeechSeconds(words) <= estimatedSpeechSeconds(budget);
}

export function normalizeCopy(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCtaScene(scene) {
  const role = typeof scene?.role === "string" ? scene.role : "";
  return scene?.type === "cta-outro" || role === "cta" || role === "close";
}

/** Exact normalized match of VO against an on-screen string (punctuation ignored). */
export function copiesExactOnScreenCopy(script, onScreenItems) {
  const normalizedScript = normalizeCopy(script);
  if (!normalizedScript) return false;
  for (const copy of onScreenItems || []) {
    const normalizedCopy = normalizeCopy(copy);
    if (normalizedCopy && normalizedScript === normalizedCopy) return true;
  }
  return false;
}

/** Non-CTA: exact match or a 4+ word on-screen sentence fully copied into VO. */
export function copiesFullOnScreenSentence(script, onScreenItems, productName) {
  const normalizedScript = normalizeCopy(script);
  const skip = productName ? normalizeCopy(productName) : "";
  for (const copy of onScreenItems || []) {
    const normalizedCopy = normalizeCopy(copy);
    if (!normalizedCopy || (skip && normalizedCopy === skip)) continue;
    if (normalizedScript === normalizedCopy) return true;
    if (wordCount(copy) >= 4 && normalizedScript.includes(normalizedCopy)) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function descriptionHasPhrase(description, phrase) {
  const needle = normalizeCopy(phrase);
  if (!needle) return false;
  return normalizeCopy(description).includes(needle);
}

function collectOnScreenCopy(scene) {
  const props = scene?.props && typeof scene.props === "object" ? scene.props : {};
  const items = [];
  if (typeof props.productName === "string") items.push(props.productName);
  if (Array.isArray(props.lines)) {
    for (const line of props.lines) {
      if (typeof line === "string") items.push(line);
    }
  }
  if (typeof props.label === "string") items.push(props.label);
  if (typeof props.caption === "string") items.push(props.caption);
  if (Array.isArray(props.labels)) {
    for (const label of props.labels) {
      if (typeof label === "string") items.push(label);
    }
  }
  if (typeof props.headline === "string") items.push(props.headline);
  if (typeof props.sub === "string") items.push(props.sub);
  const value = typeof props.value === "string" ? props.value : "";
  const suffix = typeof props.suffix === "string" ? props.suffix : "";
  if (value || suffix) items.push(`${value}${suffix}`);
  return items;
}

function collectStoryboardText(storyboard) {
  const chunks = [];
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  for (const scene of scenes) {
    chunks.push(...collectOnScreenCopy(scene));
    const script = scene?.voiceover?.script;
    if (typeof script === "string") chunks.push(script);
  }
  return chunks.join("\n");
}

function extractDigitTokens(text) {
  const matches = String(text || "").match(/\d+(?:\.\d+)?/g);
  return matches ? [...new Set(matches)] : [];
}

function pushError(errors, instancePath, message) {
  errors.push({ instancePath, message });
}

/**
 * @param {object} storyboard
 * @param {string} description
 * @returns {{ ok: true } | { ok: false, status: number, error: string, details: string[] }}
 */
export function validateOllamaDirectorOutput(storyboard, description) {
  const errors = [];
  const desc = typeof description === "string" ? description : "";
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  const seenScripts = [];

  scenes.forEach((scene, index) => {
    const path = `/scenes/${index}`;
    const vo = scene?.voiceover && typeof scene.voiceover === "object" ? scene.voiceover : {};
    const script = typeof vo.script === "string" ? vo.script : "";
    const enabled = vo.enabled === true;
    const onScreen = collectOnScreenCopy(scene);
    const productName =
      typeof scene?.props?.productName === "string" ? scene.props.productName.trim() : "";
    const requiresVo = ollamaSceneRequiresVoiceover(scene);

    if (!requiresVo) {
      if (enabled) {
        pushError(
          errors,
          `${path}/voiceover`,
          `scenes under ${OLLAMA_MIN_VO_AUDIO_SLOT_SEC}s audio must have voiceover disabled`,
        );
      }
    } else if (!enabled || !script.trim()) {
      pushError(
        errors,
        `${path}/voiceover`,
        "each scene needs voiceover.enabled true and a short script",
      );
    } else {
      const words = wordCount(script);
      const maxWords = maxVoiceoverWords(scene.duration);
      if (!voiceoverFitsScene(script, scene.duration)) {
        pushError(
          errors,
          `${path}/voiceover/script`,
          `voiceover is ${words} words but duration ${scene.duration} frames allows at most ${maxWords} (under 2s: 3-5 words; else max(8, ceil(seconds*2)) at 30fps)`,
        );
      }

      const normalizedScript = normalizeCopy(script);
      if (productName && normalizedScript === normalizeCopy(productName)) {
        pushError(
          errors,
          `${path}/voiceover/script`,
          "hook voiceover must state a user benefit, not only the product name",
        );
      }

      const duplicated = isCtaScene(scene)
        ? copiesExactOnScreenCopy(script, onScreen)
        : copiesFullOnScreenSentence(script, onScreen, productName);
      if (duplicated) {
        pushError(
          errors,
          `${path}/voiceover/script`,
          "voiceover must not duplicate on-screen copy",
        );
      }

      if (seenScripts.includes(normalizedScript)) {
        pushError(
          errors,
          `${path}/voiceover/script`,
          "voiceover scripts must be unique; the CTA must not repeat earlier narration",
        );
      } else {
        seenScripts.push(normalizedScript);
      }
    }

    const role = typeof scene?.role === "string" ? scene.role : "";
    if (
      (role === "friction" || role === "problem") &&
      scene?.type === "text-reveal" &&
      Array.isArray(scene?.props?.lines) &&
      scene.props.lines.length > 1
    ) {
      pushError(
        errors,
        `${path}/props/lines`,
        "friction must be one short line, not a feature dump",
      );
    }

    if (index === 0 && role && role !== "hook") {
      pushError(
        errors,
        `${path}/role`,
        'the first scene is the hook (role "hook"), not a silent logo sting',
      );
    }

    if (scene?.type === "icon-grid") {
      const labels = Array.isArray(scene?.props?.labels) ? scene.props.labels : [];
      const colors = Array.isArray(scene?.props?.iconColors)
        ? scene.props.iconColors
        : [];
      const seenLabels = new Set();
      labels.forEach((label, labelIndex) => {
        if (typeof label !== "string") return;
        const key = normalizeCopy(label);
        if (seenLabels.has(key)) {
          pushError(
            errors,
            `${path}/props/labels/${labelIndex}`,
            "do not repeat an integration name to fill visual space",
          );
        }
        seenLabels.add(key);
        if (!descriptionHasPhrase(desc, label)) {
          pushError(
            errors,
            `${path}/props/labels/${labelIndex}`,
            `label "${label}" is not in the product description`,
          );
        }
      });
      if (labels.length > 0 && colors.length !== labels.length) {
        pushError(
          errors,
          `${path}/props/iconColors`,
          "iconColors count must match the number of real labels",
        );
      }
    }

    if (scene?.type === "stat-callout") {
      const value = typeof scene?.props?.value === "string" ? scene.props.value : "";
      const digits = extractDigitTokens(value);
      const describedDigits = new Set(extractDigitTokens(desc));
      for (const token of digits) {
        if (!describedDigits.has(token)) {
          pushError(
            errors,
            `${path}/props/value`,
            `statistic "${value}" is not in the product description`,
          );
          break;
        }
      }
    }
  });

  const boardText = collectStoryboardText(storyboard);
  for (const platform of KNOWN_PLATFORM_NAMES) {
    const tokenRe = new RegExp(`\\b${escapeRegExp(platform)}\\b`, "i");
    if (tokenRe.test(boardText) && !tokenRe.test(desc)) {
      pushError(
        errors,
        "/scenes",
        `do not mention "${platform}" unless it appears in the product description`,
      );
    }
  }

  if (errors.length === 0) return { ok: true };

  return {
    ok: false,
    status: 422,
    error:
      "Storyboard generation failed: the model output did not follow the director constraints.",
    details: errors.map((err) => `${err.instancePath}: ${err.message}`),
  };
}
