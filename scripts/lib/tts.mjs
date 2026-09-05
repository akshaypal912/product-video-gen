/**
 * Local Piper TTS adapter.
 * Never downloads models. Never interpolates text into a shell string.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { projectRoot } from "./storyboard.mjs";

export const GENERATED_VOICE_DIR = resolve(projectRoot, "build/audio/voice");
export const MANUAL_VOICE_WAV = resolve(projectRoot, "audio/voice/narration.wav");
export const MANUAL_VOICE_MP3 = resolve(projectRoot, "audio/voice/narration.mp3");

const MAX_TEXT_CHARS = 800;
const TTS_TIMEOUT_MS = 60_000;
const SETUP_MESSAGE =
  "Local TTS is not configured. Install/configure the supported Piper voice model and try again.";

function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  return String(raw).trim();
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

export function isTtsEnabled() {
  return envBool("TTS_ENABLED", true);
}

export function getTtsEngine() {
  return envFlag("TTS_ENGINE", "piper").toLowerCase();
}

function resolveBin() {
  return envFlag("PIPER_BIN", "piper");
}

function resolveModelPath() {
  const raw = envFlag("PIPER_MODEL", "models/piper/en_US-lessac-medium.onnx");
  return isAbsolute(raw) ? raw : resolve(projectRoot, raw);
}

function resolveConfigPath(modelPath) {
  const raw = envFlag("PIPER_CONFIG", "");
  if (raw) return isAbsolute(raw) ? raw : resolve(projectRoot, raw);
  const sibling = `${modelPath}.json`;
  return existsSync(sibling) ? sibling : "";
}

function fileNonEmpty(path) {
  return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
}

export function findManualNarration() {
  if (fileNonEmpty(MANUAL_VOICE_WAV)) {
    return { abs: MANUAL_VOICE_WAV, rel: "audio/voice/narration.wav" };
  }
  if (fileNonEmpty(MANUAL_VOICE_MP3)) {
    return { abs: MANUAL_VOICE_MP3, rel: "audio/voice/narration.mp3" };
  }
  return null;
}

function piperBinAvailable(bin) {
  if (bin.includes("/") || bin.includes("\\")) {
    return existsSync(bin);
  }
  const probe = spawnSync(bin, ["--help"], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
  });
  if (probe.error) return false;
  const text = `${probe.stdout || ""}${probe.stderr || ""}`;
  return probe.status === 0 || text.toLowerCase().includes("piper");
}

export function getTtsStatus() {
  const engine = getTtsEngine();
  const enabled = isTtsEnabled();
  const bin = resolveBin();
  const modelPath = resolveModelPath();
  const configPath = resolveConfigPath(modelPath);
  const binOnPath = piperBinAvailable(bin);
  const modelOk = fileNonEmpty(modelPath);
  const configured = engine === "piper" && enabled && binOnPath && modelOk;
  return {
    engine,
    enabled,
    configured,
    bin,
    modelPath,
    configPath,
    modelOk,
    binOnPath,
  };
}

export function assertTtsReady() {
  if (!isTtsEnabled()) {
    const error = new Error(
      "Local TTS is disabled (TTS_ENABLED=false). Provide audio/voice/narration.wav or enable TTS.",
    );
    error.code = "TTS_DISABLED";
    throw error;
  }
  const status = getTtsStatus();
  if (status.engine !== "piper") {
    const error = new Error(
      `Unsupported TTS_ENGINE="${status.engine}". Only piper is supported.`,
    );
    error.code = "TTS_UNSUPPORTED_ENGINE";
    throw error;
  }
  if (!status.binOnPath && !existsSync(status.bin)) {
    const error = new Error(
      `${SETUP_MESSAGE} Piper executable not found (PIPER_BIN=${status.bin}).`,
    );
    error.code = "TTS_BIN_MISSING";
    throw error;
  }
  if (!status.modelOk) {
    const error = new Error(
      `${SETUP_MESSAGE} Voice model missing (PIPER_MODEL). See docs/tts.md.`,
    );
    error.code = "TTS_MODEL_MISSING";
    throw error;
  }
  return status;
}

function sanitizeText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isInsideDir(filePath, dirPath) {
  const file = resolve(filePath);
  const dir = resolve(dirPath);
  const rel = relative(dir, file);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

function assertInsideGeneratedDir(outputPath) {
  const resolved = resolve(outputPath);
  if (!isInsideDir(resolved, GENERATED_VOICE_DIR) && resolved !== GENERATED_VOICE_DIR) {
    throw new Error("Refusing to write TTS output outside build/audio/voice/.");
  }
  return resolved;
}

function lengthScaleFor({ speed, pace, lengthScale }) {
  if (
    typeof lengthScale === "number" &&
    Number.isFinite(lengthScale) &&
    lengthScale >= 0.5 &&
    lengthScale <= 2.0
  ) {
    return Number(lengthScale.toFixed(3));
  }
  const envSpeed = envFlag("TTS_SPEED", "");
  if (envSpeed && Number.isFinite(Number(envSpeed))) {
    const rate = Number(envSpeed);
    if (rate > 0.5 && rate < 2.5) return Number((1 / rate).toFixed(3));
  }
  if (typeof speed === "number" && Number.isFinite(speed) && speed > 0.5 && speed < 2.5) {
    return Number((1 / speed).toFixed(3));
  }
  if (pace === "measured") return 1.12;
  if (pace === "urgent") return 0.88;
  return 1.0;
}

export { lengthScaleFor };

function spawnPiper({ bin, args, text }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error("Piper TTS timed out.");
      error.code = "TTS_TIMEOUT";
      reject(error);
    }, TTS_TIMEOUT_MS);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        const error = new Error(
          `${SETUP_MESSAGE} Piper executable not found.`,
        );
        error.code = "TTS_BIN_MISSING";
        reject(error);
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
        return;
      }
      const error = new Error(
        "Piper TTS failed to generate speech. Check PIPER_BIN and PIPER_MODEL.",
      );
      error.code = "TTS_PROCESS_FAILED";
      error.detail = stderr.trim().slice(0, 400);
      reject(error);
    });

    child.stdin.on("error", () => {});
    child.stdin.end(text, "utf8");
  });
}

/**
 * Synthesize one utterance to a WAV file under build/audio/voice/.
 * @param {{ text: string, outputPath: string, voice?: string, speed?: number, pace?: string, lengthScale?: number, sentenceSilence?: number }} opts
 */
export async function generateVoiceover({
  text,
  outputPath,
  speed,
  pace,
  lengthScale,
  sentenceSilence,
}) {
  const spoken = sanitizeText(text);
  if (!spoken) {
    const error = new Error("Voiceover script is empty.");
    error.code = "TTS_EMPTY_SCRIPT";
    throw error;
  }
  if (spoken.length > MAX_TEXT_CHARS) {
    const error = new Error(
      `Voiceover script exceeds ${MAX_TEXT_CHARS} characters.`,
    );
    error.code = "TTS_SCRIPT_TOO_LONG";
    throw error;
  }

  const status = assertTtsReady();
  const dest = assertInsideGeneratedDir(outputPath);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) unlinkSync(dest);

  const silence =
    typeof sentenceSilence === "number" &&
    Number.isFinite(sentenceSilence) &&
    sentenceSilence >= 0 &&
    sentenceSilence <= 1
      ? sentenceSilence
      : 0.18;

  const args = [
    "--model",
    status.modelPath,
    "--output_file",
    dest,
    "--length-scale",
    String(lengthScaleFor({ speed, pace, lengthScale })),
    "--sentence-silence",
    String(silence),
  ];
  if (status.configPath) {
    args.push("--config", status.configPath);
  }

  try {
    await spawnPiper({ bin: status.bin, args, text: spoken });
  } catch (err) {
    if (existsSync(dest)) {
      try {
        unlinkSync(dest);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }

  if (!fileNonEmpty(dest)) {
    const error = new Error("Piper produced an empty audio file.");
    error.code = "TTS_EMPTY_OUTPUT";
    throw error;
  }
  return dest;
}
