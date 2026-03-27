#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

MODE="full"
WITH_CWV="false"
PROFILE=""
LANE=""

usage() {
  cat <<'USAGE'
Usage: run-maintainer-checks.sh [--quick] [--build-only] [--preflight] [--core] [--high-risk] [--lane <lane>] [--with-cwv]

Options:
  --quick       Run lightweight checks (environment validation only)
  --build-only  Run build + governance + bundle checks
  --preflight   Run lane:quick profile
  --core        Run preflight + lane:core profile
  --high-risk   Run preflight + core + Firebase auth/rules + authoritative pricing lanes
  --lane        Run one explicit orchestration lane (lane:quick/lane:core/lane:firebase-auth-rules/lane:authoritative-pricing/lane:release)
  --with-cwv    Also run Lighthouse CWV smoke gate
  -h, --help    Show this help message
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)
      MODE="quick"
      shift
      ;;
    --build-only)
      MODE="build-only"
      shift
      ;;
    --preflight)
      PROFILE="preflight"
      shift
      ;;
    --core)
      PROFILE="core"
      shift
      ;;
    --high-risk)
      PROFILE="high-risk"
      shift
      ;;
    --lane)
      if [[ -z "${2:-}" ]]; then
        echo "Missing value for --lane" >&2
        usage
        exit 1
      fi
      LANE="$2"
      shift 2
      ;;
    --with-cwv)
      WITH_CWV="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

run_lane() {
  local lane="$1"
  echo "==> Running ${lane}"
  npm run "$lane"
}

if [[ -n "$LANE" ]]; then
  run_lane "$LANE"
else
  case "$PROFILE" in
    preflight)
      run_lane "lane:quick"
      ;;
    core)
      run_lane "lane:quick"
      run_lane "lane:core"
      ;;
    high-risk)
      run_lane "lane:quick"
      run_lane "lane:core"
      run_lane "lane:firebase-auth-rules"
      run_lane "lane:authoritative-pricing"
      ;;
    "")
      if [[ "$MODE" == "quick" ]]; then
        run_lane "lane:quick"
      elif [[ "$MODE" == "build-only" ]]; then
        run_lane "lane:core"
      else
        run_lane "lane:quick"
        run_lane "lane:core"
      fi
      ;;
    *)
      echo "Unknown profile: $PROFILE" >&2
      usage
      exit 1
      ;;
  esac
fi

if [[ "$WITH_CWV" == "true" && "$LANE" != "lane:quick" ]]; then
  echo "==> Running CWV smoke gate"
  npm run check:perf:cwv
fi

echo "Checks completed successfully."
