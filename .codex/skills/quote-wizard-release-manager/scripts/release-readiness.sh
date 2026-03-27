#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

WITH_CWV="false"
HIGH_RISK="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-cwv)
      WITH_CWV="true"
      shift
      ;;
    --high-risk)
      HIGH_RISK="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: release-readiness.sh [--with-cwv] [--high-risk]" >&2
      exit 1
      ;;
  esac
done

echo "== Release readiness check =="

echo "Branch: $(git rev-parse --abbrev-ref HEAD)"
echo "Working tree status:"
git status --short

echo "==> Running lane:quick"
npm run lane:quick

echo "==> Running lane:core"
npm run lane:core

if [[ "$HIGH_RISK" == "true" ]]; then
  echo "==> Running lane:firebase-auth-rules"
  npm run lane:firebase-auth-rules

  echo "==> Running lane:authoritative-pricing"
  npm run lane:authoritative-pricing
fi

if [[ "$WITH_CWV" == "true" ]]; then
  echo "==> Running CWV smoke gate"
  npm run check:perf:cwv
fi

echo "==> Most recent CHANGELOG heading"
awk '/^## / {print; exit}' CHANGELOG.md || true

echo "Release readiness checks completed successfully."
