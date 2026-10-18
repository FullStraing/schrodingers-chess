#!/bin/bash
# ES modules need to be served over http, not opened from the filesystem.
# Python is already on every Mac, so there is nothing to install.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8777}"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 0.6
echo "Schrödinger's Chess running at http://127.0.0.1:$PORT/"
echo "Press Ctrl-C to stop."
command -v open >/dev/null && open "http://127.0.0.1:$PORT/"
wait $SERVER
