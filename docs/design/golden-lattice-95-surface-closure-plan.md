# QuotePilot Golden Lattice 9.5 Surface Closure Plan

Last updated: 2026-09-04 18:35:25 CDT

## Decision

Treat QuotePilot as a golden commercial spine inside a role- and state-dependent
workflow lattice. The first visual-closure pair is:

1. **Operations** — the cross-domain switchboard where event, workflow,
   schedule, reporting, Library, and system work should be prioritized.
2. **Exact Opportunity** — the central commercial object where quote, client,
   proposal, payment, staffing, event, and conversation paths converge.

The Opportunities index is included as the entry/return context for the exact
Opportunity, but it is not a third redesign program.

This plan does not authorize a new navigation model, business authority,
backend mutation, provider action, deployment, or production claim. It
preserves Calm Four: Now, Opportunities, Clients, and role-safe Library remain
the only primary destinations; New quote remains an action; Operations remains
secondary.

## Why these two surfaces

Operations needs structural work rather than cosmetic polish. The current
screen is a clean but undifferentiated directory of six destinations. Its
evidence rail can visually dominate the operator's next decision, every tile
has equal weight, and the large unused desktop canvas communicates neither
urgency nor operational command.

The exact Opportunity is the highest-leverage adjacent surface because it is
the lattice hub. It already has the strongest product identity and clearest
story, so its closure work should be restrained: protect the first useful
viewport, keep Quick Updates discoverable, prevent shell/continuity collisions,
and make the selected object's relationships explicit without adding noise.

## Current screenshot evidence

All accepted screenshots below were captured with Playwright against the
current checkout at `7853aa4028b0fad9f7d6d7be8aca99d2460f3f04`. They are
local fixture or local unavailable-state evidence only.

| Step | Surface and viewport | General health | Evidence |
|---:|---|---|---|
| 1 | Operations, 1440 x 1000 | Structurally weak, visually clean | `output/playwright/golden-lattice-95/01-operations-desktop.png` |
| 2 | Operations, 390 x 844 | Usable but overlong and weakly prioritized | `output/playwright/golden-lattice-95/02-operations-mobile.png` |
| 3 | Opportunities index, 1440 x 1024 | Strong hierarchy and scanability | `output/playwright/golden-lattice-95/03-opportunities-desktop.png` |
| 4 | Exact Opportunity, 1440 x 1024 | Strong identity; continuity/chrome collision risk | `output/playwright/golden-lattice-95/04-opportunity-desktop.png` |
| 5 | Opportunities index, 768 x 900 | Healthy, with a tall header cost | `output/playwright/golden-lattice-95/05-opportunities-tablet.png` |
| 6 | Opportunities index, 390 x 844 | Strong list; first viewport is dense | `output/playwright/golden-lattice-95/06-opportunities-mobile.png` |
| 7 | Exact Opportunity, 390 x 844 | Strong story; contextual controls fall below first viewport | `output/playwright/golden-lattice-95/07-opportunity-mobile.png` |
| 8 | Operations, 768 x 900 | Clean but still a flat six-tile directory | `output/playwright/golden-lattice-95/08-operations-tablet.png` |

The Operations captures show the unavailable-read state because the local
review run has no authoritative staff snapshot. This is valuable evidence for
recovery hierarchy, but it is not sufficient evidence for populated, partial,
stale, or role-restricted Operations states. Those states are required by the
qualification matrix below.

## Provisional baseline

These numbers are planning baselines, not release verdicts. They reflect the
captured visual states plus current route contracts; they do not substitute for
hosted or human acceptance.

| Surface | Provisional score | Main reason it is below 9.5 |
|---|---:|---|
| Operations | 7.3 / 10 | Flat destination grid, weak task hierarchy, dominant evidence rail, and excessive unused desktop space |
| Exact Opportunity | 8.7 / 10 | First-viewport crowding on mobile, Quick Updates delayed below the fold, and shell/continuity collision visible in the desktop capture |
| Opportunities entry/return context | 8.8 / 10 | Strong overall; tablet/mobile masthead height and dense first viewport still need proof against long-copy fixtures |

## The 9.5 scoring contract

The score is a closure tool, not a claim about customer adoption. Each category
is scored from 0 to 10 with the listed weight.

| Category | Weight | What earns a 9.5-level result |
|---|---:|---|
| Task hierarchy and decision compression | 20% | One dominant next action; state, consequence, and secondary tools are ordered without interpretation work |
| Workflow and lattice continuity | 20% | Exact client/opportunity/event context survives every supported handoff and return without object substitution |
| Responsive composition | 15% | The dominant identity, state, and action remain useful at 390, 768, and 1440 px; no essential control is accidentally deferred |
| Accessibility and interaction clarity | 15% | Keyboard, focus, target size, labels, reading order, zoom, reduced motion, and forced-colour behavior pass the declared matrix |
| Visual craft and product identity | 15% | Typography, spacing, alignment, image role, density, and state styling feel intentional and recognizably QuotePilot |
| State, evidence, and recovery truth | 10% | Loading, partial, stale, unavailable, success, and role-denied states preserve independent evidence domains and name the next safe action |
| Stability and performance | 5% | No console/runtime errors attributable to the surface, material layout shift, bundle regression, dead control, or unsafe delayed response |

A surface may be called **9.5/10 candidate quality** only when:

- its weighted score is at least 9.5;
- no category is below 9.0;
- it has no open P0 or P1 finding;
- every required screenshot is current and inspected;
- the paired DOM, keyboard, Axe, zoom, state, and route assertions pass;
- the change preserves role, tenant, revision, pricing, provider, and evidence
  authority; and
- local, hosted, production, assistive-technology, and human evidence remain
  separately labelled.

Screenshots drive visual judgment but cannot alone prove persistence,
authorization, keyboard behavior, screen-reader comprehension, provider
outcomes, or human acceptance.

## Phase 0 — Freeze the evidence and scenario matrix

### Work

- Add one purpose-built Playwright surface-closure spec that uses stable local
  fixtures and writes numbered captures to one ignored run directory.
- Keep the current screenshots as the before set; do not use older cached
  screenshots as current proof.
- Record viewport, role, state, route, fixture identity, screenshot timestamp,
  Git SHA, and relevant presentation gates beside each capture.
- Add an explicit visual-review checklist for hierarchy, clipping, wrapping,
  target size, bottom-nav clearance, focus paint, and unintended overflow.

### Exit gate

- Every planned state is reproducible without production credentials.
- Each screenshot is inspected and rejected if blank, loading, cropped,
  unstable, or showing the wrong state.
- Browser console and page errors are recorded separately from visual findings.

## Phase 1 — Shared frame and continuity corrections

Complete this before surface-specific polish because shell defects contaminate
both surfaces.

### Work

- Resolve the desktop exact-Opportunity capture where the fixed **New quote**
  label appears clipped while the Current task rail is present.
- Define one collision-free vertical stack for global chrome, Current task,
  durable action feedback, route identity, and mobile bottom navigation.
- Normalize route canvas origin, maximum width, outer gutters, and fixed-chrome
  offsets across Operations, Opportunities, and exact Opportunity.
- Keep Current task useful but compact. It must not visually outrank an exact
  object's identity or dominant next action.
- Preserve native Back/Forward and the existing dirty-draft guards.

### Likely implementation surfaces

- `src/components/WorkspaceShell.jsx`
- `src/components/WorkspaceTaskJourneyNotice.jsx`
- `src/components/workspaceTaskJourneyNotice.css`
- `src/components/WorkspaceActionFeedbackNotice.jsx`
- `src/styles.css`

### Exit gate

- New quote, continuity rails, route heading, and primary task content never
  overlap or clip at 390, 768, or 1440 px.
- Maximum-copy fixtures and both continuity rails fit without horizontal
  overflow or obscured focus paint.

## Phase 2 — Operations becomes an operating brief

### Direction

Preserve Operations as a secondary lattice switchboard, but change its visual
logic from **six equal destinations** to **what needs action, what is moving,
and where deeper tools live**.

### Work

1. Lead with an operator-facing outcome and current operating condition, not
   “Daily, business, and system workspaces.”
2. Introduce three clear regions:
   - **Needs action now** — bounded blockers and due attention;
   - **Events moving now** — next accepted/booked events, timing, staffing or
     BEO gaps, and one exact continuation;
   - **Business and system tools** — Reporting, Library, integrations, and
     diagnostics as secondary utilities.
3. Reduce Data freshness to a compact evidence disclosure when a last complete
   read exists. When no complete read exists, keep the recovery visible but do
   not let a diagnostic explanation become the page's main story.
4. Give cards real hierarchy through content and grouping, not extra decoration.
   Events, Workflow, and Schedule should not look equivalent to Reporting,
   Library, and System.
5. Replace generic descriptions with consequence-aware copy and an exact next
   action. Do not invent readiness, urgency, or a derived summary.
6. On mobile, show the top operational action and next event before the tool
   directory. Collapse secondary business/system tools behind one accessible
   disclosure when necessary.
7. Preserve disabled Library behavior for non-admin roles and all current
   feature/tenant gates.

### Likely implementation surfaces

- `src/components/LiveOperationsPlanningViews.jsx`
- `src/styles.css`
- existing snapshot, event, Workflow, schedule, reporting, Library, and
  diagnostics route helpers only where presentation data is already available

### Non-goals

- No new operational authority or write command.
- No invented event-readiness score.
- No promotion of Operations into Calm Four primary navigation.
- No generic KPI dashboard or nested card-on-card redesign.

### Exit gate

- A user can answer “What needs me now?”, “What event is next?”, and “Where do
  I continue?” from the first useful desktop and mobile viewport.
- Populated, empty, partial, stale, unavailable, admin, and sales-role states
  retain truthful and visibly distinct behavior.

## Phase 3 — Exact Opportunity restrained finishing

### Direction

Preserve the hospitality-led hero, exact identity, editorial typography, and
single Next action. Improve discoverability and responsive compression without
turning the page into an administration dashboard.

### Work

1. Keep event identity, lifecycle state, location/time/guest context, and the
   dominant Next action in the first useful mobile viewport.
2. Keep **Quick Updates** persistently discoverable beside that decision zone.
   It may be a compact toolbar action on mobile; it must not require scrolling
   past the hero and Next card merely to discover that it exists.
3. Reduce the mobile hospitality image height or move it after the decision
   zone when Current task is present. Preserve the image's truthful decorative
   role and intrinsic sizing.
4. Add the smallest useful selected-object relationship spine for exact Client,
   Opportunity, and Event/quote administration context. It must use opaque IDs,
   never infer a relationship by name, and remain visually quiet.
5. Keep Next, Quick Updates, and deeper object inspectors in a clear hierarchy:
   primary continuation, bounded quick edit, then contextual inspection.
6. Validate long event/client names, accepted/booked immutability, sent/viewed
   editor handoff, unavailable proposal dimensions, and staffing-disabled states.
7. Preserve the existing exact-delta review, dismissal guard, revision fence,
   provider boundary, and authoritative reread requirements.

### Likely implementation surfaces

- `src/components/AmbientLivingOpportunity.jsx`
- `src/components/ambientLivingOpportunity.css`
- `src/components/QuickUpdatesPanel.jsx`
- selected-object identity/arrival helpers where an existing canonical contract
  can be reused

### Non-goals

- No replacement visual language.
- No second primary CTA.
- No duplication of quote administration controls.
- No presentation-owned pricing, staffing, payment, or readiness calculation.

### Exit gate

- Event identity, state, one dominant next action, and Quick Updates are
  discoverable without accidental below-fold loss at 390 x 844.
- Desktop and tablet preserve the editorial composition with no shell,
  continuity, or New quote collision.
- The exact object and return path remain unambiguous at every breakpoint.

## Phase 4 — Lattice handoff proof

The visual program is incomplete if each screen looks polished in isolation but
crossing between them loses context.

### Required flows

1. Operations event → exact Opportunity → Staffing review → Back to exact
   Opportunity → Back to Operations.
2. Operations Workflow item → exact Workflow focus → exact Opportunity → return
   with Current task unchanged until authoritative completion.
3. Opportunity → Quick Updates → contextual Library → exact opportunity return.
4. Opportunity → Proposal or payment inspector → Quote administration → exact
   opportunity return.
5. Mobile equivalents with fixed bottom navigation, dirty-draft guard, and
   focus restoration.

### Exit gate

- Every route resolves the exact opaque object before announcing success.
- Navigation and inspection create zero business writes.
- Completion is claimed only by the capability's existing authoritative proof.
- Schedule and Reporting handoffs either consume exact focus or state their
  bounded fallback without pretending that navigation completed the task.

## Phase 5 — Playwright screenshot and interaction qualification

### Minimum screenshot matrix

| Surface | Required states | Viewports |
|---|---|---|
| Operations | populated, partial/stale, unavailable, empty, sales-role restricted | 390 x 844, 768 x 900, 1440 x 1000 |
| Exact Opportunity | draft, sent/viewed, accepted/booked, maximum-copy, Current task plus feedback | 390 x 844, 768 x 900, 1440 x 1000 |
| Cross-surface handoffs | start, destination, recovery/return, dirty guard where applicable | representative mobile, tablet, and desktop routes |

### Automated assertions paired with screenshots

- zero unintended horizontal overflow;
- no clipped labels, glyphs, focus paint, identity, or primary actions;
- enabled targets at least 44 x 44 px;
- one `main`, one appropriate page heading, ordered region headings, and stable
  accessible names;
- zero serious or critical Axe violations on every accepted surface;
- keyboard-only entry, activation, dismissal, and focus restoration;
- 200% zoom, forced colours, reduced motion, and reduced transparency;
- late reads, refresh races, route changes, and scope changes cannot overwrite
  a newer or foreign state;
- screenshot comparison uses the same fixture, viewport, browser, font state,
  route, and scroll position before judging visible differences; and
- source/local, connected, hosted, production, assistive-technology, and human
  evidence remain separate.

### Human 9.5 review

After automated closure, an authenticated operator should complete the two
surface flows on a real desktop and phone and answer:

- Did I immediately know what needed me?
- Did the next action match what happened?
- Did I ever lose which client, event, opportunity, or revision I was working on?
- Did anything important feel hidden, crowded, repetitive, or overly technical?
- Would I trust this state enough to act during a busy event day?

Human acceptance can approve or reject the 9.5 claim; it cannot be inferred
from screenshots or automated checks.

## Implementation sequence and change isolation

Deliver this as four reviewable slices rather than one broad restyle:

1. **Shared frame and continuity** — collision and layout contracts only.
2. **Operations hierarchy** — operating brief, state hierarchy, and responsive
   tool disclosure.
3. **Opportunity finishing** — first-viewport compression, Quick Updates
   discoverability, and selected-object orientation.
4. **Qualification and canonical sync** — screenshot matrix, accessibility,
   workflow handoffs, Feature Matrix, User Manual, Design System, acceptance
   matrix, Project Status when evidence changes, and Changelog.

Each slice requires its own before/after captures, focused unit/component tests,
Playwright proof, build, documentation governance, and explicit residual-risk
record. Do not combine a partial implementation from one slice with a 9.5 claim
for either complete surface.

## Definition of done

- Operations and exact Opportunity each meet the 9.5 scoring contract.
- The Opportunities index remains a coherent entry and return surface.
- Calm Four navigation and every role/feature gate remain unchanged unless a
  separately approved authority decision says otherwise.
- The exact commercial object survives every declared lattice crossing.
- No current screenshot contains clipped global controls, unsafe overlap,
  accidental below-fold loss of an essential action, or unbounded diagnostic
  copy dominating the task.
- Current local screenshot, DOM, keyboard, Axe, zoom, state, and route evidence
  is complete.
- Authenticated hosted and human acceptance are explicitly completed or remain
  visibly open; neither is inferred from local proof.
