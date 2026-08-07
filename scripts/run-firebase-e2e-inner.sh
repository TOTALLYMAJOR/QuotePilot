#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${E2E_FIREBASE_PROJECT_ID:-demo-e2e}"
ORG_ID="${E2E_FIREBASE_ORG_ID:-e2e-org}"
EMAIL="${E2E_FIREBASE_EMAIL:-e2e-admin@local.test}"
PASSWORD="${E2E_FIREBASE_PASSWORD:-Passw0rd!}"
PLAYWRIGHT_CONFIG="${E2E_PLAYWRIGHT_CONFIG:-playwright.firebase.config.js}"
PLAYWRIGHT_SPEC="${E2E_PLAYWRIGHT_SPEC:-e2e/firebase-auth-rules.smoke.spec.js}"

node ./scripts/seed-e2e-emulator-user.mjs --project "$PROJECT_ID" --organization "$ORG_ID" --email "$EMAIL" --password "$PASSWORD"
if [[ "${E2E_START_BLANK:-false}" == "true" ]]; then
  node ./scripts/seed-e2e-blank-catalog.mjs \
    --project "$PROJECT_ID" \
    --organization "$ORG_ID"
else
  node ./scripts/seed-firestore-menu.mjs \
    --project "$PROJECT_ID" \
    --organization "$ORG_ID" \
    --apply \
    --confirm "SEED $PROJECT_ID $ORG_ID"
  node ./scripts/confirm-e2e-catalog-pricing.mjs \
    --project "$PROJECT_ID" \
    --organization "$ORG_ID" \
    --email "$EMAIL"
fi

bash ./scripts/run-playwright.sh test --config="$PLAYWRIGHT_CONFIG" "$PLAYWRIGHT_SPEC"
