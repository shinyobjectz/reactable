# Walkthrough demo — Reactable projects panel

Agent-captured walkthrough of the live `/projects` panel (Chrome MCP drove the
page; per-step self-contained DOM snapshots — CSSOM inlined, scripts stripped).
Render:

    reactable walkthrough render docs/demos/walkthrough-projects-panel

→ `walkthrough.mp4` (2 steps, title chips + cursor glide + click ripple),
rendered entirely by wavelet-render-core. No screen recorder involved.

Known fidelity gaps (P3 backlog): some text nodes drop when styled via
`font: <size> inherit` shorthand (suspect stylo font shorthand handling —
same family as the fixed ui-* generic bug); external http images/SVG sprites
don't resolve (FileNetProvider is file:/data: only — host-injected assets are
the P3 seam); JS-materialized state requires browser serialization (curl only
sees server HTML — by design).
