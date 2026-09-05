# Storyboard Generation



## Architecture



```

Product description

        ↓

LLM_PROVIDER = ollama | mistral

        ↓

Ollama (local /api/chat)  or  Mistral (MISTRAL_API_KEY)

        ↓

storyboard JSON only

        ↓

AJV validation

        ↓

local Piper voiceover (if enabled)

        ↓

populate → HyperFrames 0.8.22 → FFmpeg → MP4

```



See `docs/tts.md` for Piper setup. The LLM never emits audio files.



The LLM generates **only** structured storyboard data. It never generates HTML, CSS, JavaScript, GSAP, or HyperFrames composition files. Scene templates under `compositions/scenes/` stay independent of the model.



Director instructions in `prompts/storyboard-director.md` ask for a launch story (hook → friction → proof → ecosystem → CTA), not a feature list. Optional scene `role` values: `hook`, `friction`, `problem`, `reveal`, `proof`, `ecosystem`, `benefit`, `cta`, `close`. Older boards without `role` still validate and render.



## Provider selection



| `LLM_PROVIDER` | Backend |

|---|---|

| `ollama` | Local Ollama HTTP API (`POST {OLLAMA_BASE_URL}/api/chat`) |

| `mistral` or unset | Existing Mistral client (`MISTRAL_API_KEY`) |



The server does **not** fall back from Ollama to Mistral (or the reverse) on failure.



## Runtime (Ollama)



Requires Ollama running locally with the model pulled:



```bash

ollama pull qwen2.5-coder:3b

```



```

LLM_PROVIDER=ollama

OLLAMA_BASE_URL=http://127.0.0.1:11434

OLLAMA_MODEL=qwen2.5-coder:3b

```



```bash

POST /api/videos/generate

{ "productDescription": "..." }

```



The app calls Ollama directly. OpenCode and Cursor are not used as APIs.

Ollama uses a compact director prompt (`prompts/storyboard-director-ollama.md`) and `format: "json"`. Defaults for Qwen 2.5 Coder 3B: temperature `0.1`, `num_predict` `1400`, `num_ctx` `4096`, timeout `120000` ms. After AJV, the Ollama path also enforces director constraints (spoken VO length, no on-screen/VO duplication, no invented platforms/stats). Override with `OLLAMA_TEMPERATURE`, `OLLAMA_NUM_PREDICT`, `OLLAMA_NUM_CTX`, `OLLAMA_TIMEOUT_MS`. Mistral still uses `prompts/storyboard-director.md` and the shared AJV schema only. The AJV schema is unchanged.



## Runtime (Mistral)



Set `MISTRAL_API_KEY` on the server (see `.env.example`). Default model: `mistral-small-latest` (`MISTRAL_MODEL` to override). Set `LLM_PROVIDER=mistral` or omit `LLM_PROVIDER`.



Mistral is used on La Plateforme free / experiment access. Rate limits apply. This app does not enable paid providers or billing.



The API key never goes to the browser.



## Development-time (Cursor / Grok)



Cursor's selected model can still be used **interactively** to draft JSON and edit `prompts/storyboard-director.md`. This repository does **not** call Cursor.



Direct storyboard submission remains:



```bash

POST /api/videos

{ "storyboard": { "scenes": [...] } }

```



or:



```bash

npm run apply:storyboard -- path/to/candidate.json

```



## Contract sources of truth



| Concern | Source |

|---|---|

| Scene props / durations / counts | `schemas/storyboard.schema.json` |

| Start/end scene rules | `scripts/lib/storyboard.mjs` |

| Director instructions | `prompts/storyboard-director.md` |

| Provider selection | `server/lib/storyboard-generation.mjs` |

| Example input | `examples/product-description.txt` |

| Example shape (not generation logic) | `examples/storyboard.example.json` |



## What not to do



- Do not add Anthropic, OpenAI, xAI, or Cursor/OpenCode model HTTP APIs.

- Do not put `MISTRAL_API_KEY` in `web/` or git-tracked secrets.

- Do not ask the model to emit HTML or HyperFrames files.

- Do not silently switch LLM providers after an error.

