#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${LHCI_COLLECT__CHROME_PATH:-}" ]]; then
  playwright_chrome="$(node -e "const { chromium } = require('playwright'); process.stdout.write(chromium.executablePath())")"
  if [[ ! -x "$playwright_chrome" ]]; then
    echo "Playwright Chromium is unavailable at: $playwright_chrome" >&2
    echo "Install it with: npx playwright install chromium" >&2
    exit 1
  fi
  export LHCI_COLLECT__CHROME_PATH="$playwright_chrome"
fi

lhci autorun --config=./.lighthouserc.json
