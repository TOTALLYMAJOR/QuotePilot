# Live Briefing + Control Room — Transformation Plan

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
provenance rows. Operations Switchboard = grouped presentation of the existing
routed tools with attention counts from their own models.

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
