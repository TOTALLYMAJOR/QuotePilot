# Capability / Functional Map

Last updated: 2026-10-10 21:06:24 CDT

## Purpose and evidence boundary

This map answers what QuotePilot must enable people to do. It organizes the
current implementation inventory around catering jobs rather than source files.
Detailed source status remains in `../FEATURE_MATRIX.md`; backend-to-interface
traceability remains in `../capability-surfacing-contracts.json`.

`implemented` means the repository identifies a current source capability. It
does not imply hosted, provider, production, human, adoption, or outcome proof.

## Functional map

| Capability ID | Actor can… | Catering value | Outcomes | Current source state | Observation state |
|---|---|---|---|---|---|
| `CAP-01` | Publish a bounded inquiry presentation and receive customer preferences. | Start discovery without prematurely promising price, availability, or scope. | `OUT-01` | Implemented and deployed; disposable Firebase-emulator acceptance covers cross-tenant callable denial, publication lifecycle and version pinning, idempotent recovery, tenant/IP quota rejection without inquiry authority artifacts, stale conversion rejection, and one atomic authoritative artifact set under a concurrent duplicate. | Partial: local emulator authority evidence exists; hosted Turnstile, provider notification, production, accessibility, human, and outcome evidence remain open. |
| `CAP-02` | Maintain offers, packages, menu items, add-ons, templates, rules, recipes, prices, and recorded costs under revision control. | Make sellable work understandable before estimators quote it. | `OUT-02`, `OUT-03` | Implemented across Library, catalog, pricing, and Inventory authorities. The current source candidate requires an exact bounded dependency review before recipe publication, including direct fixture publication. Local actor journeys cover starter, bypass, import, manual setup, and earlier publication behavior. | Partial: catalog/cost state and focused dependency-preflight contracts are observable locally; hosted reviewed publication, human decision quality, and outcomes are not. |
| `CAP-03` | Capture event facts, configure scope, obtain authoritative pricing, and save a versioned quote. | Reach a defensible priced draft faster with fewer missing facts. | `OUT-01`, `OUT-02` | Implemented; five-step builder and server pricing are established. | Implemented for funnel, completion, add-on behavior, and intent-to-priced-draft timing. |
| `CAP-04` | Produce, issue, view, discuss, accept, reject, expire, or revise a customer decision artifact without rewriting history. | Preserve what the customer saw and agreed while allowing controlled change. | `OUT-02`, `OUT-04` | Implemented across proposal, portal, conversation, delivery, acceptance, and Commercial Change authorities. | Partial: authority receipts exist; lead time and downstream correction rates are not centrally summarized. |
| `CAP-05` | Convert accepted/booked work into calendar, workflow, staffing, production, Inventory, BEO, and run-of-show preparation. | Prevent a valid sale from becoming an infeasible or stale event plan. | `OUT-03`, `OUT-04` | Implemented in bounded domain slices. The Inventory source candidate exposes per-ingredient verified movement summaries and exact event-plan commitments without creating a universal event-readiness authority. | Partial: focused source tests prove bounded reconciliation and scope fences; portfolio measurement for current handoff coverage and late discovery is missing. |
| `CAP-06` | Detect stale, missing, contradictory, blocked, failed, and ambiguous evidence and take the smallest authorized recovery action. | Reduce hidden failure and unsafe retries while protecting operator attention. | `OUT-03`, `OUT-04`, `OUT-05` | Implemented unevenly through field states, dependency graphs, receipts, and recovery contracts. Inventory trace errors/retries are entity-local, and draft or dependency drift invalidates recipe review before publication. | Partial: local component/runtime checks cover these recovery boundaries; hosted recovery, limited Ambient timing, and cross-domain summaries remain incomplete. |
| `CAP-07` | Request and reconcile deposits/final balances and distinguish provider acceptance, settlement, refund, and unknown outcomes. | Protect cash collection without duplicate or unexplained financial action. | `OUT-02`, `OUT-05` | Implemented for bounded Stripe/payment rails; Connect remains behind its stopping point. | Partial: provider and ledger evidence exist; ambiguity rate and time-to-resolution are not product metrics. |
| `CAP-08` | Reconcile accepted promise, operational evidence, payment, cost, payout, and contribution without giving the reconciler write authority. | Find revenue leakage and explain commercial exceptions. | `OUT-05` | Read-only Commercial Truth Loop implemented in source/local evidence. | Derivable from exported bundles; production outcome observation remains unproven. |
| `CAP-09` | Close an event with separately recorded actual attendance and corrections. | Preserve planned, contracted, and actual truth for closeout and learning. | `OUT-05`, `OUT-06` | Bounded authority and local acceptance exist; production use remains open. | Partial: receipts are defined; adoption and closeout latency are not measured. |
| `CAP-10` | Review customer history, current opportunities, conversations, evidence, and safe rebooking context. | Turn completed work into a stronger relationship without cloning obsolete commitments. | `OUT-06` | Customer 360, commercial timeline, search, and rebook foundations exist. | Missing: relationship reuse, rebook conversion, and retention outcomes are not centrally observed. |
| `CAP-11` | See bounded commercial and interaction measures with denominators, freshness, source, and truncation. | Make management decisions without mistaking incomplete data for truth. | All | Reporting dashboard and product analytics summaries are implemented. | Implemented for the current bounded measures; broader outcome coverage is incomplete. |
| `CAP-12` | Operate inside tenant, role, privacy, audit, release, and evidence boundaries. | Trust that business control is not gained by weakening security or provenance. | All | Strong source/CI governance and bounded production evidence exist. | Structural and release signals exist; usage and human trust outcomes remain mostly unknown. |

## October 10 local loading and privacy refinement

The safety/loading candidate supports `CAP-06`, `CAP-10`, `CAP-11`, and `CAP-12`
through independent read states, scope-bound on-demand proposal histories,
recoverable deferred workspace code, and nested diagnostic redaction. Existing
read/mutation authorities and functional acceptance boxes remain unchanged.
`LED-018` records the causal hypothesis; local code and regression checks cannot
establish task-speed, recovery-quality, privacy-in-production, or outcome proof.

## October 10 progressive operability refinement

`LED-020` links the local route-stage, exact-consequence, context-preservation,
multi-line receiving, and release-evidence changes to `CAP-05`, `CAP-06`,
`CAP-10`, and `CAP-12`. Receiving remains one singular authoritative command
per line; the client coordinator cannot turn a partial batch into a second stock
movement. UAT v5 requires exact hosted role observations but has not executed
them. Local checks therefore preserve the capability mapping without closing
the hosted, human, or outcome acceptance boxes.

## Functional requirement verification ledger

The requirement box is checked when the current source capability and its
authority are mapped above. Product acceptance remains open until the required
journey, human, and outcome evidence exists; a source implementation cannot
close those proof classes.

| Requirement | Current source requirement | Product acceptance | Journey coverage | Next proof event |
|---|---:|---:|---|---|
| `FR-01` → `CAP-01` | [x] | [ ] | `JRN-01`, `JRN-03` | Qualify one real inquiry-to-opportunity journey with origin and recovery. |
| `FR-02` → `CAP-02` | [x] | [ ] | `JRN-02`, `JRN-04` | Complete realistic setup, import, menu-costing, and publication acceptance. |
| `FR-03` → `CAP-03` | [x] | [ ] | `JRN-03`, `JRN-04` | Prove first and repeat authoritative quote paths with exact readback. |
| `FR-04` → `CAP-04` | [x] | [ ] | `JRN-05`, `JRN-06` | Separate issuance, delivery, view, decision, revision, and acceptance proof. |
| `FR-05` → `CAP-05` | [x] | [ ] | `JRN-07` | Observe role owners completing exact-basis operational handoff. |
| `FR-06` → `CAP-06` | [x] | [ ] | `JRN-06`–`JRN-09` | Exercise stale, contradictory, failed, and ambiguous recovery paths. |
| `FR-07` → `CAP-07` | [x] | [ ] | `JRN-09` | Complete hosted deposit/final-balance and provider reconciliation acceptance. |
| `FR-08` → `CAP-08` | [x] | [ ] | `JRN-09` | Run a production-shaped read-only reconciliation with operator review. |
| `FR-09` → `CAP-09` | [x] | [ ] | `JRN-09` | Record and explicitly correct actual attendance in an accepted closeout. |
| `FR-10` → `CAP-10` | [x] | [ ] | `JRN-10`, `JRN-11` | Prove safe relationship reuse and measure repeat engagement. |
| `FR-11` → `CAP-11` | [x] | [ ] | All | Validate measure comprehension, freshness, denominators, and decision use. |
| `FR-12` → `CAP-12` | [x] | [ ] | All | Complete role, tenant, privacy, accessibility, and human-trust acceptance. |

## Existing implementation cohorts

The Feature Matrix groups the 93 numbered implementation rows into seven
cohorts: platform/safety, catalog/pricing, quote/customer relationship,
booking/events/operations, revenue/providers/reporting/acquisition,
decision/accessibility, and Inventory/menu costing. This map deliberately
crosses those cohorts when a real catering job does.

## Capability admission rule

A new user-relevant capability is complete at the product-intelligence layer
only when it has:

- at least one outcome ID;
- a named actor and catering job;
- acceptance evidence appropriate to its authority;
- at least one success or diagnostic metric, or an explicit
  `not_yet_observable` disposition;
- applicable guardrail IDs; and
- a release/experiment ledger entry when exposed to users.

Infrastructure-only work must name its enabling capability or state why direct
catering value is not applicable.
