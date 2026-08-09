# Dev Tasks

Last updated: August 9, 2026

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

- **CWF-01:** Qualify the source-complete human-readable status/date/money/empty
  formatting, Quotes/Workflow route-return language, and primary-route heading
  focus on an exact hosted candidate. Verify signed-in keyboard order, long-data
  overflow, real-rendered contrast, focus, and staff/proposal branding isolation
  while preserving the contained desktop action row, mobile More hierarchy,
  modal **Close** wording, and distinct canonical state.
- **CWF-03:** Qualify the Home-first staff trust/freshness/evidence rail on an
  exact hosted candidate. It now names tenant scope, the two existing read
  contracts and their outcomes, source, last complete client read,
  loading/refresh/incomplete/retained-stale/error/truncation state, and
  canonical-versus-derived authority without adding I/O. Keep expansion to
  Directory/Customer 360 surface-scoped and read-only; treat a global evidence
  ledger as separate work. Never invoke the portal loader, create `viewed`
  evidence, or infer provider/commercial truth.

### Platform Primitive - Next Governed Slices

- Treat **CWF-15A** as the source-complete baseline defined by
  `docs/COMMERCIAL_DEPENDENCY_GRAPH_ADR.md`: a frozen versioned registry,
  validation and deterministic downstream traversal, browser/Node canonical
  serialization and SHA-256 parity, and a schema-bound Kitchen BEO input digest
  visible in the existing staff download. It performs no write and establishes
  no retained generation, freshness, actor, server-time, receipt,
  reconciliation, or publication evidence. The graph may consume
  server-authoritative pricing outputs but must never become a second pricing
  engine. Hosted kitchen-operator acceptance remains a separate release gate.
- **CWF-15B-a — establish generation authority before freshness.** There is no
  existing governed server BEO generation action to extend. Approve and
  productize either a new CWF-14-bound server generation/receipt action or move
  artifact generation authority server-side. The server must reload canonical
  same-tenant data, recompute the declared-input fingerprint, bind the exact
  artifact/quote/revision identity plus actor and server time, and persist an
  immutable idempotent receipt through a role-safe UI with ready, submitting,
  uncertain, reconciliation, success, definitive-error, and recovery states.
  Browser-supplied digest, source revision, actor, or time can never become
  receipt truth.
- **CWF-15B-b:** Qualify and promote the source-complete read-only Change Impact
  preview on an exact hosted candidate. The current edit surface asks the
  trusted pricing callable for the saved canonical revision plus a
  server-authoritatively repriced proposed form, then reports exact fact and
  commercial deltas with deterministic `REVIEW`/`STALE` dependents. Verify
  same-tenant role gates, stale-generation recovery, long-data containment,
  keyboard behavior, and authoritative-pricing parity. This preview performs
  no save, authorization, invalidation, regeneration, checklist mutation, or
  publication and does not satisfy the separate generation-receipt prerequisite
  above.
- Before **CWF-15C** source work, accept a UI specification with a state/display
  matrix for Change Impact, `CURRENT`/`STALE`/`REVIEW`, authorization,
  invalidation, reconciliation, receipt, error, and recovery, plus
  acceptance-criteria traceability to every discoverable role-safe control and
  Attention outcome. Only a trusted server receipt may be compared with a
  freshly server-derived authoritative fingerprint.
- CWF-15C may then deliver the UI-bound, role-gated
  `simulate -> authorize -> invalidate -> reconcile -> publish` workflow and
  atomic audit receipts. Keep immutable accepted versions, contracts,
  provider/payment evidence, portal decisions, and generated artifacts
  unchanged during simulation; stale dependents never silently regenerate or
  republish.
- Derive Decision Debt only after those authority boundaries exist, using
  unresolved dependencies, tenant-local event proximity, bounded commercial
  exposure, dependency weight, reversibility, and validated tenant lock
  windows. Explain every factor and affected decision; do not market it as
  predictive AI. Each remaining slice requires graph/parity, transaction,
  authorization, reconciliation, and CWF-14 UI-state coverage appropriate to
  its authority. Exact hosted staff acceptance remains separately recorded.

### First Follow-On

- **CWF-02:** Qualify and extend the source-complete first tranche of bounded
  same-tenant Customer/Quote search and its keyboard command palette. Verify the
  exact hosted flag-on keyboard/mobile experience and truncation/retry language;
  put broader proposal/event discovery behind a bounded backend read model with
  tenant cursors, caps, opaque IDs, and visible truncation. Keep queries and
  customer content out of URLs, History state, and persisted search state; never
  expose portal tokens, private claims, message bodies, private payment records,
  raw analytics, or admin-only data, and preserve every authority gate.
- **CWF-04:** Qualify and extend the source-complete Customer 360 relationship
  briefing derived from the bounded customer DTO. Preserve its current
  attention, next-event, latest-activity, freshness, and next-safe-action
  boundaries through hosted acceptance. Treat mutable notes, tags, ownership,
  health scores, and cached summaries as a separate CRM/customer-record
  authority program rather than extending the read-only briefing implicitly.
- **CWF-05:** Qualify and extend the source-complete evidence-safe customer
  timeline. Its current source-labeled version, acceptance, view, decision,
  booking, payment, and quote-conversation milestones must receive hosted
  acceptance; provider delivery/bounce stays omitted until the bounded DTO has
  authoritative receipt fields. Keep delivery milestones distinct, do not merge
  quote conversations, and never invent missing evidence.
- **CWF-06:** Qualify and extend the source-complete advisory proposal-readiness
  and immutable-version comparison surfaces without recalculating or mutating
  history. Preserve intentional save/send, server pricing authority, and
  non-authoritative customer input. AI scoring or persisted recommendations
  remain a separate privacy/model-governance program.
- **CWF-07:** Qualify and extend the source-complete timestamp-derived
  due/overdue/aging cues and trusted internal completion receipts in Workflow.
  Persisted owner, SLA, escalation, and handoff state still require server
  validation and a safe staff directory, must not let sales enumerate
  `userRoles`, and keep provider notifications in a separate program. Never
  present internal receipts as customer contact, provider delivery, proposal
  resolution, payment, or booking proof.

### Later Follow-On

- **CWF-08:** Qualify and extend the source-complete bounded event run of show
  derived from existing event, booking, staffing, checklist, and BEO references.
  Verify the generated read-only sequence on an exact hosted candidate.
  Collaborative tasks, dependencies, rosters, resources, vendors, and portal-
  visible timing still require a separate versioned event-operations model; keep
  it separate from inventory, attendance, acceptance, payment, and booking
  evidence.
- **CWF-09:** Qualify and extend the existing bounded Reporting tranche into a
  proof-safe commercial intelligence studio with visible scope, freshness,
  denominators, and truncation. Preserve separation among accepted/booked quote
  value and verified money received, and label neither accounting revenue.
  Require tenant-bounded server aggregates before substantive drill-down or
  scale expansion; accounting, reconciliation, tax, refunds, and disputes stay
  outside this program.
- **CWF-10:** Qualify and promote the source-complete typed-signature recovery
  and reduced-motion polish in the existing exact-token decision center. Verify
  stale/retry/success/focus behavior on the exact hosted candidate; do not create
  a generic portal/account or weaken callable-owned acceptance and pricing
  authority. Reuse existing idempotency/reconciliation behavior and never auto-
  retry a non-idempotent provider operation.

### Revenue, Retention, and Productization Extensions

- **CWF-11:** Qualify and promote the source-complete bounded post-event and
  anniversary radar plus exact-version rebook-draft path. The current trusted
  callable accepts only a booked quote with matching acceptance receipt and
  retained immutable version, creates one deterministic current-catalog-priced
  draft for the same stable customer, and requires staff to save a new
  current-or-future event date before delivery. Disposable local emulator
  acceptance for idempotency, collision, reconciliation, catalog repricing, and
  recovery is complete; it is not hosted evidence. The remaining release task is
  to promote the callable with its frontend on an exact candidate and verify
  hosted staff review. Then add the
  still-missing scheduled closeout records and outbound thank-you/review asks
  behind consent, suppression, idempotency, tenant timezone, and provider
  evidence. Never present a cue or draft as a lead, booking, delivery, or
  revenue fact.
- **CWF-12:** Treat the source-complete, read-only Revenue Autopilot eligibility
  preview as the safety specification for the later scheduler. It evaluates one
  quote from the bounded Workflow read against exact portal decisions,
  acceptance, webhook payment, tenant-local final-balance windows, conversation
  read evidence, and outbound controls; Catalog Admin supplies the authoritative
  tenant IANA time zone, and absent evidence fails closed. Qualify that preview
  on a hosted candidate, then separately build trusted staff-read receipts,
  scheduled tenant-branded email, Attention escalation, templates, consent/
  unsubscribe/suppression, quiet hours, idempotent jobs, bounded retry, and
  distinct accepted/delivered/bounced/viewed evidence. The current preview
  schedules and sends nothing. Define attribution before claiming recovered
  value and keep booked value, verified money received, and accounting revenue
  separate.
- **CWF-13:** Qualify and promote Customer 360 and its source-complete bounded
  commercial-measures panel on an exact hosted candidate. The current read-only
  derivation shows quoted, exact-state accepted/booked, provider-confirmed
  deposit/final-balance amounts, and repeat-event evidence with visible record
  coverage; it uses `Lifetime` only when the bounded quote read reports complete
  and otherwise says `Displayed-record`. Preserve explicit partial/stale/error
  states and the non-accounting boundary. Complete legacy identity/claim
  normalization and flag activation through their existing rollout gates; do
  not introduce a persisted `commercialSummary`, second identity, generic
  external account, or customer-wide mutable thread.
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
