# QuotePilot Package Workspace Program

Status: MVP locally complete; later domain phases gated
Last updated: August 19, 2026
Owner: Product and engineering

## Purpose

Replace the current `Library -> Packages` relational form with a workflow-first
workspace where an operator can answer, in about five seconds:

> What am I selling, what does it include, is it profitable, is it ready, and
> what should I do next?

This program does not introduce a commercial simulation engine, executable
offer test suite, or AI-owned pricing logic.

Current source status: the current-schema MVP is discoverable in `Library ->
Packages`. It includes a stable package navigator, selected-package overview,
deterministic health, reviewed Apply/Cancel inclusion selectors, readiness-
gated activation, dependency-aware deletion, package-level revert, and one
in-flow staged save bar. Focused tests and fresh local browser acceptance at
390, 768, and 1440 pixels pass. Hosted role acceptance, deployment, production
data, human comprehension, and later Phase 5/6 scope remain open.

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
and current source. The implemented MVP has fresh local real-route browser
evidence at 390, 768, and 1440 pixels: zero Axe violations, zero document or
workspace overflow, no visible target below 44 pixels, mobile search-sheet
focus, Escape cancellation/focus restoration, staged Apply, dirty package
switching, activation blocking, dependency review, and package revert. This is
not authenticated hosted-role, deployment, production-data, or human-
comprehension evidence.

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

### Visual and presentation defects

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
| Actor | Catering owner, catalog administrator, sales administrator, or operations manager with existing Library authority |
| Intent | Understand and safely prepare a package for quoting |
| Business object | One organization-scoped catalog package plus its referenced menu, add-on, and rental records |
| State | Persisted lifecycle, derived readiness, draft state, catalog revision, and pricing-confirmation state |
| Blocker | Missing name/price/cost, unavailable references, no eligible event context, stale revision, unresolved draft, or missing pricing confirmation |
| Authority | Existing role-gated Library route and `saveCatalog`; authoritative pricing remains server-owned |
| Action | Edit identity/economics, add or remove inclusions, resolve warnings, save draft, then explicitly activate when ready |
| State transition | Clean -> dirty -> saving -> saved, or conflict/recovery; lifecycle changes are separate guarded intents |
| Proof | Exact catalog revision, save receipt/reconciliation outcome, derived readiness reasons, and unchanged authoritative pricing result for legacy fields |
| Next best action | One deterministic action selected from the highest-severity unresolved readiness reason |

## Operator Decision Model

The first viewport follows this order:

1. Identity: which package is selected and what customer promise it represents.
2. Economics: selling price, recorded cost, contribution, and margin status.
3. Readiness: whether QuotePilot can recommend activation and why.
4. Composition: what is included now, summarized before editing controls.
5. Eligibility: where the package may be offered, when that data exists.
6. Quote behavior: exactly what Quote Builder will allow and charge.
7. Action: the single highest-value next step.

## Product Decisions

- Use three desktop zones: Package Navigator, Selected Package Workspace, and
  Package Health.
- Use a single-column workspace with a package switcher and collapsible health
  summary on mobile.
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

The discoverable role-safe surface and executable local state tests now ship
together in source, so the Feature Matrix and User Manual describe the MVP at
that proof level. Phase 5 lifecycle persistence and Phase 6 eligibility, rules,
preview, and comparison remain contract changes requiring separate approval.
Do not call the program deployed or accepted until hosted roles, production
data, release receipts, and operator acceptance are independently recorded.
