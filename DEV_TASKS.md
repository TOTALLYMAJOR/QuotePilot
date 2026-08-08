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

## P1 - Commercial Command Center Follow-on
The Home workspace view and shared status-chip system shipped in source
(`docs/FEATURE_MATRIX.md` row 29); these are the pieces of the originating
UX audit intentionally left out of that first pass to keep it reviewable,
frontend-only, and free of any change to a high-risk file.
- Add a route/shell so Home, Quotes, and the wizard are real navigable
  destinations instead of a header button that swaps the main content
  region; keep `?portal=` precedence and the existing lazy-tool recovery
  boundaries intact through the migration.
- Retrofit the `StatusChip`/`src/lib/statusSemantics.js` system onto Quote
  History's status column, Event Schedule's confirmation/conflict labels,
  and the customer portal's payment status, replacing today's plain text
  and raw `<select>` with the same never-color-only chip grammar Home now
  uses. Do this as its own reviewable pass per surface, not all at once.
- Add delivery/provider blockers (mutation-locked delivery, disabled email
  provider) to Home's attention inbox once a lightweight, Home-safe read of
  `getQuoteDeliveryUiState`-equivalent state exists; the first Home pass
  intentionally left this out rather than duplicating that logic.
- Consider making Home the default landing view instead of the wizard; this
  needs `e2e/quote-wizard.smoke.spec.js` and related specs updated for the
  new landing assertion, not just the App.jsx change.
- Extend the shipped staff-scoped `app-shell-neutral` chrome to the interior
  of the large workspace dialogs (Quote History, Catalog Admin, Integrations
  Ops tables and section styling), which still carry cream/gold treatments
  inside the now-white modal cards.

## P1 - Customer Workspace Backend (Codex Handoff)
Full slice plan: [docs/CUSTOMER_WORKSPACE_BACKEND_HANDOFF.md](docs/CUSTOMER_WORKSPACE_BACKEND_HANDOFF.md).
Each slice below is independently scoped with its own Change Intent
Contract, files, data shape, and acceptance criteria; none is started.
- Slice 1: a server-maintained commercial rollup on each `customers` record
  (open quotes, active events, deposit/balance due, last activity) so an
  Internal Customer 360 view can answer "what's open here" in one read.
- Slice 2: a first-class `changeRequests` record (structured asks, status,
  owner, linked resulting revision) replacing today's freeform-message-only
  `portalDecision.changes_requested` path — without removing that existing
  path. This is the largest and highest-value slice; expect it to be split
  further by whoever implements it.
- Slice 3: a tenant Stripe Connect merchant-account foundation (account
  status, requirements, payouts) isolated from both existing Stripe rails,
  populated only from Stripe API responses and signed webhooks. Requires an
  explicit Connect account-type decision (Standard/Express/Custom) before
  implementation starts.
- Slice 4: external customer account (persistent, multi-event) — explicitly
  not yet spec-ready; needs an identity/migration decision documented in
  the handoff doc before it can be scoped as an implementable slice.

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
