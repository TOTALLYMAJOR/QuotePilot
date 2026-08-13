#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

lane="${1:-}"
with_cwv="false"

usage() {
  cat <<'USAGE'
Usage: orchestration-lanes.sh <lane> [--with-cwv]

Lanes:
  lane:quick               check:env + check:secrets + check:workflows
  lane:core                capability surfacing + test:unit + build + docs governance + bundle budget
  lane:firebase-auth-rules test:rules:firestore + test:e2e:firebase
  lane:authoritative-pricing
                           test:e2e:firebase:authoritative
  lane:release             lane:quick + lane:core (+ optional check:perf:cwv)
USAGE
}

prepare_firebase_java() {
  bash ./scripts/ensure-local-jre.sh

  local local_jre="$ROOT_DIR/.cache/tools/jre21"
  if [[ -x "$local_jre/bin/java" ]]; then
    export JAVA_HOME="$local_jre"
    export PATH="$local_jre/bin:$PATH"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    lane:quick|lane:core|lane:firebase-auth-rules|lane:authoritative-pricing|lane:release)
      lane="$1"
      shift
      ;;
    --with-cwv)
      with_cwv="true"
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

if [[ -z "$lane" ]]; then
  usage
  exit 1
fi

case "$lane" in
  lane:quick)
    echo "==> lane:quick"
    npm run check:env
    npm run check:secrets
    npm run check:ambient-release-gate
    npm run check:stripe-connect-foundation
    npm run check:workflows
    ;;
  lane:core)
    echo "==> lane:core"
    npm run check:capability-surfaces
    npm run test:unit
    npm run build
    npm run check:docs:governance
    npm run check:perf:bundle
    ;;
  lane:firebase-auth-rules)
    echo "==> lane:firebase-auth-rules"
    prepare_firebase_java
    npm run test:rules:firestore
    npm run test:e2e:firebase
    ;;
  lane:authoritative-pricing)
    echo "==> lane:authoritative-pricing"
    npm run test:e2e:firebase:authoritative
    ;;
  lane:release)
    echo "==> lane:release"
    bash ./scripts/orchestration-lanes.sh lane:quick
    bash ./scripts/orchestration-lanes.sh lane:core
    if [[ "$with_cwv" == "true" ]]; then
      npm run check:perf:cwv
    fi
    ;;
  *)
    echo "Unsupported lane: $lane" >&2
    exit 1
    ;;
esac

echo "Lane completed successfully: $lane"
