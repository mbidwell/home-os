#!/bin/bash
# Screenshots of every main screen in every theme, using local preview mode (sample data, no network).
# Usage: tools/shots.sh [icons]   Output goes to review/ (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE="$ROOT/tools/.chrome-profile"
PORT="${PORT:-8765}"

shot() { # out url w h
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$PROFILE" \
    --force-device-scale-factor="${DPR:-2}" --window-size="$3,$4" --virtual-time-budget=4000 \
    --screenshot="$1" "$2" >/dev/null 2>&1
}

if [ "${1:-}" = "icons" ]; then
  mkdir -p icons
  DPR=1 shot icons/icon-512.png "file://$ROOT/tools/icon.html?theme=night" 512 512
  # Headless Chrome renders small windows blank, so scale the smaller sizes down from 512.
  sips -z 192 192 icons/icon-512.png --out icons/icon-192.png >/dev/null
  sips -z 180 180 icons/icon-512.png --out icons/apple-touch-icon.png >/dev/null
  for t in blush roast; do
    DPR=1 shot "review/icon-$t.png" "file://$ROOT/tools/icon.html?theme=$t" 512 512
    sips -z 180 180 "review/icon-$t.png" --out "icons/apple-touch-icon-$t.png" >/dev/null
  done
  exit 0
fi

mkdir -p review
(cd .. && python3 -m http.server "$PORT" >/dev/null 2>&1) & SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
BASE="http://localhost:$PORT/$(basename "$ROOT")/"
for theme in night dim blush roast; do
  t=$theme; extra="&clock=7:41"
  [ "$theme" = dim ] && { t=night; extra="&clock=22:40"; }
  for screen in signin home settings; do
    shot "review/$theme-$screen.png" "${BASE}?preview=$screen&theme=$t$extra" 393 852
  done
done
ls review
