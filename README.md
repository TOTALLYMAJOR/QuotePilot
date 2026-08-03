# QuotePilot by MBMapps

Multi-tenant catering quote application built with React, Vite, Firebase, and jsPDF.

## Quick Links
- Live app: https://quotepilot.mbmapps.com
- Firebase Hosting origin/fallback: https://tonicatering.web.app
- Repository: https://github.com/TOTALLYMAJOR/Firebase-quote-wizard
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
- `/?portal=<token>` or `/app?portal=<token>`: customer proposal portal; existing token links remain compatible.

## Product Scope
The app supports a 5-step quote wizard, dynamic event-type menus, pricing configuration, proposal export, customer portal updates, tenant-locked customer/catalog CSV imports, and operations workflows (history, scheduling, reporting, diagnostics).

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
- `VITE_APP_URL`

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
ignored `functions/.env.<firebase-project-id>` file and replace only the values
needed for the intended provider deployment; never commit real provider
credentials. Confirm the target is ignored with
`git check-ignore -v functions/.env.<firebase-project-id>` before adding any
secret.

When the controlled GitHub deploy enables Functions, CI runs
`scripts/materialize-functions-env.mjs` before deployment. The script fails
closed unless it receives the canonical QuotePilot `/app` URL and domain, a
non-placeholder platform-admin allowlist, the approved
`QuotePilot by MBMapps <onboarding@quotepilot.mbmapps.com>` sender identity,
Stripe server secrets, and any credentials required by an explicitly enabled
email or SMS provider. It writes the project-specific Functions environment
file with restricted permissions and does not print secret values. The approved
sender identity in configuration does not prove the Resend domain is verified
or enabled; see [PROJECT_STATUS.md](PROJECT_STATUS.md) for provider truth.

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
npm run check:docs:governance
npm run check:perf:bundle
npm run check:perf:cwv
```

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
    execution, outcome audit, idempotency, and replay protection.
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

## Deploy Entry Points
- Firebase hosting/rules/functions: `npm run deploy:firebase -- --confirm "DEPLOY tonicatering hosting:app,firestore,functions"`
- Firebase rules/functions only: `npm run deploy:firebase:functions -- --confirm "DEPLOY tonicatering firestore,functions"`
- Firebase primary hosting site (`app` target): `npm run deploy:firebase:hosting -- --confirm "DEPLOY tonicatering hosting:app"`
- Firebase customer hosting site (`customer` target): `npm run deploy:firebase:hosting:customer -- --site <siteId> --project tonicatering --confirm "DEPLOY tonicatering hosting:<siteId>"`
- Vercel production: `npm run deploy:vercel -- --confirm "DEPLOY quotepilot.mbmapps.com via vercel"`

The primary Firebase scripts require a clean pushed `main` revision that
matches `origin/main`, a semantic release tag on the same commit that is
published to `origin`, and an exact scope-bound confirmation. The same
published-revision gate applies to Vercel production. Functions scopes also
validate the ignored
`functions/.env.tonicatering` file before deployment. The scripts bind Hosting
target `app` to site `tonicatering`; do not replace this with an unscoped
default Hosting deploy.

### Multi-Site Hosting (Per Customer)
Use one Firebase project with multiple Hosting sites, then map each customer domain to its site.

One-time per customer site:
```bash
npx firebase-tools hosting:sites:create <siteId>
```

Deploy to a specific customer site:
```bash
npm run deploy:firebase:hosting:customer -- \
  --site <siteId> \
  --project tonicatering \
  --confirm "DEPLOY tonicatering hosting:<siteId>"
```

The customer deploy always runs a fresh environment check and build; it rejects
implicit projects and stale `dist` reuse.

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
