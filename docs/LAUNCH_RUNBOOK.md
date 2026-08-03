# Launch Runbook

Last updated: July 27, 2026

## Goal
Deploy QuotePilot safely with environment validation, reproducible build checks, and clear post-launch verification.

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
npm run deploy:firebase -- \
  --confirm "DEPLOY tonicatering hosting:app,firestore,functions"
```

The deploy entrypoint requires a clean `main` revision that matches its local
upstream and `origin/main`, plus a semantic release tag on that exact commit
that has already been published to `origin`. It validates the ignored
production Functions environment, binds Firebase Hosting target `app` to the
primary `tonicatering` site, and deploys `hosting:app`, Firestore rules/indexes,
and Functions from that same revision. Do not substitute an unscoped default
Hosting deploy.

For the optional Vercel target, preserve the SPA rewrite in `vercel.json`. Because
`cleanUrls` is enabled, the catch-all destination must be `/` rather than
`/index.html`. Deploy only from the same published tagged revision:

```bash
npm run deploy:vercel -- \
  --confirm "DEPLOY quotepilot.mbmapps.com via vercel"
```

The Vercel production build runs `check:env` with the production environment
before Vite, so emulator, E2E-auth-bypass, or local-catalog-fallback flags fail
the deployment. After promotion, verify that `/`, `/app`, and `/system` each
return the application shell with HTTP 200.

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
- Set repository variables:
  - `APP_BASE_URL=https://quotepilot.mbmapps.com/app`
  - `APP_BASE_DOMAIN=mbmapps.com`
  - `NOTIFICATIONS_EMAIL_PROVIDER=none` until Resend is verified
  - `EMAIL_FROM_NAME=QuotePilot by MBMapps`
  - `EMAIL_FROM_EMAIL=onboarding@quotepilot.mbmapps.com`
  - `NOTIFICATIONS_SMS_PROVIDER=none` until Twilio is approved
  - provider sender/owner values only when the matching provider is enabled
- Set repository secrets:
  - `AUTH_PLATFORM_ADMIN_EMAILS`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `RESEND_API_KEY` only when Resend is enabled
  - Twilio account/auth secrets only when Twilio is enabled
- Temporarily set `ENABLE_FUNCTIONS_DEPLOY=true` (requires Blaze plan).
- Confirm `scripts/materialize-functions-env.mjs` validates these values and
  creates the ignored `functions/.env.<firebase-project-id>` file. The
  materializer fails rather than deploying with a missing allowlist, a
  noncanonical owner URL, a different sender identity, missing Stripe secrets,
  or incomplete credentials for an enabled provider; it does not print secret
  values.
- Run the controlled deploy.
- Immediately set it back to `false`.

## 5) Optional Functions (Stripe + Twilio + Resend)
These values are server-only Firebase Functions configuration. The repository
root `.env.example` is a browser-safe `VITE_*` template and must not contain
Stripe, Twilio, or Resend credentials.

Use [`functions/.env.example`](../functions/.env.example) as the Functions
placeholder inventory:

```bash
cp functions/.env.example functions/.env.<firebase-project-id>
git check-ignore -v functions/.env.<firebase-project-id>
```

The second command must report an ignore rule before any credential is added;
if it does not, stop and establish the approved ignore rule first. Credential
fields are intentionally blank. Do not enable a provider until every required
value for that provider has been supplied through an approved secret channel.

Keep the production fail-safe state during custom-domain setup:

```dotenv
NOTIFICATIONS_SMS_PROVIDER=none
NOTIFICATIONS_EMAIL_PROVIDER=none
APP_BASE_URL=https://quotepilot.mbmapps.com/app
EMAIL_FROM_NAME=QuotePilot by MBMapps
AUTH_PLATFORM_ADMIN_EMAILS=<approved-platform-operator-email>
```

`APP_BASE_URL` must direct customer owners to the authenticated `/app` route,
not the public marketing page.

Provisioning requires an authenticated admin role document whose email exactly
matches an entry in `AUTH_PLATFORM_ADMIN_EMAILS`, and the Firebase Auth token
must report a verified email. Runtime token claims never elevate or replace the
current role document, and there is no broad cross-org admin switch. Tenant
admins cannot create tenants, change paid entitlements, or run organization
archive/delete operations.

### Resend activation gate

The intended sender is
`QuotePilot by MBMapps <onboarding@quotepilot.mbmapps.com>`. Do not activate or
represent that sender as operational until the `quotepilot.mbmapps.com` sender
domain is verified in the Resend dashboard and the required DNS records are
confirmed at the authoritative DNS provider.

Only after verification, set the ignored Functions environment file to:

```dotenv
NOTIFICATIONS_EMAIL_PROVIDER=resend
EMAIL_FROM_NAME=QuotePilot by MBMapps
EMAIL_FROM_EMAIL=onboarding@quotepilot.mbmapps.com
RESEND_API_KEY=<buyer-owned-resend-api-key>
APP_BASE_URL=https://quotepilot.mbmapps.com/app
```

If verification is incomplete, keep the production custom-domain sender gated
and send the copy-ready onboarding message manually. The recorded
`onboarding@resend.dev` check was performed externally as a manual Resend
dashboard sandbox test; it is not an allowed QuotePilot Functions sender
configuration, customer-ready sender-domain proof, or recipient-inbox proof.

Deploy functions:
```bash
npm run deploy:firebase:functions -- \
  --confirm "DEPLOY tonicatering firestore,functions"
```

After a controlled Resend deployment, send exactly one onboarding test to a
controlled recipient and capture all three proof layers:
1. QuotePilot reports that Resend accepted the request and records the provider
   message id in the provisioning audit.
2. The Resend dashboard records a `delivered` event for that message.
3. The recipient confirms the message arrived with the expected sender name,
   sender address, and `/app` sign-in link.

Configuration presence or an accepted API response alone is not delivery
proof. Keep production customer email disabled if any layer fails.

Buyer setup assistance is also available in-app:
- `Integrations Ops` -> `Buyer Setup Assistant (Optional Twilio)` to check status and send SMS test.

Stripe and Twilio use the corresponding blank fields in
`functions/.env.example`. Stripe has no provider flag in this runtime: its
secret and webhook secret are required before any production Functions deploy
because checkout and webhook handlers ship in the same bundle. Keep the Twilio
provider flag at `none` until buyer-owned credentials, sender registration, and
provider acceptance checks are complete.

Stripe webhook endpoint:
- `https://us-central1-tonicatering.cloudfunctions.net/stripeWebhook`
- events:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`

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
   - Firebase quote creation is re-priced by the trusted callable and persists
     a draft quote, matching portal snapshot, and initial version,
   - an eligible quote edit is server-repriced and atomically updates the quote
     and portal while adding a version,
   - terminal evidence blocks edit/reopen, sales cannot bypass the exact
     draft-to-sent boundary, and direct quote/portal deletes fail,
   - quote history row appears and opens,
   - customer portal accept/decline path updates state,
   - PDF export succeeds,
   - Integrations Ops setup assistant loads and reports status,
   - SMS test path returns disabled/not configured when
     `NOTIFICATIONS_SMS_PROVIDER=none` without blocking core flow.
3. Confirm rollback target:
   - previous known-good commit SHA is documented,
   - current known-good SHA in `PROJECT_STATUS.md` is ready to update after successful deploy.

For a tenant-provisioning release, also complete the disposable owner acceptance
checklist in `docs/USER_MANUAL.md`. At minimum, prove verified platform-admin
authority, unverified owner denial, exact-email invitation activation, neutral
blank-catalog setup, package/event/pricing approval, quote save and readback,
signed-out portal acceptance, cross-tenant denial, and exact cleanup. The
emulator matrix in `scripts/provisioning-emulator-acceptance.mjs` is local
evidence only; repeat the customer-visible flow against the exact hosted
release before calling production onboarding seamless.

## 7) Post-Launch Verification

Before testing legacy customer links, run the customer portal projection
backfill as a separately reviewed production-data operation. Start with a
tenant-scoped dry run and retain its aggregate evidence:

```bash
npm run portal:backfill -- \
  --project tonicatering \
  --organization <organization-id> \
  --dry-run \
  --evidence-out <new-dry-run-evidence-file.json>
```

Resolve all reported identity or commercial-evidence conflicts before apply.
Apply requires Firebase Admin ADC, a new evidence file, and the exact
scope-bound confirmation shown in the README. Do not infer permission to apply
from deployment or merge approval, and never copy portal tokens or customer
data into release evidence.

1. Create a quote end-to-end.
2. Confirm quote appears in history.
3. Export PDF proposal.
4. Verify customer portal accept/decline updates.
   - Confirm the public snapshot and organization quote carry the same
     structured decision and timestamp.
   - Confirm a second public request cannot flip an accepted/declined outcome.
5. Validate mobile layout and key interaction flows.

## 8) Rollback
Use the prior known-good commit SHA tracked in `PROJECT_STATUS.md`.

Hosting rollback:
```bash
git checkout <known_good_sha>
npm ci
npm run check:env
npm run build
npx firebase-tools target:apply hosting app tonicatering --project tonicatering
npx firebase-tools deploy --only hosting:app --project tonicatering --non-interactive
```

If a controlled functions deploy caused regression and `ENABLE_FUNCTIONS_DEPLOY` is intentionally enabled:
```bash
git checkout <known_good_sha>
npm ci
npm ci --prefix functions
npm run check:env
npm run build
npx firebase-tools target:apply hosting app tonicatering --project tonicatering
npx firebase-tools deploy --only hosting:app,firestore,functions --project tonicatering --non-interactive
```
