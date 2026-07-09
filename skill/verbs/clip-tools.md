# Clip-assist tools

Procedural helpers you (the agent) **call** to help edit — ideate, search, and
assemble clips. You never train anything; these use models/heads that already
exist on-device. Run them with the `bash` tool, prefer `--json`.

## `reactable brand [<dir>] --json`
Unsupervised brand / hero-product / category across a set of clips' `.intel`
sidecars (defaults to `assets/brand`). Reads OCR + MobileViCLIP votes; returns
`{ brands[], category, confidence }`. Use it to understand what a footage set is
about before ideating an edit.

## `reactable reframe <clip> <9:16|1:1|4:5> --json`
Per-shot reframe **plan** for aspect conversion — decides `crop` (track the
subject), `stack` (split-screen two speakers far apart), or `letterbox` (wide
action). Returns `{ source, compositions, plan[] }`. The clip must be indexed
(`reactable video index <clip>`); returns a plan, not a render.

## `reactable cutpoints <clip> [--k N] --json`
Scores candidate cut points across a clip using the trained cut-point head and
its motion signature — the best places to cut. Returns `top_cut_points[]`
`{ t_ms, score }`. Use it to pick cuts for a recut or to inform `propose-edit`.

## `reactable propose-edit <clip> --intent "…" [--render] --json`
Drafts an edit (a keep/reorder/punch plan) for the intent, and renders it when
`--render` is set. Use this to turn "make me a punchy 10s hero cut" into an
actual assembled clip.

Related: `video find` / `video at` (search footage), `video autoedit` (edit from
recorded ground-truth events), `video compose` (isolate + bg-swap render).
