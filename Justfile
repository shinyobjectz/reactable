# Reactable — portable CLI (project-only install).
# Serves on its OWN nexus — never the studio server (see root Justfile `board`).
set shell := ["bash", "-uc"]

root := justfile_directory()
native := root / "native"
PORT := env_var_or_default("PORT", "4020")
NEXUS := env_var_or_default("NEXUS", root / "../../../workbooks/nexus")

default:
    @just --list

# P0 spike: Aperture window capture of WKWebView + cross-origin iframe.
p0:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{native}}"
    swift build -c release
    mkdir -p spike-out
    .build/release/p0-spike
    if command -v ffprobe >/dev/null; then
      echo "--- ffprobe ---"
      ffprobe -v error -show_entries stream=codec_type,width,height,duration -of default=noprint_wrappers=1 spike-out/stage-window.mp4 || true
    fi
    if command -v ffmpeg >/dev/null; then
      ffmpeg -y -loglevel error -ss 2 -i spike-out/stage-window.mp4 -frames:v 1 spike-out/frame.png || true
      echo "frame → native/spike-out/frame.png"
    fi

# P1: build + launch menu-bar app (spawns nexus + stage window).
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{native}}"
    swift build -c release
    .build/release/reactable

build:
    cd "{{native}}" && swift build -c release

# Bundle a double-clickable Reactable.app (Dock + Launchpad).
app: build
    #!/usr/bin/env bash
    set -euo pipefail
    APP="{{root}}/dist/Reactable.app"
    rm -rf "$APP"
    mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
    cp "{{native}}/.build/release/reactable" "$APP/Contents/MacOS/"
    cp "{{native}}/Resources/Info.plist" "$APP/Contents/"
    chmod +x "$APP/Contents/MacOS/reactable"
    echo "→ $APP"

# Copy Reactable.app to ~/Applications (run `just app` first).
install: app
    #!/usr/bin/env bash
    set -euo pipefail
    DEST="$HOME/Applications/Reactable.app"
    rm -rf "$DEST"
    cp -R "{{root}}/dist/Reactable.app" "$DEST"
    echo "Installed → $DEST"
    echo "Open from Launchpad, Dock (pin it), or Spotlight."

# Headless nexus sidecar. Swift shell spawns this in production.
serve:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -f "{{root}}/.env" ] && { set -a; . "{{root}}/.env"; set +a; }
    cd "{{NEXUS}}"
    export SHINYOBJECTZ_ROOT="$(cd '{{root}}/../..' && pwd)"
    WB_SERVE=1 PORT={{PORT}} WB_DATA="{{root}}" SHINYOBJECTZ_ROOT="$SHINYOBJECTZ_ROOT" elixir --no-halt -S mix run

# Verify nexus API (run `just serve` in another terminal first).
check:
    #!/usr/bin/env bash
    set -euo pipefail
    curl -sf "http://127.0.0.1:{{PORT}}/reactable/health"
    echo ""
    curl -sf "http://127.0.0.1:{{PORT}}/reactable/deck?slug=demo" | head -c 500
    echo ""

# Open post editor (requires `just dev` or installed app).
editor:
    @open "http://127.0.0.1:{{PORT}}/editor"

# Full P0–P5 validation (headless; ~2 min).
validate:
    bash "{{root}}/scripts/validate-all.sh"

# Render latest (or given) take to out/final*.mp4
render take="":
    #!/usr/bin/env bash
    set -euo pipefail
    ROOT="{{root}}"
    TID="{{take}}"
    if [ -z "$TID" ]; then
      TID="$(ls -td "$ROOT/takes"/take-* 2>/dev/null | head -1 | xargs basename)"
    fi
    python3 "$ROOT/scripts/composite.py" "$ROOT/takes/$TID"

# Synthetic take for CI / headless checks
fixture:
    bash "{{root}}/scripts/fixture-take.sh"

p3:
    bash "{{root}}/scripts/p3-check.sh"

# stage — open native preview (same surface as recording)
stage deck="demo":
    bun run "{{root}}/cli/bin/reactable.ts" stage open --deck {{deck}}

# Agent CLI (Bun)
cli *args:
    bun run "{{root}}/cli/bin/reactable.ts" {{args}}

# Install `reactable` on PATH (~/.bun/bin)
cli-install:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}/cli"
    bun link
    bun install -g .
    echo "→ reactable installed to ~/.bun/bin/reactable"
    echo "  ensure ~/.bun/bin is in PATH (add to ~/.zshrc if needed)"
    echo "  verify: reactable doctor"

doctor:
    bun run "{{root}}/cli/bin/reactable.ts" doctor

# Cloudflare site + API (auth, YouTube OAuth, CLI device flow)
web-install:
    cd "{{root}}/web" && bun install

web-dev:
    cd "{{root}}/web" && bun run dev

web-deploy:
    cd "{{root}}/web" && bun run deploy && bash scripts/attach-domain.sh

# Publish cli/ to npm (requires NPM_TOKEN env)
cli-publish:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}/cli"
    if [ -z "${NPM_TOKEN:-}" ]; then echo "set NPM_TOKEN" >&2; exit 1; fi
    echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "${HOME}/.npmrc"
    npm publish --access public
