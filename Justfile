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

# P1: build, install to ~/Applications, and launch.
dev: app
    #!/usr/bin/env bash
    set -euo pipefail
    open "$HOME/Applications/Reactable.app"

build:
    cd "{{native}}" && swift build -c release

# Build Reactable.app and install to ~/Applications (replaces existing).
app: build
    #!/usr/bin/env bash
    set -euo pipefail
    ROOT="{{root}}"
    APP="$ROOT/dist/Reactable.app"
    DEST="$HOME/Applications/Reactable.app"
    rm -rf "$APP"
    mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
    cp "{{native}}/.build/release/reactable" "$APP/Contents/MacOS/"
    cp "{{native}}/Resources/Info.plist" "$APP/Contents/"
    cp "{{native}}/Resources/AppIcon.icns" "$APP/Contents/Resources/"
    cp "{{native}}/Resources/AppIcon.png" "$APP/Contents/Resources/"
    chmod +x "$APP/Contents/MacOS/reactable"
    # Bundled nexus sidecar (required for Dock/Launchpad — no system Elixir)
    if [ ! -x "$ROOT/dist/reactable-nexus" ]; then
      echo "→ building reactable-nexus sidecar…"
      "$ROOT/scripts/build-sidecar.sh"
    fi
    if [ -x "$ROOT/dist/reactable-nexus" ]; then
      cp "$ROOT/dist/reactable-nexus" "$APP/Contents/MacOS/"
      chmod +x "$APP/Contents/MacOS/reactable-nexus"
    else
      echo "⚠ reactable-nexus missing — app will need Elixir in dev" >&2
    fi
    # Bundle sidecar tools if built
    if [ -x "$ROOT/dist/reactable-tools" ]; then
      cp "$ROOT/dist/reactable-tools" "$APP/Contents/MacOS/"
    fi
    # Codesign with entitlements — REQUIRED for Screen Recording / Camera / Mic.
    # Without this the app is only linker-adhoc-signed, its Info.plist isn't bound
    # to the signature, camera/mic entitlements don't apply, and TCC prompts never
    # fire → the record button silently fails. Developer ID keeps grants across
    # rebuilds (TCC keys off the team identity, not the per-build cdhash).
    ENT="{{native}}/Resources/Reactable.entitlements"
    IDENTITY="${CODESIGN_IDENTITY:-Developer ID Application: Shane Murphy (BJJZ79J5NL)}"
    TEAM="$(printf '%s' "$IDENTITY" | sed -n 's/.*(\(.*\)).*/\1/p')"
    if [ -n "$TEAM" ] && security find-identity -v -p codesigning 2>/dev/null | grep -q "$TEAM"; then
      SIGN="$IDENTITY"; echo "→ signing with Developer ID ($TEAM)"
    else
      SIGN="-"; echo "→ Developer ID not found — signing ad-hoc with entitlements (TCC grants reset each rebuild)"
    fi
    sign() { codesign --force --options runtime --entitlements "$ENT" --sign "$SIGN" "$1"; }
    [ -x "$APP/Contents/MacOS/reactable-nexus" ] && sign "$APP/Contents/MacOS/reactable-nexus"
    [ -x "$APP/Contents/MacOS/reactable-tools" ] && sign "$APP/Contents/MacOS/reactable-tools"
    sign "$APP/Contents/MacOS/reactable"
    sign "$APP"
    codesign --verify --strict "$APP" && echo "→ signed + verified"
    # Replace installed copy (quit running instance first so binary can swap)
    if pgrep -x reactable >/dev/null 2>&1; then
      echo "→ quitting running Reactable…"
      osascript -e 'tell application "Reactable" to quit' 2>/dev/null || pkill -x reactable || true
      sleep 0.5
    fi
    # Orphan nexus listeners block the next boot
    if command -v lsof >/dev/null; then
      PIDS=$(lsof -tiTCP:4020 -sTCP:LISTEN 2>/dev/null || true)
      if [ -n "$PIDS" ]; then
        echo "→ freeing :4020 ($PIDS)…"
        kill $PIDS 2>/dev/null || true
        sleep 0.3
      fi
    fi
    rm -rf "$DEST"
    cp -R "$APP" "$DEST"
    echo "→ $DEST (replaced)"
    echo "→ $APP"

# Alias — same as app (always replaces ~/Applications).
install: app

# Build only, no install to ~/Applications
app-dist: build
    #!/usr/bin/env bash
    set -euo pipefail
    APP="{{root}}/dist/Reactable.app"
    rm -rf "$APP"
    mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
    cp "{{native}}/.build/release/reactable" "$APP/Contents/MacOS/"
    cp "{{native}}/Resources/Info.plist" "$APP/Contents/"
    cp "{{native}}/Resources/AppIcon.icns" "$APP/Contents/Resources/"
    cp "{{native}}/Resources/AppIcon.png" "$APP/Contents/Resources/"
    chmod +x "$APP/Contents/MacOS/reactable"
    echo "→ $APP"

# Signed + notarized production DMG → dist/Reactable.dmg + R2 upload
release:
    bash "{{root}}/scripts/release-dmg.sh"

# Preflight signing + notarization credentials
release-check:
    bash "{{root}}/scripts/check-apple-release.sh"

# Burrito-wrapped nexus only (dev iteration)
sidecar:
    bash "{{root}}/scripts/build-sidecar.sh"

# Headless nexus sidecar. Swift shell spawns this in production.
serve:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -f "{{root}}/.env" ] && { set -a; . "{{root}}/.env"; set +a; }
    cd "{{NEXUS}}"
    export SHINYOBJECTZ_ROOT="$(cd '{{root}}/../..' && pwd)"
    # Honor a pre-set WB_DATA (e.g. the eval workspace); default to the project root.
    WB_SERVE=1 PORT={{PORT}} WB_DATA="${WB_DATA:-{{root}}}" SHINYOBJECTZ_ROOT="$SHINYOBJECTZ_ROOT" elixir --no-halt -S mix run

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

# Demo MP4 for video slides (decks/*/labs/sample.mp4)
lab-samples:
    bash "{{root}}/scripts/gen-lab-samples.sh"

# Compile skill registry (CI + before skills install)
skills-compile:
    bun run "{{root}}/scripts/compile-skills.ts"

# Rust tools sidecar → dist/reactable-tools
tools:
    bash "{{root}}/scripts/build-tools.sh"

# MLX smoke — Moonshine STT, Kokoro TTS, speech edit (Apple Silicon)
smoke-mlx take="take-fixture-validation":
    bash "{{root}}/scripts/smoke-mlx.sh" {{take}}

# Local agent scaffold smoke (Nexus routes + sidecar status; no model needed)
smoke-agent:
    bash "{{root}}/scripts/smoke-agent.sh"

# Deterministic agent loop + sandbox tests (REACTABLE_AGENT_STUB=1; no model)
test-agent-stub:
    bash "{{root}}/scripts/test-agent-stub.sh"

# Real-model E2E — needs default model cached (`just agent-pull` first)
validate-agent-e2e:
    bash "{{root}}/scripts/validate-agent-e2e.sh"

# Pull the default local agent model (~2GB, one-time; no HF account)
agent-pull:
    "{{root}}/dist/reactable-tools" agent-pull

# Agentic eval — real edits/builds in an isolated workspace, deterministic checks
eval *args:
    python3 "{{root}}/scripts/eval/run.py" {{args}}

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
