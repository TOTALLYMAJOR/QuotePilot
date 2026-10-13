# QuotePilot Delivery Planning Program

Last updated: 2026-09-14 02:59:23 CDT

## Purpose and status

Delivery Planning is the governed connective layer between a configured
catering service and the work needed to fulfill it:

```text
Event facts + Offer + Delivery Blueprint
                 ↓
          Delivery Proposal
     ┌───────────┼───────────┐
 Required work  Production   Purchasing
     ↓              ↓            ↓
Staffing review  Inventory demand and shortages
```

The current source slice supplies a safe-off, session-only staffed-buffet
compiler, a Proposal Composer surface, and an administrator-facing **Library →
Delivery** activation surface. It activates only when the tenant sets
`deliveryPlanningEnabled: true`, the selected Offer references an exact
published Delivery Blueprint revision, and that Blueprint references exact
published tenant quantity-policy and purchasing-pack revisions. No default
Blueprint, portion ratio, stock quantity, or supplier assumption is embedded
in product code.

This is source and local automated evidence only. The Library surface makes a
reviewed tenant declaration possible but does not supply one. No connected
tenant save, tenant activation, Staffing or Inventory evidence, hosted role
journey, provider action, human acceptance, or commercial outcome is
established by this slice.

## Authority map

Delivery Planning composes references; it does not merge ownership.

| Concern | Governing authority | Delivery Planning use |
| --- | --- | --- |
| Offer, catalog revision, quote draft, price, proposal revision, and acceptance | [Commercial Platform](COMMERCIAL_PLATFORM_PROGRAM.md), [Pricing Constitution](PRICING_CONSTITUTION.md), and existing quote/version authority | Exact inputs and fingerprints only; the proposal cannot reprice, save, send, accept, or publish. |
| Staffing requirements, people, availability, assignments, and receipts | [Operational Staffing Authority](OPERATIONAL_STAFFING_AUTHORITY_ADR.md) | Work blocks and capability requirements are proposed. Only exact revision-bound Staffing evidence may establish event-level coverage. |
| Recipes, ingredient demand, physical stock, allocations, consumption, and corrections | [Ingredient Inventory Authority](INVENTORY_AUTHORITY_ADR.md) | Declared policies may derive production and ingredient demand. Only exact revision-bound Inventory evidence may establish availability or shortage. |
| BEO content, generation, and freshness | Existing BEO authority and the [Commercial Dependency Graph](COMMERCIAL_DEPENDENCY_GRAPH_ADR.md) | Consequences may be shown later; this program does not generate or refresh a BEO. |
| Commercial commitment changes | [Commercial Change Authority](COMMERCIAL_CHANGE_AUTHORITY_ADR.md) | A selected alternative that changes commitment must enter the existing governed change path. |

There is no universal Delivery or Event readiness status. The interface derives
one presentation state from separate evidence axes and preserves each domain's
reason and recovery.

## Versioned contracts

### `delivery-blueprint-v1`

A Delivery Blueprint is tenant configuration referenced by an Offer or Event
Template. It is separate from those records and contains:

- stable ID, revision, declaring actor, declaration timestamp, provenance,
  publication state, and catering-native label;
- compatible service formats;
- broad work blocks with relative timing, duration, and required capabilities;
- required or optional production components with `quantity-policy-v1`
  `{ id, revision }` references;
- exact `{ id, revision }` purchasing-pack references carried by ingredient
  requirements; and
- exact compatible alternative Blueprint references for a later comparison
  phase.

It contains no named person, assignment, availability claim, stock claim,
price, inventory allocation, supplier commitment, purchase order, customer
decision, acceptance, or completion evidence.

An Offer or Event Template may carry:

```json
{
  "deliveryBlueprintRef": {
    "id": "staffed-buffet",
    "revision": "7"
  }
}
```

The compatibility adapter preserves this reference through catalog
normalization and existing catalog writes. It does not publish the referenced
Blueprint or prove that its policies are valid.

### `quantity-policy-v1`

A quantity policy is a reviewed tenant declaration. Phase 1 accepts a bounded
guest-count input with minimum and maximum, an explicit integer numerator and
denominator, a declared rounding method, output unit, and explicit ingredient
requirements per output unit. Every policy carries its own revision,
declaration actor/time, provenance, and `published` state.

The compiler fails explicitly when a policy is absent, unpublished, malformed,
outside its guest bounds, or produces an unsafe quantity. It never infers a
ratio from history, free text, menu names, defaults, or another tenant.

Billing quantity, generated production quantity, retained operator override,
required ingredient quantity, current available quantity, raw shortage,
purchasable pack count, and expected remainder remain distinct fields.

Blueprint components and ingredient requirements use exact versioned
references:

```json
{
  "quantityPolicyRef": { "id": "chicken-portions", "revision": "4" },
  "purchasingPackRef": { "id": "chicken-case", "revision": "2" }
}
```

An ID-only compatibility reference resolves only when exactly one matching
published source exists. Library activation requires the exact form and blocks
ambiguous or stale references.

### `delivery-proposal-v1`

A Delivery Proposal is an immutable in-memory projection containing:

- quote-draft fingerprint and optional exact saved quote/revision identity;
- catalog, Offer, Blueprint, and quantity-policy revisions;
- service format, menu selection, and calculation generation;
- proposed work blocks and capability requirements;
- generated and overridden production outputs;
- ingredient demand and independently evidenced purchasing requirements;
- Commercial, Production, Staffing, Inventory, and Purchasing evidence axes;
- conflicts, unresolved assumptions, and recovery text; and
- an explicit boundary describing actions it cannot take.

It is never stored. It performs no Firestore, network, provider, pricing,
assignment, allocation, order, publication, quote save, proposal-send, or BEO
operation. A deterministic short fingerprint is a session correlation key,
not a security digest, durable receipt, or authority claim.

### `delivery-handoff-v1`

A handoff binds the exact quote/revision when available, draft fingerprint,
Blueprint revision, proposal fingerprint, calculation generation, domain, and
affected requirements. It is `prefill_only`. The receiving workflow must
reread current authority, reject stale input, obtain its own approval, and
issue its own receipt. The current surface prepares this contract, but runtime
routing remains unconnected until the target workflows can consume and reject
it safely.

## Phase 1 staffed-buffet behavior

1. Choosing an Offer whose Blueprint matches the selected Buffet service
   format assembles the Delivery Proposal inside quote creation.
2. Unsaved drafts show deterministic proposed work, production output, and
   gross ingredient demand. Staffing and physical Inventory say **Unchecked**;
   the interface does not treat absent stock evidence as zero stock.
3. Exact saved-revision Staffing or Inventory evidence is accepted only when
   quote, quote revision, Blueprint ID/revision, proposal fingerprint, and
   calculation generation all match. Late results become **Stale**.
4. Guest, menu, service, Blueprint, policy, or override changes create a new
   calculation generation. An explicit override remains visible. If the new
   generated value differs from its prior basis, the operator must choose
   **Keep override** or **Use generated**.
5. An optional component removed from the session proposal stays removed until
   restored. A required component missing from the quote becomes a conflict.
6. Delivery conflicts do not enter the commercial save blockers. Existing
   Commercial authority remains the only source of quote validity.

## Library activation workflow

**Library → Delivery** is the bounded authoring surface for the pilot:

1. An administrator enters tenant-reviewed Blueprint, quantity-policy, and
   purchasing-pack sources under **Reviewed source**. Draft sources may remain
   incomplete only while their publication state is `draft` and Delivery
   Planning remains off.
2. QuotePilot validates published metadata, guest bounds, work blocks,
   capabilities, current menu component IDs, and exact policy/pack revisions.
   Invalid published claims block catalog save rather than becoming runtime
   assumptions.
3. The administrator binds one eligible Blueprint revision to an active Offer.
   QuotePilot does not select a nearby Blueprint or match by label.
4. **Enable Delivery Planning after save** becomes available only when at least
   one published Blueprint is valid and exactly bound to an active Offer.
5. The existing Library save and pricing-confirmation workflow remains the
   persistence authority. Checking the box changes only the current Library
   draft; it is not a saved, published, hosted, or human-review receipt.

## Program phases and independent gates

### 0. Evidence baseline — open

Observe at least five owner-operators using two recent staffed-buffet events
each. Include kitchen and staffing review. Record elapsed time, repeated entry,
navigation, corrections, late discoveries, and workarounds from event facts to
a usable quote and manual operating plan. Freeze the 30% speed target and the
definition of material correction before pilot testing. No current repository
artifact proves this human baseline.

### 1. Staffed-buffet assembly — source and activation-authoring slice implemented

The compiler, safe-off catalog seam, Library activation authoring, exact
revision validation, Proposal Composer presentation, session override handling,
evidence fencing, and focused automated tests exist in source. A real
operator-declared configuration, connected tenant save, connected role
evidence, and human use remain gated.

### 2. Explicit domain handoffs — contract only

Connect **Review staffing**, **Review production**, and **Review purchasing**
only after each existing role-safe workflow consumes `delivery-handoff-v1`,
rereads authority, rejects stale inputs, and returns its own current, stale,
rejected, or pending outcome without discarding the quote's session proposal.

### 3. Coverage-first Staffing — separate ADR required

Staffing must separately own approved work-block requirements, assignment
windows, explainable capability/availability/schedule proposals, and receipts.
Suggested, offered, accepted, assigned, acknowledged, attended, and completed
remain different states. No person may be assigned automatically and no ratio
may be learned from history.

### 4. Use / Make / Buy — Inventory design required

Prepared components and batches require recipe revision, yield, location,
suitability, dates, production receipt, allocation, consumption, and correction
semantics. Cross-event grouping additionally requires compatible revisions,
deadlines, handling policy, capacity, and allocation. Purchasing stays advice
until separately authorized ordering, supplier, delivery, and receiving
capabilities exist.

### 5. Reviewable alternatives — authority review required

Compare only published Delivery Blueprints and approved catalog components.
Display customer price, work, Staffing, Production, Purchasing, BEO, and
unresolved evidence independently. Never invent a substitution, label a choice
“best,” apply it automatically, or bypass Commercial Change when commitment
changes.

## Verification ladder

The source gate requires deterministic fixtures for compilation, policy
bounds, explicit missing-policy behavior, override retention and resolution,
required-component conflicts, optional removal, catalog-reference
preservation, exact evidence binding, and late-result rejection. Component
tests require independent evidence labels, advisory boundary copy, handoff
shape, and interactive override/removal recovery.

Before runtime promotion, add connected Staffing and Inventory fixtures, tenant
and role isolation, no-write instrumentation, and UI-state coverage for
loading, unchecked, current, stale, contradictory, blocked, retained override,
conflict, and recovery. Validate keyboard/focus, 200% zoom, forced colors, and
390/768/1440 layouts. Local screenshots prove only the local source surface.

Human pilot acceptance requires all of the following:

- median time to a reviewable quote plus Delivery Proposal is at least 30%
  lower than the frozen baseline;
- material corrections to customer price, staffing need, production output,
  and purchase requirement do not increase;
- every participant distinguishes proposed work from saved quotes,
  assignments, allocations, orders, and completed work; and
- at least four of five owner-operators prefer the new workflow for a
  comparable staffed-buffet event.

Release evidence remains separated into source, local automated, local
connected, CI, hosted role journey, production data, provider, human
acceptance, and commercial outcome evidence. Prepared batches, team
automation, purchasing providers, and multi-axis alternatives each require an
independent authority and release gate.

## Explicit exclusions

Phase 1 excludes automatic staffing, staff messaging, inventory allocation,
prepared batches, cross-event production, supplier selection, purchase orders,
automatic Commercial Change, customer-facing operational detail, and free-form
AI generation. Approved tenant declarations—not historical inference—drive
every compiled quantity.
