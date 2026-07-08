# Reactable — Design System

Obsidian, retro-geometric, instrument-grade. Dark because a recorder is used in a
dim room with a bright stage — the chrome must never outshine the content being
captured. One accent (record red); everything else is a tinted neutral.

## The chrome token bridge

The native Swift `Chrome` enum (`native/Sources/Reactable/ChromeTokens.swift`) is
the single source of truth. It injects matching CSS custom properties into every
panel WKWebView at document start, so `.work` surfaces never re-hardcode chrome
values. Consume them with fallbacks:

```css
border-radius: var(--rt-radius-outer, 14px);
border: var(--rt-stroke-w, 1px) solid var(--rt-stroke-outer, rgba(255,255,255,.10));
background: var(--rt-bg-root, #141414);
```

| Token | Value | Role |
|---|---|---|
| `--rt-radius-outer` | 14px | window roots, docked bar |
| `--rt-radius-inner` | 10px | content frame, docked-cell body |
| `--rt-radius-control` | 8px | buttons, pills, menus, drop hints |
| `--rt-stroke-outer` | white 10% | window hairline |
| `--rt-stroke-inner` | white 14% | content-frame ring |
| `--rt-bg-root` | ~oklch(0.20 0.004 285) | panel background |
| `--rt-bg-content` | ~oklch(0.16 0.004 285) | inside the content frame |
| `--rt-strip-h` | 28px | drag strip |
| `--rt-margin` | 12px | frame margin |
| `--rt-gap` | 8px | strip → content gap |

Radii nest concentrically: outer 14 → inner 10 → control 8. Never introduce a
fourth radius; pick the nearest token.

## Color

OKLCH, neutrals tinted toward a cool violet-grey (chroma ~0.004). Never pure
`#000`/`#fff`.

- Surfaces: `--rt-bg-root` (panels) over `--rt-bg-content` (stage/preview well).
- Text: `#e8e6e3` primary, ~55% white secondary, ~40% white tertiary.
- Strokes: white 10% (structural), white 14% (content ring). Hairlines only —
  no stroke wider than 1px as decoration, ever.
- **Accent: record red `#e11`** (`oklch(0.58 0.22 25)`). Reserved for the record
  button and the capture outline. Do not spend red anywhere else.
- Status hues in the manager (window/deck/slide kind chips) stay low-chroma and
  muted — informational, not decorative.

## Typography

- UI: system sans (`ui-sans-serif, system-ui`). Marketing site keeps Syne +
  IBM Plex Mono; the app chrome does not.
- Scale via weight contrast: 11px semibold headers, 12–13px regular body,
  9–10px uppercase mono for kind chips. Steps ≥1.25 apart.

## Elevation

- Window drop shadow is AppKit's (`hasShadow`), tuned dark and soft.
- Inside a surface, elevation is a background-tint step, not a new shadow. No
  nested shadows, no glass.

## Motion

- Ease-out only (system default curves); ~0.15–0.18s. No bounce, no elastic.
- Frame transitions (dock/undock/merge, layout switch) animate window frames;
  content does not cross-fade (reparenting a live WKWebView flashes).
- Never animate layout CSS properties on the surfaces.

## Bans (enforced)

- No side-stripe accent borders. Full hairline borders or background tints only.
- No gradient text, no `background-clip: text`.
- No decorative glassmorphism. `backdrop-filter` only on the floating bar.
- No em dashes in UI copy.
