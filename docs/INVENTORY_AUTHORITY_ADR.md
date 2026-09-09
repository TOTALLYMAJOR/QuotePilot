# Ingredient Inventory and Menu-Costing Authority

Last updated: 2026-09-09 07:13:08 CDT

Status: Accepted scope correction; corrected Phases 2 through 8 complete as default-off local source candidates
Date: September 8, 2026
Decision owner: QuotePilot maintainers

## Governing objective

QuotePilot inventory exists to turn recorded ingredient stock and purchase-cost
evidence into versioned menu recipes, trustworthy event ingredient demand,
projected food cost, stock shortages, allocations, and eventual
planned-versus-actual consumption evidence.

The governing progression is:

`ingredient -> opening stock and cost -> units and conversions -> versioned recipe -> menu-item quantity and cost -> event ingredient demand -> availability and shortage -> allocation -> consumption and waste -> operational consequence`

This decision supersedes the earlier equipment-first interpretation. Reusable
equipment reservations, rentals, chafers, tables, checkout/return scheduling,
turnaround windows, and damage/repair workflows are outside this program. The
already committed Phase 1 remains an honest historical checkpoint, but its
equipment-specific behavior does not govern active implementation and will not
be exposed as a parallel inventory authority.

## Scope reconciliation

The interrupted Phase 2 was implementing Library-to-equipment policies for
whole-unit reusable resources. Its downstream compiler, interval availability,
reservation, execution, and workspace drafts assumed resources returned after
an event window. That is incorrect for consumable ingredients.

The correction classifies the existing foundation as follows:

| Classification | Retained or changed behavior |
|---|---|
| KEEP | Organization scoping, explicit runtime and tenant gates, server-only consequential writes, App Check, stable request IDs, expected revisions, transaction retries, immutable receipts, canonical serialization/digests, immutable ledger evidence, replayable stock projections, and strict tenant/role rules. |
| MODIFY | Inventory identity becomes ingredient identity; quantities become decimal-safe fractional base-unit amounts; stock projections represent consumable on-hand quantity; cost becomes independent immutable evidence and a revisioned planning-cost projection; Library mappings become versioned recipes attached to existing menu items. |
| DEFER | Receiving, packs and conversions, event demand, consumable allocation, release, consumption, waste, actual-cost reconciliation, and deeper commercial/readiness integration advance only in their ordered slices. |
| REMOVE FROM ACTIVE SCOPE | Whole-unit constraints, reusable-resource buckets, turnaround, interval-overlap availability, local-day allocation fences, checkout/return/damage/repair/loss/retire commands, rental mappings, equipment attention UI, and equipment utilization insights. |

There is one active plan. Equipment-first requirements are historical context,
not a competing backlog.

## Authority boundaries

The existing catalog remains the authority for menu items, packages, and
selling prices. Recipes attach to stable existing menu-item IDs and never create
a second menu catalog. Library is the operator surface for recipe composition;
it does not own physical stock.

Inventory owns ingredient definitions, stock evidence, current stock
projections, purchase-cost observations, ingredient allocations, consumption,
and waste. It does not own selling price, quote revisions, customer acceptance,
payment, booking, BEO currentness, or overall event readiness.

Pricing remains governed by `docs/PRICING_CONSTITUTION.md`. Derived ingredient
cost is advisory internal cost evidence. It must not automatically overwrite a
catalog cost, selling price, quote total, deposit, or margin. Ingredient-only
cost is not complete event cost or profit.

Commercial quote revisions and recipe revisions remain immutable historical
inputs. Recalculation creates a new projection; it never rewrites the estimate
that supported an earlier quote or decision.

## Firestore model

All documents are organization scoped under `organizations/{orgId}`. The
active implementation uses bounded documents rather than tenant-wide replay on
normal reads:

| Collection | Authority |
|---|---|
| `inventoryLocations/{locationId}` | Stable stock locations; the first rollout may operate with one location. |
| `inventoryIngredients/{ingredientId}` | Ingredient identity, category, active state, base stock unit, revision, and schema kind. No editable quantity or derived availability. The separate collection prevents old equipment-shaped documents from being mistaken for ingredient authority. |
| `inventoryMovements/{movementId}` | Immutable ingredient stock evidence such as opening balance, later receiving, consumption, waste, and correction. |
| `inventoryStockStates/{ingredientId_locationId}` | Rebuildable current on-hand projection with ledger revision. |
| `inventoryCostEvidence/{evidenceId}` | Immutable recorded purchase-cost observation or explicit unknown-cost evidence. |
| `inventoryCostStates/{ingredientId}` | Revisioned organization planning-cost basis and its exact evidence provenance. |
| `inventoryAuthorityState/ingredient-v2` | Shared configuration fence and exact location/ingredient counts for contention-safe bounded setup. |
| `inventoryAuthorityReceipts/{requestId}` | Immutable idempotent command outcome; request substitution fails closed. |
| `inventoryRecipePolicies/{recipeRevisionId}` | Immutable recipe revision attached to a stable existing menu-item ID. |
| `inventoryRecipeHeads/{menuItemId}` | Current server-authoritative recipe pointer, observed catalog revision, menu identity snapshot, and bounded dependency set. |
| `inventoryPackConversionRevisions/{packConversionRevisionId}` | Immutable ingredient-specific purchase-pack conversion evidence. |
| `inventoryPackConversionHeads/{ingredientId_packUnitId}` | Current revision pointer for an operator-declared ingredient purchase pack. |
| `inventoryRecipeDependencyIndex/{ingredientId}` | Bounded reverse index of menu items whose current recipes use an ingredient. |
| `eventIngredientDependencyIndex/{menuItemId}` | Bounded server-only reverse index of recorded events whose current requirements use a menu item. |
| `inventoryMenuCostProjections/{menuItemId}` | Bounded current recipe quantity/cost projection with coverage and missing evidence. |
| `eventIngredientRequirements/{quoteId}/revisions/{requirementRevisionId}` | Immutable compiled ingredient demand and projected cost bound to exact inputs. |
| `eventIngredientRequirementHeads/{quoteId}` | Current numeric requirement revision and immutable requirement pointer used for optimistic concurrency. |
| `eventIngredientPlans/{quoteId}` | Current server-authoritative consumable allocation state; immutable snapshots live under `revisions/{planRevisionId}`. |
| `inventoryAllocationFences/{ingredientId_locationId}` | Shared, date-independent contention record for cumulative active ingredient commitments. |
| `eventIngredientProjections/{quoteId}` | Client-safe event demand, costing completeness, availability, shortage, and freshness. |
| `eventIngredientExecutions/{quoteId}` | Current physical-use settlement authority; immutable full-replacement evidence revisions live under `revisions/{executionRevisionId}`. |
| `eventIngredientExecutionProjections/{quoteId}` | Client-safe exact-event consumption, waste, quantity variance, planned-basis cost comparison, receipt, and freshness read model. |
| `inventoryIngredientProjections/{ingredientId}` | Client-safe current stock and cost axes for the operator workspace. |
| `inventoryWorkspaceProjections/current` | Bounded client-safe location/setup projection; it never contains the item ledger. |

Collection names preserve the organization-scoped inventory namespace, while
schema and command versions reject old equipment-shaped documents. No automatic
name-based migration or production data mutation is part of this source march.

Per-ingredient and per-menu projections avoid one tenant-global hot document.
The exact workspace document remains small because it carries locations and
setup revision only. Clients use exact-document listeners where they already
know an entity ID and bounded ordered `onSnapshot()` queries with explicit
limits for workspace lists. A listener is a read model, never allocation
authority.

Corrected Phase 2 deliberately caps location and ingredient definitions at 200
each until cursor-based inventory navigation is implemented. Creates advance
one shared configuration fence in the same transaction, so simultaneous record
201 attempts contend rather than leaving a projection the application cannot
read. This is an explicit source-candidate limit, not a claim that a mature
ingredient catalog should remain capped at 200.

## Ingredient quantity and unit contract

Ingredient quantities are fractional and decimal safe. Public command payloads
use strict canonical decimal strings. Runtime arithmetic converts those values
to a fixed integer scale and uses integer/BigInt intermediates; JavaScript
floating-point values, exponent notation, excess precision, whitespace, NaN,
and negative values fail closed.

Every ingredient declares one base stock unit and dimension. Supported
cross-unit conversions must be explicitly defined within the same dimension.
Ingredient-specific purchase packs require a declared conversion. QuotePilot
never infers pounds-to-cups, case contents, cooking loss, edible yield, or
density. A missing conversion remains missing evidence.

The base unit becomes immutable after the first stock movement. Historical
ingredients and locations may be deactivated, not deleted.

## Opening stock and recorded cost

An administrator can create an ingredient and independently:

1. record opening stock at a location with quantity, base unit, effective time,
   actor, and reason/source; and
2. record purchase-cost evidence with total exact minor-unit money, currency,
   basis quantity and unit, effective time, and provenance, or explicitly mark
   the cost unknown.

The two commands have separate request identities, expected revisions,
receipts, and projection states. Valid stock evidence commits even when cost is
missing or rejected. Valid cost evidence remains inspectable when stock is
missing or uncertain. The UI must never collapse these into one misleading
“inventory ready” status.

The first unambiguous observation may support a planning unit-cost ratio, such
as `$120 / 40 lb`, without prematurely rounding the unit price. Later purchase
observations are retained, but no FIFO, LIFO, weighted-average, replacement-cost,
or accounting valuation policy is inferred. Until an owner-declared policy is
adopted, the projection exposes its exact observation basis and completeness;
it does not claim inventory value or authoritative COGS.

`unknown` cost is distinct from zero cost.

Receiving is a separate physical-evidence command for goods already in hand.
It appends an immutable positive stock movement and an exact available-or-
unknown purchase-cost observation, then advances the materialized on-hand
projection. It never represents expected or unconfirmed supply. If no planning
cost state exists, the first known receipt may establish the narrow
first-observation basis. Once any cost state exists—including missing or
contradictory evidence—later receipt costs remain observations and cannot
silently replace that state. Consequently, an unrelated cost revision never
blocks a valid physical receipt whose cost observation is being retained only
as evidence.

## Versioned recipes and pure costing

A recipe revision belongs to one existing menu item and records:

- output yield and output unit, normally portions;
- ingredient references;
- exact ingredient quantities and recipe units for that yield;
- explicit as-purchased versus usable/edible-portion semantics;
- any declared usable-yield assumption;
- conversion provenance, validity state, revision, and digest.

Publishing creates an immutable revision and advances only the menu item’s
recipe head. Invalid references, unsupported conversions, missing yields, and
missing cost evidence remain explicit.

Recipe costing is a pure deterministic calculation. It accepts the exact recipe
revision, normalized ingredient quantities, and pinned cost observations. It
returns ingredient contributions, projected cost, coverage, missing evidence,
and digest. It does not read Firestore, mutate stock, or change selling prices.
Integer/rational arithmetic carries full precision through aggregation and
rounds money only at the declared output boundary.

The recipe head also maintains bounded reverse dependency references from each
ingredient to the recipe revisions that use it. Updating chicken cost therefore
queues only chicken-dependent menu projections; it does not scan or rebuild the
whole catalog. Recalculation is idempotent and source-revision fenced. A menu
projection is published only from an exact recipe revision and exact ingredient
cost revisions, and records `complete`, `partial`, `stale`, `unavailable`, or
`invalid` evidence with the contributing ingredient rows. Missing evidence may
produce a clearly labeled partial amount, but never a complete-cost claim.

`inventoryMenuCostProjections/{menuItemId}` is the preferred Library read model.
It carries total recipe ingredient cost, output yield, full-precision cost per
yield unit, coverage, issues, source revisions and digest. Library uses a
bounded realtime query for its summary and an exact-document `onSnapshot()`
listener for the actively edited menu item. Absence from a truncated summary
can therefore never masquerade as “no recipe.” The browser does not walk
recipes, ingredient evidence, or ledger history. Quote/event costing composes these already-calculated
menu projections with explicit portions, while the immutable event requirement
revision retains the exact recipe and cost observations used. A later current
cost change can refresh the current menu projection and identify affected
events; it cannot rewrite previously recorded quote/event cost evidence.

## Shared event demand with independent result rails

The event compiler consumes the exact organization, quote and commercial
revision, selected menu items, explicit portion basis or menu-choice counts,
recipe revisions, required-by time, and conversion assumptions. It emits a
deterministically sorted immutable ingredient-demand revision, aggregated by
ingredient while preserving each menu item’s contribution.

The browser submits only `requiredByBasis: quote_event_start`. The server derives
the exact required-by instant from the immutable quote event date and time plus
the organization’s declared IANA business timezone. A browser timezone, local
clock, or daylight-saving guess can never become canonical demand provenance.
The saved quote's selected menu IDs and snapshots are also checked exactly;
package inclusion is retained as provenance on that single selection and is
never compiled as an additional menu line.

It must respect explicit portions and established package/menu semantics. It
must not assume every dish serves every guest or double-count a package
inclusion that is also represented as an explicit selection. An unavailable
portion basis blocks demand compilation rather than inviting a guess.

That quantity-only demand revision is the shared dependency for two sibling
rails:

```text
immutable ingredient demand
        ├── recipe/menu cost projection
        └── stock availability and allocation projection
```

Costing does not depend on stock availability. A valid `$80` projected food
cost remains valid when chicken is short. Availability does not depend on cost
coverage. A valid five-pound shortage remains visible when chicken cost is
unknown. Invalid demand provenance may block both, but one rail’s operational
failure does not downgrade the other rail’s valid evidence.

## Consumable availability and allocation

Ingredients are consumed and do not automatically return after an event.
Availability is cumulative rather than interval based:

`available to allocate = usable on hand - active allocations`

Receiving increases usable on-hand only after an operator records that the
goods were physically received; an expected or unconfirmed purchase is not
stock. The initial rollout does not claim freshness, suitability, lot
traceability, or expiry evidence.

Preview is pure and informational. Allocation commands re-read authoritative
stock state, all active allocation totals, demand revision, and shared
item/location fence inside one Firestore transaction. Competing events—even on
different days—touch the same fence and cannot overallocate the same physical
stock. Partial allocation records the maximum valid amount and explicit unmet
demand. Each atomic command is capped at 100 ingredients, writes one exact
item/location fence per ingredient, and never sums unlike units into a total.
Only accepted or booked quotes can allocate. The command revalidates the active
immutable quote revision, current recipe heads, exact requirement digest, and
current plan revision in the same transaction. Draft and sent quotes retain
read-only demand/cost/shortage intelligence without consuming capacity.

A partial plan retains its valid hold. After receiving, an administrator may
retry allocation with the expected plan revision to fill only the remaining
shortage; the operator does not have to release already secured stock. Each
change writes the current plan, one immutable plan-revision snapshot, affected
fences, ingredient projections, the exact event projection, and an idempotent
receipt atomically.

Allocation changes commitment, not physical on-hand stock. Release changes the
allocation only. Consumption changes physical stock and settles the related
allocation without subtracting the same quantity twice. Every command is
expected-revision fenced and retry safe.

Event usage is recorded as one bounded full-total statement covering every
ingredient in the pinned plan. Initial settlement atomically removes the
event's whole active hold and decrements on-hand by `consumed + waste`. Usage
above the event's own hold is accepted only when the resulting on-hand balance
still covers every other active commitment. The plan becomes `settled`, not
`released`, and retains the exact settlement execution revision. A correction
submits full replacement totals; the server derives the physical delta,
restores or depletes only that delta, and never recreates the settled hold.
Consumption-to-waste reclassification with an unchanged total creates an
immutable execution revision without inventing a zero-quantity movement.

Each closeout transaction is capped at 75 ingredients so movement, stock,
ingredient provenance, fence, projection, plan, execution, and receipt writes
remain below Firestore's 500-write ceiling. Current stock is still a
materialized projection, and opening, receiving, depletion, and restoration
movements replay to that projection exactly.

## Realtime projections and evidence state

Canonical inventory, recipe, allocation, and receipt writes are server only.
Clients subscribe only to bounded safe projections. Listeners use
`includeMetadataChanges: true` and preserve these distinctions:

- server-confirmed current;
- pending receipt/readback;
- cached;
- stale;
- unavailable/not yet projected;
- uncertain command outcome; and
- rejected command with an explicit recovery path.

`fromCache` and `hasPendingWrites` never render as confirmed current. A listener
failure may retain the last confirmed projection as stale but cannot silently
promote it. Organization, principal, role, or feature-gate changes unsubscribe
and invalidate late callbacks.

The event Control Room listens to two exact documents: the commercial event
ingredient projection supplies the pinned plan before closeout, and the
separate execution projection confirms recorded usage. Separating them keeps
physical actuals from manufacturing current commercial cost or demand
freshness. A callable receipt is not shown as committed until the execution
listener observes the same receipt, execution revision, immutable revision ID,
and movement identities.

Phase 4's saved event projection is deliberately labeled `as_recorded`, not
equivalent to a claim that every upstream source is still current. Phase 6
adds independent demand, cost, availability, and allocation freshness. Exact
quote, recipe, and menu-cost source transitions stale only bounded dependent
event projections, and delayed trigger delivery no-ops when the authoritative
source has already advanced. Immutable requirements and prior estimates are
never rewritten. A fresh read-only preview remains required to evaluate a
proposed scenario, and recording fails if any pinned source changes before the
transaction commits.

When changed demand leaves an active hold, the hold remains effective and is
labeled stale rather than silently released. Recording the new requirement
preserves that allocation evidence. Only an explicit administrator reconcile
may transactionally release the old quantities and allocate the new demand
through the same ingredient/location fences. The transaction writes immutable
intermediate release and final allocation plan revisions plus one idempotent
receipt. Release remains available from stale evidence; top-up does not.

Commercial Change consumes the saved exact event projection and a server
preview for the current draft fingerprint. A pure comparator returns separate
recipe-cost and per-ingredient/base-unit availability deltas with exact source
provenance. This is read-only advisory consequence intelligence and is kept
outside the Commercial Dependency Graph's authorization/apply dependents, so
missing or stale ingredient evidence cannot silently block a valid commercial
amendment. The browser never reconstructs these consequences from movements,
receipts, recipes, or raw cost evidence.

The first operator surface is `/app/inventory` under Operations. It lets an
authorized administrator create an ingredient, record opening stock,
independently record cost evidence, and publish explicit purchase-pack
conversions. Library now receives versioned recipe editing within its existing
menu-item workspace. Sales receive only explicitly approved
same-tenant projections and previews; customers and cross-tenant actors receive
no inventory access.

Every runtime surface and callable remains independently default off behind:

- `INVENTORY_AUTHORITY_ENABLED=true` in Functions;
- `organizations/{orgId}/settings/config.inventoryAuthorityEnabled=true`; and
- `VITE_INVENTORY_AUTHORITY_ENABLED=true` in the browser.

## Corrected delivery sequence

Each completed slice receives its own local commit. Nothing is pushed until all
corrected slices and final qualification complete.

1. **Historical Phase 1 — authority substrate.** Preserve the organization,
   transaction, ledger, receipt, revision, and rule foundations; supersede its
   equipment semantics.
2. **Corrected Phase 2 — ingredient stock and cost vertical.** Ingredient setup,
   fractional base-unit quantities, opening balance, independent recorded cost
   evidence, materialized projections, realtime operator UI, and rules.
3. **Phase 3 — units, packs, recipes, and menu costing.** Explicit conversions,
   versioned recipes in Library, pure costing, reverse dependencies, and
   per-menu cost projections.
4. **Phase 4 — event demand, projected food cost, and shortages.** Immutable
   menu/event demand compiler plus independent cost and stock-availability
   projections.
5. **Phase 5 — receiving and consumable allocation.** Receiving, shared
   contention fences, partial allocation, release, idempotency, and concurrency
   acceptance.
6. **Phase 6 — change reconciliation and Commercial Change intelligence.** Pin
   historical estimates; distinguish recipe/cost-basis drift from operator
   commercial changes; add separate recipe-cost and ingredient-availability
   consequences to Commercial Change without changing price or turning
   advisory evidence into a universal publish blocker.
7. **Phase 7 — consumption and actual variance.** Consumption, waste,
   corrections, allocation settlement, and planned-versus-actual quantity and
   cost reconciliation.
8. **Phase 8 — deeper realtime product integration.** Bounded Library, Quote
   Edit, Preflight, and Operations composition over exact event projections,
   with deterministic per-unit shortage and consumption intelligence. Broader
   reporting requires its own bounded materialized authority.

Corrected Phases 2 through 8 are now complete as default-off local source
candidates. Phase 3 adds same-dimension conversions, immutable declared
purchase-pack revisions, versioned recipes attached to exact existing menu
items, pure exact costing, bounded reverse dependencies, and materialized menu
cost projections. Library uses bounded summary listeners and an exact active
menu-item listener instead of replaying ingredient evidence; cached or pending snapshots never authorize recipe
publication. Recorded menu cost remains independent of physical stock, never
overwrites catalog selling or manual cost fields, and carries explicit partial,
unavailable, invalid, stale, and current evidence. Phase 4 compiles explicit
saved menu-output quantities against exact current recipe revisions, preserves
per-menu contribution while aggregating shared ingredients, and publishes one
immutable requirement plus an exact event projection. The projection keeps
demand, projected cost, and consumable availability as independent result
states and is read with an exact metadata-aware `onSnapshot()` subscription.
Preview is read-only; only an administrator may record a requirement. Phase 5
adds immutable receiving evidence and accepted/booked-only cumulative
allocation through deterministic item/location fences. Partial holds can top
up without release; every allocation revision is preserved, and exact event and
ingredient projections update atomically. Phase 6 adds bounded reverse event
dependencies, source-fenced invalidation, independent freshness axes, explicit
retained-hold reconciliation, and non-governing Commercial Change ingredient-
cost and availability intelligence. Phase 7 records full replacement
consumption and waste totals against the pinned immutable plan, settles the
active hold without double subtraction, preserves corrections as immutable
evidence, and publishes a separate exact realtime execution projection in the
event Control Room. It provides quantity variance and a clearly labeled
saved-planning-basis cost comparison only when every pinned ingredient cost is
complete. Phase 8 composes those same exact plan and execution reads into Event
Preflight and only the currently selected Operations event. Physical allocation,
menu-cost completeness, and execution remain separate facts: cost gaps never
invalidate a current hold, and a saved availability preview never passes as a
reservation. The Calendar does not create one listener per row.

## Acceptance anchor

The first end-to-end fixture remains:

- Chicken: `40 lb`, recorded total cost `$120`.
- Pasta: `30 lb`, recorded total cost `$60`.
- Recipe yield: `10 portions`, requiring `2 lb` chicken and `1 lb` pasta.
- Event selection: `100 portions`.

The deterministic result is `20 lb` chicken, `10 lb` pasta, `$60` chicken cost,
`$20` pasta cost, and `$80` projected ingredient cost. If another event has an
active `25 lb` chicken allocation, physical on-hand remains `40 lb`, available
to allocate is `15 lb`, and the new event shortage is `5 lb`, regardless of
whether the events occur on different days.

Later slices must also prove shared-ingredient aggregation, portion-change
deltas, preserved historical estimates, recipe invalidation without history
rewrite, explicit missing cost/conversion, concurrent no-overallocation,
idempotent receive/allocate/consume, release without stock mutation,
consumption without double subtraction, tenant and role denials, and distinct
pending/committed/uncertain UI evidence. Phase 7 proves those consumption and
correction cases with a 50-portion closeout after the owner fixture.

## Evidence boundary and unresolved policy

Unit, emulator, rules, build, governance, and browser checks establish local
source evidence only. A branch push establishes publication only. PR review,
merge, deployment, feature activation, migration, production-data correctness,
provider evidence, assistive-technology acceptance, and human acceptance remain
separate events.

Corrected Phase 2's demo-only emulator lane exercises the real callable and
Firestore transaction path. It proves that competing configuration writes
preserve the shared fence and projection, identical opening requests produce
one movement and receipt, substituted request input fails closed, competing
revision-zero openings have one winner, and cost evidence does not mutate stock.
Phase 4 extends that lane through the owner fixture: the callable derives the
event instant in the tenant timezone, previews `20 lb` chicken, `10 lb` pasta,
and `$80` without writing, then concurrent identical recording requests create
one immutable requirement and one exact projection. Phase 5 proves confirmed
receiving idempotency, later-cost retention, `25 lb` committed on another date
plus `20 lb` demand producing a `15 lb` hold and `5 lb` shortage, true
simultaneous shared-fence contention without over-allocation, safe shortage
top-up after receiving, and release without changing on-hand. It does not prove
consumption, valuation, deployment, or production behavior.

Phase 6 extends the real emulator path through commercial-revision staleness,
preserved active allocation evidence, recording a revised requirement,
idempotent release-and-reallocate reconciliation, historical estimate
preservation, and cost-only reverse-index invalidation. Focused pure/runtime,
client, hook, and component tests separately prove delayed-source no-ops,
strict revision substitution rejection, independent freshness, stale-hold
release without top-up, and non-governing Commercial Change consequences.

Phase 7 extends the same real callable transaction path through allocation,
physical consumption and waste, settlement, retry replay, a downward
correction that restores only the delta, a zero-net classification correction
that creates no movement, exact execution projection readback, and preserved
unknown actual COGS. Pure reducer tests separately prove other-event hold
protection, invalid transitions, stale revisions, bounded row counts, exact
ledger replay, and rational planned-basis comparison.

Phase 8 adds no canonical writes. Focused presentation and component tests prove
revision-bound physical, cost, and execution classification; fail-closed cached,
pending, stale, malformed, and mismatched evidence; no cross-unit quantity
aggregation; selected-event-only Operations subscription; and the rule that
menu-cost completeness cannot manufacture or invalidate a stock commitment.
Tenant-wide shortage-frequency, inbound-supply, freshness/suitability, and
actual-cost reporting remain unavailable until bounded materialized authorities
exist. In particular, QuotePilot does not infer future supply from an event date
or an unconfirmed purchase.

The genuinely unresolved product/accounting decision is the valuation policy
for multiple cost observations and actual consumption. Corrected Phase 2
records exact evidence and supports the unambiguous first observation without
inventing that policy. The decision is required before the system claims
inventory valuation, authoritative COGS, or actual cost variance.
