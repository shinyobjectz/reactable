# Agent synthetic video — no webcam required

An agent can produce a full video **without the user's face or mic** by combining:

| Layer | Source |
|-------|--------|
| Stage | `reactable stage open` + deck / iframe / labs |
| Voice | Kokoro TTS (`reactable tts speak`) |
| Cursor | synthetic from script or replicated from plan |
| Cam | optional isolate/bg-removed asset or omitted |
| Motion | HyperFrames + layout presets |

## Workflow (planned)

```bash
reactable decks new "Agent demo"
# … author deck.work, labs, scripts …

reactable stage open --deck my-demo
reactable tts speak --text "Welcome to Reactable." --out takes/voiceover.wav
reactable synth take --deck my-demo --voice takes/voiceover.wav --layout full-stage
reactable takes render <id>
reactable shorts cut <id> --aspect 9:16 --duration 60
```

**Synth take** — headless or scripted stage navigation driven by CLI/agent (slide timings from TTS word boundaries or explicit `script do` waits).

## YouTube shorts cutdown

```bash
reactable youtube search "topic" --json
reactable shorts plan <url> --target 45s        # agent outline
reactable shorts cut <take-id> --aspect 9:16
```

Uses transcript + slide markers + optional Kokoro re-voice for b-roll narration.

## Related verbs

- [compositing.md](compositing.md) — layout presets
- [camera-dom.md](camera-dom.md) — DOM-targeted motion without manual cursor
- [kokoro-tts.md](kokoro-tts.md) — voice layer
- [post-hyperframes.md](post-hyperframes.md) — rich overlays
