#!/usr/bin/env bash
# Build reactable-tools sidecar → dist/reactable-tools
# MLX STT/TTS on Apple Silicon. Agent LLM runs out-of-process (mlx_lm.server
# via uv) — no build flag needed; model fetch is `reactable agent pull`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/tools"
cargo build --release
mkdir -p "$ROOT/dist"
cp "$ROOT/tools/target/release/reactable-tools" "$ROOT/dist/reactable-tools"
chmod +x "$ROOT/dist/reactable-tools"
echo "→ $ROOT/dist/reactable-tools"
