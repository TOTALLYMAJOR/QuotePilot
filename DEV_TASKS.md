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
- Keep production `NOTIFICATIONS_SMS_PROVIDER=none` while qualifying exactly
  one owner-SMS provider. For the Pingram path, create `PINGRAM_API_KEY`,
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

## P1 - Workspace Design Follow-ups

Design system and contracts are recorded in docs/DESIGN_SYSTEM.md (v0.5.0).

- Promote Catalog from the Operations menu into primary sidebar navigation,
  keeping the admin role gate.
- Add a first-class Templates surface for event-type presets, default terms,
  and reusable scope blocks (today editable only inside Catalog Admin).
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
CI/deployment run evidence). Everything built after that promotion — cost
entry, the advisor card, version linking, the two later margin-range
extensions, the catalog recovery-button bugfix, the ask-about affordance,
and the production binding of its `VITE_PILOT_DECISION_ROOM_ENABLED` gate —
remains unmerged and undeployed. Remaining program work:

On 2026-08-11 the owner settled this program's open decisions in one round;
each bullet below carries its decided direction. Owner-decided, not yet
merged: no PR yet — work continues accumulating on the pilot branch until
the owner asks for the merge.

- Merge and promote the post-`v0.6.0` pilot work above (owner will say
  when; no PR until then), then run an authenticated staff acceptance pass
  across all eight gates' production flag combination, including what
  shipped after `v0.6.0`. Public route reachability and provider
  acceptance do not substitute for that pass.
- Bundle-baseline recalibration: owner-approved (2026-08-11), contingent
  on it benefiting the app — execute after the pilot branch merges, from a
  clean `main` checkout per docs/PERFORMANCE_GUARDRAILS.md (regenerate
  baseline, delete the exception, keep the 5% allowance). Until then the
  zero-headroom exception continues to be re-measured per checkpoint.
- Proposal decision room (design §4.7) — decided directions:
  - Decidable options (decided: staged requests, no signature at the tap):
    a customer's option choice in the portal lands as a staged change
    request for staff approval, riding the existing change-request path —
    it is a request, not an authoritative change, so the
    `proposal-acceptance-v1` signature ceremony stays exactly where it is
    (final proposal acceptance) and is not repeated per option. The
    staff-side data model is built: `portalDecidable` marks on add-ons and
    rentals (strictly default false, explicit-true only) with a flag-gated
    Portal offer checkbox in Catalog Admin, covered by the
    `catalog-cost-and-pricing-data-entry` contract revision 3. The
    projection core is also built and dormant: the canonical snapshot
    carries `decidableOptions` via the exported pure
    `buildPortalDecidableOptions` (bounded, name-and-price only, excludes
    already-included items by id and name), empty at every call site
    until the org catalog is threaded in (`private-customer-authority`
    revision 2). The projection now flows end-to-end server-side: the
    authoritative pricing read returns the catalog collections, both
    trusted quote builders store decidableOptionsProjection on the quote
    (fresh at create/edit, carried forward re-bounded otherwise), and
    every snapshot moment re-projects it. The portal offer cards are
    built: an unlocked portal renders its projected options and a tap
    drafts the canonical "Please add X." sentence into the existing
    Request Changes message (append-only, deduplicated, length-capped) —
    the full marks → projection → offer → staged-request loop now exists.
    Remaining for this piece: mirror the field in src/lib/quoteStore.js's
    client `buildPortalSnapshot` (local-fallback sync path only; needs a
    quoteStore-owning contract bump), and hosted staff acceptance of the
    whole loop.
  - Per-block questions (conservative subset built; decided: block tags
    stay message-body text, not a structured field — revisit only if
    staff-side threading is actually wanted later). Terms and assumptions
    are built: the tenant-authored portalTermsText setting flows Catalog
    Admin -> settings -> quoteMeta -> snapshot -> a verbatim portal terms
    block (absent while empty), and the assumptions block restates
    recorded facts only; the options section is block-tagged too — six
    addressable blocks plus the header. Remaining for full nine-block
    parity: a dedicated investment breakdown block beyond the existing
    pricing section, and cover/experience-narrative treatments
    (presentational, no new data).
  - Activity counsel: deferred by owner decision (2026-08-11) — no portal
    view/interaction telemetry gets built for now; revisit post-pilot
    with an explicit privacy-posture review if wanted.
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
