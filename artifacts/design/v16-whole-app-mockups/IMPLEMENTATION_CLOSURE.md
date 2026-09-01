# QuotePilot v0.16 Design Closure Contract

Status: the visual direction is approved and locked. This package closed the
remaining interaction and information-architecture questions before Phase 1
implementation. The authority reconciliations recorded below supersede only
illustrative mockup claims that the repository's real domain cannot support;
they do not reopen the visual direction. This contract is not deployment proof.

## 1. Three product layers

| Layer | Canonical surfaces | Rule |
| --- | --- | --- |
| Global destinations | Now, Opportunities, Clients, Library | These are the only permanent primary destinations. |
| Contextual workspace tools | Quick Updates, proposal/activity, event-specific actions | These stay inside the opportunity context and never become rail or tab destinations. |
| Secondary administration | Search, Operations, workspace, account | Desktop keeps these quiet at the bottom of the rail. Mobile places them in Workspace & tools. |

`New quote` remains the primary global shortcut. It enters the same creation
flow described elsewhere as `Start an opportunity`; it is not a second workflow.

## 2. Opportunity, event, quote, and proposal

The implementation must preserve the current data and route authority while
using this product vocabulary consistently:

| Object | Meaning in v0.16 | User-facing behavior |
| --- | --- | --- |
| Client | The durable tenant-scoped person or organization record. | Shows recorded identity and contact details plus exact linked current or past work; it does not infer preference memory. |
| Opportunity | The commercial work container, from inquiry through close. | Appears in the Opportunities index and owns the contextual workspace. |
| Event | The operational occasion described inside an opportunity: date, venue, guest count, menu, staffing, and schedule. | It is part of the opportunity workspace, not a fifth global destination. v0.16 assumes one operational event per opportunity. |
| Quote | The price-bearing draft or saved version associated with the opportunity. | `New quote` opens the opportunity-creation composer. Merely opening it creates no saved record; persistence remains explicit. |
| Proposal | The customer-facing projection of an exact saved quote state. | It does not become an independent source of pricing or approval authority. |
| Library | Tenant-scoped reusable choices: packages, menus, services/add-ons, rentals, templates, and pricing. | It is both a global destination and a resource opened with opportunity context when needed. |

### Route-compatible mapping

No route migration is required for the visual implementation:

- `/app` presents **Now**.
- `/app/quotes` presents **Opportunities**.
- `/app/quotes/:quoteId` presents an **Opportunity workspace**. The internal
  `quoteId` remains unchanged.
- `/app/quotes/:quoteId/edit` remains the authoritative priced editor.
- `/app/quotes/new` is reached by both **New quote** and **Start an opportunity**.
- `/app/customers` presents **Clients**; `/app/customers/:customerId` remains
  Client 360.
- `/app/catalog` presents the standalone **Library**.
- Existing `/app/events` routes remain available as secondary operational
  capability, but Events does not return to global navigation.

The UI must not imply multi-event opportunities, independent proposal pricing,
or a new quote-revision model unless the existing authoritative data supports it.

## 3. Opportunities index

The Opportunities landing frame is a relationship-and-work index, not a KPI
dashboard. Its hierarchy is:

1. breadcrumb/context;
2. editorial identity and short explanation;
3. one dominant `New quote` action;
4. active work first, with client, event context, authoritative status, and one
   task-specific next action;
5. recent/closed work after active work;
6. search and filtering only when the collection is large enough to justify it;
7. quiet `About this view` disclosure.

Opening a row uses the existing exact opportunity route and does not mutate it.

The mobile Opportunities index is not a separately ranked presentation. It
uses the same authoritative attention ordering, grouping, row model, and
task-specific actions as desktop, then stacks the event, client, context,
status, and next action through the established mobile list system. The derived
closure frame is `12-mobile-opportunities-index.png`.

## 4. Mobile utility access

Mobile retains the Calm Four bottom navigation: **Now, Opportunities, Clients,
Library**. It does not add Search, Operations, or account destinations to that
bar.

Every standard mobile application header includes the compact workspace/avatar
control. It has the accessible name `Workspace and tools`, exposes its expanded
state, and opens a viewport-appropriate modal utility sheet. It is the only
mobile entry point for these secondary utilities and never becomes a permanent
navigation destination. The sheet contains, in this order:

1. current workspace identity (`MM05366 Sandbox`);
2. Search;
3. Operations, only when the signed-in role is authorized;
4. the signed-in account (`flightcontrol@quietpilot.us`);
5. Account settings;
6. Sign out.

The current authority model binds one organization to each signed-in principal,
so v0.16 does not show a fictional same-account workspace switcher. A person
uses the existing sign-out/sign-in path to change authorized principals.
Multi-organization membership and active-organization selection remain a
separate future authority design, not a presentation shortcut.

`Operations` names the existing role-safe directory of secondary operational
capabilities, not one exhaustive button or the limited inventory pictured in
`07a-mobile-utilities-sheet.png`. Its entries may include legitimate existing
capabilities such as Events, Messages, Workflow, Pilot, Event Schedule, or
Clear the Deck when their established role and feature gates permit them. They
remain inside the modal secondary layer and never become additional persistent
primary navigation. The simplified screenshot inventory is illustrative, not
an instruction to remove supported operational capability.

`New quote` remains a separate primary action. The utility sheet is a modal
surface with a labelled title, at least 44px targets, focus containment, Escape
and mobile-back dismissal, and exact focus restoration to its trigger. The Calm
Four bar may remain perceptible beneath it but is inert while the sheet is open.
Opening the sheet changes no route or saved data.

## 5. Quick Updates state contract

Quick Updates is one contextual surface shared by menu, staffing, and pricing.
Desktop uses a narrow full-height right drawer over the opportunity. Mobile uses
a full-viewport sheet. The selected opportunity, underlying scroll position,
and route remain intact.

### State sequence

| State | Required behavior |
| --- | --- |
| Clean | Opening, expanding, typing focus, or inspecting controls invokes no persistence. Close, Escape, or backdrop returns to the exact trigger. |
| Dirty edit | The changed field is visibly staged, the panel states `1 unsaved change`, and the footer says `Draft only. Nothing changes until you save.` The primary action names the consequence, for example `Review menu change`. |
| Review | Show exact Before and After values plus the known downstream effect. `Back to edit` retains the draft. `Save menu change` is the only persistence action. |
| Saving | Disable close, Escape, backdrop dismissal, duplicate submission, and route changes until the result resolves. Label the action `Saving…`. |
| Saved | Show an authoritative saved receipt and update the underlying opportunity only after confirmed success. Returning focus must preserve the user's opportunity context. |
| Failed | Keep the drawer open and retain the exact draft. Explain what did not save and provide a named retry or recovery action. |
| Conflict or uncertain result | Never claim success. Retain the draft and exact source/revision context, then provide a reconcile or reload path. |

The approved draft example is a Menu change from `Plated dinner` to `Buffet`.
The review screen says:

- Before: `Plated dinner · three courses`
- After: `Buffet · three courses`
- Effect: saved pricing, deposit, and recorded staffing stay unchanged unless
  the existing Commercial Change authority returns a different exact effect.
- Safety: `No changes have been saved.`
- Actions: `Back to edit` and `Save menu change`

This authority correction supersedes the illustrative effect sentence in
`03b-desktop-quick-updates-review-save.png`; the approved presentation,
interaction sequence, and visual composition remain unchanged. Service style
does not create a new staffing or pricing rule.

`Open full Library` carries the exact opportunity and requested section as
context. It does not assume that a query-string deep link already exists, and
it must preserve current role authority.

Phase 1 local evidence can prove draft protection, the review-state component
contract, local-fallback refusal and handoff, dismissal recovery, and browser
interaction semantics. It cannot prove authoritative hosted persistence or
readback. A **Saved** receipt remains valid only after the existing Firebase
authority returns the exact write receipt and authoritative rereads described
by the product domain; exercising that path against a hosted candidate is a
Phase 2 hosted/manual requirement.

## 6. Unsaved-change dismissal

The dismissal rule applies equally to desktop and mobile:

- When clean, Close, Cancel, Escape, backdrop, mobile Back, and an authorized
  navigation request may dismiss the panel.
- When dirty or on Review, any Close, Cancel, Escape, backdrop, browser/mobile
  Back, workspace switch, route change, or `Open full Library` request opens the
  dismissal guard. Nothing is discarded automatically.
- The guard says `Discard unsaved Quick Updates?` and explains the exact draft:
  `Your menu draft changes Plated dinner to Buffet. Nothing has been saved.`
- Initial focus and the visually dominant action are `Keep editing`.
- `Keep editing` returns to the same field or review control with the draft
  intact.
- `Discard draft` clears only the Quick Updates draft, then completes the
  originally requested close or navigation and restores/carries context.
- Escape from the guard means `Keep editing`; clicking outside the guard never
  discards.
- While saving, the guard is unavailable because dismissal is disabled.

## 7. Clients closure

The mobile empty state uses the same intentional sparsity and narrative order as
desktop: eyebrow, editorial headline, short explanation, hospitality image,
`Start an opportunity`, the three-step relationship explanation, and a quiet
`About this view` disclosure. Step 2 is `Add the event details`.

Populated Clients uses `WHAT NEEDS ATTENTION` in place of `TRUTHFUL STATE`.
The authoritative v0.16 model supports tenant-scoped client identity, recorded
contact details, exact current/recent linked event context, bounded current
status/attention, Client 360 handoff, and exact rebooking records. It does not
provide trustworthy freeform preference memory such as the prose pictured in
`05-desktop-clients-populated.png` and
`10-mobile-clients-populated-fixed.png`. Those screenshots' **RELATIONSHIP
MEMORY** prose and unsupported attention examples are superseded by the shipped
**Recorded contact details** and **Current status** presentation. The approved
hierarchy and visual composition remain locked; no preference is generated,
inferred, or presented as fact. A future relationship-memory capability would
require source labels and an authoritative correction path in Client 360.
Search and filtering appear only when records exist.

## 8. Task-specific action language

Mobile does not collapse actions into generic `Review`, `Open`, `Continue`, or
`Save` labels when the outcome is known.

| Context | Label |
| --- | --- |
| Final guest count is due | `Review final count` |
| Staffing needs review | `Review staffing` |
| Client relationship needs attention | `Review client` |
| Exact ready rebooking record | `Start a rebook` |
| Open a named active opportunity | `Open Rivera Wedding` |
| Staged Menu change | `Review menu change` |
| Confirm that change | `Save menu change` |

The global button remains `New quote`; the Clients narrative action remains
`Start an opportunity` because both enter the same flow from different contexts.

## 9. Preservation boundary for implementation

The eventual implementation may change presentation and information
architecture only. It must preserve:

- tenant-scoped reads and existing organization authority;
- authentication, role gates, and Library edit restrictions;
- all current routes and deep-link identity;
- Client 360 handoffs;
- authoritative quote calculation, proposal, activity, and save behavior;
- unsaved-work recovery already owned by the application;
- responsive, keyboard, focus, and accessibility behavior;
- both build-selected application graphs.

This closure contract does not itself prove source implementation or deployment.
