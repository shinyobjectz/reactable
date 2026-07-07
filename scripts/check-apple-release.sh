#!/usr/bin/env bash
# Preflight: Developer ID signing + notarization readiness
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/Reactable.app"
TEAM_ID="${APPLE_TEAM_ID:-BJJZ79J5NL}"
IDENTITY="${CODESIGN_IDENTITY:-Developer ID Application: Shane Murphy ($TEAM_ID)}"

for envfile in "$HOME/.workbooks/notary.env" "$ROOT/.env"; do
  [[ -f "$envfile" ]] && { set -a; source "$envfile"; set +a; }
done

echo "→ codesign identity"
security find-identity -v -p codesigning | grep -F "$TEAM_ID" || {
  echo "✘ no Developer ID identity for team $TEAM_ID" >&2
  exit 1
}

if [[ -d "$APP" ]]; then
  echo "→ verify $APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
  spctl -a -t exec -vv "$APP" 2>&1 || true
else
  echo "  (no dist/Reactable.app — run just release first)"
fi

NOTARY_KEY="${APPLE_NOTARY_KEY_PATH:-${APPLE_API_KEY_PATH:-}}"
NOTARY_KEY_ID="${APPLE_NOTARY_KEY_ID:-${APPLE_API_KEY:-}}"
NOTARY_ISSUER="${APPLE_NOTARY_ISSUER:-${APPLE_API_ISSUER:-}}"

echo "→ notarization credentials"
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  echo "  profile: $NOTARY_PROFILE"
elif [[ -n "$NOTARY_KEY" && -n "$NOTARY_KEY_ID" && -n "$NOTARY_ISSUER" ]]; then
  echo "  api key: $NOTARY_KEY_ID"
  [[ -f "$NOTARY_KEY" ]] || { echo "✘ key file missing: $NOTARY_KEY" >&2; exit 1; }
else
  echo "✘ no notary credentials (~/.workbooks/notary.env or NOTARY_PROFILE)" >&2
  exit 1
fi

echo "→ Apple Developer agreements (App Store Connect API probe)"
TMP=$(mktemp -d)
echo "probe" > "$TMP/probe.txt"
NOTARY_ERR=""
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  NOTARY_ERR=$(xcrun notarytool submit "$TMP/probe.txt" --keychain-profile "$NOTARY_PROFILE" --wait 2>&1 || true)
else
  NOTARY_ERR=$(xcrun notarytool submit "$TMP/probe.txt" \
    --key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER" \
    --wait 2>&1 || true)
fi
rm -rf "$TMP"

if echo "$NOTARY_ERR" | grep -q "403"; then
  echo ""
  echo "✘ App Store Connect still reports a missing/expired agreement for team $TEAM_ID"
  echo ""
  echo "This is NOT a signing or API-key bug — Apple blocks the whole team until"
  echo "the Account Holder accepts agreements in BOTH places:"
  echo ""
  echo "  1. https://developer.apple.com/account"
  echo "     → Membership → Agreements (Developer Program License Agreement)"
  echo ""
  echo "  2. https://appstoreconnect.apple.com/agreements"
  echo "     → Business / Agreements, Tax, and Banking (often a separate banner)"
  echo ""
  echo "Common gotchas:"
  echo "  • Accepted on developer.apple.com but not App Store Connect (or vice versa)"
  echo "  • Team member accepted — only Account Holder can sign some agreements"
  echo "  • Propagation delay — can take up to 24h after acceptance"
  echo ""
  echo "If both portals show nothing pending, contact Apple DTS with team $TEAM_ID:"
  echo "  https://developer.apple.com/contact/"
  exit 1
fi

echo "$NOTARY_ERR" | tail -5
echo ""
echo "✓ notarization credentials OK"
