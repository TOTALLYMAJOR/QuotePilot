# QuotePilot by MBMapps

Production-ready catering quote application built with React, Vite, Firebase, and jsPDF.

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
- `/`: public QuotePilot marketing page.
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
- Public custom domain: Vercel (`https://quotepilot.mbmapps.com`)
- Firebase Hosting origin/fallback: `https://tonicatering.web.app`
- Local runtime options: VS Code Dev Container (recommended), Node (`npm run dev`), or Docker Compose (`web-dev` / `web`)

## Local Setup
### Prerequisites
- Node.js 20+
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
1. Open the `react-firebase-quote-wizard` folder in VS Code.
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
- `VITE_BOOTSTRAP_ADMIN_EMAILS`

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

## E2E Test Lanes
- `npm run test:e2e`
  - Default browser smoke lane.
  - Uses `scripts/run-playwright.sh`, which auto-prepares Linux Playwright runtime libs under `.cache/playwright-libs` when needed.
- `npm run test:e2e:firebase`
  - Firebase emulator browser lane for real Auth + Firestore rules coverage.
  - Starts `auth` + `firestore` emulators, seeds org/menu/userRole fixtures, signs in via UI, and validates quote save path.
  - Auto-prepares local JRE under `.cache/tools/jre21` when system Java is unavailable.
- `npm run test:e2e:firebase:authoritative`
  - Firebase emulator browser lane that also starts Functions emulator.
  - Requires authoritative pricing callable success in the quote save path (no client-only pricing fallback).

Optional env vars for Firebase emulator lane:
- `E2E_FIREBASE_PROJECT_ID` (default: `demo-e2e`)
- `E2E_FIREBASE_ORG_ID` (default: `e2e-org`)
- `E2E_FIREBASE_EMAIL` (default: `e2e-admin@local.test`)
- `E2E_FIREBASE_PASSWORD` (default: `Passw0rd!`)

## Firestore Menu Seed
Populate baseline dynamic menu collections (`eventTypes`, `menuCategories`, `menuItems`) without touching quotes or pricing.

Dry run:
```bash
npm run seed:menu:firestore -- --project <your-project-id> --dry-run
```

Apply seed:
```bash
npm run seed:menu:firestore -- --project <your-project-id>
```

Notes:
- The script is idempotent and only creates missing docs.
- It never deletes or rewrites existing menu docs.
- Auth uses Firebase Admin ADC/service credentials (`GOOGLE_APPLICATION_CREDENTIALS`) or emulator config.

## Customer Provisioning (No Stripe)
Provision a customer organization, enforce order-based feature entitlements (unpaid modules locked off), and generate a copy-ready onboarding email template.

Server-side option (recommended):
- Callable Firebase Function: `provisionCustomerOrder`
- Behavior:
  - writes org + settings + invite + `provisioningOrders/{orderId}` audit record
  - applies ordered feature entitlements
  - optionally sends onboarding email via configured email provider

Basic usage:
```bash
npm run customer:provision -- \
  --project <your-project-id> \
  --name "Acme Events" \
  --owner-email owner@acme.com \
  --owner-name "Avery Owner" \
  --plan growth \
  --sequence-start 250 \
  --email-out ./artifacts/onboarding/acme-events-email.txt
```

Custom feature set:
```bash
npm run customer:provision -- \
  --project <your-project-id> \
  --organization <orgId> \
  --name "Acme Events" \
  --owner-email owner@acme.com \
  --features customerPortal,eventSchedule,guidedSelling \
  --disable-features crmSync,diagnostics
```

What the provisioning script does:
- Auto-assigns numeric org IDs when `--organization` is omitted (starts at `--sequence-start`, default `250`).
- Sets `orderId` to `orgId + 1` when `--order-id` is omitted and org id is numeric.
- Skips menu/event seeding by default to avoid inheriting prior client menu content.
- Seeds menu/event defaults only when `--seed-menu` is explicitly passed.
- Creates/updates `organizations/<orgId>`.
- Writes ordered feature entitlements to `organizations/<orgId>/settings/config`:
  - paid features remain editable
  - unpaid features are locked off in Admin Catalog
- Applies neutral white-label branding/contact defaults so new orgs do not inherit another client's brand identity.
- Ensures a minimal neutral catalog skeleton exists to prevent fallback to legacy client defaults.
- Writes a provisioning audit record to `provisioningOrders/<orderId>`.
- Grants admin via `userRoles/<uid>` when `--owner-uid` is provided.
- Otherwise creates an email-based invite in `organizationInvites/<owner-email-key>` that is consumed on first sign-in.
- Uses Firebase Admin credentials when available; if ADC is missing and `--project` is provided, it falls back to Firestore REST writes with the current Firebase CLI login token.
- Prints an onboarding email template and optionally writes it to `--email-out`.

## Deploy Entry Points
- Firebase hosting/functions: `npm run deploy:firebase`
- Firebase functions only: `npm run deploy:firebase:functions`
- Firebase primary hosting site (`app` target): `npm run deploy:firebase:hosting`
- Firebase customer hosting site (`customer` target): `npm run deploy:firebase:hosting:customer -- --site <siteId>`
- Vercel (optional): `npm run deploy:vercel`

### Multi-Site Hosting (Per Customer)
Use one Firebase project with multiple Hosting sites, then map each customer domain to its site.

One-time per customer site:
```bash
npx firebase-tools hosting:sites:create <siteId>
```

Deploy to a specific customer site:
```bash
npm run deploy:firebase:hosting:customer -- --site <siteId>
```

Optional flags:
- `--project <projectId>` to override current Firebase project
- `--skip-build` to reuse an existing `dist/` build

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
