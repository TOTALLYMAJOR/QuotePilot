# Cloud + Local Orchestration Blueprint

Last updated: 2026-08-20 14:47:39 CDT

## Goal
Accelerate delivery while preserving production safety by using:
- Fast local preflight and scoped validation loops.
- CI as the authoritative quality/security gate.
- Hard gates on `main`, advisory heavy lanes on feature branches unless elevated by risk.

## Operating Model (4 Layers)
1. Local Fast Loop
- Developers run orchestration lanes before push.
- Focus: fast defect discovery, early policy checks, and reproducible command profiles.

2. Branch CI Advisory
- Branch/PR runs keep `lane:quick` and `lane:core` required.
- Heavy lanes (`lane:firebase-auth-rules`, `lane:authoritative-pricing`, CWV, browser smoke) run advisory unless elevated by risk classification.

3. Main CI Hard Gate
- Pushes to `main` require full hard-gate CI matrix.
- Production deployment remains a separate manual release action after the
  required hard-gate CI, UAT evidence, and published semantic tag.

4. Release Control Plane
- Human approval remains mandatory for `main` merges and deploy actions.
- Release-intent changes require UAT and rollback evidence.

## Decision Interface Contract
Each PR declares:
- `change_type`: `docs` / `process` / `ui` / `core` / `auth_rules` / `deploy`
- `risk_level`: `low` / `medium` / `high`
- `tenant_impact`: `none` / `read` / `write` / `rules`
- `required_lanes`: `auto` or manual override
- `doc_impact`: canonical docs touched and rationale

Before implementation, `npm run plan:task` may derive the same decision inputs
from a bounded task description and explicit path set. Its canonical policy is
`docs/task-orchestration-contracts.json`; the result adds a model tier,
reasoning effort, read/update dependencies, ordered validations, and a task
graph. The external runner—not repository code—owns the actual model switch.
Every plan also carries an exact UTC lifecycle timestamp. The `complete` phase
is the authoritative time included in the final task report.

## Token-Efficient Task Planning
- Pass explicit paths in a dirty worktree so unrelated changes do not raise the
  risk/model tier or widen dependency reads.
- Read the emitted `dependencies.readFirst` set before task-owned source.
- Implement in `taskGraph` order: discover, implement, governance, verify.
- Run focused checks before full build/release lanes; do not omit required
  global gates from the emitted validation list.
- Treat `frontier` selection as a safety escalation for authorization,
  payments, providers, migrations, security, and production work.

## Lane Taxonomy
- `lane:quick`
  - `npm run check:env`
  - `npm run check:secrets`
  - `npm run check:workflows`
- `lane:core`
  - `npm run check:capability-surfaces`
  - `npm run test:unit`
  - `npm run build`
  - `npm run check:docs:governance`
  - `npm run check:perf:bundle`
- `lane:firebase-auth-rules`
  - `npm run test:rules:firestore`
  - `npm run test:owner-sms:emulator`
  - `npm run test:e2e:firebase`
- `lane:authoritative-pricing`
  - `npm run test:e2e:firebase:authoritative`
- `lane:release`
  - `lane:quick` + `lane:core`
  - optional `npm run check:perf:cwv`

## CI Classification and Risk Elevation
CI classifier inspects changed paths and outputs:
- `docs_only`
- `high_risk`
- `change_type`
- `tenant_impact`
- recommended lanes

High-risk touch map includes:
- `src/lib/quoteStore.js`
- `src/lib/firebase.js`
- `src/lib/authClient.js`
- `src/hooks/useAuthSession.js`
- `functions/*`
- `firestore.rules`
- `firestore.indexes.json`
- `scripts/migrate-to-multi-tenant.mjs`
- deploy/CI workflow files

Risk policy:
- Feature branches:
  - Required: `lane:quick`, `lane:core`
  - Heavy lanes advisory unless `high_risk=true`
- `main`:
  - Heavy lanes always required
  - Deploy allowed only on successful hard-gate run

## Resource Utilization
- Local:
  - Use cached local artifacts (`.cache`, build outputs) for iteration speed.
  - Never treat local pass as release authority.
- Cloud (GitHub-hosted runners):
  - Fan-out jobs for smoke, Firebase lanes, CWV.
  - Concurrency cancellation prevents stale branch runs consuming compute.
  - Failure artifacts retained for fast triage.
  - Mainline safety net opens a generated revert PR when the current `main`
    head fails CI, then dispatches the exact recovery head through CI without
    bypassing branch protection.

## Evidence and Tracking
- Source of truth:
  - repo docs + PR metadata
- Required PR evidence:
  - lane checkboxes
  - classifier summary
  - residual risk note
  - rollback note for high-risk or release-intent changes

## 90-Day Priority Alignment
1. Cross-org denial coverage in emulator lanes for tenant-sensitive changes.
2. Migration dry-run evidence capture in PR artifacts.
3. Legacy fallback retirement protected by high-risk lane bundle.
4. Staging sign-off routine and release checklist enforcement.
