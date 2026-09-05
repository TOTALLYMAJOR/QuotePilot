# QuotePilot by MBMApps

Last updated: 2026-09-04 18:01:21 CDT

Multi-tenant catering quote application built with React, Vite, Firebase, and jsPDF.

## Quick Links
- Canonical project state: [PROJECT_STATE.md](PROJECT_STATE.md)
- Executive state: [docs/project/EXECUTIVE_STATE.md](docs/project/EXECUTIVE_STATE.md)
- Live app: https://quotepilot.mbmapps.com
- Firebase Hosting origin/fallback: https://tonicatering.web.app
- Repository: https://github.com/TOTALLYMAJOR/quoteflow
- Launch runbook: [docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md)
- Commercial platform program: [docs/COMMERCIAL_PLATFORM_PROGRAM.md](docs/COMMERCIAL_PLATFORM_PROGRAM.md)
- Pricing Constitution: [docs/PRICING_CONSTITUTION.md](docs/PRICING_CONSTITUTION.md)
- Governed candidate deploy command: `npm run release:candidate:deploy` (fixed
  Firebase staging or Vercel preview only; checksum-verified Firebase binary,
  ADC Rules readback, direct Vercel APIs, and an explicit safe-off, bounded
  staffing-authority, or Firebase-only provider-acceptance profile; see the
  launch runbook)
- User manual: [docs/USER_MANUAL.md](docs/USER_MANUAL.md)
- Feature inventory and matrix: [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md)
- Design system: [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)
- Design principles: [docs/DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md)
- Event Messaging Station architecture: [docs/MESSAGING_STATION_ARCHITECTURE.md](docs/MESSAGING_STATION_ARCHITECTURE.md)
- Customer-centered workspace plan: [docs/CUSTOMER_CENTERED_WORKSPACE_PLAN.md](docs/CUSTOMER_CENTERED_WORKSPACE_PLAN.md)
- Post-competitive destination design: [docs/POST_COMPETITIVE_DESIGN.md](docs/POST_COMPETITIVE_DESIGN.md)
- Intent intake ADR: [docs/INTENT_INTAKE_ADR.md](docs/INTENT_INTAKE_ADR.md)
- Customer workspace backend handoff: [docs/CUSTOMER_WORKSPACE_BACKEND_HANDOFF.md](docs/CUSTOMER_WORKSPACE_BACKEND_HANDOFF.md)
- Commercial Change Authority ADR: [docs/COMMERCIAL_CHANGE_AUTHORITY_ADR.md](docs/COMMERCIAL_CHANGE_AUTHORITY_ADR.md)
- Commercial Change Authority design/UI/work plan: [design](docs/COMMERCIAL_CHANGE_AUTHORITY_DESIGN.md), [UI specification](docs/COMMERCIAL_CHANGE_AUTHORITY_UI_SPEC.md), [work plan](docs/COMMERCIAL_CHANGE_AUTHORITY_WORK_PLAN.md)
- Revenue Autopilot ADR: [docs/REVENUE_AUTOPILOT_ADR.md](docs/REVENUE_AUTOPILOT_ADR.md)
- Revenue Autopilot design/UI/work plan: [design](docs/REVENUE_AUTOPILOT_DESIGN.md), [UI specification](docs/REVENUE_AUTOPILOT_UI_SPEC.md), [work plan](docs/REVENUE_AUTOPILOT_WORK_PLAN.md)
- Authoritative operational staffing ADR: [docs/OPERATIONAL_STAFFING_AUTHORITY_ADR.md](docs/OPERATIONAL_STAFFING_AUTHORITY_ADR.md)
- Orchestration blueprint: [docs/ORCHESTRATION_BLUEPRINT.md](docs/ORCHESTRATION_BLUEPRINT.md)
- Orchestration runbook: [docs/ORCHESTRATION_RUNBOOK.md](docs/ORCHESTRATION_RUNBOOK.md)
- Repository operating-system audit: [docs/REPOSITORY_OPERATING_SYSTEM_AUDIT.md](docs/REPOSITORY_OPERATING_SYSTEM_AUDIT.md)
- Development evidence compiler: [docs/DEVELOPMENT_EVIDENCE_COMPILER.md](docs/DEVELOPMENT_EVIDENCE_COMPILER.md)
- Product Truth Observability: [ADR](docs/adr/ADR-0002-product-truth-observability.md), [design](docs/design/product-truth-observability-design.md), [work plan](docs/plans/20260828-feature-product-truth-observability.md)
- Canonical doc system: [docs/DOC_SYSTEM.md](docs/DOC_SYSTEM.md)

The project-state control plane reconciles these existing authorities without
replacing them. Run `npm run check:project-state` to validate lifecycle values,
evidence paths, freshness, blocker references, and the single next proof event.

## Application Routes
- `/`: hospitality-first public QuotePilot marketing page.
- `/system`: saved dark product and operating-system overview.
- `/app`: authenticated staff workspace. Generic builds retain the five-step
  builder landing; builds with `VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED=true`
  use the Commercial Command Center as the default landing.
- `/app/clear-the-deck`: Ambient planning route for sequential decision review.
  It uses the existing bounded workflow/commercial evidence and labels
  incomplete live-operations authority as unavailable rather than inferred.
- `/app/events`, `/app/events/:quoteId`, `/app/events/:quoteId/live`, and
  `/app/events/:quoteId/replay`: Ambient planning routes for accepted/booked
  event work. The initial slice distinguishes planned event evidence from
  live authority; current phase, pulse, issues, actuals, and replay remain
  “not established” until the server-owned event-operations authority ships.
- `/app/customers` and `/app/customers/:customerId`: temporary-flagged,
  paginated staff customer directory and opaque-ID Internal Customer 360. A
  default-off Ambient build presents these same bounded reads as **Clients**:
  a lighter directory and relationship-first client view with an exact client
  handoff, one supported next step, and the existing detailed history and
  controls preserved under disclosure. This presentation adds no data or role
  authority.
- `/app/quotes`, `/app/quotes/new`, `/app/quotes/:quoteId`, and
  `/app/quotes/:quoteId/edit`: routed Opportunities, sticky-mounted builder,
  canonical connected Quote Workspace, and trusted edit entry points. The
  exact quote route now leads with the approved dinner-table workspace over
  saved tenant data, consolidated **Now**, **Opportunities**, **Clients**, and
  role-safe **Library** orientation, visible completeness/save-health evidence,
  and explicit handoffs to the unchanged editing, messaging, proposal,
  payment, lifecycle, delivery, and recovery authorities. The explicit
  `?view=administration` continuation and governed administration arrivals
  retain the prior full control surface. The workspace composes existing quote/Workflow evidence plus the existing
  proposal-readiness selector through one deterministic presentation contract;
  it labels that result as proposal completeness and does not create an
  event-wide readiness or data-authority contract. An independently default-off
  Ambient build may expose tenant-isolated operational staffing inside the
  selected quote's Staffing object. That authority has separate presentation,
  server, and exact-tenant gates and does not change quoted labor, pricing,
  booking, BEO, portal, payment, attendance, payroll, or readiness evidence.
- `/app/quote-workspace` and `/app/quote-workspace-concept`: authenticated
  admin/sales-only compatibility aliases for the canonical connected Quote
  Workspace. Existing bookmarks continue to work, but new exact-quote
  navigation uses `/app/quotes/:quoteId`; neither alias grants mutation or
  provider authority.
- `/app/messages`: temporary-flagged staff Event Messaging Station. Each
  conversation remains segregated by its canonical quote/event, the inbox
  watches up to 50 same-tenant quote documents ordered by their body-free
  conversation summary and normalizes the event/thread fields it displays. The
  selected exact thread uses a best-effort near-real-time signal to reload canonical
  message bodies through the existing callable. `Live updates`, cache, and
  paused labels describe listener state only; they do not establish message
  delivery, reading, typing, presence, or a latency SLA. The governed `v0.6.0`
  production builds enable this route, and its public deep link is reachable on
  both production hosts. Authenticated hosted use and human acceptance remain
  separate evidence. Draft, expired, deleted, or provider-unaccepted portal
  state is not exposed as an active conversation.
- `/app/workflow`: routed attention, follow-up, and approval surface; optional
  query parameters focus an exact quote, attention type, and request.
- `/app/staff`: independently flagged administrator-only Staff People workspace
  for private contact/photo, qualifications, availability, rates, travel,
  briefing defaults, reliability and notes. The default view is read-first:
  a fixed object rail, profile summary, readiness, next-best assignment action,
  and assignment progress card precede the existing edit sections. Exact
  operator-confirmed event assignments can produce a role-aware print/download
  sheet or a prefilled default-email-app handoff. An administrator can preview
  and manually send an exact-assignment invitation to a verified private email,
  then see provider delivery and staff acknowledgement on separate rails.
- `/staffing/respond?staffing=<signed-token>`: public bearer response for one
  exact staff assignment invitation. The link records accept or decline only;
  it does not establish attendance, hours, payroll, completion, or readiness.
- `/app/operations`: source-candidate canonical Calendar for accepted/booked
  operations. It composes the existing month/week schedule, conflicts,
  capacity, staff-lead assignment, production checklist, and run-of-show
  context without adding backend or live-telemetry authority. Month gives the
  full primary canvas to the calendar and places selected context below. Week
  uses a seven-day vertical time grid with start/duration geometry, collision
  lanes, and a secondary detail rail. Phone widths use an agenda from those
  same models. The converged Ambient primary navigation opens this Calendar
  directly; the secondary Workspace & tools Operations group contains
  **Operations**, **Clear the Deck**, and role-gated **Staff** without a
  duplicate header menu.
- `/app/schedule`: compatibility path to the same Calendar capability. Event
  and schedule deep routes remain reachable from their exact context or URL;
  they are not duplicated in the Operations menu.
- `/app/reporting`: temporary-flagged proof-safe commercial reporting
  workspace. **Reporting Dashboard**, **Integrations Ops**, **Import Studio**,
  and **Session Diagnostics** remain progressively disclosed Administration
  tools, while **Workflow**, **Messages**, and **Pilot** remain Frequent tools.
  These navigation changes are a local source candidate; exact-head CI, hosted
  behavior, and human acceptance remain pending.
- `/app/catalog` and `/app/imports`: temporary-flagged embedded admin
  workspaces; the existing admin gate remains authoritative. A default-off
  Ambient build presents `/app/catalog` as **Library**, separating catalog
  choices from first-class event templates and opening each exact section or
  template inside the existing guarded editor. It adds no catalog read, save,
  pricing, revision, or role authority; browser-local evidence stays labeled as
  local and the flag-off Catalog Admin remains the rollback path.
- `/app/integrations` and `/app/diagnostics`: temporary-flagged embedded
  operational workspaces with their existing role and feature gates.
- `/app/home`: compatibility path that replaces to `/app`.
- `/start`: public invoice-first $1 Stripe test buyer flow when the reviewed
  browser flags and Turnstile site key are present; the independently disabled
  server gate still prevents initiation until backend release approval.
- `/?portal=<token>` or `/app?portal=<token>`: customer proposal portal. The
  token takes precedence on every pathname, existing links remain compatible,
  and newly generated canonical links use `/app?portal=...`.
- `/?unsubscribe=<opaque-token>` on any non-portal pathname: public Revenue
  Autopilot email-preference surface. Portal precedence is unchanged; the
  stable signed v1 organization/customer token is hash-bound to server controls
  and intentionally has no timestamp or expiry.

When `VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED=true`, the six operational paths
above render as recoverably lazy embedded workspace regions and preserve their
mounted state during ordinary staff navigation. Contextual Catalog entry points
and the flag-off/legacy shell retain the existing focus-contained modal wrappers
and close guards. The governed `v0.7.0` builds promote these routes with the
workspace flag enabled; public deep-link reachability is verified, while
authenticated hosted and human acceptance remain separate. See the
[customer-centered workspace plan](docs/CUSTOMER_CENTERED_WORKSPACE_PLAN.md)
for the delivery and evidence contract.

## Product Scope
The current product direction is a customer-centered quote-to-booking workspace:
Commercial Command Center, Customer Directory and Customer 360, routed Quotes,
the Event Messaging Station, Workflow, Schedule, Reporting, and guarded
administration, with the five-step quote builder retained as one focused
commercial capability. The exact-token customer decision center remains the
sole customer-facing experience.

The live `v0.7.0` release promotes the reviewed customer-centered workspace,
CWF-16 Event Workspace, Event Messaging Station, and all eight production pilot
surfaces. QuotePilot also includes dynamic
event-type menus, authoritative pricing, proposal export and decisions,
tenant-locked customer/catalog CSV imports, separate deposit and final-balance
rails in current source, public invoice-first buyer onboarding on the existing
`tonicatering` Firebase project, staff Kitchen BEO export, and operational
history, scheduling, reporting, and diagnostics. Source availability does not
establish production deployment or provider acceptance; see `PROJECT_STATUS.md`
for current operational truth.

The live `v0.7.0` runtime also includes dormant Commercial Change Authority
and Revenue Autopilot programs. Commercial changes can be simulated against
authoritative pricing, authorized, atomically applied with dependency
invalidations, reconciled by named dependency evidence, and surfaced through
trusted Kitchen BEO freshness and deterministic Decision Debt. Revenue
Autopilot includes tenant controls, scheduled email lanes, unread-reply
Attention escalation, post-event review requests, customer unsubscribe, and
provider-webhook reconciliation. These are deployed capabilities behind
default-off runtime gates. Their code and Functions are deployed, but neither
global program is enabled, no observed tenant has opted in, and provider,
production-data, hosted-role, and human acceptance remain separate. Commercial
Change enforcement still requires exact hosted role acceptance and explicit
tenant authorization.

Tenant safety mode:
- Firebase tenant business reads/writes fail closed when `organizationId` context is missing.
- Legacy global business collections are retired for runtime access.

## Architecture Snapshot
- Frontend: React 18 + Vite 7
- Data/Auth: Firebase Firestore + Firebase Auth
- Server runtime: Firebase Functions on Node.js 22 with modular Firebase Admin SDK APIs
- Commercial architecture: shared Commercial / Operations Kernel -> Catering
  Vertical Pack -> organization-scoped Tenant Configuration -> contextual
  QuotePilot UX. Package and Event Template remain the natural catering terms;
  Configurable Offer and Commercial Template are shared kernel contracts.
- Pricing authority: browser preview plus revision-fenced server certification;
  pricing-v1 remains historical evidence and pricing-v2 introduces exact
  integer-minor-unit receipts and immutable price waterfalls.
- Reconciliation tier: Python 3.11+ (`truthloop/`), standard library only, read-only,
  no credentials and no write path; see `docs/COMMERCIAL_TRUTH_LOOP_ADR.md`
- Public custom domain: Vercel (`https://quotepilot.mbmapps.com`)
- Firebase Hosting origin/fallback: `https://tonicatering.web.app`
- Local runtime options: VS Code Dev Container (recommended), Node (`npm run dev`), or Docker Compose (`web-dev` / `web`)

## Local Setup
### Prerequisites
- Node.js 22+
- npm
- Python 3.11+ (for the Commercial Truth Loop; no packages to install)

### Install + Validate
```bash
npm install
npm run check:env
```

### Run (Node)
```bash
npm run dev
```

To inspect the customer-centered workspace source in a POSIX shell without
changing a tracked environment file, start Vite with the temporary build flag:

```bash
VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED=true npm run dev
```

Open `http://localhost:5173/app`. This proves only that the local source is
rendering. Firebase-backed customer, quote, rebook, and Change Impact behavior
still requires the repository's configured development/emulator environment;
neither command deploys or changes production.

### Run (VS Code Dev Container, isolated)
Prerequisites:
- Docker Desktop
- VS Code with Dev Containers extension

Steps:
1. Open the QuotePilot repository folder in VS Code.
2. Run `Dev Containers: Reopen in Container`.
3. In the container terminal, run:

```bash
npm run dev
```

The app is served on `http://localhost:5173`.

### Run (Docker)
Dev server:
```bash
docker compose up --build web-dev
```

Production-like image:
```bash
docker compose up --build web
```

## Environment
Create `.env` from `.env.example` and set required Firebase keys:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Optional:
- `VITE_FIREBASE_FUNCTIONS_REGION`
- `VITE_FIREBASE_APP_CHECK_ENABLED` (default off. Enables Firebase App Check
  token acquisition for the browser only after the exact environment has a
  reviewed reCAPTCHA Enterprise application registration. This flag alone does
  not enable callable enforcement.)
- `VITE_FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY` (environment-specific
  public site key required when browser App Check is enabled. It is safe to
  expose as a `VITE_` value, but must never be reused as a secret or treated as
  evidence that enforcement passed.)
- `VITE_APP_HOST`
- `VITE_APP_URL` (exact canonical
  `https://quotepilot.mbmapps.com/app` return URL for Firebase email actions;
  its domain must be authorized in Firebase Authentication; loopback HTTP is
  accepted only for local development)
- `VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED` (temporary build-time gate for
  the native staff route shell, `/app` Command Center landing, customer
  directory, Customer 360, Event Messaging Station, and embedded Schedule/
  Reporting/Catalog/Imports/Integrations/Diagnostics routes; defaults off. The
  flag does not bypass staff authentication, existing role/feature gates, or
  exact-token portal precedence, and enabling it is not a deployment or
  production-acceptance decision.)
- `VITE_PILOT_NOW_ENABLED` (default off; recognized only alongside the
  customer-centered workspace flag. Renders the `/app` Home route as the
  flag-gated NOW surface — interpreted decision cards over the same bounded
  Command Center snapshot, with the existing Workflow/quote/Customer 360
  resolution targets. Purely presentational: it adds no reads, writes, or
  authority, and enabling it is not a deployment or acceptance decision.)
- `VITE_PILOT_EVENT_ROOM_ENABLED` (default off. Dresses the Event Workspace
  with the pilot readiness ring — the existing proposal-completeness score —
  an advisory decide stack derived only from the selected quote's
  recorded fields plus the static house staffing ratios, and, for accepted
  or booked quotes, a cascade receipts panel in which every step reports
  only its own recorded evidence: acceptance receipt, retained version,
  contract, the separate deposit and final-balance provider rails, booking
  confirmation, availability check, staff lead, and post-event review.
  Advisory cards are
  suppressed for accepted, booked, or terminal quotes, refuse labor
  estimates the record cannot support, and route only to the existing
  role-gated edit or administration surfaces. Purely presentational; not a
  deployment or acceptance decision.)
- `VITE_AMBIENT_UI_ENABLED` (defaults off outside reviewed release builds. The
  current production deployment workflow source binds it to `true`, while a
  workflow binding alone is not a deployment or human-acceptance receipt.
  Activates the Ambient
  presentation for Now, Opportunities, Clients, administrator Library, and the
  selected staff quote route. Clients reuses the existing bounded directory and relationship reads,
  opens the exact opaque client identity with reason, consequence, and next
  resolution, and preserves the legacy history and role-gated controls under
  **More client history and controls**. It does not infer relationship health
  from partial list data or add read, write, role, pricing, message, payment,
  booking, or provider authority. Library reuses the existing organization
  catalog snapshot, editor, admin gate, and revision-safe save path while
  separating Catalog choices from first-class Event Templates and preserving
  incomplete menu evidence as unavailable. The selected quote renders a Living
  Opportunity top layer, deterministic
  next action, three progressive evidence layers, four non-blended momentum
  domains, a guest-count intelligent object, contextual inspectors, reversible
  unsaved previews, embedded Pilot guidance, and preference-aware semantic
  feedback. The selected opportunity also exposes fail-closed date, time,
  duration, venue, staffing, and pricing objects. Pricing can produce a bounded
  current-catalog calculation or use the existing governed Commercial Change
  simulation when its authority is available; the UI labels those sources
  separately, keeps margin unavailable without complete recorded costs, and
  never treats a preview as a saved authoritative price. Event-logistics
  objects expose exact evidence coverage and draft-only intent, but do not
  claim availability, reserve capacity, schedule work, or save a value. Enabled
  Alpha controls also use registered action/result contracts,
  a 250ms acknowledgement watchdog, exact context and route-arrival checks,
  visible recovery, and privacy-safe primary-action assessments. The existing
  product-event rail accepts only that bounded assessment plus first-intent and
  issue-timing observations; Reporting labels them as client observations and
  never as server timing or comprehension evidence. A guest scenario can be staged into the existing quote
  editor, but the saved-record surface never invents a commercial delta; the
  existing live calculator previews it and the intentional trusted save still
  re-prices and versions it. The flag adds no read, write, provider, portal,
  or role authority. Enabling it is not by itself deployment or human
  acceptance.)
- `VITE_OPERATIONAL_STAFFING_ENABLED` (default off, deliberately absent from
  production deployment workflows, and effective only inside the Ambient
  Living Opportunity. It exposes the exact tenant-scoped roster, commercial
  staffing requirements, operator-recorded availability, conflict-fenced
  assignments, coverage gaps, and immutable receipts. The independent
  Functions gate and trusted exact-tenant setting must also be enabled before
  the connected surface can claim authority. Local fallback stays explicitly
  `local_draft`; this flag grants no role, pricing, provider, portal, payment,
  booking, attendance, payroll, acknowledgement, or readiness authority.)
- `VITE_PILOT_GUIDED_SELLING_ENABLED` (default off. Renders the quote
  builder's existing guided-selling recommendations as decision-grammar
  cards — claim, basis, impact, Why? provenance, one-tap Take it — instead
  of the plain recommendation list. The recommendation engine, tenant
  guided-selling/AI-assist gates, apply behavior, and autopilot semantics
  are unchanged. Purely presentational; not a deployment or acceptance
  decision.)
- `VITE_PILOT_CREATE_ENABLED` (default off. Renders the CREATE intake
  canvas above the new-quote builder: free text is structured by a
  deterministic browser-only extractor — no provider, no I/O, no invention;
  every fact carries its source excerpt and confidence, low-confidence facts
  require one-tap confirmation, and applying prefills the ordinary editable
  draft form only. When the operator's own phrasing was uncertain (an
  approximate or ranged guest count), the live pricing rail additionally
  shows a draft-only estimated/deposit band priced at the range ends by the
  same preview calculator; typing any different exact count resolves it, and
  saving always prices the exact recorded count. Quote creation authority is
  unchanged; see
  [docs/INTENT_INTAKE_ADR.md](docs/INTENT_INTAKE_ADR.md). Not a deployment
  or acceptance decision.)
- `VITE_PILOT_CHANGE_REQUESTS_ENABLED` (default off. In the quote editor,
  shows the stored customer change-request message verbatim and parses it
  deterministically into stageable proposals — guest count, staffing,
  hours, service style, and add/remove/swap of catalog items — each priced
  as a preview delta by the same client calculator. Ambiguous references
  become an explicit choice, never a guess; unreadable clauses stay the
  customer's text. Staging edits the draft form only: the ordinary save
  path remains the sole versioning and re-pricing authority, and nothing is
  sent to the customer. Purely presentational; not a deployment or
  acceptance decision.)
- `VITE_PILOT_COMMAND_ENABLED` (default off. Adds the Pilot command bar to
  the quote builder: plain-words commands are parsed by the same
  deterministic change grammar as client requests and always preview with
  a priced delta before anything can be applied to the draft; applying
  stages ordinary editable draft edits, and saving still re-prices on the
  server. Voice input appears only when the browser provides speech
  recognition. With the independently default-off Ambient presentation,
  pointer or Space/Enter hold starts capture and release opens the same
  deterministic preview; permission, device, service, network, no-speech,
  cancellation, and timeout outcomes keep the prior command, preview, and
  draft with a typed-input recovery. The flag-off Pilot retains its existing
  click-to-toggle behavior. Speech is never persisted or staged automatically,
  and real microphone/service behavior still needs hosted browser acceptance.
  Purely presentational; not a deployment or acceptance decision.)
- `VITE_PILOT_MARGINS_ENABLED` (default off. Adds a staff-only margin strip
  to the live pricing rail, computed strictly from tenant-recorded costs:
  `costPpp` on the selected package, `cost` on each selected add-on,
  rental, and menu item (same pricing mode as its price), and
  `serverCostRate`/`chefCostRate`/`bartenderCostRate` in settings when
  staff are quoted, with an optional `targetMarginPct` policy. Costs are
  recorded through Catalog Admin's pricing fields and summarized there for
  coverage before save; the Proposal Composer mirrors the complete selected-line
  result as staff-only Quote Pulse context.
  Anything missing makes margin explicitly unavailable with the missing
  pieces named — nothing is estimated; travel and tax are excluded from
  both sides, and costs never appear in any customer-facing projection.
  Purely presentational; not a deployment or acceptance decision.)
- `VITE_PILOT_DECISION_ROOM_ENABLED` (default off in generic/local builds.
  Preserves the released portal question, assumptions, terms, and option-request
  subset when enabled alone. When `VITE_AMBIENT_UI_ENABLED` is also enabled, it
  reorganizes the existing customer-safe projection into a content-first
  decision room with Event, Menu and service, Pricing,
  assumptions, tenant terms, optional additions, response, and questions.
  **Ask a question** opens the one existing conversation composer and reports
  whether its ordinary editable starter text was staged, an existing draft was
  preserved, a send still needs reconciliation, or the thread is unavailable.
  Staff-marked additions prepare reversible ordinary change-request lines; they
  never change the proposal, totals, revision, payment, or booking. Browser-
  local exact-token fallback mirrors the same bounded terms and option shape.
  No new callable, message field, catalog exposure, direct quote mutation, or
  trust boundary.)

- `INTENT_PARSER_ENABLED` / `INTENT_PARSER_PROVIDER` / `INTENT_PARSER_MODEL`
  (server env, all dormant by default: `false` / `none` / per-provider
  default. The owner-approved model-assisted intake lane; providers
  `openai`, `anthropic`, or `auto`. `auto` uses a cheap-first
  `provider:model` candidate order from `INTENT_PARSER_MODEL` or the
  built-in defaults, trims the completion-token budget by request
  complexity, and may escalate once to the next configured candidate.
  Enabling later requires creating the
  `INTENT_PARSER_OPENAI_KEY` and/or `INTENT_PARSER_ANTHROPIC_KEY` secrets
  in Firebase Secret Manager and binding them to the parse callable when
  it ships with the CREATE integration; until every piece exists, parsing
  fails closed with a named precondition and the deterministic browser
  extractor remains the availability floor. See
  `docs/INTENT_INTAKE_ADR.md`.)

The governed Firebase and Vercel production workflows source-bind all eight
pilot gates above to `true` — the first seven since the `v0.6.0`
production artifact and the decision-room gate since `v0.7.0`. Generic and
local builds still default them to `false`, preserving a build-time rollback
mode. CI validates both modes and runs a focused production-flag browser matrix
before release; a successful build or deployment remains separate from
authenticated staff and provider acceptance.
- `VITE_PILOT_MEMORY_ENABLED` (default off, and deliberately not one of the
  eight production-bound gates above — production-binding is a separate
  future owner decision, mirroring the decision-room gate's own initial
  posture before it was bound. Once a CREATE reading yields both an event
  type and a guest count, reads the tenant's own accepted/booked quote
  history (already tenant-scoped server-side) and, once at least 3
  same-event-type-and-guest-band matches exist, offers the median
  servers/chefs/bartenders and half-hour-rounded hours plus any rental in a
  strict majority of matches as a provenance-labeled suggestion. No AI, no
  cross-tenant learning; below the minimum sample the honest reply is "not
  enough history yet," never a guess. Applying writes only staffing and
  hours to the draft — rentals stay a read-only mention so an existing
  selection is never silently overwritten. See
  [docs/POST_COMPETITIVE_DESIGN.md](docs/POST_COMPETITIVE_DESIGN.md) §4.10.)
- `VITE_BUYER_ACCESS_ENABLED` (defaults off for generic builds; the production
  deployment workflows source-bind it to `true` only alongside syntactically
  valid non-placeholder public flow configuration; provider setup and human
  review remain separate evidence)
- `VITE_BUYER_ACCESS_PUBLIC_CTA_ENABLED` (defaults off; production deployment
  source-binds it to `true`, but `check:env` rejects it unless the route is also
  enabled and Turnstile is configured)
- `VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY` (browser-visible public site key;
  required with valid non-placeholder syntax when buyer access is compiled,
  never use the Turnstile secret here, and do not treat syntax as provider or
  human-review evidence)

To create `.env.local` from the authenticated Firebase project config without
touching `.env`, run:
```bash
npm run env:local:firebase -- --project tonicatering
```
The command is create-only by default. If `.env.local` already exists, it
refuses to overwrite it. An intentional replacement requires both `--replace`
and the exact confirmation token printed by the command.

The root `.env.example` is for browser-safe `VITE_*` values only. Server-side
Firebase Functions placeholders live in
[`functions/.env.example`](functions/.env.example). Copy that template to an
ignored `functions/.env.<firebase-project-id>` file only for local/emulator
validation; that file is non-secret configuration only. Bound-secret emulator
fixtures belong in the separately ignored `functions/.secret.local`; never put
production provider credentials in either file or commit real provider
credentials. Confirm the target is ignored with
`git check-ignore -v functions/.env.<firebase-project-id>` and
`git check-ignore -v functions/.secret.local` before adding any non-production
value.

Firebase Functions now has two explicit codebases. `functions` is the existing
`default` codebase and remains the only codebase selected by current production
and release-candidate workflows. `functions-connect` is the separately pinned
Stripe Connect control-plane package. It exports no function and accepts no
provider configuration. Its dormant source now includes an exact named-
database repository, a receipt-bound current-role authority projection,
transactional HMAC-scoped rate limiter, immutable edge commands with leased
worker receipts, a replay-stable owner handoff, and an injected Accounts v2
Sandbox adapter with exact platform/mode preflight. None is instantiated by the
deploy entry point. Install its locked
dependencies only when validating that codebase with
`npm ci --prefix functions-connect`, and run
`npm run check:stripe-connect-foundation`. Do not replace an explicit
`functions:default` release selector with the generic `functions` selector.
See [`docs/STRIPE_CONNECT_PROGRAM.md`](docs/STRIPE_CONNECT_PROGRAM.md).

The source-only staging infrastructure lives under
[`infra/stripe-connect/`](infra/stripe-connect/README.md). Run
`npm run check:stripe-connect:infra` plus the pinned Terraform format/init/
validate commands documented there. The tracked infrastructure workflow uses
no Google credential or OIDC permission and contains no plan/apply step. A
validated configuration is not a cloud plan, applied resource, App Check
registration, Stripe binding, deployment, or hosted acceptance; each remains a
separately authorized evidence gate.

A read-only live staging preflight is also available through
`npm run check:stripe-connect:staging`. It queries Firebase for the exact
isolated staging project, project number, hosting site, single reviewed WEB
app, and the required `connect-control` named database contract. Passing that
check proves only the current Firebase inventory and selector match; it does
not create infrastructure, produce or apply a Terraform plan, bind App Check,
export Connect functions, enable provider access, or establish Stripe/provider
acceptance.

Dormant Connect status/onboarding contracts can be checked with
`npm run check:stripe-connect:onboarding`. They bind repository source only to
the explicit `connect-control` database selector, reserve one immutable
connection generation, authority digest, and 30-day provider-recovery deadline
before a provider attempt, and enforce reviewed principal and organization rate
windows in one fail-closed transaction. The reservation has no provider key:
the immutable command's `qpcmd_<digest>` value is the sole account-creation
idempotency identity. Edge requests must also match a receipt-bound current
authority projection, while provider account creation and refresh run only in a
separately leased worker with terminal, quarantine, and dead-letter receipts.
After Stripe returns, account binding and Account Link disclosure each recheck
current authority. Drift or post-create validation failure retains the provider
identity/occurrence only in private quarantine evidence; an interrupted command
receipt reconstructs that exact quarantine only while its private occurrence
and account claim remain intact. Account Link disclosure rechecks authority,
state, local/provider expiry, and the clock after its issuance receipt. A
`provider_withheld` attempt returns only to explicit recovery; a receipt-write
failure also withholds the URL and holds the consumed attempt until local
expiry without claiming that a receipt committed.
The injected provider adapter is limited to Sandbox Accounts v2 merchant
configuration with full Stripe Dashboard access and Stripe fee/negative-balance
responsibility; it verifies the exact platform account and Sandbox mode before
access and requires both card payments and payouts before `ready`. The
repository, authority, command, worker, handoff, limiter, and adapter modules
are not imported by the deploy-empty Connect entry point. The one-use browser
destination is an internal QuotePilot POST handoff whose token stays out of the
URL/referrer, never a Stripe Account Link. Passing this check is source evidence
only; it does not establish an applied database, App Check enforcement/
consumption, callable, HTTP endpoint, connected account, provider request,
deployment, or hosted acceptance.

Stripe Functions configuration requires an explicit `STRIPE_MODE` value of
`test` or `live`, a secret/restricted key with the matching mode prefix, and a
webhook secret. Event and Checkout Session `livemode` must also match. The
tracked Functions template and materializer contain only `STRIPE_MODE`;
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
`RESEND_WEBHOOK_SECRET`, `REVENUE_AUTOPILOT_TOKEN_SECRET`,
`TWILIO_AUTH_TOKEN`, `PINGRAM_API_KEY`, `PINGRAM_WEBHOOK_SECRET`, and
`SMS_CONTACT_DIGEST_SECRET` are Firebase Secret Manager values bound only to
Functions that consume them. The materializer rejects all nine. The Revenue Autopilot
Resend webhook binds only `RESEND_WEBHOOK_SECRET` and verifies raw requests with
the repository-pinned `standardwebhooks@1.0.0`; it does not receive the Resend
API key. `REVENUE_AUTOPILOT_TOKEN_SECRET` only signs/verifies opaque unsubscribe
scope. Owner SMS selection is an explicit, deployment-owned
`NOTIFICATIONS_SMS_PROVIDER=none|twilio|pingram` choice; credential presence
never chooses or enables a provider, and the current production value remains
`none`. Twilio's account and Messaging Service identifiers and Pingram's exact
API origin, sender, and lowercase `PINGRAM_CONFIGURATION_GENERATION` are trusted
non-secret runtime values. The server-owned
owner destination must be E.164, and SMS may be enabled only with explicit
`NOTIFICATIONS_OWNER_SMS_CONSENT=granted`. Use the credential-isolated runtime channel
described in the [launch runbook](docs/LAUNCH_RUNBOOK.md) and never place real
provider values in a browser environment, Functions dotenv, or committed file.
The browser reports only non-secret runtime-field completeness and recorded
provider evidence; it does not infer whether a bound credential exists. A
locally complete profile merely permits the provider worker to attempt the
controlled diagnostic, where missing secrets fail closed before a send.

The Pingram source slice is limited to the existing one-way owner-alert path;
it does not add customer SMS or a two-way inbox. It reserves quote/payment
alerts transactionally, binds provider tracking identity privately, and records
signed callbacks in a reprocessable inbox. Signed subscribe/inbound callbacks
are quarantined; unsubscribe or exact inbound `STOP` creates an indefinite v1
hold on all owner SMS sends across provider selection. There is no browser or
callable clear path in this version. Recipient fingerprints are versioned,
organization-scoped HMACs and never expose or link the same destination across
tenant records. A Pingram
send response proves only request acceptance. Only a verified signed webhook
receipt may establish `delivered` or `failed`;
an indeterminate or previously claimed request is not automatically resent.
Automatic alerts require a signed delivered diagnostic for the exact current
configuration generation. Only the exact Pingram
API origins `https://api.pingram.io` (US), `https://api.ca.pingram.io` (CA),
and `https://api.eu.pingram.io` (EU) are accepted by the release materializer.
This source has not been deployed, has made no Pingram provider call, and has
sent no live SMS. Promotion still requires Secret Manager credentials, an
approved sender/A2P and consent record, signed endpoint registration, and a
controlled hosted UAT.

Commercial Change, operational staffing, and Revenue Autopilot use independent
server-owned gates:

```dotenv
COMMERCIAL_CHANGE_AUTHORITY_ENABLED=false
OPERATIONAL_STAFFING_AUTHORITY_ENABLED=false
REVENUE_AUTOPILOT_ENABLED=false
REVENUE_AUTOPILOT_SENDS_ENABLED=false
NOTIFICATIONS_EMAIL_PROVIDER=none
```

Commercial Change additionally requires the trusted tenant setting
`commercialChangeAuthorityEnabled=true`; browser principals cannot enable it.
Operational staffing independently requires the trusted tenant setting
`operationalStaffingAuthorityEnabled=true`; administrators alone manage staff
profiles, full private staff records, operator-recorded availability and staff
briefing artifacts, while same-tenant administrators and sales staff may apply
exact-revision assignment plans. Browser Firestore access to profiles, private
records, assignment invitations, delivery events, schedule fences, plans, and
receipts remains denied. Invitation dispatch additionally requires the approved
Resend notification sender and `STAFF_INVITATION_TOKEN_SECRET` in Secret Manager.
The existing signed `revenueAutopilotResendWebhook` routes events through separate
server-owned provider-message indexes; provider acceptance, delivery,
and staff acknowledgement remain distinct. See
the [authority ADR](docs/OPERATIONAL_STAFFING_AUTHORITY_ADR.md).
Revenue Autopilot evaluation/job authority and outbound sends are separate, so
keep both flags false and the provider `none` until an exact coordinated release
and provider acceptance. The scheduler runs every 15 minutes in UTC but derives
eligibility on the tenant's validated IANA calendar. If a reviewed environment
later enables runtime while leaving sends/provider off, the scheduler enters
preparation-only mode: it may create deterministic private records and repair
currently open unread-reply Attention, but it does not scan dispatch work or
contact the provider. Workflow exposes all four gates and bounded per-lane
preparation receipts. No command here deploys,
configures production, promotes a gate, creates production data, or proves email
acceptance/delivery.

Buyer onboarding uses a separate server-only Stripe test rail. Its non-secret
runtime inventory is `BUYER_ACCESS_ENABLED`, `BUYER_ACCESS_STRIPE_MODE=test`,
`BUYER_ACCESS_APP_BASE_URL=https://quotepilot.mbmapps.com/app`, and
`BUYER_ACCESS_TURNSTILE_HOSTNAMES=quotepilot.mbmapps.com,tonicatering.web.app`.
Store `BUYER_ACCESS_STRIPE_SECRET_KEY`,
`BUYER_ACCESS_STRIPE_WEBHOOK_SECRET`, `BUYER_ACCESS_TURNSTILE_SECRET`, and an
independently generated `BUYER_ACCESS_RATE_LIMIT_SECRET` of at least 32
characters only in Firebase Secret Manager; none belongs in a Functions dotenv
file, GitHub deployment variable, browser variable, log, or release receipt. Do not
reuse a Stripe or Turnstile secret as the rate-limit key. The server gate
defaults off. The existing quote-payment `STRIPE_MODE`, credentials, and
`stripeWebhook` remain independent and unchanged.

The manual Firebase production workflow materializes only reviewed non-secret
runtime configuration plus the allowlisted platform-admin identity immediately
before deployment. Its Firebase CLI authentication is short-lived GitHub OIDC
through Google Cloud Workload Identity Federation; the workflow requires the
fixed-project provider and deployer identity named by
`FIREBASE_WORKLOAD_IDENTITY_PROVIDER` and `FIREBASE_DEPLOY_SERVICE_ACCOUNT`.
The separate protected staffing tenant-gate workflow uses
`FIREBASE_TENANT_OPERATOR_SERVICE_ACCOUNT` and passes one short-lived
Datastore-scoped access token only to its exact read/patch/readback step.
Application provider credentials remain in Firebase Secret Manager and are
never written to Functions dotenv files, artifacts, or logs. The approved
sender identity in configuration does not prove the Resend domain is verified
or enabled; see [PROJECT_STATUS.md](PROJECT_STATUS.md) for provider truth. Backend
and all-surface releases also pass Firebase's explicit non-interactive
acknowledgement for reviewed Functions retry-policy changes; hosting-only
releases do not receive that acknowledgement.

Firebase mutation does not install a provider CLI from npm at the credentialed
step. The workflow first downloads the official v15.24.0 Linux release asset,
verifies its repository-pinned SHA-256, and passes only that verified path to
the deploy command. The governed staging-candidate Firebase mutation uses the
same verifier; a missing or changed artifact fails before mutation.

## Quality Gates
```bash
npm run check:env
npm run test:unit
npm run test:rules:firestore
npm run test:truthloop-export:emulator
npm run test:catalog-import:emulator
npm run test:rebook-quote:emulator
npm run test:operational-staffing:emulator
npm run test:customer-centered-authority:emulator
npm run test:e2e
npm run test:e2e:ambient-release-gate
npm run test:e2e:firebase
npm run test:e2e:firebase:authoritative
npm run test:e2e:firebase:starter-onboarding
npm run build
npm run test:truthloop
npm run check:secrets
npm run check:workflows
npm run check:ambient-release-gate
npm run plan:task -- --task "<bounded work>" --files <path,...>
npm run check:docs:governance
npm run check:capability-surfaces
npm run check:perf:bundle
npm run check:perf:cwv
```

`test:customer-centered-authority:emulator` is the reproducible Firebase
Functions/Firestore trace for customer-centered mutation authority, including
Quick Updates. It proves that an exact simulation receipt is bound to tenant,
quote revision, catalog digest, policy, and requested form; drift produces zero
write; and a successful save is confirmed through the authoritative persisted
quote/version consequences. It is local emulator evidence, not hosted Firebase,
provider, production, or human acceptance.

`plan:task` classifies a bounded task before broad repository reading. It emits
the recommended runner model/reasoning effort, relevant dependency reads,
canonical documentation obligations, ordered checks, and a small task graph.
Pass explicit `--files` in a dirty worktree; add `--json` for an external runner
handoff. Repository code recommends the selection, while the external runner
performs the actual model switch. The policy is owned by
`docs/task-orchestration-contracts.json` and governed by
`docs/AGENT_GOVERNANCE.md`. Use `--phase update` for a material checkpoint and
`--phase complete` for final reporting; each result includes the exact UTC
`lifecycle.recordedAt` timestamp. UI plans additionally require the
`design-language` skill and the repository's canonical design system and
principles before implementation.

For cloud or hosted-agent work, use the bootstrap and handoff packet in
[`docs/ORCHESTRATION_RUNBOOK.md`](docs/ORCHESTRATION_RUNBOOK.md#cloud-runner-bootstrap).
The expected flow is `npm ci`, `npm run check:env`, a bounded
`plan:task --json` packet saved under ignored `.cache/task-plans/`, the emitted
validation list, and a matching `--phase complete` packet. Environment
injection may make the run faster, but provider secrets stay out of tracked
files and evidence claims must keep local, CI, hosted/provider, production, and
human acceptance separate.

`test:rebook-quote:emulator` is a disposable `demo-*` Auth, Firestore, and
Functions lane for the exact-version rebook callable. It verifies same-tenant
authority, concurrent retry convergence, atomic quote/version/portal/customer
writes, immutable accepted-version provenance, collision refusal, and the
mandatory staff-review transition. Passing it is emulator evidence only, not a
Functions deployment, hosted staff acceptance, customer delivery, booking,
payment, or revenue result.

`test:truthloop` runs the Commercial Truth Loop reconciler's unit tests. The
package is standard-library-only, so the gate needs no virtualenv, no package
install, and no network access; `scripts/run-truthloop.sh` selects the newest
available Python 3.11+ interpreter and fails closed if none is present. The lane
runs inside the existing `lane:core` job and adds no new required CI status
context. It runs **last** in that lane deliberately: `lane:core` executes under
`set -e`, so an absent Python toolchain running earlier would suppress the
build, documentation-governance, and bundle gates above it and leave a
contributor with no results at all. Running it last costs nothing — the suite
takes under a second — and keeps a missing interpreter from reading as a broken
build. Passing it is local reconciliation-logic evidence only: it is not an
evidence exporter, a staff surface, hosted verification, provider evidence, a
production deployment, or human acceptance. No commercial record is reconciled
in production until the TypeScript evidence exporter ships.

`check:workflows` downloads only the platform-specific official actionlint
v1.7.12 archive, verifies its repository-pinned SHA-256, and checks every
tracked GitHub Actions workflow. The required `lane:quick` runs this gate before
dependency installation and disables host-provided shellcheck/pyflakes
integrations so runner tool versions cannot change the result.

`test:e2e:ambient-release-gate` runs the protected Alpha interaction proof with
the reviewed Ambient presentation flags and operational staffing authority
explicitly off. It rejects unmapped enabled controls and requires the primary
route handoff to acknowledge within the 250ms contract with an exact contextual
result and a dead-click rate of zero. `check:ambient-release-gate` is the fast
policy guard that prevents the CI command, required flags, zero-rate assertion,
or production workflow binding from being silently removed; `lane:quick` runs
it on every governed change. Passing either command is local/CI evidence, not a
deployment, hosted-role acceptance, or human approval.

`check:perf:bundle` detects whether `dist` contains the compatibility or Ambient
production graph from mutually exclusive route chunks. CI builds and checks
both graphs with an explicit matching `BUNDLE_BUDGET_PROFILE`; a mismatch,
missing marker, or mixed graph fails closed. Temporary profile ceilings live in
`docs/performance/bundle-exception.json` and do not change the clean-main
baseline. The same gate also rejects emitted development-only Staff or Client
fixture chunks and their unique payload sentinels, so local review records
cannot silently enter a production asset.

`check:capability-surfaces` is the mechanical no-orphan-capability gate. For a
backend delivery it requires a revision-bumped contract in
`docs/capability-surfacing-contracts.json`, owns directly changed, new, or
removed Functions by exact symbol, and requires explicit affected-export review
when shared helpers change callable behavior. It verifies real route/control,
assertion-bearing test-title, Feature Matrix, and User Manual locators. Read and
mutation states must be bound to canonical `data-capability-state` assertions in
always-on component/unit tests; only a read surface's not-yet-contracted stale
state may use the narrow separate-program exception. PR/push ranges and
merge-base baselines fail closed, a same-commit branch upstream falls back to
`origin/main`, deleted authority paths remain reviewable, and narrowly
classified headless security/operational/infrastructure work still requires
tests and a safe outcome. A headless contract cannot own a callable export. The
gate proves structural traceability, not semantic completeness, hosted/provider
behavior, production promotion, visual acceptance, or human acceptance.

## Commercial Evidence Export

The Commercial Truth Loop reconciler consumes an evidence bundle rather than
reading Firestore itself. `scripts/reconciliation-evidence-export.mjs` produces
that bundle from already-read authoritative documents and reports what it could
not produce. The end-to-end walkthrough lives in
[docs/COMMERCIAL_TRUTH_LOOP_DESIGN.md § How it works](docs/COMMERCIAL_TRUTH_LOOP_DESIGN.md#how-it-works).

```bash
# Read one tenant straight from Firestore
npm run truthloop:export -- --firestore --organization <organizationId> \
  --evaluated-at 2026-08-21T14:00:00.000Z --out bundle.json

# Or project already-read documents supplied as JSON
npm run truthloop:export -- --source <sources.json> \
  --evaluated-at 2026-08-21T14:00:00.000Z --out bundle.json

npm run truthloop:coverage -- --firestore --organization <organizationId> \
  --evaluated-at 2026-08-21T14:00:00.000Z
npm run truthloop:reconcile bundle.json
```

The exporter is read-only: it opens no write path and reads no clock
(`--evaluated-at` is required so the same source state always produces the same
bytes, verified by a recorded `recordsDigestSha256`).

`--firestore` requires `--organization`; there is no all-tenant read. Every
read is rooted at `organizations/{id}` with no `collectionGroup` query, and any
document whose `organizationId` does not match aborts the run rather than being
skipped — silently filtering it would hide a real data-integrity bug. Each
document is projected through an explicit field allowlist
(`evidence/src/firestoreReader.mjs`), so portal keys, buyer tokens, and
provider webhook secrets cannot reach a bundle even if the projection changes.
The Admin SDK bypasses Firestore rules, so this is explicit-scope and allowlist
containment, not rule-enforced containment. `npm run
test:truthloop-export:emulator` proves these properties against a real
disposable Firestore with a populated second tenant; passing it is emulator
evidence only, not hosted, provider, production, or human acceptance.

Every evidence section carries provenance — source object, source field,
revision, source schema version, observed timestamp, and exporter version —
including sections carrying no value, because which source was consulted and
came up empty is itself evidence. Absence is never collapsed into null: a
section is classified `available`, `missing`, `not_applicable`,
`not_yet_available`, `blocked_by_integration`, `contradictory`, or
`schema_drift`, and only `available` and `not_applicable` let a rule reach a
verdict. A source declaring an unknown schema version is refused rather than
read with current-shape assumptions.

`truthloop:coverage` reports, per rule, how much required evidence is producible
today and classifies each blocker as `engineering`, `integration`, or
`business_policy`. Three sections have no producer: processor payout settlement
is blocked behind the Stripe Connect stopping point in
`docs/STRIPE_CONNECT_PROGRAM.md`, no organization has declared a processor fee
schedule, and no post-event consumption capture surface exists. Until those
land, 8 of 11 rules can reach a verdict and no record can reach
`fullyReconciled`.

Passing these commands is local export and reconciliation-logic evidence only.
The exporter has no Firestore reader, so it is not a production data path, an
operator surface, hosted verification, provider evidence, a deployment, or human
acceptance.

## Orchestration Lanes
```bash
npm run lane:quick
npm run lane:core
npm run lane:firebase-auth-rules
npm run lane:authoritative-pricing
npm run lane:release
npm run lane:release:cwv
```

The CWV release lane uses `LHCI_COLLECT__CHROME_PATH` when supplied; otherwise
it selects the installed Playwright Chromium and fails with an installation
instruction if that browser is unavailable.

## E2E Test Lanes
- `npm run test:e2e`
  - Default browser smoke lane.
  - Excludes Firebase emulator-only specs; those run in the dedicated Firebase
    lanes below.
  - Uses `scripts/run-playwright.sh`, which auto-prepares Linux Playwright runtime libs under `.cache/playwright-libs` when needed.
- `npm run test:e2e:ambient-release-gate`
  - Runs the single protected Ambient Alpha dead-click contract with
    production presentation flags and the independent staffing authority flag
    explicitly disabled.
- `npm run test:e2e:firebase`
  - Firebase emulator browser lane for real Auth, organization bootstrap, and
    Firestore rules coverage.
  - Starts `auth`, `firestore`, and `functions` emulators, seeds
    org/menu/userRole fixtures plus an exact provider-accepted quote portal,
    signs in via UI, validates the organization-scoped catalog, and exercises
    canonical quote conversation exchange across staff and customer views.
  - Uses the isolated `firebase.e2e.json` configuration and dedicated high
    ports. A port conflict fails the lane; the runner does not terminate another
    local process.
  - Requires Java 21 or newer. When the system Java is missing or older, the
    runner prepares and explicitly selects a local JRE under
    `.cache/tools/jre21`.
- `npm run test:e2e:firebase:authoritative`
  - Firebase emulator browser lane that also starts Functions emulator.
  - Requires authoritative pricing callable success and trusted quote creation
    in the save path (no client-only pricing fallback). Its configured fixture
    is confirmed through the same server validator used by owners, then proves
    managed menu deactivation reopens pricing and a stale revision is rejected.
- `npm run test:e2e:firebase:starter-onboarding`
  - Starts with an authenticated owner and an intentionally blank catalog.
  - Proves the owner can choose a starter pack, see the populated menu, approve
    and save pricing, and reach `New Quote` only after the server records the
    exact current-revision confirmation receipt.
- `npm run test:operational-staffing:emulator`
  - Runs the operational-staffing authority matrix against disposable Auth,
    Firestore, and Functions emulators only.
  - Generates a fresh in-memory Auth credential for each run; no reusable test
    password, provider credential, or production identity is stored in source.
- `npm run test:proposal-acceptance:emulator`
  - Starts isolated Firestore and Functions emulators for the public proposal
    acceptance boundary.
  - Proves direct browser acceptance is denied, concurrent callable requests
    converge on one immutable receipt, and signer/revision/hash evidence plus
    integer minor-unit totals persist to both quote copies.
- `npm run test:catalog-import:emulator`
  - Starts isolated Auth, Firestore, and Functions emulators for catalog CSV
    import authority and rollback.
  - Proves browser-authored catalog receipts are denied, same-organization admin
    authority is enforced, prices persist in integer minor units, concurrent
    revision writers fail safely, stable retries are idempotent, and rollback
    deletes only unchanged records without orphaning package dependencies.
- `scripts/provisioning-emulator-acceptance.mjs`
  - Full emulator-only platform/tenant lifecycle matrix run under Auth,
    Firestore, and Functions emulators.
  - Covers provisioning authority, owner activation, trusted quote and portal
    behavior, provider/payment failure boundaries, cleanup, and
    server-authoritative approval request, resolution, exact governed-action
    execution, outcome audit, idempotency, replay protection, and separate
    signed-webhook acceptance for deposit and final-balance collection.
  - The runner refuses non-`demo-*` projects or missing emulator host variables;
    it is local evidence and does not replace hosted tenant acceptance.

Optional env vars for Firebase emulator lane:
- `E2E_FIREBASE_PROJECT_ID` (default: `demo-e2e`)
- `E2E_FIREBASE_ORG_ID` (default: `e2e-org`)
- `E2E_FIREBASE_EMAIL` (default: `e2e-admin@local.test`)
- `E2E_FIREBASE_PASSWORD` (default: `Passw0rd!`)

## Firestore Tenant Seed
Preview baseline event types, menu records, catalog items, and pricing settings
for one existing organization that is not marked inactive or archived. The
command is read-only by default:
```bash
npm run seed:menu:firestore -- \
  --project <firebase-project-id> \
  --organization <organization-id>
```

To preview one of the same starter packs shown during owner catalog setup, add
`--pack` (and optionally an exact historical `--pack-version`):
```bash
npm run seed:menu:firestore -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --pack wedding-events \
  --pack-version 1
```

The available pack ids are `wedding-events`, `corporate-drop-off`,
`bbq-southern`, and `church-community`. Add `--replace-staged-pack` only when
replacing an unconfirmed staged pack; the transaction refuses replacement if
any generated record or pack-controlled pricing setting has been edited.
Published manifest versions are append-only while referenced by a staged
organization; add a new version instead of editing or removing an existing one.

Apply requires both `--apply` and an exact project-and-tenant confirmation:
```bash
npm run seed:menu:firestore -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --apply \
  --confirm "SEED <firebase-project-id> <organization-id>"
```

Notes:
- Project and organization scope must be explicit; environment-derived targets
  and unknown arguments are rejected.
- The target organization must already exist and must not be marked inactive
  or archived.
- Apply creates only missing seed documents. Create operations fail on a
  concurrent identity collision instead of replacing the new record.
- Existing menu items are patched only when `pricingType`, `type`, or `active`
  is missing. Other existing fields and documents are not replaced or deleted.
- The organization record itself is read for validation and is not rewritten.
- Auth uses Firebase Admin ADC/service credentials (`GOOGLE_APPLICATION_CREDENTIALS`) or emulator config.

## Multi-Tenant Migration Safety

The legacy-to-tenant migration is read-only unless `--apply` is explicitly
selected. Both modes require exact project and organization scope:

```bash
npm run migrate:multi-tenant -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --dry-run
```

Apply additionally requires an exact scope-bound confirmation:

```bash
npm run migrate:multi-tenant -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --apply \
  --confirm "MIGRATE <firebase-project-id> <organization-id>"
```

Do not reuse a confirmation for a different project or tenant.

## Customer Portal Projection Backfill

Legacy active customer portal records can be inspected and refreshed from their
organization-scoped quote without replacing customer decisions, payment or
booking evidence, lifecycle history, or unrecognized operator fields. The
command is read-only by default and requires explicit project and organization
scope:

```bash
npm run portal:backfill -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --dry-run \
  --evidence-out <new-evidence-file.json>
```

Review the count-only evidence and resolve every conflict before applying. An
apply requires Firebase Admin Application Default Credentials, a new evidence
path, and an exact scope-bound confirmation:

```bash
npm run portal:backfill -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --apply \
  --confirm "BACKFILL PORTALS <firebase-project-id> <organization-id>" \
  --evidence-out <new-evidence-file.json>
```

Apply mode re-reads each quote and portal in a transaction before writing. It
skips foreign-tenant, deleted, expired, identity-mismatched, and conflicting
commercial records. The create-only private (`0600`) evidence destination is
reserved before any database work and completed atomically with aggregate
counts rather than portal tokens or customer data.

## Customer Identity Backfill

Legacy organization quotes can be classified for a stable same-tenant
`customerId` binding. The command is read-only by default and requires exact
project and organization scope:

```bash
npm run customer:id:backfill -- \
  --project <firebase-project-id> \
  --organization <organization-id> \
  --dry-run
```

The report separates already-bound quotes, unique normalized-email matches,
missing email/customer matches, duplicate matches, and foreign-organization
records. It does not create delivery, portal-view, acceptance, booking, or
payment evidence. It also does not create or repair private customer-email
ownership claims; legacy identity/claim normalization remains a separately
reviewed data operation.

Apply mode in the current source is emulator-only: it fails closed unless
`FIRESTORE_EMULATOR_HOST` resolves to loopback and the project ID begins with
`demo-`. Run the isolated fixture with:

```bash
npm run test:customer-id-backfill:emulator
```

Do not run a production apply from this source. A production backfill requires
separate authorization, a reviewed tenant-scoped dry run, an exact confirmation
contract, and its own release/audit record.

## Stripe Deposit and Final-Balance Workflows

The current source implements deposit and final-balance collection as
separate server-authoritative payment rails. An approved deposit request binds
the organization, quote revision, current portal issuance, customer email,
currency, and deposit amount. A final-balance request additionally requires a
booked contract and verified provider-paid deposit; QuotePilot derives the
remaining amount from the authoritative total and deposit and binds the
contract, deposit evidence, revision, portal, customer, currency, amount, and
checkout generation into its own approval. A versioned ledger and distinct
`payment.finalBalance` projection prevent either rail from rewriting the
other's evidence.

For either rail, a new Checkout Session is first registered as `prepared` with
no browser-readable payment link; QuotePilot retains its URL only in a
server-only dispatch record. The server submits the matching payment-request
email and publishes the link to the quote and customer portal only after
provider acceptance is durably recorded. The browser cannot create a
standalone checkout, choose a payment kind or amount, or mark payment evidence
manually. The customer projection omits Stripe Session and private-dispatch
identifiers.

If Stripe creation or email delivery has an ambiguous outcome, the approval
execution remains in progress. The same admin uses `Resume Pay Request` or
`Resume Balance Request`, which reuses the Stripe-creation and email-provider
identities; when a prepared Session is known, it is reused. If provider
acceptance was recorded but database publication was interrupted, resume
finishes publication without sending again. A definite email failure clears
the private URL and requires a new approval only after the unsent Session is
safely neutralized; unresolved cleanup stays resumable for retry or provider
reconciliation. Late provider settlement may promote a failed or expired
observation to paid without reopening or crossing payment rails.

Payment state is driven by signed, deduplicated
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, and `checkout.session.expired` events.
Admin reconciliation re-reads the exact server-recorded Session for the
selected rail when provider delivery needs review, without overriding settled
payment truth or mutating the other rail.

This behavior is deployed in `v0.6.0`, but deployment does not configure every
Stripe dependency or prove provider acceptance. Operational promotion still
requires mandatory hosted payment UAT in Stripe test mode and separately
authorized live-mode acceptance for each enabled rail.
Refund initiation/status and dispute handling remain manual or unimplemented.
See the
[launch runbook](docs/LAUNCH_RUNBOOK.md#5-functions-runtime-configuration-optional-stripe--owner-sms-twilio-or-pingram--resend-providers)
for configuration and proof requirements.

## Public $1 Invoice-First Buyer Access (`tonicatering`)

The deployed production frontend adds a public acquisition
path at `/start` without creating a second Firebase environment. The buyer
enters organization, owner, and invoice-email details and completes a fresh
Turnstile challenge. QuotePilot does not collect a password or card details at
this step. Server-side Turnstile hostname/action checks, durable rate limits,
and deterministic idempotency guard initiation; Turnstile is an abuse signal,
not identity, payment, or authorization evidence.

Rate-document identities are HMAC-keyed with the dedicated rate-limit secret;
raw network addresses and normalized emails are not stored in those document
ids. Once per public status request, the callable atomically consumes a
60-request-per-five-minute network lease before its first buyer-order read,
including well-formed unknown-order and wrong-token attempts, and fails closed
when its secret or Firestore limiter is unavailable. Any subsequent fulfillment
reads remain inside that bounded request. Each rate record includes an
`expiresAt` Firestore Timestamp; the tracked `firestore.indexes.json` declares
the matching TTL policy on `buyerAccessRateLimits.expiresAt`. The trusted
deployer must promote that Firestore configuration and verify the provider
reports TTL enabled before opening the server gate.
Invoice creation first reserves the request-scoped order identity in the same
durable limiter before any Auth, invitation, or order lookup. An exact retry
continues to consume the per-network budget but does not charge the normalized
email twice during the 24-hour reservation. A different request may replace an
older order only after the email window has elapsed and every prior same-email
order has a provider-verified `void` state. Open and payment-failed
orders may return the same invoice only to the exact original creation request.
Uncollectible/expired, paid, and activation orders cannot be replaced
automatically. A platform administrator may recover only an exact terminal
unpaid test Invoice through Integrations Ops: the server retrieves the stored
Invoice identity from Stripe, permanently voids an uncollectible Invoice,
rechecks that no workspace, settings, invitation, or provisioning record exists,
and records an operator audit. Paid, open, partially paid, fulfilled,
superseded, or mismatched targets fail closed, and the 24-hour email window still
applies before a fresh request. The old void order is marked superseded so a
stale event cannot provision a second workspace.

The Firebase Hosting and Vercel deployment workflows compile `/start` and its
public marketing CTA only with a syntactically valid, non-placeholder,
browser-visible Turnstile site key. `check:env` does not verify Cloudflare
provider setup or human approval. Runtime remains fail closed until the
dedicated Functions are promoted and the separate
`BUYER_ACCESS_ENABLED=true` server gate is explicitly approved; browser flags
never authorize invoice creation.

The `createBuyerAccessInvoice` callable fixes the offer to Starter access, $1
USD, and Stripe test mode. It creates and finalizes a true Stripe invoice before
payment and returns only the Stripe Hosted Invoice Page. The dedicated buyer
Stripe client and `buyerAccessStripeWebhook` endpoint are pinned to API version
`2024-06-20`; the generic quote Stripe client and version remain unchanged.
Dedicated buyer Secret Manager credentials and the endpoint remain isolated
from the existing live quote payment mode, key, `stripeWebhook`, deposit, and
final-balance rails. The buyer endpoint accepts only `invoice.paid`,
`invoice.payment_failed`, `invoice.voided`, and
`invoice.marked_uncollectible`. A retry must recover the same still-open invoice
instead of creating uncontrolled duplicates.

The browser return and `getBuyerAccessInvoiceStatus` are not fulfillment
evidence. Only a matching signed and deduplicated invoice lifecycle event may
establish paid state. `invoice.paid` prepares the organization, neutral
settings, Starter workspace plan entitlements, provisioning record, and pending
activation invitation. It creates no user membership, admin role, custom
claims, or `/app` access. `activation_sent` may be observed only after the
onboarding email provider has accepted the exact activation-instructions
message and that acceptance is durably recorded; provider acceptance is not
delivery. Separately, token-bound `provisioning` with `workspaceReady=true`
stops automatic status polling and may offer `/app` as a manual exact-invoice-
email registration/sign-in and Firebase verification path. That handoff does
not claim that Resend accepted or delivered anything, and the optional
onboarding message is not required to initiate activation. The buyer must use
the exact invoice email, separately receive and complete Firebase email
verification through an authorized continue URL, and consume the unexpired
invitation before the server creates user access; only `active` is access-ready.
Pending, mismatched, unverified, expired, failed, replayed, and cross-account
paths expose no `/app` access.

Buyer records remain marked as controlled Stripe test-mode data and must be
excluded from live revenue and live paid-customer classification. This flow
remains disabled and is not production-accepted until semantic tagging,
exact-target UAT, trusted promotion, true Hosted Invoice Page evidence, signed invoice lifecycle
evidence, any claimed activation-instructions provider acceptance, Firebase verification-
email delivery and continue-URL evidence, and hosted negative-path acceptance
are complete. No provider configuration or live sale is claimed. Refunds,
disputes, cancellations, access revocation, support, tax/accounting, and
separately approved live-mode launch remain open operating gates.

See the
[launch runbook](docs/LAUNCH_RUNBOOK.md#public-1-invoice-first-buyer-access-on-tonicatering)
for Secret Manager, Turnstile, invoice webhook, release, acceptance, and stop
requirements.

## Customer Provisioning (No Stripe)
Provision a customer organization, enforce order-based feature entitlements
(unpaid modules locked off), and generate a copy-ready onboarding message.

Release status: the hardened provisioning workflow is present in the current
`v0.6.0` frontend, Functions, and rules deployment,
but authenticated disposable-tenant owner activation and hosted acceptance are
still pending. Do not infer tenant usability from deployment or `/app`
reachability. See
[PROJECT_STATUS.md](PROJECT_STATUS.md) for current operational truth.

Recommended operator path:
1. Sign in at `/app` with a verified Firebase email as an authorized platform
   admin. Tenant admins cannot create tenants or change paid-plan entitlements.
2. Open `Integrations Ops` → `Customer Provisioning (Admin)`.
3. Select an explicit plan and review the generated order id, canonical owner
   URL, and confirmation prompt before provisioning.
4. For an existing organization, explicitly select
   `Update an existing organization (plan entitlements only)`. That mode does
   not change owner identity, branding, catalog data, invites, or email state.

The in-app workflow uses the `provisionCustomerOrder` callable, writes an
auditable `provisioningOrders/{orderId}` record, and exposes the post-provision
owner acceptance steps. Matching interrupted orders can be resumed
only after the organization, settings, owner access, and catalog artifacts
still match; conflicting or incomplete replay is rejected without sending
email. Optional email dispatch uses an order-scoped idempotency key and an
expiring audit-backed lease so concurrent retries cannot start another send.
Pending email invitations expire after seven days, and the exact invited email
must be verified before organization bootstrap can consume the invitation.
New owner invitations carry the explicit `organization_owner` purpose. Exact-
email verified activation atomically binds `organizations/{id}.ownerUid`,
consumes the invite, establishes the existing admin access, and records one
browser-private immutable binding receipt. Generic admin or sales invitations
remain role-only, and Firestore rejects every browser create, update, or delete
of `userRoles`; role authority must use a reviewed server path.
New tenants begin with a blank catalog so an unreviewed zero-price placeholder
cannot reach a customer quote. The owner workspace remains in catalog setup
mode until an organization admin either builds a catalog or stages one of the
four industry starter packs, reviews at least one named package priced above
zero plus an event type, and explicitly confirms the tenant's pricing setup.
Pack prices are suggestions and never activate the quote workspace on apply.
Apply, safe pre-confirmation replacement, catalog saves, and pricing
confirmation all use catalog revision preconditions. Pack-generated records
carry immutable baseline hashes so custom records and owner-modified pack
records are distinguishable; replacement never overwrites either owner-edited
records or owner-edited pricing settings. Final confirmation revalidates the
complete catalog on the server and records the admin actor, time, and confirmed
catalog revision. The quote workspace and authoritative pricing both require
that exact actor-attributed receipt to match the current revision; a boolean
flag alone is not activation evidence. The validator checks every package,
guided-selling, and event-template reference, including active availability,
and rejects malformed pricing collections as a controlled precondition.
Catalog Admin also owns proposal presentation defaults: a bounded document
font scale, logo/monogram letterhead state, brand readiness, guided-rule
coverage, and cost/margin coverage summaries. Trusted quote create/edit
snapshots persist the chosen document font scale so proposal preview and PDF
exports match the saved quote while cost and margin remain staff-only.
Monetary amounts are persisted in integer minor units, with
lossless legacy values migrated during server confirmation. Firebase quote creation and duplication use trusted
callables that re-price from current tenant data and create the draft quote,
portal snapshot, and first version atomically; direct Firestore quote creation
is denied. Client totals, pricing snapshots, owner/record identities, and
deposit links are not creation authority. Trusted edits also re-price and
atomically update quote/portal state with a new version; terminal commercial
evidence blocks overwrite. Reopen and permanent cleanup are admin-callable
operations, and direct quote/portal deletes are denied. Portal decisions update
the public snapshot and organization quote in one atomic batch; accepted and
declined outcomes are terminal. The provisioning callable is the only supported
write path for tenant creation and existing-organization entitlement changes.

### CLI safety preview

The local CLI is preview-only and performs no provisioning writes. Live CLI
writes are disabled because sequential provider operations cannot guarantee an
atomic tenant handoff. `--apply` is rejected; use the audited in-app workflow.

Preview the proposed new tenant:
```bash
npm run customer:provision -- \
  --project <your-project-id> \
  --organization acme-events \
  --order-id acme-events-001 \
  --name "Acme Events" \
  --owner-email owner@acme.com \
  --owner-name "Avery Owner" \
  --plan growth \
  --email-out ./artifacts/onboarding/acme-events-email.txt
```

What the preview script does:
- Requires explicit `--organization`, `--order-id`, `--name`,
  `--owner-email`, and `--plan` values; it never guesses a tenant or order
  identity.
- Requires an explicit starter, growth, or enterprise plan.
- Previews ordered feature entitlements and onboarding copy without creating
  catalog defaults.
- Rejects unknown arguments and any `--app-url` that does not exactly match the
  configured canonical `APP_BASE_URL`.
- Prints a `DRAFT - DO NOT SEND` handoff and optionally creates it with
  `--email-out`; an existing file is never overwritten.
- Uses `https://quotepilot.mbmapps.com/app` as the default owner sign-in URL.

Do not use the CLI to create or update an organization. Use the explicit in-app
platform-admin workflow.

## Release Entry Points

Primary production deployment is manual-workflow-only:

- `npm run release:uat:plan -- --target <profile> --candidate-profile <staging-safe-off|staging-staffing-authority|staging-provider-acceptance>`
  prints the selected fixed candidate's applicable and blocked checks. The
  staffing profile enables only the global staging staffing gate and still
  requires one separately authorized disposable tenant. Applicable is not
  passed, and blocked checks cannot be waived or supplied to the exact-main
  all-positive attestation. The provider-acceptance profile is Firebase-only,
  starts from verified safe-off readback, enables Resend plus test-only Stripe,
  buyer, and staffing paths for controlled records, and requires same-SHA
  Firebase and Vercel safe-off receipts to close the window. Immutable Vercel
  preview remains on `staging-safe-off` because its generated hostname cannot
  be pre-bound to the exact Turnstile hostname allowlist.
- `Deploy Firebase Production` deploys the explicitly selected `hosting`,
  `backend`, or `all` surface to the fixed `tonicatering` project.
- `Deploy Vercel Production` builds and promotes the exact release to the fixed
  `mbmapps/quoteflow` project and `quotepilot.mbmapps.com` production edge.
- `Release UAT Attestation` remains available when a release needs a separately
  recorded human acceptance receipt. Its v4 receipt binds the exact tracked
  candidate profile and that profile's fixed SMS provider in addition to the
  SHA, target, immutable staging id, checklist digest, and human actor. It is
  not a prerequisite for the normal solo-operator deployment path.
- Customer-specific Firebase Hosting promotion is not yet supported by the
  primary release path. The legacy tracked customer-site entrypoint
  fails closed without invoking a provider client.

Each deployment requires the full release SHA, the successful exact-SHA
`CI Quality` run id, a full target-specific rollback SHA, and an exact typed
deployment confirmation. Before dependency execution, the workflow verifies
that the release is the current remotely published, semantically tagged
`main`, that all eight required CI jobs passed, that the rollback is an
available ancestor, that the dispatch came from the canonical workflow, and
that the configured production environment is protected-branch-only with
administrator bypass disabled. Solo mode additionally requires the one
allowlisted human dispatcher. The same live evidence is checked again after
the build and immediately before provider mutation. The Vercel token and the
Firebase workload-identity ADC file are scoped to their final mutation steps;
Firebase production rejects the legacy `FIREBASE_TOKEN` path.

The pre-merge candidate path is narrower than the production workflows. It
uses the checksum-verified official Firebase v15.24.0 binary for every Firebase
CLI read or mutation, exact `google-auth-library` 10.5.0 ADC for public Rules
API readback, and direct Vercel Build Output/file/deployment APIs for preview.
Rules permission and the fixed Vercel project are checked read-only before a
receipt can enter a provider-mutation state. The candidate path does not invoke
`npx` or dynamically resolve a Firebase/Vercel package.

The Vercel step uses the fixed reviewed project link, pulls that project's
production settings with the scoped token, revalidates the fixed project
identity and live release evidence, and only then performs the prebuilt build
and production promotion. Public Vite app URL, host, base-domain, and default-org
values are supplied explicitly by the governed step so protected Vercel values
cannot become literal redaction placeholders in the client bundle. The exact
returned deployment URL is validated and explicitly bound to
`quotepilot.mbmapps.com`, including after a prior provider rollback pinned that
custom alias. The pull remains provider configuration input; it does not
reenable Git-triggered deployment. The reviewed Vercel SPA fallback resolves to
`/index.html` without the incompatible `cleanUrls` redirect; filesystem assets
retain precedence and authenticated deep links remain client-routed.

Both production frontend paths explicitly compile the reviewed
customer-centered workspace with
`VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED=true` in the credential-scoped deploy
step. The source flag remains available for a code-level rollback; it is not
inherited from an operator shell or mutable repository variable.

For a release containing either Stripe collection rail, every applicable
`payment.*` item printed for the selected target is mandatory. Deposit and
final-balance dispatch, signed-webhook/reconciliation behavior, cross-rail
isolation, customer-safe projection, and browser surfaces must be observed on
the exact coordinated hosted candidate as their target applicability requires.
Local tests and emulator events are source evidence only, while a successful
UAT attestation records the observed application contract; neither alone is
Stripe test-mode or live-mode provider acceptance.

For a release containing public buyer onboarding, every applicable `buyer.*`
item is likewise mandatory. Hosting/Vercel items cover the public Turnstile
entry and the locked pending/activation instructions; they do not prove email
provider or backend fulfillment. Backend items cover Turnstile hostname/action
verification, durable rate limits, idempotent true Hosted Invoice Page creation,
buyer API and webhook version `2024-06-20`, signed invoice lifecycle, paid
workspace preparation, pending-invite enforcement, activation-instructions provider acceptance, Firebase
verification-email delivery and authorized continue URL, exact-email claim,
negative paths, and isolation from the quote Stripe rail. No single target
receipt proves an unbound frontend, backend, or provider dependency, so retain
a coordinated provider record for the exact deployed surfaces.

The `backend` and `all` scopes always deploy Firestore rules and Functions
together. Vercel Git auto-deployment remains disabled so publication to `main`
cannot silently mutate production. Provider/environment setup and the complete
operator sequence live in [docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md).

### Multi-Site Hosting (Per Customer)
Use one Firebase project with multiple Hosting sites, then map each customer domain to its site.

Create the site and domain mapping through an authorized provider operator. The existing
`deploy:firebase:hosting:customer` helper is not an approved production path:
it now fails closed without invoking a provider client. Customer-site promotion
is blocked until it receives a fixed-target, exact-SHA workflow equivalent to
the primary targets.

## Governance Docs
- Contributor workflow: [CONTRIBUTING.md](CONTRIBUTING.md)
- Version/release playbook: [docs/VERSION_CONTROL.md](docs/VERSION_CONTROL.md)
- Agent governance: [docs/AGENT_GOVERNANCE.md](docs/AGENT_GOVERNANCE.md)
- Skill index: [docs/SKILLS.md](docs/SKILLS.md)
- Staff/admin operations guide: [docs/USER_MANUAL.md](docs/USER_MANUAL.md)
- Feature inventory and implementation chronology: [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md)
- Customer-centered workspace architecture: [docs/CUSTOMER_CENTERED_WORKSPACE_PLAN.md](docs/CUSTOMER_CENTERED_WORKSPACE_PLAN.md)
- Customer identity/360 backend contract: [docs/CUSTOMER_WORKSPACE_BACKEND_HANDOFF.md](docs/CUSTOMER_WORKSPACE_BACKEND_HANDOFF.md)
- Cloud/local orchestration blueprint: [docs/ORCHESTRATION_BLUEPRINT.md](docs/ORCHESTRATION_BLUEPRINT.md)
- Cloud/local orchestration runbook: [docs/ORCHESTRATION_RUNBOOK.md](docs/ORCHESTRATION_RUNBOOK.md)
- Performance guardrails: [docs/PERFORMANCE_GUARDRAILS.md](docs/PERFORMANCE_GUARDRAILS.md)
- Current operational state: [PROJECT_STATUS.md](PROJECT_STATUS.md)
- Prioritized backlog: [DEV_TASKS.md](DEV_TASKS.md)
- Change history: [CHANGELOG.md](CHANGELOG.md)
