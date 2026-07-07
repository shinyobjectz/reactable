# Kokoro TTS — agent voiceover

Local text-to-speech via **Rust MLX** (`voice-tts` + `voice-g2p` in `reactable-tools`).

```bash
reactable tools build          # compile reactable-tools with MLX
reactable tools doctor         # mlx-stt + mlx-tts + ffmpeg
reactable tts doctor
reactable tts speak --text "Welcome to Reactable." -o takes/voiceover.wav
reactable tts speak --text "Hook for the short." -o shorts/hook.wav --voice af_sarah
```

Built-in voices: `af_heart`, `af_bella`, `af_sarah`, `af_sky`, `am_michael`, `am_adam`, `bf_emma`.

Models download to `~/.cache/huggingface/hub/` on first run (`prince-canuma/Kokoro-82M`).

Requires **Apple Silicon macOS** with Xcode Metal toolchain:

```bash
xcodebuild -downloadComponent MetalToolchain
```

No Python at runtime.

## Agent synthetic video

Pair with [agent-synthetic.md](agent-synthetic.md):

1. `tts speak` → WAV
2. `stage open` + deck (no webcam required)
3. `takes render` or HF post
4. `shorts cut` (planned) for YouTube vertical exports

## Shorts cutdown (planned)

Re-voice b-roll, trim to 45–60s using transcript + slide markers + Kokoro hook.
