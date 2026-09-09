# Inventory Operating-Model Authority

Last updated: 2026-09-08 21:49:12 CDT

Status: Accepted for default-off source implementation
Date: September 8, 2026
Decision owner: QuotePilot maintainers

## Context

QuotePilot currently turns catering choices into commercial truth, but it does
not own physical-stock, allocation, or execution truth. Treating a mutable
quantity field as inventory would lose the reason stock changed, make
concurrent event commitments unsafe, and let screens infer readiness from
catalog data that owns no physical evidence.

## Decision

Add an organization-scoped Inventory Authority with this dependency chain:

`commercial configuration -> physical requirement -> availability -> commitment -> execution -> evidence -> system consequence`

Library remains the commercial composition surface. It may publish versioned
rules explaining which physical resources an Offer, Package, rental, menu item,
or service style implies, but it does not own stock or reservations. Inventory
is an Operations authority. Event and quote experiences consume its bounded
projection without becoming inventory writers or claiming that inventory alone
establishes event readiness.

Every runtime surface and callable remains independently default-off behind:

- `INVENTORY_AUTHORITY_ENABLED=true` in the Functions runtime;
- `organizations/{orgId}/settings/config.inventoryAuthorityEnabled=true`; and
- `VITE_INVENTORY_AUTHORITY_ENABLED=true` in the browser.

The server flag does not inherit the tenant-workflow/RagnaKoK override. An
explicit environment value is required so enabling another operational program
cannot activate inventory accidentally.

## Physical truth

`organizations/{orgId}/inventoryItems/{itemId}` stores stable resource
definition only: display name, category, unit, active state, turnaround minutes,
and revision. It never stores canonical owned, reserved, or available totals.
An item's unit is immutable after its first movement.

`organizations/{orgId}/inventoryMovements/{movementId}` is the immutable
physical evidence ledger. A movement carries a positive whole-unit quantity,
actor and server time, occurrence time, request identity, expected stock
revisions, and explicit `from` and `to` endpoints. Current buckets are:

- `usable`;
- `checked_out`; and
- `damaged`.

`lost` and `retired` are terminal destinations. Supported movement kinds are
`opening_balance`, `adjustment`, `transfer`, `checkout`, `return`, `damage`,
`repair`, `loss`, and `retire`. `adjustment` requires a declared reason;
`transfer` changes location without changing organization ownership. Missing
equipment is an unresolved execution exception, not a movement, until an
operator records a return or confirms a loss.

`inventoryStockStates/{stockStateId}` is a transactionally maintained read
projection. It contains bucket balances, ledger revision, and last movement
identity for one item and location. It is not independent truth: replaying the
immutable ledger must reproduce it exactly.

## Requirement and availability truth

Published `inventoryRequirementPolicies/{policyRevisionId}` documents are
immutable bounded rule sets. Rules reference stable catalog IDs, never display
names, and use only fixed, ceiling-rounded per-guest, or per-selected-unit
formulas. Compilation binds its result to the exact quote ID, immutable quote
revision, event window, and policy revision. Existing compiled requirements do
not change when a later policy publishes.

Availability calculation is a pure deterministic contract. It reduces physical
state, requirements, overlapping allocations, and item turnaround into
per-item and per-unit-group required, usable, committed, available, and shortage
values. Unlike units are never added into a false grand total. The pure module
performs no Firestore read or write and is shared by tests, trusted callables,
projections, and simulations.

## Commitment and Firestore coordination

`eventInventoryPlans/{quoteId}` is the mutable server-authoritative inventory
aggregate for an event. It binds source quote revision, event window,
requirement revision, allocation revision, requirement lines, allocations,
shortages, execution state, and freshness. Its state vocabulary is
`not_evaluated`, `available`, `partially_reserved`, `reserved`, `shortage`,
`stale`, and `released`; execution remains a separate axis.

Accepted and booked work may hold capacity. Draft and sent quotes receive
read-only evaluation only. A later commercial revision preserves the previous
hold, marks the plan stale, and requires an explicit administrator reconcile.
It never silently releases or reallocates accepted operational capacity.

Reservations use a single Firestore transaction over deterministic
item/location/tenant-local-day `inventoryAllocationFences`. Exact intervals are
retained inside each fence, and item turnaround extends the effective end. Two
overlapping requests therefore read and write at least one shared document,
letting Firestore contention retry protect the invariant. Insufficient capacity
reserves the maximum available amount and records the rest as shortage.

Every command carries an expected revision and stable request ID. Exact replay
returns the retained immutable receipt; reuse with different command or actor
evidence fails. The target plan, fences, receipt, and target projection change
atomically. Other affected projections are refreshed idempotently and may never
regress to an older source revision.

The public command envelope is versioned and exact:

`{ schemaVersion, organizationId, requestId, command: { kind, ...payload } }`.

Unknown fields fail closed. One organization-scoped receipt identity is shared
across configuration and movement commands, so the same request ID cannot be
substituted across command kinds. The first movement atomically writes an
immutable `firstMovementId` marker on the item document; item definition edits
read that same document, making Firestore transaction retry the fence that
prevents a unit change from racing the first physical movement.

## Read and security boundary

Canonical inventory documents are Admin SDK only. Browser clients cannot read
or write items, movements, stock states, policies, requirements, plans, fences,
receipts, or insights directly. Same-tenant admins and sales may `get` one exact
`eventInventoryProjections/{quoteId}` document; lists and every browser write
are denied. Bounded workspace lists come from the trusted callable.

Admins own configuration, reservation, reconciliation, release, and movement
commands. Sales may read and preview. Customers have no inventory access.
Cached or pending Firestore listener state remains visible and cannot be
presented as server-confirmed current evidence.

## Consequences and non-goals

The model can distinguish owned, usable, out, damaged, reserved, returned,
lost, and retired quantities without treating any of them as synonyms. Quote
Edit and Event Preflight may show read-only physical consequences and the next
authorized action. Inventory contributes one readiness fact; it does not own
overall readiness, price, BEO currentness, customer acceptance, or booking.

This program does not add serialized assets, fractional quantities, vendor
inventory, purchasing, external-rental cost capture, automated acquisition
advice, or name-based catalog migration. Initial state is established through
explicit items, locations, mappings, and opening-balance movements.

## Evidence boundary

Unit, emulator, rules, build, and browser checks establish local source
evidence only. A branch push establishes publication only. PR review, merge,
deployment, tenant activation, production-data correctness, provider evidence,
assistive-technology acceptance, and human acceptance remain separate events.
