#!/usr/bin/env bash
# Contact sheet: every Nth frame of a rendered film, tiled, each labelled with its frame
# number and time. Usage: bash scripts/contact-sheet.sh [video] [every-n-frames] [out.png]
set -euo pipefail
cd "$(dirname "$0")/.."
IN="${1:-out/preview/axis-preview.mp4}"
EVERY="${2:-45}"
OUT="${3:-out/preview/contact-sheet.png}"
mkdir -p "$(dirname "$OUT")"
N=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$IN" | tr -dc 0-9)
COUNT=$(( (N + EVERY - 1) / EVERY ))
COLS=6
ROWS=$(( (COUNT + COLS - 1) / COLS ))
ffmpeg -v error -y -i "$IN" -vf "select='not(mod(n\,${EVERY}))',scale=480:-2,drawtext=text='f%{n}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6,tile=${COLS}x${ROWS}:padding=6:margin=6:color=0x222222" -fps_mode vfr -frames:v 1 "$OUT"
echo "$OUT ($N frames, every $EVERY)"
