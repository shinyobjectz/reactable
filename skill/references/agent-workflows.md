# Agent workflows

## New talk from scratch

```bash
reactable decks new "Product launch Q3"
reactable plan product-launch-q3
reactable decks slide add product-launch-q3 --id hook --type prose \
  --body "## Hook\n\nOne sentence pitch."
reactable decks script add product-launch-q3 --on deck.open \
  --run "cd labs/site && npm run dev" --detach
just reactable dev &
reactable stage open --deck product-launch-q3
reactable stage status --json
# human: record from bar (same stage window)
reactable takes list
reactable takes hf init take-<latest>
```

## Preview after editing a deck

```bash
reactable decks validate demo
reactable stage load --deck demo    # if app already running
# or
reactable stage open --deck demo    # launch app if needed
```

## Fix slide order after research

```bash
reactable decks get demo --json
reactable decks slide move demo youtube --to 1
reactable decks validate demo
reactable stage open --deck demo
```

## Embed a local lab app in the stage

```bash
# labs live under decks/<slug>/labs/ → /reactable/labs/<file>?deck=<slug>
reactable decks slide add demo --id chart --type iframe \
  --url "/reactable/labs/chart.html?deck=demo"
reactable stage open --deck demo
```

## Replace iframe with live dev server

```bash
reactable decks script add demo --id dev --on deck.open \
  --run "npm run dev -- --port 4321" --cwd labs/site --detach
reactable decks slide add demo --id app --type iframe \
  --url http://localhost:4321 --notes "Live local build"
reactable stage open --deck demo
```

## Post with auto-zoom only (fast)

```bash
reactable takes render take-fixture-validation
open takes/take-fixture-validation/out/final.mp4
```

## Post with HyperFrames titles + transitions

1. `reactable takes hf init <id>`
2. Read `hyperframes/reactable-events.json` for slide times
3. Author scenes in `compositions/take-edit.html`
4. `npx hyperframes lint` in hyperframes dir
5. `reactable takes hf render <id>`

## Headless validation

```bash
just reactable validate
reactable doctor
```
