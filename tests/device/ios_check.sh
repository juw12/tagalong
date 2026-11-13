#!/bin/bash
# Install a simulator build of the iOS app, open it and read the first screen.
#   bash tests/device/ios_check.sh <App.app> <evidence folder>
# Runs in the Device check workflow on a free macOS runner. The released IPA is a device build and cannot
# run in a simulator, so this builds the same project for the simulator. It is not a check on a physical iPhone.
set -uo pipefail

APP="$1"
EVIDENCE="$2"
APP_ID="io.github.juw12.tagalong"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$EVIDENCE"
FAILED=0

report() {
  if [ "$2" = "0" ]; then
    echo "  ok   $1"
    echo "ok   $1" >> "$EVIDENCE/result.txt"
  else
    echo "  FAIL $1  -> ${3:-}"
    echo "FAIL $1 -> ${3:-}" >> "$EVIDENCE/result.txt"
    FAILED=1
  fi
}

: > "$EVIDENCE/result.txt"

# Newest available iPhone simulator.
read -r UDID DEVICE RUNTIME < <(xcrun simctl list devices available -j | python3 -c '
import json, re, sys
devices = json.load(sys.stdin)["devices"]
found = []
for runtime, entries in devices.items():
    match = re.search(r"iOS-(\d+)-(\d+)", runtime)
    if not match:
        continue
    for entry in entries:
        if entry["name"].startswith("iPhone"):
            found.append((int(match.group(1)), int(match.group(2)), entry["udid"], entry["name"].replace(" ", "_")))
found.sort()
major, minor, udid, name = found[-1]
print(udid, name, f"{major}.{minor}")
')
echo "Simulator: $DEVICE, iOS $RUNTIME ($UDID)"
echo "simulator: $DEVICE, iOS $RUNTIME" >> "$EVIDENCE/result.txt"

xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b > /dev/null

xcrun simctl install "$UDID" "$APP"
report "the simulator build installs" "$?" "simctl install failed"

VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Info.plist")
[[ "$VERSION" == 2.* ]]
report "installed version is 2.x ($VERSION)" "$?" "$VERSION"

xcrun simctl launch "$UDID" "$APP_ID" > "$EVIDENCE/launch.txt" 2>&1
report "the app launches" "$?" "$(cat "$EVIDENCE/launch.txt")"

# Wait for the first screen and read it from the screenshot.
FOUND=1
for attempt in $(seq 1 12); do
  sleep 10
  xcrun simctl io "$UDID" screenshot "$EVIDENCE/ios-1-home.png" > /dev/null 2>&1
  swift "$HERE/ocr.swift" "$EVIDENCE/ios-1-home.png" > "$EVIDENCE/ios-1-home.txt" 2> "$EVIDENCE/ocr-error.txt"
  if grep -qiE "look around a sample trip|start a trip|open this trip" "$EVIDENCE/ios-1-home.txt"; then
    FOUND=0
    break
  fi
done
report "the first screen renders (Start a trip / sample trip)" "$FOUND" "$(head -c 300 "$EVIDENCE/ios-1-home.txt" | tr '\n' '|')"

xcrun simctl spawn "$UDID" launchctl list | grep -q "$APP_ID"
report "the app is still running" "$?" "process not found"

xcrun simctl shutdown "$UDID" > /dev/null 2>&1
cat "$EVIDENCE/result.txt"
exit "$FAILED"
