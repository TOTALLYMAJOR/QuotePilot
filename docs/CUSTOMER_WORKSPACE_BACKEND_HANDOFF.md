# Customer Workspace Backend Handoff

Status: open backlog, not started. This is a slice plan for the
`quote-wizard-maintainer` Codex skill (see `AGENTS.md` and
`.codex/skills/quote-wizard-maintainer/SKILL.md`), written the same way
`docs/UX_BATCH_2_PLAN.md` and `docs/BEO_SLICE_PLAN.md` scope prior slices:
one slice at a time, smallest safe change set, own validation evidence.

Source: a 2026-08-08 read-only UI/UX audit of the staff and customer
surfaces. The audit's frontend recommendations (a Commercial Command Center
home view and a shared semantic status-chip system) are implemented in this
same change — see `CHANGELOG.md` and `docs/FEATURE_MATRIX.md` row 29. The
four slices below are the parts of that audit that need new domain records,
Firestore rules, or Cloud Functions before any further frontend work can
honestly claim to support them. Nothing in this document is implemented.
None of it should be described as current in any other doc until it ships.

## Ground rules for every slice

- Read `docs/DOC_SYSTEM.md`, `README.md`, `AGENTS.md`, and `PROJECT_STATUS.md`
  first, then load `.codex/skills/quote-wizard-maintainer/references/code-map.md`
  and `references/safe-change-checklist.md` before editing, per the skill's
  own Core Workflow.
- Treat `src/lib/quoteStore.js`, `functions/*`, `firestore.rules`, and
  `firestore.indexes.json` as high-risk exactly as `AGENTS.md` and
  `docs/ORCHESTRATION_BLUEPRINT.md` already specify.
- Every slice is a trusted-callable change: browser writes to any new
  collection or field introduced here must be denied by
  `firestore.rules` exactly like every existing commercial write path
  (`customers`, `customerPortalQuotes`, `proposalAcceptanceReceipts`,
  `privatePaymentDispatches`). No slice may add a rules-permitted direct
  client write to a commercial record.
- Preserve every protected invariant already enforced in this codebase:
  proposal accepted does not mean paid; paid does not mean booked; booked
  does not mean operationally ready; a customer-submitted request never
  directly mutates authoritative pricing or an accepted proposal revision;
  payment truth comes only from Stripe or a trusted backend re-read, never
  a browser return. See `docs/patterns/quotepilot-product-operating-model-discovery.md`
  for the full list.
- Run `bash .codex/skills/quote-wizard-maintainer/scripts/run-maintainer-checks.sh --high-risk`
  before calling any of these slices done — all four touch at least one
  high-risk file. Include the lane evidence in the PR per the Change Intent
  Contract in `CONTRIBUTING.md`.
- Update canonical docs per `docs/DOC_SYSTEM.md` triggers on every slice:
  `CHANGELOG.md` (code change, required), `PROJECT_STATUS.md` (new
  current-state bullet, matching its existing hedged "local source/emulator
  evidence only, not hosted-accepted" voice — do not claim more than the
  slice actually proves), `docs/FEATURE_MATRIX.md` (new row), and remove the
  slice from `DEV_TASKS.md`'s "Customer Workspace Backend (Codex handoff)"
  section once it ships.

---

## Slice 1 — Customer commercial rollup (Internal Customer 360 foundation)

**Change Intent Contract:** `change_type=core` · `risk_level=medium` ·
`tenant_impact=write` · `required_lanes=lane:quick, lane:core,
lane:firebase-auth-rules` · `doc_impact=CHANGELOG.md, PROJECT_STATUS.md,
docs/FEATURE_MATRIX.md, DEV_TASKS.md`

**Why this is first:** it is additive to an already-hardened write path
(FEATURE_MATRIX row 28's trusted customer projection), requires no new
customer-facing surface, and unblocks the highest-ranked frontend
enhancement from the audit (Internal Customer 360) with a single read
instead of a client-side scan of every quote.

**Files:** `functions/quoteCreation.js` (or wherever the existing
quote→customer projection transaction lives — confirm via
`references/code-map.md` and `grep -n "customers" functions/*.js`),
`firestore.rules` (`customers` collection — additive field only),
`src/lib/quoteStore.js` (`getCustomerRecordByEmail` is the only existing
UI-reachable read; add a sibling read or extend this one), unit/emulator
tests alongside `src/lib/__tests__/quoteCreation.server.test.js` and
`src/rules/__tests__/firestore.rules.test.js`.

**Changes:**
1. In the same server transaction that already projects a quote into its
   organization's `customers/{customerId}` record, maintain a
   `commercialSummary` field on that record:
   `{ openQuoteCount, activeEventCount, openChangeRequestCount,
   depositDueCents, finalBalanceDueCents, lastActivityAtISO,
   lastQuoteId, lastQuoteNumber }`. Recompute it from the authoritative
   quote data already in scope of that transaction — do not introduce a
   second source of truth; this field is a cache of facts the quote
   documents already own, not a new authority.
   `openChangeRequestCount` stays 0 until Slice 2 exists; wire it once
   that slice's records exist rather than guessing at its shape now.
2. Add a read helper (`getCustomerCommercialSummary` or extend
   `getCustomerRecordByEmail`) that same-tenant staff can call to read the
   rollup for one customer.
3. Do not change `customers` rules' write authority — this field is
   server-transaction-owned exactly like every other projected field on
   that record; browser writes to `commercialSummary` must be denied.

**Acceptance criteria:**
- Creating, editing, or duplicating a quote updates the owning customer's
  `commercialSummary` in the same atomic transaction; no partial-write
  window where the customer record and quote disagree.
- A same-organization admin/sales read succeeds; a cross-organization read
  is denied by rules exactly like every other tenant-scoped read.
- A direct browser write to `commercialSummary` is denied by rules.
- Existing customer-projection tests continue to pass unmodified except
  for the new field's presence.

**Tests:** extend `src/lib/__tests__/quoteCreation.server.test.js` and
`src/rules/__tests__/firestore.rules.test.js`; add a focused unit test for
the new read helper.

---

## Slice 2 — Change Request as a first-class record (Change Request Studio)

**Change Intent Contract:** `change_type=core` (also touches
`auth_rules`) · `risk_level=high` · `tenant_impact=write, rules` ·
`required_lanes=lane:quick, lane:core, lane:firebase-auth-rules,
lane:authoritative-pricing` · `doc_impact=CHANGELOG.md, PROJECT_STATUS.md,
docs/FEATURE_MATRIX.md, docs/USER_MANUAL.md, DEV_TASKS.md`

**Why this is the flagship:** the audit ranked this the single highest
product-value gap — today `portalDecision.changes_requested` is a message
plus a timestamp (`src/lib/quoteStore.js` around `updatePortalDecision`),
and the quote's own status does not even change (it stays `viewed`). This
slice is large; whoever picks it up should feel free to split it further
(intake + rules first, then triage, then resolution+versioning) rather
than landing it as one PR. Say so in the PR description if you do.

**Files:** new `functions/changeRequests.js` (or equivalent), `functions/index.js`
(new callable exports), `firestore.rules` (new `changeRequests` collection,
scoped like `proposalAcceptanceReceipts`: customer-portal create/append
only for their own quote's current valid issuance, staff read/write scoped
by organization + role, no client field-level pricing writes ever),
`firestore.indexes.json` if a composite query is needed, `src/lib/quoteStore.js`
or a new `src/lib/changeRequestClient.js` for the frontend contract,
`src/components/CustomerPortalView.jsx` (extend the existing freeform
"Request Changes" flow — do not remove it, add structure alongside it),
`src/components/SalesWorkflowModal.jsx` and/or a new staff surface (out of
scope for this backend slice; the frontend work is a separate follow-up
once this contract exists).

**Data shape (`organizations/{orgId}/quotes/{quoteId}/changeRequests/{requestId}`):**
```
{
  requestId, quoteId, organizationId,
  submittedAtISO, customerMessage,
  structuredAsks: [{ field: "guests"|"date"|"menu"|"addons"|"budget"|"other",
                      currentValue, requestedValue }],
  status: "new"|"in_review"|"revision_drafted"|"updated_proposal_sent"|"closed_resolved"|"closed_declined",
  ownerUid, ownerEmail,
  sourceQuoteRevisionId,       // the revision the customer was looking at
  resultingQuoteRevisionId,    // set only on closed_resolved
  resolutionNote,              // staff-only
  customerVisibleOutcomeMessage,
  triagedAtISO, resolvedAtISO
}
```

**Changes:**
1. `submitChangeRequest` callable: customer-portal-callable, revalidates
   the quote/portal/tenant/expiry/current-delivery-issuance exactly like
   `updatePortalDecision` does today before writing. Accepts the existing
   freeform message plus an optional `structuredAsks` array; the freeform
   path must keep working with an empty `structuredAsks` array so the
   existing portal textarea never breaks. Writes the record with
   `status: "new"` and stamps `sourceQuoteRevisionId` from the currently
   displayed revision.
2. `triageChangeRequest` callable: staff-callable, same-tenant + role
   check, sets `ownerUid`/`ownerEmail`/`status: "in_review"`.
3. `resolveChangeRequest` callable: staff-callable. Two outcomes only —
   (a) decline: sets `status: "closed_declined"` and a
   `customerVisibleOutcomeMessage`, no pricing touched; (b) resolve: takes
   an already-saved new quote version id (produced by the *existing*
   `updateQuoteDraft` re-pricing path — this callable does not compute
   pricing itself) and records it as `resultingQuoteRevisionId`, sets
   `status: "closed_resolved"`. **This callable must never accept a price,
   line item, or total from its caller** — it only links to a revision
   that authoritative pricing already produced. This is the exact
   invariant the audit calls out: "A customer request must never directly
   mutate authoritative pricing or an accepted proposal."
4. Firestore rules: customer create is allowed only for the exact current
   valid portal issuance of their own quote (mirror the `portalDecision`
   write guard); customer can never read another customer's request;
   customer can never write `status`, `ownerUid`, `resolutionNote`, or
   `resultingQuoteRevisionId`; staff read/write is organization-scoped and
   role-gated; direct client writes to any status transition are denied —
   only the callables above may transition status.
5. Keep the existing `portalDecision.changes_requested` +
   `changeRequestHandling` path working unmodified during this slice. Do
   not migrate or backfill it. A follow-up slice can decide whether to
   retire it once the new record type has hosted acceptance.

**Acceptance criteria:**
- A customer can submit a request with structured asks and/or a free-text
  note against their current valid proposal; an expired, declined, or
  otherwise inactive portal is denied exactly like `updatePortalDecision`
  already denies those states.
- Staff can triage (claim ownership) and resolve (link a revision or
  decline) only within their own organization and role.
- `resolveChangeRequest` rejects any payload containing pricing fields.
- Direct Firestore writes to `changeRequests` from a browser are denied
  for every field on every path (create, update, delete) except the exact
  customer-create case in the rule above.
- The existing freeform change-request flow (`portalDecision`) is
  unaffected — no existing test in
  `src/lib/__tests__/quoteStore*.test.js` or
  `src/rules/__tests__/firestore.rules.test.js` changes behavior.

**Tests:** new Functions unit tests, new Firestore rules tests (allow/deny
matrix matching the pattern in `src/rules/__tests__/firestore.rules.test.js`),
and — because this touches the authoritative pricing linkage — cover it in
`npm run test:e2e:firebase:authoritative` or an equivalent emulator script
modeled on `scripts/proposal-acceptance-emulator.mjs`.

---

## Slice 3 — Stripe Connect tenant merchant account (Money Center foundation)

**Change Intent Contract:** `change_type=core` · `risk_level=high` ·
`tenant_impact=write, rules` · `required_lanes=lane:quick, lane:core,
lane:firebase-auth-rules, lane:authoritative-pricing` ·
`doc_impact=CHANGELOG.md, PROJECT_STATUS.md, docs/FEATURE_MATRIX.md,
README.md (Stripe configuration section), DEV_TASKS.md`

**Before implementing:** confirm the Stripe Connect account type (Standard,
Express, or Custom) with the product owner. That choice changes the
onboarding-link parameters and the webhook event set materially, and this
document deliberately does not decide it. Everything below assumes
Express, the most common fit for a platform onboarding many small
merchants, but treat that as a default to confirm, not a decision already
made.

**Isolation requirement:** this is a *third*, fully independent Stripe
identity in this codebase. Confirm it stays isolated from both existing
rails exactly as the buyer-access rail is isolated from the quote-payment
rail today (README, "Public $1 Invoice-First Buyer Access"): its own
Secret Manager credentials, its own webhook endpoint and signing secret,
its own pinned API version. It must never share a client, key, or webhook
with `stripeWebhook` (quote deposit/final-balance) or
`buyerAccessStripeWebhook` (buyer onboarding).

**Files:** new `functions/stripeConnect.js`, `functions/index.js` (new
callable + webhook exports), `firestore.rules` (new
`organizations/{orgId}/merchantAccount` document — server-write-only,
same-org admin-read-only), Firebase Secret Manager bindings (new secret
names, documented in `README.md` and `docs/LAUNCH_RUNBOOK.md` following
the existing credential-isolation pattern), `src/lib/commerceOps.js` (new
client wrappers matching the existing `reconcileDepositCheckout`-style
authoritative-response validation), a new admin-only frontend surface (out
of scope for this backend slice).

**Data shape (`organizations/{orgId}/merchantAccount` — single doc):**
```
{
  stripeConnectAccountId,       // acct_..., set only from a Stripe API response
  onboardingState: "not_connected"|"onboarding_started"|"requirements_due"
                   |"under_review"|"charges_enabled"|"payouts_enabled"
                   |"restricted"|"action_required",
  chargesEnabled, payoutsEnabled,      // booleans, from Stripe only
  requirementsDue: [ ... ],            // verbatim from Stripe's account object
  lastSyncedAtISO, lastWebhookEventId, lastWebhookAtISO
}
```

**Changes:**
1. `createConnectAccountLink` callable: admin-only, same-tenant. Creates
   (or reuses) the Connect account, generates an onboarding Account Link,
   and returns only the redirect URL — nothing about the URL is persisted
   client-readable, mirroring how the existing deposit/final-balance flows
   never expose a Checkout Session URL to the browser except as the
   one-time redirect.
2. `getMerchantAccountStatus` callable: admin-only. Re-reads from Stripe
   (or serves the last webhook-synced snapshot) — never trusts a browser
   return as evidence of onboarding completion.
3. `stripeConnectWebhook` endpoint: signed, deduplicated, isolated
   credentials. Handles at minimum `account.updated`,
   `capability.updated`, `payout.paid`, `payout.failed`, and dispute
   events for connected-account charges. Every handler writes only
   provider-verified state to `merchantAccount`; no handler may be
   reachable from an unsigned request.
4. Firestore rules: `merchantAccount` is admin-read, server-write-only —
   identical authority shape to `privatePaymentDispatches` today, just
   readable (not just server-only) so the admin UI can render status.
5. Do **not** wire connected-account charges into the existing deposit or
   final-balance rails in this slice. This slice only stands up account
   status and payout truth. Routing actual customer payments through a
   connected account is a separate, later slice once this foundation has
   hosted acceptance.

**Acceptance criteria:**
- A browser return from Stripe's onboarding flow never by itself changes
  `onboardingState`; only a verified webhook or an explicit admin-invoked
  re-read does.
- `merchantAccount` is unreadable to non-admin roles and to other
  organizations; it is not writable by any browser request under any
  role.
- The new Stripe client/secret/webhook are unreachable from and
  unaffected by the existing quote-payment and buyer-access Stripe
  clients — verify with the same kind of isolation test the buyer-access
  slice used (`src/lib/__tests__/buyerAccessIntegration.server.test.js`
  is the closest existing precedent to model this on).
- Disputes and refunds are recorded as read-only provider facts only;
  this slice introduces no dispute-response or refund-initiation action
  (README already states these remain manual/unimplemented — do not
  change that claim in this slice).

**Tests:** Functions unit tests for each callable's authoritative-response
shape (mirror the validation style already in `src/lib/commerceOps.js`'s
`reconcileDepositCheckout`/`reconcileFinalBalanceCheckout`), a rules test
for `merchantAccount`, and an emulator isolation test proving the three
Stripe identities cannot cross-contaminate.

---

## Slice 4 — External customer account (persistent, multi-event) — discovery, not yet spec-ready

This is the audit's External Customer Account enhancement. It is
deliberately **not** broken into implementable steps here, because it
needs a decision this document should not make unilaterally: the
authentication model for a customer who should see multiple events over
time, and how the existing 30-day, single-quote portal token
(`customerPortalQuotes`, `PORTAL_TOKEN_VALIDITY_DAYS` in
`src/lib/quoteStore.js`) coexists with or migrates toward it.

Before scoping this as an implementable slice, resolve:
- Identity: most likely Firebase email-link sign-in scoped to a new
  `customerAccounts` (or similar) record, distinct from staff auth roles.
  Confirm whether a customer can belong to more than one organization
  (a caterer's customer is rarely also another tenant's customer, but the
  rule needs to say so explicitly either way).
- Migration: existing token links must keep working indefinitely
  (`README.md` already commits to this for the current portal). Decide
  whether a signed-in account is an alternate entry path into the same
  underlying `customerPortalQuotes` projections, or a new projection
  layer — the audit's recommendation is the former, to avoid a second
  source of truth.
- Scope of "multi-event": whether it lists quotes by matching customer
  email today, or waits for Slice 1's `customers` rollup to exist as the
  authoritative join.

Once those are decided, this section should be rewritten with the same
level of detail as Slices 1-3 before anyone implements it. Do not start
frontend work that assumes this slice exists until it does; the current
portal (token-scoped, single-quote) remains the only customer-facing
account surface in the current source.
