### Video models (Pro — heavy credits, confirm before big spends)

---
source: internal — web/src/video.ts
fetched: 2026-07-08
auth: Reactable session (server-side, Pro, upfront-charged, auto-refund on failure)
---

Generation + EDITING of video through the gateway. Priced per second of
OUTPUT: omni-flash 100cr/s (≤10s, the only one that EDITS existing footage)
· veo-3 400cr/s (≤8s, top quality) · veo-3-fast 150cr/s (≤8s). An 8s veo-3
is 3,200 credits — ALWAYS confirm with the user above ~500 credits.

Edit existing footage (omni-flash only — the killer move):
```tool
{"name":"connector","args":{"provider":"videogen","model":"omni-flash","videoUrl":"https://…/clip.mp4","prompt":"make the background a sunset timelapse, keep the speaker untouched","seconds":8}}
```

Generate b-roll:
```tool
{"name":"connector","args":{"provider":"videogen","model":"veo-3-fast","prompt":"slow dolly over a wooden desk, warm morning light","seconds":6}}
```

omni-flash returns {uri} directly; veo returns {operation, poll} — poll
until done, then fetch the uri. Download results into assets/ so the panel
thumbnails them.
