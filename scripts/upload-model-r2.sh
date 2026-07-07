#!/usr/bin/env bash
# Mirror an HF-cached MLX model to the reactable-downloads R2 bucket under
# models/<repo>/. Files over R2's 300 MiB wrangler-put limit are split into
# parts; the client (reactable-tools pull) reassembles them. Writes a
# manifest.json describing each file's parts.
#   scripts/upload-model-r2.sh mlx-community/gemma-4-e4b-it-4bit
set -euo pipefail
REPO="${1:?usage: upload-model-r2.sh <hf-repo>}"
BUCKET="reactable-downloads"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-6d4b74aeb10f455fbf88141901e7595d}"
CHUNK=290000000   # 290 MB, under wrangler's 300 MiB per-object cap

CACHE="$HOME/.cache/huggingface/hub/models--${REPO//\//--}"
SNAP="$(find "$CACHE/snapshots" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1)"
[ -n "$SNAP" ] || { echo "not cached: $REPO (run: reactable agent pull)"; exit 1; }

put() { wrangler r2 object put "$1" --file "$2" --remote >/dev/null 2>&1; }

echo "→ mirroring $REPO from $SNAP"
ENTRIES=()
for f in "$SNAP"/*; do
  name="$(basename "$f")"
  real="$(readlink -f "$f")"
  [ -f "$real" ] || continue
  size=$(stat -f%z "$real")

  if [ "$size" -gt "$CHUNK" ]; then
    tmp="$(mktemp -d)"
    split -b "$CHUNK" "$real" "$tmp/$name.part."   # → name.part.aa, name.part.ab, …
    parts=()
    for p in "$tmp/$name.part."*; do
      pn="$(basename "$p")"
      echo "  ↑ $pn ($(echo "scale=2; $(stat -f%z "$p")/1e9" | bc) GB)"
      put "$BUCKET/models/$REPO/$pn" "$p"
      parts+=("\"$pn\"")
    done
    rm -rf "$tmp"
    plist="$(IFS=,; echo "${parts[*]}")"
    ENTRIES+=("{\"name\":\"$name\",\"parts\":[$plist]}")
  else
    echo "  ↑ $name"
    put "$BUCKET/models/$REPO/$name" "$real"
    ENTRIES+=("{\"name\":\"$name\"}")
  fi
done

MANIFEST="[$(IFS=,; echo "${ENTRIES[*]}")]"
TMPM="$(mktemp)"; echo "$MANIFEST" > "$TMPM"
wrangler r2 object put "$BUCKET/models/$REPO/manifest.json" --file "$TMPM" --remote --content-type application/json >/dev/null 2>&1
rm -f "$TMPM"
echo "✓ $REPO mirrored ($(echo "$MANIFEST" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') files)"
