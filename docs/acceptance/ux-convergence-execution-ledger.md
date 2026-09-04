# QuotePilot UX Convergence Execution Evidence Ledger

Last updated: 2026-09-04 18:11:13 CDT

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
| EXTEND | Proposal Composer presentation model and domain focus; Quote Pulse presentation hierarchy; optional Event Schedule framing and continuation callbacks; existing exact-arrival Schedule destination; pure Week timeline geometry derived from the existing scheduled-event projection. |
| MOVE | The existing Calendar presentation becomes the content of `/app/operations`; Schedule arrival targets move to Operations while `/app/schedule` remains a compatibility route. |
| COMPOSE | Event, Customer, Experience, Staffing, and Commercials compose one proposal document; People and Reporting remain role-safe Operations continuations. |
| RETIRE | The flat Ambient Operations menu inventory is removed while every capability and route remains reachable through its intended daily, Frequent, Administration, contextual, or direct path. The old Operations switchboard presentation may leave the route only because every capability entry remains independently reachable. Broader navigation retirement still requires the separate role-aware parity gate. |
| NEW | Pure workbench outputs, a mobile agenda and Week collision geometry derived from existing models, stable evidence markers, focused Workbench/Operations browser suites, and this ledger. No business-state, pricing, persistence, lifecycle, staffing, catalog, provider, or Firebase authority is new. |

## Change-budget architecture review

The budget review separates this UX program from the independently authorized
commercial-platform commits that share the branch. Refinement from the interim
published checkpoint `dbf3516` through exact rendered source `5dd97a2` is
4,697 additions and 1,021 deletions across code, tests, and documentation;
`src/` accounts for 3,111 additions and 657 deletions. The whole mixed-purpose
branch is +11,379/-856 only when the frozen contract, tests, evidence,
documentation, and separate commercial-platform program are counted together.
Production `src/` excluding test files is +3,513/-626, net +2,887, so the
10,000-incremental-production-line architecture stop is not approached.

The required duplication audit found one Proposal Composer/form/save path, one
calculation authority, one existing Schedule/Calendar capability, one shared
Workspace shell, and Month, Week, and mobile presentations derived from the
same scheduled-event and conflict models. The zero-consumer Operations
switchboard and dead CSS were removed. No duplicate state, selector system,
editor, Menu, Schedule engine, navigation shell, mobile authority, or
unnecessary transitional layer remains from this convergence.

## Repository corrections

- The frozen contract describes intended convergence; the program began with
  Calm Four plus a secondary Operations switchboard and a separate
  `/app/schedule` calendar route. The local candidate now retires that
  switchboard presentation, preserves every route, and keeps fifth-primary
  promotion behind its explicit gate.
- Schedule exact-arrival already has a bounded focus contract. Convergence
  changes its destination path to `/app/operations` and retains the same
  `schedule` surface/focus object.
- `EventScheduleView` already owns the accepted/booked event projection,
  conflict and capacity reasoning, staff-lead mutation, production checklist,
  kitchen checkpoints, and run-of-show. No second engine is authorized.
- The selected Month composition is a full-width calendar followed by a lower
  contextual workspace. The selected Week composition is a true seven-day time
  grid with collision geometry and a secondary detail rail. They share one
  selected date/event and introduce no schedule or conflict authority.
- The Proposal Composer already owns client Preview and all editor/save
  callbacks; Workbench domain state is session-only presentation.
- Current roles are administrator and sales for authenticated staff surfaces.
  No navigation retirement is permitted until the recorded role matrix proves
  allowed, denied, direct-route, and Back/Forward behavior.

## Promotion and retirement gates

- Operations surface candidate: the incomplete program was accidentally pushed
  at interim SHA `dbf35164e77c1d441c254b110f0a5372f60ac162`. That publication is not a
  program-completion claim and does not authorize another push. All subsequent
  convergence work is local-commit-only until the full 238-item contract is
  complete and publication is separately authorized. The interim SHA passed
  local release qualification, but cannot qualify the future local candidate.
- Fifth-primary promotion: the local source gate passed before promotion and
  has been repeated against exact rendered source `5dd97a2` after the fidelity
  correction. Remote exact-head CI remains UNVERIFIABLE while push is withheld.
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
| AC-012 | AC-012 — Unsaved Event edits survive context switching | PASS | Focused Workbench browser coverage edits Event name, crosses Customer/Experience, and reads the same unsaved value on return. |
| AC-013 | AC-013 — Menu state survives context switching | PASS | Focused Workbench browser coverage selects a Menu item, crosses domains, and verifies the same selected item and checked state on return. |
| AC-014 | AC-014 — Scenario inspection does not silently mutate quote | PASS | Focused browser coverage edits an isolated scenario, closes it, and verifies the shared draft is unchanged until Use Custom Scenario is explicitly invoked. |
| AC-015 | AC-015 — Guided ↔ Workbench preserves all supported unsaved state | PASS | `e2e/ux-convergence-workbench.spec.js` exercises Workbench → Guided → Workbench with the same unsaved value. |
| AC-016 | AC-016 — Existing quote identity/version semantics preserved | PASS | Updated Proposal Composer regression reopens a saved quote through the existing collection and verifies change-impact editing. |
| AC-017 | AC-017 — Desktop clearly communicates Quote Plan / Living Object / Commercial Truth | PASS | 1440px real-route test asserts all three stable regions; exact labels and markers are in `ProposalComposer`. |
| AC-018 | AC-018 — One major domain active at a time | PASS | `data-active-domain` and scoped CSS expose one detailed domain body at a time. |
| AC-019 | AC-019 — Normal screen does not expose every detailed domain simultaneously | PASS | Real-route test confirms inactive Customer detail is hidden while Event is active. |
| AC-020 | AC-020 — First desktop viewport reveals: | PASS | Focused 1440×1000 browser coverage bounds the H1 identity, active Event domain, canonical total, deposit, and actionable blockers inside the first viewport. |
| AC-021 | AC-021 — Density reduction is not accomplished by simply wrapping everything in more cards | PASS | Workbench retains the ruled proposal sheet and flat Quote Plan/Truth hierarchy; dense Menu choices use native course disclosure rather than more nested cards. |
| AC-022 | AC-022 — Exactly five primary composition domains unless repository evidence justifies a change | PASS | Workbench test asserts Event, Customer, Experience, Staffing, and Commercials. |
| AC-023 | AC-023 — Current domain is visible without relying only on color | PASS | Active domain exposes `aria-current="step"` and textual Ready/Review/blocker state. |
| AC-024 | AC-024 — Domain status markers are evidence-backed | PASS | Pure model tests cover status/summary derivation from completeness, blockers, form, totals, and staffing. |
| AC-025 | AC-025 — Exact blockers focus the correct domain where possible | PASS | Pure blocker-target tests cover field domains and Commercials fallback for non-field authority blockers. |
| AC-026 | AC-026 — Every domain keyboard reachable | PASS | Domains are native buttons in a named navigation landmark. |
| AC-027 | AC-027 — Event first presents readable summary | PASS | Event opens with the derived date/venue/guest summary before its existing inline fields; blank-state browser coverage asserts the honest review message. |
| AC-028 | AC-028 — Existing validation retained | PASS | Focused browser coverage proves the existing inline email validator rejects an invalid address without committing it. |
| AC-029 | AC-029 — Price-affecting Event changes update through existing pricing path | PASS | Focused browser coverage changes Guests, observes the canonical Pulse total move, and verifies Undo restores the exact prior total. |
| AC-030 | AC-030 — Customer fields round-trip unchanged | PASS | Workbench-to-Guided browser coverage carries the same unsaved Client name through both presentation modes and back. |
| AC-031 | AC-031 — Missing/invalid email remains exact blocker | PASS | Save-readiness units preserve `client-email` and `client-email-format`; browser coverage verifies email remains an exact visible blocker. |
| AC-032 | AC-032 — Missing identity is not fabricated | PASS | Blank browser coverage renders `Untitled event`, `Not set`, and the derived review summary without undefined/null or invented customer/event values. |
| AC-033 | AC-033 — Package, Service style, Menu, Rentals and Enhancements are organized under Experience | PASS | Real-route Experience test asserts all five existing capability triggers in the active domain. |
| AC-034 | AC-034 — Package semantics unchanged | PASS | Existing Package IDs, selection callback, catalog price ownership, and what-if preview remain in the shared form; focused model/browser tests cover selection and repricing. |
| AC-035 | AC-035 — Service-style semantics unchanged | PASS | Focused browser coverage changes an existing style through the shared callback, observes the same style after Guided round-trip, and retains the existing staffing-rule consequence. |
| AC-036 | AC-036 — Closed Menu presents meaningful summary | PASS | Selected items remain visible in the grouped Menu summary while the editor is closed. |
| AC-037 | AC-037 — Detailed Menu only opens intentionally | PASS | The editor is closed by default and focused browser coverage opens it only through the explicit Edit Menu control. |
| AC-038 | AC-038 — Existing Menu functionality retained | PASS | Focused browser coverage loads the event-type Menu, selects an existing item, and preserves the governed shared selection. |
| AC-039 | AC-039 — Menu close restores Experience context and focus | PASS | Focused browser coverage closes Menu, verifies focus on its toggle, and verifies Experience remains the current domain. |
| AC-040 | AC-040 — Realistically long Menu remains usable | PASS | Real-route Birthday coverage loads ten course groups and verifies only relevant/first groups open, closed groups remain operable, and search opens matching disclosure without changing Menu authority. |
| AC-041 | AC-041 — Current and recommended staffing visibly distinct | PASS | Focused browser coverage simultaneously shows current `0 servers` and the separately labelled Recommended card. |
| AC-042 | AC-042 — No silent recommendation application | PASS | Current staffing remains unchanged while the recommendation is displayed; mutation still requires Use recommendation. |
| AC-043 | AC-043 — Existing staffing financial consequence retained | PASS | Browser coverage explicitly applies the existing staffing recommendation, observes the canonical Pulse total change, and verifies a non-zero Staffing investment row. |
| AC-044 | AC-044 — Existing Rentals capability retained | PASS | Focused browser coverage selects an existing rental inside Experience and observes it in the proposal summary. |
| AC-045 | AC-045 — Rental suggestions remain explicit proposals | PASS | Pure model tests prove only explicit lagging quantities produce suggestions and no quantity changes without the existing Apply action. |
| AC-046 | AC-046 — Existing Enhancements capability retained | PASS | Focused browser coverage selects an existing enhancement and observes it in the proposal list. |
| AC-047 | AC-047 — Total remains discoverable while editing any desktop domain | PASS | 1440px Workbench keeps Commercial Truth visible and asserts the existing `pc-pulse-total`. |
| AC-048 | AC-048 — Deposit remains discoverable | PASS | Existing pulse deposit remains directly below the canonical total; full component/unit regressions pass. |
| AC-049 | AC-049 — Rail total originates from canonical totals | PASS | Commercial Truth reuses the prior pulse model and `totals`; no alternate calculation was introduced. |
| AC-050 | AC-050 — Per-guest value fails safely when inputs invalid | PASS | Focused investment-model unit coverage proves a positive total with zero guests returns `perGuest: null`; Workbench omits the derived claim. |
| AC-051 | AC-051 — Margin remains properly gated | PASS | Browser coverage proves the margin surface is absent flag-off and fail-closed flag-on; `num` now correctly treats null/blank recorded costs as missing rather than zero. |
| AC-052 | AC-052 — Healthy margin evidence compresses | PASS | Deterministic disclosure units prove available margin meeting a target (or without a target) starts compact, while the summary retains the headline evidence and staff-only boundary. |
| AC-053 | AC-053 — Margin uncertainty expands | PASS | Deterministic units cover missing evidence and recorded-target misses; flag-on browser coverage verifies unavailable evidence opens with named missing-cost guidance. |
| AC-054 | AC-054 — Blocker count exact | PASS | Browser coverage derives the count from Review N blockers and verifies exactly N rendered blocker records. |
| AC-055 | AC-055 — Exact blocker reasons retained | PASS | Readiness renders the unchanged blocker messages; focused units assert the complete blocker ID order and governed authorization reason. |
| AC-056 | AC-056 — Review blockers never saves/mutates by itself | PASS | Clicking blocker review only opens/focuses readiness; the same unsaved draft and dirty state remain. |
| AC-057 | AC-057 — Blocked save cannot be bypassed by alternative workbench control | PASS | Header and Truth-rail save controls expose the identical blocker action and neither produces an editing/saved identity. |
| AC-058 | AC-058 — Special existing blockers remain enforceable | PASS | Focused units prove quote-read, Pilot-review, intent-review, impact-review, and impact-authorization blockers remain in the common save gate. |
| AC-059 | AC-059 — Guest changes preserve before/after consequence view | PASS | Focused browser coverage changes Guests and asserts the consequence surface retains before/after guest and total values. |
| AC-060 | AC-060 — Automatic pricing versus recommendations versus unchanged state clearly distinguished | PASS | Browser coverage observes automatic canonical total movement, a separately labelled staffing recommendation, and unchanged current staffing until explicit action. |
| AC-061 | AC-061 — Existing explicit Apply / Keep / Undo outcomes retained where currently supported | PASS | Focused browser coverage exercises Keep as quoted and Undo guest change; existing consequence-model units retain explicit staffing/rental apply patches. |
| AC-062 | AC-062 — Pilot remains reachable | PASS | Flag-on real-route coverage reveals the contextual Pilot after the first draft edit; focused shell tests retain the global desktop/mobile Pilot entry. |
| AC-063 | AC-063 — AI changes inspectable before governed commit | PASS | Browser coverage previews an exact bartender draft change with `Nothing is saved yet` before explicit Apply; scenario review units retain before/after, compromises, provenance, and confirmation. |
| AC-064 | AC-064 — AI cannot bypass ordinary blockers/authority | PASS | Applying Pilot changes only the dirty draft and the common save control still exposes ordinary blockers; 78 focused policy/review tests reject unsafe authority, scope, confirmation, and evidence drift. |
| AC-065 | AC-065 — Idle Pilot footprint is restrained | PASS | Browser coverage proves the draft Pilot is absent on untouched arrival and appears only after relevant draft activity under its existing flag. |
| AC-066 | AC-066 — Existing Compare Scenarios remains available | PASS | Focused browser coverage opens the existing Scenario Compare surface from Workbench. |
| AC-067 | AC-067 — Scenario detail is contextual rather than permanently expanded | PASS | Scenario configuration exists only in the invoked modal and closes back to the same draft. |
| AC-068 | AC-068 — Internal-only evidence excluded | PASS | Workbench browser test opens client Preview and asserts no margin, blocker, or staff-only copy. |
| AC-069 | AC-069 — Unsaved preview remains honestly labelled | PASS | Focused browser coverage verifies the client surface says Draft preview and explains that the final proposal follows save/send. |
| AC-070 | AC-070 — Preview focus management preserved | PASS | Preview focuses Close on entry, closes with Escape, and restores focus to the invoking Preview control. |
| AC-071 | AC-071 — Guided uses same form state | PASS | Real-route shared-value test passes. |
| AC-072 | AC-072 — Guided behavior retained | PASS | Legacy Proposal Composer regression enters the existing wizard and returns. |
| AC-073 | AC-073 — Supported flag-off/rollback path remains coherent if still required | PASS | Default Playwright lane remains flag-off and the full 4,472-test unit suite is green. |
| AC-074 | AC-074 — No dual canonical editor | PASS | Workbench is implemented inside `ProposalComposer`; Guided remains an alternate mode over the same form. |
| AC-075 | AC-075 — Save state labels truthful | PASS | A changed draft stays labelled Unsaved changes and `data-state=dirty`; existing successful-save coverage is tied to the real save return. |
| AC-076 | AC-076 — No accidental continuous autosave introduced | PASS | Field and scenario edits remain dirty and do not create a saved/editing identity without the explicit shared save action. Local recovery remains labelled recovery, not server save. |
| AC-077 | AC-077 — Firebase authoritative pricing remains intact | PASS | No pricing authority moved into Workbench; the unchanged Firebase authoritative-pricing and trusted-write suites passed in the last exact runtime qualification. |
| AC-078 | AC-078 — Version behavior remains intact | PASS | Existing quote edit/version suites passed unchanged; Workbench continues to invoke the single App save/version callback. |
| AC-079 | AC-079 — UI presents saved success only from real successful save state | PASS | A forced local persistence exception leaves `data-state=dirty`, shows the exact failure, creates no quote record, and never renders a saved identity/success state. |
| AC-080 | AC-080 — Failed save preserves unsaved work where current architecture permits | PASS | Focused browser coverage completes a valid draft, injects failure at the local persistence boundary, then reads back the same event identity, customer, and selected Menu item. |
| AC-081 | AC-081 — Advanced pricing collapsed by default | PASS | Focused browser coverage verifies the native details region is closed on arrival. |
| AC-082 | AC-082 — Existing advanced pricing capabilities retained | PASS | Opening Advanced pricing exposes the retained Event template, Tax region, Season profile, travel, payment, and disposables controls. |
| AC-083 | AC-083 — Unsupported arbitrary per-quote price override remains absent | PASS | Workbench retains only supported staffing-rate overrides and governed pricing context; no arbitrary line, subtotal, or total override control or authority exists. |
| AC-084 | AC-084 — Activity remains inspectable | PASS | Updated browser regression opens the activity toggle and verifies session changes. |
| AC-085 | AC-085 — Activity secondary while healthy | PASS | Activity now starts collapsed and remains available through its existing toggle. |
| AC-086 | AC-086 — Actionable recovery evidence may promote through Attention | PASS | Save failure is promoted into the always-visible save-readiness block as `Latest draft notice` with its exact recovery error while recent routine activity remains collapsed. |
| AC-087 | AC-087 — 1440px workbench intentionally uses desktop hierarchy | PASS | Dedicated 1440px Workbench Playwright case passes. |
| AC-088 | AC-088 — 768px adaptation has no horizontal document overflow | PASS | Dedicated 768px Workbench Playwright case asserts no page overflow. |
| AC-089 | AC-089 — 390px uses intentional mobile composition, not squeezed desktop columns | PASS | Dedicated 390px Workbench case exercises horizontal Quote Plan plus modal Commercial Truth. |
| AC-090 | AC-090 — Mobile total/attention remains readily discoverable | PASS | Existing mobile regression opens `Review quote` and verifies Commercial Truth visibility. |
| AC-091 | AC-091 — Mobile controls preserve current minimum touch-target contract | PASS | Workbench inputs, action buttons, inline edit controls, domain controls, and Menu summaries retain or now meet the repository 44px minimum; the 390px browser case measures disclosure height. |
| AC-092 | AC-092 — Long Menu fully usable at 390px | PASS | Focused 390×844 browser coverage opens the ten-course Birthday Menu, expands a closed course, searches a real dish, and preserves document width. |
| AC-093 | AC-093 — No accidental nested-scroll trap | PASS | The 390px long-Menu case verifies its editor remains normal-flow `visible`/`clip` overflow and the document stays within one pixel of viewport width. |
| AC-094 | AC-094 — Major regions have semantic/accessible names | PASS | Browser roles resolve the named Quote plan navigation, Living proposal document article, and Quote Pulse complementary region. |
| AC-095 | AC-095 — Heading hierarchy valid | PASS | Proposal structure is one H1, section H2s, and nested Experience/client-preview H3s; rendered browser snapshots and focused assertions confirm the corrected hierarchy. |
| AC-096 | AC-096 — Selected/current/attention state not color-only | PASS | Current domain uses `aria-current=step`; every domain also emits textual Ready, Review, In progress, or exact blocker count alongside non-color styling. |
| AC-097 | AC-097 — Visible keyboard focus | PASS | Focused browser coverage tabs to the next Workbench control, asserts `:focus-visible`, and measures the scoped 2px outline. |
| AC-098 | AC-098 — Focus returns after closing Menu/Preview/Scenario/context | PASS | Focused browser coverage verifies return to the invoking Menu, Preview, and Scenario controls; domain context moves focus to its named panel. |
| AC-099 | AC-099 — Field errors remain associated with controls | PASS | Invalid-email browser coverage verifies the editor input's `aria-describedby` points to the visible exact validation error. |
| AC-100 | AC-100 — Reduced-motion respected | PASS | Reduced-motion browser emulation verifies Workbench animation is `none` and all transition durations resolve to zero. |
| AC-101 | AC-101 — Zero new serious/critical axe violations | PASS | Workbench Playwright axe checks pass at 390, 768, and 1440. |
| AC-102 | AC-102 — Blank quote looks intentionally structured | PASS | Rendered 390/768/1440 blank states retain named identity, five-domain plan, readable Event summary, proposal sheet, total, and exact attention instead of empty scaffolding. |
| AC-103 | AC-103 — Dense quote no longer renders as one giant continuous document | PASS | Only the active domain is detailed; the dense ten-course Menu now reveals relevant/first course content and leaves the remaining course groups collapsed. |
| AC-104 | AC-104 — Long names do not collide/clip | PASS | Focused browser coverage commits a long event identity and asserts both title and document remain within their available widths. |
| AC-105 | AC-105 — Dense Menu remains readable when deliberately opened | PASS | Phone and desktop rendered review shows labelled course disclosure, option counts, one readable open choice list, and collapsed remaining courses. |
| AC-106 | AC-106 — Important warning outranks routine metadata | PASS | Actionable blockers remain directly below the total/deposit and before composition, watching, polish, margin, and activity metadata in Commercial Truth. |
| AC-107 | AC-107 — Total remains visually prominent | PASS | First-viewport and responsive browser coverage keep the canonical large money total visible in desktop Truth and the mobile review bar. |
| AC-108 | AC-108 — Workbench looks like evolved QuotePilot, not a separate design system | PASS | Rendered review confirms the existing bone/sheet/brass tokens, editorial/mono typography, native controls, and shared shell remain continuous with QuotePilot. |
| AC-109 | AC-109 — Bundle budget passes or any exception is explicitly justified | PASS | Local `check:perf:bundle` passes against an exact 3,311,120-byte temporary ceiling; the 1,120-byte CI delta is documented with no percentage headroom. |
| AC-110 | AC-110 — Existing useful lazy boundaries retained | PASS | This slice changes only mounted Proposal Composer presentation/CSS/models/tests; route-level and existing editor lazy boundaries are untouched. |
| AC-111 | AC-111 — Domain switching causes no unnecessary persistence/network work | PASS | `openDomain` changes local active-domain/editor presentation state and focus only; continuity coverage crosses domains without save or identity creation. |
| AC-112 | AC-112 — Material LOC overrun triggers architecture review | PASS | The explicit architecture-budget review above separates unrelated commercial work, measures production `src/` excluding tests at +3,513/-626 (net +2,887), and finds no duplicate state, editor, Menu, Schedule, shell, mobile authority, or transitional layer. |
| AC-113 | AC-113 — Major unexpected implementation-scale increase requires explicit explanation before continuation | NOT APPLICABLE | Production UX work remains in the planned several-thousand-line band. The larger +11,379/-856 mixed branch total includes the frozen contract, tests, evidence, documentation, and the separate commercial-platform program; the production-only net increase is +2,887, so the 10,000-line architecture stop is not approached. |
| AC-114 | AC-114 — Operations menu is no longer an undifferentiated 10+ item feature inventory | PASS | Focused shell units and real-route browser coverage prove the Ambient Operations menu contains only Operations, Clear the Deck, and role-gated Staff. |
| AC-115 | AC-115 — Daily execution has one obvious operational entry | PASS | Operations is the single Calendar-first daily index; Clear the Deck and Staff are bounded continuations rather than duplicate event indexes. |
| AC-116 | AC-116 — Calendar/Schedule is reused rather than replaced | PASS | Both `/app/operations` and compatibility `/app/schedule` render the existing `EventScheduleView`. |
| AC-117 | AC-117 — Operations is organized around time/execution rather than repository modules | PASS | Calendar-first Operations owns daily execution; Workflow, Messages, Pilot, and Administration are explicitly separated by use rather than folded into one module list. |
| AC-118 | AC-118 — Routes may remain available without all remaining permanent navigation entries | PASS | Events and Event Schedule leave Ambient Operations menu inventory while exact `/app/events/:id` and compatibility `/app/schedule` remain browser-tested direct routes. |
| AC-119 | AC-119 — Calendar is the default operational lens when current capability supports it | PASS | Operations route composition opens directly on Calendar. |
| AC-120 | AC-120 — Existing Month view retained | PASS | Exact-source browser geometry at 1440 and 1487 proves the reused Month calendar owns the broad primary canvas, has no permanent side rail, and places selected-day/event context beneath the complete month grid. |
| AC-121 | AC-121 — Existing Week view retained | PASS | Exact-source browser geometry proves seven dated columns, a vertical time axis, start-time top positions, duration heights, visible collision lanes, selected-event state, and a secondary contextual rail. |
| AC-122 | AC-122 — Accepted/booked events remain correctly projected | PASS | Same-model browser fixture renders one booked and one accepted event without a new projection. |
| AC-123 | AC-123 — Existing conflict detection retained | PASS | Existing overlap/capacity indicators render from `buildConflictInsights`; full schedule/unit regression is green. |
| AC-124 | AC-124 — Time overlap detection retained | PASS | Two overlapping exact-time fixtures render textual Time overlap indicators. |
| AC-125 | AC-125 — Unknown-time warnings retained | PASS | No conflict algorithm changed; full 4,472-test suite includes existing schedule semantics. |
| AC-126 | AC-126 — Capacity-conflict logic retained | PASS | 480 combined guests against the 400 threshold render textual Capacity risk. |
| AC-127 | AC-127 — Staff-lead assignment remains available under existing authority | PASS | Existing `handleAssignStaff` and select remain inside reused event cards; no authority code changed. |
| AC-128 | AC-128 — Production checklist remains available | PASS | Existing checklist component remains mounted in reused event cards; full unit regression passes. |
| AC-129 | AC-129 — Existing kitchen/run-of-show planning context remains available where currently supported | PASS | Exact screenshots and browser surface retain Run of show; existing kitchen/checklist code remains unchanged. |
| AC-130 | AC-130 — Calendar does not claim live telemetry that does not exist | PASS | Visible source note explicitly labels read-only planning and rejects attendance/inventory/readiness inference. |
| AC-131 | AC-131 — Events and Schedule are not presented as two confusing equal event indexes without a documented reason | PASS | Canonical docs name Operations as the Calendar index, Schedule as compatibility, and Event Focus as contextual/direct; neither Events nor Event Schedule remains duplicated in the Operations menu. |
| AC-132 | AC-132 — Calendar event opens exact existing event/opportunity identity | PASS | Operations Playwright opens exact `operations-event-a` and verifies its Opportunity heading. |
| AC-133 | AC-133 — No duplicate Event record introduced | PASS | Calendar still derives from quote history; no Firestore schema, entity, or write path was added. |
| AC-134 | AC-134 — Exact Event routes remain functional for direct/deep arrival | PASS | Operations browser coverage opens `/app/events/operations-event-a` directly and retains the exact quote/event identity. |
| AC-135 | AC-135 — Event Focus remains available where supported | PASS | The same direct-route case asserts Event Focus, the exact event heading, and semantic Event basics region. |
| AC-136 | AC-136 — Existing Workflow authority remains unchanged | PASS | Workflow source is untouched; exact-focus and write/readback suites remain green in the 274-test contextual regression. |
| AC-137 | AC-137 — Now can continue to deep-link exact Workflow attention | PASS | `ambientNowView.test.jsx` proves priority and request-backed items carry the exact shared Workflow focus identity. |
| AC-138 | AC-138 — Opportunity can continue to deep-link exact Workflow attention | PASS | Living Opportunity tests prove exact final-count, customer-request, and follow-up continuations target existing Workflow items without substitution. |
| AC-139 | AC-139 — Removing/demoting a menu entry does not make Workflow unreachable | PASS | Workflow remains in Frequent tools and `/app/workflow`; focused shell and route tests pass after Operations consolidation. |
| AC-140 | AC-140 — Bulk/global Workflow route remains available if supported use cases require it | PASS | The global `/app/workflow` route and aggregate Workflow action remain registered and tested. |
| AC-141 | AC-141 — Existing conversation/message capability preserved | PASS | Messaging station state and exact-arrival suites pass without message-source or write-path changes. |
| AC-142 | AC-142 — Opportunity-context conversation remains reachable | PASS | Living Opportunity opens exact Conversation evidence and routes the same quote/thread identity without mutation. |
| AC-143 | AC-143 — Client-context conversation remains reachable where supported | PASS | Ambient Clients tests retain exact customer-reply identity in the conversation handoff. |
| AC-144 | AC-144 — Global Messages remains available where aggregate review is required | PASS | Messages remains in Frequent tools and the tested `/app/messaging` route. |
| AC-145 | AC-145 — Messaging is not duplicated inside Operations merely for navigation convenience | PASS | Shell unit/browser evidence proves Messages is absent from Operations and present once in Frequent tools. |
| AC-146 | AC-146 — Pilot remains globally reachable according to current capability design | PASS | Pilot remains in Frequent tools and the global Pilot surface/context suites pass. |
| AC-147 | AC-147 — Pilot is not architecturally owned by Operations | PASS | Workspace grouping and source keep Pilot in the global secondary surface; Operations has no Pilot implementation. |
| AC-148 | AC-148 — No second Operations-specific Pilot implementation | PASS | Repository search and focused Pilot regressions identify only the shared global/contextual Pilot path. |
| AC-149 | AC-149 — Clear the Deck behavior preserved | PASS | Focused component tests prove the bounded approval/decision-debt queue, three-item cap, refresh, and exact Workflow review handoff. |
| AC-150 | AC-150 — Clear the Deck remains reachable from appropriate attention context | PASS | Clear the Deck remains a named daily execution action in desktop and mobile Operations groups. |
| AC-151 | AC-151 — It is not treated as an independent operational data authority | PASS | Clear Deck tests assert planning/review-only copy, existing snapshot inputs, no resolution action, and honest unavailable/empty boundaries. |
| AC-152 | AC-152 — Existing Staff capability preserved | PASS | Staff remains a role-gated daily continuation and the existing private staff workspace suite passes. |
| AC-153 | AC-153 — Calendar may link to Staff without rebuilding Staff | PASS | Calendar's existing People continuation routes to `/app/staff`; no staff component, store, or authority was duplicated. |
| AC-154 | AC-154 — Staff private/role authority unchanged | PASS | People continuation is shown only under the existing admin and staffing-feature gates; staffing authority code is unchanged. |
| AC-155 | AC-155 — Existing Reporting preserved | PASS | Reporting route, exact-arrival, and evidence suites pass with no reporting-source change. |
| AC-156 | AC-156 — Reporting no longer competes visually with primary operational execution unless evidence justifies it | PASS | Reporting is a secondary Calendar continuation and progressive Administration tool, not a primary or daily index. |
| AC-157 | AC-157 — Reporting remains reachable through secondary/admin/Insights path | PASS | Calendar retains its secondary Reporting action and Workspace tools retains Reporting Dashboard under Administration. |
| AC-158 | AC-158 — Integrations Ops preserved | PASS | Integrations Ops remains role/feature-gated under progressive Administration with its route unchanged. |
| AC-159 | AC-159 — Import Studio preserved | PASS | Import Studio remains administrator-gated under progressive Administration with its route unchanged. |
| AC-160 | AC-160 — Diagnostics preserved | PASS | Session Diagnostics remains capability-gated under progressive Administration with its route unchanged. |
| AC-161 | AC-161 — Moving these out of Operations does not remove authority or reachability | PASS | Browser and shell coverage expand Administration and verify all four actions after their removal from the flat Operations menu. |
| AC-162 | AC-162 — Administrative tools are distinguishable from daily operator work | PASS | Workspace tools renders a separately titled, initially collapsed Administration group after the concise daily Operations group. |
| AC-163 | AC-163 — Catalog administration remains preserved | PASS | Administrator Library retains the existing guarded catalog editor and `/app/catalog` compatibility route. |
| AC-164 | AC-164 — Ambient Library remains or becomes the conceptual home for business-building-block configuration where current IA supports it | PASS | Ambient Library tests prove Catalog and Templates remain its purpose-bearing business-building-block sections. |
| AC-165 | AC-165 — Catalog is not redundantly surfaced under Operations without documented need | PASS | Catalog Admin is absent from Ambient Operations; role-safe Library remains the intended home. |
| AC-166 | AC-166 — Now may show compact upcoming operational horizon | PASS | Now tests cap the ordered priority horizon at three and render only recorded upcoming work. |
| AC-167 | AC-167 — Now does not duplicate full Calendar | PASS | Now renders compact priority rows and exact continuations, not Month/Week controls or a Calendar grid. |
| AC-168 | AC-168 — Upcoming event can navigate to exact Calendar/Event context | PASS | Operations Playwright clicks Now's exact Open in Calendar action and focuses `operations-event-a`. |
| AC-169 | AC-169 — Conflict/attention language shown in Now is evidence-backed | PASS | Now presentation tests preserve supplied bounded attention order and receipt-backed quiet progress without invented state. |
| AC-170 | AC-170 — Accepted/booked Opportunity can open operational Calendar/Event context | PASS | Living Opportunity tests hand an accepted exact quote ID to Calendar without mutation. |
| AC-171 | AC-171 — Commercial and operational contexts retain same exact opportunity/event identity | PASS | Browser and component tests carry `operations-event-a` from Now/Opportunity into Calendar and back to the same Opportunity. |
| AC-172 | AC-172 — Transition introduces no duplicate persisted Event entity unless one already exists authoritatively | PASS | Implementation adds presentation callbacks/markers only and retains quote-history projection. |
| AC-173 | AC-173 — Planning state explicitly distinguished from live actuals | PASS | Run-of-show copy identifies a read-only projection and states which live actuals it cannot establish. |
| AC-174 | AC-174 — No current-stage claim without authoritative state | PASS | Event Focus labels only recorded opportunity and booking state and states that schedule date does not establish readiness. |
| AC-175 | AC-175 — No live issue claim without issue records | PASS | Event/Calendar surfaces expose planning conflicts only; no live issue state or issue-record substitute exists. |
| AC-176 | AC-176 — No staff check-in claim without authoritative check-in data | PASS | Staff assignment remains a planning record and no attendance/check-in claim is rendered. |
| AC-177 | AC-177 — No Replay claim without immutable operational evidence | PASS | Event tests prove Replay is not offered as an active control and the exact replay route states it is unavailable until immutable ledger evidence exists. |
| AC-178 | AC-178 — Primary navigation remains intentionally small | PASS | Route/shell units and real-browser coverage require exactly five primary destinations in the frozen order: Now, Opportunities, Operations, Clients, Library. New quote, Search, Pilot, and Administration remain outside it. |
| AC-179 | AC-179 — New Quote remains a global action rather than a permanent content destination if current design supports this | PASS | Shell browser/unit evidence keeps New quote as the standalone global CTA, outside primary content navigation. |
| AC-180 | AC-180 — Search remains global/secondary | PASS | Search remains a global desktop utility and the first action in mobile Workspace tools. |
| AC-181 | AC-181 — Pilot remains global/secondary | PASS | Pilot remains in Frequent tools and its shared global surface; it is absent from Operations. |
| AC-182 | AC-182 — System/Admin capabilities do not inflate primary navigation | PASS | Reporting, Integrations, Import, and Diagnostics remain inside collapsed Administration rather than primary navigation. |
| AC-183 | AC-183 — Mobile navigation remains focused and accessible | PASS | Exact-source 390px browser evidence shows the five-item bottom rail with textual labels, current-page semantics, no horizontal document overflow, and no serious/critical axe violation in the Operations surface. |
| AC-184 | AC-184 — Canonical quote composition surface documented | PASS | Feature Matrix classifies Commercial Workbench/`ProposalComposer` as canonical and names its preserved one-form/save authority. |
| AC-185 | AC-185 — Guided classified as alternate mode | PASS | Feature Matrix and User Manual classify Guided as an alternate mode over the same draft and save authority. |
| AC-186 | AC-186 — Legacy/flag-off quote path classified compatibility/rollback | PASS | Feature Matrix classifies the flag-off wizard and connected Quote Workspace as compatibility/rollback. |
| AC-187 | AC-187 — Calendar-first Operations documented as canonical operational index if promoted | PASS | README, User Manual, Design System, and Feature Matrix identify `/app/operations` as the local canonical operational index candidate and fifth primary destination while withholding hosted/deployment claims. |
| AC-188 | AC-188 — Exact Events route classified contextual/deep-link if removed from permanent nav | PASS | Canonical docs classify Event Focus as contextual/direct and browser-test exact `/app/events/:quoteId`. |
| AC-189 | AC-189 — Workflow route classified correctly | PASS | Canonical matrix classifies Workflow as Frequent global attention plus exact contextual continuation. |
| AC-190 | AC-190 — Messages route classified correctly | PASS | Canonical matrix classifies Messages as Frequent aggregate review plus exact opportunity/client continuation. |
| AC-191 | AC-191 — System/Admin routes classified correctly | PASS | Canonical matrix classifies Reporting and system tools as progressive Administration with existing gates. |
| AC-192 | AC-192 — Superseded presentation explicitly identified | PASS | Canonical matrix and `ambientLegacyRetirement` name the legacy Operations switchboard and its Calendar-first replacement. |
| AC-193 | AC-193 — Dead duplicate components removed or documented with retirement condition | PASS | Zero-consumer `OperationsSwitchboardView` and its CSS are removed; the retirement registry records the mechanical condition and preserved-route disposition. |
| AC-194 | AC-194 — New quote golden path | PASS | Dedicated browser coverage completes a valid Event, Customer, Experience/Menu, Staffing, and Commercial draft and saves it through the shared Workbench action. |
| AC-195 | AC-195 — Existing quote edit golden path | PASS | The saved quote lands in its Living Opportunity, reopens through Opportunities, enters the existing editor, and persists as the same quote/portal identity with `v0001` → `v0002` and exactly two history entries. |
| AC-196 | AC-196 — Guided golden path | PASS | Workbench browser coverage enters Guided, edits the shared draft, returns to Workbench, and retains the same supported state and save authority. |
| AC-197 | AC-197 — AI-assisted quote path | PASS | Flag-on Pilot coverage previews the exact dirty-draft mutation before explicit Apply and leaves ordinary save blockers authoritative. |
| AC-198 | AC-198 — Scenario path | PASS | Browser coverage opens Compare Scenarios, changes isolated scenario inputs, proves the draft remains unchanged, then applies only the explicit chosen scenario. |
| AC-199 | AC-199 — Blocked-save path | PASS | Both Workbench save controls expose the same exact blocker set and create no saved-success identity while blocked. |
| AC-200 | AC-200 — Long-menu path | PASS | Birthday fixture browser coverage keeps ten course groups readable through intentional disclosure, selection, and search. |
| AC-201 | AC-201 — Margin-disabled path | PASS | Browser coverage proves margin is absent flag-off and fail-closed with named unavailable evidence flag-on. |
| AC-202 | AC-202 — Save-failure recovery path | PASS | Forced browser-local persistence failure creates no quote/success claim and preserves Event, Customer, and Menu work for retry. |
| AC-203 | AC-203 — Calendar golden path | PASS | Operations real-route suite proves Operations → Month/Week → exact focused event → exact Opportunity. |
| AC-204 | AC-204 — Conflict path | PASS | Browser coverage selects the exact overlapping event and observes both Time overlap and Capacity risk without offering a fabricated resolution. |
| AC-205 | AC-205 — Staff lead path | PASS | Browser coverage assigns Kitchen Lead through the existing quote-store authority, reloads Operations, and reads the persisted exact assignment. |
| AC-206 | AC-206 — Production checklist path | PASS | Browser coverage completes Event brief reviewed through the existing checklist authority, reloads Operations, and reads the persisted completion. |
| AC-207 | AC-207 — Opportunity-to-Calendar path | PASS | Living Opportunity component test proves booked quote ID and exact Calendar action; App routes it through the arrival contract. |
| AC-208 | AC-208 — Now-to-Calendar path | PASS | Real-route browser test clicks Now's exact Calendar action and verifies exact focused event. |
| AC-209 | AC-209 — Calendar-to-Opportunity path | PASS | Same browser test opens exact Opportunity ID from Calendar. |
| AC-210 | AC-210 — Calendar usable at 1440 | PASS | Exact-source Playwright passes at `5dd97a20133b592f210d56e2454e699c17d45200`; Month/Week viewport screenshot SHA-256 values are `a16b5ca4d1a8fb2bab06715d6d03a7435804d7f98b01274269ffa8e8a79e3c36` and `4e7c4d169b08c34e2d591c7dbe2f1dd2faa9280758e3083a06aac40678aa93b0`. |
| AC-211 | AC-211 — Calendar usable at 768 | PASS | Exact-source Playwright passes at `5dd97a20133b592f210d56e2454e699c17d45200`; Month/Week screenshot SHA-256 values are `e5c67a31315d2ff0c0d5cf40dfe397ec42701a588f129763e311fffff8c2779e` and `f64541c149a7e389e8e61cd79977001fda5f95ce9dab5cda2b181c19000ae181`. |
| AC-212 | AC-212 — Calendar usable at 390 or has an intentional mobile agenda/list adaptation | PASS | 390px renders agenda groups derived from Month/Week day/event/conflict models and hides the desktop grid. |
| AC-213 | AC-213 — Mobile Operations preserves event date/time/context | PASS | Exact-source 390px screenshots and assertions show dated groups, exact event identity, time, and event name; Month/Week viewport SHA-256 values are `0ac34a5a927d16dcd8699344fcc71fd2a568336d9f1d9517af5646fbb9462bd9` and `b0dbcdf181ff1167a8ab3d3245e6e55e8083c63d9f3a6d2b5fefd9e6ef8f1717`. |
| AC-214 | AC-214 — Mobile event conflict remains understandable | PASS | 390px agenda renders textual Time overlap and Capacity risk for each exact event. |
| AC-215 | AC-215 — No horizontal page overflow | PASS | Operations Playwright asserts document scroll width at 390, 768, 1440, and the 1487 reference width. |
| AC-216 | AC-216 — Calendar navigation keyboard accessible | PASS | Reused Prev/Next/Today/Month/Week/day controls remain native buttons; full schedule unit regression passes. |
| AC-217 | AC-217 — Selected day/event state accessible beyond color | PASS | Day controls retain `aria-current`; exact arrival focuses the semantic event article. |
| AC-218 | AC-218 — Conflict state has textual meaning | PASS | Both desktop and mobile render explicit overlap/capacity labels. |
| AC-219 | AC-219 — Event details have semantic structure | PASS | Exact event details remain focusable articles with headings, labeled status group, facts, staff field, and checklist. |
| AC-220 | AC-220 — Focus is restored after event/detail overlays where applicable | PASS | No new event overlay was added; the reused modal focus/return contract remains covered by the full unit suite. |
| AC-221 | AC-221 — No new serious/critical axe violations | PASS | Operations axe scan passes at all three required widths and the 1487 reference width. |
| AC-222 | AC-222 — Every route intentionally removed from primary/Operations navigation remains reachable through its new intended path | PASS | Real-route coverage proves Workflow/Messages/Pilot in Frequent tools, Reporting/Integrations/Import/Diagnostics in progressive Administration, direct exact Event Focus, and Schedule compatibility after menu consolidation. |
| AC-223 | AC-223 — Browser Back/Forward remains correct | PASS | Local real-route coverage navigates Operations → exact Opportunity → Back to Operations → Forward to the same exact Opportunity identity. Hosted authenticated history acceptance remains separately unclaimed. |
| AC-224 | AC-224 — Direct deep links remain correct | PASS | `/app/operations`, `/app/schedule`, `/app/events/operations-event-a`, and exact Calendar→Opportunity routes are exercised locally. |
| AC-225 | AC-225 — Auth/role restrictions unchanged | PASS | Existing source gates are unchanged. Focused Ambient and rollback browser profiles exercise admin and sales origins: both reach Operations; sales still lacks Staff and Import Studio while admin retains gated Administration. Hosted authenticated acceptance remains separately unclaimed. |
| AC-226 | AC-226 — Mobile Workspace/tools navigation remains accessible | PASS | The five-item mobile primary rail and Workspace & tools dialog pass 390px containment, focus restoration, role-aware grouping, and no-overflow coverage. |
| AC-227 | AC-227 — No route silently aliases to semantically wrong destination | PASS | Schedule arrivals intentionally target Calendar-first Operations while `/app/schedule` remains the same named compatibility capability. |
| AC-228 | AC-228 — Focused unit/component tests pass | PASS | The final focused Operations authority, route, shell, and presentation cohort passes 131/131 tests; independent source review finds one projection and one conflict derivation. |
| AC-229 | AC-229 — Relevant pre-existing tests remain green or have evidence-backed expectation updates | PASS | The final full suite passes 4,509 tests across 395 passing files with 80 tests/3 files intentionally skipped. Proposal Composer and Workbench expectations remain authority-bearing rather than weakened. |
| AC-230 | AC-230 — Quote workbench real-route Playwright passes | PASS | All 22 dedicated Workbench cases pass against rendered source `5dd97a2` under the intended Workbench feature profile, including the Living Opportunity save/reopen/version path and required Ambient Pilot lane. |
| AC-231 | AC-231 — Operations/Calendar real-route Playwright passes | PASS | All 12 dedicated Operations cases pass at exact rendered source `5dd97a2`, including capability gates, authoritative persistence, 390/768/1440 responsiveness, and 1487×1058 reference-size captures. |
| AC-232 | AC-232 — Responsive matrix passes | PASS | Operations passes at 390, 768, and 1440; the same suite also passes the exact 1487×1058 selected-reference viewport. Workbench evidence remains separately retained. |
| AC-233 | AC-233 — Accessibility matrix passes | PASS | Dedicated Operations serious/critical axe scans pass at 390, 768, 1440, and 1487; selected state and conflict meaning remain textual. |
| AC-234 | AC-234 — Build passes | PASS | Final local release build passes after transforming 528 modules with the corrected Month/Week presentation and enabled release graph included. |
| AC-235 | AC-235 — Bundle/governance passes | PASS | Final local release qualification passes project-state, env, secret, Ambient-release, Stripe-isolation, workflow, capability-surfacing, 4,509-unit, build, docs, exact 3,331,403/394,701-byte bundle, 127-test Truth Loop, and Lighthouse CWV gates. The isolated worktree consumed the primary checkout's ignored env only in-process; no secret was copied or committed. |
| AC-236 | AC-236 — Exact-head CI passes | UNVERIFIABLE | The completed local branch is intentionally unpushed by owner instruction. No exact-head remote CI run can exist without a separately authorized future push. |
| AC-237 | AC-237 — Screenshots/visual evidence correspond to exact candidate SHA | PASS | Local 390/768/1440 screenshots and same-size 1487×1058 Month/Week comparisons are named for exact UI source `5dd97a20133b`; implementation-image SHA-256 values are `ad5ab5365674b026ad32f2ec877f09381a8f27c57699756a2d5d176dc8899f1e` and `afacb79f110af76e8499c41a1d4a44517d001107058a6e71756c1d4e41eab8ad`. Side-by-side comparison-image hashes are `55cf93cbe0f3878786a937167fa3a703b6977c1f5e0fce2b91c83c361efc05ba` and `deb64f56f16d5d4c04a5dacd15e9b9899837dbfdf51a1ad19fa698166da05f43`. The later evidence-only commit does not alter rendered source. |
| AC-238 | AC-238 — Source/CI evidence is not reported as hosted/human acceptance | PASS | Changelog, Project Status, manuals, PR text, and this ledger explicitly withhold hosted, production, provider, assistive-technology, and human claims. |
