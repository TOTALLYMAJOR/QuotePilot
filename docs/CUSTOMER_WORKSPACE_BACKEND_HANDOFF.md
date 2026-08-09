# Customer Workspace Backend Handoff

Status: approved backend contract for stable customer identity and Customer 360.
Current qualification belongs in `PROJECT_STATUS.md`; remaining rollout work
belongs in `DEV_TASKS.md`. This handoff does not authorize production
normalization/backfill, deployment, flag promotion, Stripe Connect work,
structured change requests, or persistent customer accounts.

Last updated: August 9, 2026

North star: [Customer-Centered Workspace Plan](CUSTOMER_CENTERED_WORKSPACE_PLAN.md)

## Objective

Give authenticated same-tenant staff a stable customer identity and a bounded
Customer 360 read model while preserving canonical quote, portal, payment,
booking, and conversation authority.

The sequence is identity first, derived workspace second:

```mermaid
flowchart LR
  TrustedQuote[Trusted quote create, duplicate, or edit] --> Resolve[Resolve same-tenant customer]
  Resolve --> Claim[Resolve private normalized-email claim]
  Claim --> Transaction[Atomic quote, version, portal-safe projection, customer projection, email claim]
  Transaction --> CustomerId[Server-owned customerId]
  CustomerId --> Directory[Paginated customer directory]
  CustomerId --> ScopedQuotes[Customer-scoped quote reads]
  ScopedQuotes --> DTO[Derived Customer 360 DTO]
  DTO --> Staff[Staff Customer 360]
```

V1 must not persist a `commercialSummary` cache. Quote create/edit is not the
only mutation path for payments, bookings, expiry, deletion, workflow, or
conversation activity, so that cache would become a second, drifting source of
commercial truth.

## Existing seams to preserve

- Canonical quotes live under
  `organizations/{organizationId}/quotes/{quoteId}` with immutable versions
  beneath each quote.
- Trusted quote create, duplicate, and edit already run server-side and write
  the canonical quote, version, and public portal projection together.
- The organization customer projection is server-owned and already reuses
  normalized-email matches without erasing richer imported optional fields.
  Current source gives new quote-projected customers generated opaque document
  IDs and serializes normalized-email ownership in a private server-only claim
  collection. Existing deterministic IDs remain a compatibility seam for
  legacy/imported records, not the identity format for a new quote-projected
  customer.
- Current source routes customer CSV create and rollback through admin-only
  callables so new imports receive stable IDs and server-owned `nameKey` and
  `emailKey` fields plus a trusted import-provenance email claim when an email
  is present. Previously deployed imported-only records still require a
  reviewed normalization/migration before the directory flag is enabled for a
  tenant; source availability is not migration evidence.
- `customerPortalQuotes` is the customer-safe, exact-token projection. List
  reads stay denied. Customer decisions, delivery activation, expiry/rotation,
  payment truth, and quote-scoped conversation retain their existing
  boundaries.
- A staff proposal preview cannot use the public portal loader because only a
  real customer portal visit may establish `viewed` evidence.

Confirm the current implementation locations before editing. Expected seams
include `functions/quoteCreation.js`, trusted callable exports in
`functions/index.js`, `src/lib/quoteStore.js`, `firestore.rules`, and their
focused unit/emulator tests.

## Slice A: stable customer identity

### Persisted contract

Add server-owned `customerId` to:

- every newly created canonical quote;
- every newly created immutable quote version;
- a duplicated quote and its first duplicate version;
- a legacy quote only through the guarded backfill.

Do not add `customerId` to `customerPortalQuotes` or other public customer-safe
projections in this slice.

The customer record keeps its opaque document ID and gains server-owned search
fields. A compatible example is:

```text
organizations/{organizationId}/customers/{customerId}
  customerId
  organizationId
  name
  email
  phone
  company
  normalizedEmail
  normalizedName
  searchPrefixes[]
  lastQuoteId
  lastQuoteNumber
  lastEventName
  lastEventDate
  createdAtISO
  updatedAtISO
```

Current source also owns a private uniqueness record:

```text
organizations/{organizationId}/customerEmailClaims/{normalizedEmailHash}
  schemaVersion
  organizationId
  customerId
  emailKey
  recordSource
  createdBySource
  importBatchId?  // required only for Import Studio provenance
  createdAtISO
  updatedAtISO
```

The claim document ID is a deterministic hash of the normalized email so a
trusted transaction has one serialization point. The customer ID referenced by
the claim remains opaque and generated for a new quote-projected customer. The
claim is not directory data: every browser principal, including same-tenant
admins, is denied direct reads and writes.

Exact field naming may follow existing normalization helpers, but the following
properties are required:

- values are normalized by trusted server code, never accepted as browser
  authority;
- search material contains no tenant-external lookup key;
- IDs are treated as opaque and URL-encoded by the frontend;
- blank quote fields do not erase richer imported customer data;
- a directory query is bounded and deterministic;
- one normalized email cannot be claimed by two customer identities, and a
  malformed/orphaned claim fails closed for trusted quote/import writes.

### Create and duplicate

Inside the existing trusted Firestore transaction:

1. Normalize the submitted contact identity.
2. Read the exact private email claim and bounded compatibility matches inside
   the transaction.
3. Resolve the claimed unique same-tenant customer or create a generated opaque
   customer plus its private claim.
4. Write that customer's opaque ID to the canonical quote and version.
5. Update the customer projection without replacing richer optional data with
   blanks.
6. Write the existing customer-safe portal projection without exposing the
   internal ID or claim.

The quote/version/customer writes are one atomic operation. A retry must remain
idempotent and must not create a second identity for the same normalized email.

### Edit

For a quote that already has `customerId`:

1. Load that exact same-tenant customer in the trusted transaction.
2. Retain the existing `customerId` on the quote and new version.
3. If contact fields changed, update that customer projection.
4. Before accepting a changed normalized email, check its private claim and
   bounded customer-record matches for another owner.
5. Reject a collision with a stable conflict error. Never silently bind the
   quote to the other customer.
6. Move the trusted claim to the new email only inside the successful quote,
   version, portal, and customer transaction.

For a legacy unbound quote, the edit path may resolve a unique same-tenant
identity only if the implementation makes that compatibility behavior explicit
and covers duplicate/missing cases. It must never guess between conflicts.

### Acceptance criteria

- Create and duplicate atomically persist one same-tenant `customerId` on the
  canonical quote and version.
- Edit retains that identity across contact changes.
- An email claim or customer-record collision with a different customer fails
  without partial writes.
- Cross-tenant IDs are rejected even if their contact fields match.
- The public portal projection remains customer-safe and omits `customerId` and
  all email-claim data.
- Existing delivery, proposal-acceptance, pricing, payment, and booking tests do
  not change meaning.

## Slice B: bounded customer directory

Add a staff-only query helper that supports a deterministic page size and an
opaque cursor. The UI contract should accept a normalized search term and must
not download the full tenant customer collection for client-side filtering.

A compatible response shape is:

```text
{
  customers: [{
    customerId,
    name,
    email,
    phone,
    company,
    lastQuoteId,
    lastQuoteNumber,
    lastEventName,
    lastEventDate,
    updatedAtISO
  }],
  nextCursor
}
```

Requirements:

- same-tenant authenticated staff only;
- stable ordering with a maximum 100-row page plus one pagination sentinel;
- Firestore rules deny unbounded list queries and any explicit limit above 101;
- cursor validation that cannot escape the organization;
- no email address in route params;
- a clear empty state and recoverable error state;
- any required composite index lands with source and emulator coverage.

The compatibility helper that looks up a customer by exact normalized email is
also explicitly bounded to one record. That helper is not uniqueness authority;
the private email claim owns serialization for trusted writes.

## Slice C: Customer 360 read model

Add a staff-only DTO/read helper that loads the exact customer and bounded quote
records scoped by `customerId`. Derive summaries in the reader from current
canonical data rather than persisting a rollup.

A compatible DTO is:

```text
{
  customer: { customerId, name, email, phone, company, updatedAtISO },
  quotes: [{
    quoteId, quoteNumber, status, eventName, eventDate,
    currentRevisionId, proposalState,
    bookingState, depositState, finalBalanceState,
    attention[], conversationSummary, recentActivity[]
  }],
  proposalVersions: [{
    id, quoteId, quoteNumber, versionNumber, reason, createdAtISO
  }],
  events: [],
  money: {
    deposit: { states and amounts from canonical provider truth },
    finalBalance: { states and amounts from canonical provider truth }
  },
  attention: [],
  nextSafeAction,
  recentActivity: [],
  quotePageInfo: { limit: 25, truncated },
  versionPageInfo: { perQuoteLimit: 10, truncatedQuoteIds[] }
}
```

DTO rules:

- Read at most 25 current quote summaries and the 10 most-recent immutable
  versions per displayed quote; return explicit quote/version truncation
  metadata rather than implying the history is complete.
- Proposal accepted, booked, deposit paid, final balance paid, and operational
  readiness remain separate fields.
- Money totals are operational payment-state summaries, not accounting revenue.
- Conversation summaries are server-owned per quote and expose only bounded
  count/latest-time/latest-actor metadata to this DTO. They link to the
  quote-scoped panel; message bodies and histories are not merged. A legacy
  quote without that summary reports `summaryAvailable=false`.
- BEO and Schedule entry points are references/actions, not new copies of event
  truth.
- Recent activity is bounded and derived from records the staff principal may
  already read.
- A next action is a presentation decision over existing safe actions; it does
  not create new write authority.

The staff proposal preview uses a read-only presentation adapter over canonical
quote/version data. It must not call the token portal loader, write portal
activity, rotate a token, or establish `viewed`.

### Acceptance criteria

- Same-tenant staff can load one customer's identity, quote/proposal history,
  events, payment states, attention, conversation links, and recent activity.
- Cross-tenant and unassigned principals cannot enumerate or load a customer.
- Pagination prevents an unbounded organization quote scan.
- Quote/version truncation and unavailable legacy conversation summaries are
  visible rather than presented as complete history.
- A missing/deleted customer and a customer with no quotes have distinct,
  recoverable states.
- Previewing a proposal as staff leaves portal `viewed` evidence unchanged.

## Slice D: legacy backfill source

Provide a dry-run-first operator script. It requires an explicit project and
organization and reports deterministic JSON/text totals for:

- already bound and valid;
- unique normalized-email match and would bind;
- missing customer match;
- duplicate customer matches;
- existing conflicting `customerId`;
- invalid/missing quote email;
- quote versions that would receive the binding.

Dry run is the default and performs no writes. Apply mode in this program is
restricted to Firebase emulators and requires an exact printed confirmation
token. Tests must prove that partial quote/version binding is rolled back on an
error.

Production apply is outside scope. It needs separate authorization, a reviewed
dry-run artifact, exact project/organization targeting, a production-specific
confirmation contract, and a release/audit record. Neither dry run nor apply
may create delivery, viewed, acceptance, booking, or payment evidence.

The current customer-ID binding tool does not create or repair
`customerEmailClaims`. Before enabling the directory for a tenant with legacy or
previously browser-imported customers, a separate dry-run normalization plan
must inventory missing, orphaned, and conflicting claims as well as missing
directory keys. No production apply for that work is authorized here.

## Slice E: legacy authority retirement

Update Firestore rules so canonical organization quote documents are
staff-readable only. Retire the legacy verified-email read branch for a
matching `customerEmailKey`.

Treat `customerEmailClaims` as a trusted transaction primitive: deny browser
get, list, create, update, and delete to unauthenticated, unassigned,
same-tenant staff/customer, and cross-tenant principals. Customer directory get
remains same-tenant staff-only; list additionally requires an explicit limit no
greater than 101.

Remove browser self-creation of `userRoles/{uid}` with role `customer`. Customer
membership/bootstrap remains server-authoritative. Do not replace that grant
with a generic signed-in customer read over canonical quotes.

Preserve:

- public exact-token gets of customer-safe `customerPortalQuotes`;
- denial of portal list queries;
- portal expiry, rotation, and current-issuance delivery requirements;
- server-authoritative acceptance and payment-webhook truth;
- quote-scoped conversation callables and their issuance checks.

Rules coverage must include unauthenticated users, exact valid/invalid portal
access, authenticated unassigned users, same-tenant staff by role, a legacy
`customer` role principal, and cross-tenant principals across canonical,
customer, and portal-safe records.

## Required verification

Run the repository's high-risk maintainer lane plus focused coverage for:

- quote create, duplicate, and edit transaction atomicity;
- immutable version propagation;
- edit collision and cross-tenant identity rejection;
- directory ordering, limit, search, and cursor behavior;
- Customer 360 derivation and bounded reads;
- rules allow/deny matrix and exact-token portal continuity;
- dry-run classification and emulator apply rollback;
- authoritative pricing because trusted quote writes change;
- staff preview not creating `viewed` evidence;
- environment, full unit, build, bundle, Playwright, docs governance, secrets,
  and diff checks required by the north-star plan.

Record source, local, emulator, hosted, provider, production, and human evidence
separately. A passing emulator backfill does not authorize a production apply.

Current qualification evidence and its proof boundary are recorded only in
`PROJECT_STATUS.md`; this handoff intentionally does not duplicate mutable test
counts or release status.

## Deferred programs

### Commercial Dependency Graph

The Customer 360 read model is a consumer of `CWF-15`, not its authority or
persistence layer. The accepted
`docs/COMMERCIAL_DEPENDENCY_GRAPH_ADR.md` now governs source-complete CWF-15A:
the frozen v1 registry, validation and deterministic traversal, browser/Node
canonical serialization and SHA-256 parity, and Kitchen BEO download-time input
provenance. The graph may consume server-authoritative pricing outputs but must
never recalculate them as a second pricing engine.

Before CWF-15C source work, accept a UI specification with a component
state/display matrix for Change Impact, Current/Stale/Review, authorization,
invalidation, reconciliation, receipt, error, and recovery states, plus
acceptance-criteria traceability to each role-safe control and Attention outcome.

CWF-15A computes and displays a versioned BEO dependency fingerprint, exact
source revision, browser-local generation time, and proof-boundary disclaimer,
but writes nothing and creates no retained freshness or receipt evidence. There
is no existing governed server BEO generation action. Before CWF-15B can create
an immutable artifact-generation receipt, it must separately introduce a
CWF-14-bound server generation/receipt action or move generation authority
server-side. That server authority must reload canonical same-tenant data,
recompute the declared inputs, and bind artifact type, quote/revision identity,
fingerprint schema, dependency fingerprint, actor, and server time itself;
browser-supplied digest, source revision, actor, or time can never become
receipt truth. CWF-15B may also add read-only impact simulation, but it adds no
independent authorization, invalidation, reconciliation, or publication
mutation. CWF-15C may then compare a trusted server receipt, surface change
blast radius and explainable Decision Debt, and introduce the UI-bound,
role-gated authorized invalidation, reconciliation, and publication workflow
plus atomic audit receipts through CWF-14. This handoff authorizes neither
CWF-15B nor CWF-15C source work or runtime authority.

### Structured change requests

The existing freeform `changes_requested` decision remains supported. A future
first-class request record must be callable-only, bind to the proposal revision
the customer saw, and link resolution to a separately saved authoritative quote
version. It must never accept prices or totals as customer authority. Specify
and approve this as its own program before implementation.

### Stripe Connect

Stripe Connect is a separate payments decision track, not a Customer 360
backend slice. It requires decisions for account type, merchant of record,
onboarding ownership, capabilities, webhook/event isolation, transfers, payouts,
refunds, disputes, tax/accounting obligations, and coexistence with both current
payment rails. No Connect collection, secret, callable, or UI is authorized by
this handoff.

### Persistent external customer accounts

Keep customer accounts in discovery until membership, recovery, verified-email
bootstrap, multi-organization access, authorization revocation, migration, and
coexistence with exact-token portal links are specified. The token decision
center remains the only customer-facing experience in current scope.
