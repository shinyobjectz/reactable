#!/usr/bin/env bash
# Smoke local agent stack — Nexus routes + reactable-tools agent-status (LLM optional).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4020}"
PASS=0
FAIL=0
ok() { echo "✓ $1"; PASS=$((PASS + 1)); }
bad() { echo "✗ $1${2:+ — $2}"; FAIL=$((FAIL + 1)); }

if [ ! -x "$ROOT/dist/reactable-tools" ]; then
  bash "$ROOT/scripts/build-tools.sh"
fi

echo "═══ Local agent smoke ═══"

STATUS=$("$ROOT/dist/reactable-tools" agent-status 2>&1 || true)
if echo "$STATUS" | grep -q '"engine"'; then ok "sidecar agent-status"; else bad "sidecar agent-status" "$STATUS"; fi

SERVE_PID=""
cleanup() { [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null || true; }
trap cleanup EXIT

if command -v lsof >/dev/null; then
  lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
fi

(cd "$ROOT" && just serve >/tmp/reactable-agent-serve.log 2>&1) &
SERVE_PID=$!
for i in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$PORT/reactable/health" >/dev/null 2>&1 && break
  sleep 0.5
done

if curl -sf "http://127.0.0.1:$PORT/reactable/agent/status" | grep -q '"backend"'; then
  ok "GET /reactable/agent/status"
else
  bad "GET /reactable/agent/status"
fi

if curl -sf "http://127.0.0.1:$PORT/agent" | grep -qiE 'Reactable Agent|id="log"|agent/status'; then
  ok "route /agent"
else
  bad "route /agent"
fi

if curl -sf "http://127.0.0.1:$PORT/reactable/projects/list" | grep -q '"projects"'; then
  ok "GET /reactable/projects/list"
else
  bad "GET /reactable/projects/list"
fi

echo ""
echo "PASS: $PASS   FAIL: $FAIL"
echo "(Full offline chat requires the model: reactable agent pull)"
[ "$FAIL" -eq 0 ]
