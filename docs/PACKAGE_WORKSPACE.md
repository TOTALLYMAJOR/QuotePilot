# QuotePilot Package Workspace Program

Status: MVP locally complete; later domain phases gated
Last updated: 2026-09-04 21:58:00 CDT
Owner: Product and engineering

## Purpose

Present the existing Package Workspace through `Library -> Offers` as a
workflow-first workspace where an operator can answer, in about five seconds:

> What am I selling, what does it include, is it profitable, is it ready, and
> what should I do next?

This program does not introduce a commercial simulation engine, executable
offer test suite, or AI-owned pricing logic.

Current source status: the current-schema MVP is discoverable in `Library ->
Offers` while retaining Package as the stored catering record type. The
selected presentation uses a compact stable-ID Offer navigator and one broad
selected-Offer workspace. Identity, price, quoting availability, included
components, derived margin, and one deterministic next action lead; detailed
cost/contribution, readiness evidence, immutable identity, revision, pricing
confirmation, and quote behavior remain under secondary disclosures rather
than a permanent health rail. Recorded choice groups project read-only with
their attention state; this workspace does not author them or claim native
quote selection. Reviewed Apply/Cancel inclusion selectors, readiness-gated activation,
dependency-aware deletion, Offer-scoped revert, and the one in-flow staged save
bar retain their existing authority. Prior Package Workspace tests and browser
acceptance remain historical evidence for the earlier presentation. Current
local Chromium evidence passes Ambient Library 17/17 and Calm Four 10/10 with
`VITE_OPERATIONAL_STAFFING_ENABLED=true`; exact 390/768/1440 captures and
combined comparisons received a **9.5/10 — GO** local visual-review verdict.
The exact rendered implementation is local commit
`b593fe4d2c45ff5db20bafe205461157952b9ab4`. Full unit, build, bundle,
capability/document governance, and CWV checks pass; `check:env` and therefore
the aggregate release lane remain blocked by six absent local Firebase web
configuration values. Hosted role acceptance, deployment, production data, human
comprehension, and later Phase 5/6 scope remain open.

## Canonical Documents

| Concern | Document |
|---|---|
| User value, scope, metrics, and acceptance criteria | [`docs/prd/quotepilot-package-workspace-prd.md`](prd/quotepilot-package-workspace-prd.md) |
| Screen architecture, components, states, and wireframes | [`docs/ui-spec/quotepilot-package-workspace-ui-spec.md`](ui-spec/quotepilot-package-workspace-ui-spec.md) |
| Persistence, lifecycle, readiness, and compatibility decision | [`docs/adr/ADR-0001-package-workspace-state-and-persistence.md`](adr/ADR-0001-package-workspace-state-and-persistence.md) |
| Data contracts, integration points, and migration | [`docs/design/quotepilot-package-workspace-design.md`](design/quotepilot-package-workspace-design.md) |
| Incremental delivery sequence | [`docs/plans/20260818-feature-quotepilot-package-workspace.md`](plans/20260818-feature-quotepilot-package-workspace.md) |

## Evidence Boundary

The baseline diagnosis is grounded in the supplied Package Settings screenshot
and source at the original MVP checkpoint. That implementation had local
real-route browser evidence at 390, 768, and 1440 pixels for Axe, overflow,
44-pixel targets, mobile search-sheet focus, Escape cancellation/focus
restoration, staged Apply, dirty Package switching, activation blocking,
dependency review, and Package revert. The selected Offer presentation now
has worktree-local 390/768/1440 captures, combined comparisons, and the 17-case
Ambient Library browser result. They are bound to rendered implementation
`b593fe4d2c45ff5db20bafe205461157952b9ab4`. Neither evidence set establishes
authenticated hosted roles, deployment, production-data correctness, or human
comprehension.

## Existing Experience Diagnosis

### Current strengths

- Package edits already use an explicit draft and the catalog's guarded save
  path rather than silently writing each checkbox.
- Quote Builder and authoritative pricing agree that package inclusions are
  choices available at no added charge; they are not automatically selected.
- Stable IDs, stale-reference protection, catalog revision fencing, and
  dependency-aware deletion already exist.
- Cost values preserve the difference between missing and recorded zero, which
  supports fail-closed margin presentation.

### Baseline visual and presentation defects

- Every package expands into a large form, so the page has no usable overview
  of price, cost, margin, readiness, or package differentiation.
- Internal IDs and low-level controls receive the same visual weight as selling
  price and customer promise.
- Always-visible checkbox matrices create nested scrolling and make existing
  inclusions difficult to recognize.
- Destructive deletion is permanently visible while readiness and the next
  useful action are absent.
- The top and bottom save controls duplicate one another, and clean-state copy
  competes with a disabled save action.

### Interaction defects

- Operators must scan the entire available catalog to learn what is currently
  included.
- Switching packages requires scrolling rather than selecting from a stable
  navigator.
- Menu event type changes the candidate list without explaining whether it
  means package eligibility, menu availability, or quote behavior.
- Inclusion selection lacks search, category filtering, bulk selection, and a
  clear selected count.
- Active is treated as a field-level checkbox even though activation should be
  a guarded lifecycle transition.

### Domain and workflow defects

- The persisted package model contains name, per-person price, optional cost,
  three inclusion ID arrays, and `active`; it does not represent customer
  promise, eligibility, minimums, readiness, review state, or customer copy.
- Lifecycle and readiness are collapsed into one Boolean. A package can be
  active while commercially incomplete, and the screen cannot explain why.
- Package pricing is currently per-person only, while the desired vocabulary
  mentions flat, tiered, and minimum pricing. Those modes must not appear as
  editable promises until pricing authority supports them.
- The menu event-type selector currently scopes which menu records can be
  selected. It does not persist package eligibility and Quote Builder does not
  filter active packages by event type.
- Catalog settings and managed-menu records have separate mutation behavior.
  The redesign must not imply one atomic save if the underlying operation is
  still separate.

## Required Workflow Audit

| Stage | QuotePilot package workflow |
|---|---|
| Actor | A catalog administrator edits; authorized admin and sales staff inspect under the existing Library role boundary |
| Intent | Understand and safely prepare a package for quoting |
| Business object | One organization-scoped catalog package plus its referenced menu, add-on, and rental records |
| State | Persisted lifecycle, derived readiness, draft state, catalog revision, and pricing-confirmation state |
| Blocker | Missing name/price/cost, unavailable references, no eligible event context, stale revision, unresolved draft, or missing pricing confirmation |
| Authority | Existing role-gated Library route and `saveCatalog`; authoritative pricing remains server-owned |
| Action | Administrators edit identity/economics, add or remove inclusions, resolve warnings, save the draft, and explicitly activate when ready; sales remains read-only |
| State transition | Clean -> dirty -> saving -> saved, or conflict/recovery; lifecycle changes are separate guarded intents |
| Proof | Exact catalog revision, save receipt/reconciliation outcome, derived readiness reasons, and unchanged authoritative pricing result for legacy fields |
| Next best action | One deterministic action selected from the highest-severity unresolved readiness reason |

## Operator Decision Model

The first viewport follows this order:

1. Identity: which Offer is selected and which Package record it represents.
2. Price and availability: what it sells for and whether it can be quoted.
3. Action: the single highest-value next decision.
4. Composition: which Menu, Service/Add-on, and Rental components are included.
5. Economics and readiness: the derived margin outcome remains in the summary;
   recorded cost, contribution detail, and deterministic reasons are disclosed.
6. Record and quote behavior: stable Package ID, revision, pricing confirmation,
   and exactly what Quote Builder will allow and charge under disclosure.

## Product Decisions

- Use two desktop zones: a compact Offer Navigator and one broad Selected Offer
  Workspace. Do not keep a permanent Package Health rail.
- Use a single-column workspace with an Offer switcher and the existing full-
  viewport inclusion picker on mobile. Preserve the desktop semantic order.
- Keep staged editing. Show `Unsaved changes`, `Saving`, `Saved`, `Conflict`, or
  `Save failed`; show Save and Revert only while the draft is dirty.
- Separate persisted lifecycle (`draft`, `active`, `archived`) from derived
  readiness (`incomplete`, `needs_review`, `ready`).
- Preserve current per-person pricing and select-to-add inclusions in the first
  release. Unsupported pricing bases are visible only as future scope.
- Replace checkbox matrices with explicit Add actions and searchable selectors.
- Keep internal IDs available in details and evidence, not in the default
  decision hierarchy.
- Keep AI advisory-only. Readiness and margin decisions are deterministic.

## Delivery State

The discoverable role-safe surface and executable local state tests remain
together in source. The selected Library convergence changes presentation only:
Package records appear as Offers, the permanent health rail is removed, and
secondary evidence is disclosed without changing lifecycle, readiness,
inclusions, persistence, or pricing authority. The Feature Matrix and User
Manual describe that source boundary. Local responsive/browser and visual-review
evidence has passed against exact rendered implementation
`b593fe4d2c45ff5db20bafe205461157952b9ab4`. The environment-dependent
aggregate release lane remains blocked as described above. Phase 5 lifecycle
persistence and Phase 6 eligibility,
rules, preview, and comparison remain contract changes requiring separate
approval. Do not call the program deployed or accepted until hosted roles,
production data, release receipts, and operator acceptance are independently
recorded.
