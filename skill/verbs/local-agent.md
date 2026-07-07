# Local agent — offline gemma-4 (MLX)

Built-in agent for users without Cursor/Claude Code. **Nexus** orchestrates tools;
**gemma-4** runs out-of-process via `mlx_lm.server` (Apple Silicon), spoken to over
localhost HTTP by `reactable-tools`. No Hugging Face account, no gated model, no
build flag.

## Open

| Surface | Action |
|---------|--------|
| **Bar** | Robot icon → local agent window |
| **Menu bar ◉** | Local Agent… (⌘L) |
| **Gear menu** | Local agent… |

## Setup (one time)

```bash
reactable agent pull        # ~2GB download, no account needed (anon HF is throttled)
reactable agent status      # → server-ready | model-cached | needs-pull | uv-missing
```

Requires `uv` (`curl -LsSf https://astral.sh/uv/install.sh | sh`). The model server
env is pinned and provisioned automatically on first chat:
`mlx-lm==0.31.3` + `transformers==5.0.0` (python 3.12).

Default model: `mlx-community/gemma-4-e4b-it-4bit` (~4.3GB RAM, ~50 tok/s on M-series).
Override with `REACTABLE_AGENT_MODEL`. Higher quality: `mlx-community/gemma-4-12B-it-4bit`.

## Server lifecycle

- Spawns on the first chat (cold load < ~30s from cache), then stays warm (~0.5–6s/turn).
- Idle-kills after 30 min (`REACTABLE_AGENT_IDLE` seconds; 0 disables).
- Manual control: `reactable agent serve` / `reactable agent serve --stop`.

## CLI

```bash
reactable agent chat "Plan a 5-slide deck about MLX"
reactable agent status --json
reactable projects new "My Conference Talk"
```

## Sandbox

Agent tools run inside the active project (`WB_DATA`), non-login shell, scrubbed env:

- `bash` — prefix-allowlisted: `reactable`, `bun run`, `ffmpeg`, `bash scripts/`, `python3 scripts/`
- `read_file` / `write_file` — sandbox-relative; symlinks resolved, escapes rejected

## Tests

- `just test-agent-stub` — deterministic loop + sandbox (no model, `REACTABLE_AGENT_STUB=1`)
- `just validate-agent-e2e` — real model, tool invoke-rate, latency, escape probes

## Video feedback loop (planned)

1. Agent generates stage video / deck
2. Stage floating toolbar → record reaction take (mic + cam + cursor)
3. Take composited → fed back to agent for revision

See [[docs/GOALS.local-agent]] and [[docs/ROADMAP.agent-toolchain]] Phase 7.
