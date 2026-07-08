# takes-post — post-production on takes, HyperFrames rewritten native

Replaces vendored hyperframes / hyperframes-cli / hyperframes-media /
remotion-to-hyperframes as REACTABLE skills. The pipeline is ours: a take
folder (stage.mov + cam.mov + mic-clean.wav + events.jsonl sync anchors) in,
a shipped video out. Two lanes.

## Lane 1 — fast: the built-in compositor

```
reactable edit clean-voice <id>        # DeepFilterNet voice
reactable edit remove-filler <id>      # cut "um", dead air
reactable edit captions <id>           # srt from the transcript
reactable takes render <id> [--aspect 16:9,9:16]
```

Render composites on the STAGE CLOCK: auto-zoom from recorded click/zoom
events, synthetic cursor from the recorded track, squircle cam PIP, system
audio + cleaned mic mixed. Every timestamp in events.jsonl is take-clock;
stage.mov starts at the capture.stage anchor — the pipeline shifts for you.

## Lane 2 — rich: HyperFrames timelines

```
reactable takes hf init <id>     # sync-aware scaffold: audio, captions,
                                 # word timings, per-track offsets
reactable takes hf render <id>
```

The scaffold is an HTML composition: `data-*` timing attributes, a GSAP
timeline, CSS appearance (HTML is the source of truth for video). Edit the
generated comp in takes/<id>/hyperframes/:
- **Clips** map to stage segments; keep their `data-start` on the stage clock.
- **Captions** ride the word timings the scaffold injected — style, don't
  re-time.
- **Overlays/title cards** are HTML: use [[island-design]] taste and
  [[slide-motion]] rules (they get encoded too).
- **Audio-reactive** moves (pulse/glow on beat) and **transitions**
  (crossfade, wipe, shader): see the vendored deep refs below for the
  attribute vocabulary.

## Media preprocessing

TTS voiceover: `reactable tts speak --text "…" -o assets/vo.wav` (local
Kokoro) or connector elevenlabs for premium voices → assets/. Transcription:
`reactable takes transcribe <id>`. Background removal and asset prep: prefer
doing it BEFORE the take (assets/ is what the stage serves).

## From Remotion

Remotion comps port by mapping <Sequence from/durationInFrames> →
`data-start/data-duration` (seconds, not frames), useCurrentFrame() easing →
GSAP tweens, and Audio/Video elements → the scaffold's media tracks. Port the
DESIGN, adopt OUR timing — the scaffold's sync anchors are already correct.

## Rules

1. Never hand-compute offsets — `takes hf init` and `takes render` read the
   anchors; trust them.
2. Preview lane-2 comps in the HF dev loop, but the ACCEPTANCE check is the
   rendered file, watched.
3. 9:16 is a first-class render target, not a crop afterthought — check cam
   PIP and text safe-areas per aspect.

Deep refs (dev tree): skill/vendored/hyperframes/SKILL.md (composition
vocabulary), hyperframes-media/ (tts/transcribe/rembg commands),
hyperframes-registry/ (component lookups), vercel-react-best-practices/
(if a comp goes React-heavy).
