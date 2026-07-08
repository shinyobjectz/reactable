# slide-motion — motion on the stage, record-safe

Routing skill: picks the right motion tool for deck slides and islands, and
sets the constraints that make motion survive capture. Adapted from vendored
css-animations / waapi / animejs / gsap / lottie / three.

## The constraint that changes everything

The stage is CAPTURED at 30–60fps and re-encoded. Motion must be:
- **transform/opacity only** for continuous animation (compositor-friendly);
- **≥200ms** per move (faster reads as flicker after encoding);
- **eased and settling** — springs that overshoot look like tracking errors
  on video;
- **deterministic** — takes get re-recorded; animation must replay identically
  (seed randomness, no Date.now-driven phase).

## Tool routing

| Need | Use | Vendored ref (dev tree) |
|------|-----|------------------------|
| entrance/exit, staggered reveals | CSS animations + `slide.enter` hooks | css-animations |
| scripted sequences, no deps | Web Animations API | waapi |
| timeline choreography, scrub-like control | GSAP (CDN) | gsap |
| complex SVG/vector motion | anime.js or Lottie player | animejs, lottie |
| 3D moments (hero spins, cameras) | three.js — the `overdrive` lane | three |

## Stage hooks

The stage dispatches `slide.enter` / `slide.leave` to islands, and script
blocks can fire on the same triggers:

```
script do
  id: chart-in
  on: slide.enter
  slide: pricing
  run: echo noop   # native side; in-island JS listens for the DOM event
end
```

In-island: `addEventListener('reactable:slide.enter', start)`.

## Post-motion belongs to the pipeline

Zooms, cursor emphasis, and camera moves on RECORDED takes are not slide
motion — they are `reactable takes render` / HyperFrames territory. See
[[takes-post]].
