# Dev Tasks

Last updated: 2026-08-29 04:16:11 CDT

Only open work belongs here. Current operational truth lives in
[`PROJECT_STATUS.md`](PROJECT_STATUS.md); shipped history lives in
[`CHANGELOG.md`](CHANGELOG.md).

## Capability-to-Backlog Execution Map

This map is the execution index for the detailed open work below. Capability
state comes from [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md); operational
and production proof comes from [`PROJECT_STATUS.md`](PROJECT_STATUS.md). A
source implementation, local test, provider acknowledgement, deployment, and
human acceptance are separate evidence levels.

Execution rules:

- Work in dependency order, but skip a blocked slice and take the next `ready`
  slice. Never weaken an authority or proof boundary to make a task appear
  unblocked.
- Before implementation, give the slice an exact planner task and file set.
  One slice owns one independently reviewable commit. Do not push.
- A slice may be committed only when its files or hunks have proven ownership,
  required checks pass, canonical docs are synchronized, and residual risks are
  explicit. Mixed-ownership worktree changes are a blocker to that commit, not
  permission to include them.
- `human/external` means repository work cannot produce the missing evidence.
  Prepare the immutable checklist or harness, then stop before the external or
  human action and continue with another `ready` slice.

Release checkpoint: the owner authorized publication and governed deployment
pursuit for the 74-commit v0.16.0 candidate on 2026-08-29. This authorizes the
release workflow, not bypassing it. The local high-risk plus CWV profile passes;
exact parent `55d37faa1cb266137f156037626c3266f71035f2` passes PR #111 CI run
`33239568701` and both Stripe Connect source-only workflows. Governed Firebase
and Vercel candidate commands stopped before mutation: staging first needs the
separately authorized non-provider `STAFF_INVITATION_TOKEN_SECRET` placeholder,
then an exact Firebase safe-off deploy/readback must prove
`COMMERCIAL_CHANGE_AUTHORITY_ENABLED=false` before Vercel preview can proceed.
Full production qualification remains blocked by the positive-path items in the
tracked UAT plan. `docs/RELEASE_V0_16_PROMOTION_REPORT.md` owns the point-in-time
candidate inventory and human-input checklist. Source-only commits remain
separate from release publication, and dormant gates remain off.

| Order | Task ID and outcome | Capability truth | Dependencies | Acceptance criteria | Current boundary |
|---:|---|---|---|---|---|
| 0 | `QP-OBS-018` — Product Truth Digest and drift control | Cross-cutting source/release/capability/evidence observability; no new product authority | Accepted ADR/design; deterministic source adapters; current contradiction fixtures; existing task evidence, capability, release, and canonical-doc contracts | `status:product` answers live/candidate/proof/drift/owner-decision questions; `check:product-drift` detects conflicting release identity, branch divergence, evidence gaps, and capability-gate failures; every finding cites exact sources; unavailable evidence stays `unknown`; no generated digest becomes authority | Repository implementation and advisory CI wiring are complete locally. The clean reconciled candidate resolves exact v0.15 production identity with no product-truth drift. Exact CI observation, owner comprehension review, freshness calibration, and any required-gate promotion remain human/external. Hosted/provider/production/human evidence remains independently sourced. |
| 1 | `QP-GOV-001` — restore a truthful capability-surfacing gate | Row 32: no-orphan-capability gate | Exact clean baseline; ownership of the stale Quote History locator and six ambient/workflow path declarations | `npm run check:capability-surfaces` passes from the validated baseline; every changed authority path maps to a real role-safe surface/test or a valid headless classification; no manifest entry claims UI, deployment, provider, or human proof it does not have | Complete locally: the clean committed candidate passes the capability-surfacing gate; remote CI observation remains `human/external` |
| 2 | `QP-PERF-002` — close temporary bundle exceptions | Rows 29, 60, 62, 64 and the performance guardrail | Clean-main/candidate measurements; exact graph profile; accepted optimization or reviewed baseline recalibration | Compatibility and Ambient graphs pass the standard budget without a no-headroom exception; build, browser/CWV, and docs gates pass; no route, accessibility, or authority regression | Minifier slice restores 21.7 KB of headroom under the unchanged exception; full exception retirement remains a reviewed graph-optimization or baseline decision |
| 3 | `QP-CONFIG-003` — remove remaining `functions.config()` compatibility | Runtime/deployment capabilities using Firebase Functions | Source migration complete; exact coordinated backend release; runtime readback; March 2027 deadline | No production runtime depends on `functions.config()`; local fallback and secret boundaries remain intact; function tests, env materialization, build, emulator lanes, and deployment docs pass | Source candidate complete; deployment/runtime proof is `human/external` |
| 4 | `QP-ACCEPT-004` — exact authenticated staff/operator acceptance | Rows 5, 8, 18, 27, 29–30, 34–45, 47–60, 63, 68–72 as applicable to the candidate | Immutable exact SHA and flag profile; real QuotePilot staff session; canonical tenant data; rollback artifact | Named route/task matrix proves create, save, exact readback/version, export, Workflow, Event Workspace, Customer 360, Messaging, BEO, Decision Debt, payments, staffing boundaries, and role denials; every result is tied to the SHA and evidence level | Machine contract prepared as `operator.authenticated-workspace-journey`; execution remains `human/external` |
| 5 | `QP-TENANT-005` — disposable tenant lifecycle and isolation proof | Rows 1, 18, 25–26, 30 | Exact provisioning candidate; verified disposable owner; cleanup/tombstone plan; hosted auth | Plan/create/activate/defaults/starter review/pricing/quote/portal/cross-tenant denial/cleanup all produce exact receipts; no foreign-tenant or expired-token disclosure; cleanup is verified | `human/external` production coordination |
| 6 | `QP-BUYER-006` — bounded buyer-access test window | Row 26 plus quote/payment isolation in row 8 | Dedicated restricted Stripe test key; exact webhook events; existing Turnstile verification; rollback/close plan | Test-mode invoice creation, idempotency, rate limits, signed lifecycle, paid preparation, invitation/activation, eligible repair, negative paths, and quote-rail isolation pass; gate is closed afterward unless launch is separately approved | `human/external` credential and provider dashboard actions |
| 7 | `QP-DELIVERY-007` — quote-email provider-to-recipient evidence chain | Row 8 delivery authority and row 63 Operations Audit | Approved sender; exact Resend webhook/signing configuration; controlled recipient; current valid portal issuance | One exact attempt keeps provider acceptance, delivered/bounced reconciliation, portal validity, and recipient inbox/view as separate receipts; invalid/expired issuance fails closed or requires rotation | `human/external` provider and recipient evidence |
| 8 | `QP-AUTO-008` — Revenue Autopilot preparation-only promotion | Rows 37 and 46 | Authenticated admin acceptance; `QP-DELIVERY-007` webhook evidence; named rollback; sends remain off | Policy, controls, materialization, operations projection, and unread-reply acknowledgement pass hosted checks; preparation gate is on, send gate is off, and no recovered-revenue claim is made | `human/external` hosted/provider gate promotion |
| 9 | `QP-STAFF-009` — one-tenant authoritative staffing qualification | Row 59 and Commercial Change/Workflow dependencies | Repaired tenant settings precondition; exact all-scope deployment; admin/sales/customer/cross-tenant role matrix; rollback | Profile, availability, assignment, reconciliation, conflict, immutable receipts, responsive accessibility, and denials pass; exactly one approved tenant is enabled; acknowledgement is not attendance/payroll/readiness | `human/external`; tenant mutation requires reviewed authorization |
| 10 | `QP-SMS-010` — one governed owner-SMS provider path | Row 67 | Choose Pingram or Twilio; credentials in Secret Manager; sender/A2P/consent; exact origin/generation; signed webhook; rollback | One controlled owner-only UAT separates request acceptance, indeterminate dispatch, carrier delivery/failure, opt-out hold, and recipient receipt; STOP/unsubscribe blocks all providers; no automatic retry of claimed/indeterminate sends | `human/external` compliance, provider, and recipient evidence |
| 11 | `QP-CONNECT-011` — isolated Stripe Connect Sandbox foundation | Rows 65–66 | Reviewed cloud plan/digest; separate state; exact database/IAM/egress identities; authority publisher; App Check observation then enforcement | Applied resources match the secret-free manifest; edge cannot read the Stripe key; worker-only provider access, replay/quarantine, authority drift, and withheld-link paths pass; only then may exports be considered; Hosted Sandbox UAT is the stopping gate | `human/external` cloud apply and provider UAT; exports remain empty |
| 12 | `QP-AMBIENT-012` — qualify and promote the Ambient candidate | Rows 60, 64 and related source/local rows 61, 68–72 | `QP-GOV-001`; `QP-PERF-002`; immutable candidate; exact flag/rollback profile; authenticated roles | All 50 material items satisfy their complete acceptance contracts at 390/768/1440, keyboard/AT boundaries, connected data, first-minute comprehension, role denial, rollback, and explicit promotion approval; AIUI-48 deletion waits for parity and accepted release | Repository quick gate binds the 50-item inventory, operator UAT, and fail-closed retirement contract; full qualification/promotion remains `human/external`, and exception retirement remains under `QP-PERF-002` |
| 13 | `QP-PACKAGE-013` — Package Workspace hosted acceptance | Row 70 | Immutable candidate; admin and sales fixtures; catalog revision-conflict fixture; rollback | Hosted admin access, sales denial/availability, production-data review, revision recovery, responsive accessibility, and moderated operator acceptance pass without changing pricing, selected-at-zero, managed-menu, or missing-cost behavior | `human/external`; local proof is already complete |
| 14 | `QP-STEWARD-014` — consenting silent Difficult Question Desk pilot | Row 71 | Reviewed private runtime/provider transport; canonical context reads; private persistence; consent; kill/rollback; billing/privacy review | No model output is user-visible; exact packet validation and tenant/revision fences hold; 100 actual human packet reviews are recorded separately from the pinned corpus; promotion thresholds cannot self-authorize | Secret-scan preflight blocker repaired without weakening policy; Phase 1 private runtime and 100 reviews remain `human/external`; later product phases remain backlog |
| 15 | `QP-ATTEND-015` — attendance persistence and confirmation bridge | Row 60 attendance source note; attendance ADR Slice B onward | Direct terminology/channel research; accepted migration and authority plan; unchanged exact `event.guests`; existing Commercial Change receipts | Versioned planning/confirmation evidence persists with source/actor/time; legacy reads remain valid; differing confirmed counts remain proposed until exact-revision apply; BEO/closeout freshness stays separate; portal, rules, role, tenant, and browser acceptance pass | `blocked on product/human decisions`; read-only Slice A/C is complete locally |
| 16 | `QP-PWA-016` — qualify the installable safe recovery shell | Row 62 | Repository manifest, cache namespace, asset allowlist, navigation fallback, responsive recovery, and production-preview proof complete; exact deployment and supported test devices remain | On the exact hosted candidate, supported desktop/mobile browsers install and relaunch; offline navigation reaches the truthful recovery page; reconnect succeeds; no authenticated data or trusted mutation is represented as offline-capable | Repository slice complete; exact deployment, hosted install/relaunch, and physical-device acceptance are `human/external` |
| 17 | `QP-AUDIT-017` — complete optional cross-surface security/audit depth | Row 21 plus row 63 Operations Audit | Bounded taxonomy, retention/privacy boundary, server receipt authority, tenant/role visibility, and legacy-event compatibility are implemented locally | Final quote approvals and organization role changes have server-owned, tenant-scoped, role-stamped immutable receipt projections; Operations Audit exposes only bounded safe fields; replay, failed execution, foreign-tenant rejection, retention, truncation, and export/clear policy tests pass | Repository slice complete; deployment, authenticated hosted role/tenant denial, production-data review, and human acceptance are `human/external`; provider-derived outcomes remain separately evidenced |

`QP-OBS-018` is the implemented source/local cross-cutting control before
additional provider promotion work. Its deterministic commands and advisory CI
job now exist. Observe the first exact CI digest, review owner comprehension and
false positives, calibrate freshness, and require a separate owner decision
before enforcement.

The repository-preparable slices for `QP-GOV-001`, `QP-CONFIG-003`,
`QP-ACCEPT-004`, `QP-AMBIENT-012`, and the current `QP-PERF-002` headroom
repair are complete. Tasks `QP-ACCEPT-004` through `QP-CONNECT-011` may proceed
only when their named external evidence is available. Full `QP-PERF-002`
exception retirement requires reviewed graph ownership or baseline policy;
Ambient promotion, Package acceptance, Steward pilot execution, and attendance
authority likewise remain behind their explicit human/external decisions.
`QP-AUDIT-017` and `QP-PWA-016` are repository-complete and retain only their
exact deployment, hosted-role/data, device, or human gates. The explicitly
partial matrix rows now remain `QP-CONNECT-011` and `QP-STEWARD-014`, with
their higher-risk infrastructure, provider, privacy, and human gates.
The `QP-CONNECT-011` dormant repository foundation is also complete: its three
source checks pass and the read-only live staging inventory preflight is
`READY`. It remains partial because the saved-plan review/authorization,
Terraform apply, identity/manifest reconciliation, App Check observation and
promotion, restricted provider credential, exports, and hosted Sandbox UAT are
human/external work. Do not manufacture another source slice across that gate.
The `QP-STEWARD-014` deploy-dormant compiler, consent/evaluation contract,
unavailable-state UI, security fixtures, and manual fallback are likewise
repository-complete before the private-runtime gate. Eight focused files pass
84 tests, the secret scan passes, and three responsive browser checks pass.
Provider/credential and privacy/billing review, canonical context reads,
private persistence, consenting silent execution, 100 actual human reviews,
hosted rules evidence, deployment, and acceptance are human/external. Do not
expose model output or create a runtime adapter merely to remove `Partial`.
The remaining sections retain the detailed task contracts; this table does not
replace their safety conditions.

## P0 - Production Acceptance

- Through the separately authorized staging secret process, create and enable
  a non-provider `STAFF_INVITATION_TOKEN_SECRET` placeholder without exposing
  its value. Re-run the governed Firebase candidate deployment for the latest
  clean, published, exact-CI SHA. After its Functions readback proves every
  safe-off gate, run the governed Vercel preview deployment. Do not bypass the
  prerequisite checker or use production/provider credentials.
- Repair the tenant-data precondition for organization `250` before retrying
  operational staffing activation. Run `32425529671` verified the exact
  successful `v0.14.0` Firebase all-scope receipt, then stopped before mutation
  because `organizations/250/settings/config` was missing. Use a separately
  reviewed tenant-scoped migration/provisioning dry run and apply path; do not
  create a sparse settings document or bypass the protected activation
  workflow. Then rerun activation and retain the verified field readback.
- Run an authenticated production staff pass with a real QuotePilot user:
  create and finish a quote, save, read back the exact revision, reopen from
  Quotes, export PDF, and verify the Event Workspace, Customer 360, Workflow,
  Schedule, Reporting, Messaging Station, Kitchen BEO, Decision Debt, and
  Operations Audit role boundaries. Include the deployed NOW, Event Room,
  guided-selling, CREATE, staged-change, Pilot command, margin, and structured
  change-request-record surfaces under their production flag combination.
- Run a disposable second-tenant lifecycle: platform-admin plan/create,
  verified owner invitation and activation, neutral defaults, starter-pack
  review, pricing confirmation, trusted quote create/readback/version,
  signed-out portal decision, cross-tenant denial, and exact cleanup/tombstone.
- Run the deployed cross-tenant and portal-path matrix: active exact issuance
  succeeds; expired, deleted, legacy-without-delivery-evidence, mismatched, and
  foreign-tenant paths fail closed.
- Capture one exact quote-email acceptance sequence using the approved Resend
  sender. Keep provider acceptance, delivered/bounced webhook evidence, and
  recipient inbox/view evidence as separate receipts.
- Exercise the staff Kitchen BEO on hosted canonical data: generate, download,
  stale after a commercial revision, regenerate, and verify immutable receipt
  history. Do not describe this as kitchen review or event readiness.

## P0 - Buyer and Payments Safety

- Replace `BUYER_ACCESS_STRIPE_SECRET_KEY` with a dedicated test-mode restricted
  key. The currently bound credential identifies as live mode and cannot be
  used by the test-only buyer contract.
- In Stripe test mode, verify the exact
  `buyerAccessStripeWebhook` endpoint and the four allowed invoice events:
  `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, and
  `invoice.marked_uncollectible`.
- Verify the existing Turnstile widget on both approved production hostnames;
  reuse the current widget and secret rather than creating another integration.
- Open buyer access only for a bounded acceptance window after the key and
  webhook checks pass. Cover true Hosted Invoice Page creation, idempotency,
  rate limits, signed lifecycle events, paid workspace preparation, pending
  invitation, exact-email verification/activation, repair of eligible terminal
  unpaid test invoices, negative paths, and isolation from the quote-payment
  rail. Close the server gate after acceptance unless launch is separately
  approved.
- Run coordinated hosted acceptance for deposit and final-balance rails,
  including signed webhook replay, asynchronous success/failure/expiry,
  reconciliation, late settlement, cross-rail isolation, customer-safe
  projection, and negative paths. Keep provider evidence distinct from local
  emulator coverage.
- Continue the separately gated Stripe Connect program from its source-only
  owner-authority and deploy-empty `functions-connect` foundations. The
  owner/admin Team access surface, password/Google recent reauthentication,
  exact-role mutation receipts, claim synchronization, and App Check
  monitor-then-enforce source contracts are complete locally. The isolated
  staging Terraform/database/IAM/identity/network/egress/OIDC source and
  credential-free validation workflow are also complete locally. Next review a
  cloud-authenticated saved staging plan, separately authorize its exact digest,
  bootstrap separate state, apply it, deploy deny-all named-database rules, and
  reconcile the real resource IDs into the secret-free manifest. Then register
  the isolated staging reCAPTCHA Enterprise application/site key, observe App
  Check monitoring without enforcement, and promote enforcement plus consumed
  limited-use tokens only after hosted negative/replay evidence.
  The strict redacted status, receipt-bound current-role projection, exact
  named-database repository, fail-closed reviewed rate windows, immutable edge
  commands with the sole `qpcmd` provider identity, leased-worker terminal
  receipts, exact quarantine replay, private post-provider identity/occurrence
  retention, pre- and post-provider authority checks, `provider_withheld`
  recovery, an owner-bound replay-stable handoff, and the Accounts v2 Sandbox
  adapter with exact platform/mode preflight are now source-complete but
  deliberately uninstantiated and unexported. The next runtime review must bind
  a trusted authority publisher, prove that the edge identity cannot access the
  Stripe key, prove worker-only provider access, private quarantine/dead-letter
  operations, and no Account Link disclosure after authority drift, and enable
  exact App Check enforcement/limited-use token consumption. Only after those
  infrastructure/App Check evidence gates may the applied database/platform/
  resource IDs be reconciled into the staging manifest and the callable/HTTP
  exports be considered. Do not expose a partial browser surface or return an
  Account Link to application JavaScript.
  The exact consumed-invite owner backfill is source-complete but still needs
  governed production dry-run review and separately confirmed apply evidence;
  zero, multiple, unverified, or conflicting candidates remain
  `ownership_required`.
  After the infrastructure evidence gate, bind and validate Sandbox-only
  Accounts v2 merchant onboarding with direct charges, full Stripe Dashboard
  access, Stripe fee and negative-balance responsibility, zero platform
  application fee, and strict credential/webhook/ledger isolation from deposit,
  final-balance, and buyer-access rails. Hosted Sandbox UAT is the stopping
  gate; live-mode account creation, charges, payouts, refunds, disputes,
  tax/accounting promotion, and production enablement require separate evidence
  and approval.
- Sequence the next Connect and commercial-access rollout as four governed
  slices, in order. Slice 1: ship one owner-first Sandbox onboarding path from
  the landing page and staff workspace with the existing recent-auth, same-tab
  handoff, recovery-first return, and capability-status contracts. Keep the
  recommendation fixed to direct charges, full Stripe Dashboard access, Stripe
  fee collection, and Stripe negative-balance liability until a later reviewed
  commercial change says otherwise.
- Slice 2: separate `connected account health` from `payment routing active`.
  A connected Sandbox account may exist, refresh, and recover without changing
  buyer-access, deposit, or final-balance behavior. Add explicit manual
  activation, readiness, rollback, and audit-receipt states before any payment
  rail may route to a connected account.
- Slice 3: build one canonical commercial control plane for buyer-access
  receipts, discounts, referrals, post-purchase access, and recovery. Signed
  provider events and server-owned receipts remain the only authority for
  payment, entitlement, and email/reset outcomes; browser returns, URLs, and
  polling may not activate access or imply delivery.
- Slice 4: only after the control plane exists, expose tenant-authored tier,
  circumstance-discount, and referral configuration. Resolve the launch policy
  for one-time versus subscription access, upgrade/downgrade, refund/dispute
  handling, tax treatment, anti-abuse limits, and receipt template ownership
  before enabling any public commercial variation.

## P0 - Runtime-Gate Promotion

- Qualify authoritative operational staffing as one coordinated
  frontend/Functions/rules release. Keep `VITE_OPERATIONAL_STAFFING_ENABLED`
  and `OPERATIONAL_STAFFING_AUTHORITY_ENABLED` off until exact hosted admin
  profile/availability, admin-and-sales assignment/reconciliation, customer and
  cross-tenant denial, responsive accessibility, conflict, immutable receipt,
  and rollback checks pass. Promote only one explicitly approved tenant setting
  `operationalStaffingAuthorityEnabled=true`; never bulk-enable tenants or infer
  acknowledgement, attendance, payroll, payment, booking, BEO, or readiness.
- Complete authenticated hosted admin acceptance for Revenue Autopilot policy,
  customer controls, materialization, operations projection, and unread-reply
  acknowledgement. Then promote `REVENUE_AUTOPILOT_ENABLED=true` with
  `REVENUE_AUTOPILOT_SENDS_ENABLED=false` as a preparation-only release.
- Verify the exact Revenue Autopilot Resend webhook registration, signing
  secret, and delivery/bounce/complaint event set in the provider dashboard.
  Promote outbound sends only in a later release with controlled recipient
  evidence and an immediate stop/rollback path.
- Complete hosted sales/admin/reconciliation acceptance for Commercial Change
  simulation, approval, exact apply outcome, dependency reconciliation,
  Kitchen BEO freshness, and Decision Debt. Enable the global enforcement gate
  only with an explicitly named tenant and rollback record; never bulk-enable
  all tenants.
- Exact `v0.15.0` selected `NOTIFICATIONS_SMS_PROVIDER=pingram` with generation
  `pingram-2026-08-14-a`, but the owner-SMS rail remains operationally off and
  unaccepted. Do not run another provider attempt or enable automatic alerts
  while qualifying the one selected provider. Create `PINGRAM_API_KEY`,
  `PINGRAM_WEBHOOK_SECRET`, and `SMS_CONTACT_DIGEST_SECRET` only in Firebase
  Secret Manager; choose one exact approved US/CA/EU origin and a new lowercase
  `PINGRAM_CONFIGURATION_GENERATION`; verify the
  server-owned E.164 owner destination, explicit consent, sender/A2P state, and
  exact signed-webhook registration; then use the governed release path for one
  controlled owner-only UAT. Preserve request acceptance, signed
  delivery/failure, and recipient receipt as separate evidence. Require a
  signed delivered diagnostic before automatic alerts, verify that signed
  unsubscribe/STOP creates an indefinite v1 hold on all owner SMS sends across
  provider selection with no browser or callable clear path, and never
  automatically resend a claimed or indeterminate attempt.
- If Twilio remains the selected alternative, complete its Messaging Service
  US A2P registration and approval before deploying
  `NOTIFICATIONS_SMS_PROVIDER=twilio`. Do not configure both providers, fall
  back between them, or retry known carrier-rejected traffic. Neither path adds
  customer SMS or two-way messaging; signed inbound callbacks are quarantined
  and opt-out signals fail closed.

## P0 - Release and Security Controls

- Provision and independently review the production Google Cloud workload
  identity pool/provider, least-privilege Firebase deploy service account, and
  repository variables `FIREBASE_WORKLOAD_IDENTITY_PROVIDER`,
  `FIREBASE_DEPLOY_SERVICE_ACCOUNT`, and
  `FIREBASE_TENANT_OPERATOR_SERVICE_ACCOUNT`; then prove one governed deploy
  and one authorized tenant-gate rollback/readback before revoking the legacy
  `FIREBASE_TOKEN` secret. Repository source now accepts only ephemeral WIF
  credentials and never accepts a service-account key.
- Add an independently enforceable review/UAT control when repository ownership
  permits it. Preserve the current solo-operator allowlist until that stronger
  control exists; do not imply independent review in the meantime.
- Keep Vercel Git deployment disabled and both provider deployments behind the
  exact tagged-main, exact-CI, rollback-receipt, typed-confirmation workflows.
- Exercise the locked candidate provider clients after external prerequisites
  exist. Firebase CLI reads/mutation use the checksum-verified official 15.24.0
  binary; Firestore Rules readback uses exact `google-auth-library` 10.5.0 ADC;
  Vercel preview uses Build Output API v3 plus narrow REST calls. Acceptance is
  an exact Firebase safe-off receipt proving Hosting/Functions/rules, followed
  by an exact Vercel preview receipt proving immutable source and READY state;
  neither receipt may weaken the separate human/UAT gates.
- Rehearse an immutable staging/UAT pass and rejected invalid-evidence deploy
  without mutating production.
- Deploy the environment-only Functions configuration candidate through an
  exact coordinated backend release and verify runtime readback before March
  2027. Source no longer reads `functions.config()`; deployment remains open.

## P1 - Ambient Intelligence Interface Program

- Execute the 50-item [Ambient Intelligence work plan](docs/AMBIENT_INTELLIGENCE_WORK_PLAN.md)
  under its AIUI-00 Experience Constitution, beginning with Pilot Slice Alpha
  as the vertical proof before broader replacement. The production workflow
  source now enables the Ambient presentation and the protected CI lane enforces
  its zero-dead-click Alpha contract; do not describe either source binding as a
  deployment or acceptance receipt. Keep operational staffing and every
  independent server/provider authority gate default-off until its exact
  compatibility, role, interaction, accessibility, rollback, and approval gates
  pass; source completion, deployment, provider evidence, production-data
  acceptance, and human acceptance remain separate milestones.
- Qualify all 50 materially implemented AIUI items against their complete
  acceptance contracts. AIUI-50 still needs preview, authenticated staff and
  portal acceptance, first-minute/timing review, explicit promotion approval,
  and an exact rollback artifact. AIUI-48 permits later reviewed deletion only
  after parity, rollback, accepted-release, and promotion evidence all pass;
  until then the legacy stepper, Command Center, table disclosure, older search,
  and presentation flags remain intentional compatibility assets.
- The operational staffing live-test release now includes a protected,
  reversible one-tenant activation workflow. Dispatch it only after the exact
  Firebase all-scope deployment succeeds, retain its readback evidence, and do
  not interpret activation as provider delivery or staff acceptance.

## P1 - QuotePilot Steward

- Finish the read-only Difficult Question Desk shadow slice. The deploy-dormant
  fixed compiler, minimized typed context, zero-tool/storage/background provider
  contract, exact claim inventory, whole-output validation, hidden evaluation
  packet, pseudonymous audit, manual provider-outage path, current owner/admin
  and participant consent, 100-case pinned corpus, digest-only human-comparison
  receipts, and non-authoritative evidence thresholds now pass 30 focused cases.
  The authorized Quote Workspace now exposes the full read-only status matrix
  with its live state fixed to provider-unavailable, Steward handoff disabled,
  and only the ordinary manual-message path enabled. Next bind the contracts to
  a reviewed private runtime, run the consenting silent pilot, and complete 100
  actual human packet reviews before any model output is visible or staging is
  enabled. The model gets no write, messaging, payment, browsing, or resource-
  discovery authority.
- Keep every authoritative price, margin, staffing, production, catalog,
  revision, and entitlement value outside model authority. Steward may prepare,
  compare, explain, and stage an unsaved review; existing trusted paths alone
  may import, save, approve, publish, send, book, charge, or reconcile.
- Deliver the expanded Setup and Configuration Studio through existing guarded
  surfaces: menu import preview, versioned workflow-policy editors, and bounded
  non-secret Integration Ops/Stripe Connect readiness. Steward may prepare a
  typed diff or checklist, but it must never receive credentials, create a
  provider object, change routing, enable a gate, deploy, or apply settings.
- Add Margin Advisor only on complete current recorded-cost evidence from the
  existing deterministic margin/pricing/Commercial Change adapters. Missing
  costs remain unavailable; monitoring is deterministic; all scenarios stay in
  the existing review-before-draft and trusted-save path.
- Add Client Advisor with exact tenant/client binding, canonical accepted/booked
  activity, explicit preferences, and operator-reviewed memory facts. Require
  source, freshness, review, dispute, correction, expiry, deletion, and tenant-
  cleanup contracts; prohibit sensitive/protected inference, sentiment,
  vulnerability, perceived wealth, willingness-to-pay, approximate identity,
  hidden profiles, and cross-tenant learning.
- Design the paid add-on on a separate Stripe Billing rail. Do not reuse quote
  deposits, final balances, buyer access, Connect, their customer identities,
  products, keys, webhooks, collections, or state machines. MVP has a hard
  included allowance and no automatic overage.
- Treat provider/project/model/data controls, retention, DPA/privacy terms,
  Stripe test evidence, hosted role/tenant denial, production-data acceptance,
  human review, and promotion approval as separate gates. The Feature Matrix
  may record the private unexported foundation as security evidence, but do not
  present Steward in the User Manual or as a user capability until a
  discoverable role-safe surface and its executable state evidence ship
  together.

## P1 - Workspace Design Follow-ups

Design system and contracts are recorded in docs/DESIGN_SYSTEM.md (v0.5.0).

- Run the next acceptance and governance pass for the materially implemented
  QuotePilot Package Workspace in `Library -> Packages`: authenticated hosted
  admin verification, sales-role denial/availability verification, production-
  data review, rollback evidence, and moderated operator acceptance. Local
  390/768/1440 responsive, Axe, overflow, target-size, staged-selection,
  activation, dependency-review, dirty-switch, and revert proof is complete.
  Preserve per-person pricing, selected-at-$0 inclusion behavior, catalog
  revision fencing, managed-menu mutation separation, and missing-cost fail-
  closed behavior.
- Keep lifecycle persistence, event-type eligibility, minimums, staffing rules,
  allowances/substitutions, customer preview, and package comparison behind
  their separate Phase 5/6 approval gates. Do not let a menu-availability filter
  imply package eligibility or Quote Builder authority.
- Validate the materially implemented Ambient Library and first-class Event
  Templates surfaces on the immutable candidate with authenticated admin and
  sales roles, revision-conflict recovery, responsive layout, and rollback
  evidence before describing AIUI-20 as complete.
- Continue reducing the production-equivalent Ambient aggregate from the
  exact-candidate 3,928,552-byte CI-equivalent local measurement toward the
  standard clean-main budget. Exact-SHA CI run `33239048234` measured 3,928,479
  aggregate bytes and a 388,269-byte largest chunk; the local build measured a
  388,303-byte largest chunk. CI independently enforces detected compatibility
  and Ambient graph profiles; the temporary 3,928,552 Ambient aggregate ceiling
  is pinned to the larger literal measurement, retaining only the observed
  73-byte environment difference and no general growth headroom.
  Close the exception through optimization or an explicit reviewed clean-main
  recalibration before AIUI-48 retirement or Ambient production promotion.
- Add inline editing on the event workspace quote page: editable fields with
  simulate-pricing round trips and Commercial Change Authority integration for
  committed quotes; saving stays intentional and versioned.
- Continue the plain-language terminology pass on remaining expert labels
  (Decision Debt, Revenue Autopilot, attention projections).

## P1 - Data Operations

- Run tenant-scoped dry runs for portal projection and legacy customer identity/
  normalized-email claim binding. Review conflicts and counts before requesting
  separate production-apply authorization.
- Preserve customer IDs and private email claims as server-owned. Do not add a
  second identity, mutable customer-wide thread, or public customer account
  until recovery, revocation, multi-organization membership, and exact-token
  coexistence are specified.
- Complete hosted acceptance for the deployed callable-only structured
  change-request record and the source-built, write-once
  `linkChangeRequestResolutionVersion` follow-up that binds a recorded
  resolution to the later saved quote version. Keep the current freeform
  request-changes path and ordinary save authority intact.

## P1 - Customer-Flow Follow-through

- Complete hosted acceptance for CWF-07/08 Workflow aging and bounded run of
  show, CWF-09 Reporting intelligence, CWF-10 portal decision recovery, CWF-11
  rebooking/closeout, CWF-13 commercial measures, CWF-15 proposal completeness,
  and the customer-centered route shell. Their runtime is deployed; remaining
  work is authenticated/production-data/human proof, not reconstruction.
- Make CWF-17 the next intelligence slice. Add a new deterministic conclusion
  only where bounded canonical evidence exists; preserve explicit unavailable,
  partial, stale, and truncation states.
- Treat Flexibility authority as a separate CWF-18 prerequisite program. Do not
  infer it from Decision Debt, proposal completeness, or edit history.
- Keep CWF-19 and later intelligence dependent on the evidence contracts
  established by CWF-17/18.
- Continue the CWF-14 no-orphan-capability contract for every new user-relevant
  backend/data authority: discoverable role-safe UI, canonical state markers,
  executable state tests, Feature Matrix, User Manual, and capability manifest.

## P1 - Post-Competitive Pilot Program

The destination design (docs/POST_COMPETITIVE_DESIGN.md) has its source
capabilities grouped behind eight build gates: NOW home, Event Room ring +
decide stack + cascade receipts, guided-selling decide cards, CREATE intake
with band pricing, the client-request panel with the structured record
callable (plus best-effort structured change-request version linking; see
the `structured-change-request-record` capability contract), the Pilot
command bar, the fail-closed margin strip (plus Catalog Admin cost
entry, a below-target commercial advisor card, a margin range in the CREATE
intake band-pricing preview, and margin awareness in Scenario Compare and
the change-request/command-bar impact preview; see the
`catalog-cost-and-pricing-data-entry` capability contract), and the
decision-room ask-about affordance in the customer portal. PR #53 merged
the original seven-gate source to `main`, and `v0.6.0` deployed all seven
gates to both production providers (PROJECT_STATUS.md has the exact
CI/deployment run evidence). PR #57 then merged the post-`v0.6.0` follow-up
source to `main` at
`fb0aacc1c5c9f6c4ba8733f87c98c7b58e1611bd`, now tagged and deployed as
`v0.7.0` through governed Firebase and Vercel runs recorded in
`PROJECT_STATUS.md`. Those receipts do not establish authenticated hosted or
human acceptance. Remaining program work:

On 2026-08-11 the owner settled this program's open decisions in one round;
each bullet below carries its decided direction. The source completed by PR
#57 is merged and tagged; open production, provider, hosted-role, human-
acceptance, and explicitly deferred product work remains listed here.

- Run an authenticated staff acceptance pass across the exact production
  `v0.7.0` eight-gate combination. Public route reachability and provider
  acceptance do not substitute for that pass.
- Bundle-baseline recalibration: owner-approved (2026-08-11), contingent
  on it benefiting the app — execute from a clean `main` checkout per
  docs/PERFORMANCE_GUARDRAILS.md (regenerate baseline, delete the exception,
  keep the 5% allowance). Until then the
  zero-headroom exception continues to be re-measured per checkpoint.
- Proposal decision room (design §4.7): the default-off source/local slice now
  includes the calm content-first room, pricing section, recorded assumptions,
  tenant terms, contextual question acknowledgement, reversible staff-marked
  addition notes, local exact-token fallback parity, and three-width
  accessibility/overlap proof. Remaining work is a governed connected exact-
  token pass of the full staff mark → canonical projection → customer note →
  staff review path, authenticated hosted review at 390/768/1440px, and human
  acceptance. Preserve exact proposal-acceptance, pricing, payment, booking,
  conversation, and provider boundaries. Activity counsel remains deferred by
  owner decision (2026-08-11); revisit only with a separate privacy review.
- Model-assisted intake lane per docs/INTENT_INTAKE_ADR.md — decided: yes,
  with BOTH OpenAI and Anthropic as selectable providers. The pure core
  module is built and tested (src/lib/intentParserCore.cjs, contract
  model-assisted-intent-parse): config gate, sanitization, strict-JSON
  prompt, provider request builders, untrusted-output validation forcing
  low confidence. The CREATE integration is built: functions/ runtime twin,
  the parseIntentDraft callable (staff-only, same-org, stateless), the
  client boundary, and the Model assist UI with full read-state evidence
  (model-assisted-intent-parse rev 2). Remaining owner actions at enable
  time: create INTENT_PARSER_OPENAI_KEY / INTENT_PARSER_ANTHROPIC_KEY in
  Secret Manager, set INTENT_PARSER_ENABLED/PROVIDER on the function, and
  have the .runWith secrets binding added; keep the src/lib and functions/
  copies of intentParserCore.cjs in sync when either changes. Trusted
  `parseIntentDraft` callable behind `INTENT_PARSER_ENABLED=false` /
  provider `none` (defaults unchanged: off, deterministic lane remains the
  availability floor), Secret Manager-bound keys, full backend capability
  contract required. Owner action needed at enable time: create the
  Secret Manager secrets for the chosen provider key(s); the code ships
  dormant without them.
- Deterministic intake reader (owner-directed strongest-deterministic
  goal): staff counts, time ranges, party-of-N, reversed dates,
  confirm-only relative weekdays, "noon"/"midnight" clock words (bare and
  in a range), written-out guest counts ("eighty guests", "two hundred
  and fifty guests"), a multi-day-mention note (never the draft date),
  and labeled venue names ("Venue: X", "the venue is X") beyond the
  original "at X" pattern are all built. The queued family list from the
  prior checkpoint is now fully closed out.
- Memory defaults (design §4.10) — decided scope for the first slice:
  event-shape memory is built and tested (`src/lib/eventShapeMemory.js`,
  contract `event-shape-memory`): staffing/hours by exact event type and
  fixed guest band, median-aggregated from the tenant's own accepted/
  booked quotes, plus any rental in a strict majority of matches shown as
  a read-only mention. Wired into CREATE behind `VITE_PILOT_MEMORY_ENABLED`
  (default off, deliberately not production-bound — a separate future
  owner decision, same as the decision-room gate's initial posture);
  applying writes only staffing/hours to the draft. Venue/client/season
  memory stay later phases. Tenant-isolated, no cross-tenant learning,
  honest cold start below a minimum sample of 3.

## P1 - Performance and Accessibility

- The compatibility build now retains 21.7 KB of headroom under the unchanged
  temporary exception through tested function-to-arrow minification. Close the
  exception itself only through reviewed route/chunk graph optimization or a
  reviewed clean-main baseline recalibration; rerun both graph profiles,
  browser, and CWV gates before removing it.
- Continue mobile-density, wrapping, overflow, keyboard/focus, reduced-motion,
  and screen-reader acceptance across the routed workspace.
- Add intentional motion only where it improves state comprehension and remains
  safe under reduced motion.

## P2 - Integrations and Configurability

- Add server-authorized CRM adapters or a reviewed webhook bridge with tenant
  isolation, idempotency, audit, and provider acceptance.
- Add accounting export/synchronization for invoice and payment reconciliation;
  do not treat operational quote measures as accounting revenue.
- Specify two-way SMS only after A2P, opt-out, inbound webhook, thread authority,
  and retention policies close.
- Move additional pricing and escalation behavior into reviewed tenant policy,
  and add finer role controls for approvals and reporting visibility.
