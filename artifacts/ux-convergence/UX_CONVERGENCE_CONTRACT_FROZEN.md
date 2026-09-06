Act as QuotePilot’s Principal Product Systems Architect, UX Convergence Engineer, Information Architect, and Release-Readiness Owner.

Implement the next major QuotePilot UX convergence:

QUOTE COMPOSITION:
COMMERCIAL WORKBENCH + LIVING OBJECTS

APPLICATION OPERATIONS:
CALENDAR-FIRST OPERATIONS CONVERGENCE

This is not a redesign-from-scratch project.

It is a convergence project.

The objective is to make QuotePilot materially calmer, faster, more intelligible, and more modern by promoting the strongest systems already present in the repository, composing them into a coherent operator experience, and retiring redundant presentation structures.

Treat the repository as authoritative evidence.

This prompt describes the intended product outcome and known architectural direction. It does NOT override stronger current repository reality.

If the repository has evolved beyond an assumption here:

1. preserve the objective;
2. use the stronger existing architecture;
3. record the correction;
4. avoid rebuilding capability that already exists.

Do not make the user fully respecify the task when repository discovery can resolve it.

======================================================================
GOVERNING OBJECTIVE
======================================================================

Optimize for:

MAXIMUM USER-EXPERIENCE IMPROVEMENT
÷
MINIMUM NEW ARCHITECTURE

Prefer the solution that causes the greatest amount of existing QuotePilot work to become more valuable.

Use:

DISCOVER
→ REUSE
→ EXTEND
→ COMPOSE
→ CONVERGE
→ RETIRE REDUNDANCY

Never default to:

UX PROBLEM
→ INVENT PARALLEL SYSTEM
→ DUPLICATE STATE
→ MAINTAIN BOTH
→ RECONCILE LATER

If two approaches create equivalent outcomes, choose the one that:

- reuses more existing production code;
- preserves more validated behavior;
- introduces less state;
- introduces fewer abstractions;
- produces fewer parallel surfaces;
- keeps existing tests useful;
- reduces future maintenance;
- creates the clearest retirement path for superseded UI.

======================================================================
PRODUCT MODEL
======================================================================

The target QuotePilot information architecture is approximately:

NOW
What needs my attention now?

OPPORTUNITIES
What commercial work is moving or stuck?

OPERATIONS
What is happening in time and what must be executed?

CLIENTS
What do I know about this relationship?

LIBRARY
What reusable business rules, configuration, and content do we operate from?

Global capabilities:

NEW QUOTE
SEARCH
PILOT

System / administrative capabilities should remain available without competing with daily operator navigation.

Likely examples:

Reporting
Integrations
Import
Diagnostics
Account

Do not blindly implement these labels if repository reality has evolved.

Verify the current navigation and capability model first.

======================================================================
CORE ARCHITECTURAL PRINCIPLE
======================================================================

A route does not automatically deserve a permanent navigation item.

A capability does not automatically deserve its own workspace.

A backend subsystem does not automatically deserve a visible module.

Navigation should represent durable user intents, not repository structure.

Examples:

Workflow may remain an exact route without being a persistent primary destination.

Messages may remain a global route without forcing operators through a Messages module when the normal task is conversation within one Client or Opportunity.

Event routes may remain for direct arrival without requiring both Events and Schedule to exist as competing top-level destinations.

======================================================================
PART I — QUOTE COMPOSITION CONVERGENCE
======================================================================

The current Proposal Composer should be treated as the canonical substrate unless repository discovery proves otherwise.

Known repository direction to VERIFY:

- Proposal Composer is the default quote-composition surface.
- Guided mode is the existing wizard over the same form state.
- Proposal Composer already owns or composes:
  - InlineValue editing;
  - Quote Pulse;
  - pricing what-if calculations;
  - Menu editing;
  - staffing recommendations;
  - rental suggestions;
  - guest-change consequences;
  - margin presentation;
  - Compare Scenarios;
  - client preview;
  - Pilot/NL interactions;
  - save-state presentation;
  - explicit save authority.

Do NOT create another Quote Builder beside ProposalComposer.

The intended transformation is:

CURRENT PROPOSAL COMPOSER
        ↓
REORGANIZE / COMPRESS / FOCUS
        ↓
COMMERCIAL WORKBENCH + LIVING OBJECTS

======================================================================
QUOTE BUILDER TARGET EXPERIENCE
======================================================================

Desktop should communicate three distinct functional zones:

LEFT:
QUOTE PLAN

CENTER:
ACTIVE LIVING OBJECT

RIGHT:
COMMERCIAL TRUTH

Conceptually:

┌──────────────────┬──────────────────────────────────┬──────────────────┐
│ QUOTE PLAN       │ ACTIVE LIVING OBJECT             │ COMMERCIAL TRUTH │
│                  │                                  │                  │
│ Event         ✓  │                                  │ Total            │
│ Customer      !  │                                  │ Deposit          │
│ Experience    ●  │                                  │ Attention        │
│ Staffing      ●  │                                  │ Margin           │
│ Commercials   ●  │                                  │ Preview          │
└──────────────────┴──────────────────────────────────┴──────────────────┘

Do not mechanically reproduce this wireframe.

Use existing QuotePilot tokens, typography, interaction conventions, responsive patterns, and design-system primitives where strong.

The result should feel like QuotePilot evolved, not like another application mounted inside it.

======================================================================
QUOTE PLAN
======================================================================

Primary composition domains:

1. Event
2. Customer
3. Experience
4. Staffing
5. Commercials

These are PRESENTATION CONTEXTS over ONE quote draft.

They are not:

- new records;
- independent drafts;
- new persistence boundaries;
- separate pricing contexts;
- separate lifecycle objects.

The navigator should answer:

WHERE AM I?

WHAT STILL NEEDS ATTENTION?

Status markers may include:

current
complete
incomplete
attention

but only when derived from existing supported state.

Do not invent a new percentage-based quote-completion engine.

======================================================================
LIVING OBJECT PRINCIPLE
======================================================================

Each domain should be readable before fully editable.

Use:

SUMMARY
→ INSPECT
→ EDIT
→ PREVIEW CONSEQUENCE
→ COMMIT

rather than:

RENDER EVERY AVAILABLE CONTROL AT ONCE

The problem being solved is simultaneous information exposure.

Density is acceptable inside an intentionally opened detailed context.

Density is not acceptable across the entire quote page at once.

======================================================================
EVENT
======================================================================

Present concise event truth first:

Event name
Event type
Date
Time
Duration
Venue
Guests

Focused editing must reuse existing form/state authority.

No second Event editor.

Price-affecting changes continue through existing calculation and consequence paths.

======================================================================
CUSTOMER
======================================================================

Present:

Customer identity
Organization
Email
Phone
Important missing information

Missing data stays explicitly missing.

Do not synthesize customer identity.

Existing validation remains authoritative.

======================================================================
EXPERIENCE
======================================================================

Organize beneath one Experience context:

Package
Service style
Menu
Rentals
Enhancements

This is one of the most important density reductions.

The giant detailed Menu should not remain permanently expanded merely because Menu is complex.

Normal presentation should communicate something like:

Menu
17 selected
3 optional selections

[ Review menu ]

Opening Menu should expose the EXISTING Menu capability in a focused editing context.

Preserve all currently supported Menu behavior.

Do not rewrite Menu business logic.

======================================================================
MENU
======================================================================

Focused Menu must retain applicable existing capabilities such as:

- catalog sections;
- item groups;
- search;
- item selection;
- inclusion semantics;
- quantities;
- pricing basis;
- price-impact language;
- catalog-state evidence;
- keyboard accessibility;
- current automatic/default behaviors.

When Menu closes:

- Experience remains active;
- current selection is intact;
- summary reflects changes;
- focus returns to the opening control.

A large catalog is allowed to be detailed.

The user explicitly chose to enter Menu.

======================================================================
STAFFING
======================================================================

Present current versus recommended state distinctly.

Example:

STAFFING

Current
2 servers

Recommended
2 servers

Basis
24 guests · buffet service

Recommendation is not committed state.

Never auto-apply staffing merely because a recommendation exists.

Use existing staffing logic.

Do not claim:

staff availability
payroll
attendance
capacity
assignment

unless those authorities actually exist for the fact being shown.

======================================================================
RENTALS AND ENHANCEMENTS
======================================================================

Retain existing capabilities under Experience.

Guest-driven rental recommendations remain proposals.

Do not silently mutate quantities.

Enhancement selection remains tied to existing commercial calculations.

======================================================================
COMMERCIALS
======================================================================

The Commercials context may provide detailed pricing inspection.

Persistent Commercial Truth should remain visible outside this context where screen size permits.

The operator should never have to scroll through the entire quote to rediscover the total.

======================================================================
COMMERCIAL TRUTH RAIL
======================================================================

Evolve the strongest existing Quote Pulse/right-side summary rather than creating a competing second commercial rail.

Priority:

1. Quote total
2. Deposit
3. Current blockers / attention
4. Important commercial consequence
5. Margin/cost evidence
6. Scenario access
7. Preview
8. lower-priority evidence

Example:

QUOTE

$689.52
Deposit $206.86

────────────────

NEEDS ATTENTION 3

Event date missing
Venue missing
Customer email missing

[ Review ]

────────────────

MARGIN

Healthy

────────────────

[ Preview proposal ]

======================================================================
ATTENTION-DENSITY LAW
======================================================================

Apply this product rule across QuotePilot:

COMPLEXITY SHOULD SCALE WITH UNCERTAINTY.

Healthy evidence compresses.

Uncertain, stale, contradictory, incomplete, blocked, or recovery-required evidence expands.

Example:

Healthy:

Deposit
✓ $5,535 received

Uncertain:

PAYMENT NEEDS ATTENTION

The existing checkout does not yet establish settlement.

[ Check payment outcome ]

Do not hide uncertainty.

Do not force the operator to read technical evidence when everything is healthy.

======================================================================
BLOCKERS / READINESS
======================================================================

Reuse current blocker/readiness logic.

Do not build another blocker engine.

Promote exact actionable blockers.

Example:

NEEDS ATTENTION 3

• Event date missing
• Venue missing
• Customer email missing

[ Review ]

When an exact living-object context exists, blocker navigation should focus that context.

Do not send Event-date blockers to a generalized modal when Event can be opened directly.

Preserve non-field blockers, including applicable current states such as:

catalog load
quote edit load
Pilot scenario review
draft intent review
Commercial Change simulation
Commercial Change authorization

======================================================================
AI / PILOT IN QUOTE COMPOSITION
======================================================================

Preserve existing AI/NL capability.

Do not create a second AI edit path.

When idle, Pilot should have a compact footprint.

When active, proposed changes must be inspectable.

Example:

“Add another bartender and increase guests to 80.”

Guests
24 → 80

Bartenders
0 → 1

Projected consequence
existing authoritative preview

[ Review impact ]

AI must not bypass:

- pricing authority;
- blockers;
- catalog/revision fences;
- consequence review;
- save/version authority.

======================================================================
SCENARIOS
======================================================================

Preserve existing Compare Scenarios capability.

Make it contextually discoverable from:

Commercials
Experience
or Commercial Truth

Do not build another scenario engine.

Do not permanently render comparison detail during ordinary composition.

======================================================================
CLIENT PREVIEW
======================================================================

Preserve current draft/client preview behavior.

Do not expose internal:

- costs;
- margin;
- blockers;
- recommendations;
- administrative evidence;

unless already intended customer content.

Unsaved preview remains honestly described as an unsaved/draft preview.

Do not falsely imply it is the exact final portal artifact.

======================================================================
GUIDED MODE
======================================================================

Guided remains the existing wizard over the same form state unless repository reality proves otherwise.

Do not create a second Guided editor.

Workbench and Guided must share business truth.

Switching modes must not lose the draft.

======================================================================
ADVANCED PRICING
======================================================================

Keep advanced controls progressively disclosed.

Examples may include:

tax region
season profile
travel miles
rate overrides
rate mixes
payment method
validity detail

Do not introduce arbitrary per-quote catalog price overrides in this project unless the repository now has the complete server-authoritative model required to support them.

Do not fake support client-side.

======================================================================
ACTIVITY
======================================================================

Preserve current activity/audit capability.

Activity becomes secondary while healthy.

If an activity/evidence state requires operator action, it may be promoted through Attention.

Do not build another activity database.

======================================================================
PART II — OPERATIONS CONVERGENCE
======================================================================

The current Operations experience must be audited because it likely mixes too many unrelated destinations.

Known current candidates to VERIFY include items such as:

Clear the Deck
Operations
Events
Messages
Workflow
Pilot
Event Schedule
Staff
Reporting
Integrations
Import Studio
Diagnostics
Catalog Admin

Do not merely regroup these into prettier sections.

Solve the underlying information-architecture problem.

======================================================================
OPERATIONS PRODUCT RESPONSIBILITY
======================================================================

Opportunities owns:

COMMERCIAL STATE

Operations owns:

TIME + EXECUTION CONTEXT

For a catering/event business, the Calendar should become the primary operational lens if current repository capability supports it.

The current Schedule implementation appears to already provide meaningful behavior including:

- month view;
- week view;
- accepted/booked events;
- conflict detection;
- overlap detection;
- unknown-time warnings;
- capacity conflict detection;
- staff lead assignment;
- production checklist;
- kitchen checkpoints;
- run-of-show context.

VERIFY current behavior.

Reuse this.

Do NOT build another Calendar engine.

======================================================================
OPERATIONS TARGET
======================================================================

Primary Operations experience:

OPERATIONS

September 2026                         Month | Week

[ CALENDAR ]

Friday · September 11

Williams Wedding
Booked

5:00 PM
The Foundry
150 guests

Staff lead
Sarah

Production
8 / 10

[ Open event ]

Acme Dinner
Accepted

⚠ Conflict needs review

[ Review conflict ]

The Calendar should answer:

WHAT EVENTS OCCUPY TIME?

WHAT CONFLICTS?

WHAT EXECUTION CONTEXT EXISTS?

WHAT REQUIRES REVIEW?

======================================================================
CALENDAR VS QUOTE BUILDER
======================================================================

Do NOT embed a full month/week calendar in the Commercial Workbench.

Quote Builder responsibility:

CONSTRUCT THE COMMERCIAL EVENT

Operations/Calendar responsibility:

PLACE THE COMMITTED EVENT IN THE BUSINESS'S TIME/EXECUTION ENVIRONMENT

Event may expose contextual handoff:

[ Open in Calendar ]

Calendar may expose:

[ Open Opportunity / Event ]

These are coordinated contexts, not duplicate products.

======================================================================
EVENTS VS CALENDAR
======================================================================

Do not treat Events and Event Schedule as mandatory equal top-level destinations.

Calendar may become the operational event index.

Exact `/events/...` routes may remain for deep linking and event focus.

A route does not need a persistent navigation slot.

Normal flow should be approximately:

Operations / Calendar
        ↓
select event
        ↓
Event Focus / Living Opportunity / supported operational context

Do not delete event routes merely because navigation changes.

======================================================================
WORKFLOW
======================================================================

Workflow should increasingly be entered contextually.

Examples:

NOW
Approval waiting
[ Review approval ]
        ↓
exact Workflow item

OPPORTUNITY
Customer requested changes
[ Review request ]
        ↓
exact Workflow item

Do not require normal users to remember:

Operations
→ Workflow
→ locate quote
→ locate task

Keep the global Workflow route if useful for bulk review/search.

But evaluate whether it must consume persistent navigation.

======================================================================
MESSAGES
======================================================================

Communication should usually be contextual:

Opportunity
→ Conversation

Client
→ Conversation

Now
→ unread customer message
→ exact Conversation

A global Messages route may remain for aggregate/search workflows.

Do not assume that requires a permanent Operations-menu slot.

======================================================================
PILOT
======================================================================

Pilot is horizontal capability.

It should not conceptually belong to Operations.

Pilot should remain globally reachable where supported.

Examples:

Now
Opportunity
Quote Builder
Client
Operations/Calendar
Library

Prefer existing global command infrastructure.

Do not create another Pilot implementation.

======================================================================
CLEAR THE DECK
======================================================================

Clear the Deck is an attention/decision mode.

Conceptually it belongs with Now rather than being treated as a separate operational subsystem.

Preserve existing route/behavior as needed.

Evaluate whether the normal user should enter it through Now instead of Operations.

======================================================================
STAFF
======================================================================

Staff/People is operational context.

Do not duplicate the Staff workspace inside Calendar.

Calendar may link to existing Staff/People capability.

Example:

Operations

Calendar                       [ People ]

This keeps one Staff authority.

======================================================================
REPORTING
======================================================================

Reporting is analysis, not day-to-day execution.

Preserve existing Reporting capability.

Do not force it into the core operational calendar.

It can remain a secondary/admin destination or contextual Insights entry.

======================================================================
INTEGRATIONS / IMPORT / DIAGNOSTICS
======================================================================

These are system/administrative capabilities.

Do not treat them as equal peers of daily event execution.

Preserve exact functionality.

Move their navigation into an appropriate System/Admin layer rather than deleting them.

======================================================================
LIBRARY / CATALOG
======================================================================

Catalog administration belongs conceptually with Library.

Do not leave Catalog duplicated beneath Operations when Ambient Library already owns the business-building-block mental model.

Preserve current admin authority.

======================================================================
OPERATIONS FIRST RELEASE
======================================================================

Avoid replacing 12 Operations items with 12 tabs.

Preferred initial convergence:

OPERATIONS

Calendar                [ People ] [ Reporting ]

Calendar is the primary surface.

People routes to existing Staff.

Reporting routes to existing Reporting.

Exact Workflow, Messages, Integrations, Import, Diagnostics, Events and other routes remain available through contextual/global/admin navigation where appropriate.

======================================================================
LIVE OPERATIONS CLAIM BOUNDARY
======================================================================

Do not describe the current Calendar/Event planning surface as a fully authoritative live Control Room unless repository authority supports:

- live event phase;
- issue records;
- current stage;
- live staff check-ins;
- actual timestamps;
- actual task completion;
- immutable event replay.

If those data models remain absent, use truthful language such as:

Planning
Calendar
Event operations planning

Do not fake live telemetry.

======================================================================
NOW + CALENDAR
======================================================================

Now should not embed a giant calendar.

It may show a compact temporal horizon.

Example:

UPCOMING

Tomorrow
Williams Wedding · 5:00 PM
Production 8/10

Friday
2 events
⚠ Conflict

[ Open Calendar ]

Now answers:

WHAT MATTERS?

Calendar answers:

WHAT EXISTS IN TIME?

Keep those distinct.

======================================================================
OPPORTUNITY → OPERATIONS TRANSITION
======================================================================

Commercial commitment should hand naturally into operational planning.

Conceptually:

OPPORTUNITY
commercial commitment
        ↓
accepted / booked
        ↓
OPERATIONS / CALENDAR
operational occupancy
        ↓
EVENT CONTEXT
execution planning

Do not create a duplicate event record to make this transition.

Reuse quote/event identity and existing projections.

======================================================================
PART III — APP NAVIGATION CONVERGENCE
======================================================================

Evaluate the canonical primary navigation against this target:

NOW
OPPORTUNITIES
OPERATIONS
CLIENTS
LIBRARY

Do not blindly force five items if repository evidence demonstrates a stronger structure.

But treat this as the preferred information architecture unless disproven.

Global actions:

NEW QUOTE
SEARCH
PILOT

Secondary system/admin layer:

Reporting
Integrations
Import
Diagnostics
Account
other genuinely administrative tools

Do not turn the primary navigation into a comprehensive feature inventory.

======================================================================
PART IV — REALITY DISCOVERY
======================================================================

Before modifying code:

1. confirm current main SHA;
2. confirm working-tree/repository state;
3. read AGENTS.md;
4. read docs/DOC_SYSTEM.md;
5. read current PROJECT_STATUS / PROJECT_STATE;
6. read FEATURE_MATRIX;
7. read Proposal Composer plan/spec;
8. read Control Room/Operations plan/spec;
9. inspect design memory/design-system guidance;
10. inspect applicable repository-local skills;
11. map current WorkspaceShell navigation;
12. map current Workspace routes;
13. map current ProposalComposer tree;
14. map Guided mode;
15. map Quote Pulse;
16. map Menu;
17. map staffing;
18. map blockers/readiness;
19. map scenario comparison;
20. map Pilot/NL;
21. map EventScheduleView;
22. map Event/Operations surfaces;
23. map Staff;
24. map Reporting;
25. map Workflow;
26. map Messages;
27. map Integrations/Import/Diagnostics;
28. inspect current mobile shell;
29. inspect relevant tests;
30. inspect feature flags/rollback paths.

Trace:

Quote composition:
operator intent
→ form
→ selection
→ pricing
→ readiness
→ consequence
→ save/version
→ preview

Operations:
accepted/booked quote
→ schedule projection
→ conflict/readiness context
→ staff/production planning
→ event focus

Navigation:
primary intent
→ route
→ exact object/task
→ contextual continuation

======================================================================
REUSE LEDGER — REQUIRED
======================================================================

Before structural implementation classify every major capability as:

REUSE
EXTEND
MOVE
COMPOSE
RETIRE
NEW

At minimum include:

ProposalComposer
proposalComposerPresentation
Guided wizard
InlineValue
Quote Pulse
Menu editor
staffing recommendation
rental suggestion
guest consequences
blockers/readiness
Pilot
scenario comparison
client preview
save/version path
Calendar/Schedule
Event Focus
Workflow
Messages
Staff
Reporting
Integrations
Import
Diagnostics
Catalog/Library
WorkspaceShell
route model
mobile navigation

NEW must be the smallest category.

For every NEW capability state:

Why is existing capability insufficient?

Does this introduce state?

Does this introduce business truth?

Will this survive in the intended end-state architecture?

What becomes simpler or disappears because of it?

If the answer is weak, do not create it.

======================================================================
MIGRATION / RETIREMENT CONTRACT
======================================================================

Every affected presentation must be classified:

CANONICAL
ALTERNATE
COMPATIBILITY
TRANSITIONAL
RETIRE WHEN SAFE

Do not finish the project with ambiguous duplicate canonical surfaces.

Expected direction to verify:

Modernized ProposalComposer
= CANONICAL QUOTE COMPOSITION

Guided wizard
= ALTERNATE SEQUENTIAL PRESENTATION

Legacy/flag-off quote UI
= COMPATIBILITY / ROLLBACK

Calendar-first Operations
= CANONICAL OPERATIONS INDEX

Event exact routes
= CONTEXTUAL / DEEP LINK

Global Workflow
= SECONDARY / TASK REVIEW

Global Messages
= SECONDARY / AGGREGATE COMMUNICATION

System tools
= ADMIN / SYSTEM

Any retained duplication must have an explicit reason and retirement condition.

======================================================================
OUT-OF-SCOPE CAPABILITY CREATION
======================================================================

Do not silently add:

continuous autosave
new budget model
arbitrary per-quote catalog price override
structured dietary conflict detection
new predictive AI
new scenario engine
new payment engine
new messaging engine
live operational telemetry
new replay model
staff check-in model
weather integration
inventory reservation system
new calendar engine
new Staff authority
new lifecycle model

unless repository discovery proves these already exist sufficiently and they are merely being reused.

======================================================================
CHANGE-BUDGET GUARD
======================================================================

For the Quote Builder convergence, previous planning suggested a rough magnitude around several thousand changed/additional LOC including tests/docs.

Do not treat this as a quota.

Treat it as an architectural smoke detector.

For each implementation slice:

If code growth is materially higher than expected:

STOP.

Audit for:

duplicate state
duplicate selectors
duplicate editors
duplicate Menu
duplicate Schedule
duplicate navigation shell
duplicate mobile implementation
unnecessary transitional layers

Any project approaching 10k incremental LOC purely to reorganize existing UX must justify why convergence required that scale before continuing.

======================================================================
PART V — ACCEPTANCE CONTRACT
======================================================================

Every AC must finish as:

PASS
FAIL
NOT APPLICABLE
UNVERIFIABLE

UNVERIFIABLE is never silently converted to PASS.

For CRITICAL ACs:

FAIL
or
UNVERIFIABLE

means the candidate is NOT QUALIFIED.

No weighted average may compensate for a critical failure.

======================================================================
A — ARCHITECTURE / REUSE
======================================================================

AC-001 — ProposalComposer remains canonical
CRITICAL

Workbench modernization evolves/composes the existing canonical composer rather than introducing a second quote application.

AC-002 — One form state
CRITICAL

All five workbench domains read/write one canonical draft state.

AC-003 — One pricing authority
CRITICAL

No workbench component recomputes authoritative pricing separately.

AC-004 — One Menu state
CRITICAL

Focused Menu uses existing selection state and callbacks.

AC-005 — One staffing model
CRITICAL

Current/recommended staffing remains governed by existing logic.

AC-006 — One blocker/readiness model
CRITICAL

No unrelated duplicate readiness system is introduced.

AC-007 — One save path
CRITICAL

All workbench save operations use existing authority.

AC-008 — Guided shares form state
CRITICAL

Guided mode does not maintain a separate draft.

AC-009 — One AI mutation path
CRITICAL

Pilot changes use existing change/review/save authority.

AC-010 — New components presentation-only
CRITICAL

New orchestration components do not become business authorities.

======================================================================
B — STATE PRESERVATION
======================================================================

AC-011 — Domain switching is non-mutating

Changing active workbench domain performs no save by itself.

AC-012 — Unsaved Event edits survive context switching

AC-013 — Menu state survives context switching

AC-014 — Scenario inspection does not silently mutate quote

AC-015 — Guided ↔ Workbench preserves all supported unsaved state
CRITICAL

AC-016 — Existing quote identity/version semantics preserved
CRITICAL

======================================================================
C — WORKBENCH HIERARCHY
======================================================================

AC-017 — Desktop clearly communicates Quote Plan / Living Object / Commercial Truth

AC-018 — One major domain active at a time

AC-019 — Normal screen does not expose every detailed domain simultaneously

AC-020 — First desktop viewport reveals:
- quote/event identity;
- active domain;
- total;
- deposit;
- blocker/attention state.

AC-021 — Density reduction is not accomplished by simply wrapping everything in more cards

======================================================================
D — QUOTE PLAN
======================================================================

AC-022 — Exactly five primary composition domains unless repository evidence justifies a change

Event
Customer
Experience
Staffing
Commercials

AC-023 — Current domain is visible without relying only on color

AC-024 — Domain status markers are evidence-backed

AC-025 — Exact blockers focus the correct domain where possible

AC-026 — Every domain keyboard reachable

======================================================================
E — EVENT
======================================================================

AC-027 — Event first presents readable summary

AC-028 — Existing validation retained

AC-029 — Price-affecting Event changes update through existing pricing path

======================================================================
F — CUSTOMER
======================================================================

AC-030 — Customer fields round-trip unchanged

AC-031 — Missing/invalid email remains exact blocker

AC-032 — Missing identity is not fabricated

======================================================================
G — EXPERIENCE
======================================================================

AC-033 — Package, Service style, Menu, Rentals and Enhancements are organized under Experience

AC-034 — Package semantics unchanged
CRITICAL

AC-035 — Service-style semantics unchanged
CRITICAL

======================================================================
H — MENU
======================================================================

AC-036 — Closed Menu presents meaningful summary

AC-037 — Detailed Menu only opens intentionally

AC-038 — Existing Menu functionality retained
CRITICAL

AC-039 — Menu close restores Experience context and focus

AC-040 — Realistically long Menu remains usable

======================================================================
I — STAFFING
======================================================================

AC-041 — Current and recommended staffing visibly distinct

AC-042 — No silent recommendation application
CRITICAL

AC-043 — Existing staffing financial consequence retained

======================================================================
J — RENTALS / ENHANCEMENTS
======================================================================

AC-044 — Existing Rentals capability retained

AC-045 — Rental suggestions remain explicit proposals

AC-046 — Existing Enhancements capability retained

======================================================================
K — COMMERCIAL TRUTH
======================================================================

AC-047 — Total remains discoverable while editing any desktop domain

AC-048 — Deposit remains discoverable

AC-049 — Rail total originates from canonical totals
CRITICAL

AC-050 — Per-guest value fails safely when inputs invalid

AC-051 — Margin remains properly gated
CRITICAL

AC-052 — Healthy margin evidence compresses

AC-053 — Margin uncertainty expands

======================================================================
L — BLOCKERS
======================================================================

AC-054 — Blocker count exact

AC-055 — Exact blocker reasons retained

AC-056 — Review blockers never saves/mutates by itself

AC-057 — Blocked save cannot be bypassed by alternative workbench control
CRITICAL

AC-058 — Special existing blockers remain enforceable
CRITICAL

======================================================================
M — GUEST CONSEQUENCES
======================================================================

AC-059 — Guest changes preserve before/after consequence view

AC-060 — Automatic pricing versus recommendations versus unchanged state clearly distinguished

AC-061 — Existing explicit Apply / Keep / Undo outcomes retained where currently supported

======================================================================
N — PILOT
======================================================================

AC-062 — Pilot remains reachable

AC-063 — AI changes inspectable before governed commit

AC-064 — AI cannot bypass ordinary blockers/authority
CRITICAL

AC-065 — Idle Pilot footprint is restrained

======================================================================
O — SCENARIOS
======================================================================

AC-066 — Existing Compare Scenarios remains available

AC-067 — Scenario detail is contextual rather than permanently expanded

======================================================================
P — CLIENT PREVIEW
======================================================================

AC-068 — Internal-only evidence excluded
CRITICAL

AC-069 — Unsaved preview remains honestly labelled

AC-070 — Preview focus management preserved

======================================================================
Q — GUIDED / ROLLBACK
======================================================================

AC-071 — Guided uses same form state
CRITICAL

AC-072 — Guided behavior retained

AC-073 — Supported flag-off/rollback path remains coherent if still required

AC-074 — No dual canonical editor

======================================================================
R — SAVE / PERSISTENCE
======================================================================

AC-075 — Save state labels truthful

AC-076 — No accidental continuous autosave introduced

AC-077 — Firebase authoritative pricing remains intact
CRITICAL

AC-078 — Version behavior remains intact
CRITICAL

AC-079 — UI presents saved success only from real successful save state

AC-080 — Failed save preserves unsaved work where current architecture permits
CRITICAL

======================================================================
S — ADVANCED PRICING
======================================================================

AC-081 — Advanced pricing collapsed by default

AC-082 — Existing advanced pricing capabilities retained

AC-083 — Unsupported arbitrary per-quote price override remains absent
CRITICAL SCOPE GUARD

======================================================================
T — ACTIVITY
======================================================================

AC-084 — Activity remains inspectable

AC-085 — Activity secondary while healthy

AC-086 — Actionable recovery evidence may promote through Attention

======================================================================
U — RESPONSIVE QUOTE WORKBENCH
======================================================================

AC-087 — 1440px workbench intentionally uses desktop hierarchy

AC-088 — 768px adaptation has no horizontal document overflow

AC-089 — 390px uses intentional mobile composition, not squeezed desktop columns

AC-090 — Mobile total/attention remains readily discoverable

AC-091 — Mobile controls preserve current minimum touch-target contract

AC-092 — Long Menu fully usable at 390px

AC-093 — No accidental nested-scroll trap

======================================================================
V — ACCESSIBILITY
======================================================================

AC-094 — Major regions have semantic/accessible names

AC-095 — Heading hierarchy valid

AC-096 — Selected/current/attention state not color-only

AC-097 — Visible keyboard focus

AC-098 — Focus returns after closing Menu/Preview/Scenario/context

AC-099 — Field errors remain associated with controls

AC-100 — Reduced-motion respected

AC-101 — Zero new serious/critical axe violations

======================================================================
W — VISUAL QUOTE ACCEPTANCE
======================================================================

AC-102 — Blank quote looks intentionally structured

AC-103 — Dense quote no longer renders as one giant continuous document
CRITICAL UX

AC-104 — Long names do not collide/clip

AC-105 — Dense Menu remains readable when deliberately opened

AC-106 — Important warning outranks routine metadata

AC-107 — Total remains visually prominent

AC-108 — Workbench looks like evolved QuotePilot, not a separate design system

======================================================================
X — PERFORMANCE / ECONOMY
======================================================================

AC-109 — Bundle budget passes or any exception is explicitly justified

AC-110 — Existing useful lazy boundaries retained

AC-111 — Domain switching causes no unnecessary persistence/network work

AC-112 — Material LOC overrun triggers architecture review

AC-113 — Major unexpected implementation-scale increase requires explicit explanation before continuation

======================================================================
Y — OPERATIONS INFORMATION ARCHITECTURE
======================================================================

AC-114 — Operations menu is no longer an undifferentiated 10+ item feature inventory
CRITICAL UX

AC-115 — Daily execution has one obvious operational entry

AC-116 — Calendar/Schedule is reused rather than replaced
CRITICAL REUSE

AC-117 — Operations is organized around time/execution rather than repository modules

AC-118 — Routes may remain available without all remaining permanent navigation entries

======================================================================
Z — CALENDAR-FIRST OPERATIONS
======================================================================

AC-119 — Calendar is the default operational lens when current capability supports it

AC-120 — Existing Month view retained

AC-121 — Existing Week view retained

AC-122 — Accepted/booked events remain correctly projected

AC-123 — Existing conflict detection retained
CRITICAL

AC-124 — Time overlap detection retained

AC-125 — Unknown-time warnings retained

AC-126 — Capacity-conflict logic retained

AC-127 — Staff-lead assignment remains available under existing authority

AC-128 — Production checklist remains available

AC-129 — Existing kitchen/run-of-show planning context remains available where currently supported

AC-130 — Calendar does not claim live telemetry that does not exist
CRITICAL

======================================================================
AA — EVENTS / CALENDAR CONVERGENCE
======================================================================

AC-131 — Events and Schedule are not presented as two confusing equal event indexes without a documented reason

AC-132 — Calendar event opens exact existing event/opportunity identity

AC-133 — No duplicate Event record introduced
CRITICAL

AC-134 — Exact Event routes remain functional for direct/deep arrival

AC-135 — Event Focus remains available where supported

======================================================================
AB — WORKFLOW CONVERGENCE
======================================================================

AC-136 — Existing Workflow authority remains unchanged
CRITICAL

AC-137 — Now can continue to deep-link exact Workflow attention

AC-138 — Opportunity can continue to deep-link exact Workflow attention

AC-139 — Removing/demoting a menu entry does not make Workflow unreachable

AC-140 — Bulk/global Workflow route remains available if supported use cases require it

======================================================================
AC — MESSAGES CONVERGENCE
======================================================================

AC-141 — Existing conversation/message capability preserved

AC-142 — Opportunity-context conversation remains reachable

AC-143 — Client-context conversation remains reachable where supported

AC-144 — Global Messages remains available where aggregate review is required

AC-145 — Messaging is not duplicated inside Operations merely for navigation convenience

======================================================================
AD — PILOT GLOBALIZATION
======================================================================

AC-146 — Pilot remains globally reachable according to current capability design

AC-147 — Pilot is not architecturally owned by Operations

AC-148 — No second Operations-specific Pilot implementation

======================================================================
AE — CLEAR THE DECK / NOW
======================================================================

AC-149 — Clear the Deck behavior preserved

AC-150 — Clear the Deck remains reachable from appropriate attention context

AC-151 — It is not treated as an independent operational data authority

======================================================================
AF — STAFF / PEOPLE
======================================================================

AC-152 — Existing Staff capability preserved

AC-153 — Calendar may link to Staff without rebuilding Staff

AC-154 — Staff private/role authority unchanged
CRITICAL

======================================================================
AG — REPORTING
======================================================================

AC-155 — Existing Reporting preserved

AC-156 — Reporting no longer competes visually with primary operational execution unless evidence justifies it

AC-157 — Reporting remains reachable through secondary/admin/Insights path

======================================================================
AH — SYSTEM / ADMIN
======================================================================

AC-158 — Integrations Ops preserved

AC-159 — Import Studio preserved

AC-160 — Diagnostics preserved

AC-161 — Moving these out of Operations does not remove authority or reachability

AC-162 — Administrative tools are distinguishable from daily operator work

======================================================================
AI — LIBRARY
======================================================================

AC-163 — Catalog administration remains preserved

AC-164 — Ambient Library remains or becomes the conceptual home for business-building-block configuration where current IA supports it

AC-165 — Catalog is not redundantly surfaced under Operations without documented need

======================================================================
AJ — NOW / CALENDAR RELATIONSHIP
======================================================================

AC-166 — Now may show compact upcoming operational horizon

AC-167 — Now does not duplicate full Calendar

AC-168 — Upcoming event can navigate to exact Calendar/Event context

AC-169 — Conflict/attention language shown in Now is evidence-backed

======================================================================
AK — OPPORTUNITY / OPERATIONS HANDOFF
======================================================================

AC-170 — Accepted/booked Opportunity can open operational Calendar/Event context

AC-171 — Commercial and operational contexts retain same exact opportunity/event identity

AC-172 — Transition introduces no duplicate persisted Event entity unless one already exists authoritatively
CRITICAL

======================================================================
AL — LIVE-OPERATIONS TRUTH
======================================================================

AC-173 — Planning state explicitly distinguished from live actuals
CRITICAL

AC-174 — No current-stage claim without authoritative state

AC-175 — No live issue claim without issue records

AC-176 — No staff check-in claim without authoritative check-in data

AC-177 — No Replay claim without immutable operational evidence

======================================================================
AM — PRIMARY NAVIGATION
======================================================================

AC-178 — Primary navigation remains intentionally small

Target to test:

Now
Opportunities
Operations
Clients
Library

AC-179 — New Quote remains a global action rather than a permanent content destination if current design supports this

AC-180 — Search remains global/secondary

AC-181 — Pilot remains global/secondary

AC-182 — System/Admin capabilities do not inflate primary navigation

AC-183 — Mobile navigation remains focused and accessible

======================================================================
AN — MIGRATION / RETIREMENT
======================================================================

AC-184 — Canonical quote composition surface documented

AC-185 — Guided classified as alternate mode

AC-186 — Legacy/flag-off quote path classified compatibility/rollback

AC-187 — Calendar-first Operations documented as canonical operational index if promoted

AC-188 — Exact Events route classified contextual/deep-link if removed from permanent nav

AC-189 — Workflow route classified correctly

AC-190 — Messages route classified correctly

AC-191 — System/Admin routes classified correctly

AC-192 — Superseded presentation explicitly identified

AC-193 — Dead duplicate components removed or documented with retirement condition

======================================================================
AO — QUOTE GOLDEN PATHS
======================================================================

AC-194 — New quote golden path

New quote
→ Event
→ Customer
→ Experience
→ Menu
→ Staffing
→ Commercial review
→ blocker resolution
→ Preview
→ Save

CRITICAL

AC-195 — Existing quote edit golden path
CRITICAL

Open existing quote
→ modify allowed state
→ consequence/pricing update
→ Save
→ correct revision

AC-196 — Guided golden path

AC-197 — AI-assisted quote path

AC-198 — Scenario path

AC-199 — Blocked-save path

AC-200 — Long-menu path

AC-201 — Margin-disabled path

AC-202 — Save-failure recovery path

======================================================================
AP — OPERATIONS GOLDEN PATHS
======================================================================

AC-203 — Calendar golden path
CRITICAL

Operations
→ Calendar
→ Month/Week
→ select event
→ inspect exact event
→ return to Calendar

AC-204 — Conflict path

Calendar
→ conflict indicated
→ exact conflicting event/context
→ no fabricated resolution

AC-205 — Staff lead path

Calendar/Event
→ supported assignment
→ existing write authority
→ refreshed state

AC-206 — Production checklist path

AC-207 — Opportunity-to-Calendar path

Accepted/booked Opportunity
→ Open in Calendar
→ exact event selected

AC-208 — Now-to-Calendar path

Upcoming/attention item
→ exact operational context

AC-209 — Calendar-to-Opportunity path

Event
→ exact underlying Opportunity

======================================================================
AQ — RESPONSIVE OPERATIONS
======================================================================

AC-210 — Calendar usable at 1440

AC-211 — Calendar usable at 768

AC-212 — Calendar usable at 390 or has an intentional mobile agenda/list adaptation

Do not shrink a desktop month grid into unusability.

AC-213 — Mobile Operations preserves event date/time/context

AC-214 — Mobile event conflict remains understandable

AC-215 — No horizontal page overflow

======================================================================
AR — OPERATIONS ACCESSIBILITY
======================================================================

AC-216 — Calendar navigation keyboard accessible

AC-217 — Selected day/event state accessible beyond color

AC-218 — Conflict state has textual meaning

AC-219 — Event details have semantic structure

AC-220 — Focus is restored after event/detail overlays where applicable

AC-221 — No new serious/critical axe violations

======================================================================
AS — NAVIGATION REGRESSION
======================================================================

AC-222 — Every route intentionally removed from primary/Operations navigation remains reachable through its new intended path

AC-223 — Browser Back/Forward remains correct

AC-224 — Direct deep links remain correct

AC-225 — Auth/role restrictions unchanged

AC-226 — Mobile Workspace/tools navigation remains accessible

AC-227 — No route silently aliases to semantically wrong destination

======================================================================
AT — RELEASE EVIDENCE
======================================================================

AC-228 — Focused unit/component tests pass

AC-229 — Relevant pre-existing tests remain green or have evidence-backed expectation updates

AC-230 — Quote workbench real-route Playwright passes

AC-231 — Operations/Calendar real-route Playwright passes

AC-232 — Responsive matrix passes

AC-233 — Accessibility matrix passes

AC-234 — Build passes

AC-235 — Bundle/governance passes

AC-236 — Exact-head CI passes
CRITICAL

AC-237 — Screenshots/visual evidence correspond to exact candidate SHA

AC-238 — Source/CI evidence is not reported as hosted/human acceptance

======================================================================
REQUIRED QUOTE STATE MATRIX
======================================================================

Qualify at least:

new empty quote
partial Event
missing Customer
complete Event/Customer
small Menu
large Menu
package inclusions
Rentals
Enhancements
staffing recommendation matches current
staffing recommendation differs
guest change with consequences
no blockers
one blocker
many blockers
margin healthy
margin unavailable
missing cost evidence
Pilot review pending
scenario review pending
Commercial Change required
new quote
existing editable quote
saving
save failure
save success
Guided mode
rollback/flag-off if still supported

======================================================================
REQUIRED OPERATIONS STATE MATRIX
======================================================================

Qualify at least:

no accepted/booked events
one accepted event
one booked event
multiple events same day
time overlap
unknown event time
capacity conflict
staff lead absent
staff lead assigned
production checklist incomplete
production checklist complete
month view
week view
event with missing venue
event with missing time
partial/stale read
failed refresh with prior state retained
direct event deep link
Opportunity → Calendar arrival
Now → Calendar/Event arrival

======================================================================
REQUIRED VIEWPORT MATRIX
======================================================================

QUOTE:

Blank quote:
390
1440

Dense quote:
390
768
1440

Focused Menu:
390
768
1440

Blockers:
390
1440

Margin warning:
768
1440

Preview:
390
1440

AI proposal:
390
1440

Guided:
390
1440

OPERATIONS:

Month Calendar:
768
1440

Week Calendar:
390/intentional mobile equivalent
768
1440

Multiple-event day:
390
1440

Conflict:
390
1440

Event detail:
390
768
1440

======================================================================
ACCEPTANCE EVIDENCE LEDGER
======================================================================

Maintain an acceptance ledger.

Every AC entry should contain:

AC ID
Status
Claim
Evidence
Files
Tests
Browser evidence
Exact SHA
Negative evidence where useful
Remaining boundary

Example:

AC-038
Status: PASS

Claim:
Existing Menu capability remains intact within focused Experience/Menu context.

Evidence:
- source paths
- component tests
- real-route Playwright
- exact candidate SHA

Negative evidence:
No alternate menu-state model introduced.

Remaining boundary:
None.

Example:

AC-212
Status: UNVERIFIABLE

Reason:
No real 390px Operations browser evidence captured.

Consequence:
Candidate is NOT QUALIFIED.

======================================================================
RELEASE VERDICT
======================================================================

Critical dimensions include:

architecture convergence
business truth preservation
one quote state
pricing correctness
Menu preservation
save/version correctness
authority preservation
Operations identity preservation
Calendar conflict correctness
responsive usability
accessibility
quote golden path
operations golden path
exact-head CI

Verdict:

Any critical FAIL
→ FAIL

Any critical UNVERIFIABLE
→ NOT QUALIFIED

All critical PASS
→ candidate may advance

No weighted average.

No “95% complete.”

======================================================================
IMPLEMENTATION PHASES
======================================================================

PHASE 0
Repository reality and reuse ledger

PHASE 1
Quote Workbench shell using existing ProposalComposer

PHASE 2
Living-object domain organization

PHASE 3
Focused Experience/Menu and supporting contexts

PHASE 4
Commercial Truth/Attention compression

PHASE 5
Quote responsive/accessibility acceptance

PHASE 6
Operations information-architecture convergence

PHASE 7
Promote existing Schedule into Calendar-first Operations

PHASE 8
Contextual route/nav convergence:
Events
Workflow
Messages
Pilot
Staff
Reporting
Admin tools

PHASE 9
Now/Opportunity Calendar handoffs

PHASE 10
Retirement/compatibility classification

PHASE 11
Exact-head qualification

Do not bundle every phase into one uncontrolled rewrite if repository governance favors smaller bounded slices.

The end architecture must remain coherent across slices.

======================================================================
BRANCH / DELIVERY
======================================================================

Work from current main on dedicated branch(es) according to repository governance.

If one branch is appropriate, suggested umbrella name:

feat/ux-convergence-workbench-operations

If the repository change budget makes multiple PRs safer, use an integration branch or explicit ordered PR sequence.

Do not work directly on main.

Do not merge or production deploy without explicit authorization.

Before final candidate:

- reconcile with current main;
- ensure no temporary test/workflow scaffolding remains;
- run exact-head qualification;
- create/update draft PR;
- record exact SHA.

======================================================================
SELF-CORRECTION CONDITIONS
======================================================================

Stop and revise the approach if:

- a second quote state appears;
- a second pricing calculation appears;
- a second Menu system appears;
- a second Calendar engine appears;
- a second Staff model appears;
- business truth moves into layout components;
- mobile requires separate business logic;
- navigation starts reproducing repository routes one-for-one;
- new and old canonical editors coexist without retirement plan;
- Operations still exposes 10+ equal tools after “modernization”;
- Calendar is duplicated rather than promoted;
- work grows dramatically because existing capability is being rewritten;
- repository evidence contradicts a key premise.

Correct architecture before continuing.

======================================================================
FINAL REPORT
======================================================================

When source implementation and exact-head qualification are complete, report:

1. Branch(es)
2. Exact SHA(s)
3. PR(s)
4. Final information architecture
5. Final quote-composition architecture
6. Final Operations architecture
7. REUSE / EXTEND / MOVE / COMPOSE / RETIRE / NEW ledger
8. Primary navigation before → after
9. Operations navigation before → after
10. Files changed
11. Production LOC
12. Test LOC
13. Docs LOC
14. Additions
15. Deletions
16. Net LOC
17. AC-001 through AC-238 verdicts
18. Quote state matrix verdict
19. Operations state matrix verdict
20. Responsive matrix verdict
21. Accessibility verdict
22. CI evidence
23. Visual evidence
24. Transitional surfaces remaining
25. Retirement conditions
26. UNVERIFIABLE boundaries
27. Intentionally deferred product capabilities
28. Proof that existing pricing/menu/staffing/save/calendar authorities were preserved
29. Why the implementation compounds prior QuotePilot progress instead of replacing it

======================================================================
DEFINITION OF SUCCESS
======================================================================

Success is not:

“the screens look cleaner.”

Success is:

QuotePilot's existing sophistication becomes easier to operate because the application now exposes complexity according to user intent.

QUOTE COMPOSITION becomes:

WHERE AM I?
WHAT AM I WORKING ON?
WHAT IS THE COMMERCIAL RESULT?
WHAT NEEDS ATTENTION?
WHAT SHOULD I DO NEXT?

OPERATIONS becomes:

WHAT IS HAPPENING WHEN?
WHAT EVENTS COMPETE FOR TIME?
WHAT REQUIRES EXECUTION?
WHAT NEEDS REVIEW?
WHICH EVENT SHOULD I OPEN?

THE APPLICATION becomes:

NOW
attention

OPPORTUNITIES
commercial state

OPERATIONS
time and execution

CLIENTS
relationship context

LIBRARY
business building blocks

with:

NEW QUOTE
SEARCH
PILOT

available globally and administrative/system capabilities available without polluting daily navigation.

The system underneath remains sophisticated.

The operator experience above it becomes calm, contextual, and progressively disclosed.

The implementation is successful only when it makes the engineering work already completed in QuotePilot more valuable rather than replacing it.
