#!/usr/bin/env bash
# Generate decks/*/labs/sample.mp4 for video slide demos (small H.264, bundled in release).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "gen-lab-samples: ffmpeg required" >&2
  exit 1
fi

tmp="$(mktemp "${TMPDIR:-/tmp}/reactable-sample.XXXXXX.mp4")"
trap 'rm -f "$tmp"' EXIT

ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=size=1280x720:rate=30:duration=3" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an \
  "$tmp"

for slug in showcase demo; do
  dir="$ROOT/decks/$slug/labs"
  mkdir -p "$dir"
  cp "$tmp" "$dir/sample.mp4"
  echo "→ $dir/sample.mp4 ($(wc -c < "$dir/sample.mp4" | tr -d ' ') bytes)"
done
