# Camera — DOM targeting & 3D movement

Beyond **click-follow zoom** (today's `zoompan` on cursor events).

## Today

- `events.jsonl`: `click`, `cursor`, `slide`
- `composite.py`: zoom toward click coordinates
- Editor: cursor dot replay on stage video

## Phase 6 — DOM source graph

Target **components and regions** in the stage WKWebView, not just pixel coords:

| Capability | Description |
|------------|-------------|
| **DOM selector targets** | `#hero`, `[data-demo]`, React component roots |
| **3D camera rig** | pan/tilt/dolly toward element bounds (HF or native) |
| **Focus graph** | follow active element through slide transitions |
| **Cursor replication** | synthetic pointer synced to DOM focus or agent script |

Planned capture during record:

```json
{ "type": "dom-focus", "t": 12.4, "selector": "[data-slide=pricing]", "bounds": { "x", "y", "w", "h" } }
```

Planned CLI:

```bash
reactable camera target list <take-id>
reactable camera rig <take-id> --selector '#app' --easing dolly-in
reactable composite cursor <id> --anchor dom --selector '[data-cta]'
```

Implementation seams:

- Stage injects **element bounds** into `events.jsonl` on slide enter / agent hook
- HF composition uses bounds for **3D camera** (GSAP + perspective)
- ffmpeg lane: crop window follows normalized bounds timeline

**Skills:** gsap (camera rigs), hyperframes (3D scenes), reveal.js (slide DOM).
