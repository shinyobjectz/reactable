# Local agent — manual UI checklist

Automated coverage: `just test-agent-stub` (loop/sandbox) + `just validate-agent-e2e`
(real model). These are the native-surface checks a headless run can't drive.

Prereq: `reactable agent pull` done, app built (`just app`), app running.

| # | Surface | Action | Expect |
|---|---------|--------|--------|
| 1 | Bar | Click robot icon | Agent window opens at `/agent` |
| 2 | Menu bar ◉ | Local Agent… (⌘L) | Same window (focuses if already open) |
| 3 | Gear menu | Local agent… | Same window |
| 4 | Agent header | On open | Badge shows model leaf (`gemma-4-e4b-it-4bit`); status "Model ready · offline" or "cached · loads on first message" |
| 5 | Composer | Type + ↵ | User bubble, then italic "Thinking…" indicator |
| 6 | Reply | Wait | Assistant bubble; tool/turn meta line if tools ran |
| 7 | Composer | ⇧↵ | Newline, no send |
| 8 | Stage button | Click | Native stage opens on the active deck |
| 9 | Bar | Switch project | Agent deck follows (new message uses new deck context) |
| 10 | Pull path | Rename model to a missing id, reopen | Banner: "Model not downloaded" → `reactable agent pull` |

Record pass/fail + app version below.
