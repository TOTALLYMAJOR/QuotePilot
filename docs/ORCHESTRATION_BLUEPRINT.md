# Cloud + Local Orchestration Blueprint

Last updated: 2026-09-17 02:01:13 CDT

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

3. Cloud Runner Handoff
- Hosted agents and external runners start from a machine-readable
  `plan:task --json` packet, consume the selected model/reasoning effort,
  execution and domain classifications, read-first files, required skills,
  documentation obligations, validations, and task graph before
  implementation, then close with a `--phase complete` packet.
- The runner may use injected environment values, ignored local `.env.local`,
  and cached `.cache` artifacts for speed, but it must never write provider
  secrets into tracked files or treat missing credentials as permission to
  weaken validation.
- Handoffs must separate local/source checks, CI checks, hosted/provider
  receipts, production deployment, and human acceptance.
- Meaningful work may also emit an ignored development-evidence record with
  `npm run evidence:task` so later agents can inspect what was actually proven
  without rereading the full conversation.

4. Main CI Hard Gate
- Pushes to `main` require full hard-gate CI matrix.
- Production deployment remains a separate manual release action after the
  required hard-gate CI, UAT evidence, and published semantic tag.

5. Release Control Plane
- Human approval remains mandatory for `main` merges and deploy actions.
- Release-intent changes require UAT and rollback evidence.

6. Product Truth Reconciliation (source/local candidate; advisory CI)
- The read-only compiler reconciles Git, canonical documents,
  capability contracts, task evidence, release/UAT receipts, optional
  reachability, and human/provider proof into one source-linked owner digest.
- The digest is a projection, not a new authority. It must preserve `source`,
  `local`, `ci`, `hosted`, `provider`, `production`, `human`, and `outcome` as
  separate evidence classes and label unavailable evidence `unknown`.
- `status:product` is owner-facing and report-successful when drift exists;
  `check:product-drift` exits `1` for blocking drift and `2` for malformed
  required input.
- CI publishes the digest and observes the gate as an advisory job. Exact CI
  observation, false-positive/freshness review, and separate owner promotion
  are required before the drift check can become a required gate.

## Decision Interface Contract
Each PR declares:
- `change_type`: `docs` / `process` / `ui` / `core` / `auth_rules` / `deploy`
- `risk_level`: `low` / `medium` / `high`
- `tenant_impact`: `none` / `read` / `write` / `rules`
- `required_lanes`: `auto` or manual override
- `doc_impact`: canonical docs touched and rationale
- `product_intelligence`: required catering actor/job/improvement, governed
  outcome or metric IDs, guardrails, evidence need, and ledger entry; or an
  explicit `not_applicable` rationale for mechanical work

Before implementation, `npm run plan:task` may derive the same decision inputs
from a bounded task description and explicit path set. Its canonical policy is
`docs/task-orchestration-contracts.json`; the result adds a model tier,
reasoning effort, read/update dependencies, ordered validations, and a task
graph. The external runner—not repository code—owns the actual model switch.
Every plan also carries an exact UTC lifecycle timestamp. The `complete` phase
is the authoritative time included in the final task report.

Schema-v2 packets preserve the execution profile and add an orthogonal
`domainClassification`. When applicable, the packet names the smallest
relevant catering contexts, current QuotePilot authority reads, and advisory
reference slices. References remain separate from `readFirst` so the runner can
form a provisional action from current authority and code before domain
reconsideration. Existing packet fields remain available to runners.

The packet also carries a `productIntelligence` contract independently of the
execution profile. Applicable work is fail-closed on the catering-value fields,
the Product Intelligence index, the release/experiment ledger, and
`npm run check:product-intelligence`. Mechanical work may be marked
`not_applicable` only with a rationale; it may not invent a catering benefit.

## Token-Efficient Task Planning
- Pass explicit paths in a dirty worktree so unrelated changes do not raise the
  risk/model tier or widen dependency reads.
- Read the emitted `dependencies.readFirst` set before task-owned source.
- Load every emitted `dependencies.requiredSkills` entry before acting; UI work
  requires `design-language` plus both canonical QuotePilot design documents.
- When domain classification applies, load `catering-domain-intelligence`, form
  the provisional action before opening its emitted reference slices, and use
  the resulting `RETAIN`, `REFINE`, `REPLACE`, `EXPAND`, `BOUND`, or
  `NO_MATERIAL_EFFECT` decision to govern implementation and validation.
- Implement in `taskGraph` order: discover, form provisional action, domain
  reconsideration, implement, governance, verify, then expertise evaluation
  when agent behavior changed.
- Run focused checks before full build/release lanes; do not omit required
  global gates from the emitted validation list.
- Treat `frontier` selection as a safety escalation for authorization,
  payments, providers, migrations, security, and production work.
- Keep deterministic routing proof, fresh-agent expertise evaluation, and human
  acceptance as separate evidence classes.

## Lane Taxonomy
- `lane:quick`
  - `npm run check:project-state`
  - `npm run check:env`
  - `npm run check:secrets`
  - `npm run check:workflows`
- `lane:core`
  - `npm run check:capability-surfaces`
  - `npm run check:field-states`
  - `npm run check:product-intelligence`
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
  - Task packets may be stored under ignored `.cache/task-plans/` during a
    hosted run so later agents can resume from exact planner output without
    rereading unrelated source.
  - Mainline safety net opens a generated revert PR when the current `main`
    head fails CI, then dispatches the exact recovery head through CI without
    bypassing branch protection.

## Evidence and Tracking
- Source of truth:
  - repo docs + PR metadata
- Local task evidence:
  - `.cache/development-evidence/*.json` records generated by
    `npm run evidence:task`; these are ignored local handoff artifacts, not
    release authority.
- Required PR evidence:
  - lane checkboxes
  - classifier summary
  - residual risk note
  - rollback note for high-risk or release-intent changes
- Planned product-truth projection:
  - architecture: `docs/adr/ADR-0002-product-truth-observability.md`
  - implementation contract: `docs/design/product-truth-observability-design.md`
  - work plan: `docs/plans/20260828-feature-product-truth-observability.md`
  - generated snapshots: ignored `.cache/product-truth/` or ephemeral CI
    artifacts only; never a replacement for `PROJECT_STATUS.md` or release
    receipts

## 90-Day Priority Alignment
1. Implement and observe the advisory Product Truth Digest/drift contract.
2. Cross-org denial coverage in emulator lanes for tenant-sensitive changes.
3. Migration dry-run evidence capture in PR artifacts.
4. Legacy fallback retirement protected by high-risk lane bundle.
5. Staging sign-off routine and release checklist enforcement.
