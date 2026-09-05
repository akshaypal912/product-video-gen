(() => {
  "use strict";

  const POLL_MS = 1500;
  const POLL_TIMEOUT_MS = 8 * 60 * 1000;
  const JOB_ID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const DEFAULT_DESCRIPTION =
    "Tables is a CRM backed by 297M+ profiles, integrates with LinkedIn and HubSpot, and helps teams manage customer data.";

  const DEFAULT_STORYBOARD = {
    audio: {
      music: { enabled: true, mood: "premium cinematic saas" },
      voiceover: {
        enabled: true,
        script:
          "Your next customer is already out there. Stop hunting across disconnected tools. Tables puts more than two hundred ninety seven million professionals in one workflow. Discover. Connect. Convert.",
        tone: "confident, warm, premium",
        pace: "natural",
      },
    },
    scenes: [
      {
        type: "logo-intro",
        duration: 36,
        role: "reveal",
        props: { productName: "Tables" },
        voiceover: { enabled: false, script: "" },
      },
      {
        type: "text-reveal",
        duration: 66,
        role: "hook",
        props: {
          lines: [
            "Your next customer is already out there.",
            "They just have not found you yet.",
          ],
        },
        voiceover: {
          enabled: true,
          script: "Your next customer is already out there.",
        },
      },
      {
        type: "text-reveal",
        duration: 84,
        role: "friction",
        props: {
          lines: [
            "Stop jumping between disconnected tools.",
            "Scattered data slows every deal.",
          ],
        },
        voiceover: {
          enabled: true,
          script:
            "Finding them still means jumping between tools that do not talk.",
        },
      },
      {
        type: "stat-callout",
        duration: 150,
        role: "proof",
        props: {
          value: "297",
          suffix: "M+",
          label: "Find the right people faster.",
        },
        voiceover: {
          enabled: true,
          script:
            "Find the right people across more than two hundred ninety seven million professionals.",
        },
      },
      {
        type: "icon-grid",
        duration: 96,
        role: "ecosystem",
        props: {
          caption: "One workflow. The tools you already use.",
          iconColors: ["#4FA6F7", "#7AA2FF", "#EF6C4D"],
          labels: ["LinkedIn", "Tables", "HubSpot"],
        },
        voiceover: {
          enabled: true,
          script:
            "Tables keeps LinkedIn and HubSpot in the same customer workflow.",
        },
      },
      {
        type: "cta-outro",
        duration: 48,
        role: "cta",
        props: { headline: "Discover. Connect. Convert.", sub: "Tables" },
        voiceover: {
          enabled: true,
          script: "Discover. Connect. Convert.",
        },
      },
    ],
  };

  const els = {
    generateForm: document.getElementById("generate-form"),
    description: document.getElementById("product-description"),
    generateBtn: document.getElementById("generate-btn"),
    storyboardForm: document.getElementById("storyboard-form"),
    storyboard: document.getElementById("storyboard"),
    storyboardBtn: document.getElementById("storyboard-btn"),
    statusPill: document.getElementById("status-pill"),
    statusMessage: document.getElementById("status-message"),
    jobId: document.getElementById("job-id"),
    metaSection: document.getElementById("meta-section"),
    metaList: document.getElementById("meta-list"),
    downloadBtn: document.getElementById("download-btn"),
    errorBox: document.getElementById("error-box"),
    errorTitle: document.getElementById("error-title"),
    errorMessage: document.getElementById("error-message"),
    errorDetails: document.getElementById("error-details"),
    voiceoverStatus: document.getElementById("voiceover-status"),
  };

  let pollTimer = null;
  let pollDeadline = 0;

  els.description.value = DEFAULT_DESCRIPTION;
  els.storyboard.value = `${JSON.stringify(DEFAULT_STORYBOARD, null, 2)}\n`;

  function setText(node, value) {
    node.textContent = value == null ? "" : String(value);
  }

  function stopPolling() {
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function setBusy(busy) {
    els.generateBtn.disabled = busy;
    els.storyboardBtn.disabled = busy;
    els.description.readOnly = busy;
    els.storyboard.readOnly = busy;
  }

  function setStatus(status, message) {
    const safe = [
      "idle",
      "generating",
      "queued",
      "running",
      "completed",
      "failed",
    ].includes(status)
      ? status
      : "idle";
    els.statusPill.className = `pill pill-${safe}`;
    setText(els.statusPill, safe);
    setText(els.statusMessage, message);
  }

  function hideError() {
    els.errorBox.hidden = true;
    setText(els.errorMessage, "");
    setText(els.errorDetails, "");
    els.errorDetails.hidden = true;
  }

  function showError(title, message, details) {
    setText(els.errorTitle, title);
    setText(els.errorMessage, message);
    if (details) {
      setText(els.errorDetails, details);
      els.errorDetails.hidden = false;
    } else {
      setText(els.errorDetails, "");
      els.errorDetails.hidden = true;
    }
    els.errorBox.hidden = false;
  }

  function hideResult() {
    els.metaSection.hidden = true;
    els.metaList.replaceChildren();
    els.downloadBtn.hidden = true;
    els.downloadBtn.removeAttribute("href");
    setText(els.jobId, "");
    els.jobId.hidden = true;
  }

  function showJobId(jobId) {
    setText(els.jobId, `Job ${jobId}`);
    els.jobId.hidden = false;
  }

  function extractStoryboard(parsed) {
    if (parsed && Array.isArray(parsed.scenes)) return parsed;
    if (
      parsed &&
      parsed.storyboard &&
      typeof parsed.storyboard === "object" &&
      Array.isArray(parsed.storyboard.scenes)
    ) {
      return parsed.storyboard;
    }
    return parsed;
  }

  function formatDuration(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return `${value.toFixed(1)}s`;
  }

  function formatFps(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return String(value);
  }

  function formatResolution(width, height) {
    if (
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return "—";
    }
    return `${width}×${height}`;
  }

  function showMetadata(job) {
    const items = [
      ["Duration", formatDuration(job.duration)],
      ["FPS", formatFps(job.fps)],
      ["Resolution", formatResolution(job.width, job.height)],
      ["Frames", job.frames == null ? "—" : String(job.frames)],
      ["Format", job.format ? String(job.format) : "—"],
    ];

    els.metaList.replaceChildren();
    for (const [label, value] of items) {
      const wrap = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      setText(dt, label);
      setText(dd, value);
      wrap.append(dt, dd);
      els.metaList.append(wrap);
    }
    els.metaSection.hidden = false;
  }

  function showDownload(jobId) {
    if (!JOB_ID_RE.test(jobId)) {
      showError(
        "Download unavailable",
        "The server returned an invalid job id.",
      );
      return;
    }
    els.downloadBtn.href = `/api/videos/${encodeURIComponent(jobId)}/download`;
    els.downloadBtn.hidden = false;
  }

  async function readApiError(response) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status}).`;
    const details = Array.isArray(payload?.details)
      ? payload.details
          .filter((line) => typeof line === "string")
          .join("\n")
      : "";
    return { message, details };
  }

  function messageForJob(job) {
    if (typeof job.stageMessage === "string" && job.stageMessage.trim()) {
      return job.stageMessage;
    }
    if (job.stage === "generating_voiceover") return "Creating voiceover...";
    if (job.stage === "rendering") return "Rendering video...";
    if (job.status === "queued") return "Building scenes...";
    if (job.status === "running") return "Rendering video...";
    if (job.status === "completed") return "Your video is ready";
    return "Working…";
  }

  function beginPolling(job) {
    const jobId = job?.jobId;
    if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) {
      setBusy(false);
      setStatus("failed", "Storyboard generation failed");
      showError("Invalid response", "The server did not return a valid job id.");
      return;
    }

    showJobId(jobId);
    setStatus(
      job.status === "running" ? "running" : "queued",
      messageForJob(job),
    );
    pollDeadline = Date.now() + POLL_TIMEOUT_MS;
    void pollJob(jobId);
  }

  async function pollJob(jobId) {
    if (Date.now() > pollDeadline) {
      setBusy(false);
      setStatus("failed", "Video rendering failed");
      showError(
        "Timed out",
        "The job did not finish in time. Check the server logs and try again.",
      );
      return;
    }

    let response;
    try {
      response = await fetch(`/api/videos/${encodeURIComponent(jobId)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } catch {
      pollTimer = window.setTimeout(() => {
        void pollJob(jobId);
      }, POLL_MS);
      setStatus("running", "Waiting for the server…");
      return;
    }

    if (!response.ok) {
      const err = await readApiError(response);
      setBusy(false);
      setStatus("failed", "Video rendering failed");
      showError("Status request failed", err.message, err.details);
      return;
    }

    const job = await response.json();
    const status = typeof job.status === "string" ? job.status : "unknown";

    if (status === "queued") {
      setStatus("queued", messageForJob(job));
      pollTimer = window.setTimeout(() => {
        void pollJob(jobId);
      }, POLL_MS);
      return;
    }

    if (status === "running") {
      setStatus("running", messageForJob(job));
      pollTimer = window.setTimeout(() => {
        void pollJob(jobId);
      }, POLL_MS);
      return;
    }

    if (status === "completed") {
      setBusy(false);
      setStatus("completed", "Your video is ready");
      showMetadata(job);
      showDownload(jobId);
      return;
    }

    if (status === "failed") {
      setBusy(false);
      setStatus("failed", "Video rendering failed");
      showError(
        "Video rendering failed",
        typeof job.error === "string" && job.error
          ? job.error
          : "The render job failed.",
      );
      return;
    }

    setBusy(false);
    setStatus("failed", "Video rendering failed");
    showError("Unexpected status", `The server reported status: ${status}`);
  }

  async function createFromDescription(productDescription) {
    const response = await fetch("/api/videos/generate", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ productDescription }),
    });

    if (response.status === 202) {
      return { ok: true, job: await response.json() };
    }

    const err = await readApiError(response);
    return {
      ok: false,
      title: "Storyboard generation failed",
      message: err.message,
      details: err.details,
    };
  }

  async function createFromStoryboard(storyboard) {
    const response = await fetch("/api/videos", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ storyboard }),
    });

    if (response.status === 202) {
      return { ok: true, job: await response.json() };
    }

    const err = await readApiError(response);
    const title =
      response.status === 400
        ? "Invalid storyboard"
        : response.status >= 500
          ? "Server error"
          : "Request failed";
    return { ok: false, title, message: err.message, details: err.details };
  }

  els.generateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    hideError();
    hideResult();
    stopPolling();

    const productDescription = els.description.value.trim();
    if (!productDescription) {
      setStatus("idle", "Add a product description and try again.");
      showError(
        "Product description required",
        "Enter a product description before generating a video.",
      );
      return;
    }

    setBusy(true);
    setStatus("generating", "Generating storyboard...");

    void createFromDescription(productDescription).then((result) => {
      if (!result.ok) {
        setBusy(false);
        setStatus("failed", "Storyboard generation failed");
        showError(result.title, result.message, result.details);
        return;
      }
      beginPolling(result.job);
    });
  });

  els.storyboardForm.addEventListener("submit", (event) => {
    event.preventDefault();
    hideError();
    hideResult();
    stopPolling();

    let parsed;
    try {
      parsed = JSON.parse(els.storyboard.value);
    } catch {
      setStatus("idle", "Fix the storyboard JSON and try again.");
      showError(
        "Invalid JSON",
        "The textarea is not valid JSON. The API was not called.",
      );
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setStatus("idle", "Fix the storyboard JSON and try again.");
      showError("Invalid storyboard", "Storyboard JSON must be an object.");
      return;
    }

    const storyboard = extractStoryboard(parsed);
    setBusy(true);
    setStatus("queued", "Building scenes...");

    void createFromStoryboard(storyboard).then((result) => {
      if (!result.ok) {
        setBusy(false);
        setStatus("idle", "Submission rejected.");
        showError(result.title, result.message, result.details);
        return;
      }
      beginPolling(result.job);
    });
  });

  void fetch("/health", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((health) => {
      if (!els.voiceoverStatus) return;
      if (!health || !health.tts) {
        setText(els.voiceoverStatus, "Voiceover: unknown");
        return;
      }
      if (health.tts.configured) {
        setText(els.voiceoverStatus, "Voiceover: On (local Piper)");
        return;
      }
      setText(
        els.voiceoverStatus,
        "Voiceover: Off — install a Piper model (see docs/tts.md) or jobs with voiceover.enabled will fail.",
      );
    })
    .catch(() => {
      if (els.voiceoverStatus) {
        setText(els.voiceoverStatus, "Voiceover: unknown");
      }
    });
})();
