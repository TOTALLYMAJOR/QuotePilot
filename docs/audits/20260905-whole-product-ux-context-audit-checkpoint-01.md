# QuotePilot Whole-Product UX Audit — Checkpoint 01

Parent ledger: `docs/audits/20260905-whole-product-ux-context-audit.md`
Audit branch: `audit/ux-contextual-20260905`
Baseline / deployed Vercel SHA: `530f31e9a33e94a652bbd73b2c7ccbe627ab0bad`
Date: 2026-09-05 CDT

## Executive checkpoint

The user's symptom is supported by repository evidence:

> QuotePilot gained far more capability than it gained interaction-topology change.

PR #130 added 58,055 lines and removed 4,830 across 356 files and 47 commits. The repository's own UX convergence ledger says the mixed branch's production `src/` delta was only net +6,756 at the named checkpoint; `src/` also contains nonvisual client models and utilities. Large portions of the release therefore went into backend authority, workflow/runtime, tests, evidence, contracts, documentation, import safety, release machinery and verification rather than pixels or operator interaction.

The exact merged SHA was successfully deployed to Vercel production in workflow run `34006160784`; the same SHA's RagnaKoK-scoped Firebase backend deployment succeeded in run `34005131796`. The user's observation is therefore not adequately explained by an old frontend deployment.

The stronger explanation is architectural: the UX convergence program optimized **safe preservation and convergence** more strongly than **interaction compression**.

---

## Causal chain

### 1. The release objective constrained visible discontinuity

The frozen convergence contract intentionally says:

- this is not a redesign from scratch;
- reuse, extend, compose and converge existing systems;
- minimize new architecture;
- preserve current routes where useful;
- maintain compatibility/rollback;
- make QuotePilot feel evolved rather than like another application.

Those are good constraints for safety. They also make a radical experiential change unlikely unless a separate interaction-topology objective is mechanically enforced.

### 2. Acceptance measured preservation more strongly than compression

The convergence acceptance suite extensively proves:

- one canonical form/state/pricing/save authority;
- existing functionality retained;
- exact routes and object arrivals;
- Back/Forward and return-context continuity;
- responsive composition;
- focus and accessibility;
- capability reachability;
- no duplicated authority.

The repository does **not** currently expose a comparable acceptance function for:

- context changes per common journey;
- surfaces visited per task;
- backtracking steps;
- facts remembered across surfaces;
- route transitions that should have been contextual inspection;
- interaction count before/after.

The result is a system that can prove every click is safe without proving there should be fewer clicks.

### 3. Existing interaction telemetry asks the wrong higher-level question

`ambientInteractionAudit` is useful: it detects dead clicks, late acknowledgements, empty destinations and mismatched contextual outcomes. It does not evaluate whether an enabled action should have been represented as a click, whether its destination should be a route, or whether the information could have appeared at the decision point.

Required extension:

`action correctness` + `interaction necessity` + `context-change cost`.

### 4. Route-preservation engineering became a local optimum

QuotePilot now has strong exact-arrival and return-context machinery. That makes this pattern robust:

`list/summary -> route -> exact object/task -> Back -> exact prior position`

But the target should often be:

`list/summary -> inspect/act in current context -> continue`

with a full route available only when the operator chooses sustained work.

### 5. Major capabilities can remain visually latent

Several new v0.17 capabilities are intentionally gated by role, tenant, source and lifecycle state. Examples include event operations, attendance and tenant workflow configuration. A tenant without the required booked/accepted exact-source evidence can legitimately see little of the capability even though the backend and tests grew substantially.

This is not a defect by itself. It means release-size is a particularly poor proxy for perceived product change.

---

## Refinement: the app needs a Context Layer, not just more ContextSurface

The first ledger proposed promoting `ContextSurface` app-wide. Source inspection changes that recommendation.

`ContextSurface` is an accessible **modal** anchored sheet: its wrapper covers the viewport, its dialog is `aria-modal`, it traps focus, and it is designed for bounded contextual work. Using it for every inspection would replace route overload with modal overload.

The target interaction stack should be:

### Level 1 — Object Peek

For **Inspect / Explain**.

Desktop: non-modal anchored card/side preview.
Mobile: may promote to a sheet.

Use for:
- customer identity/context;
- quote/opportunity summary;
- payment state and evidence headline;
- event slot/conflict summary;
- staff member / assignment summary;
- workflow-task explanation;
- Library object summary.

Properties:
- no new authority;
- read-only by default;
- Escape/click-away dismissal where appropriate;
- keyboard trigger and focus-safe semantics;
- explicit `Open workspace` escalation.

### Level 2 — Context Surface

For bounded **Act / Compare / Configure** where the current task should remain primary.

Examples:
- exact workflow approval/review;
- exact customer change-request triage;
- quote-scoped conversation read/reply;
- event conflict resolution when bounded;
- one setup decision with consequence preview.

### Level 3 — Workspace / Route

For sustained work, stable URL/deep link, complex multi-step activity, broad search, dense history, bulk operations, or high-consequence flows.

Examples that should remain full workspaces:
- Quote Workbench;
- global Workflow queue;
- global Messages inbox/search;
- Calendar/Operations;
- Control Room;
- Replay;
- Staff administration;
- Reporting;
- Import Studio;
- full structural Library editing;
- Workflow Configuration Studio.

Governing decision:

> Inspect locally. Act contextually when bounded. Navigate when the user is actually changing work context.

---

## New concrete findings

### UX-017 — Business Setup has a destination-contract defect

Classification: **INTERRUPT**
Severity: High for setup comprehension
Confidence: High

`businessReadiness.js` maps:

- Identity -> `pricing`
- Offerings -> `menu`
- Pricing -> `pricing`
- Costs -> `pricing`
- Starting points -> `eventTemplates`
- Staffing -> `pricing`
- Users -> `users`
- Connections -> `connections`

`BusinessSetupCenter` presents business-language actions such as:

- Update business identity
- Open offers and menus
- Configure pricing
- Record missing costs
- Manage templates
- Configure staffing
- Manage users
- Open workspace tools

But `AmbientLibraryRoute.openSetupSection` can only focus Library sections. `users` and `connections` fall into an explanatory acknowledgement: “Use Workspace and tools to review this separately governed setup area.” The action labelled **Open workspace tools** therefore does not actually open Workspace & tools.

This is exactly the kind of problem the current interaction audit can miss: it is not a dead click because it acknowledges, but it fails the operator's intended outcome.

Repair direction:
- give Business Setup an explicit typed destination contract;
- `library-section`, `workspace-tools`, `workflow-studio`, `imports`, etc. must resolve through the correct host action;
- test the destination, not merely the acknowledgement.

### UX-018 — Business-language setup actions are routed through implementation taxonomy

Classification: **INTERRUPT**
Severity: High
Confidence: High

Examples:
- `Update business identity` lands in Pricing because Business name currently lives there.
- `Configure staffing` lands in Pricing because staffing rate/policy fields live there.
- `Open offers and menus` resolves to the Menu section.

These are mechanically functional but semantically surprising. The operator thinks in business outcomes; the editor thinks in storage/editor tabs.

Repair direction:
- Business Setup owns the business-language journey.
- Existing Library editors remain underlying edit surfaces.
- Each setup task resolves to a specific focused field/group, not merely a broad tab.

### UX-019 — Search is route-first by contract

Classification: **INTEGRATE**
Severity: Medium-High
Confidence: High

`CommercialSearchPalette` labels results `Open ...`; selecting a result immediately closes Search and invokes `onOpenCustomer` or `onOpenQuote`.

Search frequently serves an **Inspect** intent: “Which Henderson is this?” “What is the state of Q-1042?” “Is this the event next Friday?”

Repair direction:
- first selection can reveal an Object Peek with enough discriminator/context;
- explicit Open workspace remains available;
- keyboard flow must remain efficient for expert users who do intend immediate navigation.

### UX-020 — Exact conversation continuation still means route handoff

Classification: **INTEGRATE**
Severity: High
Confidence: High

The Ambient app's `openAmbientConversation` improves route handoff through exact-arrival and return-context machinery, but it still calls `navigateAmbientConversation`, which resolves to the Messages route.

The full `MessagingStation` is justified for aggregate inbox/search. A single quote/client conversation from Opportunity or Client is a different intent.

Repair direction:
- reuse the existing `QuoteConversationPanel` inside a bounded contextual action surface for exact conversations;
- retain Messages for bulk inbox/search and as escalation.

### UX-021 — Workflow is a powerful aggregate workspace being used for bounded tasks

Classification: **INTEGRATE**
Severity: High
Confidence: High

`SalesWorkflowModal` has tabs for attention, follow-ups, autopilot, debt and approvals, plus provider/action policy and timing. This breadth justifies the global route.

It also proves why routing a user there to resolve one known approval/change request/follow-up is costly: the destination is an aggregate workbench with much more cognitive scope than the initiating decision requires.

Repair direction:
- extract/reuse exact task renderer/controller as a contextual task surface;
- global Workflow remains canonical aggregate administration/review.

### UX-022 — Design QA proves target fidelity, not product transformation

Classification: **INTERRUPT** (process)
Severity: High
Confidence: High

Current design QA gives 9.5/10 GO verdicts to Now, Client 360, Library and portal compositions. Those reports explicitly distinguish local visual review from human acceptance. The target images themselves are relatively evolutionary.

A product can therefore pass visual fidelity while the operator correctly reports that the app still feels structurally unchanged.

Add a separate **Experiential Delta Review** asking:
- what can the user now understand without navigating?
- what task now takes fewer context changes?
- what previously hidden relationship is now visible?
- what existing capability became directly manipulable?
- what former route/module is now an escalation rather than the default?

### UX-023 — Data-model separation is leaking into interaction separation

Classification: **INTEGRATE**
Severity: Strategic
Confidence: High

QuotePilot correctly keeps customer, commercial version, workflow, staffing, payment, attendance, event operations and closeout authorities separate. That separation should remain in storage and mutation authority.

It should **not** require the operator to visit separate screens to inspect each authority.

A single decision surface can compose read projections from several sibling authorities while mutations continue to their existing owners.

This is the architectural key to “stretching the UI around the app.”

---

## Revised highest-leverage program

### P0 — Build and enforce the QuotePilot Context Layer

Not a new source of truth and not a new domain engine.

Required pieces:
1. typed object-ref / intent envelope;
2. read-only Object Peek host;
3. existing `ContextSurface` as bounded-action host;
4. escalation to existing routes;
5. source/authority attribution;
6. shared responsive/accessibility contract;
7. interaction-necessity acceptance tests.

First adapters:
- Opportunity
- Customer
- Workflow task
- Event slot/conflict
- Payment/commercial state

### P1 — Apply it to the highest-frequency seams

1. Now exact attention -> task context instead of default Workflow route.
2. Opportunities row -> Opportunity Peek; full workspace on escalation.
3. Client 360 active opportunity -> Opportunity Peek.
4. Client/Opportunity conversation -> quote-scoped contextual conversation.
5. Calendar selected event -> Opportunity/Customer/Payment Peek.
6. Opportunity -> Event-slot Peek; Calendar remains escalation.
7. Search -> inspect-first result behavior.

### P1 — Reframe Business Setup as an outcome journey

Business Setup should become:

`Identity -> Offers -> Components -> Pricing -> Starting points -> Workflow -> People -> Connections -> Review & publish`

For each step show:
- current evidence/state;
- what is missing;
- business consequence;
- what completion unlocks;
- draft vs immediate behavior;
- future-vs-existing-work effect;
- one safe next action.

Reuse existing Library, Workspace Tools and Workflow Studio editors through exact focused destinations.

### P2 — Add interaction-compression acceptance

For named golden journeys record before/after:
- context changes;
- route transitions;
- overlays;
- surfaces visited;
- backtracks;
- information-memory handoffs;
- clicks/keystrokes for the dominant task;
- route transitions avoided through local inspection/action.

A release that adds capability without improving any named journey must explicitly say so rather than being classified as a UX transformation.

---

## Current evidence classification

Established:
- exact source revision;
- exact Vercel production deployment of that revision;
- exact scoped Firebase backend deployment of that revision;
- source-level route/action topology;
- prior automated/browser/design evidence;
- Opportunity and Organization Setup source deep dives;
- several cross-workspace route handoffs.

Still blocked in this chat:
- authenticated firsthand browser walkthrough of production;
- user-observed interaction timing and confusion moments;
- direct measurement of common production journeys under the user's real data.

Those gaps prevent an honest whole-product numeric UX score. They do not prevent the interaction-topology diagnosis above.