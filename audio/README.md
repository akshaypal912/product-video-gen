# Audio

Local, free audio for the Product Launch pipeline. No paid TTS or music APIs.

```
audio/music/bed.wav     background pad (FFmpeg lavfi)
audio/sfx/whoosh.wav    logo entrance
audio/sfx/sweep.wav     headline entrance
audio/sfx/impact.wav    statistic hit
audio/sfx/tick.wav      count-up ticks
audio/sfx/connect.wav   integration connect
audio/sfx/rise.wav      CTA
audio/voice/            optional manual narration
build/audio/voice/      Piper-generated clips (gitignored)
```

Regenerate beds and SFX:

```bash
npm run generate:audio
```

Generate local voiceover (requires Piper + a voice model — see `docs/tts.md`):

```bash
npm run generate:voiceover
```

## Mix

```
Voice  +  ducked BGM  +  SFX  →  HyperFrames AAC
```

Populate attaches timed `<audio>` clips. When narration exists, the music bed volume is lowered and a volume automation lane ducks further during spoken clips. SFX stay on a separate `sfx` group.

## Voiceover priority

1. `audio/voice/narration.wav` or `narration.mp3` if present
2. Piper clips in `build/audio/voice/` when `voiceover.enabled` is true
3. No narration when voiceover is disabled
