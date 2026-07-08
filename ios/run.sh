#!/bin/bash
# Build the Reactable pocket-studio app into a simulator .app, install, launch.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DEV="${1:-Reactable}"
BID="com.shinyobjectz.reactable"
APP="$DIR/build/Reactable.app"
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"

echo "→ compiling…"
rm -rf "$APP"; mkdir -p "$APP"
xcrun swiftc -sdk "$SDK" -target arm64-apple-ios17.0-simulator -parse-as-library -O \
  -o "$APP/Reactable" "$DIR/Reactable.swift"
cp "$DIR/Info.plist" "$APP/Info.plist"
xcrun simctl bootstatus "$DEV" -b >/dev/null 2>&1 || true
xcrun simctl install "$DEV" "$APP"
xcrun simctl launch "$DEV" "$BID"
echo "✓ done"
