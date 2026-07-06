#!/usr/bin/env bash
# Synthetic take for headless P3/P4/P5 validation (no GUI recording required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="${1:-take-fixture-validation}"
DIR="$ROOT/takes/$ID"
mkdir -p "$DIR/out"

command -v ffmpeg >/dev/null || { echo "ffmpeg required"; exit 1; }

echo "→ fixture take $DIR"

ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=duration=6:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=880:duration=6" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
  "$DIR/stage.mov"

ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0x2244aa:size=640x480:duration=6:rate=30" \
  -f lavfi -i "sine=frequency=440:duration=6" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
  "$DIR/cam.mov"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$DIR/events.jsonl" <<'EOF'
{"t":0.0,"type":"record.start","deck":"demo","sourceKind":"stage"}
{"t":0.05,"type":"capture.stage","sourceKind":"stage","label":"Fixture Stage"}
{"t":0.1,"type":"capture.cam","x":1200,"y":80,"size":160}
{"t":0.5,"type":"slide","idx":0,"id":"welcome"}
{"t":1.2,"type":"click","x":640,"y":360,"button":"left"}
{"t":1.8,"type":"cursor","x":700,"y":400}
{"t":2.5,"type":"slide","idx":1,"id":"local-app"}
{"t":3.1,"type":"click","x":400,"y":300,"button":"left"}
{"t":4.0,"type":"slide","idx":2,"id":"whiteboard"}
{"t":5.5,"type":"record.stop"}
EOF

cat > "$DIR/manifest.json" <<EOF
{
  "capture_target_label": "Fixture Stage",
  "deck": "demo",
  "id": "$ID",
  "recorded_at": "$NOW",
  "resolution": [1280, 720],
  "source_kind": "stage",
  "start_epoch": $(date +%s),
  "tracks": {
    "cam": "cam.mov",
    "events": "events.jsonl",
    "stage": "stage.mov"
  }
}
EOF

cat > "$DIR/take.work" <<EOF
# Take $ID

take do
  id: "$ID"
  deck: "demo"
  source: "stage · Fixture Stage"
  recorded_at: "$NOW"
end

## Tracks

- \`cam.mov\` — full raw webcam
- \`stage.mov\` — stage window
- \`events.jsonl\` — cursor · click · slide
- \`manifest.json\` — machine-readable manifest
EOF

cat > "$DIR/edit.json" <<'EOF'
{
  "trim": { "in": 0.2, "out": 5.8 },
  "speed": 1,
  "zoom": { "enabled": true, "scale": 1.55, "duration": 1.0 },
  "cam": { "pip": true, "x": 0.88, "y": 0.08, "size": 0.14, "mirror": true },
  "style": { "padding": 32, "radius": 18, "background": "#0e0e12", "shadow": true },
  "aspect": "16:9",
  "captions": { "enabled": true }
}
EOF

echo "✓ fixture take ready: $DIR"
