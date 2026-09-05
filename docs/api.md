# Product Launch Video API

Minimal development HTTP API around the existing render pipeline.

## Start the server

```bash
npm run server
```

The server loads a gitignored `.env` file if present (`LLM_PROVIDER`, Ollama URL/model, `MISTRAL_API_KEY`, optional `MISTRAL_MODEL`, Piper TTS paths). Copy `.env.example` to `.env`. Do not put secrets in `web/` or committed source.

You can still override in the shell:

```bash
# Windows PowerShell
$env:MISTRAL_API_KEY="your-key"
npm run server
```

Optional:

```bash
PORT=8787 npm run server
```

Default bind: `http://127.0.0.1:8787`

Open the UI at `http://127.0.0.1:8787/`. The same process serves an allowlisted vanilla frontend (`web/index.html`, `web/app.js`, `web/styles.css`) so CORS is not required.

The UI posts a product description to `POST /api/videos/generate`. The configured LLM (Ollama or Mistral) produces storyboard JSON on the server; the existing job poller then tracks `GET /api/videos/:jobId` and downloads from `GET /api/videos/:jobId/download`. API keys never leave the server.

Direct storyboard JSON remains available at `POST /api/videos` (developer panel in the UI).

## Endpoints

### `GET /health`

Liveness check. Reports `llm` (`mistral` or `ollama`), `llmConfigured`, and `tts: { engine, enabled, configured }` without exposing keys or filesystem paths.

### `POST /api/videos`

Create a render job from a **storyboard object**.

```bash
curl -s -X POST http://127.0.0.1:8787/api/videos \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "storyboard": {
    "scenes": [
      {
        "type": "logo-intro",
        "duration": 45,
        "props": { "productName": "Tables" }
      },
      {
        "type": "text-reveal",
        "duration": 90,
        "props": { "lines": ["Build faster.", "Reach more customers."] }
      },
      {
        "type": "stat-callout",
        "duration": 60,
        "props": { "value": "297", "suffix": "M+", "label": "profiles" }
      },
      {
        "type": "cta-outro",
        "duration": 60,
        "props": { "headline": "Try it today", "sub": "Get started" }
      }
    ]
  }
}
EOF
```

Successful response: **202**

```json
{
  "jobId": "…",
  "status": "queued",
  "error": null,
  "createdAt": 0,
  "startedAt": null,
  "finishedAt": null
}
```

Invalid storyboard: **400** (existing `storyboard.json` is not modified).

This endpoint does **not** call an LLM. Product descriptions belong on `POST /api/videos/generate`.

### `POST /api/videos/generate`

Create a render job from a **product description**. The server selects a provider from `LLM_PROVIDER`:

- `ollama` — local `POST http://127.0.0.1:11434/api/chat` (default model `qwen2.5-coder:3b`)
- `mistral` or unset — existing Mistral client (`mistral-small-latest`, override with `MISTRAL_MODEL`)

There is no silent fallback between providers. After JSON is returned, `scripts/lib/storyboard.mjs` validates it and the same render job as `POST /api/videos` is enqueued.

```
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:3b
# OLLAMA_TEMPERATURE=0.1
# OLLAMA_NUM_PREDICT=1400
# OLLAMA_NUM_CTX=4096
# OLLAMA_TIMEOUT_MS=120000
```

```
LLM_PROVIDER=mistral
MISTRAL_API_KEY=
```

```bash
curl -s -X POST http://127.0.0.1:8787/api/videos/generate \
  -H "Content-Type: application/json" \
  -d "{\"productDescription\":\"Tables is a CRM backed by 297M+ profiles, integrates with LinkedIn and HubSpot, and helps teams manage customer data.\"}"
```

Successful response: **202**

```json
{
  "jobId": "…",
  "status": "queued"
}
```

Missing API key (Mistral): **503** (no render, `storyboard.json` unchanged).

Ollama not running or model missing: **503**.

Invalid or empty description: **400**.

Unknown `LLM_PROVIDER`: **400**.

Rate limit (Mistral): **429** — `Storyboard generation is temporarily rate-limited. Please try again later.`

Malformed model JSON or schema mismatch: **502** / **422** — no render.

Mistral is used in La Plateforme **free / experiment** mode. Quota and rate limits apply. This app does not enable paid usage, billing APIs, or pay-as-you-go.

### `GET /api/videos/:jobId`

Poll job status.

Completed example:

```json
{
  "jobId": "…",
  "status": "completed",
  "duration": 11.5,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "format": "mp4",
  "frames": 345,
  "downloadPath": "/api/videos/…/download"
}
```

### `GET /api/videos/:jobId/download`

Downloads the completed MP4 artifact for that job (development only). Restricted to generated artifacts under `build/artifacts/`.

## Job lifecycle

`queued` → `running` → `completed` | `failed`

## Concurrency

Renders are **serialized**. Only one job runs at a time because the pipeline writes shared files:

- `storyboard.json`
- `build/index.html`
- `build/hyperframes-render.mp4`
- `build/product-launch.mp4`

Additional jobs remain `queued` (in-memory FIFO) until the active job finishes. Completed jobs keep a copied artifact at `build/artifacts/<jobId>.mp4`.

## In-memory limitation

Jobs live only in process memory. Restarting the server clears the queue and job status. This is development-only. A future Redis / BullMQ worker will replace the in-memory queue.

## Cursor / Grok

Cursor's selected model (for example Grok 4.5) is still useful **interactively** to edit prompts and inspect sample JSON. This server does **not** call Cursor.

Runtime storyboard generation uses **Ollama** (`LLM_PROVIDER=ollama`) or **Mistral** (`MISTRAL_API_KEY`, never sent to the browser). The director contract is `prompts/storyboard-director.md`. After JSON is returned, `scripts/lib/storyboard.mjs` is the authoritative validator. Rendering is still HyperFrames 0.8.22 + FFmpeg.

## Security notes

- HTTP bodies are untrusted and size-limited
- `MISTRAL_API_KEY` is read from the server environment only
- Storyboard input is AJV-validated before any write/render
- No shell interpolation of user/storyboard/product text
- Clients cannot choose filesystem output paths
- Download paths accept only UUID job ids
