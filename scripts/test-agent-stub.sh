#!/usr/bin/env bash
# Deterministic agent loop + sandbox tests — REACTABLE_AGENT_STUB=1, no model,
# no flake. The stub echoes back any user text after "STUB:", so each test
# drives the exact assistant output (tool blocks included) it wants to probe.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4021}"
PASS=0
FAIL=0
ok() { echo "✓ $1"; PASS=$((PASS + 1)); }
bad() { echo "✗ $1${2:+ — $2}"; FAIL=$((FAIL + 1)); }

chat() { # chat <message-json-string> → response body
  curl -sf -X POST "http://127.0.0.1:$PORT/reactable/agent/chat" \
    -H 'content-type: application/json' \
    -d "{\"message\":$1,\"history\":[],\"deck\":\"demo\",\"max_turns\":4}" 2>/dev/null || echo '{}'
}

echo "═══ Agent stub tests (deterministic, no model) ═══"

SERVE_PID=""
cleanup() {
  [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null || true
  rm -f "$ROOT/.reactable/stub-esc" "$ROOT/.reactable/stub-write.txt"
}
trap cleanup EXIT

if command -v lsof >/dev/null; then
  lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
fi

(cd "$ROOT" && REACTABLE_AGENT_STUB=1 PORT="$PORT" just serve >/tmp/reactable-stub-serve.log 2>&1) &
SERVE_PID=$!
for i in $(seq 1 90); do
  curl -sf "http://127.0.0.1:$PORT/reactable/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$PORT/reactable/health" >/dev/null || { bad "nexus health (stub)"; exit 1; }
ok "nexus up with REACTABLE_AGENT_STUB=1"

# ── T1: plain chat, no tools ──
R=$(chat '"hello there"')
echo "$R" | grep -qE '"reply"[[:space:]]*:[[:space:]]*"done"' && echo "$R" | grep -qE '"turns"[[:space:]]*:[[:space:]]*1' \
  && ok "T1 plain chat → reply, 1 turn" || bad "T1 plain chat" "$R"

# ── T2: read_file tool loop (history-preserving recursion) ──
R=$(chat '"STUB:```tool\n{\"name\":\"read_file\",\"args\":{\"path\":\"decks/demo/deck.work\"}}\n```"')
echo "$R" | grep -q '"read_file"' && echo "$R" | grep -qE '"turns"[[:space:]]*:[[:space:]]*2' \
  && ok "T2 read_file tool ran, loop continued" || bad "T2 read_file loop" "$R"

# ── T3: bash allowed prefix (scrubbed env, non-login shell) ──
R=$(chat '"STUB:```tool\n{\"name\":\"bash\",\"args\":{\"cmd\":\"ffmpeg -version\"}}\n```"')
echo "$R" | grep -qi 'ffmpeg version' && ok "T3 bash allowed (ffmpeg)" || bad "T3 bash allowed" "$R"

# ── T4: bare bun blocked (bun x = arbitrary code) ──
R=$(chat '"STUB:```tool\n{\"name\":\"bash\",\"args\":{\"cmd\":\"bun x cowsay hi\"}}\n```"')
echo "$R" | grep -q 'not allowed' && ok "T4 'bun x' blocked" || bad "T4 bun x leaked" "$R"

# ── T5: arbitrary command blocked ──
R=$(chat '"STUB:```tool\n{\"name\":\"bash\",\"args\":{\"cmd\":\"curl http://example.com\"}}\n```"')
echo "$R" | grep -q 'not allowed' && ok "T5 arbitrary cmd blocked" || bad "T5 cmd leaked" "$R"

# ── T6: write_file lands inside sandbox ──
rm -f "$ROOT/.reactable/stub-write.txt"
R=$(chat '"STUB:```tool\n{\"name\":\"write_file\",\"args\":{\"path\":\".reactable/stub-write.txt\",\"content\":\"ok\"}}\n```"')
[ -f "$ROOT/.reactable/stub-write.txt" ] && ok "T6 write_file on disk" || bad "T6 write_file" "$R"

# ── T7: absolute path escape rejected ──
R=$(chat '"STUB:```tool\n{\"name\":\"read_file\",\"args\":{\"path\":\"/etc/passwd\"}}\n```"')
echo "$R" | grep -qiE 'outside sandbox|missing or outside' && ! echo "$R" | grep -q 'root:' \
  && ok "T7 absolute /etc/passwd rejected" || bad "T7 absolute escape" "$R"

# ── T8: ../ traversal rejected ──
R=$(chat '"STUB:```tool\n{\"name\":\"read_file\",\"args\":{\"path\":\"../../../../../etc/passwd\"}}\n```"')
echo "$R" | grep -qiE 'outside sandbox|missing or outside' && ! echo "$R" | grep -q 'root:' \
  && ok "T8 ../ traversal rejected" || bad "T8 traversal escape" "$R"

# ── T9: symlink escape rejected ──
mkdir -p "$ROOT/.reactable"
ln -sfn /etc "$ROOT/.reactable/stub-esc"
R=$(chat '"STUB:```tool\n{\"name\":\"read_file\",\"args\":{\"path\":\".reactable/stub-esc/passwd\"}}\n```"')
echo "$R" | grep -qiE 'outside sandbox|missing or outside' && ! echo "$R" | grep -q 'root:' \
  && ok "T9 symlink escape rejected" || bad "T9 symlink escape" "$R"
rm -f "$ROOT/.reactable/stub-esc"

# ── T10: symlink write escape rejected ──
ln -sfn /tmp "$ROOT/.reactable/stub-esc"
R=$(chat '"STUB:```tool\n{\"name\":\"write_file\",\"args\":{\"path\":\".reactable/stub-esc/reactable-stub-pwn.txt\",\"content\":\"x\"}}\n```"')
if [ -f /tmp/reactable-stub-pwn.txt ]; then
  bad "T10 symlink write escaped to /tmp"
  rm -f /tmp/reactable-stub-pwn.txt
else
  echo "$R" | grep -qi 'outside' && ok "T10 symlink write rejected" || bad "T10 symlink write" "$R"
fi
rm -f "$ROOT/.reactable/stub-esc"

# ── T11: malformed tool block → corrective retry turn ──
R=$(chat '"STUB:```tool\n{this is not json}\n```"')
echo "$R" | grep -qE '"turns"[[:space:]]*:[[:space:]]*2' && ok "T11 malformed block retried once" || bad "T11 malformed retry" "$R"

# ── T12: unknown tool surfaces error, loop survives ──
R=$(chat '"STUB:```tool\n{\"name\":\"rm_rf\",\"args\":{}}\n```"')
echo "$R" | grep -q 'unknown tool' && ok "T12 unknown tool error" || bad "T12 unknown tool" "$R"

echo ""
echo "PASS: $PASS   FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
