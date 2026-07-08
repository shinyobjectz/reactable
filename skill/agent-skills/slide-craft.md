# slide-craft — the design vocabulary for the stage

Adapted from vendored **impeccable** (skill/vendored/impeccable/) for Reactable:
the surface is never a web page. It is a 16:9 (or 9:16) stage slide, captured
on metal, watched as video. A slide gets seconds of attention, at a distance,
often at 1080p compression — design for that.

## Registers (replace impeccable's brand/product split)

- **talk** — slides behind a speaking human (cam PIP). Big type, one idea per
  slide, quiet backgrounds; the face is the hero, the slide is support.
- **demo** — a live app/iframe island IS the slide. Chrome minimal, the
  island full-bleed; annotations and zoom targets, not decoration.
- **ad** — the take is the creative. Hook in the first slide, bold color
  commitment, motion that earns the rewind.

Name the register before designing. deck.work notes: `register: talk|demo|ad`.

## The command vocabulary (impeccable's, re-aimed)

Use these as thinking moves when authoring or editing `deck.work` slides and
`client :unit` islands:

- **/craft** — shape-then-build a slide sequence from the take's brief.
- **/critique** — score a deck: hierarchy at 3m viewing distance, one-idea-
  per-slide, register consistency, video-safe contrast (no #fff on #000
  shimmer — it moirés on capture).
- **/typeset** — type for video: minimum 32px body at 1080p, 1.25+ scale
  steps, no thin weights under 24px (they alias on capture).
- **/colorize** — commit to a palette per DECK, not per slide; the stage's
  own chrome is #141414 — slides may either live in it or deliberately break.
- **/animate** — motion that reads on video: 300–600ms, eased, settles.
  Nothing faster than 200ms (becomes flicker at 30fps capture).
- **/bolder /quieter /distill /polish** — as in impeccable, applied per slide.

## Hard video rules

1. Every slide must read in 2 seconds, muted, at 50% size.
2. Safe margins: keep text inside 90% width / 85% height (platform crops).
3. The cam PIP owns the bottom-right quarter in talk register — never put
   payload there.
4. Test on the REAL stage: `reactable stage open --deck <slug>`, never a
   browser tab.

## Deep references (dev-tree project only)

skill/vendored/impeccable/reference/{craft,critique,typeset,layout,colorize,
animate,motion-design,color-and-contrast,cognitive-load}.md — read_file them
when a move needs its full discipline. In bundled projects they are absent;
this file is self-sufficient for the 90% case.
