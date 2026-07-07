# HAR cache + Blitz replay

Capture lightweight page refs for agent editing and CSS replay.

```bash
reactable har capture <url> [--project default]
reactable har list [--project default] [--json]
reactable har replay --ref <id> [--project default]   # nexus Blitz (requires serve)
```

Storage: `.reactable/har/<project>/<hash>.json` + body ref.

Use **Blitz replay** to re-render cached HTML with Stylo CSS layout (nexus in-wasm).

Related: `decks import` (planned) — outline from URL + optional HAR snapshot.
