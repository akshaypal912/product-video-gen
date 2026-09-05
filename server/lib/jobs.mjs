/**
 * In-memory job store + FIFO queue.
 *
 * DEVELOPMENT ONLY: jobs disappear when the process restarts.
 * Future: Redis / BullMQ will replace this store.
 */

/** @typedef {'queued' | 'running' | 'completed' | 'failed'} JobStatus */

/**
 * @typedef {object} VideoJob
 * @property {string} jobId
 * @property {JobStatus} status
 * @property {string | null} stage
 * @property {string | null} stageMessage
 * @property {object} storyboard
 * @property {string | null} error
 * @property {object | null} output
 * @property {number} createdAt
 * @property {number | null} startedAt
 * @property {number | null} finishedAt
 */

const jobs = new Map();
/** @type {string[]} */
const queue = [];
let activeJobId = null;

export function createJob(jobId, storyboard) {
  /** @type {VideoJob} */
  const job = {
    jobId,
    status: "queued",
    stage: "queued",
    stageMessage: "Waiting to start...",
    storyboard,
    error: null,
    output: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  jobs.set(jobId, job);
  queue.push(jobId);
  return job;
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export function getActiveJobId() {
  return activeJobId;
}

export function setActiveJobId(jobId) {
  activeJobId = jobId;
}

export function dequeueNextJobId() {
  if (activeJobId) return null;
  const next = queue.shift();
  return next || null;
}

export function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

/** Public API shape — never includes storyboard payload or filesystem paths. */
export function toPublicJob(job) {
  if (!job) return null;
  const body = {
    jobId: job.jobId,
    status: job.status,
    stage: job.stage || job.status,
    stageMessage: job.stageMessage || null,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };

  if (job.status === "completed" && job.output) {
    body.duration = job.output.duration;
    body.fps = job.output.fps;
    body.width = job.output.width;
    body.height = job.output.height;
    body.format = job.output.format;
    body.frames = job.output.frames;
    body.downloadPath = `/api/videos/${job.jobId}/download`;
  }

  return body;
}
