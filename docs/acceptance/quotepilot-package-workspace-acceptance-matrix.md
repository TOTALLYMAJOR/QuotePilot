# QuotePilot Package Workspace Acceptance Matrix

Last updated: 2026-08-27 17:07:37 CDT

## Purpose

Translate the Package Workspace PRD and UI specification acceptance criteria into
an executable proof ladder. This matrix does not replace the PRD, UI spec, ADR,
technical design, Feature Matrix, or User Manual; it connects each user-visible
criterion to the evidence needed before stronger readiness claims are made.

## Evidence Classes

| Evidence class | Meaning | Not sufficient for |
|---|---|---|
| Source contract | PRD, UI spec, ADR, design, or code defines the expected behavior | Runtime behavior |
| Local automated | Unit, component, rules, or local browser test passes in this checkout | Hosted role acceptance or production data |
| Local visual | Captured local route at required viewports with layout and accessibility checks | Hosted, production, or human comprehension |
| CI | Required branch/main checks pass for the exact SHA | Provider, hosted role, or human acceptance |
| Hosted role | Authenticated hosted user with the intended role exercises the flow | Production-data correctness or operator comprehension |
| Production data | Real tenant catalog/package data is exercised without fixture assumptions | Human comprehension or business acceptance |
| Human comprehension | Representative operators complete the stated scenario or explain the state correctly | Automated correctness |

## MVP Acceptance Matrix

| AC ID | User-visible outcome | Source authority | Expected implementation surface | Minimum executable proof | Open stronger gates |
|---|---|---|---|---|---|
| AC-001 | Operator can identify selected package, price, lifecycle, and readiness without opening an editor section | PRD FR-01; UI spec S-01/PackageNavigator | Library -> Packages workspace navigator and selected overview | Component assertion for package row/selected summary; local browser capture at 390, 768, 1440 px | Hosted role, production data, human five-second comprehension |
| AC-002 | Switching packages preserves unsaved drafts and does not mutate persisted catalog | PRD FR-01; UI spec PackageWorkspaceShell and PackageNavigator | Stable package ID selection plus draft registry | Component interaction test proving draft A remains dirty after selecting B; save path untouched until explicit save | Hosted role with real catalog revision conflict scenario |
| AC-003 | First viewport shows price, recorded cost or Not recorded, contribution/margin availability, inclusion counts, and one next action | PRD FR-02; UI spec CommercialSummary | Selected package commercial summary and health rail | Local visual assertion/capture at 1440 px; component assertions for each commercial field | Production data, human five-second comprehension |
| AC-004 | Missing cost is never displayed or calculated as zero | PRD FR-02; UI spec CommercialSummary | Commercial summary and readiness reason model | Unit/component tests for missing, zero, and positive cost fixtures | Production data with real missing-cost package |
| AC-005 | Default Includes view lists current inclusions and removal controls without rendering the full candidate catalog | PRD FR-03; UI spec PackageIncludes | Includes tab and grouped inclusion cards | Component test proving existing inclusions render and candidates remain behind Add action | Hosted role, local visual mobile/desktop |
| AC-006 | Selector supports search, kind/category filtering, selected count, multi-select, bulk Add, Cancel, and no-results recovery | PRD FR-03; UI spec CatalogSelectorDialog | Add menu/add-on/rental selector dialog or mobile sheet | Component interaction tests for search, filter, count, bulk Add, Cancel, no-results | Keyboard-only hosted role, production-sized catalog fixture |
| AC-007 | Existing inactive references remain visible/removable while unrelated inactive candidates cannot be added | PRD FR-03; UI spec PackageIncludes | Inclusion list and selector candidate filter | Unit/component fixture with selected inactive ID and unrelated inactive ID | Production data with stale references |
| AC-008 | Clean workspace shows one Saved state and no enabled Save/Revert | PRD FR-04; UI spec Persistence Interaction Contract | Sticky save bar and status region | Component assertion for clean state; no duplicate enabled save controls | Hosted role smoke |
| AC-009 | Dirty workspace shows Unsaved changes, Save, and Revert; destructive leave requires confirmation | PRD FR-04; UI spec PackageWorkspaceShell | Draft state, save bar, navigation/destructive boundary guard | Component interaction test for edit -> dirty -> revert; confirmation test for destructive boundary | Hosted role with real navigation |
| AC-010 | Save reports saving, receipt, conflict/reconciliation, uncertain, recovery, and error without claiming success early | PRD FR-04; UI spec Persistence Interaction Contract | Existing guarded catalog save and reconciliation UI | Mocked save-state component tests for each state; integration test against current save contract where available | Hosted role, real revision conflict, provider-independent production data |
| AC-011 | Lifecycle is one of draft, active, or archived | PRD FR-05; UI spec PackageHealthPanel | Compatibility lifecycle view model | Unit tests for lifecycle normalization and display | Future persistence contract for Phase 5 |
| AC-012 | Readiness is deterministic: incomplete, needs_review, or ready with reason codes and next action | PRD FR-05; UI spec PackageHealthPanel | Readiness model and health panel | Unit tests for deterministic reason priority; component test for next action | Human comprehension of readiness vs pricing approval |
| AC-013 | Activation is blocked when readiness is not ready and blocking reasons are shown before action | PRD FR-05; UI spec PackageHealthPanel | Activate action and readiness guard | Component test for blocked activation, focus/announcement of first reason | Hosted role and production data |
| AC-014 | Preview says package inclusions are available at no added charge only after estimator selection | PRD FR-06; UI spec Quote Builder preview | Package behavior explanation and Quote Builder handoff | Text/component assertion for customer-safe preview wording | Hosted role; real quote builder parity |
| AC-015 | MVP preserves per-person package pricing and selected-inclusion de-duplication in local and authoritative calculations | PRD FR-06; UI spec Quote Builder preview | Existing calculator and authoritative pricing seam | Characterization tests comparing legacy package fixtures before/after workspace adoption | Authoritative pricing CI lane; production-data spot check |
| AC-016 | Inclusion selector labels event type as menu-availability filtering only | PRD FR-07; UI spec CatalogSelectorDialog | Selector filter label/help text | Component assertion for filter wording | Human comprehension |
| AC-017 | UI does not claim event-type filter changes package eligibility, pricing, or Quote Builder availability | PRD FR-07; UI spec CatalogSelectorDialog | Selector copy and Quote Builder behavior boundary | Negative text assertions; no eligibility mutation in payload | Future eligibility contract before AC-020 |
| AC-018 | Archive/Delete actions live in overflow and require dependency summary plus confirmation before draft change | PRD FR-08; UI spec PackageActionsMenu | Overflow menu and dependency-aware confirmation | Component test for overflow placement, dependency summary, confirmation, malformed dependency block | Hosted role with real dependency graph |

## Deferred Criteria

| AC ID | Reason deferred | Gate before implementation |
|---|---|---|
| AC-019 | Package comparison is P2 and later-screen scope | Accepted comparison UI/technical contract and deterministic parity fixtures |
| AC-020 | Persisted package eligibility/minimum constraints are outside MVP | Accepted data contract, Quote Builder eligibility authority, migration plan, and pricing parity tests |

## Acceptance Sequence

1. Prove source traceability from PRD ACs to UI spec states and this matrix.
2. Prove pure model behavior with deterministic unit tests for lifecycle,
   readiness, missing cost, stale references, and pricing parity.
3. Prove component behavior for navigator, selector, health, persistence, and
   destructive actions.
4. Prove local visual/accessibility acceptance at 390, 768, and 1440 px.
5. Prove exact-SHA CI for the implementation branch.
6. Prove hosted authenticated role acceptance.
7. Prove production-data behavior without fixture-only assumptions.
8. Prove human comprehension for the PRD success metrics.

## Non-Claims

- This matrix does not claim deployment, provider behavior, production data
  correctness, or human acceptance.
- Local browser evidence remains local evidence even when all local viewports
  pass.
- Readiness is not pricing approval, customer acceptance, payment proof,
  booking confirmation, or operational readiness.
