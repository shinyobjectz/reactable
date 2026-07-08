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
reactable video pass <ref> <sam31|depth> --concept "…" [--estimate|--run]   GPU pass (Modal L4)
reactable video matte <ref> <track-id> [--apply]      luma matte (+ --apply: RGBA cutout .mov)
reactable video motion <ref> <track-id> [--style punch-in|follow]   keyframed transform plan
reactable video compose <ref> <track-id> [--bg <path|gradient>]   finished render (cutout+bg-swap+fg punch-in)
reactable video autoedit <take-id> [--render]         authored edit from ground-truth events
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
- Auto-edit a recorded take → `video autoedit <take-id> --render`. Reads
  ONLY the take's ground-truth capture events + mic track: punches in toward
  cursor/click activity (mapped to frame via `capture.stage` geometry) and
  trims silence from the mic (deterministic `silencedetect`, no inference).
  Writes `autoedit.json` (punches, keep_segments, chapters from slides) and,
  with `--render`, a proof `autoedit-proof.mp4`. This is the authored
  counterpart to the imported-footage `pass`/`compose` lane.
- "Track every <concept>" → `video pass <ref> sam31 --concept "a,b" --run`
  (always show the user the `--estimate` first — it costs real money).
  Depth/prominence ("is X foreground?") → `video pass <ref> depth --run`,
  then read `depth.zone_series` (fg/mid/bg) on each tracklet.
- Edit assets from tracklets:
  `video matte <ref> <trk> --apply` → `assets/cutout-<trk>.mov` (ProRes 4444
  alpha) for background swaps and insert-behind-subject comps;
  `video motion <ref> <trk>` → `assets/motion-<trk>.json` keyframes
  ({t_ms, cx, cy, zoom}, source_res, ease) for punch-in/follow transforms in
  HyperFrames comps. Cut lists come from the transcript verbs
  (`edit trim-silence`, `edit remove-filler`) — no GPU needed.
- Finished render in one shot:
  `video compose <ref> <trk> --bg <path|gradient>` isolates the tracked
  subject, lays it over a new background, and auto-punches-in during the
  window where the subject is foreground (read from the depth `zone_series`,
  so run the `depth` pass first). This is the "isolate the product, swap the
  background, punch in when it's foreground" endpoint — no manual masks or
  keyframes. Output: `assets/compose-<trk>.mp4`.

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
