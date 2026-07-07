# Local agent eval

Measures whether the offline gemma-4 agent can actually **edit and build** in a
real reactable project — not whether its prose sounds right. Every task is graded
by a deterministic checker against the resulting file/deck state.

## Run

```bash
reactable agent pull          # once — model must be cached
just eval                     # 3 trials/task (default)
just eval --trials 5
just eval --tasks add-slide,fix-broken
```

Output: a scored table on stdout, `scripts/eval/report.work`, and raw
`scripts/eval/last-run.json`.

## How it works

1. Boots nexus against an **isolated** workspace (`scripts/eval/fixture/` copied
   to a temp dir; `WB_DATA` points there, so the agent's `reactable decks …` and
   file writes never touch the repo).
2. Restores the fixture **before every trial** — no cross-trial contamination.
3. Sends each task's natural-language instruction through `POST /reactable/agent/chat`
   (fresh history), then runs the checker on the workspace + reply.
4. Scores pass-rate, latency, and tool count per task over N trials.

## Tasks (`tasks.json`)

| id | kind | checks |
|----|------|--------|
| count-decks | read | reply states the deck count (2) |
| read-title | read | reply contains the demo deck title |
| add-slide | edit | demo deck gains slide `closing`, still validates |
| rename-title | edit | demo title becomes exactly "Reactable Live" |
| create-deck | build | a new deck exists, validates, title matches |
| fix-broken | build | the seeded duplicate-id deck validates after edit |
| write-outline | build | `notes/outline.md` has ≥3 markdown bullets |

## Adding a task

Add an entry to `tasks.json` and, if it needs new verification, a checker in
`run.py` (`CHECKERS` map). Checkers take `(spec, ws, reply, tools)` and return
`(passed, detail)`. Prefer checking the CLI/filesystem over the model's text.

## Fixture

`scripts/eval/fixture/` is a frozen minimal project: a valid `demo` deck and a
`broken` deck (duplicate slide id) for the fix-it task. Keep it small and stable
— changing it changes the ground truth.
