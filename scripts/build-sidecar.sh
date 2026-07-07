#!/usr/bin/env bash
# Build Burrito-wrapped nexus sidecar (self-contained Erlang, no system elixir).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR="$ROOT/sidecar"
NEXUS_PATH="${NEXUS_PATH:-$(cd "$ROOT/../../../../workbooks/nexus" 2>/dev/null && pwd || echo "$HOME/Apps/workbooks/nexus")}"
OUT="$ROOT/dist/reactable-nexus"

echo "→ burrito sidecar (nexus: $NEXUS_PATH)"
export NEXUS_PATH

# Burrito 1.5 requires Zig 0.15.2 (not 0.16.x from default brew zig)
if [[ -x "/opt/homebrew/opt/zig@0.15/bin/zig" ]]; then
  export PATH="/opt/homebrew/opt/zig@0.15/bin:$PATH"
elif [[ -x "/usr/local/opt/zig@0.15/bin/zig" ]]; then
  export PATH="/usr/local/opt/zig@0.15/bin:$PATH"
fi
zig version
cd "$SIDECAR"

mix deps.get
BURRITO_TARGET=macos_silicon MIX_ENV=prod mix release reactable_sidecar --overwrite
BIN="$SIDECAR/burrito_out/reactable_sidecar_macos_silicon"
if [[ ! -x "$BIN" ]]; then
  echo "burrito binary not found at $BIN" >&2
  ls -la "$SIDECAR/burrito_out/" 2>&1 || true
  exit 1
fi

cp -f "$BIN" "$OUT"
chmod +x "$OUT"
echo "→ $OUT"
