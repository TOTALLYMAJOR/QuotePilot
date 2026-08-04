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
- `/start`: $1 Stripe test buyer onboarding when
  `VITE_BUYER_ACCESS_ENABLED=true`; production builds keep the route closed and
  hide its marketing CTA by default.
- `/?portal=<token>` or `/app?portal=<token>`: customer proposal portal; existing token links remain compatible.

## Product Scope
The app supports a 5-step quote wizard, dynamic event-type menus, pricing
configuration, proposal export, customer portal updates, tenant-locked
customer/catalog CSV imports, server-authoritative deposit and final-balance
collection in the current source candidate, test-only paid Starter onboarding
in the paid-buyer branch, and operations workflows (history, scheduling,
reporting, diagnostics).

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
- `VITE_APP_URL` (canonical HTTPS `/app` return URL for Firebase email actions;
  its domain must be authorized in Firebase Authentication)
- `VITE_BUYER_ACCESS_ENABLED` (defaults off; use `true` only for the isolated
  $1 buyer-access test staging lane)

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
validation; never put production provider credentials in that file or commit
real provider credentials. Confirm the target is ignored with
`git check-ignore -v functions/.env.<firebase-project-id>` before adding any
non-production value.

Stripe Functions configuration requires an explicit `STRIPE_MODE` value of
`test` or `live`, a secret/restricted key with the matching mode prefix, and a
webhook secret. Event and Checkout Session `livemode` must also match. The
tracked Functions template is inventory only; use the credential-isolated
runtime channel described in the [launch runbook](docs/LAUNCH_RUNBOOK.md) and
never place real Stripe values in a browser environment or committed file.
The paid buyer test additionally requires server-only
`BUYER_ACCESS_ENABLED=true`; it rejects any mode other than
`STRIPE_MODE=test`. Browser and Functions gates are independent and both
default off outside the explicit staging lane.

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
path, and an exact scope-bound confirmation. Release, merge, UAT, or deployment
approval does not authorize this separate production-data operation:

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

## $1 Buyer Access (Test/Staging Source Candidate)

The `feature/paid-buyer-onboarding` branch adds a separate test-only acquisition
flow at `/start`. A buyer creates or signs in to a Firebase email/password
account, verifies the address, enters a business name and owner name, and then
continues to Stripe-hosted Checkout. The server—not the browser—fixes the order
to Starter access, $1 USD, Stripe test mode, and post-purchase invoice
generation. Existing scoped users are sent to `/app` without a new purchase.

The success return is not fulfillment evidence. QuotePilot polls the exact
owner/session-bound order and keeps access locked while Checkout is pending or
processing. Only a signed, deduplicated Stripe event with matching test-mode
Session, owner, order, $1 amount, USD currency, Starter plan, and invoice
configuration may atomically provision the active organization, neutral blank
catalog/settings, admin role, entitlements, and audit records. Failed, expired,
cancelled, malformed, mismatched, and replayed states fail closed.

This is source-only behavior. It is not on `main`, is not enabled on the
production marketing page or Functions runtime, and has no hosted Firebase or
Stripe acceptance. Refund, dispute, cancellation, account/access revocation,
support, tax, and live commercial operating paths are not automated by this
flow and remain blockers to a production sales rollout.

### Isolated Firebase staging entrypoints

The staging lane requires an existing Firebase project named
`quotepilot-staging-<name>`, exactly one Firebase Web app, Email/Password Auth,
a clean committed branch whose `HEAD` exactly matches its `origin` branch, an
authenticated local Firebase CLI session, and a Stripe test webhook subscribed
to all four supported Checkout Session events. The production project
`tonicatering` is rejected.

From a credential-injected shell, provide the staging app URL/domain, a real
operator allowlist, `BUYER_ACCESS_ENABLED=true`, `STRIPE_MODE=test`, a
least-privilege `rk_test_` key when possible (or a test secret key), the test
endpoint signing secret, and disabled email/SMS providers. Then create the
ignored mode-0600 project environment without printing or committing values:

```bash
npm run staging:firebase:env -- --project quotepilot-staging-<name>
```

Leave only the non-secret browser gate in the validation shell, then validate
and prepare the exact coordinated payload:

```bash
export VITE_BUYER_ACCESS_ENABLED=true
npm run staging:firebase:validate -- --project quotepilot-staging-<name>
npm run staging:firebase:prepare -- --project quotepilot-staging-<name>
```

`validate` performs read-only Firebase SDK-config and safety checks. `prepare`
repeats validation and builds with sanitized exact staging browser values; it
does not mutate a provider. After reviewing its exact project, branch, SHA,
scope, and confirmation token, the separately authorized staging operator may
deploy Hosting, Functions, and Firestore rules/indexes together:

```bash
npm run staging:firebase:deploy -- \
  --project quotepilot-staging-<name> \
  --confirm "<exact token printed by prepare>"
```

That final command mutates only the explicit staging Firebase project. It is
not a production deploy, live-mode authorization, or provider acceptance
claim. See the [launch runbook](docs/LAUNCH_RUNBOOK.md#isolated-1-buyer-access-staging-rehearsal)
for webhook setup, acceptance evidence, and stop conditions.

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
mode until an organization admin saves at least one named package priced above
zero, creates at least one event type, and explicitly confirms the tenant's
pricing setup. Catalog saves compare the loaded server state and patch only
locally changed records; a concurrent edit or reused identifier is rejected
instead of overwritten. Firebase quote creation and duplication use trusted
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

Each prepare workflow requires four common evidence inputs: the full release
SHA, the successful exact-SHA `CI Quality` run id, the successful `Release UAT
Attestation` run id, and a full target-specific rollback SHA. Firebase
preparation additionally requires `firebase_scope`. The preparation profile is
explicit and evidence-bound: `firebase-hosting`,
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
release:uat:digest` on the release SHA to obtain the checklist digest, then run:

```bash
npm run release:uat:items -- --target <firebase-hosting|firebase-backend|firebase-all|vercel>
```

Use that exact comma-separated output for `checked_item_ids`. Checklist schema
v2 binds each item to explicit targets; the attestation rejects missing,
duplicate, and valid-but-inapplicable ids. A successful item is an observed UAT
contract for the selected target and its recorded test environment, not proof
of an unbound dependency's SHA or provider identity. Portal projection backfill
is not packaged by any target and remains a separately authorized data
operation outside target attestation.

For a release containing either Stripe collection rail, every applicable
`payment.*` item printed for the selected target is mandatory. Deposit and
final-balance dispatch, signed-webhook/reconciliation behavior, cross-rail
isolation, customer-safe projection, and browser surfaces must be observed on
the exact coordinated hosted candidate as their target applicability requires.
Local tests and emulator events are source evidence only, while a successful
UAT attestation records the observed application contract; neither alone is
Stripe test-mode or live-mode provider acceptance.

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
