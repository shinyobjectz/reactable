#!/usr/bin/env bash
# Headless MLX smoke — Moonshine STT, Kokoro TTS, speech edit lane.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/dist/reactable-tools"
TAKE="${1:-take-fixture-validation}"
PASS=0
FAIL=0

ok() { echo "✓ $1"; PASS=$((PASS + 1)); }
bad() { echo "✗ $1${2:+ — $2}"; FAIL=$((FAIL + 1)); }

if [ ! -x "$TOOLS" ]; then
  echo "building reactable-tools…"
  bash "$ROOT/scripts/build-tools.sh"
fi

echo "═══ MLX smoke ($TAKE) ═══"
bash "$ROOT/scripts/fixture-take.sh" "$TAKE" >/dev/null

DOC="$($TOOLS doctor 2>/dev/null)"
python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d['ok'] and any(t['name']=='mlx-stt' and t['ok'] for t in d['tools']) and any(t['name']=='mlx-tts' and t['ok'] for t in d['tools'])" "$DOC" \
  && ok "sidecar doctor" || bad "sidecar doctor"

bun run "$ROOT/cli/bin/reactable.ts" tools doctor >/dev/null 2>&1 && ok "cli tools doctor" || bad "cli tools doctor"
bun run "$ROOT/cli/bin/reactable.ts" tts doctor >/dev/null 2>&1 && ok "tts doctor" || bad "tts doctor"

TTS_OUT="$(bun run "$ROOT/cli/bin/reactable.ts" tts speak --text "MLX smoke test." -o /tmp/reactable-smoke-tts.wav 2>&1)"
echo "$TTS_OUT" | grep -q '"ok": true' && [ -s /tmp/reactable-smoke-tts.wav ] && ok "tts speak" || bad "tts speak" "$TTS_OUT"

WAV="$ROOT/takes/$TAKE/audio-smoke.wav"
$TOOLS extract-audio "$ROOT/takes/$TAKE/stage.mov" "$WAV" >/dev/null 2>&1 && [ -s "$WAV" ] && ok "extract-audio" || bad "extract-audio"

TX="$ROOT/takes/$TAKE/transcript-smoke.json"
$TOOLS transcribe "$WAV" --output "$TX" >/dev/null 2>&1 && [ -s "$TX" ] && ok "sidecar transcribe" || bad "sidecar transcribe"

rm -f "$ROOT/takes/$TAKE/transcript.json" "$ROOT/takes/$TAKE/out/captions.vtt"
TR="$(bun run "$ROOT/cli/bin/reactable.ts" takes transcribe "$TAKE" 2>&1)"
echo "$TR" | grep -q '"ok": true' && ok "cli takes transcribe" || bad "cli takes transcribe" "$TR"
[ -s "$ROOT/takes/$TAKE/transcript.json" ] && ok "transcript.json" || bad "transcript.json"

RF="$(bun run "$ROOT/cli/bin/reactable.ts" edit remove-filler "$TAKE" 2>&1)"
echo "$RF" | grep -q '"ok": true' && ok "edit remove-filler" || bad "edit remove-filler" "$RF"

TS="$(bun run "$ROOT/cli/bin/reactable.ts" edit trim-silence "$TAKE" 2>&1)"
echo "$TS" | grep -q '"ok": true' && ok "edit trim-silence" || bad "edit trim-silence" "$TS"

bun run "$ROOT/cli/bin/reactable.ts" edit captions "$TAKE" >/dev/null 2>&1 \
  && [ -s "$ROOT/takes/$TAKE/out/captions.vtt" ] && ok "edit captions" || bad "edit captions"

$TOOLS vad-detect "$WAV" 2>/dev/null | grep -q '"ok"' && ok "vad-detect" || bad "vad-detect"

python3 <<PY && ok "transcript engine" || bad "transcript engine"
import json
t = json.load(open("$ROOT/takes/$TAKE/transcript.json"))
assert t.get("engine", "").startswith("moonshine-mlx")
print("  engine:", t.get("engine"))
print("  text:", repr(t.get("text", "")[:80]))
PY

echo ""
echo "PASS: $PASS   FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
