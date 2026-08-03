#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$ROOT_DIR/.cache/tools"
JRE_ROOT="$TOOLS_DIR/jre21"

java_major_version() {
  "$1" -version 2>&1 | awk -F'[".]' '/version/ {
    if ($2 == "1") {
      print $3
    } else {
      print $2
    }
    exit
  }'
}

if command -v java >/dev/null 2>&1; then
  SYSTEM_JAVA_MAJOR="$(java_major_version "$(command -v java)")"
  if [[ "$SYSTEM_JAVA_MAJOR" =~ ^[0-9]+$ ]] && (( SYSTEM_JAVA_MAJOR >= 21 )); then
    exit 0
  fi
fi

if [[ -x "$JRE_ROOT/bin/java" ]]; then
  LOCAL_JAVA_MAJOR="$(java_major_version "$JRE_ROOT/bin/java")"
  if [[ "$LOCAL_JAVA_MAJOR" =~ ^[0-9]+$ ]] && (( LOCAL_JAVA_MAJOR >= 21 )); then
    exit 0
  fi
fi

mkdir -p "$TOOLS_DIR"
JRE_URL="$(curl -fsSL 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&heap_size=normal&image_type=jre&jvm_impl=hotspot&os=linux&project=jdk&vendor=eclipse' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(j[0].binary.package.link)})")"
ARCHIVE_PATH="$TOOLS_DIR/jre21.tar.gz"

curl -fL "$JRE_URL" -o "$ARCHIVE_PATH"
rm -rf "$JRE_ROOT"
tar -xzf "$ARCHIVE_PATH" -C "$TOOLS_DIR"
FOUND_DIR="$(find "$TOOLS_DIR" -maxdepth 1 -type d -name 'jdk-*-jre' | head -n 1)"
if [[ -z "$FOUND_DIR" ]]; then
  echo "Failed to locate extracted JRE directory." >&2
  exit 1
fi
mv "$FOUND_DIR" "$JRE_ROOT"
