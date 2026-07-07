#!/usr/bin/env bash
# Full reactable validation — P0 through P5 without manual steps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4020}"
PASS=0
FAIL=0

ok() { echo "✓ $1"; PASS=$((PASS + 1)); }
bad() { echo "✗ $1"; FAIL=$((FAIL + 1)); }

echo "═══════════════════════════════════════"
echo " reactable validate-all"
echo "═══════════════════════════════════════"

if [ ! -f "$ROOT/decks/showcase/labs/sample.mp4" ] || [ ! -f "$ROOT/decks/demo/labs/sample.mp4" ]; then
  bash "$ROOT/scripts/gen-lab-samples.sh"
fi

# P0 — Aperture cross-origin spike
echo ""
echo "── P0 spike ──"
if (cd "$ROOT/native" && swift build -c release >/dev/null 2>&1); then
  ok "swift build"
else
  bad "swift build"
fi
if [ -x "$ROOT/native/.build/release/p0-spike" ]; then
  mkdir -p "$ROOT/native/spike-out"
  if (cd "$ROOT/native" && .build/release/p0-spike >/dev/null 2>&1); then
    if [ -f "$ROOT/native/spike-out/stage-window.mp4" ]; then
      ok "p0-spike stage-window.mp4"
    else
      bad "p0-spike output missing"
    fi
  else
    bad "p0-spike run"
  fi
else
  bad "p0-spike binary"
fi

# Nexus API (P1)
echo ""
echo "── P1 nexus / deck ──"
SERVE_PID=""
cleanup() { [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Free port so we hit THIS project's nexus (not a stale sidecar).
if command -v lsof >/dev/null; then
  lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
fi

(cd "$ROOT" && just serve >/tmp/reactable-serve.log 2>&1) &
SERVE_PID=$!
for i in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$PORT/reactable/health" >/dev/null 2>&1 && break
  sleep 0.5
done
if curl -sf "http://127.0.0.1:$PORT/reactable/health" | grep -q '"ok"'; then
  ok "health"
else
  bad "health"
fi
if curl -sf "http://127.0.0.1:$PORT/reactable/deck?slug=demo" | grep -q '"slides"'; then
  ok "deck API"
else
  bad "deck API"
fi
for route in present bar editor agent; do
  if curl -sf "http://127.0.0.1:$PORT/$route" | head -c 200 | grep -qiE 'html|reactable|reveal|editor'; then
    ok "route /$route"
  else
    bad "route /$route"
  fi
done

# P3 — fixture take
echo ""
echo "── P3 capture fixture ──"
bash "$ROOT/scripts/fixture-take.sh" take-fixture-validation
if [ -f "$ROOT/takes/take-fixture-validation/stage.mov" ] && \
   [ -f "$ROOT/takes/take-fixture-validation/events.jsonl" ]; then
  ok "fixture take"
else
  bad "fixture take"
fi
    if bash "$ROOT/scripts/p3-check.sh" >/dev/null 2>&1; then
      ok "just p3"
else
  bad "just p3"
fi

# P4 — composite + editor API
echo ""
echo "── P4 editor + render ──"
if curl -sf "http://127.0.0.1:$PORT/reactable/takes" | grep -q take-fixture; then
  ok "takes list API"
else
  bad "takes list API"
fi
if curl -sf "http://127.0.0.1:$PORT/reactable/takes/take-fixture-validation" | grep -q '"events"'; then
  ok "take detail API"
else
  bad "take detail API"
fi
if python3 "$ROOT/scripts/composite.py" "$ROOT/takes/take-fixture-validation" >/tmp/render.json 2>/dev/null; then
  ok "composite render"
else
  bad "composite render"
fi
if [ -f "$ROOT/takes/take-fixture-validation/out/final.mp4" ]; then
  ok "final.mp4"
  ffprobe -v error -show_entries stream=codec_type,width,height -of default=noprint_wrappers=1 \
    "$ROOT/takes/take-fixture-validation/out/final.mp4" | head -3
else
  bad "final.mp4"
fi
if [ -f "$ROOT/takes/take-fixture-validation/out/final-9x16.mp4" ]; then
  ok "9:16 export"
else
  bad "9:16 export"
fi
if [ -f "$ROOT/takes/take-fixture-validation/out/final-1x1.gif" ]; then
  ok "GIF export"
else
  bad "GIF export"
fi
if curl -sf -X POST "http://127.0.0.1:$PORT/reactable/takes/take-fixture-validation/render" \
    -H 'content-type: application/json' -d '{}' | grep -q '"ok"'; then
  ok "render API"
else
  bad "render API"
fi

# P5 — pipeline
echo ""
echo "── P5 pipeline ──"
if bash "$ROOT/scripts/to-video.sh" take-fixture-validation reactable-demo >/dev/null 2>&1; then
  ok "to-video pipeline"
else
  bad "to-video pipeline"
fi
MONO="$(cd "$ROOT/../.." && pwd)"
if [ -f "$MONO/videos/reactable-demo/video.work" ] && [ -f "$MONO/videos/reactable-demo/out/final.mp4" ]; then
  ok "video.work + out/final.mp4"
else
  bad "video.work + out/final.mp4"
fi

# Goals checklist (automated spot-checks)
echo ""
echo "── Goals spot-check ──"
grep -q 'iframe' "$ROOT/decks/demo/deck.work" && ok "deck slide types" || bad "deck slide types"
grep -q 'zoompan' "$ROOT/scripts/composite.py" && ok "auto-zoom renderer" || bad "auto-zoom renderer"
grep -q 'pip' "$ROOT/scripts/composite.py" && ok "cam PIP composite" || bad "cam PIP composite"
[ -f "$ROOT/native/Sources/Reactable/InputMonitor.swift" ] && ok "cursor/click capture" || bad "cursor/click capture"
[ -f "$ROOT/native/Sources/Reactable/CamBubble.swift" ] && ok "cam bubble" || bad "cam bubble"
[ -f "$ROOT/native/Sources/Reactable/GlobalHotkeys.swift" ] && ok "global hotkeys module" || bad "global hotkeys module"
[ -f "$ROOT/native/Sources/Reactable/CaptureTarget.swift" ] && ok "all capture sources" || bad "all capture sources"

echo ""
echo "── CLI + deck DSL ──"
if command -v bun >/dev/null; then
  if bun run "$ROOT/cli/bin/reactable.ts" decks validate demo >/dev/null 2>&1; then
    ok "cli decks validate"
  else
    bad "cli decks validate"
  fi
  if grep -q 'script do' "$ROOT/decks/demo/deck.work"; then
    ok "deck scripts block"
  else
    bad "deck scripts block"
  fi
  if curl -sf -X POST "http://127.0.0.1:$PORT/reactable/exec" \
      -H 'content-type: application/json' \
      -d '{"deck":"demo","on":"deck.open","id":"deck-open"}' | grep -q '"ok"'; then
    ok "exec API"
  else
    bad "exec API"
  fi
  if curl -sf "http://127.0.0.1:$PORT/reactable/labs/counter.html" | grep -q 'Local app'; then
    ok "labs API"
  else
    bad "labs API"
  fi
  if curl -sfI "http://127.0.0.1:$PORT/reactable/labs/sample.mp4?deck=showcase" | grep -qi 'video/mp4'; then
    ok "labs sample.mp4"
  else
    bad "labs sample.mp4 (run scripts/gen-lab-samples.sh)"
  fi
  if curl -sf -X POST "http://127.0.0.1:$PORT/reactable/stage" \
      -H 'content-type: application/json' \
      -d '{"action":"open","deck":"demo"}' | grep -q '"ok"'; then
    ok "stage command API"
  else
    bad "stage command API"
  fi
  if curl -sf "http://127.0.0.1:$PORT/reactable/deck?slug=demo" | grep -q 'work-prose\|"type":"iframe"'; then
    ok "deck work slides compiled"
  else
    bad "deck work slides compiled"
  fi
  if bun run "$ROOT/cli/bin/reactable.ts" tools doctor 2>/dev/null | grep -q 'reactable-tools'; then
    ok "tools doctor"
  else
    bad "tools doctor (run: just tools)"
  fi
  if bash "$ROOT/scripts/smoke-mlx.sh" take-fixture-validation >/tmp/reactable-mlx-smoke.log 2>&1; then
    ok "mlx smoke (stt/tts/edit)"
  else
    bad "mlx smoke — see /tmp/reactable-mlx-smoke.log"
  fi
  if bun run "$ROOT/cli/bin/reactable.ts" har capture https://example.com --project validate >/dev/null 2>&1; then
    ok "har capture"
  else
    bad "har capture"
  fi
  if curl -sf "http://127.0.0.1:$PORT/reactable/har?project=validate" | grep -q '"ok"'; then
    ok "har API"
  else
    bad "har API"
  fi
  if bun run "$ROOT/cli/bin/reactable.ts" takes hf init take-fixture-validation >/dev/null 2>&1 && \
     [ -f "$ROOT/takes/take-fixture-validation/hyperframes/compositions/take-edit.html" ]; then
    ok "hf scaffold"
  else
    bad "hf scaffold"
  fi
else
  bad "bun missing (cli)"
fi

echo ""
echo "═══════════════════════════════════════"
echo " PASS: $PASS   FAIL: $FAIL"
echo "═══════════════════════════════════════"
[ "$FAIL" -eq 0 ]
