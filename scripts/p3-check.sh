#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
latest="$(ls -td "$ROOT/takes"/take-* 2>/dev/null | head -1 || true)"
if [ -z "$latest" ]; then
  echo "No takes yet — run: just fixture"
  exit 1
fi
echo "take: $latest"
test -f "$latest/stage.mov" && echo "✓ stage.mov" || { echo "✗ stage.mov"; exit 1; }
test -f "$latest/events.jsonl" && echo "✓ events.jsonl" || { echo "✗ events.jsonl"; exit 1; }
test -f "$latest/manifest.json" && echo "✓ manifest.json" || { echo "✗ manifest.json"; exit 1; }
test -f "$latest/take.work" && echo "✓ take.work" || { echo "✗ take.work"; exit 1; }
if command -v ffprobe >/dev/null; then
  echo "--- stage.mov ---"
  ffprobe -v error -show_entries stream=codec_type,duration -of default=noprint_wrappers=1 "$latest/stage.mov" | head -4
  if [ -f "$latest/cam.mov" ]; then
    echo "--- cam.mov ---"
    ffprobe -v error -show_entries stream=codec_type,duration -of default=noprint_wrappers=1 "$latest/cam.mov" | head -4
  fi
fi
python3 <<PY
import json
from collections import Counter
from pathlib import Path
latest = Path("$latest")
m = json.load(open(latest / "manifest.json"))
print("--- manifest source ---")
print(m.get("source_kind", "?"), m.get("capture_target_label", ""))
print("--- event types ---")
c = Counter()
for line in open(latest / "events.jsonl"):
    c[json.loads(line).get("type", "?")] += 1
for t, n in sorted(c.items()):
    print(f"  {t}: {n}")
PY
echo "--- events (last 5) ---"
tail -5 "$latest/events.jsonl"
