# Local Piper TTS (₹0)

This project synthesizes narration with **Piper**, a local offline TTS engine. No cloud TTS, no paid APIs, no model auto-download.

## What you need

1. Piper on `PATH` (or `PIPER_BIN` pointing at the executable)
2. A Piper voice `.onnx` file **and** its sibling `.onnx.json` config
3. `TTS_ENABLED=true` (default)

The app never downloads voice models. If the executable or model is missing and the storyboard has `voiceover.enabled: true` with no manual `audio/voice/narration.wav|mp3`, the job **fails** with a setup message. It does not silently render without speech.

## Windows (this repo's tested path)

Piper was already available as a Python console script:

```powershell
pip install piper-tts
piper --help
```

Download a US English voice (example: Lessac medium, ~63 MB) into the project **once**:

```powershell
mkdir models\piper
curl.exe -L "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx" -o models\piper\en_US-lessac-medium.onnx
curl.exe -L "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" -o models\piper\en_US-lessac-medium.onnx.json
```

Do not commit the `.onnx` files.

## macOS / Linux

```bash
# Homebrew (if packaged) or a Piper release binary from
# https://github.com/rhasspy/piper/releases
export PIPER_BIN=piper
export PIPER_MODEL=models/piper/en_US-lessac-medium.onnx
```

Place the same `.onnx` + `.onnx.json` under `models/piper/`.

## Environment

Copy from `.env.example`:

| Variable | Default | Meaning |
|---|---|---|
| `TTS_ENABLED` | `true` | Set `false` to refuse TTS (manual narration still works) |
| `TTS_ENGINE` | `piper` | Only `piper` is supported |
| `TTS_SPEED` | unset | Speaking rate multiplier (`1` = natural; higher is faster) |
| `PIPER_BIN` | `piper` | Executable name or path |
| `PIPER_MODEL` | `models/piper/en_US-lessac-medium.onnx` | Voice model path |
| `PIPER_CONFIG` | `<model>.json` if present | Optional explicit config path |

## How automatic voiceover works

1. Storyboard sets `audio.voiceover.enabled: true` and per-scene `voiceover.script`
2. Scene scripts should complement the picture, not read the on-screen text
3. If `audio/voice/narration.wav` or `.mp3` exists, that file is used and TTS is skipped
4. Otherwise Piper writes clips to `build/audio/voice/scene-N.wav`
5. Populate places each clip at the scene start (30 FPS, 12-frame overlaps)
6. HyperFrames mixes **voice + ducked BGM + SFX** into AAC

Disable narration with `"audio": { "voiceover": { "enabled": false } }` (and no scene `voiceover.enabled: true`).

## CLI

```bash
npm run generate:voiceover
npm run populate
VIDEO_QUALITY=draft npm run render:video
```

## Troubleshooting

- **Local TTS is not configured** — Piper binary or `PIPER_MODEL` missing
- **Empty script** — `enabled: true` with a blank `script`
- **Piper TTS failed** — model/config mismatch; both `.onnx` and `.onnx.json` must exist
- **Still no speech in the MP4** — confirm `build/index.html` contains `id="audio-voice-…"` and that HyperFrames reported `audioCount` > BGM/SFX only
