#!/usr/bin/env bash
# Full build: textures -> soundtrack -> frames -> final MP4 (out/bueno_martusya.mp4)
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}"

[ -f assets/Rubik.ttf ] || curl -sSL -o assets/Rubik.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/rubik/Rubik%5Bwght%5D.ttf"
python3 tools/prep_assets.py
node tools/render.js stills 0 >/dev/null      # writes out/events.json (event times for the audio)
python3 tools/audio.py
node tools/render.js video
ffmpeg -y -loglevel error -i out/video.mp4 -i out/audio.wav \
  -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart out/bueno_martusya.mp4
echo "done: out/bueno_martusya.mp4"
