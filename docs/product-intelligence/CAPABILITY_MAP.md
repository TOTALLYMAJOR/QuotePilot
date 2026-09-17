# Capability / Functional Map

Last updated: 2026-09-17 14:17:30 CDT

## Quote-to-Confidence extension

The local candidate strengthens `CAP-03` and `CAP-04` through one completion
command, six independent consequences, governed starts and exact accepted handoff;
`CAP-05` and `CAP-06` through internal supply plans and exception-first/mobile
Inventory; and `CAP-09` through recommendation-only post-event learning. It maps
to `OUT-02`, `OUT-03`, `OUT-05`, `OUT-06` and `MET-19`–`MET-21`.
All remain default-off source candidates with local evidence only. The UI
reuses existing catalog/setup-draft and Inventory adoption authority and cannot
infer price, margin, rate, threshold, conversion, supplier or readiness policy.
Presentation-only contracts own no callable exports. Read and mutation callables
retain their existing authority owners and full lifecycle requirements; UI
composition contracts cannot replace or downgrade those controls (`CAP-12`).
The final packaging split adds only build-gate, comparison, navigation, and
arrival helpers to those existing owners; it does not create a new capability
or transfer authority. Default-off implementation modules remain absent from
disabled production bundles.

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
| `CAP-01` | Publish a bounded inquiry presentation and receive customer preferences. | Start discovery without prematurely promising price, availability, or scope. | `OUT-01` | Implemented and deployed with customer/staff journey proof still open. | Partial: authoritative inquiry receipts exist; end-to-end conversion outcome is not yet measured. |
| `CAP-02` | Maintain offers, packages, menu items, add-ons, templates, rules, recipes, prices, and recorded costs under revision control. | Make sellable work understandable before estimators quote it. | `OUT-02`, `OUT-03` | Implemented across Library, catalog, pricing, and Inventory authorities. | Partial: catalog/cost state is observable; operator decision quality is not. |
| `CAP-03` | Capture event facts, configure scope, obtain authoritative pricing, and save a versioned quote. | Reach a defensible priced draft faster with fewer missing facts. | `OUT-01`, `OUT-02` | Implemented; five-step builder and server pricing are established. | Implemented for funnel, completion, add-on behavior, and intent-to-priced-draft timing. |
| `CAP-04` | Produce, issue, view, discuss, accept, reject, expire, or revise a customer decision artifact without rewriting history. | Preserve what the customer saw and agreed while allowing controlled change. | `OUT-02`, `OUT-04` | Implemented across proposal, portal, conversation, delivery, acceptance, and Commercial Change authorities. | Partial: authority receipts exist; lead time and downstream correction rates are not centrally summarized. |
| `CAP-05` | Convert accepted/booked work into calendar, workflow, staffing, production, Inventory, BEO, and run-of-show preparation. | Prevent a valid sale from becoming an infeasible or stale event plan. | `OUT-03`, `OUT-04` | Implemented in bounded domain slices; no universal event-readiness authority exists. | Missing portfolio measurement for current handoff coverage and late discovery. |
| `CAP-06` | Detect stale, missing, contradictory, blocked, failed, and ambiguous evidence and take the smallest authorized recovery action. | Reduce hidden failure and unsafe retries while protecting operator attention. | `OUT-03`, `OUT-04`, `OUT-05` | Implemented unevenly through field states, dependency graphs, receipts, and recovery contracts. | Partial: limited Ambient issue-resolution timing exists; cross-domain recovery is not summarized. |
| `CAP-07` | Request and reconcile deposits/final balances and distinguish provider acceptance, settlement, refund, and unknown outcomes. | Protect cash collection without duplicate or unexplained financial action. | `OUT-02`, `OUT-05` | Implemented for bounded Stripe/payment rails; Connect remains behind its stopping point. | Partial: provider and ledger evidence exist; ambiguity rate and time-to-resolution are not product metrics. |
| `CAP-08` | Reconcile accepted promise, operational evidence, payment, cost, payout, and contribution without giving the reconciler write authority. | Find revenue leakage and explain commercial exceptions. | `OUT-05` | Read-only Commercial Truth Loop implemented in source/local evidence. | Derivable from exported bundles; production outcome observation remains unproven. |
| `CAP-09` | Close an event with separately recorded actual attendance and corrections. | Preserve planned, contracted, and actual truth for closeout and learning. | `OUT-05`, `OUT-06` | Bounded authority and local acceptance exist; production use remains open. | Partial: receipts are defined; adoption and closeout latency are not measured. |
| `CAP-10` | Review customer history, current opportunities, conversations, evidence, and safe rebooking context. | Turn completed work into a stronger relationship without cloning obsolete commitments. | `OUT-06` | Customer 360, commercial timeline, search, and rebook foundations exist. | Missing: relationship reuse, rebook conversion, and retention outcomes are not centrally observed. |
| `CAP-11` | See bounded commercial and interaction measures with denominators, freshness, source, and truncation. | Make management decisions without mistaking incomplete data for truth. | All | Reporting dashboard and product analytics summaries are implemented. | Implemented for the current bounded measures; broader outcome coverage is incomplete. |
| `CAP-12` | Operate inside tenant, role, privacy, audit, release, and evidence boundaries. | Trust that business control is not gained by weakening security or provenance. | All | Strong source/CI governance and bounded production evidence exist. | Structural and release signals exist; usage and human trust outcomes remain mostly unknown. |

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
