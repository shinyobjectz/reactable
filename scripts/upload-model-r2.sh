#!/usr/bin/env bash
# Mirror an HF-cached MLX model to the reactable-downloads R2 bucket under
# models/<repo>/, and write a manifest.json listing its files.
#   scripts/upload-model-r2.sh mlx-community/gemma-4-e4b-it-4bit
set -euo pipefail
REPO="${1:?usage: upload-model-r2.sh <hf-repo>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET="reactable-downloads"

CACHE="$HOME/.cache/huggingface/hub/models--${REPO//\//--}"
SNAP="$(find "$CACHE/snapshots" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1)"
[ -n "$SNAP" ] || { echo "not cached: $REPO (run: reactable agent pull)"; exit 1; }

echo "→ mirroring $REPO from $SNAP"
FILES=()
for f in "$SNAP"/*; do
  name="$(basename "$f")"
  # resolve symlinks (HF stores blobs); skip dirs
  real="$(readlink -f "$f")"
  [ -f "$real" ] || continue
  FILES+=("$name")
  size=$(stat -f%z "$real")
  echo "  ↑ $name ($(echo "scale=1; $size/1e9" | bc) GB)"
  wrangler r2 object put "$BUCKET/models/$REPO/$name" --file "$real" --remote >/dev/null
done

# manifest.json = JSON array of filenames
MANIFEST="$(printf '%s\n' "${FILES[@]}" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"
echo "$MANIFEST" | wrangler r2 object put "$BUCKET/models/$REPO/manifest.json" --pipe --remote --content-type application/json >/dev/null
echo "→ manifest: $MANIFEST"
echo "✓ $REPO mirrored to R2"
