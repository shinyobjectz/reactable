# Takes → HyperFrames

A **take** is a recorded session folder:

```
takes/take-<id>/
  manifest.json    # deck, source_kind, tracks, resolution
  stage.mov        # stage/window capture
  cam.mov          # webcam
  events.jsonl     # unified clock: slide, click, cursor, record.*
  edit.json        # ffmpeg composite prefs (optional)
  out/             # composite.py outputs
  hyperframes/     # agent HF lane (after hf init)
```

## events.jsonl

One JSON object per line. Key types:

| type | meaning |
|------|---------|
| `record.start` | capture began |
| `record.stop` | capture ended |
| `slide` | `{ idx, id }` — deck navigation |
| `click` | `{ x, y, button }` |
| `cursor` | `{ x, y }` |

Use `reactable takes events <id> --json` for summaries.

## Lane A — ffmpeg composite

`scripts/composite.py` reads tracks + events + `edit.json`:

- click-triggered zoom (`zoompan`)
- cam PIP
- captions from events
- exports 16:9, 9:16, 1:1, GIF

```bash
reactable takes render <id>
# or
python3 scripts/composite.py takes/<id>
```

## Lane B — HyperFrames

For agent-authored overlays, kinetic type, scene transitions:

```bash
reactable takes hf init <id>
```

Creates:

- `hyperframes/media/` — symlinks to take tracks
- `hyperframes/reactable-events.json` — slide markers + full events
- `hyperframes/compositions/take-edit.html` — starter composition
- `hyperframes/index.html` — player shell

Edit `compositions/take-edit.html` using the **hyperframes** skill (`data-start`, GSAP timeline).

```bash
cd takes/<id>/hyperframes
npx hyperframes lint
npx hyperframes preview
reactable takes hf render <id>
```

Output: `takes/<id>/out/hyperframes-final.mp4`

## edit.json (ffmpeg lane)

```json
{
  "trim": { "in": 0.2, "out": 5.8 },
  "speed": 1,
  "zoom": { "enabled": true, "scale": 1.55 },
  "cam": { "pip": true, "x": 0.88, "y": 0.08, "size": 0.14 },
  "captions": { "enabled": true }
}
```

```bash
reactable takes edit get <id>
reactable takes edit set <id> --file my-edit.json
```

## Pipeline to monorepo video

```bash
bash scripts/to-video.sh <take-id> reactable-demo
# → videos/reactable-demo/video.work + out/final.mp4
```
