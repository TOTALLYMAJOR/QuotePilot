# QuotePilot by MBMapps

Multi-tenant catering quote application built with React, Vite, Firebase, and jsPDF.

## Quick Links
- Live app: https://quotepilot.mbmapps.com
- Firebase Hosting origin/fallback: https://tonicatering.web.app
- Repository: https://github.com/TOTALLYMAJOR/quoteflow
- Launch runbook: [docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md)
- User manual: [docs/USER_MANUAL.md](docs/USER_MANUAL.md)
- Feature matrix: [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md)
- Orchestration blueprint: [docs/ORCHESTRATION_BLUEPRINT.md](docs/ORCHESTRATION_BLUEPRINT.md)
- Orchestration runbook: [docs/ORCHESTRATION_RUNBOOK.md](docs/ORCHESTRATION_RUNBOOK.md)
- Canonical doc system: [docs/DOC_SYSTEM.md](docs/DOC_SYSTEM.md)

## Application Routes
- `/`: hospitality-first public QuotePilot marketing page.
- `/system`: saved dark product and operating-system overview.
- `/app`: authenticated staff quote workspace.
- `/start`: public invoice-first $1 Stripe test buyer flow when the reviewed
  browser flags and Turnstile site key are present; the independently disabled
  server gate still prevents initiation until backend release approval.
- `/?portal=<token>` or `/app?portal=<token>`: customer proposal portal; existing token links remain compatible.

## Product Scope
The app supports a 5-step quote wizard, dynamic event-type menus, pricing
configuration, proposal export, customer portal updates, tenant-locked
customer/catalog CSV imports, server-authoritative deposit and final-balance
collection in the current source candidate, public invoice-first buyer
onboarding on the existing `tonicatering` Firebase project, and operations workflows
(history, scheduling, reporting, diagnostics).

Tenant safety mode:
- Firebase tenant business reads/writes fail closed when `organizationId` context is missing.
- Legacy global business collections are retired for runtime access.

## Architecture Snapshot
- Frontend: React 18 + Vite 7
- Data/Auth: Firebase Firestore + Firebase Auth
- Server runtime: Firebase Functions on Node.js 22 with modular Firebase Admin SDK APIs
- Public custom domain: Vercel (`https://quotepilot.mbmapps.com`)
- Firebase Hosting origin/fallback: `https://tonicatering.web.app`
- Local runtime options: VS Code Dev Container (recommended), Node (`npm run dev`), or Docker Compose (`web-dev` / `web`)

## Local Setup
### Prerequisites
- Node.js 22+
- npm

### Install + Validate
```bash
npm install
npm run check:env
```

### Run (Node)
```bash
npm run dev
```

### Run (VS Code Dev Container, isolated)
Prerequisites:
- Docker Desktop
- VS Code with Dev Containers extension

Steps:
1. Open the QuotePilot repository folder in VS Code.
2. Run `Dev Containers: Reopen in Container`.
3. In the container terminal, run:

```bash
npm run dev
```

The app is served on `http://localhost:5173`.

### Run (Docker)
Dev server:
```bash
docker compose up --build web-dev
```

Production-like image:
```bash
docker compose up --build web
```

## Environment
Create `.env` from `.env.example` and set required Firebase keys:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Optional:
- `VITE_FIREBASE_FUNCTIONS_REGION`
- `VITE_APP_HOST`
- `VITE_APP_URL` (exact canonical
  `https://quotepilot.mbmapps.com/app` return URL for Firebase email actions;
  its domain must be authorized in Firebase Authentication; loopback HTTP is
  accepted only for local development)
- `VITE_BUYER_ACCESS_ENABLED` (defaults off for generic builds; the production
  preparation workflows source-bind it to `true` only alongside syntactically
  valid non-placeholder public flow configuration; provider setup and human
  review remain separate evidence)
- `VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED` (defaults off; production preparation
  source-binds it to `true`, but `check:env` rejects it unless the route is also
  enabled and Turnstile is configured)
- `VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY` (browser-visible public site key;
  required with valid non-placeholder syntax when buyer access is compiled,
  never use the Turnstile secret here, and do not treat syntax as provider or
  human-review evidence)

To create `.env.local` from the authenticated Firebase project config without
touching `.env`, run:
```bash
npm run env:local:firebase -- --project tonicatering
```
The command is create-only by default. If `.env.local` already exists, it
refuses to overwrite it. An intentional replacement requires both `--replace`
and the exact confirmation token printed by the command.

The root `.env.example` is for browser-safe `VITE_*` values only. Server-side
Firebase Functions placeholders live in
[`functions/.env.example`](functions/.env.example). Copy that template to an
ignored `functions/.env.<firebase-project-id>` file only for local/emulator
validation; that file is non-secret configuration only. Bound-secret emulator
fixtures belong in the separately ignored `functions/.secret.local`; never put
production provider credentials in either file or commit real provider
credentials. Confirm the target is ignored with
`git check-ignore -v functions/.env.<firebase-project-id>` and
`git check-ignore -v functions/.secret.local` before adding any non-production
value.

Stripe Functions configuration requires an explicit `STRIPE_MODE` value of
`test` or `live`, a secret/restricted key with the matching mode prefix, and a
webhook secret. Event and Checkout Session `livemode` must also match. The
tracked Functions template and materializer contain only `STRIPE_MODE`;
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `RESEND_API_KEY` are Firebase
Secret Manager values bound only to Functions that consume them. The
materializer rejects all three. Use the credential-isolated runtime channel
described in the [launch runbook](docs/LAUNCH_RUNBOOK.md) and never place real
provider values in a browser environment, Functions dotenv, or committed file.

Buyer onboarding uses a separate server-only Stripe test rail. Its non-secret
runtime inventory is `BUYER_ACCESS_ENABLED`, `BUYER_ACCESS_STRIPE_MODE=test`,
`BUYER_ACCESS_APP_BASE_URL=https://quotepilot.mbmapps.com/app`, and
`BUYER_ACCESS_TURNSTILE_HOSTNAMES=quotepilot.mbmapps.com,tonicatering.web.app`.
Store `BUYER_ACCESS_STRIPE_SECRET_KEY`,
`BUYER_ACCESS_STRIPE_WEBHOOK_SECRET`, `BUYER_ACCESS_TURNSTILE_SECRET`, and an
independently generated `BUYER_ACCESS_RATE_LIMIT_SECRET` of at least 32
characters only in Firebase Secret Manager; none belongs in a Functions dotenv
file, GitHub preparation job, browser variable, log, or release receipt. Do not
reuse a Stripe or Turnstile secret as the rate-limit key. The server gate
defaults off. The existing quote-payment `STRIPE_MODE`, credentials, and
`stripeWebhook` remain independent and unchanged.

The policy-enforcing repository preparation workflow packages Functions source without loading or
materializing runtime secrets. Every `.env` file is excluded from the artifact.
A separately owned trusted deployer must validate and materialize the approved
Functions runtime configuration inside its credential-isolated boundary. The
approved sender identity in configuration does not prove the Resend domain is
verified or enabled; see [PROJECT_STATUS.md](PROJECT_STATUS.md) for provider
truth.

## Quality Gates
```bash
npm run check:env
npm run test:unit
npm run test:rules:firestore
npm run test:e2e
npm run test:e2e:firebase
npm run test:e2e:firebase:authoritative
npm run build
npm run check:secrets
npm run check:workflows
npm run check:docs:governance
npm run check:perf:bundle
npm run check:perf:cwv
```

`check:workflows` downloads only the platform-specific official actionlint
v1.7.12 archive, verifies its repository-pinned SHA-256, and checks every
tracked GitHub Actions workflow. The required `lane:quick` runs this gate before
dependency installation and disables host-provided shellcheck/pyflakes
integrations so runner tool versions cannot change the result.

## Orchestration Lanes
```bash
npm run lane:quick
npm run lane:core
npm run lane:firebase-auth-rules
npm run lane:authoritative-pricing
npm run lane:release
npm run lane:release:cwv
```

The CWV release lane uses `LHCI_COLLECT__CHROME_PATH` when supplied; otherwise
it selects the installed Playwright Chromium and fails with an installation
instruction if that browser is unavailable.

## E2E Test Lanes
- `npm run test:e2e`
  - Default browser smoke lane.
  - Excludes Firebase emulator-only specs; those run in the dedicated Firebase
    lanes below.
  - Uses `scripts/run-playwright.sh`, which auto-prepares Linux Playwright runtime libs under `.cache/playwright-libs` when needed.
- `npm run test:e2e:firebase`
  - Firebase emulator browser lane for real Auth, organization bootstrap, and
    Firestore rules coverage.
  - Starts `auth`, `firestore`, and `functions` emulators, seeds
    org/menu/userRole fixtures, signs in via UI, and validates the
    organization-scoped catalog loaded through the application.
  - Uses the isolated `firebase.e2e.json` configuration and dedicated high
    ports. A port conflict fails the lane; the runner does not terminate another
    local process.
  - Requires Java 21 or newer. When the system Java is missing or older, the
    runner prepares and explicitly selects a local JRE under
    `.cache/tools/jre21`.
- `npm run test:e2e:firebase:authoritative`
  - Firebase emulator browser lane that also starts Functions emulator.
  - Requires authoritative pricing callable success and trusted quote creation
    in the save path (no client-only pricing fallback).
- `scripts/provisioning-emulator-acceptance.mjs`
  - Full emulator-only platform/tenant lifecycle matrix run under Auth,
    Firestore, and Functions emulators.
  - Covers provisioning authority, owner activation, trusted quote and portal
    behavior, provider/payment failure boundaries, cleanup, and
    server-authoritative approval request, resolution, exact governed-action
    execution, outcome audit, idempotency, replay protection, and separate
    signed-webhook acceptance for deposit and final-balance collection.
  - The runner refuses non-`demo-*` projects or missing emulator host variables;
    it is local evidence and does not replace hosted tenant acceptance.

Optional env vars for Firebase emulator lane:
- `E2E_FIREBASE_PROJECT_ID` (default: `demo-e2e`)
- `E2E_FIREBASE_ORG_ID` (default: `e2e-org`)
- `E2E_FIREBASE_EMAIL` (default: `e2e-admin@local.test`)
- `E2E_FIREBASE_PASSWORD` (default: `Passw0rd!`)

## Firestore Tenant Seed
Preview baseline event types, menu records, catalog items, and pricing settings
for one existing organization that is not marked inactive or archived. The
command is read-only by default:
```bash
npm run seed:menu:firestore -- \
  --project <firebase-project-id> \
  --organization <organization-id>
```

To preview one of the same starter packs shown during owner catalog setup, add
`--pack` (and optionally an exact historical `--pack-version`):
```bash
npm run seed:menu:firestore -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --pack wedding-events \
  --pack-version 1
```

The available pack ids are `wedding-events`, `corporate-drop-off`,
`bbq-southern`, and `church-community`. Add `--replace-staged-pack` only when
replacing an unconfirmed staged pack; the transaction refuses replacement if
any generated record or pack-controlled pricing setting has been edited.
Published manifest versions are append-only while referenced by a staged
organization; add a new version instead of editing or removing an existing one.

Apply requires both `--apply` and an exact project-and-tenant confirmation:
```bash
npm run seed:menu:firestore -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --apply \
  --confirm "SEED <firebase-project-id> <organization-id>"
```

Notes:
- Project and organization scope must be explicit; environment-derived targets
  and unknown arguments are rejected.
- The target organization must already exist and must not be marked inactive
  or archived.
- Apply creates only missing seed documents. Create operations fail on a
  concurrent identity collision instead of replacing the new record.
- Existing menu items are patched only when `pricingType`, `type`, or `active`
  is missing. Other existing fields and documents are not replaced or deleted.
- The organization record itself is read for validation and is not rewritten.
- Auth uses Firebase Admin ADC/service credentials (`GOOGLE_APPLICATION_CREDENTIALS`) or emulator config.

## Multi-Tenant Migration Safety

The legacy-to-tenant migration is read-only unless `--apply` is explicitly
selected. Both modes require exact project and organization scope:

```bash
npm run migrate:multi-tenant -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --dry-run
```

Apply additionally requires an exact scope-bound confirmation:

```bash
npm run migrate:multi-tenant -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --apply \
  --confirm "MIGRATE <firebase-project-id> <organization-id>"
```

Do not reuse a confirmation for a different project or tenant.

## Customer Portal Projection Backfill

Legacy active customer portal records can be inspected and refreshed from their
organization-scoped quote without replacing customer decisions, payment or
booking evidence, lifecycle history, or unrecognized operator fields. The
command is read-only by default and requires explicit project and organization
scope:

```bash
npm run portal:backfill -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --dry-run \
  --evidence-out <new-evidence-file.json>
```

Review the count-only evidence and resolve every conflict before applying. An
apply requires Firebase Admin Application Default Credentials, a new evidence
path, and an exact scope-bound confirmation:

```bash
npm run portal:backfill -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --apply \
  --confirm "BACKFILL PORTALS <firebase-project-id> <organization-id>" \
  --evidence-out <new-evidence-file.json>
```

Apply mode re-reads each quote and portal in a transaction before writing. It
skips foreign-tenant, deleted, expired, identity-mismatched, and conflicting
commercial records. The create-only private (`0600`) evidence destination is
reserved before any database work and completed atomically with aggregate
counts rather than portal tokens or customer data.

## Stripe Deposit and Final-Balance Workflows (Source Candidate)

The current source candidate implements deposit and final-balance collection as
separate server-authoritative payment rails. An approved deposit request binds
the organization, quote revision, current portal issuance, customer email,
currency, and deposit amount. A final-balance request additionally requires a
booked contract and verified provider-paid deposit; QuotePilot derives the
remaining amount from the authoritative total and deposit and binds the
contract, deposit evidence, revision, portal, customer, currency, amount, and
checkout generation into its own approval. A versioned ledger and distinct
`payment.finalBalance` projection prevent either rail from rewriting the
other's evidence.

For either rail, a new Checkout Session is first registered as `prepared` with
no browser-readable payment link; QuotePilot retains its URL only in a
server-only dispatch record. The server submits the matching payment-request
email and publishes the link to the quote and customer portal only after
provider acceptance is durably recorded. The browser cannot create a
standalone checkout, choose a payment kind or amount, or mark payment evidence
manually. The customer projection omits Stripe Session and private-dispatch
identifiers.

If Stripe creation or email delivery has an ambiguous outcome, the approval
execution remains in progress. The same admin uses `Resume Pay Request` or
`Resume Balance Request`, which reuses the Stripe-creation and email-provider
identities; when a prepared Session is known, it is reused. If provider
acceptance was recorded but database publication was interrupted, resume
finishes publication without sending again. A definite email failure clears
the private URL and requires a new approval only after the unsent Session is
safely neutralized; unresolved cleanup stays resumable for retry or provider
reconciliation. Late provider settlement may promote a failed or expired
observation to paid without reopening or crossing payment rails.

Payment state is driven by signed, deduplicated
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, and `checkout.session.expired` events.
Admin reconciliation re-reads the exact server-recorded Session for the
selected rail when provider delivery needs review, without overriding settled
payment truth or mutating the other rail.

This behavior is source/local evidence only. The repository preparation
workflow does not deploy it, configure Stripe, or prove provider acceptance.
Release requires one coordinated exact-revision frontend, Functions, and
Firestore rules promotion plus mandatory hosted payment UAT in Stripe test
mode and separately authorized live-mode acceptance for each enabled rail.
Refund initiation/status and dispute handling remain manual or unimplemented.
See the
[launch runbook](docs/LAUNCH_RUNBOOK.md#5-functions-runtime-configuration-optional-stripe--twilio--resend-providers)
for configuration and proof requirements.

## Public $1 Invoice-First Buyer Access (`tonicatering`)

The `feature/paid-buyer-onboarding` source candidate adds a public acquisition
path at `/start` without creating a second Firebase environment. The buyer
enters organization, owner, and invoice-email details and completes a fresh
Turnstile challenge. QuotePilot does not collect a password or card details at
this step. Server-side Turnstile hostname/action checks, durable rate limits,
and deterministic idempotency guard initiation; Turnstile is an abuse signal,
not identity, payment, or authorization evidence.

Rate-document identities are HMAC-keyed with the dedicated rate-limit secret;
raw network addresses and normalized emails are not stored in those document
ids. Once per public status request, the callable atomically consumes a
60-request-per-five-minute network lease before its first buyer-order read,
including well-formed unknown-order and wrong-token attempts, and fails closed
when its secret or Firestore limiter is unavailable. Any subsequent fulfillment
reads remain inside that bounded request. Each rate record includes an
`expiresAt` Firestore Timestamp;
the trusted deployer must enable the matching TTL policy on
`buyerAccessRateLimits.expiresAt` before opening the server gate.
Invoice creation first reserves the request-scoped order identity in the same
durable limiter before any Auth, invitation, or order lookup. An exact retry
continues to consume the per-network budget but does not charge the normalized
email twice during the 24-hour reservation. A different request may replace an
older order only after the email window has elapsed and a signed webhook has
put every prior same-email order in true `void` state. Open and payment-failed
orders may return the same invoice only to the exact original creation request.
Uncollectible/expired, paid, and activation orders cannot be replaced
automatically. They continue only through the existing status/account path or a
documented operator stop; no buyer-specific repair callable exists, so live sale
remains blocked until audited recovery is implemented. The old void order is
marked superseded so a stale event cannot provision a second workspace.

The Firebase Hosting and Vercel preparation workflows compile `/start` and its
public marketing CTA only with a syntactically valid, non-placeholder,
browser-visible Turnstile site key. `check:env` does not verify Cloudflare
provider setup or human approval. Runtime remains fail closed until the
dedicated Functions are promoted and the separate
`BUYER_ACCESS_ENABLED=true` server gate is explicitly approved; browser flags
never authorize invoice creation.

The `createBuyerAccessInvoice` callable fixes the offer to Starter access, $1
USD, and Stripe test mode. It creates and finalizes a true Stripe invoice before
payment and returns only the Stripe Hosted Invoice Page. The dedicated buyer
Stripe client and `buyerAccessStripeWebhook` endpoint are pinned to API version
`2024-06-20`; the generic quote Stripe client and version remain unchanged.
Dedicated buyer Secret Manager credentials and the endpoint remain isolated
from the existing live quote payment mode, key, `stripeWebhook`, deposit, and
final-balance rails. The buyer endpoint accepts only `invoice.paid`,
`invoice.payment_failed`, `invoice.voided`, and
`invoice.marked_uncollectible`. A retry must recover the same still-open invoice
instead of creating uncontrolled duplicates.

The browser return and `getBuyerAccessInvoiceStatus` are not fulfillment
evidence. Only a matching signed and deduplicated invoice lifecycle event may
establish paid state. `invoice.paid` prepares the organization, neutral
settings, Starter workspace plan entitlements, provisioning record, and pending
activation invitation. It creates no user membership, admin role, custom
claims, or `/app` access. `activation_sent` may be observed only after the
onboarding email provider has accepted the exact activation-instructions
message and that acceptance is durably recorded; provider acceptance is not
delivery. Separately, token-bound `provisioning` with `workspaceReady=true`
stops automatic status polling and may offer `/app` as a manual exact-invoice-
email registration/sign-in and Firebase verification path. That handoff does
not claim that Resend accepted or delivered anything, and the optional
onboarding message is not required to initiate activation. The buyer must use
the exact invoice email, separately receive and complete Firebase email
verification through an authorized continue URL, and consume the unexpired
invitation before the server creates user access; only `active` is access-ready.
Pending, mismatched, unverified, expired, failed, replayed, and cross-account
paths expose no `/app` access.

Buyer records remain marked as controlled Stripe test-mode data and must be
excluded from live revenue and live paid-customer classification. This branch
is source-only until review, merge, semantic tag, exact-target UAT, trusted
promotion, true Hosted Invoice Page evidence, signed invoice lifecycle
evidence, any claimed activation-instructions provider acceptance, Firebase verification-
email delivery and continue-URL evidence, and hosted negative-path acceptance
are complete. No provider configuration or live sale is claimed. Refunds,
disputes, cancellations, access revocation, support, tax/accounting, and
separately approved live-mode launch remain open operating gates.

See the
[launch runbook](docs/LAUNCH_RUNBOOK.md#public-1-invoice-first-buyer-access-on-tonicatering)
for Secret Manager, Turnstile, invoice webhook, release, acceptance, and stop
requirements.

## Customer Provisioning (No Stripe)
Provision a customer organization, enforce order-based feature entitlements
(unpaid modules locked off), and generate a copy-ready onboarding message.

Release status: this hardened workflow is implemented and locally validated in
the current release candidate. It is not production-accepted. Do not assume the
live `/app` exposes it until the reviewed frontend, Functions, and rules are
deployed from one committed revision. See
[PROJECT_STATUS.md](PROJECT_STATUS.md) for current operational truth.

Recommended operator path:
1. Sign in at `/app` with a verified Firebase email as an authorized platform
   admin. Tenant admins cannot create tenants or change paid-plan entitlements.
2. Open `Integrations Ops` → `Customer Provisioning (Admin)`.
3. Select an explicit plan and review the generated order id, canonical owner
   URL, and confirmation prompt before provisioning.
4. For an existing organization, explicitly select
   `Update an existing organization (plan entitlements only)`. That mode does
   not change owner identity, branding, catalog data, invites, or email state.

The in-app workflow uses the `provisionCustomerOrder` callable, writes an
auditable `provisioningOrders/{orderId}` record, and exposes the post-provision
owner acceptance steps. Matching interrupted orders can be resumed
only after the organization, settings, owner access, and catalog artifacts
still match; conflicting or incomplete replay is rejected without sending
email. Optional email dispatch uses an order-scoped idempotency key and an
expiring audit-backed lease so concurrent retries cannot start another send.
Pending email invitations expire after seven days, and the exact invited email
must be verified before organization bootstrap can consume the invitation.
New tenants begin with a blank catalog so an unreviewed zero-price placeholder
cannot reach a customer quote. The owner workspace remains in catalog setup
mode until an organization admin either builds a catalog or stages one of the
four industry starter packs, reviews at least one named package priced above
zero plus an event type, and explicitly confirms the tenant's pricing setup.
Pack prices are suggestions and never activate the quote workspace on apply.
Apply, safe pre-confirmation replacement, catalog saves, and pricing
confirmation all use catalog revision preconditions. Pack-generated records
carry immutable baseline hashes so custom records and owner-modified pack
records are distinguishable; replacement never overwrites either owner-edited
records or owner-edited pricing settings. Final confirmation revalidates the
complete catalog on the server and records the admin actor, time, and confirmed
catalog revision. Monetary amounts are persisted in integer minor units, with
lossless legacy values migrated during server confirmation. Firebase quote creation and duplication use trusted
callables that re-price from current tenant data and create the draft quote,
portal snapshot, and first version atomically; direct Firestore quote creation
is denied. Client totals, pricing snapshots, owner/record identities, and
deposit links are not creation authority. Trusted edits also re-price and
atomically update quote/portal state with a new version; terminal commercial
evidence blocks overwrite. Reopen and permanent cleanup are admin-callable
operations, and direct quote/portal deletes are denied. Portal decisions update
the public snapshot and organization quote in one atomic batch; accepted and
declined outcomes are terminal. The provisioning callable is the only supported
write path for tenant creation and existing-organization entitlement changes.

### CLI safety preview

The local CLI is preview-only and performs no provisioning writes. Live CLI
writes are disabled because sequential provider operations cannot guarantee an
atomic tenant handoff. `--apply` is rejected; use the audited in-app workflow.

Preview the proposed new tenant:
```bash
npm run customer:provision -- \
  --project <your-project-id> \
  --organization acme-events \
  --order-id acme-events-001 \
  --name "Acme Events" \
  --owner-email owner@acme.com \
  --owner-name "Avery Owner" \
  --plan growth \
  --email-out ./artifacts/onboarding/acme-events-email.txt
```

What the preview script does:
- Requires explicit `--organization`, `--order-id`, `--name`,
  `--owner-email`, and `--plan` values; it never guesses a tenant or order
  identity.
- Requires an explicit starter, growth, or enterprise plan.
- Previews ordered feature entitlements and onboarding copy without creating
  catalog defaults.
- Rejects unknown arguments and any `--app-url` that does not exactly match the
  configured canonical `APP_BASE_URL`.
- Prints a `DRAFT - DO NOT SEND` handoff and optionally creates it with
  `--email-out`; an existing file is never overwritten.
- Uses `https://quotepilot.mbmapps.com/app` as the default owner sign-in URL.

Do not use the CLI to create or update an organization. Use the explicit in-app
platform-admin workflow.

## Release Entry Points

Primary production preparation is workflow-only:

- `Release UAT Attestation` records an allowlisted human's exact-main UAT
  statement while running in the configured `production-uat` environment.
- `Prepare Firebase Production Artifact` verifies the evidence, stages the
  selected Firebase surface, and uploads a target-scoped payload with a
  deterministic manifest.
- `Prepare Vercel Production Artifact` verifies the same evidence contract,
  builds the static SPA, translates it into a deployable `.vercel/output`
  payload, and uploads it with a deterministic manifest.
- Customer-specific Firebase Hosting promotion is not yet supported by the
  credential-isolated release path. The legacy tracked customer-site entrypoint
  fails closed without invoking a provider client.

Each primary production workflow requires four inputs: the full release SHA,
the successful exact-SHA `CI Quality` run id, the successful `Release UAT
Attestation` run id, and a full target-specific rollback SHA. The preparation
profile is also explicit and evidence-bound: `firebase-hosting`,
`firebase-backend`, `firebase-all`, or `vercel`; a repository variable cannot
silently widen the Firebase scope after UAT. The workflows fail before
dependency execution
unless the checkout is the exact tagged `main` SHA, all eight CI jobs passed,
the tracked UAT checklist digest matches, the attestation is fresh and came
from an allowlisted human, the current run is the canonical in-progress target
preparation dispatched by a human, the exact UAT run has one recorded approval
by an independent current direct reviewer, the exact preparation run has one
recorded `production` approval by a current direct reviewer other than both the
dispatcher and UAT attester, and the current `production-uat` and `production`
environment policies match the source contract. The verifier still
does not prove provider identity behind the human-entered staging id or the
historical environment-policy snapshot. Run `npm run
release:uat:digest` on the release SHA to obtain the checklist digest.

For a release containing either Stripe collection rail, every applicable
`payment.*` item printed for the selected target is mandatory. Deposit and
final-balance dispatch, signed-webhook/reconciliation behavior, cross-rail
isolation, customer-safe projection, and browser surfaces must be observed on
the exact coordinated hosted candidate as their target applicability requires.
Local tests and emulator events are source evidence only, while a successful
UAT attestation records the observed application contract; neither alone is
Stripe test-mode or live-mode provider acceptance.

For a release containing public buyer onboarding, every applicable `buyer.*`
item is likewise mandatory. Hosting/Vercel items cover the public Turnstile
entry and the locked pending/activation instructions; they do not prove email
provider or backend fulfillment. Backend items cover Turnstile hostname/action
verification, durable rate limits, idempotent true Hosted Invoice Page creation,
buyer API and webhook version `2024-06-20`, signed invoice lifecycle, paid
workspace preparation, pending-invite enforcement, activation-instructions provider acceptance, Firebase
verification-email delivery and authorized continue URL, exact-email claim,
negative paths, and isolation from the quote Stripe rail. No single target
receipt proves an unbound frontend, backend, or provider dependency, so retain
a coordinated provider record for the exact deployed surfaces.

The `backend` and `all` scopes package Firestore rules plus Functions without
runtime `.env` files. The manifest binds the Firebase project, Hosting target,
Vercel project/team, exact release evidence, and the SHA-256/size/mode of every
payload file. Provider/environment setup and the full operator sequence live in
[docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md).

These two primary preparation workflows are a source candidate, not an
operational production gate, and they do not mutate production. The legacy
primary deploy commands fail closed. Promotion remains blocked until protected
environments and independent
reviewers exist, provider staging/rollback evidence is machine-bound, Vercel
bypass paths are closed, and a separately owned trusted deployer revalidates the
uploaded payload against its manifest and GitHub run/artifact identity before
receiving provider mutation credentials.

### Multi-Site Hosting (Per Customer)
Use one Firebase project with multiple Hosting sites, then map each customer domain to its site.

Create the site and domain mapping through an authorized provider operator, and
promote only an independently verified target-specific artifact through the
separately owned trusted deployer. The existing
`deploy:firebase:hosting:customer` helper is not an approved production path:
it now fails closed without invoking a provider client. Customer-site promotion
is blocked until it is implemented behind the same isolated, audited boundary
as the primary targets.

## Governance Docs
- Contributor workflow: [CONTRIBUTING.md](CONTRIBUTING.md)
- Version/release playbook: [docs/VERSION_CONTROL.md](docs/VERSION_CONTROL.md)
- Agent governance: [docs/AGENT_GOVERNANCE.md](docs/AGENT_GOVERNANCE.md)
- Skill index: [docs/SKILLS.md](docs/SKILLS.md)
- Staff/admin operations guide: [docs/USER_MANUAL.md](docs/USER_MANUAL.md)
- Feature checklist mapping: [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md)
- Cloud/local orchestration blueprint: [docs/ORCHESTRATION_BLUEPRINT.md](docs/ORCHESTRATION_BLUEPRINT.md)
- Cloud/local orchestration runbook: [docs/ORCHESTRATION_RUNBOOK.md](docs/ORCHESTRATION_RUNBOOK.md)
- Performance guardrails: [docs/PERFORMANCE_GUARDRAILS.md](docs/PERFORMANCE_GUARDRAILS.md)
- Current operational state: [PROJECT_STATUS.md](PROJECT_STATUS.md)
- Prioritized backlog: [DEV_TASKS.md](DEV_TASKS.md)
- Change history: [CHANGELOG.md](CHANGELOG.md)
