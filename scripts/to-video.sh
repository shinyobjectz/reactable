#!/usr/bin/env bash
# Wire a rendered take into the monorepo YouTube pipeline (video.work + Kanban card).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONO="$(cd "$ROOT/../.." && pwd)"
TAKE_ID="${1:-}"
VIDEO_SLUG="${2:-reactable-demo}"

if [ -z "$TAKE_ID" ]; then
  TAKE_ID="$(ls -td "$ROOT/takes"/take-* 2>/dev/null | head -1 | xargs basename 2>/dev/null || true)"
fi
if [ -z "$TAKE_ID" ]; then
  echo "No take found — run scripts/fixture-take.sh first"
  exit 1
fi

TAKE_DIR="$ROOT/takes/$TAKE_ID"
FINAL="$TAKE_DIR/out/final.mp4"
if [ ! -f "$FINAL" ]; then
  echo "Missing render — run: python3 scripts/composite.py $TAKE_DIR"
  exit 1
fi

VID_DIR="$MONO/videos/$VIDEO_SLUG"
mkdir -p "$VID_DIR/raw" "$VID_DIR/comp" "$VID_DIR/out"
cp "$FINAL" "$VID_DIR/raw/reactable-take.mp4"
cp "$TAKE_DIR/out/captions.srt" "$VID_DIR/comp/captions.srt" 2>/dev/null || true
ln -sf "$VID_DIR/raw/reactable-take.mp4" "$VID_DIR/out/final.mp4" 2>/dev/null || cp "$FINAL" "$VID_DIR/out/final.mp4"

if [ ! -f "$VID_DIR/video.work" ]; then
  sed "s/@@TITLE@@/Reactable demo/; s/@@SLUG@@/$VIDEO_SLUG/" "$MONO/videos/_template/video.work" > "$VID_DIR/video.work"
  cat >> "$VID_DIR/video.work" <<EOF

## Related

- [[projects/reactable]] — native recorder + stage + editor
- Take: \`$TAKE_ID\`

## Take manifest

\`\`\`json meta
$(cat "$TAKE_DIR/manifest.json")
\`\`\`
EOF
fi

echo "✓ pipeline wired"
echo "  take:  $TAKE_DIR"
echo "  video: $VID_DIR/video.work"
echo "  out:   $VID_DIR/out/final.mp4"
