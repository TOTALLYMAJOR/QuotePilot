# Orchestration Runbook

Last updated: 2026-09-17 02:01:13 CDT

## Purpose
Operational usage guide for orchestration lanes, CI behavior, and release evidence expectations.

## Local Command Profiles
Generate a task plan before reading or editing broadly:
```bash
npm run plan:task -- --task "Fix Proposal Composer mobile overflow" \
  --files src/components/ProposalComposer.jsx,src/components/proposalComposer.css
```

Machine-readable runner handoff:
```bash
npm run plan:task -- --task "Review Firestore role authority" \
  --files firestore.rules,src/lib/authClient.js --json
```

The output recommends a model and reasoning effort, but the external runner
must apply that selection before task execution. In a dirty worktree, always
pass `--files`; omitting it intentionally classifies every staged, unstaged,
and untracked path. Runner-specific model aliases may be supplied through
`TASK_MODEL_ECONOMY`, `TASK_MODEL_BALANCED`, and `TASK_MODEL_FRONTIER`.

At a material update or completion, rerun the same bounded plan with the
matching lifecycle phase:
```bash
npm run plan:task -- --task "Fix Proposal Composer mobile overflow" \
  --files src/components/ProposalComposer.jsx,src/components/proposalComposer.css \
  --phase complete --json
```

Copy `lifecycle.recordedAt` into the completion report. Governed documentation
uses the local `Last updated: YYYY-MM-DD HH:MM:SS TZ` header instead; the docs
gate requires that value to advance whenever the document changes.

Inspect `productIntelligence` in the same packet. When its disposition is
`required`, record the actor, catering job or decision, expected improvement,
outcome or metric IDs, guardrail IDs, evidence need, and release/experiment
ledger entry before implementation. When it is `not_applicable_allowed`, use
`not_applicable` only for genuinely mechanical work and record the rationale.

For a UI-classified plan, confirm `dependencies.requiredSkills` contains
`design-language` before editing. Load it completely, then read
`docs/DESIGN_SYSTEM.md` and `docs/DESIGN_PRINCIPLES.md`. If the skill and local
product language differ, the repository documents govern QuotePilot-specific
behavior and the conflict must be reported rather than silently blended.

## Catering-Domain Reconsideration

The planner's execution profile and catering-domain classification are
orthogonal. A task may be `ui` plus `event_operations` and `staffing`, or
`core` plus `commercial` and `payments`. Inspect the packet:

```text
domainClassification:
  applicable: true|false
  contexts: [...]
  matchedSignals: ...
  authorityReads: [...]
  referenceSlices: [...]
```

When `applicable` is true:

1. Load `catering-domain-intelligence` from `requiredSkills`.
2. Read the packet's `authorityReads` through the normal `readFirst` list and
   inspect the task-owned implementation.
3. Reconstruct the objective and form a provisional intended action.
4. Read only `referenceSlices`; do not load the whole knowledge pack.
5. Reconcile domain guidance with current QuotePilot authority and code.
6. Record internally whether the action is retained, refined, replaced,
   expanded, bounded, or has no material domain effect.
7. Carry material consequences into implementation and validation.

Routine retain/no-effect outcomes need no domain narration. Explain a revision
or authority conflict only when it helps the owner understand the work. Domain
prose alone is not evidence that the decision improved.

When `taskGraph` includes `expertise_eval`, complete deterministic verification
first, then run the skill's versioned cases in a genuinely fresh agent session.
Keep the scored model-behavior result and human acceptance separate from source,
CI, hosted, provider, and production evidence.

## Product Truth Reconciliation (Source/Local Active, CI Advisory)

The accepted observability architecture is recorded in
`docs/adr/ADR-0002-product-truth-observability.md`; implementation and rollout
live in the linked design and work plan. Use:

```bash
npm run status:product
npm run check:product-drift
```

Use `status:product` at the start of meaningful work to
answer what is live, what is only a candidate, what evidence exists, what has
drifted, and which decisions need an owner. Use `check:product-drift` before PR
publication and release preparation. The status command may successfully
render a report that contains drift; the gate command is the fail-closed policy
surface.

Use `--json` for machine consumers, `--snapshot
.cache/product-truth/<name>.json` for an ignored local snapshot, and
`--probe-reachability` only when bounded HTTP reachability is useful. A
successful HTTP probe remains reachability evidence only.

CI adoption is advisory. The workflow publishes text/JSON evidence and observes
the gate without making its result required. A separate owner decision must
promote the gate after exact CI summaries establish acceptable false-positive,
availability, freshness, and comprehension behavior.

Preflight:
```bash
npm run lane:quick
```

The preflight includes `npm run check:project-state`. Run that command alone
while iterating on lifecycle, proof, blocker, or executive-state records. Its
success means the repository control plane is internally consistent; it does
not establish deployment, provider, human, usage, or commercial evidence.

Core:
```bash
npm run lane:core
```

Tenant/auth/rules high-risk:
```bash
npm run lane:firebase-auth-rules
npm run lane:authoritative-pricing
```

Release readiness:
```bash
npm run lane:release
```

Release readiness with CWV:
```bash
npm run lane:release:cwv
```

## Cloud Runner Bootstrap
Use this path for hosted agents, remote dev containers, Codespaces-style
workspaces, and any external runner that receives a QuotePilot task handoff.
It is optimized for speed by making the runner read and validate only the
bounded task surface first.

1. Checkout and install:
```bash
git status --short
npm ci
```

2. Confirm browser-safe environment shape before broad work:
```bash
npm run check:env
```

If Firebase web app values are not already injected by the runner, create a
local ignored file from the authenticated Firebase project config:
```bash
npm run env:local:firebase -- --project tonicatering
```

This command is create-only by default. Do not paste or invent Firebase,
Stripe, Resend, Twilio, Pingram, Turnstile, OpenAI, Anthropic, or other
provider secrets in a handoff, prompt, PR body, repository file, or browser
`VITE_*` variable. Missing secrets are an environment blocker, not a reason to
weaken a gate.

3. Generate the machine-readable task packet:
```bash
mkdir -p .cache/task-plans
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
npm run plan:task -- --task "<bounded work>" \
  --files <comma-separated-owned-paths> \
  --json > ".cache/task-plans/${STAMP}--plan.json"
```

The runner must consume the selected model, reasoning effort, read-first files,
required skills, domain classification, documentation obligations, validations,
and task graph before implementation. If the emitted profile is `frontier`,
stop and confirm the task really has authority, payment, migration, provider,
production, security, or deployment scope before changing files.

4. Run the cheapest relevant checks before expanding:
```bash
npm run lane:quick
npm run test:unit
```

Then run every validation emitted by the task packet. For ordinary process,
documentation, UI, and core changes, the minimum closeout remains:
```bash
npm run check:env
npm run build
npm run check:product-intelligence
npm run check:docs:governance
```

5. Finish with a completion packet:
```bash
npm run plan:task -- --task "<bounded work>" \
  --files <same-comma-separated-owned-paths> \
  --phase complete \
  --json
```

The handoff must include the exact `lifecycle.recordedAt`, changed files,
commands run, command outcomes, skipped validations with reasons, and residual
risks. Local, CI, hosted, provider, production, and human-acceptance evidence
must remain separate.

For meaningful tasks, create an optional ignored evidence record after local
verification:
```bash
npm run evidence:task -- \
  --task "<bounded work>" \
  --phase complete \
  --planner-recorded-at "<plan:task complete recordedAt>" \
  --files <same-comma-separated-owned-paths> \
  --validation "npm run check:env | passed" \
  --validation "npm run build | passed" \
  --local-proof "Local validation completed on this checkout" \
  --residual-risk "CI, hosted, provider, production, and human acceptance are separate"
```

The record is written under `.cache/development-evidence/` and follows
`docs/DEVELOPMENT_EVIDENCE_COMPILER.md`. It supports learning and handoff only;
it does not prove CI, hosted, provider, production, or human acceptance.

Summarize local development-system observability:
```bash
npm run evidence:index
npm run evidence:index -- --json
```

Use the index to find repeated residual risks, failed validations, missing
planner timestamps, and repeated next actions. Do not promote a pattern to a
new gate, skill, or planner rule until the evidence shows the friction is
structural rather than a one-off task artifact.

## Runtime Diagnostics
The app-local `/app/diagnostics` surface and `src/lib/sessionDiagnostics.js`
capture bounded route, session, and error events for staff troubleshooting.
Treat exported diagnostics as local browser evidence only. They are useful for
triage and handoff, but do not prove CI, hosted behavior, provider outcomes,
production deployment, or human acceptance without separate artifacts.

Diagnostic payloads must remain privacy-bounded: URL query/hash fragments,
email addresses, phone numbers, token-like values, sensitive context keys, raw
user identifiers, and raw stack traces must not be persisted in exported
session diagnostics.

## Handoff Packet
Use this structure when passing work between local agents, cloud agents, and
human reviewers:

```text
Task:
Branch/SHA:
Planner recordedAt:
Planner profile/risk/model:
Owned files:
Required skills loaded:
Validation run:
Validation skipped:
Changed files:
Evidence:
Residual risks:
Next owner action:
```

Evidence claims must name their source. `npm run build` is source/build
evidence; a green CI run is CI evidence; a deployment workflow receipt is
provider workflow evidence; authenticated staff or customer behavior requires
its own exact hosted-role proof; human acceptance requires an explicit human
decision.

## Skill Entry Points
Maintainer checks:
```bash
bash .codex/skills/quote-wizard-maintainer/scripts/run-maintainer-checks.sh
```

Maintainer high-risk checks:
```bash
bash .codex/skills/quote-wizard-maintainer/scripts/run-maintainer-checks.sh --high-risk
```

Release checks:
```bash
bash .codex/skills/quote-wizard-release-manager/scripts/release-readiness.sh
```

Release checks (high-risk + CWV):
```bash
bash .codex/skills/quote-wizard-release-manager/scripts/release-readiness.sh --high-risk --with-cwv
```

## CI Behavior by Change Type
Docs-only:
- Required: `lane:quick`, `lane:core`
- Heavy lanes skipped.

UI/core low-risk on branches:
- Required: `lane:quick`, `lane:core`
- Heavy lanes run advisory.

Auth/rules/store high-risk:
- Required: `lane:quick`, `lane:core`, heavy Firebase lanes, and CWV as classified.

`main` pushes:
- Full hard-gate matrix required.
- Production deployment is a separate manual action after the required
  `CI Quality` run, UAT evidence, and published semantic release tag.
- If `CI Quality` fails on a `main` push, `Mainline Safety Net (Auto-Revert Failed Pushes)` reverts the failed head commit when it is still current `main` head.

## PR Evidence Checklist
- Complete Change Intent Contract in PR template.
- Provide lane evidence and note any advisory failures.
- Include residual risk statement.
- Include rollback path/SHA for high-risk or release-intent changes.
- Attach or link the exact Product Truth Digest and resolve or explicitly
  disposition blocking drift before requesting merge. During the advisory
  period, record findings without treating the CI check as a required gate.

## Migration Dry-Run Evidence Standard (P0 Execution)
Required command pattern:
```bash
mkdir -p .cache/migration-dry-runs
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_PATH=".cache/migration-dry-runs/${STAMP}--<firebaseProjectId>--<orgId>--dry-run.log"
JSON_PATH=".cache/migration-dry-runs/${STAMP}--<firebaseProjectId>--<orgId>--dry-run.json"
npm run migrate:multi-tenant -- --project <firebaseProjectId> --organization <orgId> --dry-run --evidence-out "${JSON_PATH}" 2>&1 | tee "${LOG_PATH}"
```

The migration defaults to read-only. A write requires `--apply` plus the exact
confirmation token `--confirm "MIGRATE <firebaseProjectId> <orgId>"`; project
and organization scope are always required.

Artifact file naming/location:
- Path: `.cache/migration-dry-runs/`
- Log filename pattern: `<YYYYMMDDTHHMMSSZ>--<projectId>--<orgId>--dry-run.log` (stdout/stderr transcript).
- JSON filename pattern: `<YYYYMMDDTHHMMSSZ>--<projectId>--<orgId>--dry-run.json` (structured totals/collection evidence).

PR evidence expectation for migration-intent changes:
- Include the exact dry-run command used (with concrete `--project` and `--organization` values).
- Upload both generated files as PR evidence (artifact or attachment) and include filenames/paths.
- Include a one-line dry-run outcome summary citing migration totals (`wouldCreate`, `wouldPatch`) and whether any blockers were found.

## Failure Triage
- Use uploaded CI artifacts (`playwright-report`, `test-results`) first.
- If Firebase lane fails:
  - verify emulator startup and fixture seeding logs
  - verify auth/rules assumptions against changed paths
- If CWV fails:
  - inspect largest chunk and bundle drift
  - validate if threshold exception workflow is required
