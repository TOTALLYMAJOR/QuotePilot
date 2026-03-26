# Firebase Quote Wizard

Production-ready catering quote application built with React, Vite, Firebase, and jsPDF.

## Quick Links
- Live app: https://tonicatering.web.app
- Repository: https://github.com/TOTALLYMAJOR/Firebase-quote-wizard
- Launch runbook: [docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md)
- User manual: [docs/USER_MANUAL.md](docs/USER_MANUAL.md)
- Feature matrix: [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md)
- Canonical doc system: [docs/DOC_SYSTEM.md](docs/DOC_SYSTEM.md)

## Product Scope
The app supports a 5-step quote wizard, dynamic event-type menus, pricing configuration, proposal export, customer portal updates, and operations workflows (history, scheduling, reporting, diagnostics).

## Architecture Snapshot
- Frontend: React 18 + Vite 7
- Data/Auth: Firebase Firestore + Firebase Auth
- Deploy target: Firebase Hosting (primary), Vercel (optional)
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
- Performance guardrails: [docs/PERFORMANCE_GUARDRAILS.md](docs/PERFORMANCE_GUARDRAILS.md)
- Current operational state: [PROJECT_STATUS.md](PROJECT_STATUS.md)
- Prioritized backlog: [DEV_TASKS.md](DEV_TASKS.md)
- Change history: [CHANGELOG.md](CHANGELOG.md)
