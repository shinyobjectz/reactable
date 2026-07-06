# Reactable

Native macOS recorder + deck stage + agent CLI. Record reactions, ship takes.

- **Site:** [reactable.app](https://reactable.app)
- **CLI (npm):** `npm install -g reactable-cli` → `reactable`
- **Desktop:** Releases on GitHub → `Reactable.app`

## Quick start

```bash
# CLI (requires Bun)
npm install -g reactable-cli
reactable doctor

# Dev (macOS)
just dev          # menu-bar app + nexus :4020
reactable stage open --deck showcase
```

## Repo layout

| Path | Role |
|------|------|
| `cli/` | npm package `reactable-cli` |
| `native/` | Swift shell (Aperture capture, stage, bar) |
| `web/` | Cloudflare worker + reactable.app |
| `present/`, `bar/`, `editor/` | Nexus `.work` surfaces |
| `decks/`, `takes/` | Content |

## Monorepo submodule

In [shinyobjectz](https://github.com/shinyobjectz/shinyobjectz) (or your spine repo):

```bash
git submodule add https://github.com/shinyobjectz/reactable.git projects/reactable
git submodule update --init --recursive
just reactable dev
```

## License

MIT
