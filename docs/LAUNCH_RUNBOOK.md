# Launch Runbook

Last updated: March 27, 2026

## Goal
Deploy Firebase Quote Wizard safely with environment validation, reproducible build checks, and clear post-launch verification.

## 1) Prepare Firebase
1. Create/select Firebase project.
2. Enable Firestore Database.
3. Create Firebase Web App and capture `VITE_FIREBASE_*` values.
4. Enable Authentication providers needed by staff (`Email/Password`, `Google`).

## 2) Configure Local Environment
1. Copy `.env.example` to `.env`.
2. Set required values:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
3. Validate and build:
```bash
npm run check:env
npm run build
```

## 3) Deploy Hosting + Firestore
```bash
npx firebase-tools login
npx firebase-tools use --add
npm run deploy:firebase
```

## 4) Configure CI Variables
Set repository variables/secrets used by deploy workflow:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- optional: `VITE_FIREBASE_FUNCTIONS_REGION`
- required production default: `ENABLE_FUNCTIONS_DEPLOY=false`

For intentional functions deploy windows only:
- Temporarily set `ENABLE_FUNCTIONS_DEPLOY=true` (requires Blaze plan).
- Run the controlled deploy.
- Immediately set it back to `false`.

## 5) Optional Functions (Stripe + Twilio)
Set production fail-safe default first:
```bash
npx firebase-tools functions:config:set \
  notifications.sms_provider="none"
```

Set configuration with buyer-owned credentials (never commit real secrets):
```bash
npx firebase-tools functions:config:set \
  notifications.sms_provider="twilio" \
  stripe.secret_key="<your_stripe_secret>" \
  stripe.webhook_secret="<your_stripe_webhook_secret>" \
  twilio.account_sid="<your_twilio_account_sid>" \
  twilio.auth_token="<your_twilio_auth_token>" \
  twilio.from_number="<your_twilio_from_number>" \
  notifications.owner_phone="<your_owner_phone>" \
  app.base_url="https://tonicatering.web.app"
```

If buyer wants Stripe checkout but no SMS yet:
```bash
npx firebase-tools functions:config:set \
  notifications.sms_provider="none" \
  stripe.secret_key="<your_stripe_secret>" \
  stripe.webhook_secret="<your_stripe_webhook_secret>" \
  app.base_url="https://tonicatering.web.app"
```

Deploy functions:
```bash
npm run deploy:firebase:functions
```

Buyer setup assistance is also available in-app:
- `Integrations Ops` -> `Buyer Setup Assistant (Optional Twilio)` to check status and send SMS test.

Stripe webhook endpoint:
- `https://us-central1-tonicatering.cloudfunctions.net/stripeWebhook`
- event: `checkout.session.completed`

## 6) Pre-Merge 10-Minute UAT (Required for Production-Triggering Merge)
Pass all checks before merging a release-intent PR to `main`:
1. CI is fully green:
   - `lane:quick (Preflight + Secrets)`
   - `lane:core (Unit + Build + Governance + Bundle)`
   - `Docker Build Smoke`
   - `lane:playwright-smoke`
   - `lane:firebase-auth-rules`
   - `lane:authoritative-pricing`
   - `lane:cwv-smoke`
2. Manually verify production-critical paths in a release candidate build:
   - quote save succeeds,
   - quote history row appears and opens,
   - customer portal accept/decline path updates state,
   - PDF export succeeds,
   - Integrations Ops setup assistant loads and reports status,
   - SMS test path returns disabled/not configured when `notifications.sms_provider="none"` without blocking core flow.
3. Confirm rollback target:
   - previous known-good commit SHA is documented,
   - current known-good SHA in `PROJECT_STATUS.md` is ready to update after successful deploy.

## 7) Post-Launch Verification
1. Create a quote end-to-end.
2. Confirm quote appears in history.
3. Export PDF proposal.
4. Verify customer portal accept/decline updates.
5. Validate mobile layout and key interaction flows.

## 8) Rollback
Use the prior known-good commit SHA tracked in `PROJECT_STATUS.md`.

Hosting rollback:
```bash
git checkout <known_good_sha>
npm ci
npm run check:env
npm run build
npx firebase-tools deploy --only hosting --project tonicatering --non-interactive
```

If a controlled functions deploy caused regression and `ENABLE_FUNCTIONS_DEPLOY` is intentionally enabled:
```bash
git checkout <known_good_sha>
npm ci
npm ci --prefix functions
npm run check:env
npm run build
npx firebase-tools deploy --only hosting,functions --project tonicatering --non-interactive --force
```
