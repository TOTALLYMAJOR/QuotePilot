#!/usr/bin/env bash
set -euo pipefail

QP_FFMPEG_BIN="${QP_FFMPEG_BIN:-ffmpeg}"
QP_VIDEO_INPUT="${1:-public/videos/quote-pilot-commercial.mp4}"
QP_PHONE_OUTPUT="${2:-public/videos/quote-pilot-commercial-phone.mp4}"

"${QP_FFMPEG_BIN}" \
  -y \
  -i "${QP_VIDEO_INPUT}" \
  -map 0:v:0 \
  -map 0:a:0 \
  -vf "scale=720:-2:flags=lanczos" \
  -c:v libx264 \
  -preset slow \
  -crf 26 \
  -profile:v high \
  -level 3.1 \
  -pix_fmt yuv420p \
  -c:a aac \
  -b:a 96k \
  -movflags +faststart \
  "${QP_PHONE_OUTPUT}"
