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
- Qualify the first-release source with the high-risk maintainer lane: native
  `/app` routes, Command Center snapshot/focus behavior, sticky quote-draft
  continuity, stable `customerId`, paginated customer reads, Customer 360,
  authority hardening, and dry-run/emulator backfill behavior. Keep source,
  local, emulator, hosted, production, and human evidence separate.
- Put the new shell/default landing behind its temporary build flag for an
  exact hosted candidate. Verify direct deep links, Back/Forward, signed-in
  staff roles, mobile navigation, authenticated 404, proposal-preview branding,
  and `/app?portal=...` precedence before considering flag removal.
- Do not run the legacy customer-ID backfill in production from this work.
  Review a tenant-scoped dry-run artifact first; production apply requires a
  separate authorization, exact confirmation contract, and release record.
- Before a tenant receives the new directory flag, inventory imported-only
  customer records created by the prior browser path and review a dry-run
  normalization artifact. Deploying the new customer-import callables does not
  retroactively add directory keys to those records.
- Extend semantic status chips to Quote History and Schedule in separate
  reviewable UI slices while keeping proposal acceptance, booking, deposit,
  final balance, and operational readiness distinct.
- Add delivery/provider blockers to Home only after a bounded Home-safe
  presentation contract exists; do not duplicate delivery authority logic.

## P1 - Remaining Routed Workspaces
- Extract Schedule and Reporting to `/app/schedule` and `/app/reporting` while
  preserving existing lazy recovery, filters, focus, and draft continuity.
- Extract Catalog, Imports, Integrations, and Diagnostics to their planned
  `/app/*` routes with the current role/feature gates unchanged.
- Finish neutral staff styling inside routed operational surfaces with explicit
  staff-shell selectors; do not leak the neutral skin into staff proposal
  previews, customer portals, proposal exports, or marketing.

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
