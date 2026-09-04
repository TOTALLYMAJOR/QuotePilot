# QuotePilot Commercial Platform Program

Last updated: 2026-09-04 13:30:00 CDT

## Program status

This document is the canonical implementation program that amends the frozen
UX convergence contract without replacing it. The existing Commercial
Workbench and calendar-first Operations work remains the presentation
substrate. This program widens the commercial model beneath those surfaces so
the same authority can support reusable offers, templates, rules, and exact
pricing evidence.

The governing architecture is:

`Commercial / Operations Kernel -> Vertical Pack -> Tenant Configuration -> Contextual UX`

QuotePilot remains catering-first. Catering is the only complete production
vertical in this program, but catering vocabulary is not the kernel boundary.
Operators continue to see Packages, Guests, Menu, Venue, Staffing, BEO, and Run
of Show. Kernel contracts use domain-neutral names only where shared truth or
authority benefits from it.

## Reconciled starting point

- Remote `main` at program start: `8f2d2dcf78d4512aa7d02495ee27cbeeea4ccc12`.
- Active implementation: `feat/ux-convergence-workbench-operations`, PR #129.
- Local starting candidate: `2d4bc90a76fb6a1902dfeb5229e9c805eb26d3ae`.
- Existing Workbench, quote draft, catalog, pricing, payment, Operations, and
  Library authorities are reused. No parallel Quote Builder or catalog is
  authorized.
- The IDE checkout's unrelated `CHANGELOG.md`, `docs/DOC_SYSTEM.md`, design
  archives, portable-governance documents, and portfolio work are outside this
  branch and remain untouched.

## Ordered slices

1. Architecture, canonical documentation, and pricing-v1 characterization.
2. Configurable Offer contract and Package compatibility adapter.
3. Commercial Template contract and Event Template compatibility adapter.
4. Bounded declarative Configuration Rules.
5. Pricing-policy validation and deterministic Price Waterfall.
6. Pricing-v2 integer-minor-unit reconstruction and payment handoff.
7. Library, starter-pack, migration, UI, and cross-feature qualification.

Each slice is additive and reversible until the final branch candidate is
qualified. Historical pricing-v1 receipts are never recalculated.

Implementation checkpoint: Slices 2-7 are source-complete and entering final
local qualification. Existing Packages
adapt to Configurable Offers without migration; bounded choice groups validate
minimums, maximums, active references, and authoritative quote selections.
Existing Event Templates adapt to Commercial Templates, explicit operator work
is preserved on application, and shallow module collisions are returned for
resolution. Configuration Rules use enumerated condition/effect operators,
detect conflicting mandatory outcomes, perform no mutation, and are staged in
Library under the existing catalog publication boundary.

Pricing-v2 now applies integer-minor-unit arithmetic with a declared half-up
rounding sequence, policy validation, exact line/fee/tax/deposit reconciliation,
and a stored price waterfall. A fixed-seed differential test runs 5,000 valid
cases across browser and server adapters. Quote, proposal, deposit, ledger, and
final-balance projections carry exact cents with consistency checks. Library
distinguishes Offers, Components, Templates, Pricing, and Rules; starter packs
derive compatible catering templates and a disabled review-gated rule without
changing their frozen manifest identity.

## Capability boundaries

### Kernel

Owns deterministic contracts for offers, templates, rules, pricing policy,
price waterfalls, pricing receipts, validation, and compatibility adapters. It
does not own tenant reads, browser state, provider calls, or vertical wording.

### Catering vertical pack

Supplies catering terminology, starter content, default packages/templates,
staffing and fulfillment references, and natural presentation. It cannot
bypass kernel validation or server pricing authority.

### Tenant configuration

Supplies organization-scoped catalog records, selections, pricing settings,
and declared rules. Publication stays revision-fenced and pricing confirmation
stays bound to the exact catalog revision and declaring actor/time.

### Contextual UX

Commercial Workbench consumes one quote draft and one pricing projection.
Library is the business-facing place to understand Packages/Offers, Event
Templates, components, pricing, and rules. UI presentation grants no pricing,
payment, catalog, or lifecycle authority.

## Reuse and change ledger

| Classification | Decision |
|---|---|
| REUSE | `ProposalComposer`, App-owned quote form, Guided mode, Package Workspace, Event Templates, `STAFF_RULES`, upsell rules, catalog setup drafts, catalog revision fencing, server pricing, quote versioning, payment ledger, starter packs, and Ambient Library. |
| EXTEND | Package records with bounded choice groups; Event Templates with shared template metadata; Library with business-readable rule and pricing explanations; pricing receipts with exact minor units and waterfalls. |
| GENERALIZE | Package -> Configurable Offer adapter; Event Template -> Commercial Template adapter; common deterministic condition/effect vocabulary. |
| MIGRATE | Compatibility is read-time/additive. Existing Package, Event Template, upsell rule, and pricing-v1 records remain valid without destructive migration. |
| RETIRE | No source authority in this program. Compatibility adapters retire only after all supported tenant records are natively versioned and readback evidence proves no legacy dependency. |
| NEW | Shared commercial kernel contracts, pricing-v2 reconstruction, Golden Pricing Corpus, differential certification, Pricing Constitution, and acceptance matrix. |

## Explicit non-goals

Coupons, arbitrary discounts, customer price books, contract pricing,
minimum-spend engines, tax-exemption workflows, gratuity, rush fees, dynamic AI
pricing, user formulas, arbitrary scripts, a plugin marketplace, a generalized
workflow engine, and a second complete vertical remain unsupported.

## Evidence and release boundary

Local tests prove source behavior only. PR CI must pass at the exact pushed
candidate SHA. Neither local nor CI evidence proves hosted behavior, provider
acceptance, production readiness, production data correctness, human visual
acceptance, assistive-technology acceptance, adoption, or commercial outcome.

See `docs/PRICING_CONSTITUTION.md`,
`docs/adr/ADR-0003-commercial-platform-vertical-pack.md`, and
`docs/acceptance/commercial-platform-acceptance-matrix.md`.
