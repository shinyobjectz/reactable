# Compositing layouts — preset catalog

Agents compose takes by writing **`edit.json`** (ffmpeg lane) and/or **HyperFrames** layers (rich lane). Layouts can **stack, overlap, and hand off** between presets over a timeline.

## Today (`edit.json` + composite.py)

Current schema (partial):

```json
{
  "trim": { "in": 0, "out": null },
  "speed": 1,
  "zoom": { "enabled": true, "scale": 1.5, "duration": 1.0 },
  "cam": { "pip": true, "x": 0.88, "y": 0.08, "size": 0.14, "mirror": true },
  "style": { "padding": 28, "radius": 16, "background": "#111111" },
  "aspect": "16:9",
  "captions": { "enabled": true }
}
```

Editor preview: `/editor` — PIP position mirrors `cam.x/y/size`.

## Planned layout presets (Phase 6)

| Preset | Stage | Cam | Use case |
|--------|-------|-----|----------|
| `pip-br` | full | circle BR (default) | screencast + face |
| `pip-bl` / `pip-tr` / `pip-tl` | full | circle corner | brand-safe face placement |
| `full-stage` | full bleed | hidden | demo-only, no webcam |
| `full-panel` | padded card | hidden | keynote slide feel |
| `split-h-50` | left 50% | right 50% | interview, reaction |
| `split-h-70-30` | 70% | 30% | talk + small face |
| `cam-hero` | inset TR | large BL | personality-first |
| `stack-overlap` | base | HF overlay | motion graphics on top |
| `shorts-vertical` | crop center | PIP top | 9:16 export template |

Planned CLI:

```bash
reactable composite presets list
reactable composite apply <take-id> --preset pip-br
reactable edit layout set <take-id> --preset split-h-50 [--at 12.4]   # timed handoff
```

## Multi-layout timelines

`edit.json` will gain a **`layouts`** array — ordered segments with `at` (seconds) and `preset`:

```json
{
  "layouts": [
    { "at": 0, "preset": "full-stage" },
    { "at": 8.5, "preset": "pip-br", "cam": { "size": 0.18 } },
    { "at": 42, "preset": "split-h-50" }
  ]
}
```

HyperFrames lane: same markers from `reactable-events.json` — one preset per slide or per `layout` event.

## Cursor replication

`events.jsonl` already records `cursor` and `click`. Phase 6 adds:

- **Synthetic cursor layer** in composite/HF when no cursor was captured (agent-driven replay)
- **Cursor style** presets: dot, ring, keycap, none
- **Replication mode**: replay logged cursor exactly vs smooth bezier vs DOM-anchored

Planned:

```bash
reactable composite cursor <take-id> --style ring --smooth
```

## Overlap rules

When combining ffmpeg + HF:

1. **Base** — stage.mov (+ optional cam PIP from preset)
2. **HF overlay** — transparent WebM/PNG sequence or HF render pass
3. **Captions** — word VTT or slide SRT on top

Agent rule: set `edit.json` layout first, then `takes hf init` so markers align.
