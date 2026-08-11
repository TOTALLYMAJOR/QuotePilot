# Dev Tasks

Last updated: August 11, 2026

Only open work belongs here. Current operational truth lives in
[`PROJECT_STATUS.md`](PROJECT_STATUS.md); shipped history lives in
[`CHANGELOG.md`](CHANGELOG.md).

## P0 - Production Acceptance

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
- Keep Stripe Connect in architecture discovery until merchant-of-record,
  connected-account type, credential/webhook isolation, payouts, refunds,
  disputes, tax/accounting, and coexistence with both current Stripe rails are
  decided.

## P0 - Runtime-Gate Promotion

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
- Complete Twilio Messaging Service US A2P registration and approval. Only then
  add the reviewed non-secret runtime inventory, deploy
  `NOTIFICATIONS_SMS_PROVIDER=twilio`, and run one controlled destination-device
  acceptance. Do not retry known carrier-rejected traffic before approval.

## P0 - Release and Security Controls

- Migrate the Firebase production workflow from deprecated `FIREBASE_TOKEN`
  authentication to Application Default Credentials or GitHub workload identity
  federation without committing a service-account key.
- Add an independently enforceable review/UAT control when repository ownership
  permits it. Preserve the current solo-operator allowlist until that stronger
  control exists; do not imply independent review in the meantime.
- Keep Vercel Git deployment disabled and both provider deployments behind the
  exact tagged-main, exact-CI, rollback-receipt, typed-confirmation workflows.
- Replace provider CLI execution with a locked, checksum-verified tool image or
  narrow provider client when practical. Keep credentials confined to the final
  mutation step.
- Rehearse an immutable staging/UAT pass and rejected invalid-evidence deploy
  without mutating production.
- Migrate remaining `functions.config()` compatibility before March 2027.

## P1 - Data Operations

- Run tenant-scoped dry runs for portal projection and legacy customer identity/
  normalized-email claim binding. Review conflicts and counts before requesting
  separate production-apply authorization.
- Preserve customer IDs and private email claims as server-owned. Do not add a
  second identity, mutable customer-wide thread, or public customer account
  until recovery, revocation, multi-organization membership, and exact-token
  coexistence are specified.
- Complete hosted acceptance for the deployed callable-only structured
  change-request record, then specify any future link from its internal staging
  receipt to an authoritative resulting quote version. Keep the current
  freeform request-changes path and ordinary save authority intact.

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

The destination design (docs/POST_COMPETITIVE_DESIGN.md) has nine source
capabilities grouped behind seven build gates: NOW home, Event Room ring +
decide stack + cascade receipts, guided-selling decide cards, CREATE intake
with band pricing, the client-request panel with the structured record
callable (plus best-effort structured change-request version linking; see
the `structured-change-request-record` capability contract), the Pilot
command bar, and the fail-closed margin strip (plus Catalog Admin cost
entry, a below-target commercial advisor card, a margin range in the CREATE
intake band-pricing preview, and margin awareness in Scenario Compare and
the change-request/command-bar impact preview; see the
`catalog-cost-and-pricing-data-entry` capability contract). PR #53 merged
the original seven-gate source to `main`, and `v0.6.0` deployed all seven
gates to both production providers (PROJECT_STATUS.md has the exact
CI/deployment run evidence). Everything built after that promotion — cost
entry, the advisor card, version linking, the two later margin-range
extensions, and the catalog recovery-button bugfix — remains unmerged and
undeployed. Remaining program work:

- Merge and promote the post-`v0.6.0` pilot work above, then run an
  authenticated staff acceptance pass across all seven gates' production
  flag combination, including what shipped after `v0.6.0`. Public route
  reachability and provider acceptance do not substitute for that pass.
- Exit the temporary bundle exception through optimization or a reviewed
  clean-main baseline recalibration after production stabilization.
- Proposal decision room (design §4.7), three pieces, each blocked on a
  different decision — none is safe to freelance mid-implementation:
  - Staff-marked decidable options that land as "a governed change with
    receipt" on client acceptance: needs a decision on how a
    customer-initiated change interacts with the existing governed
    commercial-change authority (CWF-13) — immediate apply, or staff
    approval first, and whether it rides the same `proposal-acceptance-v1`
    signature ceremony or a separate one.
  - Interpreted, portal-visit-only activity counsel: needs new view/
    interaction telemetry infrastructure that doesn't exist today.
  - Per-block questions ("Ask about this" threaded to a block): the
    conversation rail itself (`QuoteConversationPanel.jsx`,
    `functions/portalConversation.js`, both callables in
    `functions/index.js`) is already callable-only and already accepts
    customer-authored text from `accessMode: "portal"`, so a block-tag
    field on the existing message shape is additive, not a new trust
    boundary — the cheapest of the three once unblocked. But §4.7's "any
    block" presupposes nine named portal blocks (cover, event summary,
    menu, services, options, investment, assumptions with true-up rules,
    deposit, terms, acceptance) that don't exist yet: `CustomerPortalView.jsx`
    today renders exactly two coarse, hand-bundled sections, and "terms"
    has no customer-facing content at all. Needs a portal information-
    architecture decision (how to decompose the page into addressable
    blocks, and what to put in the ones — investment, assumptions, terms —
    that don't exist in any form today) before the additive wiring is
    attachable to anything.
- Model-assisted intake lane per docs/INTENT_INTAKE_ADR.md: trusted
  `parseIntentDraft` callable behind `INTENT_PARSER_ENABLED=false` /
  provider `none`, Secret Manager-bound key, deterministic lane remains the
  availability floor; full backend capability contract required.
- Memory defaults (design §4.10): venue/client/season defaults with
  provenance and instant human override, tenant-isolated.

## P1 - Performance and Accessibility

- Close the temporary no-headroom bundle exception through route/chunk
  optimization or a reviewed clean-main baseline recalibration. Re-run bundle,
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
