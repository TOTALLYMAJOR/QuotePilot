# Launch Runbook

Last updated: August 9, 2026

## Goal
Deploy and verify QuotePilot safely through exact-SHA manual workflows, scoped
credentials, fixed provider targets, explicit rollback inputs, and clear
post-launch evidence.

## 1) Prepare Firebase
1. Create/select Firebase project.
2. Enable Firestore Database.
3. Create Firebase Web App and capture `VITE_FIREBASE_*` values.
4. Enable Authentication providers needed by staff (`Email/Password`, `Google`).
5. In Authentication settings, enable email-enumeration protection and confirm
   `VITE_APP_URL` is exactly `https://quotepilot.mbmapps.com/app` and that
   `quotepilot.mbmapps.com` is authorized for email-action continue URLs. The
   Firebase Hosting fallback is not accepted as a production email-action
   continue host. The generic reset confirmation is not provider proof, and public
   registration can still return an existing-email error; retain separate abuse
   controls and registration hardening as required by the production threat
   model.

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

## 3) Deploy a Verified Release

Do not run a primary production deploy from a workstation. After completing the
exact-main sequence in section 6, manually dispatch one of these workflows from
`main`:

- `Deploy Firebase Production`
- `Deploy Vercel Production`

Both workflows require the full semantically tagged release SHA, the matching
successful main-push `CI Quality` run id, a target-specific rollback ancestor,
and an exact typed confirmation. Firebase additionally requires an explicit
`hosting`, `backend`, or `all` scope. Before installing dependencies, the
workflow validates the canonical repository and workflow, remotely published
tagged `main`, all eight CI jobs, protected environment, allowlisted human
dispatcher, and rollback ancestry. It repeats the live evidence check after
the build and immediately before provider mutation.

Provider credentials are available only to the final deployment step. Firebase
runtime configuration is materialized from reviewed repository variables and
the platform-admin GitHub secret; provider secrets remain bound through
Firebase Secret Manager. Vercel deploys only to the fixed `mbmapps/quoteflow`
project. Firebase deploys only to `tonicatering`, and backend/all always bind
Firestore rules and Functions together.

For Vercel, preserve the reviewed SPA contract in `vercel.json`; Git-triggered
deployments remain disabled. After deployment, verify that `/`, `/app`, and
`/system` each return the application shell with HTTP 200 and retain the
provider deployment id as the rollback receipt.

## 4) Configure CI Variables and Secrets
Set repository or environment variables used by the deploy workflows:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- optional: `VITE_FIREBASE_FUNCTIONS_REGION`
- `VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY`: browser-visible public key with valid
  non-placeholder syntax; deployment fails on syntax only, while Cloudflare
  widget configuration and human review require separate evidence
- `RELEASE_APPROVAL_MODE`: `independent-review` (default) or `solo-operator`
- `RELEASE_SOLO_OPERATOR_IDS`: in solo mode, exactly one numeric GitHub user id;
  it must identify the human who dispatches production
- `FIREBASE_TOKEN` and `VERCEL_TOKEN`: GitHub secrets scoped only to the final
  provider-deploy steps
- `AUTH_PLATFORM_ADMIN_EMAILS`: GitHub secret used only to materialize the
  ignored Functions runtime configuration during an authorized backend deploy

Stripe, Twilio, Resend, Turnstile, and rate-limit secrets stay in Firebase
Secret Manager and must never enter GitHub variables, dotenv artifacts, or
logs.

Configure the external release controls before the first promotion:

1. Protect `main` with required `CI Quality` checks and pull-request review.
2. For `independent-review`, create `production`, require a directly assigned
   independent user reviewer, and prevent self-review. For a genuinely solo
   repository, create reviewless `production-solo` and set the one-user solo
   allowlist. Never mix the two modes in one release.
3. For every release environment, restrict deployment branches to protected
   branches and disable administrator bypass.
4. Treat any approval-mode or solo-operator allowlist change as production
   authorization configuration: review it in source/config history and never
   change it to rescue an already-running release.
5. Keep `vercel.json` `git.deploymentEnabled` set to `false` so Git pushes do
   not create or promote Vercel deployments. Confirm no alternate Firebase
   automation or customer-site helper bypasses the manual workflows.
6. Rehearse each deploy workflow with intentionally invalid evidence and
   confirmation, and confirm it fails before dependency execution. Do not treat
   repository source as proof that external settings are active.
7. Retain provider-derived deployment evidence: project/environment, READY
   state, source SHA, successful deployment id, timestamp, and a
   component-specific last-known-good record.

For intentional Firebase backend deployment windows only, configure these
values in the approved GitHub variable and Firebase Secret Manager channels:
- Set trusted runtime configuration:
  - `APP_BASE_URL=https://quotepilot.mbmapps.com/app`
  - `APP_BASE_DOMAIN=mbmapps.com`
  - `NOTIFICATIONS_EMAIL_PROVIDER=resend` for the currently deployed approved
    restricted sender; provider acceptance, delivery/bounce, and recipient
    evidence still require an exact controlled attempt
  - `EMAIL_FROM_NAME=QuotePilot by MBMApps`
  - `EMAIL_FROM_EMAIL=quotepilot@leaguepilot.us`
  - `NOTIFICATIONS_SMS_PROVIDER=none` until Twilio is approved
  - `STRIPE_MODE=live` for an authorized production runtime; use `test` only in
    an isolated hosted acceptance environment
  - `BUYER_ACCESS_ENABLED=false` outside an explicitly approved acceptance or
    release window
  - `BUYER_ACCESS_STRIPE_MODE=test`
  - `BUYER_ACCESS_APP_BASE_URL=https://quotepilot.mbmapps.com/app`
  - `BUYER_ACCESS_TURNSTILE_HOSTNAMES=quotepilot.mbmapps.com,tonicatering.web.app`
    while the buyer gate is enabled
  - provider sender/owner values only when the matching provider is enabled
- Set trusted runtime secrets:
  - `AUTH_PLATFORM_ADMIN_EMAILS`
  - `STRIPE_SECRET_KEY` (secret or restricted key prefix must match
    `STRIPE_MODE`) in Firebase Secret Manager
  - `STRIPE_WEBHOOK_SECRET` in Firebase Secret Manager
  - `BUYER_ACCESS_STRIPE_SECRET_KEY`,
    `BUYER_ACCESS_STRIPE_WEBHOOK_SECRET`, and
    `BUYER_ACCESS_TURNSTILE_SECRET`, plus an independently generated
    `BUYER_ACCESS_RATE_LIMIT_SECRET` of at least 32 characters, in Firebase
    Secret Manager only when buyer
    onboarding acceptance is approved; these never enter dotenv or the deploy
    workflow
  - `RESEND_API_KEY` in Firebase Secret Manager before any Resend-bound
    Function is deployed; provider enablement remains controlled separately by
    `NOTIFICATIONS_EMAIL_PROVIDER`
  - `RESEND_WEBHOOK_SECRET` in Firebase Secret Manager for the Revenue
    Autopilot webhook only; do not bind `RESEND_API_KEY` to that webhook
  - `REVENUE_AUTOPILOT_TOKEN_SECRET` in Firebase Secret Manager only for signed
    unsubscribe-token issue/verification; never reuse a provider, Stripe,
    Turnstile, or rate-limit secret
  - `TWILIO_AUTH_TOKEN` in Firebase Secret Manager before any SMS-capable
    Function is deployed; keep the account SID, Messaging Service SID, and
    owner destination in trusted non-secret runtime configuration
- Select `firebase_scope=backend` or `firebase_scope=all` only for an explicitly
  authorized backend window (requires Blaze plan). Both scopes deploy Firestore
  rules and Functions together.
- The workflow-generated `functions/.env.tonicatering` is ignored, mode `0600`,
  validated immediately before deployment, and never uploaded as an artifact.

## 5) Functions Runtime Configuration (Optional Stripe + Twilio + Resend Providers)
These values are server-only Firebase Functions configuration. The repository
root `.env.example` is a browser-safe `VITE_*` template and must not contain
Stripe, Twilio, or Resend credentials.

Use [`functions/.env.example`](../functions/.env.example) as the Functions
placeholder inventory for local/emulator validation only:

```bash
cp functions/.env.example functions/.env.<firebase-project-id>
git check-ignore -v functions/.env.<firebase-project-id>
```

The second command must report an ignore rule before any non-production value
is added; if it does not, stop and establish the approved ignore rule first.
Credential fields are intentionally blank. Never put production credentials in
this local file. Do not enable a provider until every required production value
has been supplied through the trusted runtime's approved secret channel.

Use this fail-safe bootstrap state before sender activation or in an isolated
validation environment. It is not the current QuotePilot production snapshot:

```dotenv
NOTIFICATIONS_SMS_PROVIDER=none
NOTIFICATIONS_EMAIL_PROVIDER=none
COMMERCIAL_CHANGE_AUTHORITY_ENABLED=false
REVENUE_AUTOPILOT_ENABLED=false
REVENUE_AUTOPILOT_SENDS_ENABLED=false
STRIPE_MODE=live
BUYER_ACCESS_ENABLED=false
BUYER_ACCESS_STRIPE_MODE=test
BUYER_ACCESS_TURNSTILE_HOSTNAMES=quotepilot.mbmapps.com,tonicatering.web.app
APP_BASE_URL=https://quotepilot.mbmapps.com/app
EMAIL_FROM_NAME=QuotePilot by MBMApps
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

The approved interim sender is
`QuotePilot by MBMApps <quotepilot@leaguepilot.us>`. It deliberately reuses the
existing verified `leaguepilot.us` Resend domain while the account has a
single-domain limit. The restricted production key and exact Functions release
are now deployed. Do not represent an exact delivery attempt as complete until
provider acceptance, delivered/bounced event, and recipient-inbox proof are
captured. Replacing
the shared sender with a dedicated QuotePilot domain remains a later migration,
not a prerequisite for this interim activation.

Only after verification, set the trusted runtime configuration to:

```dotenv
NOTIFICATIONS_EMAIL_PROVIDER=resend
EMAIL_FROM_NAME=QuotePilot by MBMApps
EMAIL_FROM_EMAIL=quotepilot@leaguepilot.us
APP_BASE_URL=https://quotepilot.mbmapps.com/app
```

Create `RESEND_API_KEY` as a Firebase Secret Manager value and deploy only the
explicitly bound email/provisioning Functions. Never materialize it in the
Functions dotenv file. For a local Functions emulator only, an expendable
fixture may be supplied through the ignored `functions/.secret.local` file.

If release or delivery acceptance is incomplete, keep the production sender
gated and send the copy-ready onboarding message manually. The recorded
`onboarding@resend.dev` check was performed externally as a manual Resend
dashboard sandbox test; it is not an allowed QuotePilot Functions sender
configuration, customer-ready sender-domain proof, or recipient-inbox proof.

Deploy the Firebase backend only by dispatching `Deploy Firebase Production`
with `firebase_scope=backend` and the exact tagged-main CI evidence. This scope
deploys `firestore,functions` together. Use `firebase_scope=all` only for an
explicitly coordinated Hosting, rules, and Functions release.

After a controlled Resend deployment, send exactly one onboarding test to a
controlled recipient and capture all three proof layers:
1. QuotePilot reports that Resend accepted the request and records the provider
   message id in the provisioning audit.
2. The Resend dashboard records a `delivered` event for that message.
3. The recipient confirms the message arrived with the expected sender name,
   sender address, and `/app` sign-in link.

Configuration presence or an accepted API response alone is not delivery
proof. Keep production customer email disabled if any layer fails.

### Commercial Change Authority and trusted Kitchen BEO activation gate

Keep `COMMERCIAL_CHANGE_AUTHORITY_ENABLED=false` and the server-owned tenant
setting `commercialChangeAuthorityEnabled=false` through source qualification,
coordinated frontend/Functions/rules deployment, hosted role acceptance, and
operator review. Browser principals cannot promote either gate. Before any
activation:

1. Exercise the deployed exact apply-outcome contract. A transport-ambiguous
   governed `updateQuoteDraft` must use the same-tenant read/reconcile path
   bound to the original request, simulation, authorization, quote, revision,
   and apply receipt. Verify committed receipt, not-committed fence, changed
   source, uncertainty, and definitive rejection without resubmitting the edit.
2. Verify sales can simulate/request but only tenant admins can authorize and
   edit policy. Cross-tenant, stale revision/catalog, expired authorization,
   over-bound, and browser-direct authority access must fail closed.
3. Verify apply either atomically records quote/version/apply/dependency
   invalidations or records nothing. Simulation must never edit accepted
   history, contracts, provider/payment evidence, portal decisions, or prior
   artifacts.
4. Verify `safeToPublish` remains a read-only eligibility result and invokes no
   publication, delivery, acceptance, booking, payment, or completion action.
5. Exercise trusted Kitchen BEO generation, status, and
   `downloadKitchenBeoReceipt` for both the exact current receipt and a prior
   immutable receipt. Generation replay, final response, status, and download
   must reject malformed base64 or any retained byte-length/SHA-256 mismatch.
   `CURRENT` must follow the current-artifact pointer to the exact receipt and
   revalidate its bytes before deriving freshness.
6. Capture exact hosted staff/admin/kitchen behavior, including all five
   freshness states, uncertainty/recovery, responsive/keyboard use, and branded
   proposal isolation. This still does not prove kitchen sign-off or artifact
   publication.

Rollback is to return both global and tenant gates to false. Preserve immutable
receipts and artifacts for audit; do not delete or rewrite history to simulate a
rollback. No step in this runbook authorizes production gate promotion.

### Authoritative operational staffing activation gate

Keep `VITE_OPERATIONAL_STAFFING_ENABLED=false`,
`OPERATIONAL_STAFFING_AUTHORITY_ENABLED=false`, and every trusted tenant setting
`operationalStaffingAuthorityEnabled=false` through source qualification and a
coordinated frontend/Functions/rules release. Browser principals cannot promote
the server or tenant gate. Before any one-tenant activation:

1. Prove same-tenant administrators can create and revise bounded staff
   profiles and operator-recorded availability, while sales, customers,
   unverified, cross-tenant, and unscoped principals cannot configure them.
2. Prove same-tenant administrators and sales staff can read and apply exact
   quote-revision plans, while every other principal is denied. Direct browser
   Firestore access to profiles, plans, nested receipts, and schedule fences
   must remain denied.
3. Exercise invalid, missing, ambiguous, and nonexistent tenant-local event
   times; stale or forged quote revisions, counts, staff revisions, and fence
   revisions; truncated evidence; overlapping availability; and concurrent
   overlapping assignments. All must fail closed without a partial record.
4. Prove lost-response retry reuses the identical request and receipt, changed
   payload replay is rejected, adjacent half-open assignments remain legal, a
   moved revision clears only its old fence projections, and a transaction
   failure leaves plans, receipts, and fences unchanged.
5. Verify the Living Opportunity separates quoted requirements from
   operator-confirmed assignments, keeps partial plans as visible gaps, exposes
   stale/uncertain/reconciliation/recovery states, preserves focus and work on
   dismissal, and labels disconnected fallback `local_draft` at 390, 768, and
   1440px.
6. Confirm no command changes quote pricing/version history, portal, proposal,
   payment, contract, booking, Kitchen BEO, messaging, attendance, payroll, or
   readiness evidence. A coverage-confirmed staffing plan proves only the exact
   operator-recorded assignments and schedule-fence check in its receipt.

Rollback disables the presentation and global server gates and returns the
exact tenant setting to false. Preserve immutable records and receipts for a
later exact read; never rewrite operational history to simulate rollback. See
the [authority ADR](OPERATIONAL_STAFFING_AUTHORITY_ADR.md).

### Revenue Autopilot activation gate

Revenue Autopilot evaluation and outbound sends are independent. Keep this
fail-safe state until exact source, hosted, provider, and human acceptance is
recorded:

```dotenv
REVENUE_AUTOPILOT_ENABLED=false
REVENUE_AUTOPILOT_SENDS_ENABLED=false
NOTIFICATIONS_EMAIL_PROVIDER=resend
```

The shared email provider may remain enabled for ordinary quote and onboarding
email while both Revenue Autopilot gates are off. Provider configuration never
authorizes Autopilot dispatch by itself.

Secret Manager ownership is intentionally split:

- `RESEND_API_KEY`: send and provider reconciliation functions only.
- `RESEND_WEBHOOK_SECRET`: `revenueAutopilotResendWebhook` only. The webhook
  receives raw request bytes and verifies them directly with repository-pinned
  `standardwebhooks@1.0.0` before trusting JSON; it must not receive the Resend
  API key.
- `REVENUE_AUTOPILOT_TOKEN_SECRET`: signed v1 organization/customer unsubscribe
  token issue/verification only. The public token is opaque and the stored hash
  is server-owned. V1 intentionally has no timestamp or expiry; signature,
  organization/customer scope, and stored-hash mismatch fail closed.

Before activation:

1. Confirm the interim sender/DNS identity and restricted-key scope, deploy the
   exact coordinated Functions/rules/frontend artifact, and subscribe the exact
   `revenueAutopilotResendWebhook` endpoint. Prove bad signature, wrong scope,
   replay, malformed raw body, and cross-tenant denial before trusting provider
   events.
2. Confirm `runRevenueAutopilotSchedule` is configured every 15 minutes in UTC.
   Verify that evaluation still uses each tenant's validated IANA calendar,
   quiet hours, bounded leases/retries, idempotent job identity, and self-stop
   rules. Scheduler existence or invocation is not send/delivery evidence.
3. Exercise quote follow-up stop on view/accept/decline, post-acceptance deposit
   reminders, fixed event-minus-14/7/3 final-balance windows, and unread customer
   replies becoming Attention items. Validate suppression and customer controls
   before allowing sends.
4. For post-event review requests, require the exact accepted immutable revision
   plus a private closeout that remains `completed`. Reopening, invalid,
   configuration-blocked, or pending closeout state must stop the lane even when
   the portal has expired. Verify the tenant-branded URL without treating a
   job, acceptance, delivery, or click as a posted review or rebooking.
5. Verify every governed email contains the durable public unsubscribe URL.
   Portal query precedence must remain intact. One exact unsubscribe action
   records an idempotent receipt and changes email eligibility only; it must not
   cancel a quote/event or edit acceptance, payment, or conversations.
6. Capture provider states separately: request accepted, delivered, bounced,
   complained, and suppressed/unsubscribed. Also capture controlled-recipient
   inbox evidence. Never infer delivered from accepted, customer view from
   delivered, or recovered revenue from a reminder.
7. Review Workflow operations and Customer 360 controls for loading, empty,
   partial/stale, error, retry, uncertainty/reconciliation, receipt, role,
   responsive, keyboard, and accessibility behavior.

Only after those records may an authorized release turn on evaluation, observe
it without sends, then separately enable provider sends. Rollback disables sends
first, then evaluation, while preserving jobs/receipts/provider evidence. Source
presence, local tests, Secret Manager entries, scheduler configuration, or a
webhook 2xx alone is not deployment, provider, production-data, or human
acceptance evidence.

Buyer setup assistance is also available in-app:
- `Integrations Ops` -> `Buyer Setup Assistant (Optional Twilio)` to check status and send SMS test.

### Twilio activation gate

QuotePilot sends owner alerts through a Twilio Messaging Service, not directly
from a raw phone number. Keep `NOTIFICATIONS_SMS_PROVIDER=none` until the
Messaging Service has an attached sender, the applicable US A2P registration is
approved, and the exact Functions release is ready for a controlled live test.

Store `TWILIO_AUTH_TOKEN` only in Firebase Secret Manager. Set the trusted
non-secret runtime configuration to:

```dotenv
NOTIFICATIONS_SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=<twilio-account-sid>
TWILIO_MESSAGING_SERVICE_SID=<twilio-messaging-service-sid>
NOTIFICATIONS_OWNER_PHONE=<e164-owner-phone>
```

The Functions dotenv materializer rejects `TWILIO_AUTH_TOKEN`; local emulator
fixtures belong only in the ignored `functions/.secret.local` file. After the
governed release, send one controlled integration test and confirm Twilio
accepted it and the destination device received it before treating SMS as
operational. Configuration presence alone is not delivery proof.

### Stripe activation gate

The quote-payment Stripe rail has no enabled/disabled provider flag: it requires
explicit non-secret `STRIPE_MODE=test|live` plus Secret Manager bindings for
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. The Functions dotenv
materializer rejects both secret values. The secret or restricted key prefix
must match the configured mode, and webhook Event plus Checkout Session
`livemode` must match it. Missing or mixed-mode configuration fails closed.
Use `STRIPE_MODE=test` only with test credentials in an isolated hosted
acceptance environment. An authorized production runtime must explicitly use
`STRIPE_MODE=live` with a matching live key. Passing source tests, setting
configuration, or receiving an emulator event does not establish either hosted
test-mode or live-mode provider acceptance.

Stripe webhook endpoint:
- `https://us-central1-tonicatering.cloudfunctions.net/stripeWebhook`
- events:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`

The public buyer invoice rail is not a mode change for that quote-payment rail.
It has an independent disabled-by-default `BUYER_ACCESS_ENABLED` gate,
`BUYER_ACCESS_STRIPE_MODE=test`, exact Turnstile hostnames, four separate
Secret Manager bindings including the HMAC rate-limit key, a
dedicated Stripe client pinned to API version
`2024-06-20`, and a separate endpoint pinned to that same event API version:

- `https://us-central1-tonicatering.cloudfunctions.net/buyerAccessStripeWebhook`

Subscribe that endpoint only to:

- `invoice.paid`
- `invoice.payment_failed`
- `invoice.voided`
- `invoice.marked_uncollectible`

Never route buyer invoice events to `stripeWebhook`, share signing secrets
between endpoints, subscribe `buyerAccessStripeWebhook` to the quote Checkout
Session event set, or change the generic quote Stripe client's version while
configuring the buyer rail.

### Compromised provider-secret rotation and ordered cutover

The currently exposed or locally cached generic Resend and Stripe credentials
must be treated as compromised. Rotation and exact hosted/provider acceptance
are hard release blockers; copying the same values into Secret Manager is not a
rotation. Use this order:

1. Set `BUYER_ACCESS_ENABLED=false`, disable the public acceptance window, and
   stop backend/frontend promotions. Record the exact last-known-good and
   candidate revisions without recording any credential value.
2. Create fresh Resend and Stripe API credentials as new Firebase Secret
   Manager versions. Keep the old credentials temporarily active, deploy the
   exact reviewed least-privilege Function bindings, and prove quote delivery,
   payment send/reconciliation, integration status, and any enabled activation
   email path against that exact backend.
3. For each Stripe webhook secret being rotated, use the provider's overlap
   window: obtain the fresh provider secret while the old secret is still
   accepted, set the one Secret Manager value temporarily to `new,old` (at most
   two `whsec_` values), deploy the exact backend, and prove signed delivery and
   replay handling. Then set the binding to `new` only and redeploy the same
   accepted source. Do not revoke the old provider secret yet.
4. Rotate the Turnstile widget site key and
   `BUYER_ACCESS_TURNSTILE_SECRET` only while the buyer gate is off. Coordinate
   the new public site key in the exact frontend artifact with the new backend
   secret/hostname/action checks, deploy both accepted targets, and prove both
   canonical hosts plus wrong-host/action denial before reopening the gate.
5. If `BUYER_ACCESS_RATE_LIMIT_SECRET` is rotated, treat every HMAC-derived
   network, email, status, and request-reservation document identity as a fresh
   rate window. Leave old documents for the configured
   `buyerAccessRateLimits.expiresAt` TTL rather than deleting them. Close or
   obtain provider-verified void state for every in-flight buyer invoice before
   the change, using the signed `invoice.voided` webhook or the exact audited
   platform-admin recovery; exact retries may consume a new email window after
   rotation.
6. Run the exact target-scoped UAT checklist against the immutable candidate,
   including webhook overlap/new-only delivery, checkout reconciliation,
   optional Resend acceptance if enabled or claimed, Turnstile coordination,
   buyer retry/rate/TTL behavior, rollback proof, and provider readback. Only
   after every exact check passes may the old Resend key, Stripe API key,
   webhook signing secret, Turnstile key/secret, or HMAC key be revoked. If any
   check fails, keep the buyer gate off and roll back without revoking the
   last-known-good credential.

### Public $1 invoice-first buyer access on `tonicatering`

`/start` is a public test-invoice acquisition path on the existing production
Firebase project, not a second environment and not an approved live sales
channel. Stripe remains test mode for this buyer rail. The quote deposit and
final-balance rails retain their independently configured mode, key, signing
secret, event set, and `stripeWebhook`.

This source does not authorize a branch deploy, workstation deploy, provider
mutation, or live launch. Preparation source-binds only its production
configuration-validation and frontend-build steps to
`VITE_BUYER_ACCESS_ENABLED=true` and
`VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED=true` only with
`VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY`; `check:env` fails on a missing,
placeholder, malformed, or incoherent public configuration but cannot prove
Cloudflare setup or human review. Neutral unit tests run without those
production-only buyer flags. Browser variables are not backend authority.
Keep `BUYER_ACCESS_ENABLED=false` until the exact
candidate passes review and the merged-main, semantic-tag, target-specific UAT,
prepare-artifact, and separately owned trusted-deployer controls in section 6.

The following is the separately authorized production-project buyer activation
window. It is not the fixed pre-merge candidate profile and cannot be cited as
pre-merge candidate evidence for an unmerged release SHA. Until an immutable
exact-SHA non-production buyer-acceptance profile exists, the corresponding v3
candidate-plan items remain blocked.

For an approved hosted test-mode acceptance window:

1. Use only Firebase project `tonicatering`. Confirm Email/Password Auth,
   email-enumeration protection, and the canonical Firebase email-action domain
   are configured. Do not reuse an operator, customer, or existing tenant
   member as the buyer identity.
2. Configure one Turnstile widget for the exact public hosts
   `quotepilot.mbmapps.com` and `tonicatering.web.app`. Put its public site key
   in the GitHub environment variable
   `VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY`; bind its secret as
   `BUYER_ACCESS_TURNSTILE_SECRET` in Firebase Secret Manager. Never place the
   secret in a `VITE_*` variable, dotenv file, workflow, log, artifact, or
   evidence receipt.
3. Set trusted non-secret runtime configuration to
   `BUYER_ACCESS_STRIPE_MODE=test`,
   `BUYER_ACCESS_APP_BASE_URL=https://quotepilot.mbmapps.com/app`, and
   `BUYER_ACCESS_TURNSTILE_HOSTNAMES=quotepilot.mbmapps.com,tonicatering.web.app`.
   Keep `BUYER_ACCESS_ENABLED=false` until all bindings and the deployed
   revision are verified.
4. Bind a dedicated Stripe test key as `BUYER_ACCESS_STRIPE_SECRET_KEY` and the
   dedicated endpoint signing secret as `BUYER_ACCESS_STRIPE_WEBHOOK_SECRET` in
   Firebase Secret Manager. Generate a separate high-entropy value of at least
   32 characters for `BUYER_ACCESS_RATE_LIMIT_SECRET`; do not reuse a Stripe or
   Turnstile secret. Promote the tracked Firestore field override that enables
   TTL for the Timestamp field `buyerAccessRateLimits.expiresAt`, then verify
   the provider reports the policy enabled. Confirm dedicated buyer API requests
   use `2024-06-20`, and configure `buyerAccessStripeWebhook` for only the four
   invoice events above with endpoint API version `2024-06-20`. Leave the quote
   Stripe client and endpoint version unchanged. Provider console configuration
   is required; source declarations do not create the endpoint subscription.
5. Promote the exact reviewed frontend, Functions, and Firestore rules through
   the evidence-bound release path. The Vercel frontend and Firebase backend
   must identify the same accepted source revision. A prepared artifact or
   READY frontend alone does not prove invoice creation, payment, or activation.
6. Confirm the public form and CTA identify the fixed $1 USD Stripe test invoice
   truthfully and collect organization, owner, and invoice-email details without
   collecting a password or card data. A fresh Turnstile challenge must be
   required. Missing, replayed, wrong-action, wrong-host, malformed, and
   provider-error tokens must fail closed with no invoice.
7. Enable `BUYER_ACCESS_ENABLED` only for the bounded window. Exercise
   secret-keyed durable per-network and normalized-email rate limits plus
   request-scoped order idempotency. Confirm creation atomically reserves and
   charges network plus email before any Auth, invite, or order read; an exact
   retry charges the network budget again without double-charging email during
   the 24-hour Timestamp-backed reservation, and the fourth in-hour network
   attempt blocks before identity lookup. Confirm status polling permits the
   frontend's 48-attempt session, atomically blocks after 60 requests in five
   minutes from one network, charges well-formed unknown-order and wrong-token
   attempts before the order read, and performs no order read when the rate
   secret or Firestore transaction is unavailable. Verify raw network/email
   identity is absent from rate-document ids and the configured TTL removes an
   expired record. A safe retry must recover the same still-open invoice. A
   fresh request after the 24-hour email window may create a replacement only
   after the prior invoice has a provider-verified void state, established by
   the signed `invoice.voided` webhook or the exact platform-admin recovery
   below; the prior order is then superseded and stale events are ignored with
   durable dedupe evidence.
   Open and payment-failed orders may return the same invoice only to the exact
   original creation request. Uncollectible/expired, paid, and activation
   orders must reject automatic replacement. For a true uncollectible test
   Invoice, use Customer Provisioning or Integrations Ops -> Buyer Invoice
   Recovery only as a verified platform administrator. Enter the exact server order id and
   `VOID BUYER INVOICE <orderId>` confirmation. Prove the callable derives the
   provider identity, retrieves the exact test Invoice, permanently voids it at
   Stripe, rechecks that no organization/settings/invitation/provisioning
   artifacts exist, and records a private audit before replacement eligibility.
   Paid, open, partially paid, fulfilled, superseded, and mismatched targets
   must fail closed; recovery must not bypass the email window. Burst,
   cross-key, or expired requests must not create
   uncontrolled duplicates or disclose whether an account or invoice exists.
8. Use `createBuyerAccessInvoice` to create one fixed Starter $1 USD test
   invoice. Confirm Stripe finalizes the invoice before payment and QuotePilot
   returns only its true Stripe Hosted Invoice Page. Pay on Stripe, not in
   QuotePilot. The return and `getBuyerAccessInvoiceStatus` may report
   `invoice_open`, `payment_processing`, `provisioning`, or `activation_sent`,
   but must expose no `/app` access before verified activation. Token-bound
   `provisioning` with `workspaceReady=true` may stop automatic polling and
   offer `/app` only as a manual exact-invoice-email registration/sign-in and
   Firebase verification path; retain `Check again` for manual refresh. That
   handoff is not onboarding-email acceptance, membership, claims, or access,
   and only `active` is access-ready.
9. Confirm only a matching, signed, deduplicated invoice event establishes
   provider payment state. `invoice.paid` must prepare the organization, neutral
   settings, Starter workspace plan entitlements, provisioning record, pending
   invitation, and audit evidence, but no user membership, admin role, custom
   claims, or application access. `activation_sent` may appear only after the
   onboarding email provider accepts the exact activation-instructions message
   and that acceptance is durably recorded; do not call provider acceptance
   delivery. The onboarding message is optional for initiating the manual
   verified-email path. Separately prove Firebase verification-email delivery
   and the authorized continue URL. Only an exact matching verified Firebase account
   consuming the unexpired invitation may create user access and move the order
   to `active`.
10. Exercise `payment_failed`, `void`, and `expired` public states, exact-request
    open/payment-failed recovery, terminal-state replacement denial, the
    same-tab `Start a new test request` action, post-window signed-void and
    audited operator-void replacement, paid/open/partial/fulfilled repair
    denial, stale superseded events, webhook
    replay, unsupported or mixed-mode events, amount/currency/plan/invoice
    mismatch, expired invitation, unverified email, different email,
    cross-account claim, and repeated activation. None may create or restore a
    role or a second organization.
11. Before verified claim, read back the order, organization, neutral settings,
    Starter workspace plan entitlements, provisioning record, pending invite,
    and absence of user membership, admin role, custom claims, and application
    access. After claim, read back the consumed invitation, exact owner role and
    claims, active order, and `/app` access. Confirm every applicable buyer
    record has the server-owned controlled test-mode marker and remains excluded
    from live revenue and live paid-customer classification.
12. Separately confirm the live quote-payment `STRIPE_MODE`, credential
    bindings, `stripeWebhook`, deposit state, and final-balance state did not
    change. A buyer invoice event must never reach or mutate a quote payment
    rail.

Capture the Firebase project, exact source SHA, trusted deployment ids and
times, target-specific UAT receipt, redacted Turnstile outcome, redacted Stripe
test invoice/Event references, final buyer-order state, pending-invite evidence,
and exact tenant/role readback. Provider proof is still separately required for
the Turnstile widget, buyer Stripe API and endpoint version `2024-06-20`, Hosted
Invoice Page and event delivery, onboarding-email acceptance only if enabled or
claimed, and Firebase
verification-email delivery plus the authorized continue URL. Never include
personal data, tokens, secrets, signatures, hosted invoice URLs, or full private
provider identifiers in evidence. After the exercise, disable the server gate. Refunds, disputes,
cancellations, access revocation, support, tax/accounting, and live-mode launch
remain separate operating gates.

The current source handles deposit and final-balance collection as
separate payment rails. An exact approved deposit scope binds organization,
quote revision, portal issuance, customer email, currency, and deposit amount.
An exact final-balance scope is available only for a booked contract with a
verified provider-paid deposit. QuotePilot derives the remaining amount from
the authoritative total and deposit and additionally binds the contract,
deposit evidence, payment kind, and checkout generation. A versioned payment
ledger and distinct `payment.finalBalance` projection prevent final-balance
events from rewriting deposit truth.

For either rail, the server runs one governed, resumable operation: it
registers a new Session as `prepared` with no browser-readable link, stores
QuotePilot's URL copy in the server-only `privatePaymentDispatches` record, and
submits the matching payment-request email using approval-bound provider
idempotency. Only after email-provider acceptance is durably recorded does one
transaction publish the payment link to the quote and portal and complete the
approval. Direct standalone checkout creation fails closed. Signed events own
payment state, and the admin-only `Reconcile Payment` or `Reconcile Final
Balance` action re-reads the exact server-recorded Session without downgrading
settled truth or crossing payment rails. Customer-readable projections omit
Stripe Session, operation, known-Session, and private-dispatch identifiers.

Checkout creation and provider email are external calls, so “combined send” is
not an atomic provider/database claim. An ambiguous creation or email outcome
keeps the execution in progress and does not publish a link to the quote or
portal; any known prepared URL remains outside browser-readable app records.
Because an ambiguous email call may still have been accepted externally, retry
the exact approval as the same executing admin so QuotePilot reuses the same
Stripe-creation and email-provider keys. Durable provider acceptance converts
recovery to publication-only and must never send again. A definite email
failure may require a new approval only after the unsent checkout is
neutralized and the private URL cleared. If cleanup cannot be confirmed, keep
the exact execution resumable for retry or provider reconciliation.

Promote these rails only as one exact-revision frontend, Functions, and
Firestore rules rollout. The frontend exposes the separate send/resume and
reconciliation controls, Functions own approval scope/provider calls/webhook
transitions, and rules deny browser payment-evidence writes. A frontend-only or
backend-only promotion is not acceptance of this workflow. Provider secrets
remain in Firebase Secret Manager; the manual workflow materializes only the
reviewed non-secret runtime configuration immediately before deployment.

Provider acceptance must cover, first in hosted test mode and then under a
separate live-mode authorization:

1. An eligible quote with an exact deposit approval creates or safely reuses
   one scoped deposit Session and registers `prepared` state without writing
   its URL to any browser-readable QuotePilot record before provider dispatch.
2. A booked contract with verified provider-paid deposit evidence creates a
   separate final-balance approval and Session for only the server-derived
   remainder. Missing prerequisites, stale contract/deposit evidence, or a
   browser-supplied amount or payment kind fails closed.
3. A changed quote revision, portal issuance, recipient, amount, currency,
   contract, paid-deposit evidence, payment kind, or checkout generation
   invalidates the affected approval without changing the other rail.
4. An ambiguous Stripe-creation or email outcome leaves that exact approval
   resumable only for the same executing admin and reuses the same
   Stripe/provider identities; a changed actor fails closed. It does not
   publish the URL to the quote/portal or create an independent replacement
   checkout. Treat external email acceptance as unknown until reconciled by
   the same-key retry.
5. Durable email-provider acceptance precedes quote/portal publication. An
   induced publication interruption resumes without another provider send.
6. A definite provider failure safely neutralizes the unsent Session and
   clears its private URL before requiring a new approval; unresolved cleanup
   remains resumable instead of guessing.
7. The four configured webhook events produce paid, processing, failed, or
   expired results, accept a valid late settlement, reject replay, and cannot
   downgrade settled truth or apply an event to the other payment rail.
8. `Reconcile Payment` and `Reconcile Final Balance` each read only their
   server-recorded Session and either apply provider truth or record a
   review-required result; neither is a manual paid toggle.
9. Staff and customer surfaces expose only eligible, published payment actions
   and customer-safe state; unpublished links and private provider identifiers
   remain absent.

Refund initiation/status and dispute handling remain manual or unimplemented.
Do not infer either from a paid, failed, expired, or reconciled Checkout
Session.

## 6) Candidate UAT and Exact-Main Release Attestation

### 6.1 Pre-Merge UAT (Required for Production-Triggering Merge)

Pass all checks before merging a release-intent PR to `main`. For every
production target intended by the release, use the stable item ids, labels, and
v3 target applicability in `docs/release-uat-checklist.json`; changes to that
file change its SHA-256 digest and invalidate older attestations. The broader
source-acceptance list below also includes the portal backfill tool, which is a
separate data operation and is deliberately absent from deployment-target UAT.

Candidate assessment and exact-main attestation are distinct evidence stages.
The fixed candidate declares the machine-enforced `staging-safe-off` UAT
profile in both its hosted manifest and provider receipt. Print its exact plan
for a production target with:

```bash
npm run release:uat:plan -- \
  --target <firebase-hosting|firebase-backend|firebase-all|vercel> \
  --candidate-profile staging-safe-off
```

The JSON plan classifies every target-required item exactly once as
`applicable` or `blocked`, gives every blocked item a reason, and reports the
whole profile as `blocked` while any such item remains. `Applicable` means only
that the profile exposes the prerequisites for the check; it is not a pass.
`Blocked` is truthful pre-merge evidence of an unmet qualification gate, never
an omission, waiver, not-applicable result, or successful UAT. A safe-off
candidate may therefore prove its compatible UI, core authority, and disabled
boundaries without being misrepresented as production-qualified.

Deploy the exact clean, published `release/vX.Y.Z` head only after the canonical
`CI Quality` run for that SHA has all eight required jobs green. The guarded
command fixes provider scope to Firebase project/site
`quotepilot-staging-20260804` or Vercel project `quoteflow` preview and requires
a SHA-bound typed confirmation:

```bash
npm run release:candidate:deploy -- \
  --target firebase-all \
  --release-sha <full-release-branch-sha> \
  --ci-run-id <exact-successful-ci-run-id> \
  --confirm "DEPLOY CANDIDATE quotepilot-staging-20260804 <full-release-branch-sha>"

npm run release:candidate:deploy -- \
  --target vercel-preview \
  --release-sha <full-release-branch-sha> \
  --ci-run-id <exact-successful-ci-run-id> \
  --confirm "DEPLOY CANDIDATE quoteflow PREVIEW <full-release-branch-sha>"
```

The Firebase candidate requires a git-ignored, mode-`0600`
`functions/.env.quotepilot-staging-20260804` whose provider/send/buyer gates are
off, `STRIPE_MODE=test`, and the staffing, Commercial Change, Revenue Autopilot
preparation, and Revenue Autopilot send authority gates explicitly set to
`false`. The file must be a real regular file, use the exact staging `/app`
callbacks and approved inert identities, contain no plaintext secret or
disabled-provider residue, and contain no unreviewed variables. Before any
Firebase mutation, the command checks metadata only—never secret values—for an
enabled version of every Secret Manager name bound by the tracked Functions.
Missing metadata is a blocker and this command does not create placeholders.

Both candidates compile Ambient UI and the staffing browser surface on; that is
presentation evidence, not staffing or commercial write authority. The Vercel
preview build uses an explicit exact-staging validation profile; ordinary
`npm run check:env` remains production-only. Vercel also requires provider
readback showing the coordinated staging Functions retain every fail-closed
runtime value before it deploys the browser preview.

Use an authenticated local CLI or the provider token environment variable. The
command never uses a production target/alias. It exclusively reserves
`artifacts/release/candidates/<sha>/<target>.json` before provider mutation.
Build/preflight failures remain `failed`; an attempted provider mutation that
cannot be completely verified remains `partial`, including any deployment URL
or id already returned. A `verified` Firebase-all receipt binds the Hosting
release/version, every active Functions revision and safe runtime-config
readback, the Firestore release/ruleset and exact rules digest, and the hosted
SHA/gate manifest. It does not claim secret-value readback. This receipt is
candidate evidence, not deployment approval, production mutation,
provider-business acceptance, or human UAT.

The tracked all-positive item list remains available with
`npm run release:uat:items -- --target <profile>`. Production qualification
still requires every printed target item to pass exactly once. The exact-main
`Release UAT Attestation` accepts only that complete positive set; it accepts no
candidate profile, blocked item, N/A marker, or partial plan. If the safe-off
plan blocks a required path, use a separately reviewed immutable acceptance
deployment whose authority and provider scope can exercise that path, or stop
the release. Do not enable a gate on the fixed safe-off candidate or edit a
blocked result into a pass.

For any release containing either Stripe collection rail, the applicable
tracked `payment.*` items are mandatory, not optional spot checks. The exact
target item set covers deposit dispatch, final-balance dispatch,
signed-webhook/reconciliation behavior, cross-rail isolation, customer-safe
projection, and customer/staff payment surfaces as applicable. For each
selected release target, run
`npm run release:uat:items -- --target <profile>` and complete all and only the
printed ids against the exact coordinated hosted candidate. Local unit, rules,
or emulator success is source evidence;
it does not satisfy hosted payment UAT or establish Stripe test/live provider
acceptance. A target attestation also does not prove the SHA or identity of an
unbound frontend/backend dependency, so retain a separate provider acceptance
record tying the coordinated frontend, Functions, and rules revision together.

For any release containing public buyer onboarding, every applicable `buyer.*`
item is also mandatory. Browser-target items cover public Turnstile entry,
truthful Stripe test-invoice labeling, locked pending state, activation
instructions, proof-safe manual `/app` account setup after
`workspaceReady=true`, automatic-poll stop with manual refresh, and `/app`
denial before server-confirmed access; they do not
prove email-provider acceptance or backend fulfillment. Backend-target items
cover exact Turnstile verification, durable rate limits, retry idempotency, a
true Hosted Invoice Page, buyer API and webhook version `2024-06-20`, signed
invoice lifecycle, paid workspace preparation, pending invitation without user
access, any claimed onboarding-email provider acceptance before
`activation_sent`, separate Firebase verification-email delivery and continue
URL, exact-email
claim, real `tonicatering` tenant/role readback, controlled-test markers,
negative paths, and quote-Stripe isolation. A Hosting or Vercel receipt cannot
prove an unbound backend or provider, and a backend receipt cannot prove the
browser surface; retain the coordinated provider records. Test records must not
be counted as live revenue or a live paid customer.

For any release containing email/password recovery, complete
`auth.password-recovery` with a designated test account and an unknown address.
Prove the action changes the designated password and returns to the canonical
`/app` URL, then retain read-only provider evidence that email-enumeration
protection is enabled and the continue domain is authorized. The same rendered
confirmation alone is not network-level enumeration protection, and public
registration remains a separate abuse-control boundary.

For any release containing authoritative operational staffing, all applicable
`staffing.*` items are mandatory. The fixed safe-off candidate can prove only
the disabled-authority boundary. Positive hosted acceptance requires a
separately authorized non-production window with the global server gate, exact
disposable tenant gate, and matching presentation gate deliberately enabled;
it must cover same-tenant roles, profile and availability recording, exact-
revision partial and complete plans, conflict and replay behavior, immutable
receipts, responsive accessible recovery, cross-tenant denial, non-mutation of
commercial/customer evidence, and three-gate rollback. Local emulator success
does not satisfy these hosted items.

1. CI is fully green:
   - `Classify Changes + Lane Plan`
   - `lane:quick (Preflight + Secrets)`
   - `lane:core (Unit + Build + Governance + Bundle)`
   - `Docker Build Smoke`
   - `lane:playwright-smoke`
   - `lane:firebase-auth-rules`
   - `lane:authoritative-pricing`
   - `lane:cwv-smoke`
2. Record the exact candidate SHA and immutable candidate deployment id/URL,
   then manually verify the production-critical paths:
   - quote save succeeds,
   - Firebase quote creation is re-priced by the trusted callable and persists
     a draft quote, matching portal snapshot, and initial version,
   - an eligible quote edit is server-repriced and atomically updates the quote
     and portal while adding a version,
   - terminal evidence blocks edit/reopen, generic staff writes cannot claim
     `sent` or `viewed`, and direct quote/portal deletes fail,
   - an admin expiry changes the quote and matching portal atomically, a
     quote-only or portal-only expiry fails, and `Reopen` restores an eligible
     expired record as a draft with a new portal issuance,
   - quote history row appears and opens,
   - provider acceptance for the exact current valid issuance records `sent`
     and activates that portal, while acceptance for an invalid or expired
     issuance is retained as `requires_rotation` with the portal inactive,
   - guarded rotation invalidates the prior issuance and withholds both Copy
     Portal and the PDF portal link until a separate send accepts the new one,
   - an expired definite provider failure starts a fresh delivery generation,
     an ambiguous outcome remains locked for review, and a server-observed
     provider message ID cannot be reconciled as no-send,
   - a quote that expires during unresolved delivery remains visible for review;
     completing reconciliation reloads it into the paired expiry/Reopen path,
   - a legacy portal projection without `deliveryEvidence` stays inactive and
     is recoverable only through an approved resend or truthful provider
     reconciliation,
   - each sensitive action consumes only its exact approved request, writes a
     server-owned organization-scoped outcome audit, and a completed replay
     returns the stored result without executing again,
   - the deposit approval is invalidated by any change to its quote revision,
     portal issuance, customer email, currency, or deposit amount; the valid
     action privately registers prepared state, durably records provider
     dispatch/acceptance, and only then publishes the payment link, while
     direct checkout creation fails closed,
   - final-balance collection requires a booked contract and verified
     provider-paid deposit, derives only the authoritative remainder, and binds
     the contract, deposit evidence, revision, portal, customer, amount,
     currency, payment kind, and generation into a separate approval, ledger
     entry, and projection; stale scope or missing prerequisites fail closed,
   - an ambiguous checkout/email outcome on either rail resumes the exact
     approval with the same executing admin and provider keys and no
     quote/portal link; external email acceptance remains unknown until
     same-key retry. Durable provider acceptance resumes publication without
     resending; a definite failure neutralizes and clears the unsent checkout
     before a new approval becomes eligible,
   - explicit Stripe mode, key prefix, Event `livemode`, and Session `livemode`
     agree; all four configured Checkout Session events transition provider
     state, reject replay, accept valid late settlement, and do not downgrade
     paid/refunded truth or cross payment rails; each same-tenant admin
     reconciliation reads only the server-recorded Session for its rail,
   - customer and staff payment surfaces keep unpublished links and Stripe
     Session, operation, known-Session, and private-dispatch identifiers out of
     customer-readable projections while exposing each eligible rail
     independently,
   - an accepted quote converts only through the exact approved server action
     to one booked contract with a server-owned contract number and availability
     result; unapproved or mismatched conversion fails closed,
   - as separate source/data-operation acceptance, the tenant-scoped portal
     projection backfill is read-only in dry-run, transactionally rechecks
     apply, leaves foreign, inactive, identity, and commercial-evidence
     conflicts unchanged, and never creates `deliveryEvidence`; this check is
     not evidence for a Hosting, Functions/rules, or Vercel payload,
   - the retired legacy bulk quote purge callable fails closed without mutation
     and its staff control is absent; within a retained organization, permanent
     quote deletion succeeds only one quote at a time through an exact approved
     `delete_quote` request. Separately governed platform-admin teardown of an
     archived organization is outside this per-quote claim,
   - customer portal view and accept/decline paths update their owned state,
   - PDF export succeeds and omits any portal link without current issuance
     evidence,
   - Integrations Ops setup assistant loads and reports status,
   - SMS test path returns disabled/not configured when
     `NOTIFICATIONS_SMS_PROVIDER=none` without blocking core flow.
   - for public buyer onboarding, a fresh server-verified Turnstile challenge
     may create only one idempotent fixed $1 USD Stripe test invoice and true
     Hosted Invoice Page while rate-limit, replay, wrong-host/action, and
     provider-error paths fail closed; dedicated buyer API requests and webhook
     events use `2024-06-20` while the quote Stripe version stays unchanged;
     `invoice.paid` prepares the organization, neutral settings, Starter
     workspace plan entitlements, provisioning record, and pending invite but
     no user membership, admin role, claims, or access; `workspaceReady=true`
     offers only a manual exact-email Firebase activation path and stops
     automatic polling, while `activation_sent` requires durable provider
     acceptance of the optional onboarding email. Firebase
     verification-email delivery and continue URL are separately evidenced, and
     only exact-email verified invitation consumption creates user access; every
     buyer record carries the controlled test-mode marker, reporting excludes it
     from live revenue and paid-customer counts, mismatch/failure/replay/cross-
     account paths create or restore no access, and the live quote Stripe
     configuration plus deposit/final-balance state remain unchanged.
3. Confirm rollback target:
   - the provider-specific last-known-good deployment receipt and commit SHA
     are documented,
   - that receipt remains unchanged until the replacement deployment is
     provider-accepted and post-launch verification succeeds.

For a tenant-provisioning release, also complete the disposable owner acceptance
checklist in `docs/USER_MANUAL.md`. At minimum, prove verified platform-admin
authority, unverified owner denial, exact-email invitation activation, neutral
blank-catalog setup, package/event/pricing approval, quote save and readback,
signed-out portal acceptance, cross-tenant denial, and exact cleanup. The
emulator matrix in `scripts/provisioning-emulator-acceptance.mjs` is local
evidence only; repeat the customer-visible flow against the exact hosted
release before calling production onboarding seamless.

### 6.2 Exact-Main Deployment

After the reviewed PR merges:

1. Record the full current `main` SHA. Wait for the `push`-event `CI Quality`
   run for that exact SHA and confirm all eight named jobs succeeded. Record its
   numeric run id; a PR merge-ref run is not accepted.
2. Exercise an immutable exact-SHA preview when the release risk warrants it.
   The optional `Release UAT Attestation` workflow can record human acceptance,
   but the normal solo deployment does not depend on that separate ceremony.
   This workflow runs only from the exact `main` SHA after exact-main CI and
   records only the complete all-positive target checklist. It is not the
   pre-merge candidate assessment and cannot convert a blocked profile plan
   into acceptance.
3. Create and publish the semantic version tag on that same SHA.
4. Confirm the target-specific last-known-good rollback SHA remains an ancestor
   of the release SHA.
5. Dispatch `Deploy Firebase Production` or `Deploy Vercel Production` with:
   - `release_sha`: the full tagged current-main SHA,
   - `ci_run_id`: the exact successful main-push CI run id,
   - `rollback_sha`: the full target-specific last-known-good ancestor,
   - `firebase_scope`: `hosting`, `backend`, or `all` when applicable,
   - `confirmation`: the exact target-specific `DEPLOY ...` phrase displayed by
     the workflow.
6. The workflow must fail before dependency execution if the tag, remote main,
   CI jobs, workflow identity, human actor, protected environment, allowlist,
   rollback, or confirmation is wrong. It repeats the evidence check after the
   build and immediately before provider mutation. Reruns are rejected; start a
   fresh dispatch instead.
7. Record the provider deployment id and accepted/READY state, but retain the
   existing target-specific last-known-good receipt.
8. Complete the post-launch verification in section 7. Only after every check
   succeeds, sign the new target-specific last-known-good receipt. On failure,
   keep the prior receipt authoritative and begin the rollback sequence.

The verifier reads GitHub evidence live before installation and again before
mutation. A protected-environment error, missing/failed/skipped CI job, wrong
workflow/repository/SHA, non-ancestor rollback, administrator bypass, or
disallowed actor stops deployment.

Target applicability limits what one receipt claims. Hosting and Vercel items
cover the built SPA plus observed compatibility with its test environment;
backend items cover the deployed Functions/rules surface; `firebase-all` is the
union of the Firebase Hosting and backend item sets, not a cross-provider
profile. No receipt proves the SHA or provider identity of an unbound dependency.

## 7) Post-Launch Verification

Before testing legacy customer records, run the customer portal projection
backfill as a separately reviewed production-data operation. Projection
backfill may normalize eligible portal data, but it must not create
`deliveryEvidence`, activate a portal, or infer provider acceptance. A legacy
projection that lacks delivery evidence must continue to fail closed and be
recovered through an approved resend or truthful provider reconciliation.
Start with a tenant-scoped dry run and retain its aggregate evidence:

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
from deployment, merge, UAT, or release approval, and never copy portal tokens
or customer data into release evidence.

For a release containing public buyer onboarding, retain the provider-bound
acceptance records from the invoice-first section and repeat the paid-invoice,
workspace preparation, pending invite, proof-safe manual account-setup handoff,
any claimed onboarding-email provider acceptance, separate Firebase
verification-email delivery, verified-email claim,
active-order, and `/app` handoff after promotion. Confirm the workspace plan
entitlements exist after paid preparation while no user membership, role,
claims, or access exists before verified invitation consumption. Confirm
controlled test-mode markers remain present and reporting excludes the records
from live revenue and paid-customer counts. Confirm the server gate is in its
approved post-test state and recheck that the quote Stripe rail and its API
version did not change. Stripe test-mode acceptance is not post-launch evidence
for live billing.

For a release containing either Stripe collection rail, retain a separate
provider acceptance record for deposit and final balance. Exercise the exact
coordinated frontend/Functions/rules revision first against an isolated hosted
`STRIPE_MODE=test` runtime with all four webhook subscriptions. For each rail,
exercise exact approval scope, private prepared state, ambiguous same-key
recovery, publication-only recovery after durable acceptance, definite-failure
cleanup, signed-event replay protection, reconciliation, and customer-safe
projection. Also prove that Session metadata and stored scope prevent an event
or reconciliation from crossing rails. After explicit production
authorization, verify the matching `STRIPE_MODE=live` runtime and capture a
controlled request, provider event, customer payment-state refresh, and admin
reconciliation observation separately for each enabled rail. Redact keys,
signatures, portal tokens, private provider identifiers, and customer data from
evidence. Test-mode success is not live-mode acceptance. Neither mode proves
refund or dispute automation; those workflows remain manual or unimplemented.

1. Create a quote end-to-end.
2. Confirm quote appears in history.
3. Export the draft PDF and confirm it contains no inactive portal link.
4. Submit the exact saved revision and confirm provider acceptance creates
   current-issuance activation evidence before Copy Portal or the PDF portal
   link becomes available.
5. Rotate the portal and confirm both link surfaces are withheld until the new
   issuance receives a separate provider-accepted send.
6. Expire an eligible nonterminal quote and confirm the quote and public
   projection leave the active portal surface together. Use `Reopen` and confirm
   it returns as a draft with a new portal issuance; the prior token stays
   unusable.
7. Verify customer portal view and accept/decline updates.
   - Confirm the public snapshot and organization quote carry the same
     structured decision and timestamp.
   - Confirm a second public request cannot flip an accepted/declined outcome.
8. Confirm a legacy projection without `deliveryEvidence` stays inactive and
   the recovery path does not fabricate acceptance evidence.
9. For an enabled Stripe release, verify deposit and final-balance actions,
   customer state, webhook/reconciliation results, and cross-rail isolation
   against the exact coordinated revision. Record each provider proof layer
   separately from the release attestation.
10. Validate mobile layout and key interaction flows.

## 8) Rollback

Rollback is artifact-first and target-specific. A Git ancestor alone is not a
rollback artifact. Before any promotion, preserve a signed last-known-good
receipt containing the provider project and deployment id, source SHA, artifact
and non-secret configuration digests, target surface, and observed healthy
state.

For an incident:

1. Obtain explicit incident authorization and record the operator, target,
   reason, and start time.
2. Select the target's recorded last-known-good provider deployment or exact
   immutable artifact. Do not rebuild it from a Git checkout during the
   incident.
3. Use the provider-native rollback control to restore only the exact recorded
   deployment for the affected target. If a workflow dispatch is required,
   retain the same exact-SHA, target, and typed-confirmation gates.
4. Prefer provider-native restoration of the previously accepted Hosting or
   Vercel deployment. For Functions or Firestore rules, perform a compatibility
   review before restoring the prior target-specific artifact; do not widen a
   backend incident into an unreviewed `hosting,firestore,functions` mutation.
5. Repeat the post-launch checks, record provider acceptance/READY state and
   health evidence, then close the incident. Keep the prior receipt until the
   restored target is verified.

Signed provider-specific last-known-good receipts remain a follow-up hardening
item. Until they are automated, retain the exact provider deployment id, source
SHA, target, timestamp, and post-launch result manually. Local `npx` commands
are not an approved break-glass substitute.
