---
name: reactable
description: >-
  Agent CLI and deck DSL for Reactable — native stage + metal Mac capture.
  Author decks in `.work` format, preview via `reactable stage open` (same
  WKWebView as recording), manage takes and HyperFrames post. Use when
  authoring presentation recordings, editing takes, or running reactable
  decks/takes/stage commands.
---

# Reactable (agent CLI)

Native macOS recorder + **one stage surface** (WKWebView + reveal.js). Agents
author `deck.work` and preview through **`reactable stage open`** — the same
window that gets captured on metal.

Project root: `projects/reactable/`

## Install skills

```bash
cd projects/reactable
bun run cli/bin/reactable.ts skills install        # → .cursor/skills/reactable
bun run cli/bin/reactable.ts skills install --user # → ~/.cursor/skills/reactable
```

Also load **`hyperframes`** and **`hyperframes-cli`** for video post.

## Quick map

| Layer | Path | Agent access |
|-------|------|----------------|
| CLI | `cli/bin/reactable.ts` | `reactable <verb>` |
| Decks | `decks/<slug>/deck.work` | `reactable decks …` |
| Takes | `takes/take-*` | `reactable takes …` |
| Stage | native `StageWindow` → `/present` | **`reactable stage open`** |
| Post (fast) | `scripts/composite.py` | `reactable takes render` |
| Post (rich) | `takes/*/hyperframes/` | `reactable takes hf init/render` |

Monorepo: `just reactable <verb>` from repo root.

## `.work` weave (how it connects)

```
deck.work  →  api.work (parse)  →  /reactable/deck JSON
                                        ↓
                              present/index.work (reveal.js)
                                        ↓
                              StageWindow WKWebView  →  stage.mov
```

Full pipeline: [references/stage-pipeline.md](references/stage-pipeline.md)

## Deck DSL (native `.work`, not JSON)

`deck.work` uses **`slide do`**, **`script do`**, **`preload do`**, **`client :unit`**.

See [[decks/demo/deck.work]] and [[decks/showcase/deck.work]].

### Slide types

`prose`, `html`, `client`, `iframe`, `video`, `youtube` — see [deck-dsl.md](references/deck-dsl.md).

### Script triggers

| `on` | When |
|------|------|
| `deck.open` | Stage loads deck |
| `record.start` | Native recorder starts (Swift only) |
| `slide.enter` | Navigated to slide |
| `slide.leave` | Leaving slide |

Example:

```work
script do
  id: dev
  on: deck.open
  run: npm run dev
  cwd: labs/my-app
  detach: true
end
```

## Agent workflow

### 1. Plan & research

```bash
reactable plan <slug>
reactable decks get <slug> --json
reactable decks validate <slug>
```

### 2. Author deck

```bash
reactable decks new "My Talk"
reactable decks slide add demo --id app --type iframe --url /reactable/labs/counter.html
reactable decks script add demo --on deck.open --run "echo ready" --detach
```

### 3. Preview on the real stage

```bash
just reactable dev                      # native app (required for faithful preview)
reactable stage open --deck demo        # NOT a browser tab
reactable stage status --json           # deck + visible heartbeat
```

Labs and iframe apps render **inside** slide sections while you navigate ← →.

### 4. Record

Same stage window — bar → Record (Stage capture mode).

```bash
reactable record   # prints checklist
```

### 5. Post

```bash
reactable takes render <id>
reactable takes hf init <id> && reactable takes hf render <id>
```

## Hard rules

1. **Stage is the only presentation view** — use `reactable stage open`, never `open` a browser URL for deck preview.
2. **Decks are native `deck.work`** — `slide do` blocks; API compiles prose to HTML server-side.
3. **Apps live in slides** — local labs at `/reactable/labs/…`, iframe slides, or `client :unit` islands.
4. **Scripts only run if declared** in `script do` blocks (or explicit `decks script run`).
5. **Own nexus** — `:4020`, never the studio server.

## References

- [stage-pipeline.md](references/stage-pipeline.md) — `.work` weave end-to-end
- [deck-dsl.md](references/deck-dsl.md) — slides, scripts, dev servers
- [takes-hyperframes.md](references/takes-hyperframes.md) — events → HF timeline
- [agent-workflows.md](references/agent-workflows.md) — recipes

Plan of record: [[docs/CLI]] · [[docs/PLAN]]
