# QuietPilot Architecture Adoption Report

Last updated: 2026-08-28 20:17:28 CDT

## Purpose

Compare QuietPilot's current repository architecture with QuoteFlow's current
architecture and identify what is shared, what is worth adopting, and what
should stay separate. This is a source/process report only. It does not change
QuoteFlow runtime architecture, deployment topology, provider configuration, or
product authority.

## Evidence Inspected

QuietPilot was inspected read-only at `<external-quietpilot-root>` on commit
`60a5d4ef` with a dirty worktree. The placeholder intentionally avoids binding
the report to one workstation path. Dirty files mean current checkout state is
useful architecture evidence, not release proof.

Primary QuietPilot evidence:
- `AGENTS.md`
- `docs/agentic-framework.md`
- `docs/governance/README.md`
- `docs/backlog-governance.md`
- `docs/product/capabilities.md`
- `docs/product/proof-boundary-registry.md`
- `docs/product/transaction-surface-standard.md`
- `docs/operations/deployment-topology.md`
- `package.json`
- route inventory under `apps/web/app`
- package inventory under `packages/*`
- governance/check scripts under `scripts/`

Primary QuoteFlow evidence:
- `AGENTS.md`
- `README.md`
- `PROJECT_STATUS.md`
- `docs/DOC_SYSTEM.md`
- `docs/FEATURE_MATRIX.md`
- `docs/ORCHESTRATION_BLUEPRINT.md`
- `docs/ORCHESTRATION_RUNBOOK.md`
- `docs/STRIPE_CONNECT_PROGRAM.md`
- `package.json`
- runtime/source inventory under `src`, `functions`, and `functions-connect`

## Executive Finding

QuoteFlow and QuietPilot share the same product class and proof discipline:
catering revenue operations, tenant isolation, quote/proposal/payment
boundaries, customer-token surfaces, provider evidence separation, and
agent-governed delivery. The major architectural difference is implementation
shape:

- QuoteFlow is a React/Vite/Firebase application with Firebase Functions,
  Firestore, Firebase Auth, Firebase Hosting fallback, and a Vercel public edge.
- QuietPilot is a Next.js monorepo with `apps/web`, `apps/worker`,
  `packages/application`, `packages/contracts`, Prisma/Postgres as the durable
  system of record, Redis coordination, Render worker isolation, Vercel web/API
  hosting, Cloudflare R2 artifact storage, and Firebase Auth as identity only.

The best adoption path is not to migrate QuoteFlow into QuietPilot's stack.
QuoteFlow should adopt QuietPilot's governance, inventory, proof, route-policy,
transaction-surface, and package-boundary patterns selectively while preserving
QuoteFlow's current Firebase authority and capability-surfacing gate.

## What We Already Share

### 1. Commercial spine discipline

Both repos protect a quote-to-cash operating loop. QuietPilot names it as:

`Inquiry -> Lead -> Quote -> Proposal -> Customer Acceptance -> Payment -> Job Readiness -> Downstream Sync`

QuoteFlow already expresses the same spine through quote creation/versioning,
proposal portal, acceptance/change requests, deposit/final-balance evidence,
booking, BEO, schedule, staffing, reporting, customer workspace, and provider
boundaries. The language differs, but the invariant is the same: no UI summary
or provider handoff becomes commercial truth until the authoritative source
records it.

### 2. Proof-boundary language

Both repos separate source, local validation, CI, deployment, provider evidence,
production behavior, and human acceptance. QuoteFlow already has strong
delivery/payment language in `docs/DOC_SYSTEM.md`, `PROJECT_STATUS.md`, and
`docs/FEATURE_MATRIX.md`. QuietPilot has a broader reusable taxonomy in
`docs/product/proof-boundary-registry.md` and
`docs/product/transaction-surface-standard.md`.

Shared rule: browser return, local tests, fixtures, build output, or config
presence cannot be upgraded into payment, delivery, readiness, provider, or
human-acceptance proof.

### 3. Agent-governed execution

QuoteFlow has `npm run plan:task`, lane taxonomy, capability surfacing, and
cloud-runner handoff. QuietPilot has outcome contracts, workstreams, backlog
classification, route policy coverage, proof-boundary wording checks, and
prepush/release gates. Both repos benefit from bounded task packets and
evidence-led closeout.

### 4. Review-only AI posture

QuietPilot's AI surfaces are explicitly advisory, review-only, source-linked,
tenant-scoped, and non-mutating. QuoteFlow's Steward, intent parser, CREATE,
Pilot, and Difficult Question Desk foundations already follow the same
principle. Adoption should standardize wording and checks, not expand AI
authority.

### 5. Customer-token and internal-data boundaries

Both repos distinguish customer proposal access from tenant membership and keep
private notes, internal IDs, provider payloads, margins, costs, and tenant
internals out of customer-facing artifacts unless a safe projection explicitly
allows them.

## What QuietPilot Does Better Today

### 1. Architecture separation by package boundary

QuietPilot has clear package tiers:

- `packages/application/src/services/*`: use-case services and ports.
- `packages/contracts/src/*`: shared API/domain contracts.
- `packages/domain/src/*`: domain logic and tests.
- `apps/web/app/api/v1/*`: thin route handlers over application services.
- `apps/worker`: async queue and integration work.

QuoteFlow has strong modules, but many authority seams still live across
`src/lib`, `src/components`, and Firebase Functions files. The highest-value
transfer is a package-style boundary for pure commercial/domain contracts
without moving platforms.

### 2. Generated route/API inventories

QuietPilot tracks or checks:

- API contract snapshot generation.
- route permission checks.
- route policy coverage.
- route-to-service inventory.
- critical route tests.

QuoteFlow has a stronger no-orphan-capability gate, but it would benefit from a
generated app route/callable inventory that complements
`docs/capability-surfacing-contracts.json`.

### 3. Outcome contracts

QuietPilot requires task packets and backlog items to name:

- actor-facing outcome;
- success signal and check window;
- evidence or assumption;
- capability impact;
- validation evidence;
- human approval checkpoints.

QuoteFlow's planner already names profile, risk, docs, reads, and validations.
It can adopt the outcome-contract fields without importing QuietPilot's entire
backlog model.

### 4. Proof wording as an executable check

QuietPilot has a dedicated proof-boundary wording checker. QuoteFlow has strong
docs governance and capability-surfacing checks, but proof-sensitive wording is
currently distributed across docs and tests. A small QuoteFlow-specific
`check:proof-boundary-wording` would catch overclaims earlier.

### 5. Worker/artifact isolation model

QuietPilot's topology separates synchronous web/API work from background worker,
retry, integration, and artifact generation concerns. QuoteFlow's Firebase
Functions model can keep working, but long-running, retry-heavy, or artifact
heavy capabilities should adopt the same mental split:

- foreground callable/API: validate, authorize, enqueue, return bounded status;
- worker/background function: retry, provider call, artifact generation,
  reconciliation;
- durable receipt: expose only safe status and evidence.

### 6. Capability register maintenance contract

QuietPilot's `docs/product/capabilities.md` requires every meaningful feature
delivery to update capability truth or record `no capability delta`. QuoteFlow
already has `docs/FEATURE_MATRIX.md` plus the machine capability-surfacing
contract. The missing piece is a lightweight closeout phrase or planner field
that forces the agent to say whether the Feature Matrix changed.

## What QuoteFlow Does Better Today

### 1. No-orphan-capability gate

QuoteFlow's `check:capability-surfaces` is stricter than QuietPilot's general
route-policy posture for backend/data-authority changes. It requires a backend
capability to bind to a role-safe frontend surface, test locator, Feature
Matrix row, User Manual section, and state-marker assertions. QuietPilot's route
policy checks are broader, but QuoteFlow's no-orphan-capability gate is the
stronger adoption source.

### 2. Firebase authority clarity

QuoteFlow's current platform is narrower and clearer: Firebase Auth,
Firestore, Functions, Hosting fallback, Vercel edge, and isolated
`functions-connect`. QuietPilot's split stack is more scalable but has more
moving parts. QuoteFlow should avoid a platform migration unless a future
capability has a proven bottleneck that Firebase cannot safely handle.

### 3. Release evidence separation

QuoteFlow's current `PROJECT_STATUS.md`, release scripts, staging manifest, and
Stripe Connect stopping gates are unusually explicit about source/local,
deployment, provider, hosted-role, production-data, and human-acceptance
boundaries. Keep that discipline as the local standard.

### 4. Capability-surfacing around UI state markers

QuoteFlow's state marker requirement is valuable and should remain the core
governance mechanism for user-relevant backend authority. QuietPilot patterns
should augment it, not replace it.

## Adoption Recommendations

### Adopt Now

1. Create a QuoteFlow transaction-surface standard.

Adapt QuietPilot's transaction standard into a QuoteFlow-specific
`docs/TRANSACTION_SURFACE_STANDARD.md`. It should cover quote draft, saved
version, proposal sent/viewed, accepted, change request, deposit, final balance,
booking, BEO, staffing, provider delivery, buyer access, tenant activation, and
Steward/AI review-only boundaries. Link it from `docs/DOC_SYSTEM.md`.

2. Add proof-boundary wording checks.

Start with documentation and test snapshots. Flag dangerous claim upgrades such
as `paid`, `sent`, `delivered`, `ready`, `live`, `activated`, `accepted`, or
`production ready` when they appear without allowed context. This can be
implemented as a small script before any runtime change.

3. Extend `plan:task` with outcome-contract fields.

Add optional JSON fields:

- `outcome`
- `successSignal`
- `checkWindow`
- `evidenceOrAssumption`
- `capabilityImpact`
- `humanApprovalCheckpoints`

The planner does not need to become QuietPilot's backlog system. It only needs
to make closeout stronger.

4. Generate a callable/route/service inventory.

Create a script that emits current QuoteFlow surfaces:

- React routes and portal precedence paths;
- Firebase callable exports;
- Functions helper impacts;
- Firestore rule-sensitive collections;
- provider/webhook endpoints;
- capability contract IDs.

This should feed docs review and `check:capability-surfaces`, not replace the
current manifest.

### Adopt Next

5. Extract pure commercial contracts into a package-like boundary.

QuoteFlow does not need npm workspaces immediately. First create a clear source
boundary for pure contracts and deterministic models, for example:

- `src/contracts/*` or `src/domain/*` for shared client/server contracts;
- `functions/domain/*` only when server-only;
- no Firebase/Admin/provider imports in pure domain modules.

Candidate first targets:

- quote/pricing snapshot contract;
- proposal decision/change-request contract;
- payment rail evidence contract;
- BEO freshness contract;
- capability-state marker contract.

6. Add route policy coverage for staff/customer boundaries.

QuietPilot's route policy coverage concept maps well to QuoteFlow routes:

- `/app` staff workspace;
- `/app/quotes/*`;
- `/app/events/*`;
- `/app/messages`;
- `/app/staff`;
- public `?portal=`;
- `/staffing/respond`;
- `/start`.

The check should assert auth/role/token expectations and dangerous fallback
states, not just route existence.

7. Add an evidence-ledger component pattern.

QuietPilot's evidence-ledger work is useful for QuoteFlow's operator surfaces:
show the latest safe source, what is known, what is missing, who owns the next
action, and what should not be inferred. QuoteFlow already has rails; the
adoptable piece is a reusable presentation pattern with proof-safe copy.

### Consider Later

8. Worker/artifact split for long-running provider work.

Do not copy Render/Redis by default. Use the pattern when QuoteFlow outgrows
single callable flows:

- async PDF/artifact generation;
- provider reconciliation;
- SMS/email delivery status recovery;
- Stripe Connect onboarding/routing;
- Steward evaluation batches.

Firebase task queues or scheduled Functions may be sufficient before a new
worker platform is justified.

9. Monorepo/workspace split.

QuietPilot's monorepo is valuable because it has web, worker, application,
contracts, DB, and domain packages. QuoteFlow is not yet forced into that
complexity. Prefer a staged source-boundary extraction first; consider
workspaces only if shared client/server contracts, Functions, Connect, and test
runtime friction become a recurring blocker.

10. Postgres/Prisma migration.

Do not adopt now. QuietPilot uses Postgres as durable commercial truth;
QuoteFlow's Firestore architecture is deeply integrated and actively governed.
Migration would be expensive, high-risk, and unjustified unless a specific
capability requires relational transactions, reporting joins, or operational
query patterns that cannot be safely modeled in Firestore.

## What Not To Copy

- Do not copy QuietPilot's Vercel + Render + Postgres + Redis + R2 topology as a
  default platform direction.
- Do not import QuietPilot's backlog hierarchy wholesale; QuoteFlow already has
  `plan:task`, capability packets, Feature Matrix, and release/status docs.
- Do not treat QuietPilot's dirty checkout, local tests, or architecture docs as
  release proof.
- Do not weaken QuoteFlow's no-orphan-capability contract in favor of a more
  general route policy.
- Do not reframe QuoteFlow AI/Steward features as autonomous authority.

## Suggested QuoteFlow Work Packets

### QFA-001: Transaction Surface Standard

Outcome: future agents have a QuoteFlow-native proof/copy contract before
changing transaction surfaces.

Files likely involved:
- `docs/TRANSACTION_SURFACE_STANDARD.md`
- `docs/DOC_SYSTEM.md`
- `docs/USER_MANUAL.md` only if operator instructions change

Validation:
- `npm run check:docs:governance`
- focused proof-wording check if introduced in the same slice

### QFA-002: Proof Boundary Wording Check

Outcome: docs and tests fail before unsupported transaction/readiness/payment
claims land.

Files likely involved:
- `scripts/check-proof-boundary-wording.mjs`
- `package.json`
- `docs/DOC_SYSTEM.md`
- possibly `.github/workflows/ci-quality.yml`

Validation:
- checker unit tests
- `npm run check:docs:governance`
- `npm run lane:quick` if wired into preflight

### QFA-003: Route And Callable Inventory

Outcome: QuoteFlow has a generated route/callable inventory that complements
capability surfacing and reduces stale architecture claims.

Files likely involved:
- `scripts/generate-surface-inventory.mjs`
- `docs/surface-inventory.json`
- `docs/FEATURE_MATRIX.md` only if canonical references change

Validation:
- snapshot/generator tests
- `npm run check:capability-surfaces`
- `npm run check:docs:governance`

### QFA-004: Outcome Contract Planner Extension

Outcome: task handoffs include actor-facing outcome, success signal, evidence
or assumption, capability impact, and human approval checkpoints.

Files likely involved:
- `scripts/task-orchestration-plan.mjs`
- `docs/task-orchestration-contracts.json`
- `docs/ORCHESTRATION_BLUEPRINT.md`
- `docs/ORCHESTRATION_RUNBOOK.md`
- `docs/AGENT_GOVERNANCE.md`

Validation:
- planner tests if present or added
- `npm run check:docs:governance`
- `npm run check:env`
- `npm run build`

### QFA-005: Pure Contract Boundary

Outcome: first shared client/server commercial contract is extracted away from
UI and provider code.

Recommended first target: payment rail evidence or proposal decision state,
because both require exact language across UI, Functions, rules, and docs.

Validation:
- focused unit tests for the extracted contract
- affected component/callable tests
- `npm run check:capability-surfaces`
- `npm run build`

## Recommended Sequence

1. QFA-001 Transaction Surface Standard.
2. QFA-002 Proof Boundary Wording Check.
3. QFA-004 Outcome Contract Planner Extension.
4. QFA-003 Route And Callable Inventory.
5. QFA-005 Pure Contract Boundary.

This sequence improves quality and handoff speed before touching runtime
architecture. It also gives future larger platform decisions better evidence.

## Bottom Line

QuietPilot is a broader, more layered revenue-operations platform. QuoteFlow is
a narrower but more tightly governed Firebase product with strong capability
surfacing. The transfer value is governance and architecture discipline, not
stack migration. Adopt QuietPilot's outcome contracts, proof wording checks,
route/API inventory, transaction-surface standard, and package-boundary habits;
preserve QuoteFlow's Firebase authority, no-orphan-capability gate, and explicit
release/provider/human-acceptance separation.
