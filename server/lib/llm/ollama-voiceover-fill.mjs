/**
 * Ollama-only: replace scene voiceover scripts with duration-fit phrases
 * taken from the product description and on-screen copy. Not a summarizer.
 */
import {
  copiesExactOnScreenCopy,
  copiesFullOnScreenSentence,
  isCtaScene,
  maxVoiceoverWords,
  normalizeCopy,
  ollamaSceneRequiresVoiceover,
  sceneDurationSeconds,
  SHORT_SCENE_SECONDS,
  voiceoverFitsScene,
  wordCount,
} from "./ollama-director-rules.mjs";

/** Ollama filler: under 2s scenes always get exactly three words. */
export const SHORT_SCENE_TARGET_WORDS = 3;

const SHORT_HOOK_TEMPLATES = [
  "discover prospects faster",
  "right prospects faster",
  "connect with prospects",
  "sales teams discover",
  "discover and connect",
  "teams discover and",
  "helps sales teams",
];

const SHORT_CTA_TEMPLATES = [
  "connect with prospects",
  "one intelligent workspace",
  "replace fragmented workflows",
  "right prospects faster",
  "discover prospects faster",
];

const SHORT_FRICTION_TEMPLATES = [
  "replace fragmented workflows",
  "fragmented workflows with",
  "teams replace fragmented",
];

const SHORT_DEFAULT_TEMPLATES = [
  "discover prospects faster",
  "one intelligent workspace",
  "customer intelligence platform",
];

const WEAK_LEAD = new Set([
  "a",
  "an",
  "the",
  "is",
  "it",
  "and",
  "or",
  "to",
  "of",
  "with",
  "that",
  "this",
  "for",
  "in",
  "on",
  "as",
  "by",
]);

function collectSceneOnScreen(scene) {
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
  return items;
}

function tokenize(text) {
  return normalizeCopy(text)
    .split(" ")
    .filter((word) => word && !/\d/.test(word));
}

function ngramsFrom(text, minN, maxN) {
  const words = tokenize(text);
  const out = [];
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      out.push(words.slice(i, i + n).join(" "));
    }
  }
  return out;
}

function isShortScene(scene) {
  const sec = sceneDurationSeconds(scene?.duration);
  return sec > 0 && sec < SHORT_SCENE_SECONDS;
}

function allowedWordSet(storyboard, description) {
  const words = new Set();
  for (const word of tokenize(description)) words.add(word);
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  for (const scene of scenes) {
    for (const item of collectSceneOnScreen(scene)) {
      for (const word of tokenize(item)) words.add(word);
    }
  }
  return words;
}

function shortTemplatesForScene(scene) {
  const role = typeof scene?.role === "string" ? scene.role : "";
  const type = scene?.type;
  if (type === "logo-intro" || role === "hook") return SHORT_HOOK_TEMPLATES;
  if (isCtaScene(scene)) return SHORT_CTA_TEMPLATES;
  if (role === "friction" || role === "problem") return SHORT_FRICTION_TEMPLATES;
  return SHORT_DEFAULT_TEMPLATES;
}

function templatePhrases(storyboard, description, scene) {
  const allowed = allowedWordSet(storyboard, description);
  const out = [];
  const seen = new Set();
  for (const template of shortTemplatesForScene(scene)) {
    const phrase = normalizeCopy(template);
    const words = phrase.split(" ").filter(Boolean);
    if (words.length !== SHORT_SCENE_TARGET_WORDS) continue;
    if (!words.every((word) => allowed.has(word))) continue;
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    out.push(phrase);
  }
  return out;
}

function phraseBank(storyboard, description, maxN, shortOnly = false) {
  const minN = shortOnly ? SHORT_SCENE_TARGET_WORDS : 3;
  const cap = shortOnly ? SHORT_SCENE_TARGET_WORDS : maxN;
  const seen = new Set();
  const phrases = [];
  const pushAll = (text) => {
    for (const phrase of ngramsFrom(text, minN, cap)) {
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      phrases.push(phrase);
    }
  };
  pushAll(description);
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  for (const scene of scenes) {
    for (const item of collectSceneOnScreen(scene)) {
      pushAll(item);
    }
  }
  return phrases;
}

function formatScript(normalizedPhrase) {
  const words = String(normalizedPhrase || "").split(" ").filter(Boolean);
  if (!words.length) return "";
  const first = `${words[0].charAt(0).toUpperCase()}${words[0].slice(1)}`;
  return `${[first, ...words.slice(1)].join(" ")}.`;
}

function roleTerms(scene) {
  const role = typeof scene?.role === "string" ? scene.role : "";
  const type = scene?.type;
  if (type === "logo-intro" || role === "hook") {
    return ["faster", "prospects", "discover", "connect", "sales", "teams"];
  }
  if (role === "friction" || role === "problem") {
    return ["fragmented", "workflows", "workflow", "replace", "teams"];
  }
  if (role === "benefit" || role === "reveal") {
    return ["workspace", "intelligent", "intelligence", "customer"];
  }
  if (role === "proof" || type === "stat-callout") {
    return ["profiles", "professional", "access", "customer"];
  }
  if (role === "ecosystem" || type === "icon-grid") {
    return ["linkedin", "hubspot", "connect", "data", "customer"];
  }
  if (isCtaScene(scene)) {
    return ["faster", "workspace", "prospects", "connect", "sales"];
  }
  return ["customer", "sales", "teams"];
}

function scorePhrase(phrase, terms, { short = false } = {}) {
  const words = phrase.split(" ");
  let score = 0;
  for (const word of words) {
    if (terms.includes(word)) score += 3;
  }
  if (!short) score += words.length;
  if (WEAK_LEAD.has(words[0])) score -= 4;
  return score;
}

function rankPhrases(phrases, terms, short) {
  return phrases.map((phrase, index) => ({
    phrase,
    index,
    score: scorePhrase(phrase, terms, { short }),
    length: phrase.length,
  })).sort(
    (a, b) =>
      b.score - a.score ||
      a.length - b.length ||
      a.index - b.index,
  );
}

function isAllowedScript(script, scene, used, productName) {
  if (!script || !voiceoverFitsScene(script, scene.duration)) return false;
  const normalized = normalizeCopy(script);
  if (!normalized || used.has(normalized)) return false;
  if (productName && normalized === normalizeCopy(productName)) return false;
  const onScreen = collectSceneOnScreen(scene);
  if (isCtaScene(scene)) {
    if (copiesExactOnScreenCopy(script, onScreen)) return false;
  } else if (copiesFullOnScreenSentence(script, onScreen, productName)) {
    return false;
  }
  return true;
}

/**
 * Pick one duration-fit phrase for a scene from the shared bank.
 * @returns {string | null}
 */
export function selectFilledVoiceoverScript({
  scene,
  phrases,
  used,
  maxWords,
  storyboard,
  description,
}) {
  const productName =
    typeof scene?.props?.productName === "string" ? scene.props.productName.trim() : "";
  const terms = roleTerms(scene);
  const short = isShortScene(scene);
  const cap = short
    ? SHORT_SCENE_TARGET_WORDS
    : Math.min(maxWords, maxVoiceoverWords(scene.duration));

  if (short) {
    for (const phrase of templatePhrases(storyboard, description, scene)) {
      const script = formatScript(phrase);
      if (isAllowedScript(script, scene, used, productName)) return script;
    }
    const ranked = rankPhrases(
      phrases.filter((phrase) => wordCount(phrase) === SHORT_SCENE_TARGET_WORDS),
      terms,
      true,
    );
    for (const row of ranked) {
      const script = formatScript(row.phrase);
      if (isAllowedScript(script, scene, used, productName)) return script;
    }
    return null;
  }

  const candidatePhrases = phrases.filter((phrase) => {
    const n = wordCount(phrase);
    return n >= 3 && n <= cap;
  });
  const ranked = rankPhrases(candidatePhrases, terms, false).filter(
    (row) => wordCount(row.phrase) >= 3 && wordCount(row.phrase) <= cap,
  );

  for (const row of ranked) {
    const script = formatScript(row.phrase);
    if (isAllowedScript(script, scene, used, productName)) return script;
  }

  for (const phrase of phrases) {
    const words = phrase.split(" ");
    for (let n = Math.min(cap, words.length); n >= 3; n--) {
      const script = formatScript(words.slice(0, n).join(" "));
      if (isAllowedScript(script, scene, used, productName)) return script;
    }
  }
  return null;
}

/**
 * Ollama-only: disable VO on scenes whose audio slot is under 2.5s.
 */
export function disableOllamaShortSceneVoiceover(storyboard) {
  if (!storyboard || typeof storyboard !== "object" || !Array.isArray(storyboard.scenes)) {
    return storyboard;
  }
  const scenes = storyboard.scenes.map((scene) => {
    if (ollamaSceneRequiresVoiceover(scene)) return scene;
    const prev =
      scene.voiceover && typeof scene.voiceover === "object" ? scene.voiceover : {};
    return {
      ...scene,
      voiceover: {
        ...prev,
        enabled: false,
        script: "",
      },
    };
  });
  return { ...storyboard, scenes };
}

/**
 * Disable short-scene VO, then fill scripts for remaining scenes.
 */
export function applyOllamaVoiceoverPolicy(storyboard, description) {
  return fillOllamaVoiceoverScripts(
    disableOllamaShortSceneVoiceover(storyboard),
    description,
  );
}

/**
 * Overwrite every scene voiceover.script. Props/roles/durations are untouched.
 */
export function fillOllamaVoiceoverScripts(storyboard, description) {
  if (!storyboard || typeof storyboard !== "object" || !Array.isArray(storyboard.scenes)) {
    return storyboard;
  }
  const desc = typeof description === "string" ? description : "";
  const used = new Set();
  const scenes = storyboard.scenes.map((scene) => {
    if (!ollamaSceneRequiresVoiceover(scene)) {
      const prev =
        scene.voiceover && typeof scene.voiceover === "object" ? scene.voiceover : {};
      return {
        ...scene,
        voiceover: {
          ...prev,
          enabled: false,
          script: "",
        },
      };
    }
    const maxWords = maxVoiceoverWords(scene.duration);
    const short = isShortScene(scene);
    const phrases = phraseBank(storyboard, desc, maxWords, short);
    const script = selectFilledVoiceoverScript({
      scene,
      phrases,
      used,
      maxWords,
      storyboard,
      description: desc,
    });
    if (!script) return scene;
    used.add(normalizeCopy(script));
    const prev = scene.voiceover && typeof scene.voiceover === "object" ? scene.voiceover : {};
    return {
      ...scene,
      voiceover: {
        ...prev,
        enabled: true,
        script,
      },
    };
  });
  return { ...storyboard, scenes };
}
