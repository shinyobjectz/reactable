# video — footage intelligence (timecodes, objects, layout)

Perception of video files themselves — distinct from `intel …` (market
research). Every take and imported clip gets an `<asset>.intel/` sidecar
(schema `footage-intel/1`, spec: docs/PLAN.footage-intel.work) built
automatically on record-stop and asset import. Query it instead of guessing
what's in footage.

## Verbs

```
reactable video index <take-id|path> [--tier t0|t1]   (re)build the sidecar
reactable video find "<query>" --in <ref> --json      text → timecode hits
reactable video at <ref> <ms|mm:ss> --json            everything known at that moment
reactable video tracks <ref> [--concept "…"] --json   object tracklets (GPU pass output)
reactable video pass <ref> <sam31|depth|matte> [--concept "…"]   queue a GPU pass
reactable video sweep --json                          index anything un-indexed
```

`<ref>` is a take id (`take-…`, resolves to its stage.mov) or a media path
relative to the project.

## When to reach for what

- "When does X appear / happen?" → `video find "X" --in <ref> --json`.
  Hits cite their source layer: `transcript` (spoken), `ocr` (text on
  screen), `caption` (visual description, t1), `track/…` (tracked object).
  Every hit carries `t_ms` + SMPTE `tc`.
- "What's on screen at 1:23?" → `video at <ref> 1:23 --json` — shot,
  spoken segment, OCR text, tracklets, and (for takes) the authored events
  (slide/scene switches, cursor, clicks) around that moment.
- Editing decisions on a take (punch-in, trims, chapters) → prefer the
  `events` in `video at` output over inference: they are ground truth from
  record time.
- "Track every <concept>" / mattes / depth → `video pass` queues it for the
  GPU lane; results land in tracks.jsonl and assets/ when the runner ships.

## Honesty rules (hard)

- Unindexed ref → the error names the fixing verb; run `video index`, never
  invent a timecode.
- `transcript.timing: "approx"` means word times are interpolated within
  ~20s chunks — say "about" when citing them; shot/OCR/event times are exact.
- A `find` with no hits is "not found in the indexed layers" — name which
  layers were searched (the `searched` field), and whether t1/t2 passes
  would widen coverage.

## Feeding the pipeline

`video find`/`at` answers become edit decisions in takes-post work
([[takes-post]]): event-timed punch-ins, transcript-timed trims (see
`edit trim-silence`, `edit remove-filler`), OCR-timed chapter marks.
