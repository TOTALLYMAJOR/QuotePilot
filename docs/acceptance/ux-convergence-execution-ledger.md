# QuotePilot UX Convergence Execution Evidence Ledger

Last updated: 2026-09-04 12:55:44 CDT

## Authority

This ledger implements and measures the frozen contract; it does not replace,
summarize away, or redefine it. The repository copy is
`artifacts/ux-convergence/UX_CONVERGENCE_CONTRACT_FROZEN.md`. Its text is the
user-supplied contract normalized only from CRLF to repository LF line endings.
The supplied-file SHA-256 is
`c4ee957f86a3f66879e41d170515642e7932094475f1ac53de875a6bb1dcc857`;
the LF-normalized repository-copy SHA-256 is
`7d8e84441aaed7b2b3d8b5e3696f977b0cdbda2a1ac4ab5f4eea2052feabab19`.

Verdicts are evidence records only. A ledger row cannot change an acceptance
claim. `PASS`, `FAIL`, `UNVERIFIABLE`, `TRANSITIONAL`, and `PENDING`
retain their ordinary meanings. Source, local automated, local browser, CI,
hosted, provider, production, assistive-technology, and human evidence remain
separate.

## Implementation classification

| Classification | Repository decision |
|---|---|
| REUSE | `ProposalComposer`, its shared App-owned form and handlers, Guided mode, Quote Pulse calculations, current editors, client Preview, saved proposal/PDF/portal continuations, `EventScheduleView`, quote/event projection, conflict/capacity models, staffing and production controls, run of show, routes, and role gates. |
| EXTEND | Proposal Composer presentation model and domain focus; Quote Pulse presentation hierarchy; optional Event Schedule framing and continuation callbacks; existing exact-arrival Schedule destination. |
| MOVE | The existing Calendar presentation becomes the content of `/app/operations`; Schedule arrival targets move to Operations while `/app/schedule` remains a compatibility route. |
| COMPOSE | Event, Customer, Experience, Staffing, and Commercials compose one proposal document; People and Reporting remain role-safe Operations continuations. |
| RETIRE | No user capability or navigation entry at contract checkpoint. The old Operations switchboard presentation may leave the route only because every capability entry remains independently reachable. Navigation retirement requires the separate role-aware parity gate. |
| NEW | Pure workbench outputs, mobile agenda presentation derived from existing models, stable evidence markers, focused Workbench/Operations browser suites, and this ledger. No business-state, pricing, persistence, lifecycle, staffing, catalog, provider, or Firebase authority is new. |

## Repository corrections

- The frozen contract describes intended convergence; current source begins
  with Calm Four plus a secondary Operations switchboard and a separate
  `/app/schedule` calendar route.
- Schedule exact-arrival already has a bounded focus contract. Convergence
  changes its destination path to `/app/operations` and retains the same
  `schedule` surface/focus object.
- `EventScheduleView` already owns the accepted/booked event projection,
  conflict and capacity reasoning, staff-lead mutation, production checklist,
  kitchen checkpoints, and run-of-show. No second engine is authorized.
- The Proposal Composer already owns client Preview and all editor/save
  callbacks; Workbench domain state is session-only presentation.
- Current roles are administrator and sales for authenticated staff surfaces.
  No navigation retirement is permitted until the recorded role matrix proves
  allowed, denied, direct-route, and Back/Forward behavior.

## Promotion and retirement gates

- Operations surface candidate: exact-SHA local browser and visual evidence is
  PASS at pushed candidate `30b6fcd48aa881d83150149eeb942e2d07dd89f8`;
  exact-head CI remains FAIL because runs `33901254618` and `33901478188`
  stopped on successively discovered governance omissions and run
  `33902068474` stopped on the prior compatibility bundle ceiling after all
  unit, build, capability, and docs checks passed. Calm Four remains unchanged.
  The exact measured 1,120-byte ceiling correction is committed at local-only
  SHA `2b2b54b44324fcdc5e07a3cec502b6a6f78ec8a3` and is intentionally unpushed
  by user instruction, so it has no qualifying exact-head CI evidence. The
  complete local `lane:release:cwv` passes against that correction, including
  4,472 unit tests, build, governance, bundle, Truth Loop, and Lighthouse CWV.
- Fifth-primary promotion: CLOSED until every named critical Operations item
  is PASS at the exact candidate SHA.
- Navigation retirement: CLOSED. Every current Workflow, Messages, Events,
  Schedule, Staff, Reporting, Integrations, Import, Diagnostics, Clear the Deck,
  and Library entry remains reachable; unproven convergence stays Transitional.

## AC evidence rows

| ID | Frozen claim | Verdict | Evidence |
|---|---|---|---|
| AC-001 | AC-001 — ProposalComposer remains canonical | PASS | `src/components/ProposalComposer.jsx` is the evolved Workbench; no second builder was added. |
| AC-002 | AC-002 — One form state | PASS | App still passes one `form` object to Workbench and Guided; `e2e/ux-convergence-workbench.spec.js` proves a customer edit survives mode switching. |
| AC-003 | AC-003 — One pricing authority | PASS | Workbench consumes existing `totals` and `calculateQuote`; no pricing module or persisted pricing state was added. |
| AC-004 | AC-004 — One Menu state | PASS | Experience reuses the existing Menu editor, selections, and callbacks in `ProposalComposer`. |
| AC-005 | AC-005 — One staffing model | PASS | Workbench reuses `buildStaffingRecommendation` and existing explicit apply callback. |
| AC-006 | AC-006 — One blocker/readiness model | PASS | Domain state derives from existing completeness and `saveBlockers`; no second readiness authority is persisted. |
| AC-007 | AC-007 — One save path | PASS | The unchanged App `handleSubmitQuote` callback remains the only Workbench/Guided save authority. |
| AC-008 | AC-008 — Guided shares form state | PASS | Real-route Workbench test proves the same client value in Guided and after returning to Workbench. |
| AC-009 | AC-009 — One AI mutation path | PASS | Pilot command wiring was not duplicated or moved; full unit suite passes 4,472 tests. |
| AC-010 | AC-010 — New components presentation-only | PASS | `buildCommercialWorkbenchModel` returns derived domain outputs only; no write/network API is present. |
| AC-011 | AC-011 — Domain switching is non-mutating | PASS | `openDomain` changes presentation focus/editor visibility only; focused model tests and source inspection pass. |
| AC-012 | AC-012 — Unsaved Event edits survive context switching | PENDING | No evidence recorded at contract checkpoint. |
| AC-013 | AC-013 — Menu state survives context switching | PENDING | No evidence recorded at contract checkpoint. |
| AC-014 | AC-014 — Scenario inspection does not silently mutate quote | PENDING | No evidence recorded at contract checkpoint. |
| AC-015 | AC-015 — Guided ↔ Workbench preserves all supported unsaved state | PASS | `e2e/ux-convergence-workbench.spec.js` exercises Workbench → Guided → Workbench with the same unsaved value. |
| AC-016 | AC-016 — Existing quote identity/version semantics preserved | PASS | Updated Proposal Composer regression reopens a saved quote through the existing collection and verifies change-impact editing. |
| AC-017 | AC-017 — Desktop clearly communicates Quote Plan / Living Object / Commercial Truth | PASS | 1440px real-route test asserts all three stable regions; exact labels and markers are in `ProposalComposer`. |
| AC-018 | AC-018 — One major domain active at a time | PASS | `data-active-domain` and scoped CSS expose one detailed domain body at a time. |
| AC-019 | AC-019 — Normal screen does not expose every detailed domain simultaneously | PASS | Real-route test confirms inactive Customer detail is hidden while Event is active. |
| AC-020 | AC-020 — First desktop viewport reveals: | PENDING | No evidence recorded at contract checkpoint. |
| AC-021 | AC-021 — Density reduction is not accomplished by simply wrapping everything in more cards | PENDING | No evidence recorded at contract checkpoint. |
| AC-022 | AC-022 — Exactly five primary composition domains unless repository evidence justifies a change | PASS | Workbench test asserts Event, Customer, Experience, Staffing, and Commercials. |
| AC-023 | AC-023 — Current domain is visible without relying only on color | PASS | Active domain exposes `aria-current="step"` and textual Ready/Review/blocker state. |
| AC-024 | AC-024 — Domain status markers are evidence-backed | PASS | Pure model tests cover status/summary derivation from completeness, blockers, form, totals, and staffing. |
| AC-025 | AC-025 — Exact blockers focus the correct domain where possible | PASS | Pure blocker-target tests cover field domains and Commercials fallback for non-field authority blockers. |
| AC-026 | AC-026 — Every domain keyboard reachable | PASS | Domains are native buttons in a named navigation landmark. |
| AC-027 | AC-027 — Event first presents readable summary | PENDING | No evidence recorded at contract checkpoint. |
| AC-028 | AC-028 — Existing validation retained | PENDING | No evidence recorded at contract checkpoint. |
| AC-029 | AC-029 — Price-affecting Event changes update through existing pricing path | PENDING | No evidence recorded at contract checkpoint. |
| AC-030 | AC-030 — Customer fields round-trip unchanged | PENDING | No evidence recorded at contract checkpoint. |
| AC-031 | AC-031 — Missing/invalid email remains exact blocker | PENDING | No evidence recorded at contract checkpoint. |
| AC-032 | AC-032 — Missing identity is not fabricated | PENDING | No evidence recorded at contract checkpoint. |
| AC-033 | AC-033 — Package, Service style, Menu, Rentals and Enhancements are organized under Experience | PASS | Real-route Experience test asserts all five existing capability triggers in the active domain. |
| AC-034 | AC-034 — Package semantics unchanged | PENDING | No evidence recorded at contract checkpoint. |
| AC-035 | AC-035 — Service-style semantics unchanged | PENDING | No evidence recorded at contract checkpoint. |
| AC-036 | AC-036 — Closed Menu presents meaningful summary | PENDING | No evidence recorded at contract checkpoint. |
| AC-037 | AC-037 — Detailed Menu only opens intentionally | PENDING | No evidence recorded at contract checkpoint. |
| AC-038 | AC-038 — Existing Menu functionality retained | PENDING | No evidence recorded at contract checkpoint. |
| AC-039 | AC-039 — Menu close restores Experience context and focus | PENDING | No evidence recorded at contract checkpoint. |
| AC-040 | AC-040 — Realistically long Menu remains usable | PENDING | No evidence recorded at contract checkpoint. |
| AC-041 | AC-041 — Current and recommended staffing visibly distinct | PENDING | No evidence recorded at contract checkpoint. |
| AC-042 | AC-042 — No silent recommendation application | PENDING | No evidence recorded at contract checkpoint. |
| AC-043 | AC-043 — Existing staffing financial consequence retained | PENDING | No evidence recorded at contract checkpoint. |
| AC-044 | AC-044 — Existing Rentals capability retained | PENDING | No evidence recorded at contract checkpoint. |
| AC-045 | AC-045 — Rental suggestions remain explicit proposals | PENDING | No evidence recorded at contract checkpoint. |
| AC-046 | AC-046 — Existing Enhancements capability retained | PENDING | No evidence recorded at contract checkpoint. |
| AC-047 | AC-047 — Total remains discoverable while editing any desktop domain | PASS | 1440px Workbench keeps Commercial Truth visible and asserts the existing `pc-pulse-total`. |
| AC-048 | AC-048 — Deposit remains discoverable | PASS | Existing pulse deposit remains directly below the canonical total; full component/unit regressions pass. |
| AC-049 | AC-049 — Rail total originates from canonical totals | PASS | Commercial Truth reuses the prior pulse model and `totals`; no alternate calculation was introduced. |
| AC-050 | AC-050 — Per-guest value fails safely when inputs invalid | PENDING | No evidence recorded at contract checkpoint. |
| AC-051 | AC-051 — Margin remains properly gated | PENDING | No evidence recorded at contract checkpoint. |
| AC-052 | AC-052 — Healthy margin evidence compresses | PENDING | No evidence recorded at contract checkpoint. |
| AC-053 | AC-053 — Margin uncertainty expands | PENDING | No evidence recorded at contract checkpoint. |
| AC-054 | AC-054 — Blocker count exact | PENDING | No evidence recorded at contract checkpoint. |
| AC-055 | AC-055 — Exact blocker reasons retained | PENDING | No evidence recorded at contract checkpoint. |
| AC-056 | AC-056 — Review blockers never saves/mutates by itself | PENDING | No evidence recorded at contract checkpoint. |
| AC-057 | AC-057 — Blocked save cannot be bypassed by alternative workbench control | PENDING | No evidence recorded at contract checkpoint. |
| AC-058 | AC-058 — Special existing blockers remain enforceable | PENDING | No evidence recorded at contract checkpoint. |
| AC-059 | AC-059 — Guest changes preserve before/after consequence view | PENDING | No evidence recorded at contract checkpoint. |
| AC-060 | AC-060 — Automatic pricing versus recommendations versus unchanged state clearly distinguished | PENDING | No evidence recorded at contract checkpoint. |
| AC-061 | AC-061 — Existing explicit Apply / Keep / Undo outcomes retained where currently supported | PENDING | No evidence recorded at contract checkpoint. |
| AC-062 | AC-062 — Pilot remains reachable | PENDING | No evidence recorded at contract checkpoint. |
| AC-063 | AC-063 — AI changes inspectable before governed commit | PENDING | No evidence recorded at contract checkpoint. |
| AC-064 | AC-064 — AI cannot bypass ordinary blockers/authority | PENDING | No evidence recorded at contract checkpoint. |
| AC-065 | AC-065 — Idle Pilot footprint is restrained | PENDING | No evidence recorded at contract checkpoint. |
| AC-066 | AC-066 — Existing Compare Scenarios remains available | PENDING | No evidence recorded at contract checkpoint. |
| AC-067 | AC-067 — Scenario detail is contextual rather than permanently expanded | PENDING | No evidence recorded at contract checkpoint. |
| AC-068 | AC-068 — Internal-only evidence excluded | PASS | Workbench browser test opens client Preview and asserts no margin, blocker, or staff-only copy. |
| AC-069 | AC-069 — Unsaved preview remains honestly labelled | PENDING | No evidence recorded at contract checkpoint. |
| AC-070 | AC-070 — Preview focus management preserved | PENDING | No evidence recorded at contract checkpoint. |
| AC-071 | AC-071 — Guided uses same form state | PASS | Real-route shared-value test passes. |
| AC-072 | AC-072 — Guided behavior retained | PASS | Legacy Proposal Composer regression enters the existing wizard and returns. |
| AC-073 | AC-073 — Supported flag-off/rollback path remains coherent if still required | PASS | Default Playwright lane remains flag-off and the full 4,472-test unit suite is green. |
| AC-074 | AC-074 — No dual canonical editor | PASS | Workbench is implemented inside `ProposalComposer`; Guided remains an alternate mode over the same form. |
| AC-075 | AC-075 — Save state labels truthful | PENDING | No evidence recorded at contract checkpoint. |
| AC-076 | AC-076 — No accidental continuous autosave introduced | PENDING | No evidence recorded at contract checkpoint. |
| AC-077 | AC-077 — Firebase authoritative pricing remains intact | PENDING | No evidence recorded at contract checkpoint. |
| AC-078 | AC-078 — Version behavior remains intact | PENDING | No evidence recorded at contract checkpoint. |
| AC-079 | AC-079 — UI presents saved success only from real successful save state | PENDING | No evidence recorded at contract checkpoint. |
| AC-080 | AC-080 — Failed save preserves unsaved work where current architecture permits | PENDING | No evidence recorded at contract checkpoint. |
| AC-081 | AC-081 — Advanced pricing collapsed by default | PENDING | No evidence recorded at contract checkpoint. |
| AC-082 | AC-082 — Existing advanced pricing capabilities retained | PENDING | No evidence recorded at contract checkpoint. |
| AC-083 | AC-083 — Unsupported arbitrary per-quote price override remains absent | PENDING | No evidence recorded at contract checkpoint. |
| AC-084 | AC-084 — Activity remains inspectable | PASS | Updated browser regression opens the activity toggle and verifies session changes. |
| AC-085 | AC-085 — Activity secondary while healthy | PASS | Activity now starts collapsed and remains available through its existing toggle. |
| AC-086 | AC-086 — Actionable recovery evidence may promote through Attention | PENDING | No evidence recorded at contract checkpoint. |
| AC-087 | AC-087 — 1440px workbench intentionally uses desktop hierarchy | PASS | Dedicated 1440px Workbench Playwright case passes. |
| AC-088 | AC-088 — 768px adaptation has no horizontal document overflow | PASS | Dedicated 768px Workbench Playwright case asserts no page overflow. |
| AC-089 | AC-089 — 390px uses intentional mobile composition, not squeezed desktop columns | PASS | Dedicated 390px Workbench case exercises horizontal Quote Plan plus modal Commercial Truth. |
| AC-090 | AC-090 — Mobile total/attention remains readily discoverable | PASS | Existing mobile regression opens `Review quote` and verifies Commercial Truth visibility. |
| AC-091 | AC-091 — Mobile controls preserve current minimum touch-target contract | PENDING | No evidence recorded at contract checkpoint. |
| AC-092 | AC-092 — Long Menu fully usable at 390px | PENDING | No evidence recorded at contract checkpoint. |
| AC-093 | AC-093 — No accidental nested-scroll trap | PENDING | No evidence recorded at contract checkpoint. |
| AC-094 | AC-094 — Major regions have semantic/accessible names | PENDING | No evidence recorded at contract checkpoint. |
| AC-095 | AC-095 — Heading hierarchy valid | PENDING | No evidence recorded at contract checkpoint. |
| AC-096 | AC-096 — Selected/current/attention state not color-only | PENDING | No evidence recorded at contract checkpoint. |
| AC-097 | AC-097 — Visible keyboard focus | PENDING | No evidence recorded at contract checkpoint. |
| AC-098 | AC-098 — Focus returns after closing Menu/Preview/Scenario/context | PENDING | No evidence recorded at contract checkpoint. |
| AC-099 | AC-099 — Field errors remain associated with controls | PENDING | No evidence recorded at contract checkpoint. |
| AC-100 | AC-100 — Reduced-motion respected | PENDING | No evidence recorded at contract checkpoint. |
| AC-101 | AC-101 — Zero new serious/critical axe violations | PASS | Workbench Playwright axe checks pass at 390, 768, and 1440. |
| AC-102 | AC-102 — Blank quote looks intentionally structured | PENDING | No evidence recorded at contract checkpoint. |
| AC-103 | AC-103 — Dense quote no longer renders as one giant continuous document | PENDING | No evidence recorded at contract checkpoint. |
| AC-104 | AC-104 — Long names do not collide/clip | PENDING | No evidence recorded at contract checkpoint. |
| AC-105 | AC-105 — Dense Menu remains readable when deliberately opened | PENDING | No evidence recorded at contract checkpoint. |
| AC-106 | AC-106 — Important warning outranks routine metadata | PENDING | No evidence recorded at contract checkpoint. |
| AC-107 | AC-107 — Total remains visually prominent | PENDING | No evidence recorded at contract checkpoint. |
| AC-108 | AC-108 — Workbench looks like evolved QuotePilot, not a separate design system | PENDING | No evidence recorded at contract checkpoint. |
| AC-109 | AC-109 — Bundle budget passes or any exception is explicitly justified | PASS | Local `check:perf:bundle` passes against an exact 3,311,120-byte temporary ceiling; the 1,120-byte CI delta is documented with no percentage headroom. |
| AC-110 | AC-110 — Existing useful lazy boundaries retained | PENDING | No evidence recorded at contract checkpoint. |
| AC-111 | AC-111 — Domain switching causes no unnecessary persistence/network work | PENDING | No evidence recorded at contract checkpoint. |
| AC-112 | AC-112 — Material LOC overrun triggers architecture review | PENDING | No evidence recorded at contract checkpoint. |
| AC-113 | AC-113 — Major unexpected implementation-scale increase requires explicit explanation before continuation | PENDING | No evidence recorded at contract checkpoint. |
| AC-114 | AC-114 — Operations menu is no longer an undifferentiated 10+ item feature inventory | PASS | `/app/operations` renders `EventScheduleView` directly with only role-gated People and Reporting continuations. |
| AC-115 | AC-115 — Daily execution has one obvious operational entry | PENDING | No evidence recorded at contract checkpoint. |
| AC-116 | AC-116 — Calendar/Schedule is reused rather than replaced | PASS | Both `/app/operations` and compatibility `/app/schedule` render the existing `EventScheduleView`. |
| AC-117 | AC-117 — Operations is organized around time/execution rather than repository modules | PENDING | No evidence recorded at contract checkpoint. |
| AC-118 | AC-118 — Routes may remain available without all remaining permanent navigation entries | PENDING | No evidence recorded at contract checkpoint. |
| AC-119 | AC-119 — Calendar is the default operational lens when current capability supports it | PASS | Operations route composition opens directly on Calendar. |
| AC-120 | AC-120 — Existing Month view retained | PASS | Operations browser suite asserts the existing Month control at all target widths. |
| AC-121 | AC-121 — Existing Week view retained | PASS | Operations browser suite asserts the existing Week control at all target widths. |
| AC-122 | AC-122 — Accepted/booked events remain correctly projected | PASS | Same-model browser fixture renders one booked and one accepted event without a new projection. |
| AC-123 | AC-123 — Existing conflict detection retained | PASS | Existing overlap/capacity indicators render from `buildConflictInsights`; full schedule/unit regression is green. |
| AC-124 | AC-124 — Time overlap detection retained | PASS | Two overlapping exact-time fixtures render textual Time overlap indicators. |
| AC-125 | AC-125 — Unknown-time warnings retained | PASS | No conflict algorithm changed; full 4,472-test suite includes existing schedule semantics. |
| AC-126 | AC-126 — Capacity-conflict logic retained | PASS | 480 combined guests against the 400 threshold render textual Capacity risk. |
| AC-127 | AC-127 — Staff-lead assignment remains available under existing authority | PASS | Existing `handleAssignStaff` and select remain inside reused event cards; no authority code changed. |
| AC-128 | AC-128 — Production checklist remains available | PASS | Existing checklist component remains mounted in reused event cards; full unit regression passes. |
| AC-129 | AC-129 — Existing kitchen/run-of-show planning context remains available where currently supported | PASS | Exact screenshots and browser surface retain Run of show; existing kitchen/checklist code remains unchanged. |
| AC-130 | AC-130 — Calendar does not claim live telemetry that does not exist | PASS | Visible source note explicitly labels read-only planning and rejects attendance/inventory/readiness inference. |
| AC-131 | AC-131 — Events and Schedule are not presented as two confusing equal event indexes without a documented reason | PENDING | No evidence recorded at contract checkpoint. |
| AC-132 | AC-132 — Calendar event opens exact existing event/opportunity identity | PASS | Operations Playwright opens exact `operations-event-a` and verifies its Opportunity heading. |
| AC-133 | AC-133 — No duplicate Event record introduced | PASS | Calendar still derives from quote history; no Firestore schema, entity, or write path was added. |
| AC-134 | AC-134 — Exact Event routes remain functional for direct/deep arrival | PENDING | No evidence recorded at contract checkpoint. |
| AC-135 | AC-135 — Event Focus remains available where supported | PENDING | No evidence recorded at contract checkpoint. |
| AC-136 | AC-136 — Existing Workflow authority remains unchanged | PENDING | No evidence recorded at contract checkpoint. |
| AC-137 | AC-137 — Now can continue to deep-link exact Workflow attention | PENDING | No evidence recorded at contract checkpoint. |
| AC-138 | AC-138 — Opportunity can continue to deep-link exact Workflow attention | PENDING | No evidence recorded at contract checkpoint. |
| AC-139 | AC-139 — Removing/demoting a menu entry does not make Workflow unreachable | PENDING | No evidence recorded at contract checkpoint. |
| AC-140 | AC-140 — Bulk/global Workflow route remains available if supported use cases require it | PENDING | No evidence recorded at contract checkpoint. |
| AC-141 | AC-141 — Existing conversation/message capability preserved | PENDING | No evidence recorded at contract checkpoint. |
| AC-142 | AC-142 — Opportunity-context conversation remains reachable | PENDING | No evidence recorded at contract checkpoint. |
| AC-143 | AC-143 — Client-context conversation remains reachable where supported | PENDING | No evidence recorded at contract checkpoint. |
| AC-144 | AC-144 — Global Messages remains available where aggregate review is required | PENDING | No evidence recorded at contract checkpoint. |
| AC-145 | AC-145 — Messaging is not duplicated inside Operations merely for navigation convenience | PENDING | No evidence recorded at contract checkpoint. |
| AC-146 | AC-146 — Pilot remains globally reachable according to current capability design | PENDING | No evidence recorded at contract checkpoint. |
| AC-147 | AC-147 — Pilot is not architecturally owned by Operations | PENDING | No evidence recorded at contract checkpoint. |
| AC-148 | AC-148 — No second Operations-specific Pilot implementation | PENDING | No evidence recorded at contract checkpoint. |
| AC-149 | AC-149 — Clear the Deck behavior preserved | PENDING | No evidence recorded at contract checkpoint. |
| AC-150 | AC-150 — Clear the Deck remains reachable from appropriate attention context | PENDING | No evidence recorded at contract checkpoint. |
| AC-151 | AC-151 — It is not treated as an independent operational data authority | PENDING | No evidence recorded at contract checkpoint. |
| AC-152 | AC-152 — Existing Staff capability preserved | PENDING | No evidence recorded at contract checkpoint. |
| AC-153 | AC-153 — Calendar may link to Staff without rebuilding Staff | PENDING | No evidence recorded at contract checkpoint. |
| AC-154 | AC-154 — Staff private/role authority unchanged | PASS | People continuation is shown only under the existing admin and staffing-feature gates; staffing authority code is unchanged. |
| AC-155 | AC-155 — Existing Reporting preserved | PENDING | No evidence recorded at contract checkpoint. |
| AC-156 | AC-156 — Reporting no longer competes visually with primary operational execution unless evidence justifies it | PENDING | No evidence recorded at contract checkpoint. |
| AC-157 | AC-157 — Reporting remains reachable through secondary/admin/Insights path | PENDING | No evidence recorded at contract checkpoint. |
| AC-158 | AC-158 — Integrations Ops preserved | PENDING | No evidence recorded at contract checkpoint. |
| AC-159 | AC-159 — Import Studio preserved | PENDING | No evidence recorded at contract checkpoint. |
| AC-160 | AC-160 — Diagnostics preserved | PENDING | No evidence recorded at contract checkpoint. |
| AC-161 | AC-161 — Moving these out of Operations does not remove authority or reachability | PENDING | No evidence recorded at contract checkpoint. |
| AC-162 | AC-162 — Administrative tools are distinguishable from daily operator work | PENDING | No evidence recorded at contract checkpoint. |
| AC-163 | AC-163 — Catalog administration remains preserved | PENDING | No evidence recorded at contract checkpoint. |
| AC-164 | AC-164 — Ambient Library remains or becomes the conceptual home for business-building-block configuration where current IA supports it | PENDING | No evidence recorded at contract checkpoint. |
| AC-165 | AC-165 — Catalog is not redundantly surfaced under Operations without documented need | PENDING | No evidence recorded at contract checkpoint. |
| AC-166 | AC-166 — Now may show compact upcoming operational horizon | PENDING | No evidence recorded at contract checkpoint. |
| AC-167 | AC-167 — Now does not duplicate full Calendar | PENDING | No evidence recorded at contract checkpoint. |
| AC-168 | AC-168 — Upcoming event can navigate to exact Calendar/Event context | PENDING | No evidence recorded at contract checkpoint. |
| AC-169 | AC-169 — Conflict/attention language shown in Now is evidence-backed | PENDING | No evidence recorded at contract checkpoint. |
| AC-170 | AC-170 — Accepted/booked Opportunity can open operational Calendar/Event context | PENDING | No evidence recorded at contract checkpoint. |
| AC-171 | AC-171 — Commercial and operational contexts retain same exact opportunity/event identity | PENDING | No evidence recorded at contract checkpoint. |
| AC-172 | AC-172 — Transition introduces no duplicate persisted Event entity unless one already exists authoritatively | PASS | Implementation adds presentation callbacks/markers only and retains quote-history projection. |
| AC-173 | AC-173 — Planning state explicitly distinguished from live actuals | PASS | Run-of-show copy identifies a read-only projection and states which live actuals it cannot establish. |
| AC-174 | AC-174 — No current-stage claim without authoritative state | PENDING | No evidence recorded at contract checkpoint. |
| AC-175 | AC-175 — No live issue claim without issue records | PENDING | No evidence recorded at contract checkpoint. |
| AC-176 | AC-176 — No staff check-in claim without authoritative check-in data | PENDING | No evidence recorded at contract checkpoint. |
| AC-177 | AC-177 — No Replay claim without immutable operational evidence | PENDING | No evidence recorded at contract checkpoint. |
| AC-178 | AC-178 — Primary navigation remains intentionally small | PENDING | No evidence recorded at contract checkpoint. |
| AC-179 | AC-179 — New Quote remains a global action rather than a permanent content destination if current design supports this | PENDING | No evidence recorded at contract checkpoint. |
| AC-180 | AC-180 — Search remains global/secondary | PENDING | No evidence recorded at contract checkpoint. |
| AC-181 | AC-181 — Pilot remains global/secondary | PENDING | No evidence recorded at contract checkpoint. |
| AC-182 | AC-182 — System/Admin capabilities do not inflate primary navigation | PENDING | No evidence recorded at contract checkpoint. |
| AC-183 | AC-183 — Mobile navigation remains focused and accessible | PENDING | No evidence recorded at contract checkpoint. |
| AC-184 | AC-184 — Canonical quote composition surface documented | PENDING | No evidence recorded at contract checkpoint. |
| AC-185 | AC-185 — Guided classified as alternate mode | PENDING | No evidence recorded at contract checkpoint. |
| AC-186 | AC-186 — Legacy/flag-off quote path classified compatibility/rollback | PENDING | No evidence recorded at contract checkpoint. |
| AC-187 | AC-187 — Calendar-first Operations documented as canonical operational index if promoted | PENDING | No evidence recorded at contract checkpoint. |
| AC-188 | AC-188 — Exact Events route classified contextual/deep-link if removed from permanent nav | PENDING | No evidence recorded at contract checkpoint. |
| AC-189 | AC-189 — Workflow route classified correctly | PENDING | No evidence recorded at contract checkpoint. |
| AC-190 | AC-190 — Messages route classified correctly | PENDING | No evidence recorded at contract checkpoint. |
| AC-191 | AC-191 — System/Admin routes classified correctly | PENDING | No evidence recorded at contract checkpoint. |
| AC-192 | AC-192 — Superseded presentation explicitly identified | PENDING | No evidence recorded at contract checkpoint. |
| AC-193 | AC-193 — Dead duplicate components removed or documented with retirement condition | PENDING | No evidence recorded at contract checkpoint. |
| AC-194 | AC-194 — New quote golden path | PENDING | No evidence recorded at contract checkpoint. |
| AC-195 | AC-195 — Existing quote edit golden path | PENDING | No evidence recorded at contract checkpoint. |
| AC-196 | AC-196 — Guided golden path | PENDING | No evidence recorded at contract checkpoint. |
| AC-197 | AC-197 — AI-assisted quote path | PENDING | No evidence recorded at contract checkpoint. |
| AC-198 | AC-198 — Scenario path | PENDING | No evidence recorded at contract checkpoint. |
| AC-199 | AC-199 — Blocked-save path | PENDING | No evidence recorded at contract checkpoint. |
| AC-200 | AC-200 — Long-menu path | PENDING | No evidence recorded at contract checkpoint. |
| AC-201 | AC-201 — Margin-disabled path | PENDING | No evidence recorded at contract checkpoint. |
| AC-202 | AC-202 — Save-failure recovery path | PENDING | No evidence recorded at contract checkpoint. |
| AC-203 | AC-203 — Calendar golden path | PASS | Operations real-route suite proves Operations → Month/Week → exact focused event → exact Opportunity. |
| AC-204 | AC-204 — Conflict path | PENDING | No evidence recorded at contract checkpoint. |
| AC-205 | AC-205 — Staff lead path | PENDING | No evidence recorded at contract checkpoint. |
| AC-206 | AC-206 — Production checklist path | PENDING | No evidence recorded at contract checkpoint. |
| AC-207 | AC-207 — Opportunity-to-Calendar path | PASS | Living Opportunity component test proves booked quote ID and exact Calendar action; App routes it through the arrival contract. |
| AC-208 | AC-208 — Now-to-Calendar path | PASS | Real-route browser test clicks Now's exact Calendar action and verifies exact focused event. |
| AC-209 | AC-209 — Calendar-to-Opportunity path | PASS | Same browser test opens exact Opportunity ID from Calendar. |
| AC-210 | AC-210 — Calendar usable at 1440 | PASS | Exact-SHA 1440 Playwright and screenshot evidence pass at `30b6fcd48aa881d83150149eeb942e2d07dd89f8`. |
| AC-211 | AC-211 — Calendar usable at 768 | PASS | Exact-SHA 768 Playwright and screenshot evidence pass at `30b6fcd48aa881d83150149eeb942e2d07dd89f8`. |
| AC-212 | AC-212 — Calendar usable at 390 or has an intentional mobile agenda/list adaptation | PASS | 390px renders agenda groups derived from Month/Week day/event/conflict models and hides the desktop grid. |
| AC-213 | AC-213 — Mobile Operations preserves event date/time/context | PASS | 390px screenshot and assertions show dated groups, exact event identity, time, and event name. |
| AC-214 | AC-214 — Mobile event conflict remains understandable | PASS | 390px agenda renders textual Time overlap and Capacity risk for each exact event. |
| AC-215 | AC-215 — No horizontal page overflow | PASS | Operations Playwright asserts document scroll width at 390, 768, and 1440. |
| AC-216 | AC-216 — Calendar navigation keyboard accessible | PASS | Reused Prev/Next/Today/Month/Week/day controls remain native buttons; full schedule unit regression passes. |
| AC-217 | AC-217 — Selected day/event state accessible beyond color | PASS | Day controls retain `aria-current`; exact arrival focuses the semantic event article. |
| AC-218 | AC-218 — Conflict state has textual meaning | PASS | Both desktop and mobile render explicit overlap/capacity labels. |
| AC-219 | AC-219 — Event details have semantic structure | PASS | Exact event details remain focusable articles with headings, labeled status group, facts, staff field, and checklist. |
| AC-220 | AC-220 — Focus is restored after event/detail overlays where applicable | PASS | No new event overlay was added; the reused modal focus/return contract remains covered by the full unit suite. |
| AC-221 | AC-221 — No new serious/critical axe violations | PASS | Operations axe scan passes at all three required widths. |
| AC-222 | AC-222 — Every route intentionally removed from primary/Operations navigation remains reachable through its new intended path | PASS | No route or navigation entry was removed; retirement gate remains closed. |
| AC-223 | AC-223 — Browser Back/Forward remains correct | PENDING | Existing history units are green, but no new authenticated post-promotion browser matrix exists. |
| AC-224 | AC-224 — Direct deep links remain correct | PASS | `/app/operations`, `/app/schedule`, and exact Calendar→Opportunity direct route are exercised locally. |
| AC-225 | AC-225 — Auth/role restrictions unchanged | TRANSITIONAL | Source gates are unchanged and unit tests pass; authenticated admin/sales hosted matrix remains unverified. |
| AC-226 | AC-226 — Mobile Workspace/tools navigation remains accessible | PASS | Pre-promotion Calm Four/mobile utility structure is unchanged and 390px axe/overflow checks pass. |
| AC-227 | AC-227 — No route silently aliases to semantically wrong destination | PASS | Schedule arrivals intentionally target Calendar-first Operations while `/app/schedule` remains the same named compatibility capability. |
| AC-228 | AC-228 — Focused unit/component tests pass | PASS | 35 focused Workbench tests and 76 focused Operations/arrival tests pass. |
| AC-229 | AC-229 — Relevant pre-existing tests remain green or have evidence-backed expectation updates | PASS | Proposal Composer regression was updated for explicit domain selection and supported saved-quote reopening; combined 19/19 browser cases and full 4,472-unit suite pass. |
| AC-230 | AC-230 — Quote workbench real-route Playwright passes | PASS | `e2e/ux-convergence-workbench.spec.js` plus Proposal Composer regression pass 19/19. |
| AC-231 | AC-231 — Operations/Calendar real-route Playwright passes | PASS | `e2e/ux-convergence-operations.spec.js` passes 6/6. |
| AC-232 | AC-232 — Responsive matrix passes | PASS | Workbench and Operations dedicated tests pass at 390, 768, and 1440. |
| AC-233 | AC-233 — Accessibility matrix passes | PASS | Dedicated serious/critical axe scans pass at all required widths; targeted color-contrast regressions pass. |
| AC-234 | AC-234 — Build passes | PASS | Local production build and exact-head CI build at `30b6fcd` pass. |
| AC-235 | AC-235 — Bundle/governance passes | PASS | Local `lane:release:cwv` passes project-state, environment, secret, workflow, capability, 4,472-unit, build, docs, bundle, Truth Loop, and Lighthouse CWV gates. |
| AC-236 | AC-236 — Exact-head CI passes | FAIL | Remote head `30b6fcd` run `33902068474` passed unit/build/capability/docs but failed the prior bundle ceiling; local repair `2b2b54b` is intentionally unpushed and therefore has no exact-head CI. |
| AC-237 | AC-237 — Screenshots/visual evidence correspond to exact candidate SHA | PASS | Local screenshots for 390/768/1440 are named with exact pre-promotion SHA `30b6fcd48aa8` and have recorded SHA-256 hashes. |
| AC-238 | AC-238 — Source/CI evidence is not reported as hosted/human acceptance | PASS | Changelog, Project Status, manuals, PR text, and this ledger explicitly withhold hosted, production, provider, assistive-technology, and human claims. |
