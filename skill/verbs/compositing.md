# Compositing — layouts, overlap, multi-frame

Load when changing **how stage + cam + overlays** appear in the final video.

## Today

```bash
reactable takes edit get|set <id>
reactable takes render <id> [--aspect 16:9,9:16]
reactable open editor
reactable takes hf init <id>    # overlay lane
```

Edit **`edit.json`**: cam PIP position, click zoom, padding, aspects. See [compositing-layouts.md](../references/compositing-layouts.md).

## Phase 6 (planned)

```bash
reactable composite presets list
reactable composite apply <id> --preset pip-br|full-stage|split-h-50|shorts-vertical
reactable edit layout set <id> --preset <name> [--at <sec>]
reactable composite cursor <id> --style dot|ring|keycap
```

**Layout environment** — timed preset handoffs, overlapping HF layers, multi-aspect from one edit graph.

**Skills:** hyperframes (motion overlays), gsap (transitions between layout beats).
