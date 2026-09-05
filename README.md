# Product Launch Video Generator

HyperFrames composition project. Runtime storyboard LLM is **Mistral** or local **Ollama**. Local voiceover is **Piper TTS** (optional, ₹0).

```
Product description
  → Mistral or Ollama (LLM_PROVIDER)
  → validated storyboard
  → local Piper voiceover (if enabled)
  → HyperFrames + BGM/SFX
  → FFmpeg
  → MP4
```

## Commands

```bash
npm test
npm run validate:storyboard
npm run generate:audio
npm run generate:voiceover
npm run populate
VIDEO_QUALITY=draft npm run render:video
npm run server
```

## Storyboard LLM

Copy `.env.example` to `.env`. For local generation:

```
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:3b
```

Leave `LLM_PROVIDER` unset (or `mistral`) to keep the existing Mistral path (`MISTRAL_API_KEY`). There is no silent fallback between providers.

See [docs/storyboard-generation.md](docs/storyboard-generation.md).

## Voiceover

See [docs/tts.md](docs/tts.md). The pipeline stays usable without TTS: set `voiceover.enabled` to `false`. It will **not** fake speech if TTS is missing and voiceover is on.

## Docs

- [docs/api.md](docs/api.md)
- [docs/storyboard-generation.md](docs/storyboard-generation.md)
- [audio/README.md](audio/README.md)
