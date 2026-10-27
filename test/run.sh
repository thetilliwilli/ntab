#!/bin/sh
# builds the test page into $1 (default /tmp/newtab-test), serves it on :8765 and starts headless Chrome with CDP on :9333
set -e
cd "$(dirname "$0")/.."
OUT=${1:-/tmp/newtab-test}
mkdir -p "$OUT"
cp -r js icons newtab.css test/stub.js "$OUT"/
sed 's#<script type="module" src="js/main.js">#<script src="stub.js"></script>\n&#' newtab.html > "$OUT/test.html"
(cd "$OUT" && python3 -m http.server 8765 >/dev/null 2>&1 &)
google-chrome --headless=new --remote-debugging-port=9333 --user-data-dir="$OUT/profile" --no-first-run about:blank >/dev/null 2>&1 &
sleep 2
echo "ready: http://localhost:8765/test.html, CDP on 9333. Re-run this script's copy step after editing the sources."
