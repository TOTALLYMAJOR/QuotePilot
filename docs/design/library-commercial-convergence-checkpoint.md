# Library Commercial Convergence Checkpoint

**Status:** Selected local implementation checkpoint; release environment gate blocked
**Owner:** QuotePilot product and engineering
Last updated: 2026-09-04 21:58:00 CDT
**Candidate base:** `7a139aa530da1ea66b1d86ec8c5190f7475c35e5`
**Visual authority:** selected Option 2 Library composition, with Option 3 restraint

## Outcome

The existing commercial system can support the selected Library experience without a new route, record, draft, pricing path, rule engine, or publishing authority. This checkpoint therefore authorizes presentation convergence only.

The governing hierarchy is:

1. **Offers** — existing Packages presented as the primary sellable configurations.
2. **Components** — Menus, Services/Add-ons, and Rentals used by Offers and quote composition.
3. **Templates** — existing Event Templates presented as reusable commercial starting points.
4. **Pricing & Rules** — the existing selling policy and explanation surfaces.
5. **Before the next quote** — contextual setup evidence, secondary to the Library inventory.

`Your bundle` remains the derived composition of the one quote draft. There is no Bundle record, route, lifecycle, save operation, or pricing authority.

## Actual capability boundary

| Capability | Current source truth | Checkpoint decision |
| --- | --- | --- |
| Offers / Packages | `PackageWorkspace` edits the existing `packages` catalog section, including fixed Menu, Service/Add-on, and Rental inclusions. | Present the section as **Offers** while retaining Package as the catering record type and every existing ID/callback. |
| Configurable Offers | The commercial kernel validates bounded choice groups and the Offer workspace projects recorded groups and their attention state, but the browser does not author them and the quote form does not provide end-to-end native choice selection. | Preserve the read-only projection; do not claim choice-group authoring or selection support in this presentation slice. |
| Quote composition | The current quote draft combines package, menu, services/add-ons, rentals/enhancements, quantities, and calculated pricing. | Preserve the existing `Your bundle` presentation and all pricing/draft authority. |
| Templates | Event Templates carry reusable defaults and commercial metadata through the existing editor. | Promote their starting-point purpose and show only relationships supported by current records. |
| Rules | Configuration Rules are bounded catalog data evaluated by the existing rule path. The ordinary editor leads with derived **WHEN / THEN / WHY** summaries and safe structured controls where a record can be represented without loss. | Retain raw JSON as an advanced recovery source and preserve the same draft, save, and publication path. |
| Pricing | pricing-v2 and immutable price-waterfall evidence exist in the current candidate; the browser remains preview and the server remains authoritative. | Present published/readiness/explanation capability in business language without fabricating a quote-specific waterfall on the Library route. |
| Starter packs | Versioned starter packs seed the same catalog draft and remain subject to review and publication. | Keep them as setup/recovery input, never a primary Library taxonomy or second catalog authority. |
| Revision / publishing | `useCatalogSetupDraft`, the existing save surface, revision fencing, and catalog publication remain authoritative. | Translate default copy to operator outcomes; keep revision/provenance under disclosure and preserve exact recovery behavior. |

## Five-view composition checkpoint

### 1. Desktop Library overview

- Keep the existing five-destination shell unchanged.
- Use one broad Library ledger and one quieter readiness rail at an approximate 67/33 relationship.
- Lead with richer Offer and Template orientation, followed by compact Component and Pricing & Rules rows.
- Keep saved-template disclosure and exact editor handoffs.
- Use one ranked setup action. Do not repeat the same action in the inventory and readiness rail.
- Exclude the explanatory process strip and avoid a dashboard card grid.

### 2. Offer / Package editor

- Retain the existing Package Workspace, catalog draft, selectors, activation guard, dependency review, save bar, and focus restoration.
- Recompose desktop into a compact Offer navigator plus one broad selected-Offer workspace.
- Promote identity, selling price, availability, included components, and the derived next decision.
- Keep the derived margin outcome in the selected Offer summary. Demote detailed cost, contribution, readiness evidence, immutable IDs, and revision/quote-behavior explanation behind secondary hierarchy or disclosure.
- Project recorded choice groups read-only when present. Do not add choice-group authoring, eligibility, bundle quantities, or other unsupported controls.

### 3. Rules and failure / recovery

- Present each supported Configuration Rule as a readable type, condition, and effect summary with its actual enabled state.
- Keep raw JSON available under **Advanced rule source** for administrators who need it.
- Replace default provider implementation language with: what cannot happen, what remains safe, and the next recovery action.
- Keep technical error/provenance details available under disclosure; do not hide a failure or weaken publication truth.

### 4. Mobile Library and editor

- Preserve the same semantic order and commercial hierarchy rather than stacking the former setup center first.
- Keep Offers, Components, Templates, and Pricing & Rules scannable as compact ledger groups.
- Place setup/readiness after the primary inventory, expanded only for unresolved conditions.
- Retain the existing full-screen inclusion picker, 44-pixel targets, focus containment, and exact editor return behavior.

### 5. Sales read-only state

- Let sales inspect the same business objects, commercial relationships, and readiness outcomes.
- Remove repeated disabled administrator actions.
- State the permission boundary once: an administrator manages Library changes.
- Retain role denial at the existing action/route boundary; this checkpoint grants no additional mutation authority.

## Nested commercial-object checkpoint

The selected Library hierarchy continues inside every supporting editor. The
governing order is **object → important summary → primary configuration →
nested groups → advanced/evidence detail**. This is presentation state only:
opening, closing, or switching a group cannot write, publish, reprice, or drop
staged values.

### Offers

- Keep identity, quoting availability, selling price, inclusion summary, and
  the derived next decision visible for the selected Offer.
- Group current inclusions by Menu, Add-ons, and Rentals. The current browser
  does not author native choice groups, so no unsupported Choices model is
  invented.
- Keep the derived margin outcome visible. Place detailed cost/contribution
  evidence, quote behavior, usage evidence, immutable record identity, and
  revision confirmation under secondary or advanced disclosure.
- Inclusion search may use stable IDs internally, but ordinary Offer editing
  leads with business names and categories.

### Components

- Present each Add-on or Rental as a named commercial object rather than a
  spreadsheet row led by its internal ID. Retain the existing managed Menu
  editor and its device-buffer authority.
- Keep business name, sell-by basis, sell price, and quoting availability in
  the primary group. Quantity planning, customer-choice behavior, and internal
  cost evidence are separate nested groups when the existing record supports
  them.
- Keep stable identity under **Technical details**. Existing Offer/Template
  usage remains a visible derived relationship summary; it does not change
  references or create authority.
- On mobile, the object summary stays visible while optional groups remain
  compact; the existing managed-Menu device buffer continues to preserve
  unsaved work.

### Templates

- Keep each starting point independently collapsible. Identity, completeness,
  Event context, starting Offer, duration, and default summaries remain visible
  while its editing groups are collapsed.
- Group editing in this order: **Starting Offer**, **Event context**,
  **Preselected components**, **Service and rental defaults**, **Staffing and
  resource defaults**, **Pricing and policy defaults**, **What remains open**,
  and **Advanced identity and source**. Existing arrays, fields, handlers, and
  unsaved-change semantics remain unchanged.
- Keep partial Menu-inventory evidence beside **Preselected components**. Keep
  only stable ID and true version/source/vertical/starter provenance in
  Advanced; staffing-rate defaults remain with Staffing/resources and payment,
  tax, and season defaults remain with Pricing/policy.
- Warning counts remain visible while groups are collapsed. A requested exact
  field opens its containing group; when that field is unavailable, the editor
  reports and focuses the actual template-summary fallback without changing
  values.

### Rules

- Lead with each rule's actual **WHEN**, **THEN**, and **WHY** projection and
  enabled state. Multiple current `conditions` retain their existing
  conjunctive meaning; this checkpoint does not invent an OR/grouping model.
- Keep the raw configuration-rule source under **Advanced rule source** and
  open it automatically when its JSON is invalid or a record cannot be
  represented safely by the structured editor.
- Existing guided-selling recommendation controls retain their exact fields and
  handlers, but appear as policy detail rather than a wall of ordinary inputs.

### Pricing

- Keep Pricing readiness and publication consequence visible first.
- Group normal settings as **Base pricing** (standard staffing sell rates and
  charge mode), **Adjustments & context** (travel, quote validity, seasonal
  default, and capacity), **Fees**, **Tax**, and **Deposit**. Evidence gaps
  remain visible without making every cost field primary.
- Keep cost/margin evidence, guided recommendations, workspace access, proposal
  details, customer-system connection, brand, integration controls, raw
  technical sources, and revision provenance under **Advanced policy**. Keep
  ordinary commercial defaults in their normal groups.
- The price-waterfall statement remains explanation/output about the current
  authority. It is not duplicated as editable pricing state.

### Nested acceptance

1. No major Library editor is one uninterrupted form.
2. Nested commercial structure is grouped by business meaning.
3. Attention remains visible while a relevant group is collapsed.
4. Advanced identity, provenance, revision, and technical metadata remain
   visually subordinate to ordinary business configuration.
5. Existing nested values and callbacks are preserved exactly.
6. Disclosure navigation introduces no catalog, quote, or pricing authority.
7. Switching groups preserves staged unsaved changes.
8. Mobile presents compact object/group flows instead of stacking every desktop
   group open.
9. Structured Rules remain the normal path; raw JSON is advanced detail.
10. Offer constraints are described only to the degree the existing browser
    contract actually supports them.

## Change ledger

| Classification | Presentation change | Authority retained |
| --- | --- | --- |
| REUSE | Existing Library route, catalog section IDs, Event Template editor, Package Workspace, draft/save/revision flow, role checks, and deep-link/return contracts. | Current route, catalog, template, role, and persistence authorities. |
| RECLASSIFY | Packages under Offers; Menu, Add-ons/Services, and Rentals under Components; Event Templates under Templates; Pricing and Rules under commercial policy. | Persisted names, schemas, IDs, callbacks, and pricing behavior. |
| EXTEND | Add a pure overview hierarchy, compact readiness presentation, readable rule summaries, operator-level recovery copy, and supporting responsive states. | Existing models remain the source of all counts, status, and actions. |
| PRESENTATION-RETIRE | Full-width setup center, repeated `Review` actions, permanent Package health rail, raw JSON as the default Rules experience, and default infrastructure language. | No capability, route, recovery action, or evidence state is retired. |

## Acceptance boundary

Local implementation acceptance requires real 390, 768, and 1440 pixel
captures, a same-viewport comparison beside the selected desktop source,
focused component/browser tests, and documentation that labels the result as an
unpushed local candidate rather than hosted or production proof. The evidence
below satisfies that local boundary; the environment-dependent release gate and
all external evidence remain open.

### Final local evidence

- **Candidate base:** `7a139aa530da1ea66b1d86ec8c5190f7475c35e5`.
- **Implementation commit:**
  `b593fe4d2c45ff5db20bafe205461157952b9ab4`; the captures below render that
  exact source.
- **Worktree:** `/home/administrator/projects_new/quoteflow-ux-convergence`.
- **Responsive captures:** `output/playwright/ambient-intelligence-current/ambient-library-390.png`, `ambient-library-768.png`, and `ambient-library-1440.png`; nested editor captures in the same directory cover Offers, Components, Templates, Rules, and Pricing at their applicable 390/768/1440 widths.
- **Selected-design comparison:** `output/playwright/ambient-intelligence-current/ambient-library-comparison-2974x1058.png`; nested combined comparisons are `nested-comparison-offer.png`, `nested-comparison-rules.png`, `nested-comparison-pricing.png`, and `nested-comparison-template-mobile.png`.
- **Focused browser tests:** `e2e/ambient-library.spec.js` — 17/17 local Chromium cases.
- **Calm Four regression:** `VITE_OPERATIONAL_STAFFING_ENABLED=true` with `e2e/v16-calm-four-acceptance.spec.js` — 10/10 local Chromium cases.
- **Visual review:** **9.5/10 — GO** after inspecting the exact responsive captures and combined comparisons. Text remains the semantic authority for status and action; right-rail icons are supplemental, and ordinary rendered text has a 12px minimum.
- **Local qualification:** `npm run test:unit` passes 4,543 tests with 80
  intentional skips; production build, capability-surface governance,
  documentation governance, local CWV, Ambient Library 17/17, Calm Four 10/10,
  and both exact CI-profile bundle checks pass. The temporary bundle exception
  is pinned without future-growth headroom to 3,379,162 / 397,409 bytes for
  compatibility and 4,301,701 / 432,490 bytes for Ambient. The isolated
  checkout lacks the six Firebase web configuration values required by
  `check:env`, so `lane:release:cwv` remains environment-blocked rather than
  being reported as a complete release qualification.
- **External boundary:** The candidate remains local and unpushed. No exact-head CI, hosted role, production-data, deployment, assistive-technology, or human-acceptance result is claimed.
