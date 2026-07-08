# island-design — client :unit islands that look designed

Adapted from vendored **frontend-design** + **emil-design-eng** +
**make-interfaces-feel-better** for Reactable's `client :unit` blocks — the
HTML islands that render INSIDE deck slides on the stage.

## What an island is

```
client :price_chart do
  <div id="chart" style="position:absolute;inset:0">…</div>
end

slide do
  id: pricing
  type: client
  unit: price_chart
end
```

Self-contained HTML/CSS/JS, absolutely positioned into the slide box,
captured as video. No routing, no persistence, no responsive breakpoints —
ONE aspect, decided by the deck.

## Direction (from frontend-design, video-tuned)

- Commit to a BOLD direction per deck; islands inherit it. Generic AI
  aesthetics (purple gradients, glassmorphism, Inter-by-reflex) are banned —
  same list as the site's PRODUCT.md.
- Typography carries islands: pick characterful faces, load from Google/
  Fontshare in the island itself (the stage has network).
- Motion is the point of putting an island on a stage: entrance choreography
  on `slide.enter` (the stage fires it), steady-state ambient motion that
  rewards a 10-second hold, exit on `slide.leave`.
- Depth: grain, layered shadows, gradients — flat screenshots read as
  static images and waste the medium.

## Micro-interaction taste (make-interfaces-feel-better)

Hover states are pointless on video. Replace that instinct with TIME-based
delight: staggered reveals, counters that tick, cursors that move themselves
(the recorded cursor is real — leave room for it).

## Hard rules

1. Island = one file's worth of HTML in the `client` block. External deps by
   CDN URL only.
2. Must render correctly at the deck's aspect with NO scrollbars —
   `overflow:hidden` at the root.
3. 60fps or nothing: prefer transform/opacity animation; no layout thrash.
4. Verify on the stage (`reactable stage open`), not a browser.

Deep refs (dev tree): skill/vendored/frontend-design/SKILL.md,
skill/vendored/emil-design-eng/, skill/vendored/make-interfaces-feel-better/.
