# Live Briefing + Control Room — Transformation Plan

Last updated: 2026-09-04 18:01:21 CDT

## Calendar-first Operations execution refinement

The unpushed local candidate replaces only the `/app/operations` switchboard
presentation with the existing `EventScheduleView`. Its accepted/booked
projection, Month/Week models, conflict/capacity logic, staff-lead mutation,
production checklist, kitchen checkpoints, and run-of-show remain the
authority. Month gives the full primary width to the month calendar and places
the selected day, focused event, conflict consequence, and operational domains
in a contextual workspace below. Week uses a true seven-day time grid with a
vertical time axis, start-time position, duration height, collision lanes, and
a secondary contextual rail. Both presentations retain the same selected date
and event where sensible. The 390px agenda is derived from the same
day/event/conflict projection rather than becoming a third implementation.

Operational sections begin collapsed. Conflict comparison appears only when a
derived conflict is being reviewed, and there is no manual or persisted
"resolved" state: the existing model recomputes after authoritative schedule,
date, time, duration, venue, guest-count, or lifecycle inputs change on the
affected Opportunity. Staffing and checklist work remain authoritative for
their own domains but do not masquerade as conflict clearance. Tools is
secondary and ordinary copy uses operator-facing event language rather than
component, source, model, or design terminology.

`/app/schedule` remains compatible and exact Now/Opportunity/Calendar handoffs
use the existing arrival contract only while `eventSchedule` is enabled. When
that capability is disabled, Operations is removed from primary and secondary
navigation, neither Calendar route mounts the surface, and contextual Calendar
handoffs are withheld. Reporting remains independently controlled by its
existing capability; People retains its administrator/staffing gate.

This source slice does not implement Control Room live telemetry, a second
Event entity, staff check-ins, issue records, or actual-stage claims. The
previous local promotion evidence belongs to the earlier rendered source; the
new exact head must repeat its critical Operations and role-aware reachability
matrices before it can be described as qualified. Disabled-capability omission
is not navigation retirement: the routes remain recognized and fail closed.

Status: evaluated and phased (Aug 13, 2026); first source/local planning and
Staff People presentation slice added Aug 14, 2026. Source brief: "QuotePilot
UI/UX Transformation Prompt — Live Briefing + Control Room System"
(user-provided).
Companion: docs/PROPOSAL_COMPOSER_PLAN.md — the Proposal Composer shipped on
`feature/proposal-composer` is the quote-surface installment of this system and
already carries the brief's exact visual language.

## 1. Evaluation against the real product

The brief's palette (`#F3EFE6` bone, `#FBFAF6` surface, `#171D1A` ink, brass
`#A7771C`, teal `#0F6B61`, amber `#B17A21`, red `#B65143`, dark nav `#17191D`)
and its serif/sans typography roles are **identical** to the Proposal Composer
brief. The composer ships them today as scoped `--pc-*` tokens
(src/components/proposalComposer.css); Bodoni Moda + Manrope + DM Mono are
already loaded app-wide, and the ≥1181px dark nav rail (#17181c) from PR #50 is
within one hex step of the brief's `#17191D`.

Much of the brief describes evolutions of surfaces that exist:

| Brief concept | Existing substrate |
|---|---|
| Morning Briefing home | `CommandCenterHome` / NOW view ("What needs your attention" heading) |
| Decision classification | `decideStackPresentation.js` (advisory cards with signal/family), proposal-readiness gaps, composer watching board |
| Event Pulse states | readiness score + status model (`needs_details / review / ready`) + booking lifecycle |
| Event Focus Mode | `EventWorkspaceView` (two-column briefing layout, side rail, readiness donut) |
| People | Staff workspace `/app/staff` (roles, rates, qualifications, private records, invitations, briefing PDFs) |
| Adaptive friction / impact preview | server-authoritative `CommercialChangeImpactPanel` (cwf-15b) + composer consequence cards + #83 what-if deltas |
| Ambient Pilot + ⌘K | `PilotCommandBar` (query + mutating NL intents, voice), `CommercialSearchPalette` |
| Inline editing + autosave feedback | `InlineValue`, composer save-state chip |
| Activity / audit | quote versions, workflow timeline, change-request receipts |
| Library building blocks | catalog admin (packages/menus/add-ons/rentals/pricing), event templates, `STAFF_RULES`, upsell rules |
| Operations Switchboard | existing routed tools: Messages, Workflow, Schedule, Reporting, Integrations, Import Studio, Diagnostics |

**What has no data model today** (must not be faked in UI):

- **Live telemetry**: no live event-state entity (current stage, issue records,
  staff check-ins, timestamps). `eventRunOfShow` builds the *planned* timeline;
  nothing captures *actuals*. Blocks Control Room (§19–23), Replay (§24).
- **Cross-event actuals**: Learn-mode patterns (§25) need replay data first.
- **Decision Memory** (§26): no override-reason field, though the substrate
  exists (impact-preview receipts + version linking) — this can start early.
- **External watch signals** (weather, rental-confirmation ETAs): no
  integrations produce them; "Watching" must only state what the record shows.
- **Per-staff live task checklists** (§23): assignments exist; task items don't.

## 2. Phasing (grounded version of the brief's §44)

### Phase 1 — Global visual system (next session; needs screenshot + axe passes)
Promote the composer's `--pc-*` palette to global tokens; move workspace
canvas from the PR #50 near-white neutral to bone editorial surface-by-surface;
adopt serif for page titles/major numbers; nav rail hex to `#17191D`; motion
tokens already exist (`--motion-*`, `--ease-*`). Every step re-runs
`e2e/accessibility.spec.js` (axe contrast, 1440/390) — the muted `#74746E` and
amber/red text tones need the same AA-deepening treatment the composer used.

### Phase 2 — Morning Briefing + Clear the Deck (buildable on current data)
Evolve `CommandCenterHome`: date/greeting, day summary counts, then sections
Now / Watching / Recently resolved fed by the decide stack, workflow queue,
portal decisions, and activity. Add the five-class taxonomy
(Information/Action/Decision/Exception/Watching) as a presentation model over
those existing sources. Clear the Deck = sequential presentation of the same
decision items (stepper over the decide stack) with the existing impact
machinery; "What if I do nothing?" renders each card's existing basis/impact
fields plus escalation timing where the record has one.

### Phase 3 — Event Focus Mode sections
Reorganize `EventWorkspaceView` into Needs Attention / Upcoming / People /
Service / Client / Logistics / Money / Activity — a re-presentation of read
models that already exist (staffing authority, quote scope, portal decisions,
messaging, totals). Event Pulse label derives from existing readiness + open
advisories (Stable / Watching / Needs Input map cleanly; At Risk / Critical
need defined triggers — start with booking conflicts + expired validity).

### Phase 4 — Control Room + Staff Live Mode (needs an ADR first)
New data model: live event session document (current stage pointer over the
run-of-show, issue records with owner/elapsed/status, staff check-ins),
Firestore realtime listeners, staleness indicator ("Last updated Ns ago"),
role-scoped staff view on the same object. Follow the repo's ADR pattern
(EVENT_WORKSPACE_ADR.md et al.) before building; server-side authority for
issue state transitions mirrors the operational-staffing callable pattern.

### Phase 5 — Replay, Learn, Decision Memory
Replay renders the phase-4 event log against plan (plan-vs-actual for staff
cost/timing needs actual check-in/out times). Learn-mode patterns aggregate
replays per venue/template. Decision Memory starts earlier: capture an
optional reason when an owner overrides a recommendation (composer + impact
panel), store beside the version link, resurface on the next comparable quote.

### Phase 6 — Library + Operations presentation
Library as "reusable building blocks" with composition counts ("used by N
events" is countable from `eventTemplateId` references) and existing
provenance rows. Operations is the established Calendar authority presented as
Month with a full-width calendar and lower contextual workspace, Week with a
true time grid and secondary detail rail, and a same-model mobile agenda. The
former switchboard is superseded; secondary Tools retain gated continuations
without becoming another operational index.

Current source/local slice (Aug 14, 2026): `/app/clear-the-deck`,
`/app/events`, `/app/events/:quoteId`, `/app/events/:quoteId/live`,
`/app/events/:quoteId/replay`, and `/app/operations` are wired as planning
surfaces over current bounded evidence. They deliberately report live pulse,
current phase, issue actuals, and replay as not established until a
server-owned event-operations aggregate exists. `/app/staff` now carries the
brief's Staff People composition (fixed object rail, read-first profile,
readiness, next-best assignment action, and progress narrative) while retaining
the existing private-record editing, invitation, provider, and acknowledgement
authority.

### Phase 7 — Retirement
Only after parity per surface, mirroring the flag pattern used for the
composer (`VITE_PROPOSAL_COMPOSER_ENABLED`) and PR #50's default-on flip.

## 3. Standing constraints (apply to every phase)

- Dual graph tax: every App-level wiring change lands in both `App.jsx` and
  `LegacyApp.jsx` until the strangler completes.
- Default e2e lane pins new flags off; each phase adds a flag-on spec lane.
- Bundle budget is a hard gate; recalibrate the named exception per profile
  with measured numbers (precedent: #83 and this branch).
- Customer-facing surfaces never render margin, costs, watch states, or
  operational internals.
- Nothing estimated in the UI: every number comes from an authoritative model
  or is declared unavailable (marginPresentation's fail-closed convention).
