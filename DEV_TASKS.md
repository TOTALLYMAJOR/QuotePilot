# Dev Tasks

Last updated: August 8, 2026

## P0 - Production Acceptance and Tenant Provisioning
- Prepare and promote the next tagged exact-`main` revision containing this
  convergence across the frontend, Functions, and Firestore rules through the
  governed release path. Capture hosted acceptance separately for electronic
  proposal signing, interaction recovery, analytics, Operations Audit, and the
  staff Kitchen BEO; do not treat merge, payload preparation, or route
  reachability as deployment or human acceptance.
- Run a disposable second-tenant acceptance: platform-admin create, exact owner
  email verification/invite activation, cross-tenant denial, neutral default
  inspection, reviewed package/event/pricing setup, conflict-safe catalog save,
  trusted quote create/readback/version proof, signed-out portal acceptance,
  staff decision verification, and exact cleanup/tombstone proof.
- Promote the shared verified-domain sender
  `QuotePilot by MBMApps <quotepilot@leaguepilot.us>` with a restricted Resend
  key, then capture provider accepted, delivered-event, and recipient-inbox
  proof. Track migration to a dedicated QuotePilot sender domain separately.
- Keep public buyer onboarding and the deposit/final-balance rails disabled until
  their exact target receives coordinated hosted Stripe test-mode, webhook,
  reconciliation, cross-rail, negative-path, and customer-projection acceptance.

## P0 - Multi-Tenant Hardening (Post Rollout)
- Run authenticated hosted cross-tenant and portal-path smoke verification
  against the deployed hardened rules: active exact-issuance tokens succeed;
  expired, deleted, legacy-no-evidence, mismatched, and foreign-tenant paths
  fail closed.

## P0 - Security and Reliability
- Strengthen the existing `main` protection from zero required approvals to an
  independently enforceable review policy with code-owner, stale-review, and
  last-push controls. Add a non-admin collaborator or separately owned gate;
  the current sole-admin collaborator model cannot provide independent review.
- Create `production-uat`; protect it and `Production` with self-review
  prevention, administrator bypass disabled, protected-branch policy, and an
  independent reviewer; set `RELEASE_UAT_ATTESTER_IDS` to approved human GitHub
  user ids. The August 3 audit found `production-uat` absent and `Production`
  unprotected. Confirm the private repository plan supports these controls or
  transfer/upgrade/use an external deployment protection gate.
- Prevent Vercel Git integration or any alternate provider entrypoint from
  bypassing the controlled production workflows.
- Replace credential-bearing `npx` provider execution with a separately locked,
  audited, checksum-verified Firebase/Vercel tool image or narrow provider API
  client; do not import the currently vulnerable CLI dependency trees into the
  application lockfile. Split preparation from mutation and expose the provider
  token only to the fixed, minimal final tool process—not repository build,
  verifier, npm, or application code.
- Bind UAT to provider-derived staging project/deployment id, source SHA, READY
  state, artifact/configuration digest, and timestamp. Validate the historical
  GitHub deployment review and absence of bypass instead of relying only on
  current environment policy.
- Replace rollback ancestry alone with a signed provider-specific successful
  deployment manifest and component-scoped last-known-good artifact.
- Rehearse an exact-main immutable staging pass, protected UAT attestation, and
  rejected invalid-evidence deploy without changing production; attach run ids
  and environment-policy evidence.
- Add a separately owned GitHub App/check or equivalent external verifier for
  release-critical source changes when stronger tamper independence is needed.

## P1 - Performance and UX
- Reduce largest JavaScript chunk size (split proposal/export-heavy paths where practical).
- Continue mobile-density cleanup beyond the implemented persistent pricing
  summary, active-step rail, compact operator action rail, and simplified
  Step 1 staffing-pricing boundary.
- Add intentional transition/motion polish for step changes and live breakdown updates.

## P1 - Product Capability
- Add opt-in, provider-backed notifications and configurable escalation rules
  for due follow-ups and new customer change requests; preserve the in-app
  Workflow Attention queue as operational tracking rather than delivery proof.
- Run and review the tenant-scoped production portal-projection dry run, resolve
  conflicts, then explicitly authorize the guarded apply so older active links
  receive the new decision-center event, selection, and pricing fields. The
  tool and emulator acceptance are complete; production execution is not.

## P1 - Customer-Centered Workspace Rollout
North star:
[docs/CUSTOMER_CENTERED_WORKSPACE_PLAN.md](docs/CUSTOMER_CENTERED_WORKSPACE_PLAN.md).
Backend contract:
[docs/CUSTOMER_WORKSPACE_BACKEND_HANDOFF.md](docs/CUSTOMER_WORKSPACE_BACKEND_HANDOFF.md).

- Put the new shell/default landing behind its temporary build flag for an
  exact hosted candidate. Verify direct deep links, Back/Forward, signed-in
  staff roles, mobile navigation, authenticated 404, proposal-preview branding,
  and `/app?portal=...` precedence before considering flag removal.
- Do not run the legacy customer-ID backfill in production from this work.
  Review a tenant-scoped dry-run artifact first; production apply requires a
  separate authorization, exact confirmation contract, and release record.
- Before a tenant receives the new directory flag, inventory imported-only
  customer records created by the prior browser path and review a dry-run
  normalization artifact, including missing/conflicting private email claims.
  Deploying the new customer-import callables does not retroactively add
  directory keys or email claims to those records.

## P1 - Customer Workspace Second Evaluation

Detailed contracts and invariants:
[docs/CUSTOMER_CENTERED_WORKSPACE_PLAN.md#second-evaluation-enhancement-track](docs/CUSTOMER_CENTERED_WORKSPACE_PLAN.md#second-evaluation-enhancement-track).

### Pre-Host Release Candidate

- **CWF-01:** Finish human-readable status/date/money/empty formatting and
  hosted keyboard, overflow, contrast, focus, and branding-isolation acceptance.
  Preserve the contained desktop action row, mobile More hierarchy,
  route-appropriate return language, and distinct canonical state.
- **CWF-03:** Add the staff trust/freshness/evidence rail with tenant scope,
  source contract, last successful refresh, stale/error/truncation state, and
  canonical-versus-derived labeling. Keep the first slice surface-scoped and
  read-only over canonical staff data/server receipts and constrained by the
  signed-in role's existing read contracts; never invoke the portal loader,
  create `viewed` evidence, or infer provider/commercial truth. Treat a global
  evidence ledger as separate work.

### Platform Primitive - First New Program

- Before CWF-15A source work, accept a dedicated ADR/design contract covering
  registry ownership and schema evolution, deterministic canonical
  serialization and hashing, browser/server parity boundaries, cycle and
  version compatibility, and simulation/invalidation transaction authority.
  The graph may consume server-authoritative pricing outputs but must never
  become a second pricing engine.
- **CWF-15:** Build a versioned Commercial Dependency Graph before adding more
  isolated dashboards or workflows. Model authoritative fact nodes (including
  guest count, event timing, venue, accepted revision, menu, rentals, staffing,
  and dietary constraints), their dependent commercial/operational outputs,
  and deterministic traversal with cycle/unknown-node rejection. A trusted
  change must support `simulate -> authorize -> invalidate -> reconcile ->
  publish`: show before/after facts, pricing and payment-scope deltas, stale or
  review-required artifacts, reopened checks, and safe-to-publish status before
  any mutation. Keep immutable accepted versions, contracts, provider/payment
  evidence, portal decisions, and generated artifacts unchanged during
  simulation; atomically record authorized invalidations and require explicit
  reconciliation/publication.
- Derive artifact freshness from schema-versioned dependency fingerprints plus
  source revision and generation time, starting with the revision-stamped BEO.
  A matching fingerprint proves only declared-input equivalence; a mismatch
  surfaces `STALE`/`REVIEW` and an exact role-safe action, never inferred
  acceptance, delivery, payment, booking, or completion.
- Derive Decision Debt deterministically from unresolved dependencies,
  tenant-local event proximity, bounded commercial exposure, dependency weight,
  reversibility, and validated tenant lock windows. Explain every factor and
  affected decision; do not market it as predictive AI. Require pure graph and
  parity fixtures, immutable simulation receipts, transaction/authorization
  tests, and CWF-14-bound Change Impact, freshness, and Attention UI states.
- Before CWF-15C source work, accept a UI specification with a state/display
  matrix for Change Impact, Current/Stale/Review, authorization, invalidation,
  reconciliation, receipt, error, and recovery, plus acceptance-criteria
  traceability to every discoverable role-safe control and Attention outcome.
- Deliver CWF-15 in three reviewable slices: **15A** pure versioned registry,
  traversal/parity fixtures, and a BEO fingerprint embedded in the generated
  artifact without claiming retained freshness; **15B** server-owned immutable
  artifact-generation receipts emitted only by already governed existing
  artifact actions plus read-only impact simulations, with no independent
  authorize/invalidate/reconcile/publish mutation; **15C** trusted receipt
  comparison, the UI-bound authorized invalidation/reconciliation/publication
  workflow and its atomic audit receipts, Current/Stale/Review controls, Change
  Impact, and explainable Decision Debt UI. Do not start 15B until 15A is
  deterministic in browser/server tests. Do not call any slice complete until
  its applicable backend and frontend states pass the CWF-14 productization gate;
  exact hosted staff acceptance remains separately recorded.

### First Follow-On

- **CWF-02:** Add bounded same-tenant universal commercial search and a
  keyboard command palette. First federate bounded Customer and Quote reads;
  put broader proposal/event discovery behind a bounded backend read model with
  tenant cursors, caps, opaque IDs, and visible truncation. Keep queries/customer
  content out of URLs and browser storage; never expose portal tokens, private
  claims, message bodies, private payment records, raw analytics, or admin-only
  data; preserve every role/approval/confirmation gate.
- **CWF-04:** Add a Customer 360 relationship briefing header derived from the
  bounded customer DTO, including current attention, next event, latest
  activity, freshness, and next safe staff action without a persisted rollup or
  generic customer account. Treat mutable notes, tags, ownership, health scores,
  and cached summaries as a separate CRM/customer-record authority program.
- **CWF-05:** Add an evidence-safe, source-labeled customer timeline for quote
  versions, provider acceptance, provider-reported delivery/bounce, recipient
  view, decisions, booking, payment, and quote-scoped conversation milestones.
  Keep delivery milestones distinct; do not merge messages or invent evidence.
- **CWF-06:** Add advisory proposal-readiness and immutable-version change
  intelligence deterministically without recalculating or mutating history;
  keep save/send intentional, server pricing authoritative, and customer input
  non-authoritative for scope, prices, or totals. Route AI scoring or persisted
  recommendations through separate privacy/model governance.
- **CWF-07:** Add timestamp-derived due/overdue/aging cues and trusted internal
  completion receipts first. Persisted owner, SLA, escalation, and handoff state
  require server validation and a safe staff directory, must not let sales
  enumerate `userRoles`, and keep provider notifications in a separate program.
  Never present receipts as customer contact, provider delivery, proposal
  resolution, payment, or booking proof.

### Later Follow-On

- **CWF-08:** Add an event run-of-show schedule derived from existing event,
  booking, staffing, checklist, and BEO references as a generated read-only view
  first. Collaborative tasks, dependencies, rosters, resources, vendors, and
  portal-visible timing require a separate versioned event-operations model;
  keep it separate from inventory, attendance, acceptance, payment, and booking
  evidence.
- **CWF-09:** Add a proof-safe commercial intelligence studio with visible
  scope, freshness, denominators, and truncation; keep accepted/booked quote
  value separate from verified money received and label neither accounting
  revenue. Bound the existing Reporting read before reuse; require tenant-bounded
  server aggregates for substantive expansion, with accounting, reconciliation,
  tax, refunds, and disputes outside this program.
- **CWF-10:** Polish typed-signature interaction and stale/retry/success/focus
  recovery in the existing exact-token decision center with reduced-motion
  behavior; do not create a generic portal/account or weaken callable-owned
  acceptance and pricing authority. Reuse existing idempotency/reconciliation
  behavior and never auto-retry a non-idempotent provider operation.

### Revenue, Retention, and Productization Extensions

- **CWF-11:** Add a one-week post-event closeout sequence plus anniversary
  repeat-event alerts. Let staff create a reviewed rebook draft from the last
  accepted immutable version through trusted duplication and current
  server-authoritative repricing; never present a reminder as a lead, booking,
  delivery, or revenue fact. Gate outbound thank-you/review requests with
  consent, suppression, idempotency, tenant timezone, and provider evidence.
- **CWF-12:** Add an SMS-free revenue-autopilot slice using scheduled,
  tenant-branded email and Attention escalation: quote follow-ups that stop on
  exact portal view/accept/decline; accepted-quote deposit reminders that stop
  on webhook payment; final-balance reminders at tenant-local event-minus-14/7/3
  days that stop on the matching settled rail; and explicit staff-read markers
  for unacknowledged customer replies. Include quiet hours,
  consent/unsubscribe/suppression, templates, idempotent jobs, bounded retry,
  role gates, and separate accepted/delivered/bounced/viewed evidence. Define
  attribution before claiming recovered value and keep booked value, verified
  money received, and accounting revenue separate.
- **CWF-13:** Activate Customer 360 as the CRM-grade staff relationship view
  with bounded quote/proposal, event, verified-payment, quote-conversation,
  repeat-pattern, and next-action context. Add lifetime commercial measures
  only with visible denominators and separate quoted, accepted, booked, and
  webhook-verified money. Do not introduce a persisted `commercialSummary`, a
  second identity, generic external account, or customer-wide mutable thread;
  complete hosted activation and legacy normalization through their existing
  rollout gates.
- **CWF-14:** Maintain and extend the no-orphan-capability productization gate.
  For every new user-relevant backend contract, identify the audience and ship
  a discoverable, role/feature-safe frontend entry with loading, empty, success, stale,
  partial/truncated, error, retry/reconciliation, and receipt states as
  applicable; include responsive, keyboard/focus, accessibility, browser,
  Feature Matrix, and user-manual coverage. Keep secrets, private claims, raw
  provider records, and security internals hidden while surfacing the safe
  operational outcome or Attention state users need. Keep the `lane:core`
  capability-surfacing manifest/export/locator gate mandatory as the backlog
  evolves. Bind claimed states to assertion-bearing canonical component markers,
  list shared-helper callable impacts explicitly, and never let a callable export
  use a headless classification; do not replace the gate with checklist-only
  review or mistake its structural evidence for semantic/visual acceptance.

## P1 - Customer and Payments Decision Tracks
- Specify first-class structured change requests as a callable-only program
  that links customer intent to an authoritative resulting quote version. Keep
  the existing freeform request-changes decision path until that program is
  separately implemented and accepted.
- Keep persistent external customer accounts in discovery until membership,
  recovery, revocation, multi-organization access, migration, and coexistence
  with the exact-token decision center are specified.
- Treat Stripe Connect as a separate payments architecture decision. Resolve
  account type, merchant-of-record responsibility, webhook and credential
  isolation, payouts, refunds, disputes, tax/accounting obligations, and
  coexistence with both existing Stripe rails before implementation.

## P2 - Integrations
- Complete Twilio Messaging Service A2P registration and approval, promote the
  Secret Manager-bound SMS configuration through the governed Functions
  release, and capture provider acceptance plus destination-device receipt.
- Add CRM adapters (HubSpot/Salesforce or webhook bridge).
- Add accounting sync for invoicing and reconciliation flows.
- Add two-way owner/client SMS thread support.

## P2 - Configurability
- Move more pricing behavior to config-driven policies.
- Add feature flags for optional modules.
- Add finer role-based controls for approvals/report visibility.
