# Work Plan: QuotePilot Package Workspace Implementation

Created Date: August 18, 2026
Type: feature/refactor
Estimated Duration: 12-18 engineering days plus operator acceptance
Estimated Impact: 14-22 files
Related Issue/PR: None
Review Scope: Package Workspace documents and the narrow future implementation
slice defined below; unrelated active worktree changes are excluded.

## Related Documents

- PRD: [`docs/prd/quotepilot-package-workspace-prd.md`](../prd/quotepilot-package-workspace-prd.md)
- UI Spec: [`docs/ui-spec/quotepilot-package-workspace-ui-spec.md`](../ui-spec/quotepilot-package-workspace-ui-spec.md)
- ADR: [`docs/adr/ADR-0001-package-workspace-state-and-persistence.md`](../adr/ADR-0001-package-workspace-state-and-persistence.md)
- Design Doc: [`docs/design/quotepilot-package-workspace-design.md`](../design/quotepilot-package-workspace-design.md)

## Verification Strategy

### Correctness Proof Method

- Correctness means improved package comprehension and editing with unchanged
  legacy package write shapes, pricing totals, selected-at-$0 inclusion behavior,
  and revision-conflict behavior.
- Verify through pure model tests, component interaction tests, local/server
  pricing parity fixtures, route integration, and responsive accessibility
  browser acceptance.
- Verify each vertical slice before starting the next; run full repository gates
  in the final QA phase.

### Early Verification Point

- First target: one current package fixture through navigator, Overview, Health,
  dirty draft, Revert, and existing Save.
- Success: exact current values render; missing cost remains unavailable; Save
  receives the current normalized catalog; pricing output remains deeply equal.
- Failure response: stop before selector or schema changes and revise the
  compatibility adapter.

### Planned Test Paths

- `src/lib/__tests__/packageWorkspaceModel.test.js`
- `src/components/__tests__/packageWorkspace.test.jsx`
- `src/lib/__tests__/packageWorkspacePricingParity.test.js`
- `src/components/__tests__/adminCatalogSaveCapabilityState.test.jsx`
- `src/components/__tests__/adminCatalogStarterChoice.test.jsx`
- Independent local real-route Playwright CLI and Axe audit at 390, 768, and
  1440 pixels.

## Quality Assurance Mechanisms

| Mechanism | Enforces | Config Location | Covered Files |
|---|---|---|---|
| Maintainer checks | Build and core project safety | `.codex/skills/quote-wizard-maintainer/scripts/run-maintainer-checks.sh` | Project-wide |
| Environment check | Required runtime configuration contract | `package.json` `check:env` | Project-wide |
| Capability surface gate | Backend/data authority traceability if introduced | `docs/capability-surfacing-contracts.json` | Authority paths only |
| Focused Vitest | Model, UI, save-state, and parity behavior | `vitest.config.js` | New/changed package files |
| Playwright + axe | Responsive, keyboard, overflow, and interaction behavior | `playwright.config.js` | Package route at 390/768/1440 |
| Bundle guardrail | No unreviewed graph growth | `docs/performance/bundle-budget.json` | Production build |

## Design-to-Plan Traceability

| Design Doc Item | Category | Covered By | Status |
|---|---|---|---|
| Characterize current write/pricing behavior | prerequisite | Phase 1 | covered |
| Pure compatibility/readiness model | impl-target | Phase 1 | covered |
| Navigator, Overview, Health | impl-target | Phase 2 | covered |
| Preserve exact Library handoff and draft guard | connection-switching | Phase 2 | covered |
| Searchable inclusion selector | impl-target | Phase 3 | covered |
| Single staged persistence presentation | connection-switching | Phase 4 | covered |
| Lifecycle metadata and migration | contract-change | Phase 5 | covered, approval-gated |
| Eligibility/rules/preview/comparison | contract-change | Phase 6 | covered, separately approval-gated |
| Local/server pricing parity | verification | Every phase and final QA | covered |

## Reference Contract Values

| Contract Type | Required Observable Value | Covered By |
|---|---|---|
| structure-order | First viewport order is identity, economics, readiness, composition, eligibility, quote behavior, next action | Phase 2 |
| derived-display | Blank package cost displays `Not recorded`; contribution and margin display `Unavailable` | Phases 1-2 |
| derived-display | Event type in the MVP selector is labeled as a menu-availability filter only | Phase 3 |
| state-lifecycle-negative | Switching packages never saves, discards, or mutates a persisted record | Phases 1-2 |
| state-lifecycle-negative | Readiness never establishes catalog pricing confirmation or authoritative quote validity | Phases 1-2 |

## Failure Mode Checklist

| Category | Applies? | Covered By |
|---|---|---|
| same-value | yes | Phase 1 model tests |
| no-op | yes | Phase 1/3 interaction tests |
| empty input | yes | Phase 1 readiness and save tests |
| invalid option | yes | Phase 3 selector tests |
| missing config | yes | Phase 1/2 unavailable states |
| unavailable boundary | yes | Phase 2/4 route and save tests |
| shared-state dependency | yes | Phase 2 package draft registry tests |
| rollback-only visibility | yes | Phase 4 Revert and release rollback |
| missing-sort-key ordering | yes | Phase 1 deterministic package ordering |

## UI Spec Component to Task Mapping

| UI Spec Component | States | Covered By | Status |
|---|---|---|---|
| Component: PackageWorkspace | default/loading/empty/error/partial | Phases 2 and 4 | covered |
| Component: PackageNavigator | default/loading/empty/error/partial | Phase 2 | covered |
| Component: CommercialSummary | default/loading/empty/error/partial | Phases 1 and 2 | covered |
| Component: PackageIncludes | default/loading/empty/error/partial | Phase 3 | covered |
| Component: CatalogSelectorDialog | default/loading/empty/error/partial | Phase 3 | covered |
| Component: PackageHealthPanel | default/loading/empty/error/partial | Phases 1 and 2 | covered |
| Component: PackageActionsMenu | default/loading/error/partial | Phase 4 | covered |

## ADR Bindings

| Axis | Binding Decision | Covered By |
|---|---|---|
| persistence | MVP saves through existing staged `saveCatalog` | Phases 2 and 4 |
| contract_schema | Current package fields remain authoritative in MVP | Phases 1-4 |
| data_flow | Readiness is a pure advisory projection and cannot mutate or price | Phase 1 |
| dependency_direction | Pricing modules never depend on workspace components | All phases |
| contract_schema | Lifecycle and readiness are orthogonal | Phases 1, 2, and 5 |

## Connection Map

| Boundary | Left Owner | Right Owner | Serialized Format | Consumer Parse Rule | Expected Signal | Covered By |
|---|---|---|---|---|---|---|
| Workspace -> catalog draft | `PackageWorkspace` | `AdminCatalogView` | In-memory package object keyed by stable ID | Exact ID replacement, no row-position lookup | Only intended package fields become dirty | Phase 2 |
| Catalog draft -> persistence | `AdminCatalogView` | `useCatalogData.saveCatalog` | Existing normalized catalog object | Existing normalization and revision fence | Receipt/reconciliation outcome | Phase 4 |
| Package docs -> Quote Builder | Catalog loader | `WizardSteps` | Normalized package fields | Active filter and exact inclusion IDs | Same choices and select-to-add labels | Phases 1-4 |
| Package docs -> authoritative pricing | Firestore bundle | `functions/pricingEngine.js` | Minor-unit money and stable IDs | Exact map lookup, unavailable refs fail closed | Same package/inclusion totals | Every phase |

## Objective

Let a QuotePilot operator understand and safely prepare a package for quoting
without scanning database-shaped forms or ambiguous checkbox matrices.

## Risks and Countermeasures

### Technical Risks

- Risk: Presentation implies unsupported pricing or eligibility.
  - Impact: Operators may trust behavior that Quote Builder does not enforce.
  - Countermeasure: Per-person MVP and explicit unavailable/filter-only labels.
- Risk: Dirty worktree causes unrelated changes to enter the slice.
  - Impact: Review and rollback become unreliable.
  - Countermeasure: Narrow file inventory, diff review, and scoped staging if
    publication is later requested.
- Risk: Schema changes diverge across local and authoritative pricing.
  - Impact: Commercial totals differ.
  - Countermeasure: No quoting effect until parity fixtures pass both engines.

### Schedule Risks

- Risk: Lifecycle/eligibility decisions delay the workflow correction.
  - Impact: MVP stalls behind future domain scope.
  - Countermeasure: Deliver Phases 1-4 on current fields; gate Phases 5-6.
- Risk: Browser acceptance requires authenticated role fixtures.
  - Impact: Source completion may precede hosted proof.
  - Countermeasure: Keep local, hosted, production, and human evidence separate.

## Implementation Phases

### Phase 1: Characterization and Model (2-3 days)

Purpose: Prove compatibility and deterministic readiness before visual work.

Tasks:

- [x] Add current package write-shape and pricing parity fixtures.
- [x] Implement `packageWorkspaceModel` with lifecycle adapter, reference health,
  readiness reasons, commercial summary, and next action.
- [x] Assert missing-vs-zero cost and stable reason ordering.
- [x] Run focused tests and `npm run check:env`.

Completion:

- [x] Early verification point passes.
- [x] No production behavior or persistence contract changes.

### Phase 2: Navigator, Overview, and Health (3-4 days)

Purpose: Deliver the five-second comprehension slice on current data.

Tasks:

- [x] Extract the Packages surface into `PackageWorkspace`.
- [x] Add stable-ID navigator and per-package draft registry.
- [x] Add Overview, Commercial Summary, and Package Health.
- [x] Preserve exact Library focus, dirty-route guard, and Save callback.
- [x] Add component tests for switch, dirty preservation, empty/error/partial
  states, and next-action focus.

Completion:

- [x] Current package data is editable through the workspace.
- [x] Switching packages never saves or discards.
- [x] First-viewport ACs pass at 1440px.

### Phase 3: Progressive Inclusion Selection (3-4 days)

Purpose: Remove permanent candidate matrices without changing stored meaning.

Tasks:

- [x] Show current inclusions grouped by menu/add-on/rental.
- [x] Add searchable, filterable multi-select dialog/sheet.
- [x] Move event type into menu filtering and label its exact semantic boundary.
- [x] Preserve inactive/missing selected references and exact ID arrays.
- [x] Add keyboard, focus restoration, empty/error, duplicate/no-op, and 100-ID
  boundary tests.

Completion:

- [x] Complete candidate catalog is absent from default Includes view.
- [x] Selector changes deep-equal the intended legacy inclusion arrays.

### Phase 4: Persistence Clarity and Responsive Acceptance (2-3 days)

Purpose: Resolve save-state contradiction and complete the MVP interaction.

Tasks:

- [x] Replace duplicate save controls with one in-flow dirty-state action group.
- [x] Add selected-package Revert while preserving whole-catalog save authority.
- [x] Keep every canonical save result visible and testable.
- [x] Move destructive actions behind dependency-aware overflow confirmation.
- [x] Run 390/768/1440 responsive, keyboard, axe, overflow, and route-guard tests.

Completion:

- [x] AC-008 through AC-010 and AC-018 pass locally.
- [x] Maintainer, build, bundle, and documentation gates pass locally.

### Phase 5: Lifecycle Persistence (approval-gated, 2-3 days)

Purpose: Replace active Boolean presentation with accepted lifecycle authority.

Tasks:

- [ ] Resolve legacy active-package migration policy.
- [ ] Extend normalization/read/write contracts with tolerant fallback.
- [ ] Add dry-run migration inventory and rollback plan if backfill is required.
- [ ] Adopt lifecycle in Quote Builder only after local/server tests agree.
- [ ] Update capability contracts, Feature Matrix, and User Manual if backend or
  data authority changes.

Completion:

- [ ] No package availability changes without explicit migration evidence.

### Phase 6: Eligibility, Rules, Preview, and Comparison (separately gated)

Purpose: Add the remaining business-object capabilities in independent slices.

Tasks:

- [ ] Accept eligibility/minimum field definitions with catering operations.
- [ ] Implement and verify package eligibility across client and trusted server.
- [ ] Specify quantity/allowance/substitution rules before adding UI controls.
- [ ] Add customer-safe preview with cost/margin non-leakage tests.
- [ ] Add two-to-four package deterministic comparison.

Completion:

- [ ] Each field is enforced by the same local and authoritative contract.
- [ ] Unsupported concepts remain absent rather than decorative.

### Final Phase: Quality Assurance

- [x] Verify every accepted current-schema MVP criterion; persisted lifecycle
  and later Phase 6 criteria remain gated.
- [x] Run security and customer-safe projection review.
- [x] Run `npm run check:env`.
- [x] Run the appropriate maintainer lane and full build.
- [x] Run focused unit/component/pricing parity suites.
- [x] Run responsive Playwright/axe acceptance.
- [x] Run capability-surface checks; no authority path changed.
- [x] Update `CHANGELOG.md`, `docs/FEATURE_MATRIX.md`, and
  `docs/USER_MANUAL.md` only to the implementation's actual proof level.
- [ ] Complete moderated five-second and inclusion-task operator acceptance.

## Completion Criteria

- [x] Phases 1-4 complete for the current-schema MVP.
- [x] Pricing and persisted write-shape parity passes for all fixtures.
- [x] Required responsive/accessibility checks pass locally.
- [x] Documentation accurately separates source, local browser, hosted,
  production, and human acceptance.
- [ ] Product review approves any Phase 5/6 expansion before implementation.

## Progress Tracking

- Phase 1: Locally complete.
- Phase 2: Locally complete.
- Phase 3: Locally complete.
- Phase 4: Locally complete.
- Phase 5: Approval-gated.
- Phase 6: Separately approval-gated.
- Hosted role, production-data, deployment, and human acceptance: pending.
