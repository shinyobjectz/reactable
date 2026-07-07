# Setup — CLI, app, skills, tools

```bash
# CLI (any platform with Bun)
npm i -g reactable-cli
reactable doctor
reactable tools doctor
reactable tools build              # Rust sidecar → dist/reactable-tools
reactable tools install hyperframes

# macOS app
reactable install app

# Agent skills (Cursor / Claude Code)
reactable skills install --user
reactable skills prompt              # copy-paste block for any agent

# Related motion skills
npx hyperframes init
npx skills add https://github.com/greensock/gsap-skills --copy -y -a cursor -a claude-code
```

Registry: `skill/dist/registry.json` (CI-compiled from `skill/manifest.json`).
