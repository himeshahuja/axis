#!/usr/bin/env bash
# Finishing pass: masters the Remotion mix and muxes it with the picture.
#   video: broadcast-range yuv420p H.264 High (Remotion's JPEG frames are full-range)
#   audio: two-pass loudness normalisation to -14 LUFS, then a 4x-oversampled limiter so
#          the true peak stays under -1 dBTP; AAC 256k, 48 kHz stereo; faststart.
# Usage: bash scripts/finalize.sh <video.mp4> <mix.wav> <out.mp4>
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:-out/preview/picture.mp4}"
A="${2:-out/preview/mix.wav}"
OUT="${3:-out/axis-launch-film.mp4}"
MASTER="out/preview/master.wav"
TARGET_I=-14
TARGET_TP=-1.5   # loudnorm's own ceiling; the limiter below guarantees -1 dBTP

# pass 1: measure
J=$(ffmpeg -hide_banner -nostats -i "$A" -af "loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$J" | python3 -I -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
# pass 2: apply (linear when possible), then limit at 4x oversampling
ffmpeg -v error -y -i "$A" -af "loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true,aresample=192000,alimiter=limit=0.87:attack=1:release=60:level=false,aresample=48000:resampler=soxr" -ar 48000 -ac 2 -c:a pcm_s24le "$MASTER"

ffmpeg -v error -y -i "$V" -i "$MASTER" -map 0:v:0 -map 1:a:0 \
  -vf "scale=in_range=pc:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p" \
  -c:v libx264 -preset slow -crf 16 -profile:v high -level 4.1 -r 30 \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart "$OUT"
echo "$OUT"
