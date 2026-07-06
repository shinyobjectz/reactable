# Deck DSL reference

`decks/<slug>/deck.work` is the source of truth — native **Workbooks `.work`** syntax, not JSON fences.

## Header

```work
deck do
  id: my-deck
  title: My Deck
end
```

## Slides (`slide do`)

Each slide is a `slide do … end` block. Optional literate **prose body** follows the block (for `type: prose` or `type: html`).

```work
slide do
  id: intro
  type: prose
  theme: title
  notes: Speaker notes for the recorder.
end

# Talk title

## Subtitle or hook line
```

**Prose themes:** `title` (hero), `section` (chapter divider), `closing` (centered outro), or omit for body layout.


| type      | fields                                            |
| --------- | ------------------------------------------------- |
| `prose`   | `theme`, `notes`, `action` — body after `end`       |
| `html`    | `notes`, `action` — raw HTML body after `end`     |
| `client`  | `unit`, `notes` — HTML in `client :unit do` block |
| `iframe`  | `url`, `title`, `notes`, `action` — **full bleed** by default |
| `video`   | `src`, `notes`, `action` — full bleed |
| `youtube` | `videoId`, `notes`, `action` — full bleed |
| `dev`     | alias for iframe — use for dev-server URLs |

**YouTube:** embedding depends on the uploader — some videos show "unavailable".
Prefer embed-friendly IDs or use `type: video` with an MP4 you host under `labs/`.

**Video MP4:** remote URLs can 403 or block autoplay in WKWebView — controls are
shown; host files at `decks/<slug>/labs/sample.mp4` and reference
`/reactable/labs/sample.mp4?deck=<slug>`.

**Layout:**
`layout: fill` (edge-to-edge in the stage). Use `layout: prose` on `html` slides
for padded content.

```work
slide do
  id: app
  type: iframe
  url: /reactable/labs/counter.html?deck=demo
end
```


**In-slide actions** (reveal.js runtime — no shell):

```work
  action: wait 800
  action: play
  action: fragment 0
```

## Client islands

```work
slide do
  id: pulse
  type: client
  unit: pulse_slide
end

client :pulse_slide do
  <div>…custom HTML…</div>
end
```

## Preload (`preload do`)

URLs to warm in a hidden pool before recording:

```work
preload do
  /reactable/labs/counter.html
  https://tldraw.com
end
```

## Scripts (`script do`)

Shell hooks — executed via `POST /reactable/exec` from stage or native recorder.

```work
script do
  id: dev-server
  on: deck.open
  run: npm run dev
  cwd: labs/my-app
  detach: true
  url: http://localhost:3000
end

script do
  id: on-enter
  on: slide.enter
  slide: demo
  at: 1.5
  run: curl -sf http://localhost:3000/health
  detach: true
end
```

`on` values: `deck.open`, `record.start`, `slide.enter`, `slide.leave`, `timer`.

### Dev server pattern

1. Put app source under `decks/<slug>/labs/` (served at `/reactable/labs/<file>?deck=<slug>`).
2. Add `deck.open` script with `detach: true`.
3. Add `iframe` slide pointing at the lab URL.
4. Optional `slide.enter` script to hit a health endpoint before demo.

### Record-time scripts

`on: record.start` fires from Swift before Aperture capture — use to flip feature flags, start services, or log.

## Stage chrome

The stage window is chromeless — rounded preview frame, drag strip on top, no
Reveal controls. Toggle visibility from the bar **Stage** button (same as capture
target). Closing the bar hides the stage.

## Per-slide files (optional)

`decks/<slug>/slides/*.work` — additional `slide do` blocks merged after inline slides.

## CLI

```bash
reactable decks get <slug> --json
reactable decks slide add <slug> --id x --type iframe --url ...
reactable decks slide move <slug> <id> --to <index>
reactable decks script add <slug> --on deck.open --run "..." [--detach]
reactable decks validate <slug>
```

