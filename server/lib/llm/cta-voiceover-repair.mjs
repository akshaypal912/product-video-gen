/**
 * Deterministic CTA voiceover repair for the Ollama path only.
 * Runs after AJV and before director checks. Does not change the validator.
 */
import {
  copiesExactOnScreenCopy,
  isCtaScene,
  maxVoiceoverWords,
  normalizeCopy,
  voiceoverFitsScene,
  wordCount,
} from "./ollama-director-rules.mjs";

const GENERIC_CTA_SCRIPTS = Object.freeze([
  {
    keys: ["workspace", "workflow"],
    script: "Bring your customer workflow together.",
  },
  {
    keys: ["prospect", "faster"],
    script: "Make prospecting simpler and faster.",
  },
  {
    keys: ["data"],
    script: "Turn your customer data into action.",
  },
]);

export function ctaOnScreenItems(scene) {
  const props = scene?.props && typeof scene.props === "object" ? scene.props : {};
  const items = [];
  if (typeof props.headline === "string") items.push(props.headline);
  if (typeof props.sub === "string") items.push(props.sub);
  return items;
}

export function needsCtaVoiceoverRepair(scene) {
  if (!isCtaScene(scene)) return false;
  const script = scene?.voiceover?.script;
  if (typeof script !== "string" || !script.trim()) return false;
  return copiesExactOnScreenCopy(script, ctaOnScreenItems(scene));
}

function haystackText(storyboard, description) {
  const chunks = [typeof description === "string" ? description : ""];
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  for (const scene of scenes) {
    const props = scene?.props && typeof scene.props === "object" ? scene.props : {};
    if (typeof props.productName === "string") chunks.push(props.productName);
    if (Array.isArray(props.lines)) chunks.push(...props.lines.filter((l) => typeof l === "string"));
    if (typeof props.label === "string") chunks.push(props.label);
    if (typeof props.caption === "string") chunks.push(props.caption);
  }
  return normalizeCopy(chunks.join(" "));
}

function otherVoiceoverScripts(storyboard, ctaIndex) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  const scripts = [];
  scenes.forEach((scene, index) => {
    if (index === ctaIndex) return;
    const script = scene?.voiceover?.script;
    if (typeof script === "string" && script.trim()) scripts.push(script);
  });
  return scripts;
}

function reusedBenefitCandidates(storyboard, ctaIndex) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  const preferredRoles = new Set(["benefit", "reveal", "hook", "proof"]);
  const preferred = [];
  const rest = [];
  scenes.forEach((scene, index) => {
    if (index === ctaIndex || isCtaScene(scene)) return;
    const props = scene?.props && typeof scene.props === "object" ? scene.props : {};
    const bits = [];
    if (Array.isArray(props.lines)) {
      for (const line of props.lines) {
        if (typeof line === "string" && line.trim()) bits.push(line.trim());
      }
    }
    if (typeof props.label === "string" && props.label.trim()) bits.push(props.label.trim());
    if (typeof props.caption === "string" && props.caption.trim()) bits.push(props.caption.trim());
    const role = typeof scene?.role === "string" ? scene.role : "";
    const bucket = preferredRoles.has(role) ? preferred : rest;
    bucket.push(...bits);
  });
  return [...preferred, ...rest];
}

function isAllowedReplacement(script, scene, onScreen, otherScripts) {
  if (typeof script !== "string" || !script.trim()) return false;
  if (copiesExactOnScreenCopy(script, onScreen)) return false;
  if (!voiceoverFitsScene(script, scene.duration)) return false;
  const normalized = normalizeCopy(script);
  for (const other of otherScripts) {
    if (normalizeCopy(other) === normalized) return false;
  }
  return wordCount(script) >= 3;
}

export function selectCtaReplacementScript(storyboard, description, ctaIndex) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  const scene = scenes[ctaIndex];
  if (!scene) return null;
  const onScreen = ctaOnScreenItems(scene);
  const otherScripts = otherVoiceoverScripts(storyboard, ctaIndex);
  const haystack = haystackText(storyboard, description);

  for (const candidate of reusedBenefitCandidates(storyboard, ctaIndex)) {
    if (isAllowedReplacement(candidate, scene, onScreen, otherScripts)) {
      return candidate;
    }
  }

  for (const generic of GENERIC_CTA_SCRIPTS) {
    const hit = generic.keys.some((key) => haystack.includes(key));
    if (!hit) continue;
    if (isAllowedReplacement(generic.script, scene, onScreen, otherScripts)) {
      return generic.script;
    }
  }

  for (const generic of GENERIC_CTA_SCRIPTS) {
    if (isAllowedReplacement(generic.script, scene, onScreen, otherScripts)) {
      return generic.script;
    }
  }
  return null;
}

/**
 * Returns a new storyboard. Only CTA/close/cta-outro voiceover.script may change.
 * @param {object} storyboard
 * @param {string} [description]
 */
export function repairCtaVoiceover(storyboard, description = "") {
  if (!storyboard || typeof storyboard !== "object" || !Array.isArray(storyboard.scenes)) {
    return storyboard;
  }

  let changed = false;
  const scenes = storyboard.scenes.map((scene, index) => {
    if (!needsCtaVoiceoverRepair(scene)) return scene;
    const replacement = selectCtaReplacementScript(storyboard, description, index);
    if (!replacement) return scene;
    changed = true;
    return {
      ...scene,
      props: scene.props,
      voiceover: {
        ...(scene.voiceover && typeof scene.voiceover === "object" ? scene.voiceover : {}),
        enabled: true,
        script: replacement,
      },
    };
  });

  if (!changed) return storyboard;
  return { ...storyboard, scenes };
}
