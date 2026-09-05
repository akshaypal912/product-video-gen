/**
 * Video job service — wraps the existing render pipeline.
 * No LLM logic. Accepts only validated storyboard objects.
 */
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  formatValidationErrors,
  projectRoot,
  validateStoryboard,
} from "../../scripts/lib/storyboard.mjs";
import { isVoiceoverRequested, prepareVoiceover } from "../../scripts/lib/voiceover.mjs";
import {
  createJob,
  dequeueNextJobId,
  getJob,
  setActiveJobId,
  toPublicJob,
  updateJob,
} from "./jobs.mjs";

const STORYBOARD_PATH = resolve(projectRoot, "storyboard.json");
const FINAL_MP4_PATH = resolve(projectRoot, "build/product-launch.mp4");
const ARTIFACTS_DIR = resolve(projectRoot, "build/artifacts");
const RENDER_SCRIPT = resolve(projectRoot, "scripts/render-video.mjs");
const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let pumpScheduled = false;

export function isValidJobId(jobId) {
  return typeof jobId === "string" && JOB_ID_RE.test(jobId);
}

export function artifactPathFor(jobId) {
  if (!isValidJobId(jobId)) {
    throw new Error("Invalid job id");
  }
  return resolve(ARTIFACTS_DIR, `${jobId}.mp4`);
}

function atomicWriteJson(targetPath, value) {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tmpPath = resolve(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.tmp`,
  );
  writeFileSync(tmpPath, payload, "utf8");
  try {
    renameSync(tmpPath, targetPath);
  } catch {
    copyFileSync(tmpPath, targetPath);
    unlinkSync(tmpPath);
  }
}

function sanitizeErrorMessage(raw) {
  let text = String(raw || "Render failed")
    .replace(/\r/g, "")
    .trim();
  // Drop absolute Windows/Unix paths from client-facing errors.
  text = text.replace(/[A-Za-z]:\\[^\s]+/g, "[path]");
  text = text.replace(/\/(?:Users|home|var|tmp|private)\/[^\s]+/g, "[path]");
  if (text.length > 500) text = `${text.slice(0, 500)}…`;
  return text || "Render failed";
}

function runRenderPipeline() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [RENDER_SCRIPT], {
      cwd: projectRoot,
      env: { ...process.env, VOICEOVER_ALREADY_PREPARED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 12000) stdout = stdout.slice(-12000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
      reject(new Error(detail));
    });
  });
}

function probeOutput() {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-show_entries",
        "stream=codec_type,width,height,r_frame_rate,nb_frames",
        "-of",
        "json",
        FINAL_MP4_PATH,
      ],
      { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolvePromise({
          duration: null,
          fps: FPS,
          width: WIDTH,
          height: HEIGHT,
          format: "mp4",
          frames: null,
        });
        return;
      }
      try {
        const meta = JSON.parse(stdout);
        const video = (meta.streams || []).find((s) => s.codec_type === "video");
        let fps = FPS;
        const rate = video?.r_frame_rate;
        if (typeof rate === "string" && rate.includes("/")) {
          const [a, b] = rate.split("/").map(Number);
          if (a && b) fps = a / b;
        }
        resolvePromise({
          duration:
            meta.format?.duration != null
              ? Number(meta.format.duration)
              : null,
          fps,
          width: video?.width ?? WIDTH,
          height: video?.height ?? HEIGHT,
          format: "mp4",
          frames: video?.nb_frames != null ? Number(video.nb_frames) : null,
        });
      } catch {
        resolvePromise({
          duration: null,
          fps: FPS,
          width: WIDTH,
          height: HEIGHT,
          format: "mp4",
          frames: null,
        });
      }
    });
  });
}

/**
 * Validate and enqueue a storyboard render job.
 * @returns {{ ok: true, job: object } | { ok: false, status: number, error: string, details?: string[] }}
 */
export function enqueueStoryboardJob(storyboard) {
  if (!storyboard || typeof storyboard !== "object" || Array.isArray(storyboard)) {
    return {
      ok: false,
      status: 400,
      error: 'Request body must include a "storyboard" object.',
    };
  }

  const validation = validateStoryboard(storyboard);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      error: "Storyboard validation failed.",
      details: formatValidationErrors(validation.errors).map((line) =>
        line.replace(/^\s*-\s*/, ""),
      ),
    };
  }

  const jobId = randomUUID();
  const job = createJob(jobId, storyboard);
  schedulePump();
  return { ok: true, job: toPublicJob(job) };
}

export function getPublicJob(jobId) {
  if (!isValidJobId(jobId)) return null;
  return toPublicJob(getJob(jobId));
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  setImmediate(() => {
    pumpScheduled = false;
    void pumpQueue();
  });
}

async function pumpQueue() {
  const nextId = dequeueNextJobId();
  if (!nextId) return;

  const job = getJob(nextId);
  if (!job) {
    schedulePump();
    return;
  }

  setActiveJobId(nextId);
  const wantsVoice = isVoiceoverRequested(job.storyboard);
  updateJob(nextId, {
    status: "running",
    stage: wantsVoice ? "generating_voiceover" : "rendering",
    stageMessage: wantsVoice ? "Creating voiceover..." : "Building scenes...",
    startedAt: Date.now(),
    error: null,
  });

  try {
    // Write storyboard only when this job becomes active (serialized).
    atomicWriteJson(STORYBOARD_PATH, job.storyboard);
    await prepareVoiceover(job.storyboard);

    updateJob(nextId, {
      status: "running",
      stage: "rendering",
      stageMessage: "Rendering video...",
    });
    await runRenderPipeline();

    if (!existsSync(FINAL_MP4_PATH) || statSync(FINAL_MP4_PATH).size <= 0) {
      throw new Error("Render finished but final MP4 is missing or empty.");
    }

    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const artifact = artifactPathFor(nextId);
    copyFileSync(FINAL_MP4_PATH, artifact);

    const output = await probeOutput();
    updateJob(nextId, {
      status: "completed",
      stage: "completed",
      stageMessage: "Your video is ready",
      finishedAt: Date.now(),
      error: null,
      output,
    });
  } catch (err) {
    updateJob(nextId, {
      status: "failed",
      stage: "failed",
      stageMessage: "Video rendering failed",
      finishedAt: Date.now(),
      error: sanitizeErrorMessage(err?.message || err),
      output: null,
    });
  } finally {
    setActiveJobId(null);
    // Drop heavy storyboard payload from memory after the job finishes.
    const finished = getJob(nextId);
    if (finished) finished.storyboard = null;
    schedulePump();
  }
}
