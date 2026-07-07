#!/usr/bin/env bash
# Mirror an HF-cached MLX model to the reactable-downloads R2 bucket under
# models/<repo>/. Files over R2's 300 MiB wrangler-put limit are split into
# parts; the client (reactable-tools pull) reassembles them. Writes a
# manifest.json describing each file's parts.
#   scripts/upload-model-r2.sh mlx-community/gemma-4-e4b-it-4bit
# NOTE: deliberately no `-e` — a single transient wrangler failure must not
# abort the whole tier (that skips the manifest and leaves it half-uploaded).
# put() retries instead.
set -uo pipefail
REPO="${1:?usage: upload-model-r2.sh <hf-repo>}"
BUCKET="reactable-downloads"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-6d4b74aeb10f455fbf88141901e7595d}"
CHUNK=290000000   # 290 MB, under wrangler's 300 MiB per-object cap

CACHE="$HOME/.cache/huggingface/hub/models--${REPO//\//--}"
SNAP="$(find "$CACHE/snapshots" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1)"
[ -n "$SNAP" ] || { echo "not cached: $REPO (run: reactable agent pull)"; exit 1; }

# Skip objects already served (resumable across restarts); else upload.
# Uses a 1-byte GET range (the worker serves GET, not HEAD).
put() {
  local key="$1" file="$2"
  if curl -sf -r 0-0 "https://reactable.app/download/${key#reactable-downloads/}" -o /dev/null 2>/dev/null; then
    echo "    (already in R2, skip)"
    return 0
  fi
  local try
  for try in 1 2 3 4 5; do
    if wrangler r2 object put "$key" --file "$file" --remote >/dev/null 2>&1; then
      return 0
    fi
    echo "    (put failed, retry $try/5)…"
    sleep $((try * 3))
  done
  echo "    ✗ FAILED after retries: $key"
  return 1
}

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
