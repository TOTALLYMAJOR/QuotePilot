# QuotePilot Whole-Product UX Context Audit

Status: ACTIVE / INCOMPLETE BY DESIGN
Audit branch: `audit/ux-contextual-20260905`
Baseline main SHA: `530f31e9a33e94a652bbd73b2c7ccbe627ab0bad`
Baseline release change: PR #130, 47 commits, 356 files, +58,055 / -4,830 lines
Established: 2026-09-05 CDT

## Persistent objective

Make QuotePilot easier to understand and operate at every decision point across the complete business lifecycle. Bring relevant information and safe actions to the operator's current context, and remove unnecessary interpretation, navigation, memory burden, and interaction cost.

Lifecycle under audit:

`Inquiry -> Customer -> Quote -> Proposal -> Decision -> Acceptance -> Payment -> Event Execution -> Staffing -> Readiness -> Delivery -> Closeout`

Mandatory deep dives: Opportunity and Organization Setup / Library configuration.

This audit does not finish when a few repairs pass tests. Completion requires accounted-for coverage, a confusion register, context-switch audit, interaction grammar, ranked repair plan, validated selected repairs, and explicit remaining gaps.

---

## 1. Revision and evidence boundary

### Established

- Current GitHub `main` head is `530f31e9a33e94a652bbd73b2c7ccbe627ab0bad`, merge commit for PR #130, titled `Release v0.17.0: combined UX, tenant workflows and RagnaKoK activation`.
- PR #130 merged 47 commits and changed 356 files with 58,055 additions and 4,830 deletions.
- The PR's own release contract says real-tenant piloting and human acceptance were not established by the PR.
- `PROJECT_STATUS.md`, last updated before the merge completed, records extensive local/source/browser qualification but explicitly keeps real-tenant piloting and human acceptance separate.
- Production deployment workflows bind `VITE_AMBIENT_UI_ENABLED=true`, so the Ambient graph is intended to be production-selected when those workflows build the frontend.
- The public GitHub Releases collection does not currently provide a v0.17 release object. The repository evidence available in this audit therefore does not yet prove the exact currently deployed frontend SHA.

### Not established in this audit yet

- Exact current Firebase Hosting production SHA/readback.
- Exact current Vercel production SHA/readback.
- Whether the operator's browser session is on the latest deployment and tenant gate combination.
- Firsthand authenticated browser inspection from this audit session.

Existing repository browser tests and prior browser evidence are usable as supporting evidence, but they are not relabeled as firsthand observation.

---

## 2. Primary working diagnosis

The 58K-line release materially expanded **capability, authority, evidence, recovery, configuration, and validation**, but it did not produce a proportionate change in the app-wide **interaction topology**.

The dominant interaction pattern remains approximately:

`summary/list -> click action -> navigate to exact route -> operate there -> return to prior route`

The repository invested heavily in making those route transitions safer:

- exact-arrival contracts;
- return-context tokens;
- Back/Forward restoration;
- route-specific recovery states;
- action acknowledgements;
- feature/capability surfacing contracts.

Those are strong mechanisms. They reduce the cost of navigation **after navigation has already been chosen**. They do not answer the higher-level UX question:

> Did this intent need navigation at all?

The Ambient layer already contains the beginnings of a better interaction grammar (`InlineValue`, `ContextSurface`, local contextual editing, Quick Updates), but that grammar is not yet applied consistently across the whole application. The result is a product whose internals and safety model advanced dramatically while its operator experience can still feel like the same set of routed modules.

This is the principal hypothesis to falsify or confirm as coverage expands.

---

## 3. Product atlas and coverage ledger

Coverage states:

- `NI` not inspected
- `SI` source inspected
- `BE` prior/browser-test evidence inspected
- `FR` findings recorded
- `RI` repair implemented
- `RV` repair validated
- `BL` blocked by named evidence gap

| Area / route | Primary actor | Object / goal | Current interaction family | Coverage | Initial note |
|---|---|---|---|---|---|
| App shell / primary navigation | admin, sales | Orient across daily work | Navigate / global actions | SI, FR | Ambient primary navigation is Now, Opportunities, Operations, Clients, Library; secondary tools remain routed. |
| `/app` Now | admin, sales | Decide what needs attention now | Decision ledger -> routed resolution | SI, BE, FR | Stronger prioritization landed, but most resolutions still hand off to Workflow, Client, or Calendar routes. |
| `/app/quotes` Opportunities | admin, sales | Scan commercial work and resolve next step | List -> details disclosure -> route | SI, BE, FR | Mandatory deep dive. Primary action still resolves to Workflow or Opportunity route. |
| `/app/quotes/:quoteId` Opportunity | admin, sales | Understand and act on one commercial/event object | Living object + many contextual controls + routed continuations | SI, BE, FR | Mandatory deep dive. Best local use of ContextSurface, but action density remains high and contextual grammar is not generalized. |
| `/app/quotes/:quoteId/edit` Workbench | admin, sales | Compose/edit quote | In-place living-object editing | SI, BE | Strong convergence candidate; inspect further for cognitive load and editor transitions. |
| Guided quote mode | admin, sales | Sequential quote editing | Stepper | SI, BE | Alternate presentation over same draft; not currently a primary root-cause suspect. |
| `/app/customers` Clients | admin, sales | Scan relationships | List -> client route | SI, BE, FR | Improved relationship framing, still route-led. |
| `/app/customers/:customerId` Client 360 | admin, sales | Relationship history and current work | Relationship ledger -> routed Opportunity / Conversation / Workflow | SI, BE, FR | Better composition; still many continuations require route changes. |
| `/app/operations` Calendar-first Operations | admin, sales | Understand committed work in time | Calendar -> selected-event detail -> route | SI, BE, FR | Calendar convergence is real; selected-event actions still use `Open opportunity`, Control Room, Replay routes. |
| `/app/schedule` compatibility | admin, sales | Calendar compatibility arrival | Navigate | SI | Compatibility route remains intentionally available. |
| `/app/events` | admin, sales | Event list / event focus | Navigate | SI | Needs deeper source/browser inspection. |
| `/app/events/:quoteId` Event Focus | admin, sales | Exact event context | Detail -> routed subcontexts | SI, FR | Current event operations are composed here but route modes remain separate. |
| `/app/events/:quoteId/live` Control Room | admin, sales | Execute booked event | Dedicated workspace | SI, FR | Full workspace is justified for execution; should not be replaced by a popup. |
| `/app/events/:quoteId/replay` Replay | admin, sales | Inspect operational evidence/history | Dedicated workspace | SI, FR | Full workspace is justified for dense historical evidence. |
| `/app/workflow` | admin, sales | Bulk attention / exact task review | Dedicated route | SI, FR | Should remain for bulk work, but many single-item arrivals are candidates for contextual resolution. |
| `/app/messages` | admin, sales | Aggregate conversations | Dedicated route | SI, FR | Exact quote conversation should often be contextual; aggregate/search route can remain. |
| `/app/staff` | admin | Staff administration | Dedicated workspace | SI | Needs deeper inspection; likely justified as full workspace. |
| `/app/catalog` Library | admin, sales-read | Configure business building blocks | Ledger -> embedded editor/tabs | SI, BE, FR | Mandatory Organization Setup deep dive. |
| Library embedded AdminCatalogView | admin | Configure offers/components/templates/rules/pricing | 8-tab editor | SI, BE, FR | High cognitive/structural complexity; technical/editor taxonomy still leaks through. |
| Business Setup readiness rail | admin | Know what must be configured before quoting | Readiness list -> section navigation | SI, FR | Useful prioritization, but actions are generic destinations rather than consequence-led guided setup. |
| Workflow Configuration Studio | admin | Configure tenant workflow policy | Full configuration editor | SI | Full workspace/editor is justified; first-use technical detail remains a known concern in repository status. |
| `/app/imports` Import Studio | admin | Governed data import | Dedicated tool | SI, BE | Dedicated workflow likely justified; inspect transition into resulting Library objects. |
| `/app/integrations` | admin | Provider/system setup | Dedicated admin route | SI | Needs deeper inspection. |
| `/app/reporting` | admin, sales | Analyze business outcomes | Dedicated analysis route | SI | Dedicated workspace justified; contextual metrics can still surface elsewhere. |
| `/app/diagnostics` | admin/support | Diagnose session/system | Dedicated admin route | SI | Correctly secondary; not a daily navigation destination. |
| Customer portal exact token | customer | Review exact proposal and decide | Customer-safe projection | SI, BE | Needs customer-journey inspection; internal route model should not leak here. |
| Account / workspace tools overlay | staff | Account, tools, secondary destinations | Modal/dialog -> routes | SI, FR | Improved hierarchy, but currently acts partly as a directory of routed features. |
| Search palette | staff | Find customer/quote | Search -> route | SI | Candidate for object preview/inspect-before-navigate. |

### Immediate coverage gaps

- Firsthand browser walkthrough of every route at current production deployment.
- Responsive and keyboard inspection for all secondary routes, not merely existing automated assertions.
- Financial/payment journey as one end-to-end operator task.
- Customer portal journey from proposal arrival through decision/change request.
- Organization setup journey from blank tenant through first safe quote.
- Full event execution journey through staffing, attendance, actuals, closeout.

---

## 4. Deep dive: Opportunities and Opportunity

### Current source-supported model

The Opportunities stream is calmer than a traditional CRM table. Each row composes identity, lifecycle, date/venue/guest context, one dominant next action, and a `Details` disclosure for momentum plus booking/payment state.

However, its resolution logic still chooses between:

- `onOpenWorkflow(...)`; or
- `onOpenOpportunity(...)`.

That means the list has improved **what it says** without fundamentally changing **how work is completed**.

The exact Opportunity is more advanced. It already uses anchored/mobile `ContextSurface` inspectors for bounded detail and action contexts, and the v0.17 work added attendance context plus Calendar handoff. This proves the repository already possesses the primitive needed for a broader contextual interaction system.

### Material findings

#### UX-001 — Route safety has become a substitute for route elimination
Classification: **INTERRUPT**
Severity: High
Confidence: High

The application has extensive machinery for exact route arrival and exact return. This is valuable, but it can mask a higher-level defect: many intents that are Inspect, Explain, Compare, or bounded Act are still modeled as Navigate.

Impact:
- app feels structurally unchanged despite capability growth;
- operator still experiences module-to-module handoffs;
- more code is spent preserving context across route changes instead of avoiding unnecessary route changes.

Direction:
- retain return-context infrastructure as a fallback/deep-work mechanism;
- introduce a decision rule that tests whether a full context change is necessary before creating a route handoff.

#### UX-002 — The contextual interaction grammar is trapped inside Opportunity
Classification: **INTERRUPT**
Severity: High
Confidence: High

`ContextSurface` is a mature anchored desktop/mobile-sheet primitive with focus restoration, keyboard trapping, explanation, consequence, empty-state protection, and responsive positioning. Yet Now, Clients, Search, Calendar, and other surfaces still commonly route to another workspace for basic inspection or bounded work.

Direction:
- promote `ContextSurface` from Opportunity-specific pattern to shared object-inspection infrastructure;
- do not create separate ad-hoc popovers for each surface.

#### UX-003 — Opportunity has action atomization, not yet action hierarchy
Classification: **INTEGRATE**
Severity: High
Confidence: Medium-High

The Living Opportunity has many separately registered action IDs and multiple local context triggers. The safety model is strong, but the user can experience the object as a field of individual clickable affordances.

Likely improvement:
- establish an object-level action hierarchy:
  1. one dominant Next action;
  2. direct inline edits for obvious scalar facts;
  3. a small number of object inspectors (Customer, Commercial, Event, Staffing, Evidence);
  4. low-frequency actions inside contextual menus/disclosures;
  5. full route only for sustained complex work.

Browser validation is required before changing specific controls.

#### UX-004 — Opportunity-to-Calendar is still a context jump even for simple inspection
Classification: **INTEGRATE**
Severity: Medium
Confidence: High

v0.17 adds `Open Calendar` / `Open in Calendar`. That is correct when the operator intends to work spatially/temporally in Calendar. It is excessive if the immediate intent is only: “What else is happening around this event?” or “Is there a conflict?”

Direction:
- retain Open Calendar for real operational navigation;
- add an in-context schedule inspector for nearby events, conflict evidence, and event slot when the user's intent is inspection.

#### UX-005 — Opportunity list `Details` is information disclosure, not contextual object intelligence
Classification: **INTEGRATE**
Severity: Medium
Confidence: High

The list disclosure exposes momentum and booking/payment facts but does not become an actionable object inspector. The operator still opens the full Opportunity or Workflow to act.

Direction:
- test a single row inspector / side sheet that combines current decision, latest customer context, commercial state, payment status, and the exact bounded action when safe.

#### UX-006 — Workflow is still too often the destination rather than an authority rendered contextually
Classification: **INTEGRATE**
Severity: High
Confidence: High

The convergence contract explicitly intended Workflow to become contextual for exact single-item work. Now and Opportunity still retain exact Workflow route arrivals.

Direction:
- preserve `/app/workflow` for bulk queue/search;
- render exact approval/change-request/follow-up review as contextual task surfaces from Now, Opportunity, and Client when the task is bounded;
- escalate to full Workflow only when multiple records/history/search are required.

---

## 5. Deep dive: Organization Setup / Library

### Current source-supported model

Library now presents a higher-level ledger:

- Offers
- Components
- Templates
- Pricing & Rules
- optional Workflow Configuration
- Business Setup readiness rail

Opening an item mounts `AdminCatalogView` as an embedded editor. That editor still exposes eight tabs:

`Setup, Offers, Addons, Rentals, Menu, Templates, Rules, Pricing`

The underlying system is sophisticated: server-backed setup drafts, publication fences, revision awareness, readable structured rules with advanced JSON recovery, pricing policy, starter packs, templates, imports, and workflow configuration.

### Material findings

#### UX-007 — Organization Setup is split between “readiness” and “editor taxonomy”
Classification: **INTERRUPT**
Severity: High
Confidence: High

The readiness rail answers “what is unresolved,” while the embedded editor answers “which data category do you want to edit?” These are different mental models.

A new or occasional administrator should be guided by business outcomes:

- identify my business;
- define what I sell;
- define components;
- define how I price;
- define reusable event starting points;
- define operating workflow;
- connect services;
- invite people;
- publish safely.

Instead, the user is eventually exposed to a tab inventory aligned with implementation categories.

Direction:
- make Organization Setup a consequence-led guided workspace;
- keep Library as the ongoing object-management workspace after setup;
- the same underlying editors can be reused; do not duplicate state or persistence.

#### UX-008 — “Setup” is simultaneously a tab, a readiness program, and a tenant lifecycle concept
Classification: **INTEGRATE**
Severity: Medium-High
Confidence: High

The word Setup is overloaded. `BusinessSetupCenter`, `Setup` tab, setup draft, starter pack, Library setup, workspace tools, and provider setup all exist.

Direction:
- reserve **Business Setup** for the tenant-level outcome journey;
- rename the embedded `Setup` editor concept based on its actual function (for example Starting Point / Starter Pack / Import & Start) after browser inspection;
- avoid asking users to infer which kind of setup they are in.

#### UX-009 — Setup actions navigate to categories without enough consequence preview
Classification: **INTEGRATE**
Severity: High
Confidence: High

`BusinessSetupCenter` identifies the first unresolved area and offers actions such as `Open offers and menus`, `Configure pricing`, `Manage templates`, or `Open workspace tools`. It does not yet consistently answer:

- what will become possible after this step;
- what specifically is missing;
- whether existing published behavior changes;
- whether only new quotes are affected;
- whether this is a draft or immediate mutation.

Direction:
- turn readiness rows into inspectable setup decisions with reason, consequence, current value/evidence, and safe next action;
- open the relevant editor only after the user chooses to change it.

#### UX-010 — Technical configuration depth is exposed too early
Classification: **INTEGRATE**
Severity: High
Confidence: High

`AdminCatalogModal.jsx` still contains JSON-oriented advanced configuration fields and a large rule/pricing editing surface. The repository itself already records that Configuration Studio exposes technical detail too early.

Direction:
- enforce progressive disclosure as a product invariant:
  `business outcome -> readable current policy -> structured edit -> advanced source/recovery`;
- JSON/source editing remains an expert/recovery capability, not a default setup experience.

#### UX-011 — Library and Business Setup are visually converged but not yet behaviorally unified
Classification: **INTEGRATE**
Severity: Medium
Confidence: Medium-High

The v0.17 Library layout is a real improvement, but the workflow is still mostly “select category -> open embedded tabbed editor -> return.” The operator receives a better map without a fundamentally different interaction model.

Direction:
- allow bounded object inspection and common edits directly from Library ledger rows;
- reserve embedded full editor for structural changes, bulk management, and multi-step configuration.

#### UX-012 — Tenant configurability is not yet expressed as an understandable operating model
Classification: **RECORD**
Severity: Strategic
Confidence: High

The backend can now represent offers, templates, rules, pricing, workflow definitions, and bounded operational configuration. The UX still presents these mostly as independent configuration objects.

Long-term direction:
- Configuration should increasingly answer **How does our organization operate?**
- expose relationships: Offer uses Components + Pricing + Rules; Template starts from Offer; Workflow governs timing/review; customer and event experiences consume those choices.
- configuration changes should show affected future behavior and historical non-impact where relevant.

---

## 6. Cross-app systemic findings

#### UX-013 — Feature surfacing is being measured more strongly than interaction compression
Classification: **INTERRUPT**

The release has a large capability-surfacing contract binding 122 callable exports to surfaces and tests. This proves discoverability/exposure at a technical-contract level. It does not prove that the operator experiences fewer decisions, fewer surfaces, or less navigation.

Add an **interaction compression contract** alongside capability surfacing:

For each common journey measure:
- primary context changes;
- secondary overlays;
- backtracks;
- distinct surfaces visited;
- facts the operator must remember between surfaces;
- actions requiring a route that could be bounded in place.

#### UX-014 — Current acceptance criteria over-reward “correct arrival”
Classification: **INTERRUPT**

Many current tests correctly prove exact destination, return focus, and Back/Forward behavior. Add tests that prove **the route is not entered** for intents reclassified as Inspect / Explain / bounded Act.

#### UX-015 — The app lacks a shared “inspect any business object” layer
Classification: **INTEGRATE**

Reusable inspectors should be considered for:
- Customer
- Opportunity / quote
- exact quote version
- Payment
- Event slot / conflict
- Staff member / staffing assignment
- Workflow task
- Acceptance / receipt
- Library object

Each inspector must be a projection over existing authority, not a new source of truth.

#### UX-016 — The UI should compose sibling authorities without forcing sibling workspaces
Classification: **INTEGRATE**

The tenant data model correctly keeps independent authorities as siblings. The UX should not mirror that physical separation into mandatory navigation. A composed screen or inspector may show payment + workflow + staffing + event facts together while preserving their independent sources and mutations.

---

## 7. Interaction pattern system — initial contract

| Intent | Default mechanism | Full route threshold |
|---|---|---|
| Navigate | Route/workspace | The user is changing primary work context. |
| Inspect | ContextSurface / side inspector / inline disclosure | Dense sustained review, stable URL, deep linking, or multi-object navigation needed. |
| Act | Inline action or contextual sheet | Multi-step/high-consequence/irreversible flow needs stable workspace. |
| Compare | Side-by-side local composition / inspector | Large datasets, persistent analysis, or complex scenario work. |
| Explain | Inline evidence / Why / provenance disclosure | Documentation itself is the task. |
| Configure | Guided setup or focused editor | Structural/bulk configuration justifies full editor. |

Rules:

1. Do not replace every link with a popup.
2. Do not navigate merely because a destination route already exists.
3. Preserve a full workspace for sustained work; use contextual surfaces for bounded intent.
4. Never duplicate authority in an inspector.
5. Every contextual action names consequence and evidence boundary.
6. A healthy state compresses; uncertainty expands.
7. One object should expose a clear action hierarchy rather than making every fact equally clickable.

---

## 8. Context-switch audit — first confirmed candidates

| Source | Trigger/current behavior | Actual intent | Current destination | Candidate mechanism | Verdict |
|---|---|---|---|---|---|
| Now | Review exact workflow item | Act / Inspect | `/app/workflow?...` | Contextual task inspector; full Workflow as escalation | High-value candidate |
| Now | Client-related attention | Inspect / Act | Client route | Client inspector or exact bounded action | Candidate |
| Now | Upcoming event `Open in Calendar` | Inspect or Navigate | Operations Calendar | In-context event-slot inspector for Inspect; retain Calendar for Navigate | Candidate |
| Opportunities | Primary row action | Act | Workflow or Opportunity route | Row/object inspector when task bounded | High-value candidate |
| Opportunities | Details | Inspect | Inline `<details>` | Upgrade toward object inspector if decision/action needed | Candidate |
| Client 360 | `Open opportunity` | Inspect or Navigate | Opportunity route | Opportunity inspector for quick context; route for sustained work | Candidate |
| Client 360 | Conversation | Inspect / Act | Messages route | Quote-scoped conversation sheet for normal reply/read | High-value candidate |
| Operations | `Open opportunity` | Inspect or Navigate | Opportunity route | Opportunity inspector for basic commercial context | Candidate |
| Opportunity | `Open Calendar` | Inspect or Navigate | Operations | Event-slot/conflict inspector + retained full Calendar | Candidate |
| Business Setup | unresolved readiness action | Explain / Configure | Embedded catalog tab | Setup decision inspector -> focused editor | High-value candidate |
| Library | Manage object | Inspect / Configure | Full embedded tabbed editor | object inspector/common edit; full editor for structural work | High-value candidate |
| Search | result selection | Inspect or Navigate | Customer/Quote route | quick object inspector + explicit Open workspace | Candidate |

---

## 9. Ranked repair program

### P0 — Establish app-wide contextual object inspection
Classification: **INTERRUPT**

Extend the existing `ContextSurface` grammar into a reusable host-level object-inspector layer rather than adding unrelated popovers.

First targets:
1. Opportunity summary
2. Client summary
3. Workflow task
4. Event slot/conflict
5. Payment/commercial state

Why first: it changes the app's interaction topology and makes existing backend work visible in-place.

### P1 — Opportunity action hierarchy pass
Classification: **INTERRUPT**

Audit every visible action on the exact Opportunity at 1440/768/390 and classify it Navigate / Inspect / Act / Compare / Explain / Configure. Reduce peer-level click targets. Preserve one dominant Next action and a small number of object-context triggers.

### P1 — Business Setup outcome journey
Classification: **INTERRUPT**

Create a tenant-level guided setup model over existing Library authorities. Do not create new persistence. Make each unresolved area explain current evidence, business consequence, what completion unlocks, publication effect, and next action.

### P1 — Exact workflow task contextualization
Classification: **INTEGRATE**

Keep Workflow for bulk review. Handle bounded exact tasks from Now / Opportunity / Client without a full route when safe.

### P2 — Search becomes inspect-first
Classification: **INTEGRATE**

Search results should provide an object preview/inspector and an explicit Open workspace action rather than treating route navigation as the only result behavior.

### P2 — Calendar / Opportunity bidirectional inspectors
Classification: **INTEGRATE**

Calendar should expose commercial/customer context without forcing an Opportunity route; Opportunity should expose nearby schedule/conflict context without forcing Calendar.

### P2 — Conversation contextualization
Classification: **INTEGRATE**

Keep global Messages for aggregate/search use. Add exact quote/client conversation sheets for normal contextual read/reply flows.

### P3 — Interaction compression metrics and gates
Classification: **INTEGRATE**

Add journey-level acceptance that measures context changes and disallows newly unnecessary route transitions.

---

## 10. What not to do

- Do not redesign from scratch.
- Do not flatten bounded business authorities into one mega-object.
- Do not add another quote builder, schedule engine, workflow engine, or setup database.
- Do not replace every route with a modal.
- Do not make a contextual sheet into a miniature full app.
- Do not judge success by added components, route coverage, or test count alone.
- Do not score whole-product UX until browser coverage is broad enough to justify it.

---

## 11. Validation contract for future repairs

For each repaired journey record before/after:

- route/context transitions;
- number of interactive controls involved;
- surfaces visited;
- backtracking steps;
- information that must be remembered between surfaces;
- exact authority used;
- keyboard/focus behavior;
- 390 / 768 / desktop behavior;
- error and stale-data behavior;
- browser Back/Forward behavior if a route remains;
- whether the change is source-only, locally browser-validated, hosted, production-observed, or human-accepted.

A repair is not `RV` until its applicable validation is recorded.

---

## 12. Next audit expansion

1. Browser-inspect exact Opportunity and enumerate every visible interactive target at desktop/tablet/mobile.
2. Browser-inspect blank and mature Organization Setup journeys.
3. Trace one exact attention item from Now and decide whether Workflow route is actually required.
4. Trace one exact Client -> Opportunity -> Conversation journey and count context changes.
5. Trace one Operations event -> commercial context -> Control Room journey.
6. Trace payment from accepted quote through request/provider evidence/balance.
7. Trace customer portal proposal -> decision -> change request.
8. Only then select the first implementation slice and record before/after evidence.

The current highest-leverage implementation hypothesis is a reusable **host-level contextual object inspector** built from the existing Ambient `ContextSurface`, followed by Opportunity and Organization Setup adoption. This remains a hypothesis until direct browser inspection confirms the target interactions.