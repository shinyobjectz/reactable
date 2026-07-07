# Showcase deck

Walk through **every slide media format** Reactable supports on the stage.

## Open it

```bash
just reactable serve          # if nexus not running
just reactable dev            # native app + stage
just reactable stage --deck showcase
# or from the menu-bar app: Stage → set deck slug to "showcase"
```

## Slides

| Slide | `type` | What you see |
|-------|--------|--------------|
| start | markdown | Table of contents |
| format-markdown | markdown | Prose, lists, code blocks |
| format-html | html | Inline HTML/CSS/animation |
| format-iframe-local | iframe | Chart app from `labs/chart.html` |
| format-iframe-remote | iframe | tldraw.com (network) |
| format-video | video | Local `labs/sample.mp4` (run `scripts/gen-lab-samples.sh` if missing) |
| format-youtube | youtube | YouTube embed |
| format-whiteboard | iframe | Drawing canvas |
| end | markdown | Recap |

## Files

- `deck.work` — slide definitions (source of truth for agents)
- `labs/chart.html` — local iframe demo for this deck

Local labs are served at `/reactable/labs/<file>?deck=showcase`.
