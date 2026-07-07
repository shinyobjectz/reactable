# Speech edit — transcribe, filler removal, captions

```bash
reactable tools build
reactable takes transcribe <id> [--model UsefulSensors/moonshine-tiny]
reactable edit remove-filler <id> [--aggressive]
reactable edit trim-silence <id>
reactable edit captions <id>
```

Requires **reactable-tools** sidecar with Rust MLX on Apple Silicon (`voice-stt`).

Models: `UsefulSensors/moonshine-tiny` (default), `UsefulSensors/moonshine-base`.

Outputs: `takes/<id>/transcript.json`, `filler-cuts.json`, `out/captions.vtt`

Word-level captions merge into `takes render` when `transcript.json` exists.

No Python at runtime.
