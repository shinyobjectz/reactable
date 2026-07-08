# Reactable — Product Context

register: product

## Product Purpose

Reactable is a native macOS recorder and editor for product demos and reaction
videos. It composites a deck stage, camera, and microphone into takes, then lets
the creator preview, arrange, and post them. Two modes share one panel system:

- **Record** — the stage sits center with the control bar; capture is live.
- **Edit** — projects on the left, chat on the right, a tabbed preview in the
  center. No recorder. Preview content holds a fixed aspect ratio, letterboxed
  inside a freely resizable panel.

Panels float independently or dock into one combined window; the composition is
saveable as a named layout.

## Users

Solo creators and small teams recording software demos, tutorials, and reaction
clips on a Mac. They live in the app for a whole session — recording, reviewing
takes, re-cutting — so the chrome has to stay out of the way and never fight
them. The bar for "feels native and calm" is Screen Studio / CleanShot, not a
web dashboard.

## Tone

Quiet, precise, utilitarian. The interface is an instrument, not a landing page.
Confidence through restraint: obsidian neutrals, hairline strokes, one red accent
reserved for the record affordance. Nothing decorative competes with the content
being captured.

## Anti-references

- SaaS marketing chrome: gradient hero panels, glass cards, bright accent soup.
- Heavy multi-color UI. Color is earned (record = red); everything else is neutral.
- Anything that reads as "a website in a window." This is a desktop tool.

## Strategic principles

- **Content is the subject.** Chrome recedes; the stage/preview is the focus.
- **One system, two modes.** Record and Edit reuse the same panels and the same
  chrome tokens. Switching modes rearranges, it doesn't restyle.
- **Fixed geometry stays truthful.** The capture crop and the preview letterbox
  must match the visible frame exactly — chrome math is load-bearing.
