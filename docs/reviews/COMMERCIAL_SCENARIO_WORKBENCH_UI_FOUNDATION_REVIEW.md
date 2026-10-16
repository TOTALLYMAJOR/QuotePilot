# Commercial Scenario Workbench — UI Foundation Review Package

Status: **review-only architecture/design contract**

Base SHA: `961e688bb3d651862161599e48264b890a98e8e2`

Purpose: give the final-review agent one bounded contract for reconciling the current repository implementation with the intended interactive Living Commercial Twin / Commercial Scenario Workbench experience. This document does **not** authorize a parallel commercial, staffing, inventory, or fulfillment authority.

## North Star

The workbench must feel like a **commercial experimentation instrument**, not a static consequence report:

`current commitment -> temporary scenario -> bounded consequence recomputation -> commercial + fulfillment + production response -> constraint explanation -> compare -> governed review/apply`

Nothing in the experimentation loop mutates authoritative Commercial, Staffing, or Inventory truth.

---

## 1. Repository reality to preserve

The repository already contains the primary implementation seams. Final review must reconcile and extend them rather than introduce a competing stack.

### Presentation

- `src/components/CommercialScenarioWorkbench.jsx`
  - primary interactive workbench surface;
  - owns presentation orchestration only;
  - consumes scenario state and bounded projections;
  - must remain outside commercial apply authority.
- `src/components/LivingCommercialTwin.jsx`
  - compatibility boundary for the original Twin seam;
  - should continue routing to the workbench rather than regaining separate behavior.
- `src/components/FulfillmentIntelligence.jsx`
  - presentation of already-derived Fulfillment truth;
  - must not acquire reads, calculations, or mutations that belong to domain authorities.
- `src/components/commercialScenarioWorkbench.css`
  - primary visual-system implementation for this surface.
- `src/components/ProposalComposer.jsx`
  - lazy-load/integration boundary into the existing proposal/quote experience.

### Scenario state

- `src/hooks/useCommercialScenarioWorkbench.js`
  - owns session-only scenario state;
  - must remain non-authoritative;
  - current commitment must remain immutable;
  - working scenarios require stable identity/generation/input digest/base revision;
  - cached projection reuse is allowed only when exact scenario identity matches.
- `src/lib/commercialScenarioWorkbench.js`
  - deterministic scenario reducer/request identity;
  - must remain pure and testable;
  - stale or mismatched responses must never replace newer scenario state.

### Cross-domain projection

- `src/lib/livingCommercialTwinProjection.js`
  - composes bounded source evidence into presentation truth;
  - derived, rebuildable, revision-bound, privacy-safe, non-authoritative;
  - must preserve independent completeness/freshness per domain;
  - must never become a universal `event` authority.

### Inventory

- `src/hooks/useEventIngredientProjection.js`
  - bounded inventory/menu event projection source.
- `src/lib/commercialInventoryConsequences.js`
  - commercial-change inventory consequence adapter.
- Inventory recipe/event-demand authority and current Inventory ADR remain authoritative beneath these client seams.
- Scenario preview may calculate projected demand/cost/shortage but must never allocate, receive, consume, or adjust inventory.

### Staffing

- `src/hooks/useFulfillmentStaffingSnapshot.js`
  - bounded staffing snapshot for Fulfillment composition;
  - intentionally decoupled from rapid scenario identity so the staff directory is not reloaded on every keystroke.
- Operational Staffing Authority, schedule fences, assignments, availability, invitations, and receipts remain independent authority.
- Existing staffing counts are copied from exact quote revisions. Do **not** infer future staffing requirements from guest count unless a revisioned authoritative requirement policy exists.
- Current coverage/resilience may be surfaced from valid evidence even when future staffing headroom is unavailable.

### Application orchestration

- `src/App.jsx`
- `src/LegacyApp.jsx`

These currently connect quote/proposal state, scenario preview requests, Inventory consequences, Staffing snapshot, and Twin projection. Final review must avoid duplicating orchestration in leaf UI components.

---

## 2. Dependency graph

```text
Proposal / Quote revision
        |
        +-------------------- Commercial Change preview authority
        |                               |
        |                               v
        |                    bounded commercial consequence
        |
        +-------------------- Inventory authority / projections
        |                               |
        |                               v
        |                    demand / cost / shortage evidence
        |
        +-------------------- Staffing authority / snapshot
                                        |
                                        v
                           coverage / gaps / resilience evidence

scenario session state
        |
        v
Commercial Scenario request identity
        |
        +---- commercial consequence
        +---- inventory consequence
        +---- staffing snapshot
        +---- BEO / dependency consequence
        |
        v
Living Commercial Twin projection
        |
        v
Fulfillment composition
  People + Supply
        |
        v
CommercialScenarioWorkbench UI
        |
        v
governed Commercial Change review/apply boundary
```

Governing rule: **compose truth freely; mutate truth narrowly.**

---

## 3. No new framework dependency is required

Current `package.json` already supplies the needed runtime/test stack:

- React 18 / React DOM;
- Firebase client SDK;
- Vite;
- Vitest + jsdom;
- Playwright + axe;
- existing Firebase emulator tooling.

Do **not** add an animation, state-management, chart, or component framework merely to reproduce the reference UI. Use React state/hooks, existing QuotePilot styling, and CSS transitions. Introduce a dependency only if final review proves a concrete capability cannot be delivered safely with the existing stack.

---

## 4. Intended interaction architecture

### Zone A — Scenario rail

The workbench should make experimentation obvious and safe.

Required capabilities:

- immutable `Current` scenario;
- one or more session-only working scenarios;
- select/switch scenario without page navigation;
- duplicate working scenario;
- direct guest-count input plus accessible increment/decrement controls;
- optional quick-delta controls (`+10`, `+25`, etc.) as convenience only;
- scenario switching restores exact cached projection only when request identity matches;
- no scenario is a quote revision.

Recommended first-slice layout:

```text
SCENARIOS
Current       125 guests
Scenario A    175 guests · constrained
Scenario B    150 guests · covered

+ Duplicate scenario

WORKING SCENARIO
Guests  [-] 175 [+]
```

### Zone B — Living commitment

The center should visually prioritize the object being manipulated:

```text
Current 125 -> Proposed 175

Revenue        $12,480 -> $16,920   +$4,440
Deposit         $3,120 ->  $4,230   +$1,110
Food cost         $800 ->  $1,120     +$320
```

The user should not need a separate report to learn what changed.

### Zone C — Fulfillment / consequence rail

Staffing and Inventory should be presented as one business concept: **Fulfillment**.

```text
FULFILLMENT
1 known constraint

PEOPLE
Coverage       6 / 6
Backups        3 eligible
Resilience     strong
Headroom       unavailable — no revisioned staffing requirement policy

SUPPLY
Chicken        65.6 lb required
Available      59.6 lb
Short           6.0 lb

PRODUCTION
BEO            review required
```

Healthy domains should stay visually quiet. The limiting factor receives emphasis.

---

## 5. Reactivity contract

The UI must feel immediate without moving authority into the browser.

### Local response

Safe presentation state may update synchronously:

- guest-count control;
- current/proposed labels;
- scenario selection;
- loading/recomputing indicator;
- previously exact cached scenario projection when identity still matches.

### Authoritative consequence response

Commercial, Inventory, and other consequential results must continue through their existing bounded preview paths.

Required sequence:

```text
operator input
 -> update session scenario generation
 -> debounce bounded preview request
 -> retain last exact projection visually when useful
 -> request authoritative consequences
 -> reject stale/mismatched response
 -> cache only exact matching response
 -> update projected consequence regions in place
```

### Race-safety invariants

For `125 -> 140 -> 175 -> 160`:

- a response for 140 cannot overwrite 160;
- a response for 175 cannot overwrite 160;
- a cached 175 projection cannot be displayed as exact evidence for 160;
- uncertainty/stale/partial states remain explicit;
- changing scenario must not trigger authoritative writes.

---

## 6. Fulfillment composition contract

Fulfillment is a read model, never authority.

It should compose at minimum:

```text
people:
  required roles/counts when authoritative evidence exists
  assigned counts
  gaps
  eligible backups / resilience where bounded evidence supports them
  staffing headroom only when a revisioned requirement policy supports it
  evidence state / source revision / freshness

supply:
  ingredient demand
  projected ingredient cost
  shortage / available quantity
  inventory headroom only when deterministic evidence supports it
  evidence state / source revision / freshness

overall:
  known constraints
  limiting known domain/resource
  partial/completeness state
  next valid action
```

Do not calculate an overall "ready" state when a relevant domain is unknown.

Do not put private staff data in the Fulfillment projection.

---

## 7. Staffing computation required for this surface

At least one staffing-derived computation must remain visible in the final surface.

### First supported computation: Coverage Resilience

Current repo evidence can support a safer first computation than fabricated guest-count headroom:

- required role count;
- assigned count;
- eligible available unassigned candidates;
- role(s) with zero eligible backup;
- conflicts where current bounded evidence supports them.

Example:

```text
PEOPLE
Coverage          6 / 6
Eligible backups  3
Resilience        Strong
Critical gap      Bartender has 0 replacements
```

Prefer evidence-bearing components over an opaque numerical score.

### Staffing Headroom

Only surface numeric Staffing Headroom after the repository has an explicit revisioned staffing requirement policy capable of converting a scenario variable such as guest count into future role requirements.

Until then:

```text
Staffing headroom
Unavailable
No revisioned guest-count staffing requirement policy exists.
```

This is a capability boundary, not an error.

---

## 8. Inventory behavior required for this surface

Inventory remains the strongest current dynamic Fulfillment constraint.

The UI should surface:

- required ingredient quantity;
- available quantity from bounded current projection;
- shortage quantity;
- projected ingredient-cost delta;
- current recipe/cost evidence state;
- exact explanation of why a scenario created or removed a shortage.

A scenario must never reserve or allocate stock.

Constraint interaction should support:

```text
Chicken breast short 6 lb
[Why did this change?]
```

with an explanation based on guest-count/menu-demand/recipe/cost evidence already supplied by authoritative projections.

---

## 9. Commercial Change dependency

The workbench does not replace Commercial Change Authority.

Required separation:

```text
EXPLORE
scenario workbench

REVIEW
existing governed Commercial Change impact/review

APPLY
existing Commercial Change authority
```

The primary CTA should therefore be `Review commitment` or equivalent, not a direct browser-owned apply mutation.

The current workbench may orchestrate consequence preview, but exact apply remains outside its authority.

---

## 10. BEO / downstream dependency behavior

The workbench may show that a proposed change reaches a BEO dependency or requires freshness review.

It must not state that a BEO is stale/invalid/generated unless exact dependency/artifact evidence supports that claim.

Preferred language when only dependency reach is known:

`BEO review required after apply.`

---

## 11. Visual interaction standard

The surface should feel editorial, computational, and calm.

### Preserve

- QuotePilot warm neutral/editorial direction;
- strong numeric hierarchy;
- generous whitespace;
- current/proposed contrast;
- progressive disclosure;
- clear evidence boundary.

### Avoid

- dashboard KPI-card wall;
- repeated healthy `Exact evidence` pills;
- neon/AI styling;
- motion for decoration;
- dense tables as the primary interaction;
- graph-first navigation;
- equal visual weight for healthy and constrained domains.

### Motion

Use restrained CSS transitions only to communicate causality:

- changed monetary value transitions;
- new constraint entrance;
- affected Fulfillment region receives temporary emphasis;
- unchanged domains remain still;
- respect `prefers-reduced-motion`.

---

## 12. Accessibility dependencies

Final review must verify:

- scenario selector follows keyboard-accessible tab/list semantics;
- arrow/Home/End behavior where tab semantics are used;
- numeric guest control has native input semantics;
- +/- and quick-delta controls remain optional alternatives, not the only input path;
- visible focus;
- no information encoded solely by color;
- evidence/constraint state has textual equivalents;
- recomputation announcements are bounded and do not spam screen readers;
- reduced-motion behavior;
- mobile reading order remains: scenario -> commitment -> major consequence -> fulfillment -> evidence -> review action.

Existing Playwright + axe tooling should be reused.

---

## 13. Performance dependencies

Do not reload broad domain collections on scenario keystrokes.

Required performance characteristics:

- scenario reducer is local/pure;
- preview requests are debounced;
- exact matching scenario results are cached;
- staffing snapshot is independent of rapid guest-count generation unless the underlying staffing identity/evidence actually changes;
- Inventory recomputation is dependency-directed;
- no tenant-wide recipe/staff/inventory scans from the component;
- no new synchronous waterfall between Commercial -> Inventory -> Staffing before any UI can respond;
- preserve current Vite manual-chunk treatment for the workbench/Twin/fulfillment hooks;
- run bundle gate after changes.

No hosted latency claim without hosted evidence.

---

## 14. Database / transaction-flow dependencies

This UX does **not** justify a new universal Fulfillment authority document.

If any materialized read model is added later, it must be:

- derived;
- rebuildable;
- bounded;
- revision-bound;
- source-revision bearing;
- explicitly non-authoritative;
- safe to delete/rebuild without destroying business truth.

Mutations remain narrow:

```text
commercial command -> commercial transaction -> receipt
staffing command    -> staffing transaction    -> receipt
inventory command   -> inventory transaction   -> receipt
```

Do not attempt a cross-domain transaction that changes quote + staff assignments + inventory allocations + BEO + payment together.

Never perform external provider calls inside retryable Firestore transaction callbacks.

---

## 15. Evidence/freshness contract

Every displayed domain needs enough source identity to determine whether its projection is usable for the active scenario.

The surface must distinguish:

- current;
- recomputing;
- stale;
- partial;
- unavailable;
- contradictory/error where applicable.

Healthy evidence should generally recede visually. Exceptions should be prominent.

Missing evidence is not success.

---

## 16. Files expected to change if final review finds gaps

Prefer the smallest safe set from these existing seams:

### Likely UI/state

- `src/components/CommercialScenarioWorkbench.jsx`
- `src/components/commercialScenarioWorkbench.css`
- `src/components/FulfillmentIntelligence.jsx`
- `src/hooks/useCommercialScenarioWorkbench.js`
- `src/lib/commercialScenarioWorkbench.js`
- `src/lib/livingCommercialTwinProjection.js`

### Only if integration evidence requires it

- `src/App.jsx`
- `src/LegacyApp.jsx`
- `src/hooks/useFulfillmentStaffingSnapshot.js`
- `src/hooks/useEventIngredientProjection.js`
- `src/lib/commercialInventoryConsequences.js`

### Do not modify without an authority defect

- operational staffing authority/runtime;
- inventory authority/runtime;
- Commercial Change apply authority;
- Firestore rules/indexes;
- pricing authority.

A visual mismatch is not sufficient reason to modify an authority layer.

---

## 17. Existing validation seams to retain/extend

At minimum reconcile and run the existing focused coverage around:

- `src/lib/__tests__/commercialScenarioWorkbench.test.js`
- `src/hooks/__tests__/useCommercialScenarioWorkbench.test.jsx`
- `src/lib/__tests__/livingCommercialTwinProjection.test.js`
- `src/hooks/__tests__/useFulfillmentStaffingSnapshot.test.jsx`
- `src/components/__tests__/commercialScenarioWorkbench.test.jsx`
- relevant Fulfillment/Inventory component/model tests;
- `e2e/proposal-composer.spec.js`

Then run applicable repository gates:

```bash
npm run plan:task -- <bounded task description>
npm run test:unit
npm run check:capability-surfaces
npm run check:field-states
npm run check:perf:bundle
npm run check:docs:governance
npm run build
```

Run `lane:core` / relevant high-risk or emulator lanes if final implementation changes architecture or authority integration. Do not run Firebase authority emulators merely for CSS-only work unless current repo policy requires them.

---

## 18. Final-review acceptance scenario

Given saved Current = `125 guests` and working scenario = `175 guests`:

1. operator can directly edit working guest count;
2. Current remains immutable;
3. scenario receives stable ID/generation/input digest/base quote revision;
4. UI reacts locally immediately;
5. bounded consequence request is issued after debounce;
6. exact current/proposed revenue/deposit consequence appears only from matching evidence;
7. Inventory demand/cost/shortage updates from matching evidence;
8. Staffing shows current coverage/resilience where evidence supports it;
9. Staffing Headroom remains explicitly unavailable unless revisioned policy supports it;
10. BEO consequence is phrased no stronger than available evidence;
11. changing `175 -> 160` cannot be overwritten by late 175/earlier responses;
12. constraint disappears/reduces if exact 160 projection proves that outcome;
13. duplicate scenario creates independent session-only state;
14. switching scenarios restores exact matching cached projections;
15. comparison remains bounded and does not declare a `best` scenario without an objective function;
16. `Review commitment` routes into existing governed review/apply flow;
17. no inventory allocation, staffing assignment, quote revision, payment, or BEO write occurs during experimentation.

---

## 19. Final-review questions

The reviewing agent should answer explicitly:

1. Does the current workbench already satisfy each acceptance item above? Cite exact files/tests.
2. Where does the current surface still behave like a report rather than an instrument?
3. Are scenario identity and stale-response rejection complete under rapid edits and scenario switching?
4. Is Fulfillment composed from bounded independent authorities without private/stale data leakage?
5. Does Staffing provide useful current coverage/resilience even when future headroom is unavailable?
6. Does Inventory constraint state update without direct authoritative mutation?
7. Is any business computation still occurring in JSX that belongs in a pure projection/reducer?
8. Are any broad reads or sequential waterfalls introduced by the workbench?
9. Is the primary action clearly a transition to governed review rather than direct apply?
10. What is the smallest patch required to close the remaining gap between CURRENT and this intended interaction model?

Final review should return **KEEP / PATCH / BLOCK** per dependency, then patch only verified gaps.

---

## Governing standard

The successful experience is not:

> “QuotePilot generated a detailed impact report.”

It is:

> **“I can safely play with the commercial commitment and watch the business reorganize around my decision.”**

The sophistication must come from deterministic, revision-bound intelligence and interaction quality—not fabricated certainty or a new universal authority.
