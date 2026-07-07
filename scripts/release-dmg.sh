#!/usr/bin/env bash
# Build, sign, notarize, and package Reactable.dmg
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native"
DIST="$ROOT/dist"
APP="$DIST/Reactable.app"
DMG="$DIST/Reactable.dmg"
TEAM_ID="${APPLE_TEAM_ID:-BJJZ79J5NL}"
IDENTITY="${CODESIGN_IDENTITY:-Developer ID Application: Shane Murphy ($TEAM_ID)}"
ENTITLEMENTS="$NATIVE/Resources/Reactable.entitlements"

# Notarization: keychain profile OR App Store Connect API key (see ~/.workbooks/notary.env)
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
for envfile in "$HOME/.workbooks/notary.env" "$ROOT/.env"; do
  if [[ -f "$envfile" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$envfile"; set +a
  fi
done
NOTARY_KEY="${APPLE_NOTARY_KEY_PATH:-${APPLE_API_KEY_PATH:-}}"
NOTARY_KEY_ID="${APPLE_NOTARY_KEY_ID:-${APPLE_API_KEY:-}}"
NOTARY_ISSUER="${APPLE_NOTARY_ISSUER:-${APPLE_API_ISSUER:-}}"

sign_bin() {
  local target="$1"
  codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" \
    "$target"
}

notarize() {
  local artifact="$1"
  if [[ -n "$NOTARY_PROFILE" ]]; then
    echo "→ notarizing via keychain profile: $NOTARY_PROFILE"
    xcrun notarytool submit "$artifact" --keychain-profile "$NOTARY_PROFILE" --wait
  elif [[ -n "$NOTARY_KEY" && -n "$NOTARY_KEY_ID" && -n "$NOTARY_ISSUER" ]]; then
    echo "→ notarizing via App Store Connect API key ($NOTARY_KEY_ID)"
    xcrun notarytool submit "$artifact" \
      --key "$NOTARY_KEY" \
      --key-id "$NOTARY_KEY_ID" \
      --issuer "$NOTARY_ISSUER" \
      --wait
  else
    echo "→ skip notarization (no NOTARY_PROFILE or APPLE_NOTARY_* credentials)" >&2
    echo "  Gatekeeper will block until notarized. Run:" >&2
    echo "    xcrun notarytool store-credentials reactable --apple-id YOU@icloud.com --team-id $TEAM_ID" >&2
    return 1
  fi
}

echo "→ lab sample videos"
bash "$ROOT/scripts/gen-lab-samples.sh"

echo "→ reactable-tools sidecar"
bash "$ROOT/scripts/build-tools.sh"

echo "→ building burrito nexus sidecar"
bash "$ROOT/scripts/build-sidecar.sh"

echo "→ building release binary"
cd "$NATIVE"
swift build -c release

echo "→ bundling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/reactable"

cp "$NATIVE/.build/release/reactable" "$APP/Contents/MacOS/"
cp "$ROOT/dist/reactable-nexus" "$APP/Contents/MacOS/reactable-nexus"
cp "$ROOT/dist/reactable-tools" "$APP/Contents/MacOS/reactable-tools" 2>/dev/null || true
cp "$NATIVE/Resources/Info.plist" "$APP/Contents/"
cp "$NATIVE/Resources/AppIcon.icns" "$APP/Contents/Resources/"
cp "$NATIVE/Resources/AppIcon.png" "$APP/Contents/Resources/"
chmod +x "$APP/Contents/MacOS/reactable" "$APP/Contents/MacOS/reactable-nexus"

# Project payload for offline /Applications install
rsync -a \
  --exclude native --exclude web --exclude dist --exclude sidecar --exclude .git --exclude takes --exclude node_modules \
  --exclude 'native/.build' --exclude '*.mov' \
  --include 'decks/*/labs/sample.mp4' --exclude '*.mp4' \
  "$ROOT/" "$APP/Contents/Resources/reactable/"

echo "→ signing (Developer ID + hardened runtime)"
# Inner binaries first, then bundle — required for notarization
sign_bin "$APP/Contents/MacOS/reactable-nexus"
[ -x "$APP/Contents/MacOS/reactable-tools" ] && sign_bin "$APP/Contents/MacOS/reactable-tools"
sign_bin "$APP/Contents/MacOS/reactable"
sign_bin "$APP"

codesign --verify --deep --strict --verbose=2 "$APP"
spctl -a -t exec -vv "$APP" 2>&1 || true

echo "→ creating dmg"
rm -f "$DMG" "$DIST/Reactable-temp.dmg"
STAGE="$DIST/dmg-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

hdiutil create -volname "Reactable" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"

codesign --force --timestamp --sign "$IDENTITY" "$DMG"

if notarize "$DMG"; then
  echo "→ stapling notarization ticket"
  xcrun stapler staple "$DMG"
  xcrun stapler staple "$APP"
  spctl -a -t open -vv "$DMG" 2>&1 || true
  spctl -a -t exec -vv "$APP" 2>&1 || true
else
  if [[ "${SKIP_NOTARY:-}" == "1" ]]; then
    echo "⚠ SKIP_NOTARY=1 — uploading signed-but-unnotarized build" >&2
  else
    echo "✘ notarization required for Gatekeeper — fix credentials/agreement, then re-run" >&2
    echo "  https://developer.apple.com/account → accept pending agreements" >&2
    exit 1
  fi
fi

mkdir -p "$DIST"

echo "→ uploading dmg to R2"
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "✘ CLOUDFLARE_API_TOKEN not set — export it, then re-run upload:" >&2
  echo "  cd web && wrangler r2 object put reactable-downloads/Reactable.dmg \\" >&2
  echo "    --file=\"$DMG\" --content-type=application/x-apple-diskimage --remote" >&2
  exit 1
fi
(
  cd "$ROOT/web"
  wrangler r2 object put reactable-downloads/Reactable.dmg \
    --file="$DMG" \
    --content-type=application/x-apple-diskimage \
    --remote
)

# Avoid duplicate Launchpad entries — install from DMG only
rm -rf "$APP"

echo ""
echo "✓ Reactable.dmg"
echo "  $DMG"
echo ""
echo "Install: open $DMG → drag to Applications"
echo "Download: https://reactable.app/download/Reactable.dmg"
echo "Deploy:   cd web && wrangler deploy"
