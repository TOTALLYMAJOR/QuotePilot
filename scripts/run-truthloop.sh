#!/usr/bin/env bash
# QuotePilot Commercial Truth Loop runner.
#
# The reconciler is standard-library-only by design, so this wrapper never
# installs anything, never reaches the network, and never needs a virtualenv.
# It only puts the package on PYTHONPATH and hands off to Python.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/truthloop"

if [[ ! -d "$PACKAGE_DIR/src/quotepilot_truthloop" ]]; then
  echo "Commercial Truth Loop package is missing at $PACKAGE_DIR." >&2
  exit 1
fi

# Pick the newest interpreter that satisfies the floor. CI runner images ship
# several Pythons and the default `python3` is not always the newest, so probe
# explicit versions first. This keeps the gate working across runner image
# changes without adding a setup action to the supply chain.
PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  for candidate in python3.14 python3.13 python3.12 python3.11 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 \
      && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$PYTHON_BIN" ]]; then
  echo "Python 3.11+ is required for the Commercial Truth Loop. See README.md." >&2
  exit 1
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "PYTHON_BIN=$PYTHON_BIN is not an available interpreter." >&2
  exit 1
fi

# Re-check even a resolved interpreter so an explicit PYTHON_BIN override
# reports the version floor as clearly as the probe does.
if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
  echo "Python 3.11+ is required for the Commercial Truth Loop; $PYTHON_BIN is older." >&2
  exit 1
fi

command="${1:-test}"
if [[ $# -gt 0 ]]; then
  shift
fi

export PYTHONPATH="$PACKAGE_DIR/src:$PACKAGE_DIR/tests${PYTHONPATH:+:$PYTHONPATH}"
# Keep byte-for-byte reproducible runs: no stray .pyc, stable hashing.
export PYTHONDONTWRITEBYTECODE=1
export PYTHONHASHSEED=0

case "$command" in
  test)
    echo "==> truthloop: unit tests"
    exec "$PYTHON_BIN" -m unittest discover -s "$PACKAGE_DIR/tests" -t "$PACKAGE_DIR/tests" "$@"
    ;;
  reconcile|rules)
    exec "$PYTHON_BIN" -m quotepilot_truthloop "$command" "$@"
    ;;
  lint)
    if ! command -v ruff >/dev/null 2>&1; then
      echo "ruff is not installed; skipping optional lint (pip install -e 'truthloop[dev]')." >&2
      exit 0
    fi
    exec ruff check "$PACKAGE_DIR"
    ;;
  *)
    echo "Usage: run-truthloop.sh [test|reconcile <bundle>|rules|lint]" >&2
    exit 1
    ;;
esac
