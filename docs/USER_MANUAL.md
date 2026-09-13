# User Manual

Last updated: 2026-09-13 01:56:31 CDT

## Purpose
This guide explains day-to-day usage of QuotePilot for staff users and admins.

## Offers, templates, pricing, and rules

Open **Library** to understand how the business sells. The primary ledger groups
**Offers**, **Components**, **Templates**, and **Pricing & Rules**. On desktop,
that inventory owns the broad canvas and setup readiness stays in a quieter
side rail. On smaller screens, the same commercial order appears before
readiness. Unresolved setup expands; completed setup stays collapsed.

Existing Packages are displayed as Offers without changing their record type,
stable ID, inclusions, pricing, or save path. Open an Offer to manage its name,
per-person price, quoting availability, included Menu, Service/Add-on, and
Rental components, and derived margin. Detailed cost/contribution, readiness
evidence, record identity, catalog revision, and quote behavior remain under
secondary disclosures. Recorded configurable choice groups are visible
read-only when present; they are not authored or selected end to end in the
current browser workspace.

**Your bundle** is the current quote's derived combination of its Offer, Menu,
Services/Add-ons, Rentals or enhancements, quantities, and calculated pricing.
It is not a separate Library record and has no independent save or pricing
path. Event Templates remain reusable quote starting points and fill only
fields not already declared as explicit operator work.

**Rules** opens a structured-first ledger of each Configuration Rule's
**WHEN**, **THEN**, **WHY**, and enabled state. Administrators can disclose
**Advanced rule source** when JSON is invalid, a record cannot be represented
safely by the structured editor, or JSON-level work is necessary. Rules are bounded configuration, not
executable code: unknown operators, missing references, and conflicting
mandatory outcomes block publication, and a recommendation never silently
edits a quote. Template or rule edits remain drafts until the existing catalog
publication path succeeds.

New authoritative quote calculations store `pricing-v2`: exact cent values,
the applied service-fee/tax/season policies, and a line-by-line price
waterfall. The browser total remains a preview. Saving or changing a quote uses
server pricing and the current confirmed catalog. Existing saved `pricing-v1`
revisions remain historical and are not recalculated.

## Start here: the everyday operating guide

QuotePilot separates active business records from drafts and recommendations.
Use this short path for routine work; the later sections are the detailed
reference for each feature.

### Know where to go

| Destination | Use it for | Main action |
| --- | --- | --- |
| **Now** | Today's priorities and upcoming work | Open the item that needs attention |
| **Opportunities** | Active and recent events | Review the next required action or open the event |
| **Operations** | Accepted/booked Calendar, daily planning, and staff execution | Open the Calendar or a daily execution tool |
| **Clients** | Contact details and event history | Start or continue an opportunity |
| **Library** | Offers, components, templates, pricing, rules, and setup readiness | Open the commercial object; use the readiness action only when setup needs attention |
| **New quote** | A new event or pasted inquiry | Complete the draft blockers, then save |
| **Search** | A known client, quote, or event | Open the exact matching record |

On a phone, the five primary destinations stay in the bottom navigation. Use
the workspace/avatar control for Search, Frequent tools, Operations,
progressively disclosed Administration, account settings, and sign-out.

### Five-minute first setup

1. Sign in and open **Library**.
2. Scan **Offers**, **Components**, **Templates**, and **Pricing & Rules** to
   understand the current commercial inventory.
3. If setup needs attention, use the one action in **Before the next quote**.
   Other unresolved areas remain readable and completed setup is collapsed.
4. Treat each readiness measure independently. Missing optional starting
   points, additional users, provider connections, or cost evidence does not by
   itself block ordinary quote creation. Missing cost evidence does make margin
   unavailable for the affected scope.
5. When Library editing is complete, wait for **Draft ready to check**, select
   **Check draft before publishing**, then choose **Publish catalog** after the
   check succeeds. Until publication succeeds, the currently published catalog
   remains the pricing authority.

Sales staff can read setup status and the next action. An administrator must
make and publish catalog changes.

### Daily quote workflow

1. Select **New quote**, or open an existing event from **Opportunities**.
2. Enter the client and event facts. The draft identifies every known blocker;
   resolve those before saving.
3. Choose the package, service style, menu, staffing, rentals, and pricing.
4. Review the live total, deposit, proposal readiness, and any catalog-revision
   or commercial-consequence review.
5. Select **Save draft**. Saving does not send the proposal or prove delivery.
6. Preview the customer view. An administrator may send only through an
   available provider-backed action; a provider-accepted receipt, not the button
   click, is delivery evidence.
7. Return to **Opportunities** to track the next recorded action.

### Commercial Workbench (v0.18 source contract)

When Proposal Composer is enabled, use **Quote plan** to move among Event,
Customer, Experience, Staffing, and Commercials. These are views of one draft,
not separate records. Experience contains the existing package, service style,
Menu, rentals, and enhancements editors. **Commercial truth** keeps the current
total, deposit, blockers, consequences, available margin evidence, scenarios,
client Preview, and save state together. Switching a domain does not save or
change pricing; use the explicit save action when the draft is ready. Guided
mode edits the same draft and uses the same save authority. Quote plan remains a
sticky left rail at desktop and compact-desktop widths, including 1008px. At
tablet and phone widths it becomes a horizontal navigator above the same
proposal document so domain context is adapted, never omitted.

### Calendar-first Operations (current source contract)

Open primary **Operations** or `/app/operations` to use the existing
accepted/booked Event Schedule as the canonical operational lens.

- In **Month**, use the broad calendar to choose a day or event. The selected
  day, focused event, current conflict consequence, and operational sections
  appear beneath the calendar; there is no permanent detail rail reducing the
  month canvas.
- In **Week**, read time vertically across seven dated columns. An event's
  vertical position is its start time, its height is its duration, and
  overlapping events occupy visible collision lanes. Select an event to review
  it in the secondary detail rail.
- Switching Month and Week retains the selected date and event where that
  context remains in range. On a phone, both controls use an agenda derived
  from the same event and conflict projection rather than a separate Calendar.
- **Run of show**, **Production**, **Kitchen timing**, and **Staffing** begin
  collapsed. Open only the domain needed for the current decision.
- A conflict is derived, not manually resolved. Use the conflict comparison to
  identify the affected Opportunities, then correct authoritative date, time,
  duration, venue, guest count, or lifecycle state on the exact Opportunity.
  Calendar recomputes the conflict from those records.

**Open in Calendar** keeps the exact Opportunity identity; **Open
opportunity** returns to that exact record. `/app/schedule` remains a
compatibility path to the same Calendar.

Desktop **Operations** and the mobile Operations group contain
**Operations**, **Clear the Deck**, and **Staff**, plus administrator-only
**Inventory** when its independent gates permit it. Use Frequent tools for
**Workflow**, **Messages**, and **Pilot**. Expand **Administration** for
role-authorized **Reporting Dashboard**, **Integrations Ops**, **Import
Studio**, and **Session Diagnostics**. Event and Event Schedule routes remain
available from their exact context or direct route rather than appearing again
as menu inventory. These changes are implemented in current source, while the
public Vercel edge remains older. Source and backend deployment do not establish
hosted route availability or human acceptance. Planning and checklist details
are not live attendance, issue, payment, Inventory, or readiness telemetry.

### Read state labels literally

- **Unsaved** means the change exists only in the current browser state.
- **Saving draft** means QuotePilot is synchronizing staged intent.
- **Draft saved** means the unpublished setup draft reached the server.
- **Device-only** means synchronization failed; keep the page open and retry.
- **Ready to review** means the draft can enter publication review.
- **Published catalog active** identifies the only catalog used as current
  pricing authority.
- **New draft** or **Saved draft** does not mean a quote was sent, viewed,
  accepted, booked, or paid.
- **Connection required** is an integration-readiness state, not proof that an
  outbound message or payment failed.

### Fastest safe Menu Builder workflow

1. Open **Library → Offerings → Open Menu Builder**.
2. In **Choose the context**, select an **Event type**, then a **Menu section**.
   Use **Add or rename** only when the menu structure itself needs maintenance.
3. In **Edit the items**, search by name or turn on **Show unavailable**. Choose
   an item from the compact list to open its one focused editor.
4. Edit **Name**, **Price basis**, **Selling price**, **Cost**, and
   **Availability** in that editor. Changes appear immediately in the browser
   and synchronize to the setup draft after a short pause; leaving a field does
   not publish it.
5. For repeated changes, select items in the list. The bulk-action bar appears
   only after selection; use it to **Make available**, **Make unavailable**, or
   **Move selected** once. Stable item identities are preserved and unsafe
   dependency changes are rejected.
6. Watch the sticky draft bar. Resolve **Library changes are waiting to save**
   or **A newer Library version needs attention** before leaving the session.
7. Select **Check draft before publishing**, inspect the combined changes, then
   choose **Publish catalog** once. Existing quotes are never silently repriced.

On a phone, the context comes first, followed by a bounded item chooser and one
editor. Scroll inside the chooser to switch items without expanding every item
form down the page.

## Access and Roles
- **Secure email verification:** open only the newest verification message for
  the exact account. The staging candidate opens `/app/auth/action`, removes
  the one-time code from the visible address, and waits for you to choose
  **Verify email**; merely opening or previewing the link does not verify the
  account. A receipt means Firebase accepted the action. An uncertain result
  means QuotePilot could not prove whether the provider applied it; return to
  sign in for account truth or request a new message. An expired, used, malformed, wrong-project,
  or wrong-return link is rejected and directs you back to `/app` to request a
  new message. Do not copy or share the verification URL.
- Staff access (`sales` or `admin`) is required for the quote builder workspace.
- Admin access is required for Catalog Admin configuration and the default-off
  Ambient Library that presents the same guarded catalog authority.
- Email/password users who cannot sign in can enter their email and select
  `Forgot password?`. QuotePilot always shows the same confirmation whether or
  not Firebase returns an account-state error. Follow the Firebase
  password-reset message for that exact email, then use its Continue action to
  return to QuotePilot. The confirmation is on-screen privacy behavior, not
  proof that an account exists or that a message was delivered;
  Google-authenticated users continue through Google instead.
- Sales users can prepare quotes through the trusted edit workflow, download a
  draft PDF, and copy an email template. The current Quote History UI reserves
  provider-backed email and lifecycle controls for admins. Sales cannot create
  delivery or portal-view evidence, alter payment or customer-decision evidence,
  rotate portals, reopen, or delete. Their schedule updates are limited to staff
  assignment, kitchen checkpoints, and production checklist fields that do not
  prove booking, payment, or acceptance.
- Neither staff role can mark a quote `sent` or `viewed` through a generic
  status update. The server delivery callable owns provider-acceptance evidence,
  and the customer portal owns view evidence.
- A saved draft has a reserved Customer Portal identity, but the link is not
  customer-visible or copyable. Only provider acceptance for the exact current,
  valid portal issuance activates that portal.

## Catalog draft and publication

Administrators edit the organization Library without changing active quote
pricing on each keystroke or field blur. Local edits appear immediately and
coalesce into a background setup-draft synchronization after a short pause.
The sticky draft bar names the operator outcome: **Saving the Library draft**,
**Draft ready to check**, **Library changes are waiting to save**, **A newer
Library version needs attention**, **Library needs to reconnect**, **Library
published**, or **Published Library is active**. If changes are waiting, keep
the workspace open or use **Try saving again**. Those edits are preserved in
the current workspace but are not in the shared draft and are not published;
the current published pricing remains active. Technical details remain
available under disclosure when recovery needs them.

Choose **Check draft before publishing** to validate the complete change set.
The check is read-only and does not confirm pricing. After it succeeds, choose
**Publish catalog**. Only publication advances the live catalog by one revision
and records the administrator-attributed pricing confirmation and receipt. A
newer-version state means the active catalog or draft changed elsewhere; load
and reconcile the latest shared version instead of assuming either copy won.
Sales staff may inspect Library inventory and readiness but cannot edit, check,
or publish the private setup draft.

## Primary workspace

The converged current source contract keeps five persistent primary destinations. The
earlier v0.16 release contract used Calm Four; the later convergence contract
adds Calendar-first Operations without changing its underlying authority:

- **Now** shows the established hospitality-led home, up to three current
  priorities, recorded upcoming work, and quiet internal progress.
- **Opportunities** opens the attention/current-work index. Select one event to
  enter its exact opportunity workspace; use browser Back to return to the
  index. Ordering follows current recorded state and dates, not a fixed display
  list.
- **Operations** opens the accepted/booked Calendar as the daily execution
  index. Month's full-width calendar and lower contextual workspace, Week's
  time-and-collision grid and secondary detail rail, the phone agenda,
  conflict/capacity evidence, staff-lead work, checklist, and run of show remain
  one reused schedule capability.
- **Clients** opens the same-tenant relationship view. A tenant with no clients
  sees one **Start an opportunity** path into the established quote flow and no
  zero-value metrics or unnecessary search. A populated tenant sees current or
  recent recorded event context, recorded contact details, current status, and
  one next action before search and filtering. v0.16 does not display derived
  relationship memory as fact; if such memory is added later, it must expose
  its source and an authoritative correction path in Client 360.
- **Library** opens the organization catalog for administrators. Standalone
  Library has no event-specific context. Opening it from an opportunity names
  that event and provides **Return to opportunity** or **Return to [event]**.
  Browsing either mode does not change an opportunity.

**New quote** is a global action into the existing opportunity/quote flow, not
a navigation destination. On desktop, Search remains secondary and
workspace/account controls stay quiet; primary **Operations** opens Calendar
directly. On mobile, select the workspace/avatar control in the standard
header to open **Workspace & tools**. That focus-contained sheet provides
Search; Frequent **Workflow**, **Messages**, and **Pilot** tools; the same three
Operations-group paths (**Operations**, **Clear the Deck**, role-gated
**Staff**, and independently gated administrator **Inventory**); progressively
disclosed **Administration**; workspace
identity; account settings; sound preference; and sign-out without adding
fifth or sixth bottom-navigation items. Staff-only and administrator-only
entries retain their existing role and feature gates.

The v0.16 identity model authorizes one organization per signed-in principal,
so **Workspace & tools** shows the current workspace but does not pretend that
the same account can switch organizations. Use sign-out and sign in with a
different authorized account when necessary. **Account settings** shows the
current identity and workspace; sending a password-reset email is a separate,
explicit action and merely opening settings changes nothing.

Now, Opportunities, Operations, Clients, and Library are the five primary
entries. Menu, pricing, proposal, activity, Event, and Event Schedule actions
remain contextual or directly routed; Workflow, Messages, and Pilot remain
Frequent tools; and reporting, integrations, imports, and diagnostics remain
progressively disclosed Administration tools. Browser Back and Forward
preserve the route and history entry. If Quick Updates has an unsaved draft,
navigation first asks whether to keep or discard it; discarding then continues
to the exact requested history entry.

### Returning without losing your place

- In **Opportunities**, your status/event filter, open Details sections,
  initiating action, and scroll position return with you after opening an exact
  opportunity. Browser Forward reopens that same opportunity rather than a
  similarly named or neighboring record.
- In **Clients**, the selected view can appear in the URL and survive reload.
  Search text, the active result cursor, open About/details sections, focus,
  and scroll are private to the current browser tab. They return during an
  immediate Back/Forward round trip but clear on reload; the page explains
  this boundary quietly beside search.
- In **Library**, opening a Catalog choice or Event Template creates a distinct
  browser-history step even though the address stays `/app/catalog`. Back
  returns to the exact Library overview and Forward reopens that exact editor
  from current saved data. Contextual Library also returns to the exact
  opportunity and restores the action that opened it.
- QuotePilot restores a return only when the adjacent history entry belongs to
  the same signed-in person, role, organization, and browser runtime. Copied,
  reloaded, expired, malformed, or foreign context returns to the canonical
  route, announces the fallback once, and never guesses another record.
- The return-context layer itself changes no quote, client, catalog, pricing,
  history, workflow, or provider record. An administrator opening quote history
  can still trigger the existing automatic expiry lifecycle update for an
  already-expired quote, and local fallback may normalize and version that
  expiry; return navigation does not add or widen that authority. Reload retains
  only approved URL filters and clears free text, cursor/disclosure position,
  exact runtime-only editor targets, scroll/focus memory, and unsaved drafts.

If a Library editor has unsaved work, browser Back and **Back to Library** use
the same confirmation. **Keep editing** leaves the exact editor, history entry,
and draft intact. **Discard draft** removes only those unsaved values and then
continues Back; Forward may reopen the same editor, but it reads the current
saved value and never revives the discarded draft. While a save is busy, both
paths remain blocked rather than abandoning an uncertain operation.

### Quick Updates in an opportunity

1. Open an exact opportunity and select **Quick Updates**. The desktop drawer
   or mobile sheet opens over that opportunity; opening and expanding Menu,
   Staffing, or Pricing changes no saved record.
2. Use Menu to choose a supported **Service style**. This creates a local draft
   labeled as unsaved. Closing and reopening an accordion within the same sheet
   retains it.
3. Select **Review menu change**. For a Firebase-backed draft, QuotePilot asks
   the existing server authority to project the requested **Before**/**After**
   value and the material total, deposit, staffing, draft-status/version,
   proposal, portal, lifecycle, and dependency effects. **Back to edit** keeps
   the local draft; review itself saves nothing.
4. Select **Save menu change** once. QuotePilot disables editing, dismissal,
   and duplicate submission while the trusted save resolves. The save is
   bound to the reviewed simulation, active revision, catalog digest, and
   policy and delegates calculation and persistence to the existing quote
   authority. A changed source requires a fresh review.
5. A success receipt appears only after the exact Firebase write receipt, a
   server-only read of the same tenant/opportunity/version, and refresh of the
   underlying opportunity list. A rejection, concurrent-edit conflict,
   uncertain result, or failed reread retains a recoverable draft and offers
   the appropriate retry, reconciliation, or full-editor handoff.

Quick Updates does not save browser-local fallback records and does not
silently return a sent or viewed proposal to Draft. Those states can still be
browsed in the panel, but review returns an explicit **Continue in quote
editor** handoff. Following that handoff requires discarding only the panel
draft; it does not change the saved opportunity.

X, Cancel, Escape, backdrop, primary navigation, contextual Library/staffing/
pricing handoffs, browser Back/Forward, and the applicable mobile back action
all use the same unsaved-draft guard. **Keep editing** returns to the intact
draft. **Discard draft** removes only the local draft, keeps the original saved
values, and then continues the requested action. No path implicitly saves.

**Review staffing** and **Review pricing** open their existing authoritative
workflows. **Open full Library** carries the exact opportunity context into the
same organization catalog. The currently supported service-style field has no
separate presentation-owned staffing or pricing rule. The panel reports the
server authority's projected effects and never reproduces staffing, pricing,
tax, margin, proposal, portal, or dependency calculations in presentation
code.

## Staff Workflow (Quote Builder)
1. Open the app and sign in. In a customer-centered workspace build, select
   `New quote`; `/app/quotes/new` resumes the current in-memory draft.
2. Build quote data through the 5 wizard steps:
   - `Event Basics`
   - `Menu Selection`
   - `Add-ons / Rentals`
   - `Pricing Summary`
   - `Save Quote`
3. Review the sticky Live Breakdown panel while editing. After entering the
   wizard on a phone or tablet, all five steps keep Total and Deposit in view.
   Use `View breakdown` for the focus-contained itemized sheet and `Close` or
   Escape to return focus to the workflow.
   - If **Catalog updates are unavailable** appears, event and client details
     can still be outlined, but package, menu, and pricing choices may be
     incomplete. Select **Try catalog again** before trusting those choices.
     The failed read does not save or reprice the draft. If the catalog cannot
     load at all, quote creation remains blocked until a retry succeeds.
4. Select `Save draft` from the final step. Saving creates or updates the quote
   but does not send it to the customer or mark it sent.
5. In a customer-centered workspace build, the Event Workspace opens on the
   exact saved quote; other builds retain the focused Quote History handoff. A
   Firebase-backed admin can
   submit that saved revision only after QuotePilot confirms that a supported
   email-provider configuration is present. Provider email contains the
   server-built customer portal link; browser-generated PDF attachments are not
   accepted. Sales staff can
   download a draft PDF or copy the email template, and the draft PDF
   deliberately omits the inactive portal link. A PDF generated after portal
   rotation also omits the link until the new issuance has provider-acceptance
   evidence. PDF export remains available to both roles as a separate operator
   artifact.
6. Provider acceptance records quote `sent` status. It activates the portal in
   the same server transaction only when the evidence matches the exact current,
   valid issuance. Acceptance proves provider handling, not recipient inbox
   delivery. If the provider accepts a message whose portal issuance is already
   invalid or expired, QuotePilot keeps the acceptance evidence, marks the
   portal `requires_rotation`, and leaves it inactive. An admin must complete
   guarded rotation and send the new issuance separately before sharing it.
   Re-sending unchanged content and issuance within the provider idempotency
   window returns the existing acceptance record. A definite failed attempt
   whose safe retry window has closed starts a fresh delivery generation; an
   ambiguous outcome stays locked for provider review. Edit and save a new
   revision before sending updated content.
7. Firebase-backed create, duplicate, edit, rebook, and Change Impact pricing
   uses the signed-in staff identity and server calculation time. If QuotePilot
   reports that catalog authority changed while the operation was being prepared,
   refresh the catalog/quote, recalculate, and retry. The rejected attempt does
   not establish a saved quote, reviewed rebook, or completed impact preview.

## Commercial Command Center (Home)
- When the temporary customer-centered workspace build flag is enabled,
  `/app` opens Home after staff authentication. Persistent navigation exposes
  `Home`, `Customers`, `Quotes`, `Workflow`, and, when enabled, `Schedule`;
  administrative tools remain under their existing role and feature gates. `/app/home`
  canonicalizes to `/app`.
- Select `New quote` to enter the five-step builder. Leaving the builder through
  ordinary staff navigation or browser Back/Forward keeps its in-memory draft
  mounted. Returning to `/app/quotes/new` resumes it. Starting an explicit new
  quote still asks before discarding unsaved work, and closing or refreshing
  the browser triggers the browser's unsaved-changes warning when the draft is
  dirty. Quote/customer contents are not stored in the URL or browser storage
  for this continuity behavior.
- `Needs your attention` lists new and acknowledged change requests, overdue
  and due-today follow-ups, and quotes with a pending approval, using the
  same prioritized attention snapshot as the `Workflow` header badge, so the
  counts agree. Selecting a row opens `Workflow` with its quote, attention
  type, and request identity focused. When the quote has a stable `customerId`,
  select the customer name to open Customer 360 without changing the row's
  Workflow action. Home itself performs no acknowledge/handled/approve actions.
- `Next 7 days` lists accepted or booked quotes with an event date in the
  coming week. `Money at a glance` lists deposits that are unpaid or
  requested and final balances that are eligible to request or already
  requested, split into "Requested, awaiting customer" and "Not yet
  requested" totals. A final balance never appears as actionable until its
  deposit is Stripe-paid, matching the existing final-balance request gate.

## Living Opportunity (exact quote context)

- With the current Ambient presentation enabled, open a quote from Now, Client
  360, or Opportunities to use `/app/quotes/:quoteId` as its Living Opportunity.
  Use `Back to Opportunities` for the work queue or `Quote administration` for
  the full role-gated provider/payment/booking/portal/contract controls.
- Review the exact customer/event identity, quoted scope, lifecycle, and bounded
  current condition. `No tracked quote attention` means only that the bounded
  quote/Workflow read has no due item; it does not mean the event is ready or
  complete.
- Read current state, exact blockers, evidence availability, consequence, and
  one next action independently. Proposal completeness, payment, Staffing,
  Inventory, BEO freshness, attendance, and event execution are separate rails;
  no blended score establishes event readiness.
- Customer phone is recommended contact enrichment, not a required proposal
  field. A missing phone does not lower required proposal completeness or add a
  readiness blocker; QuotePilot may still show it separately when it would help
  follow-up or event-day coordination.
- Draft, sent, or viewed quotes show `Edit quote` only when the signed-in role
  and current delivery state already permit ordinary editing. Accepted/booked
  records explain the governed-change boundary and do not present ordinary
  Edit.
- Schedule and Customer cards open their existing routes. Rentals focuses the
  selected sold scope. Production/BEO, PDF, and conversation actions retain
  their existing source, freshness, portal, role, and artifact gates. A local
  BEO is explicitly a browser download with no server receipt.
- The older CWF-16 `EventWorkspaceView` remains historical implementation
  provenance and compatibility coverage. Its proposal-readiness strip is not
  the ordinary Ambient-enabled exact-quote composition.
  Selecting a quote or payment row opens the authoritative quote record. When
  a row has a stable `customerId`, selecting the customer name opens Customer
  360 instead.
- Home uses the existing quote-history, workflow-attention, and bounded Revenue
  Autopilot operations contracts. The third read projects unread customer-reply
  Attention into the shared queue; it introduces no new read contract or data
  source, creates no records, and cannot request payment, approve a request, or
  change a quote's status by itself.
- `Staff read context` identifies the organization profile name and exact tenant key, the Workflow
  Attention, latest-200 quote-history, and latest-50 unread customer-reply
  Attention contracts, the read source, and the time when all three reads last
  completed together. `Incomplete read` means at least one contract did not
  complete; `Last complete read retained` means a later refresh
  failed while older complete data remains visible; `Bounded snapshot` means
  Home reached its 200-record quote-history cap. The timestamp describes the
  browser's read, not when every record changed. Home cards and totals are a
  derived staff presentation, and a fresh read never proves provider delivery,
  customer acceptance, booking, payment, or operational completion.

## Authoritative operational staffing

- This independently gated capability appears only
  when the presentation gate `VITE_OPERATIONAL_STAFFING_ENABLED` is enabled,
  and server reads or commands still fail closed unless both the global
  `OPERATIONAL_STAFFING_AUTHORITY_ENABLED` gate and the exact tenant's
  `operationalStaffingAuthorityEnabled` setting are enabled. Turning on one
  gate does not turn on either of the others or establish hosted,
  production-data, or human acceptance. A verified isolated-staging deployment
  exists, and protected run `33282940451` separately enabled the already
  deployed v0.15 authority for `mm05366-sandbox`; production v0.16 and hosted
  human acceptance remain separate.
- Production operators promote or roll back the tenant gate through the
  protected **Set Operational Staffing Tenant** workflow after an exact tagged
  Firebase all-scope deployment. The operator workflow runs from current
  `main` while independently verifying the deployed tagged SHA, successful
  deploy run, and both staffing bindings. It changes only the existing named
  tenant field, requires an update-only precondition, and verifies readback
  through the distinct tenant-operator workload identity. It does not deploy
  the current branch or create staffing, invitation, provider, or human
  evidence.
  The organization input has no default and accepts bounded numeric identifiers
  or the single approved founder-pilot identifier `mm05366-sandbox`; arbitrary
  slugs fail closed.
- For the RagnaKoK complete-operations profile, production activation is a
  governed sequence rather than one broad switch. Commercial Change and Event
  Spine are enabled together for the exact tenant so an operational change
  cannot bypass commercial approval. Staffing and Inventory use their separate
  tenant fields. These authorities share projections and handoffs; none may
  rewrite another authority's records.
- In the flagged Event Workspace, open the exact quote and select `Inspect
  staffing`. The panel reads only that tenant and quote, binds commercial role
  counts and the event window to the exact active immutable quote revision,
  and keeps quoted requirements separate from operational fulfillment. A
  cross-tenant identity, customer role, or unscoped request fails closed.
- Admins may select **Add person**, enter a display name, and keep or choose at
  least one role to create an active **Rostered** teammate. That minimum command
  uses the safe operational profile and its immutable receipt; it does not
  create guessed private HR data. Contact, availability, rates,
  qualifications, photos, and other private details can be added later. Sales
  staff may inspect safe profiles but cannot configure them.
- An uncertain roster save keeps the exact command locked for **Check previous
  roster save** and reuses that request identity for reconciliation. A
  definitive rejection also keeps the entered draft locked, but **Clear failed
  roster attempt** only clears the rejected local attempt—it sends no second
  request and preserves the draft. Edit or submit again only after that clear;
  the later deliberate submit receives a fresh request identity.
- The Staff workspace presents **Rostered**, **Contactable**, **Schedulable**,
  **Cost-aware**, **Credential-aware**, and **Enriched** as independent derived
  facts. Missing optional data is neutral until a workflow needs it: an email
  is needed to preview an invitation, availability is needed for
  availability-backed scheduling, a rate is needed for individual labor-cost
  calculation, and a named qualification may be required for a specific role.
  Optional absence does not make a valid roster identity incomplete.
- Availability stays behind progressive disclosure for a new profile and begins
  empty. `operator_recorded` means an authorized operator entered a window; it
  is not a staff member's acknowledgement. QuotePilot never pre-fills an event
  window and silently treats the person as available.
- When the same gates are enabled, administrators see **Staff** in workspace
  orientation and can open `/app/staff`. The private record stores the person's
  preferred/legal name, HTTPS photo, email/phone and contact status, emergency
  contact, role icons and proficiency, qualifications and document links,
  recurring and exact availability, workload limits, rates and payroll-review
  state, travel preferences, reporting/arrival defaults, uniform/parking/meal
  briefing defaults, attendance summaries, response history, reliability and
  private notes. Sensitive private fields stay in callable-owned `staffRecords`;
  the safe profile used by assignment planning still excludes them.
- Use the compact command header to search by person or role, filter by
  schedulability or assignment state, and start **Add person**. Each
  roster row shows one primary operational state plus the next useful fact;
  selecting it opens assignment-first detail with readiness and evidence kept
  separate from editable profile data.
- On phones, Staff opens roster-first. Select a person to open a separate detail
  state, then use **Back to staff** to return. On larger screens the roster and
  selected record remain visible together. Open **Edit full staff record** only
  when contact, role, availability, compensation, qualification, or briefing
  data needs to change.
- Select an exact operator-confirmed event assignment under **Staff briefing
  sheet** to print or download a role-aware PDF. **Open email app** addresses a
  prefilled message to the email on file and includes the current role, call
  time, venue, arrival, uniform and responsibility details. Browsers cannot
  attach the PDF automatically, so download it first when an attachment is
  needed. Opening the app does not prove send, provider acceptance, delivery,
  acknowledgement, attendance or payroll readiness.
- For a person with a verified private email and enabled communications, select
  an exact confirmed assignment and choose **Preview invitation**. Review the
  recipient, assignment, message, consequence, and do-nothing outcome. Nothing
  is sent until an administrator chooses **Send invitation**.
- After dispatch, the Staff workspace shows two separate rails. **Delivery**
  distinguishes provider accepted, delivered, bounced, complained, ambiguous,
  and failed states. **Acknowledgement** remains pending until the person uses
  the secure link to **Accept assignment** or **Decline assignment**. An open or
  click never counts as acknowledgement. The response applies only to that
  invitation and does not edit the staffing plan, attendance, hours, payroll,
  payment, booking, event completion, or readiness.
- Admin and sales staff may assign a person to an exact role slot and select
  `Apply operator-confirmed assignments`. The server rechecks the quote
  revision, profile revisions, complete availability coverage, and relevant
  cross-date schedule-fence revisions before atomically writing the plan,
  fences, and immutable receipt. Unfilled quoted roles remain explicit gaps.
  An ambiguous result locks the exact unchanged request for `Reconcile exact
  request`; do not start a different command until a matching receipt or a
  definitive rejection resolves it.
- `operator_confirmed` proves only that an authorized QuotePilot operator
  recorded the assignment. It does not prove staff acknowledgement,
  attendance, payroll, payment, booking, or event readiness. A coverage label
  compares exact operator-recorded availability and assignments with the quoted
  role counts; it does not establish any of those outcomes either.
- Local or unauthorized contexts show only the `local_draft` boundary. Local
  quoted staffing context may remain visible, but it cannot claim staff
  availability, an operator-confirmed assignment, schedule-conflict clearance,
  coverage, or a server receipt.
- An explicit local authentication-bypass review may display a photo-rich
  `local_fixture` directory. Those records are development-only, are never
  written to Firebase or a provider, and must not be treated as production
  staff, assignment, delivery, acknowledgement, attendance, or payroll proof.

## Workspace Search

- In the flagged staff workspace, select `Search` or press `Ctrl+K` on Windows/
  Linux or `Command+K` on macOS. The shortcut does not open over the customer
  portal, an editable field, or another modal. Pressing it again while the
  palette is open returns focus to its search field.
- Enter at least two characters. The first slice searches up to six normalized
  customer-prefix matches and up to six matches from the latest 50 same-tenant
  quote records. Source and partial/truncated states remain visible; `Retry
  search` repeats the same transient query after a bounded read failure.
- Select a customer result to open Customer 360 or a quote result to open its
  authoritative quote record. Navigation uses only opaque record IDs. Search
  text and customer/quote content are not put in the URL, `localStorage`, or
  `sessionStorage`.
- The palette projects only staff-safe result labels. It does not expose portal
  tokens, private claims, message bodies, signatures, raw analytics, private
  payment/provider identifiers, or admin-only records, and it does not bypass
  any confirmation, role, feature, approval, or provider-evidence gate.

## Customer Directory and Customer 360

- Open `Customers` or `/app/customers` to load the paginated same-tenant
  directory. Search uses normalized customer name or email prefixes; page
  controls keep the read bounded. Routes use an opaque customer ID, never an
  email address.
- The client-language convenience routes `/app/clients` and
  `/app/clients/<customerId>` replace themselves with the corresponding
  canonical `/app/customers` route. They do not create a second directory,
  duplicate customer state, or relax opaque-ID validation.
- In the Ambient Clients view, the populated page opens with the directory's
  identity and purpose, one **Relationship in context**, and one **Review
  client** action. Search and filters narrow only the current bounded page;
  they do not rank relationship quality, search older pages, or infer
  engagement. A phone keeps the same identity-first order and makes the action
  full-width without introducing a different client model.
- Select **Review client** to open
  `/app/customers/<customerId>`. A missing or other-tenant ID does not reveal a
  customer and offers a safe return to the directory.
- `Customer directory read context` and `Customer 360 read context` name the
  exact tenant, source, bounded contract, device-time last complete read, and
  loading/current/partial/retained-stale/error outcome. A fresh staff read does
  not prove delivery, viewing, acceptance, booking, payment, or operational
  completion. A refresh failure keeps only a prior result from the exact same
  tenant, search/page, or customer scope.
- Client 360 opens as a relationship ledger. It shows the client identity, one
  supported next step, the **Client → Opportunity → Proposal → Event**
  relationship spine, the active opportunity, and recent recorded history
  before deeper controls. A customer request is labeled **Needs review**, not
  urgent, unless an authoritative urgency state exists. The request's exact
  wording may appear; consequence copy is limited to what the current action
  contract can establish. If a customer request and conversation summary share
  the same quote and timestamp, the history shows the request once.
- Additional active opportunities, **Conversations**, source information, and
  **More client history and controls** begin collapsed. Expanding them changes
  no customer, quote, conversation, booking, payment, or provider evidence and
  preserves the existing record tabs and actions. On a phone, the next decision
  remains first, the relationship spine becomes two columns, and history becomes
  a vertical ledger.
- `Overview` starts with `Follow-ups worth revisiting`, a bounded, read-only view of
  one-week post-event closeout checks and same-week anniversary cues from
  recorded booked events. A cue is not a lead, booking, customer contact, or
  revenue result. When QuotePilot verifies the booked source, matching
  acceptance receipt, stable customer, and exact retained accepted version,
  review the exact source shown, then select `Create rebook draft`. The trusted
  operation creates or reconciles one deterministic draft, overlays current customer
  contact, reprices it from the current catalog, and opens it for review. Set
  and save a current-or-future event date later than the source event. The
  `Exact-version rebook` banner must say `Staff review recorded` before any
  delivery attempt. Creating or reviewing the draft sends no message and does
  not accept, book, or collect payment. If the outcome is uncertain, reconcile
  the same request; do not create another rebook.
- Home and Workflow also scan the latest 200 current quote records for booked
  events whose first anniversary falls in the tenant-local week. `Repeat-event
  review` is a read-only reminder, not accepted-version verification or a new
  lead. If the quote read reached its bound, the cue says the scan is incomplete.
  Select `Review rebook` or `Review exact-version rebook` to open that stable
  customer's Customer 360 record. QuotePilot performs the immutable-version
  check there; the central queue never creates a draft by itself.
- A successfully governed booking also creates one internal `Closeout review
  record` for seven calendar days after the event. If it says `Configuration
  blocked`, an admin must set `Pricing` -> `Proposal Details` -> `Business time zone`;
  the booking itself remains valid. Return to the record and select `Check
  configuration`; this creates a configuration receipt but reviews no closeout
  item. A `Closeout source review needed` booking also remains valid, but its
  legacy accepted source must be reviewed before authoritative closeout actions
  are available. When the closeout is due, review Internal
  closeout, Thank-you opportunity, Review request opportunity, and Operational
  follow-up individually. `Mark reviewed` and `Reopen review` require an exact
  server receipt. If the result is uncertain, use `Reconcile exact action`; if
  the server definitively rejects it, reset the rejected action before starting
  a revised request. These controls record internal staff review only. They do
  not send email, prove provider delivery or opening, record a customer reply,
  or establish a lead, booking, payment, or revenue result.
- When that exact closeout reaches its tenant-local due date, use **Attendance
  after service** to record the whole attended count, select who supplied the
  count, and enter a concise source note. If a retained count is wrong, use
  **Correct attendance record**; the correction advances the evidence revision
  and preserves the prior fact in its immutable receipt. Wait for the exact
  server receipt. If the outcome is uncertain, reconcile the unchanged request;
  after a definitive rejection, reset it before starting a revised command.
  Priced guests and actual guests remain separate. This action does not change
  the accepted quote, reprice, invoice, refund, settle, change staffing or BEO,
  mark the event complete, or send a customer message.
- `Quotes, bookings, and payments` on `Overview` reports quoted, exact-state accepted and
  booked amounts, source-bounded deposit and final-balance measures, and a
  recorded repeat-event signal. Deposit or final-balance value is labeled
  provider-confirmed only when Customer 360 reports an exclusively
  Firebase-backed read and the record has both its matching paid state and a
  valid provider confirmation timestamp. Browser-local, mixed, and
  unknown-source payment fields stay unavailable even if a local paid status or
  timestamp is present. Read each amount with its eligible/known record count
  and any missing trusted-evidence warning. `Lifetime commercial measures`
  means only that this bounded customer quote read reported complete;
  `Displayed-record commercial measures` means older linked records may be
  outside the calculation. These values are operational and read-only—not an
  accounting ledger, cash reconciliation, forecast, or recognized-revenue
  report.
- `Overview` contains a source-labeled `Quotes, decisions, and payments` history of recorded quote,
  retained-version, provider-acceptance, recipient-view, decision, booking,
  verified-payment-time, and latest quote-conversation-summary milestones. Each
  row opens the authoritative quote. The timeline never exposes message bodies,
  signatures, amounts, provider IDs, or tokens. Provider-reported delivery and
  bounce milestones remain absent until the bounded Customer 360 DTO has an
  authoritative receipt field for them.
- `Quotes & Proposals` lists canonical staff records and up to the 10 most
  recent retained versions for each displayed quote. Expand `Review proposal
  versions` for version number, saved reason, and timestamp. QuotePilot labels
  the list when older versions exist beyond that bound; use `Open record` for
  the authoritative quote surface. `Preview` uses a read-only staff adapter,
  never opens the public token portal, and never records customer `viewed`
  evidence. Escape or `Close preview` returns focus to the Preview control.
  When at least two retained immutable versions are available, select `Compare
  latest versions` for an advisory, read-only explanation of recorded scope,
  schedule, authoritative-pricing, and terms changes. `Not recorded` and
  `Source unavailable` remain distinct; QuotePilot never recalculates or mutates
  history and never treats lifecycle, portal, acceptance, payment, provider,
  booking, workflow, or mutable current totals as version-comparison inputs.
- `Events` lists accepted and booked events and provides the existing Schedule
  or quote/BEO entry points. Acceptance, booking, and operational readiness are
  separate facts. Contract conversion preserves the same server-owned customer
  identity on its immutable source version; that linkage does not itself prove
  booking confirmation, payment, or customer acceptance.
- `Money` shows deposit and final-balance states derived from canonical payment
  evidence. These are operational states, not an accounting revenue report.
- `Conversations` links to each quote's existing conversation. When a
  server-owned summary exists, the row shows the message count, latest activity,
  and whether the latest actor was staff or customer. Legacy quotes may report
  that a summary is unavailable. Customer 360 never merges or exposes message
  bodies as a customer-wide thread.
- Customer 360 reads are bounded to 25 current quote summaries and 10 retained
  versions per displayed quote. For high-volume customers, use the authoritative
  Quotes surface for the complete operational record rather than treating the
  360 summary as an accounting or archive export.

The exact-token customer decision center remains the only customer-facing
experience. A `?portal=<token>` query takes precedence on any pathname, and
newly generated links use `/app?portal=...`.

On routed `Quotes` and `Workflow`, use `Back to Home`; true contextual or
legacy dialogs continue to use `Close`. Staff route headings receive keyboard
focus after navigation so screen-reader and keyboard users have a visible
orientation point. Dates, money, statuses, source names, and missing values are
displayed as human-readable copy while their canonical stored values remain
unchanged.

## Event Messaging Station

- In a build with `VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED=true`, authenticated
  staff can select `Messages` or open `/app/messages`. This is a temporary-
  flagged source route and is not evidence that the station is deployed,
  enabled in production, hosted-accepted, or human-accepted. A focused link may
  add `?quoteId=<opaque-id>`; it never places a portal token, message body, or
  customer email in the URL.
- The station keeps one canonical conversation per quote/event. It does not
  combine every quote for one customer into a customer-wide chat. Search by
  event, customer, or quote; use `Needs reply` or `Active`; and review the
  event-oriented groups. `Customer last replied` means only that the latest
  recorded actor in the server summary is the customer. It is not an unread or
  read receipt.
- From a Living Opportunity, open **Conversation details**, then choose **Open
  event conversation** when no higher-priority recorded reply, customer request,
  or real follow-up needs review. The arrival rail says **Finding Conversation**
  while QuotePilot loads the exact quote-scoped bodies; it changes to
  **Conversation ready** only after the matching event heading is focused. A
  blank default follow-up shell is not scheduled work, and a refresh-in-progress
  or retained-after-error quote snapshot cannot be presented as fresh.
- The inbox listens to up to 50 same-tenant quote documents ordered by their
  most recent conversation summary and merges that activity with the existing
  bounded workspace context. The station normalizes event/thread identity plus
  count, latest message identity/time, and latest actor type; it does not query
  canonical message records or expose a body preview. Select one
  event to load its canonical history through the existing conversation
  callable; direct browser access to conversation records remains denied.
- A thread opens only when the quote has a current unexpired portal whose exact
  revision was provider-accepted and activated. Draft, expired, deleted, or
  mismatched delivery state is labeled unavailable; use `View event` to repair
  the delivery boundary instead of retrying the conversation.
- For an open staff thread, QuotePilot watches only that exact organization
  quote document. The customer decision center watches only the exact current
  portal document. When a higher-count or distinct non-older body-free signal
  arrives, QuotePilot calls the existing loader again so the server revalidates tenant, token,
  issuance, lifecycle, expiry, and delivery activation before returning
  canonical message bodies. A send remains callable-owned and is recorded only
  after its exact receipt; idempotent reconciliation and existing message/rate
  limits are unchanged.
- Read the synchronization labels narrowly: `Catching up` means the listener is
  connecting; `Live updates` means a server signal can prompt an automatic
  callable reload as a best-effort near-real-time path; `May be stale` means
  cached or incomplete signal metadata is visible; and `Updates paused` means
  automatic refresh is unavailable. Use `Refresh conversation` while cached or
  paused. These labels do not promise a latency SLA or prove provider delivery,
  recipient viewing, acceptance, booking, or payment.
- On mobile, selecting an event updates the focused `/app/messages` URL. Browser
  Back/Forward follows that selection; `Back to Messages` clears the quote
  focus and returns keyboard focus to the same event row. Each row includes its
  quote number, event date/time, and venue to separate similar events.
- This slice has no read receipts, typing indicators, online presence, or
  delivered/seen state. Conversation activity and `Needs reply` are operational
  cues only. Use `View event` for the authoritative quote record and `Customer
  360` for bounded customer context.

## Quote Builder Details
- Event Type drives dynamic menu categories and items.
- `Core Event Basics` keeps guest count and the Servers, Chefs, and Bartenders
  counts together under `Attendance & staffing`.
- `Advanced Pricing Overrides` starts collapsed. Open it only for exceptional
  template, tax, season, disposables, or staffing-rate values. If a saved quote
  or template already contains staffing-rate values, the collapsed section
  displays a review warning; opening and closing it does not clear those values.
- The review step shows a proposal readiness score and any missing customer, event, menu, or total details.
- `Compare Scenario` presents Good/Better/Best package options with recalculated totals; applying a scenario updates the active quote draft.
- Pricing supports:
  - `per_person`
  - `per_item` (with quantity input)
  - `per_event`
- Totals update in real time when guest count, item selection, or quantity changes.

## Quote History Operations
- Select `Quotes` in the top navigation. The routed workspace uses
  `/app/quotes`; a focused `/app/quotes/<quoteId>` opens that exact record.
- Read the quote/proposal lifecycle, booking confirmation, deposit, final
  balance, and delivery readiness as separate labeled facts. Matching colors do
  not make them the same state: for example, `Accepted`, `Confirmation pending`,
  `Deposit paid`, and `Balance requested` may coexist. Authorized select
  controls still mutate only their named authoritative field.
- Available actions per quote:
  - Edit an eligible draft, sent, or viewed quote. Firebase re-prices the edit
    from current tenant settings and atomically updates the quote/portal while
    creating the next version; terminal customer, booking, or payment evidence
    blocks the edit.
  - In the local development fallback, QuotePilot retains an already normalized
    pricing snapshot while adding the private commercial-cost evidence needed
    by staff margin context. That local record is source/test evidence only; it
    does not prove a hosted server-authoritative quote write.
  - While editing a Firebase-backed saved quote, use `Preview change impact` to
    compare the saved canonical revision with a server-authoritatively repriced
    snapshot of the unsaved form. Review exact fact changes, total and deposit
    deltas, and dependency nodes labeled `REVIEW` or `STALE`; use `Return to
    edit` to continue. Refresh the preview after further form changes. The
    preview is advisory only: it does not save or authorize the edit, invalidate
    a completed check, regenerate an artifact, reconcile a dependency, publish
    a proposal, or establish retained `CURRENT`/`STALE` artifact truth.
    The server owns the pricing actor and calculation time and verifies the
    confirmed catalog revision and settings fingerprint around its reads. If
    Catalog Admin changes pricing while the preview or save is being prepared,
    QuotePilot aborts that result. Refresh the current catalog/quote, recalculate,
    and retry; do not treat the rejected preview or edit as saved authority.
  - Duplicate to a new draft
  - Admin-only contract conversion remains bound to the exact approved
    Workflow request. An eligible row first says whether it is ready or still
    needs approval. While the request is running, QuotePilot reports submission
    without assuming a contract exists. If no trusted result returns, use
    `Reconcile conversion`; it retries the same approval request identity rather
    than discovering or substituting another approval. A confirmed receipt may
    name the trusted contract number, returned quote status, and immutable
    version. It does not prove deposit or final-balance settlement, customer
    booking confirmation, or operational readiness. A definitive rejection
    makes no success claim; use `Refresh history` to recover from the canonical
    quote before starting a new attempt. Quotes blocks Close, Escape, and routed
    navigation while a conversion is submitting, uncertain, reconciling, or
    recovering so the exact approval identity is not discarded. Contract
    conversion preserves the
    canonical `customerId` on the immutable source version and its snapshot.
  - Permanently delete through the admin-only cleanup callable. Direct quote or
    portal document deletion is denied.
  - Admin-only `Reopen` for an expired quote. It restores the last eligible
    nonterminal version as a draft and creates a new portal issuance. The trusted
    callable can also recover an eligible legacy `status=deleted` record, but a
    permanently deleted quote cannot be restored. Accepted, declined, booked,
    paid, or refunded evidence blocks both paths.
  - Export PDF, or use `Print proposal` to open the same current proposal in a
    print-ready PDF tab without first finding the downloaded file.
  - `Open email app` prepares the customer address, subject and proposal body
    in the device's default mail application. It does not attach the PDF and it
    never changes provider, delivery, quote or portal status; attach the
    downloaded proposal manually when needed.
  - Copy email template. Copying prepares an artifact only; it does not send
    anything or change draft status.
  - Copy a customer portal link only after the current saved revision has
    provider-acceptance evidence for its exact current valid issuance; draft,
    rotated-but-unsent, and legacy portals without that evidence fail closed.
  - Open `Conversation` for a provider-accepted current portal. The panel loads
    the quote's canonical message history and supports `Refresh conversation`,
    `Send message`, and same-request reconciliation when a send returns no
    server receipt. `Message recorded` proves only the canonical QuotePilot
    conversation receipt, not external delivery. While a message outcome is
    uncertain, the composer remains locked. You may close the panel: QuotePilot
    keeps the exact request identity and unchanged body in bounded app memory,
    warns before full-page unload, and restores them when the same conversation
    is reopened. It does not place message content in browser storage. Use
    `Reconcile message` to retry the unchanged message with that same identity;
    refreshing history alone does not resolve the pending receipt. After a
    definitive rejection, `Reset rejected attempt` explicitly clears the old
    identity before editing. Messages are limited to 1,200 characters. A
    declined quote keeps its history visible but removes the composer; an
    expired, deleted, rotated, or otherwise inactive portal cannot be used. When
    a portal is safely rotated and delivered again, its new link sees the
    existing quote conversation while the old link stays invalid.
  - Admin only: submit customer email to the configured provider, copy a
    verified Stripe payment link, send an approved Stripe deposit request,
    send or reconcile an approved final-balance request for an eligible booked
    contract, and rotate a customer portal token for a draft, sent, or viewed
    quote when its issuance should be replaced. Use `Reopen` when the quote
    itself is expired. Accepted and declined records cannot rotate their portal
    identity; an approved booked contract may renew an expired portal when its
    provider-paid deposit is verified and no final-balance checkout is active.
    Quote email submission is bound to the exact saved version and portal
    issuance, remains disabled in local fallback mode, and fails closed while
    provider configuration readiness is unknown. This configuration check does
    not prove sender-domain verification, provider acceptance, inbox delivery,
    or bounce handling. Rotation invalidates prior portal activation evidence,
    so both Copy Portal and the portal link inside a PDF remain unavailable
    until a separate provider send accepts the new issuance.
- In the current source, `Send Pay Request` is available only for an
  accepted or booked quote with an exact approved action. That approval is
  bound to the organization, quote revision, current portal issuance, customer
  email, currency, and deposit amount. QuotePilot privately prepares or safely
  restores the Stripe Checkout Session, then submits the payment-request email;
  there is no separate browser checkout-creation step. While prepared, the
  quote records the Session without exposing its payment link, and the URL is
  kept out of browser-readable app records in a server-only dispatch record.
  QuotePilot publishes the link to the quote and portal only after
  email-provider acceptance is durably recorded. If any bound value changes,
  request and approve a new action before sending.
- In the current source, `Send Balance Request` is a separate exact
  approved action available only for a booked contract with a verified
  provider-paid deposit. QuotePilot derives the final balance from the
  authoritative quote total minus deposit; the browser cannot supply the
  amount, payment kind, Stripe Session, generation, or link. The approval also
  binds the contract and paid-deposit evidence. Final-balance checkout and
  payment state are recorded separately from the deposit, and the link follows
  the same private-before-provider-acceptance publication boundary. A customer
  sees `Pay Final Balance` only after the accepted request publishes the
  customer-safe link.
- If the action reports an uncertain Stripe-creation or email-provider outcome,
  do not create a second request or manually share a link. Reload Quote History
  and have the admin who began the action use `Resume Pay Request` or `Resume
  Balance Request`, as applicable; another admin cannot take over the
  in-progress provider identity. QuotePilot keeps the exact approval in
  progress and reuses the same Stripe-creation and provider identities; a known
  prepared Session is reused. The hidden link does not prove the customer
  received nothing—an ambiguous provider call may still have been accepted. If
  acceptance was already recorded but payment publication was interrupted,
  resume completes publication without another email send.
- A definite provider failure requires a new approval only after QuotePilot
  safely expires any prepared unsent checkout and clears its private URL. If
  cleanup cannot be confirmed, the exact operation remains resumable; retry it
  or use `Reconcile Payment` rather than starting a replacement.
- If the email provider accepted the request but its Checkout Session expires
  before interrupted publication can resume, QuotePilot closes that operation
  as failed, records the checkout as expired, and requires a fresh exact
  approval. It does not send the accepted email again or reuse the expired
  payment link.
- If the portal expires while a dispatch is still recorded as `sending` or its
  provider outcome is ambiguous, QuotePilot does not relabel the email as
  unsent and does not send it again. An active `sending` attempt waits through a
  15-minute recovery boundary before an atomic claim marks it provider-unknown,
  preventing Stripe expiry while the original email call may still be in
  flight. Recovery then attempts to resolve or expire the exact Session,
  preserves paid or refunded truth, records the email outcome as unknown, and
  closes the stale approval. A missing or changed expired portal cannot block
  authoritative quote/ledger closure; it is flagged for review and its portal
  projection is skipped. Use the matching reconciliation control before
  another request whenever Stripe remains open, processing, or unknown.
- If an operation stops before either a private Checkout preparation or an
  email dispatch is durably recorded, retry closes that unpublished operation
  and requires a fresh approval. Its audit records Stripe creation as
  unverified rather than claiming the provider was never contacted; no payment
  link or email was exposed by the closed operation. Once either durable record
  exists, the resumable or provider-review path remains authoritative instead.
- Payment state is provider-owned. Signed Stripe events can record processing,
  paid, failed, or expired state; a failed or expired Session clears the
  corresponding published payment link so a new exact approval/send can create
  a replacement. Stripe payment-kind metadata and stored Session scope keep
  deposit and final-balance transitions on separate rails. Paid or refunded
  truth cannot be downgraded through the staff UI.
- Admins may select `Reconcile Payment` when the stored Stripe Session needs
  provider review, such as after delayed webhook delivery. Reconciliation reads
  the server-recorded Session and applies or reports provider truth; it is not a
  manual paid button. Use `Reconcile Final Balance` for the final-balance rail.
  A review-required result must be investigated in Stripe.
- This workflow is not production behavior until its matching frontend,
  Functions, and Firestore rules are deployed together and hosted Stripe
  test/live acceptance is recorded separately for deposit and final-balance
  collection. No hosted or Stripe-provider acceptance has been recorded for
  either payment rail. Refund
  initiation/status and dispute handling remain manual or unimplemented
  outside the automated collection workflow.
- While quote delivery is `sending`, or its provider outcome needs manual
  review, QuotePilot locks quote status/payment, edit, checkout, payment email,
  contract, portal rotation, and deletion controls. PDF download, email-template
  copy, and duplication remain available because they do not mutate the locked
  customer record.
- If the quote validity window ends while delivery is unresolved, Quote History
  keeps the derived expired row visible and defers lifecycle persistence instead
  of hiding the review control. Complete `Review Delivery`; QuotePilot reloads
  the record, persists eligible quote/portal expiry together, and then exposes
  `Reopen`.
- If a delivery lease expires inside the 23-hour provider idempotency window,
  `Retry Quote Email` resubmits the exact revision with the same provider key.
  A definite provider failure after that window starts a fresh delivery
  generation before another send. If the outcome is ambiguous, use `Review
  Delivery`: check the provider first, then record its accepted message ID or
  confirm with an audit note that no message was accepted. QuotePilot does not
  allow a known server-observed provider message ID to be reconciled as no-send.
  Provider acceptance for an invalid or expired issuance remains recorded, but
  the portal stays inactive and requires guarded rotation plus a new send. Do
  not clear an uncertain outcome without checking the provider.
- Firebase staff cannot set a quote to `sent` or `viewed` through the generic
  status menu. The delivery callable or audited provider reconciliation owns
  `sent`; an actual customer portal visit owns `viewed`. Owner SMS on draft
  creation contains the quote summary but never the inactive portal URL.
- Status filtering supports grouped views:
  - `Submitted` (sent/viewed/accepted)
  - `Archived` (booked/declined/expired)

## Workspace Tool and Recovery Controls

- In a customer-centered workspace build, selecting Schedule, Reporting,
  Catalog, Imports, Integrations, or Diagnostics navigates to its `/app/*`
  workspace route and loads only that embedded view. Ordinary navigation keeps
  a previously opened operational view mounted so its filters or in-progress
  local state can survive; use the view's explicit close/return action when you
  intend to leave through its existing busy or unsaved-work guard.
- Contextual Catalog entry points and the flag-off/legacy workspace retain
  their modal presentation. In those dialogs, keyboard focus starts inside the
  dialog, Tab and Shift+Tab remain within it, and focus returns to the trigger
  after closing.
- Press `Escape` to close a dialog when it is safe. Catalog drafts keep their
  discard confirmation, and an in-progress save, import, schedule update, or
  provider operation keeps the dialog open with visible guidance until the
  action finishes.
- If a workspace tool cannot load, use `Try again` for a fresh tool import,
  `Reload workspace` for a full reload, or `Close tool`/the route back action to
  return to the intact staff shell. Public-route recovery similarly offers `Try
  again`, `Reload page`, and `Back to QuotePilot`.
- `Reload workspace` asks for confirmation when the current quote has unsaved
  changes. Cancel to keep working, or use `Close tool` to leave the failed tool
  without discarding the quote.
- Before retrying an operation with an uncertain provider or save outcome,
  check the most recent stored work or provider evidence. The recovery screen
  deliberately shows safe guidance rather than internal error paths or stacks.

### Install and reconnect (source candidate)

- A supported browser may offer **Install QuotePilot** from its own address-bar
  or application menu. Installation changes how the public shell opens; it does
  not create another account, retain a trusted offline workspace, or change
  role and tenant access.
- If a navigation happens while the device is offline, the candidate shows one
  recovery page with **Try QuotePilot again**. Reconnect before reviewing
  quotes, payments, customer messages, or event operations.
- The recovery page confirms that nothing was sent, saved, or changed. QuotePilot
  does not queue trusted writes or present cached authenticated records as
  current. If a save or provider action became uncertain before connectivity
  was lost, verify the latest stored or provider evidence after reconnecting.
- This install/recovery behavior is source/local evidence. The currently hosted
  app still has the earlier scaffold until an exact release is deployed, and
  hosted installation/relaunch plus physical-device acceptance remain open.

## Workflow
- Open `Workflow` from the top navigation or `/app/workflow`.
- If no quote has been saved yet, Workflow explains what will appear there and
  offers `Start a quote`. That action returns directly to the quote intake so
  the operator can begin with the customer inquiry instead of encountering an
  empty management surface.
- When active quotes need action, the navigation control shows the number of
  affected quotes. One quote counts once even when it has multiple attention
  reasons. The count loads after the main workspace becomes interactive and
  does not eagerly load the routed Workflow view.
- Summary metrics show active opportunities, readiness gaps, follow-ups due, and pending approval requests.
- `Attention` opens first when work is present. It consolidates new or
  acknowledged customer change requests, overdue or due-today follow-ups, and
  pending approvals. Use `Review follow-up` or `Review approvals` to move to
  the exact operating view.
- When `Review follow-up` begins from Now, Opportunities, or Client 360, the
  **Current task** rail remains **In progress** after the exact Workflow item is
  opened. Opening or focusing the item does not complete it. If you mark that
  exact follow-up complete in a connected Firebase workspace, QuotePilot shows
  **Completed** only after a server-only read of the same organization and
  quote confirms the returned follow-up fields and current Attention no longer
  contains it. The confirmation proves only the internal follow-up state; it
  does not prove customer contact, provider delivery, proposal resolution,
  payment, or booking.
- A browser-local save or an unavailable, stale, mismatched, or ambiguous
  server read shows **Needs confirmation** with no completion proof. Use
  `Retry confirmation` to read the exact record again; it does not repeat the
  save. `Stop tracking` clears only this device's session task rail and never
  changes the saved quote or version history.

### Durable action feedback (source/local foundation)

The current source candidate adds one same-runtime action-feedback rail for the
exact tracked Workflow follow-up completion. It appears with the affected
follow-up and uses these operator-facing states:

- **In progress** — one exact save or confirmation read is active. The affected
  area is busy, and the same write cannot be submitted again.
- **Confirmed** — the owning Workflow authority returned its existing proof
  and the exact same-workspace record matched. If this attempt still owns the
  Current task, QuotePilot also persisted that exact task's closure. An older
  feedback attempt can confirm independently without changing or claiming
  completion of a newer or missing Current task.
- **Needs attention** — QuotePilot knows enough to name what changed or stayed
  unchanged and offers one safe next action.
- **Needs confirmation** — the write may have happened, but exact evidence is
  unavailable or mismatched. The save remains disabled; use the offered
  read-only exact-follow-up review instead of trying the write again. You cannot
  dismiss this state; it remains a duplicate-write fence until exact
  reconciliation or authoritative cancellation resolves it.
- **Cancelled** — the action stopped before dispatch or the owning authority
  supplied a cancellation basis. Stopping the separate Current task rail does
  not cancel a save.

The feedback rail and **Current task** rail may appear together, but they answer
different questions: action feedback describes one attempt, while Current task
tracks the wider cross-route job. One shared announcement reports the action
state; the Workflow panel does not repeat the same consequential toast or live
message. The rail stays available while moving among staff routes in the same
runtime, including between the standard staff workspace and its authorized
compatibility view. Reloading the page, signing in as another person, changing
role, or changing workspace clears it rather than attaching old feedback to a
new scope. Customer, portal, unresolved-sign-in, and denied-role views never
mount the staff feedback provider.

For the first adapter, entering or saving a follow-up still uses the established
Workflow fields and write path. When the same attempt still owns the Current
task, a server readback alone is not enough if the App rejects task closure:
Workflow remains unconfirmed and the rail explains that the task did not close.
If an older feedback attempt is reconciled after a newer task replaced it, the
exact follow-up may confirm independently while the newer task remains untouched
and no task-completion fact is shown. Timeout, offline, permission, stale,
foreign-workspace, malformed, and field-mismatch results never appear as
**Confirmed**. If the required shared rail cannot begin, Workflow does not send
the write; it keeps one local accessible recovery message and does not expose
raw error text. Correct an invalid stage or date at the focused field before
trying again.

For this Workflow adapter, the rail receives only fixed QuotePilot-written
action, message, and changed/unchanged copy, a bounded quote-number label, and
opaque object IDs. The adapter does not supply the follow-up note, customer or
staff email, thrown provider text, token-like material, or raw record. The
shared registry also rejects recognizable sensitive/error patterns, unexpected
fields, deceptive control characters, and oversized content, but that filter
is a guardrail rather than proof of where arbitrary normal prose originated. Do
not use this foundation as a transport for notes or other free text; each future
adapter must establish its own fixed-copy boundary before joining the rail.

When **Needs confirmation** offers **Review exact follow-up**, it returns to and
focuses that exact follow-up record even if **Stop tracking** already removed the
separate Current task rail. Once the exact record and focus resolve, the shared
return control becomes inactive and the local **Retry confirmation** remains.
The uncertain record itself is retained, so an unchecked completion box or a
new task generation still cannot repeat the write. That retry reads the exact
record only; presentation acknowledgement never confirms, cancels, or repeats
the save.

This foundation does not yet replace Quick Updates, Catalog, or other staff
mutation feedback. Those surfaces keep their current behavior until a later
adapter is implemented and separately accepted.

Focused local coverage exercises identity and transition fences, immutable
attempt ownership, unresolved-capacity refusal, late-result cleanup, scope
changes, announcement cleanup, and duplicate-write prevention. The dedicated
Chromium-admin journeys cover phone, tablet, and desktop source routes. Their
browser-local saves deliberately remain **Needs confirmation**, retain feedback
across an authorized route change, return to the exact completed follow-up even
when it is no longer in Attention, and clear only the feedback rail on reload.
Six matching before/after captures cover the responsive stack; a tablet identity
wrap found during review was fixed. Final result counts are recorded against the
immutable candidate after the last lifecycle change. This is local fixture
evidence, not connected Firebase, hosted, provider, production,
assistive-technology, or human acceptance.

- For a customer change request, `Acknowledge internally` records that staff
  saw the exact current request but keeps it in Attention. `Mark handled
  internally` requires a short internal note and clears only that exact request.
  A later customer request automatically reappears. These actions do not edit
  or resend the quote, contact the customer, accept/decline the proposal,
  confirm payment, or create a booking. Use `Edit quote` and the normal
  send/review workflow for the actual revision.
- The `Follow-ups` view supports lead stage, due date, note, completion state, proposal readiness, and a lifecycle timeline for each quote.
- `Due cues & completion receipts` derives due-today, overdue, upcoming, and
  aging guidance from the bounded Workflow snapshot and separately lists exact
  stored internal completion evidence. Review its source, captured time,
  calendar context, and displayed bounds before acting. An internal receipt
  proves only the recorded staff action; it does not prove customer contact,
  provider delivery, proposal resolution, payment, or booking. If refresh fails,
  the last successful snapshot is labeled stale and `Retry read` requests a new
  tenant-scoped snapshot.
- `Revenue autopilot` keeps the original bounded, non-sending quote eligibility
  preview and now places a separate server-owned operations surface beneath it.
  The preview still creates no job, Attention item, receipt, or provider action;
  use the operations surface and its exact receipts for current materialized
  state. See **Revenue Autopilot operations** below.
- Sales staff can request approval for sensitive actions such as payment requests, contract conversion, portal-link rotation, or quote deletion.
- Admins can approve or reject those requests with a resolution note. Approval
  records authority but does not execute the action; select `Execute in Quotes`
  and complete the matching operation there. Firebase-backed actions
  consume that exact approval once and display awaiting, in-progress,
  completed, or failed execution evidence. A failed provider action requires a
  new approval request.
- In the current source, Firebase-backed request and resolution
  records prefer trusted Functions using the authenticated staff identity and
  server timestamp. A narrowly scoped missing-endpoint fallback preserves the
  existing rule-authorized path during a Vercel-first rollout; other callable
  errors fail closed. Sensitive action execution has no browser-write fallback.
  The deployed matching Functions and Firestore rules deny direct
  approval-array, contract-evidence, and execution-audit writes; source changes
  still require a coordinated release before they alter production behavior.

### Clear the Deck decision resolution (QP-UXR-002)

- Open **Clear the Deck** for an explicit commercial or operational judgment.
  Each exact pending approval presents its event/customer, lifecycle, material
  stake, timing, requester, revision, dependency consequence, evidence
  boundary, and required authority. Exact retained Decision Debt uses the same
  judgment surface but remains owned by Workflow.
- **Review in Workflow** carries and focuses that exact request. Workflow repeats
  the material context beside the existing role-gated controls; it never
  substitutes the first or a similar item.
- Approval and execution remain separate. A confirmed resolution receipt names
  **Changed**, **Preserved**, and **Next**. When still eligible, continue to the
  existing Quotes execution surface; the approval itself does not charge,
  contract, rotate a portal, send, or delete anything.
- If the outcome may have been sent but exact readback is unavailable, do not
  choose again. **Check current approval state** reads the original operation
  only. Current incomplete, stale, failed, contradictory, or truncated evidence
  withdraws approval; authorized rejection remains non-executing.
- Returning refreshes Clear the Deck and restores the same decision, or its
  heading when complete current evidence correctly proves that decision is no
  longer pending. Local or responsive evidence does not substitute for a
  connected approval write, provider outcome, or human acceptance.

## Ingredient inventory

When all three Inventory Authority gates are explicitly enabled, an
administrator can open **Workspace tools → Operations → Inventory**. The route
is not available to customers or sales staff in the first ingredient slice.
It requires a connected Firebase workspace; there is no browser-local stock or
cost authority.

The Inventory backend is deployed and exact-tenant enabled in v0.18.1, but the
public Vercel frontend remains older. Treat route presence, successful hosted
operator use, and human acceptance as separate evidence.

If a command reports **Unauthenticated** while the workspace still identifies
you as the signed-in administrator, do not create a replacement request. Retry
the original command only through its displayed recovery action, refresh the
workspace once, and report the persistent failure as an application-integrity
or deployment issue. A rejected request is not a stock receipt and must never
be treated as a successful inventory change.

The initial setup is intentionally small:

1. Create a stock location, such as **Main kitchen**.
2. Add an ingredient with its stable name, category, and base stock unit.
3. Record the opening counted quantity at that location.
4. Independently record the observed total purchase cost and quantity basis, or
   leave cost explicitly not yet available.
5. For later goods already received, use **Record receiving** on the ingredient,
   enter the exact quantity, received time, source, and known or explicitly
   unavailable purchase cost, then wait for the realtime stock projection to
   confirm the receipt.

For example, record **Chicken**, `40 lb`, and a `$120` total cost basis. The
stock receipt establishes 40 lb on hand; the separate cost receipt retains the
exact `$120 / 40 lb` evidence. A cost failure does not undo the stock record,
and missing cost is never displayed as zero.

The ingredient list and location setup read bounded Firestore projections in
realtime. **Cached**, **pending**, **stale**, **unavailable**, and **uncertain**
states are not confirmation. If an action may have reached the server but no
receipt returned, keep the entered values and use **Check exact request**; do
not start a replacement request.

The founder-pilot staging and production workspaces may contain the
`ragnakok-realistic-v1` planning fixture: five kitchen locations, 132
ingredients, at least 500 menu items, and 200 recipe projections. Records whose
source or note begins **Projected ragnakok-realistic-v1** or **Synthetic
founder-pilot** are demonstration assumptions. Do not treat them as a count,
invoice, supplier confirmation, purchase order, allocation, or receiving
receipt. Replace them through normal Inventory actions before relying on them
for a live event. After this menu population, an administrator must review and
confirm **Catalog → Pricing setup** because the import deliberately invalidates
the prior pricing confirmation.

The same founder-pilot workspace may also contain the
`ragnakok-operations-v1` operating twin. It adds eight named Offers with
recorded costs and choice groups, add-ons and rentals, Event Templates and
Configuration Rules, 20 staff profiles with generated portraits and detailed
operational records, ten example opportunities/events, Staffing plans,
approvals, and workflow/event ledgers. Use these records to exercise Library,
Opportunities, Operations, Staff, Workflow, approvals, pricing, and margin
presentation as one connected system.

The operating-twin loader is a privileged exact-tenant fixture migration. It
may enable Inventory and Staffing settings and reconfirm the exact current
catalog revision. Do not run a hosted apply unless those transitions have been
reviewed and separately authorized; preserve dry-run, apply, and readback
receipts.

Every customer acceptance, provider-delivery field, approval, staff
qualification, availability window, attendance statistic, and performance
note in that fixture is synthetic. It is safe demonstration coverage, not
proof that a customer consented, a provider delivered, an employee is
qualified or available, a supplier acted, inventory exists, or a human
accepted the workflow. Replace synthetic evidence through the normal governed
surface before relying on it for live operations.

For an ingredient bought in a supplier pack, open **Declare or revise pack** on
that ingredient. Give the pack a stable reference, label, exact quantity in the
ingredient's base unit, and evidence source. For example, `case-chicken-40lb`
may declare `1 case = 40 lb`. Publishing creates a new immutable conversion
revision; it does not receive stock or create cost evidence. Never use a pack
conversion to infer a density, edible yield, or case contents that the operator
has not declared.

To cost an existing menu item:

1. Open **Library → Menus**, then open the saved menu item.
2. In **Recipe & ingredient cost**, enter the recipe's explicit output yield,
   such as `10 portions`.
3. Add each ingredient quantity and choose a compatible standard unit or one
   of that ingredient's declared purchase packs.
4. Mark the quantity **As purchased** or **Usable quantity**. A usable quantity
   needs an explicit yield ratio, such as `0.8`; QuotePilot does not assume one.
5. Publish the recipe revision. A local, dirty, staged, saving, or stale catalog
   item must first be saved and refreshed.

The cost card is a server-calculated projection, not browser arithmetic. It
shows the total ingredient cost for the recipe batch separately from cost per
recipe output unit, ingredient coverage, and explicit missing or
invalid evidence. **Partial projected cost** means only the named known inputs
are included; it is never the complete recipe cost. **Stale** means an upstream
ingredient or recipe changed and the projection is awaiting or recovering its
exact recalculation. Cached or pending ingredient data cannot authorize recipe
publication. Sales staff may read the bounded menu-cost summary but cannot
read stock details or publish recipes. When an administrator opens a menu item,
the editor also listens to that item’s exact projection document; a menu item
outside the bounded summary can never be mistaken for one with no recipe.

To evaluate an event, open the saved quote in **Quote Edit**, expand
**Ingredient quantity, cost, and allocation evidence**, and enter the exact
required recipe output quantity for each selected menu item. Confirm its recipe
output unit. Use the actual portion, menu-choice, tray, or batch requirement:
QuotePilot does not copy the guest count or the billing quantity into this
field. On an unchanged saved quote, the disclosure retains **Preview ingredient
impact** so the existing read-only evaluation remains reachable. Once a working
guest-count scenario exists, that standalone action hides and the nearby
Commercial Scenario Workbench includes the read-only ingredient evaluation in
the same reviewed Commercial Change request after the input settles. The server
builds the prospective immutable quote revision privately, rechecks the saved
base revision, and lets Inventory evaluate that proposed revision without a
second browser race. The returned observation stays separate from commercial
pricing and authorization and is accepted only when its commercial receipt,
prospective revision, Inventory input digest, and projection revision agree.
Physical demand, projected
ingredient cost, and stock availability remain separate results. A valid
projected cost remains visible during a shortage; a valid shortage remains
visible when cost evidence is incomplete.

An administrator may record only a current preview for the unchanged saved
quote revision. Recording creates an immutable requirement and advances its
exact event projection; it does not reserve or consume stock. A dirty quote may
run the read-only scenario preview against the saved base revision when its
explicit output evidence is complete, but it remains **Draft not evaluated**
for recording, allocation, and reconciliation. Any prior saved projection is
retained as separately labeled stale context. Cached or pending snapshots are
not current. If recording has an uncertain outcome, use **Reconcile request**
with the same request identity; do not submit a replacement command. The event
required-by instant is derived on the server from the saved event date/time and
organization business timezone, not from the browser clock.

For an **accepted** or **booked** quote with a complete recorded requirement, an
administrator may choose the stock location and select **Allocate
ingredients**. The server rechecks the active quote and recipe revisions,
physical on-hand, every existing commitment, and the event plan in one
transaction. It allocates the maximum safe quantity and names each shortage;
it never treats a later event date as making consumed ingredients available
again. A sales user sees the exact allocation evidence but no mutation controls.

Receiving changes physical on-hand without creating or releasing an event
allocation. Allocation changes commitments without reducing on-hand. If a
partial allocation remains short after new stock is received, select
**Allocate remaining** to preserve the existing hold and fill only the shortage.
Use **Release allocation** with a reason when the commitment is no longer
needed; release does not change physical stock. A callable receipt remains
pending evidence until the exact metadata-aware event projection confirms the
same allocation revision. Reconcile uncertain outcomes with the original
request identity.

If the saved quote or a recipe changes after allocation, QuotePilot preserves
the prior hold and labels it **Retained hold needs reconciliation**. Record the
new current ingredient requirement, enter an operator reason, and choose
**Reconcile retained allocation**. The server releases the old quantities and
allocates the revised demand as one transaction; it may return a new partial
shortage. You may instead release the stale hold. Do not use **Allocate
remaining** against stale allocation evidence.

In the Commercial Scenario Workbench, ingredient consequences compare the
exact saved event projection with the active read-only scenario preview. Menu ingredient
cost and stock availability appear as separate advisory rails with their own
missing, pending, partial, stale, failed, or current evidence. They do not
change the quote price, required commercial authority, apply action, or publish
state. Changing either the commercial draft or an explicit recipe-output input
advances the active scenario generation. A prior accepted result may remain
visible with a **Retained** explanation while the new result loads, but a late
response for an older exact fingerprint is never shown as current. This slice
evaluates inventory only for a guest-count-only proposal. A mixed proposal or
non-guest draft edit is labeled outside the slice, not as evidence that
inventory has no effect.

After an accepted or booked event, open its **Control Room** and find
**Ingredient actuals**. This surface is separate from Quote Edit because it
records physical execution rather than commercial intent. An administrator
must enter an explicit consumed quantity and waste quantity for every planned
ingredient; blanks are never treated as zero. Enter the evidence time and
reason, acknowledge that every row is complete, then choose **Finish usage
capture**. Sales staff may review the resulting projection but cannot record or
correct it.

The server settles the event's active ingredient hold and reduces physical
on-hand by the recorded consumed-plus-waste total in one transaction. It does
not subtract the allocation again. A valid over-plan quantity is accepted only
when enough uncommitted stock remains to protect every other event. The plan is
shown as **Settled**, which is distinct from a cancellation release.

To correct a confirmed closeout, enter complete replacement totals and an
explicit correction reason. The prior revision remains immutable. QuotePilot
applies only the resulting physical difference; changing consumed to waste
without changing the total records a correction but does not invent a stock
movement. A receipt remains pending until the separate exact execution
projection confirms the same revision, receipt, and movement identities.
Cached, pending, unavailable, or uncertain reads disable further mutation and
retain the exact-request recovery action.

The Control Room may show **Usage at saved planned basis** and its difference
from the saved projected ingredient cost when every pinned ingredient cost is
complete. This is planning-basis comparison, not authoritative actual COGS.
Unknown or partial costs remain incomplete, and QuotePilot does not invent
FIFO, LIFO, weighted-average, lot attribution, or any other undeclared
valuation policy.

This source-candidate slice supports at most 200 location definitions and 200
ingredient definitions per organization. The shared server transaction fence
rejects record 201, and a projection at its bound is labeled **Partial**. That
temporary limit must be replaced by cursor-based navigation before larger
catalogs are activated; the browser never silently treats a truncated list as
complete.

Event Preflight and the selected Operations event now reuse the same exact
realtime plan and execution reads. They show **Physical stock**, **Menu cost**,
and **Event usage** as separate checks. A current full allocation may remain
valid while cost evidence is partial or unknown. Conversely, a saved
**Available** preview does not mean ingredients were allocated. Cached, pending,
stale, mismatched, or unavailable evidence cannot appear current. Operations
subscribes only to the selected event, not every Calendar row, and quantity
comparisons remain grouped by base unit.

The merged v0.18 source and deployed v0.18.1 Inventory backend support current recipe/menu-item cost, immutable
event ingredient demand and projected cost, durable receiving, cumulative
consumable-stock shortage, concurrency-safe allocation/release, historical
change invalidation, explicit retained-hold reconciliation, and read-only
Commercial Change consequences. Current public-browser parity remains open. It
also records event consumption, waste,
allocation settlement, immutable correction evidence, quantity variance, and
saved-planning-basis cost comparison in the exact event Control Room. It does
not claim inventory value, authoritative COGS, public-browser parity, or human
acceptance. Tenant-wide shortage frequency, inbound-supply risk, ingredient
freshness/suitability, inventory valuation, and authoritative actual-cost
reporting remain unavailable until their own bounded evidence authorities exist.

## Commercial Change Authority

### Governed Commercial Amendment Experience (QP-UXR-001)

- For an eligible draft, sent, or viewed quote, Quote Edit keeps one continuous
  decision path: **current commitment → proposed change → semantic difference →
  authoritative simulation → consequence → required authority → atomic
  application → preserved truth → invalidated truth → receipt → next valid
  action**. It composes the existing Commercial Change Authority and is not a
  second editor, calculator, consequence engine, or payment authority.
- The Living Commercial Twin is now the first-slice **Commercial Scenario
  Workbench**. **Current** is the exact saved priced guest count and cannot be
  edited, renamed, or discarded. Entering a different whole guest count creates
  temporary **Scenario A**. Use the minus/plus controls, direct numeric entry,
  or the +10, +25, and +50 conveniences; the accepted range is 1–400. These
  controls test a commercial possibility and never imply that people or supply
  can fulfill it.
- Select **Duplicate scenario** to create one independent **Scenario B** from
  the active values. The workbench supports Current plus at most A and B in the
  current browser session. Switch among their tabs without leaving Quote Edit;
  each scenario restores its own guest count and valid cached consequence.
  **Discard scenario** removes only that temporary alternative. Nothing is
  persisted, and a reload or new saved base revision resets the workbench.
- Every working alternative has a unique scenario identity, creation time,
  exact saved base revision, monotonic generation, and input digest. A guest
  change advances the generation. While the exact Commercial and Inventory
  previews recompute, the latest accepted result may remain visible only with a
  retained-result notice. A response is current only when scenario, generation,
  digest, revision, and guest count all match, so an older response cannot
  overwrite a later edit or another scenario.
- The scenario context also fingerprints every non-guest draft input and the
  explicit ingredient selections. Changing event, customer, menu, staffing,
  or another non-guest input clears A/B and their caches, rejects any queued
  response from the prior context, and starts a clean exploration scope. A
  changed non-guest **Current** draft uses the same exact five-field envelope
  for **Preview consequences** before governed review. A failed read is not
  replayed automatically: choose the explicit retry. Only a
  transport-uncertain simulation reuses the prior request identity; a
  definitive rejection or stale success starts a new request.
- The center **Living commitment** updates the working guest count and the
  current-versus-working quote total, deposit, and ingredient cost in place.
  The right consequence rail composes **People**, **Supply**, **Overall**, and
  Kitchen BEO meaning. Default-good evidence stays quiet; missing, partial,
  stale, failed, contradictory, or integration-blocked evidence remains
  explicit. Commercial still owns quote/version, guest count, menu, price, and
  acceptance; Staffing still owns people, capabilities, availability,
  assignments, and schedule fences; Inventory still owns ingredients,
  movements, costs, recipes, allocations, and consumption. They are not merged
  into one `event` record.
- The Workbench owns the full composer width above the quote-plan/document
  columns. Its scenario controls, commitment, and consequence rail reflow from
  three columns to a compact stack at narrow container widths without hiding
  the active scenario, dominant action, evidence state, or recovery.
- The workbench itself owns no network, provider, persistence, pricing,
  staffing, inventory, BEO, or apply authority. Its host requests the existing
  read-only evidence for the exact active scenario. Commercial pricing
  and dependency evidence remain server-authoritative. Inventory joins the same
  server simulation round trip only
  for a guest-count-only scenario when its independently gated explicit
  recipe-output quantities and portion basis are complete. Mixed and non-guest
  edits are explicitly outside this inventory slice; they are not labeled as
  having no inventory effect.
- **Fulfillment** is the Twin's rebuildable read model. **People** compares
  current-revision operator-confirmed assignments with current authoritative
  role requirements and, when present, the explicit proposed commercial role
  counts. **Supply** carries exact demand, shortage, and projected-cost evidence
  from the ingredient comparator. A People failure does not erase current
  Supply evidence, and a Supply failure does not erase current People evidence.
  The projection excludes private staff contact, rate, payroll, and notes.
- One Layer-3 **Fulfillment Intelligence** presenter renders that projection for
  the Workbench. It performs no reads, calculations, saves, reservations, or
  assignments and does not become a fourth authority. This single presenter
  owns the Overall, People, Supply, constraint, source-revision, and decision-
  answer presentation; there is no parallel inline Fulfillment interpretation.
- The higher-order `fulfillment-decision-answer-v1` can assemble one bounded
  operator answer from the exact evidence already carried by the three
  authorities. It may state the proposed guest count, an exact ingredient
  shortage, the causative menu item when recipe contribution identity survives
  the Inventory comparison, the proposed quote total, the current Staffing
  effect, and the exact Kitchen BEO review effect. Missing contribution
  provenance is reported as unavailable; a shortage is never attributed to a
  menu item by label matching or guesswork. **Conditionally supportable** is a
  governed-review statement, not customer acceptance, booking, event readiness,
  or permission to apply the scenario. A decision can be **Supported** or
  **Conditional** only when both People and Supply evidence are current and
  complete. If either domain is missing, partial, stale, contradictory, blocked,
  or otherwise incomplete, the answer is **Unverifiable** even when an exact
  Commercial preview remains available.
- The decision answer calls the commercial amount **Proposed quote total**. It
  is not earned revenue, booked value, payment, or a guaranteed amount preserved
  by resolving a constraint. It may say that current assignments cover the
  proposed staffing requirement only when People evidence is current and
  complete and its exact assignment gap is zero. Otherwise the staffing
  conclusion remains unavailable or names the exact gap. If the proposed event
  date, start time, or duration changes, Current coverage stays visible but the
  Working need becomes **Not verified** until availability and conflicts are
  reviewed for that proposed window; saved-window assignments are never carried
  forward as if they covered the new time. The reviewed comparison comes from
  the same server simulation as the commercial change and is bound to its real
  prospective quote revision; it exposes aggregate role counts, not staff
  names, private details, assignments, or an automatic team decision. Kitchen
  BEO review is
  required only when the exact projected BEO effect requires it.
- A supplier resolution can appear only from a current, exact-scope,
  revision-bound `inventory-sourcing-preview-v1` carrying a unique match under
  a declared selection-policy revision. In addition to organization, quote,
  saved revision, and scenario identity, its basis must exactly match the
  proposed Inventory event-requirement revision, projection digest, scenario
  fingerprint, and shortage quantity shown by Supply. A tie, missing policy,
  ineligible offers, stale or mismatched scope or basis, or missing preview
  cannot name a supplier or a “best” resolution. The normal application
  currently supplies no sourcing preview, so this state is expected to say that
  the resolution is not yet evidenced. The **purchase quantity** is the
  available pack amount to buy; **coverage quantity** is the amount that covers
  this shortfall. QuotePilot states both when they differ and never substitutes
  the pack size for the shortage. Even a valid policy-selected option is
  advisory: it is not stock, a reservation, purchase order, supplier
  confirmation, procurement, or permission to apply the scenario. Supply
  remains constrained until Inventory records and refreshes the applicable
  physical evidence.
- A retained prior projection may remain visible below the answer while the
  active scenario recomputes, but it cannot supply current supplier, Staffing,
  commercial-value, or BEO claims. The decision answer is replaced with a
  **Current answer withheld** state, and its Inventory or Staffing actions are
  withheld until the exact active scenario result returns.
- A current exact Staffing response with no plan is not missing evidence. It
  means zero operator-confirmed assignments: People shows `0 / required` and
  the resulting gap, or **Not required** when every role requirement is zero.
  QuotePilot does not synthesize a staffing plan revision, assignment, or
  receipt to express that empty result. When the connected event workspace is
  available, **Review staffing in event** hands off to the exact quote record;
  refreshing remains available when People evidence is stale or unavailable.
- Proposed People coverage is a comparison, not a confirmed proposed staffing
  plan. Exact backup capacity additionally needs complete operator-recorded
  availability and conflict-clear schedule evidence. The current staffing read
  does not expose that combined conflict-clear set, so **Resilience** remains
  unknown instead of counting apparently available profiles.
- Numeric **People headroom** is available only from a complete, current,
  versioned operator-declared staffing-requirement policy that matches the
  active role requirements. The presentation-only mock-catalog `STAFF_RULES`
  never qualifies. **Supply headroom** likewise requires a separate exact,
  current, revision-bound inventory boundary whose scope, projection digest,
  and source fingerprint match the displayed Supply comparison; it is not
  inferred from the shortage table. **Overall headroom** appears only when both
  are exact and is the smaller safe increase; otherwise the overall state is
  **Partial**.
- Headroom distinguishes the safe inclusive range from the next changed step.
  For example, from 125 guests, `safe through 167` means **+42 safe guests**;
  the staffing requirement changes at 168, which is **43 guests away**. Kitchen
  BEO review remains graph-supported only, without inventing artifact
  currentness or regeneration.
- When Supply exposes an exact first constraint, select it to read the declared
  demand, shortage, and boundary explanation. If a separately revision-bound
  inventory boundary supplies an inclusive safe-through count, **Try N guests**
  changes only the active temporary scenario and runs the comparison again.
  The first failing count is stated separately. Without exact boundary evidence,
  no corrective count is invented. Without the separate current sourcing
  preview and declared selection policy, no substitution, supplier, procurement
  step, or recommendation is invented.
- Experimentation remains fully reversible because it is not committed.
  **Review for commitment** is the intentional handoff to the existing governed
  amendment review; it is unavailable until the active scenario has exact
  current evidence. It does not apply the scenario. The trusted review and
  subsequent outcome-named save retain their existing authorization, revision,
  repricing, persistence, receipt, and recovery checks. QuotePilot does not
  label an alternative “best” without an explicit objective function.
- **Preview consequences** is read-only. The primary presentation groups exact
  returned graph evidence into commercial/payment, staffing,
  production/rentals, event operations, customer/documents, and related
  workflow meaning. Exact graph, revision, authority, and before/after evidence
  remains available under disclosure.
- **Preserved truth** includes only recorded acceptance, provider-confirmed
  deposit, booking/contract, or provider-accepted delivery evidence. Missing
  evidence remains missing; provider session IDs, portal keys, and customer
  contact data are not copied into this projection.
- Every connected save requires a current simulation. Dormant or enforced
  no-impact review uses **Apply reviewed change**; an authorization-required
  change uses the existing request/authorization and **Apply authorized
  change**. Dormant application creates the governed revision but does not claim
  that dependency invalidations were persisted.
- Success remains on the amendment surface and focuses a receipt with
  **Changed**, **Preserved**, **Needs attention**, and **Next**. **Review updated
  quote** opens the authoritative record. An uncertain apply retains its
  original request identity and offers exact reconciliation; it never silently
  repeats the mutation.
- Accepted, booked, paid, declined, refunded, expired, and deleted commitments
  remain outside ordinary Quote Edit. A copied direct-edit URL stops before an
  editable form is hydrated. QP-UXR-001 does not weaken that lock or rewrite
  historical customer, payment, booking, or provider evidence.

### Living Opportunity attendance evidence (source only)

- Open **Guest count → See connections** to compare the exact **Saved priced
  count** with the best separate planning, final-count, applied, or actual-
  attendance evidence available on that quote. A legacy quote remains valid and
  says that separate attendance evidence is not recorded.
- An **Open decision** appears only from a recorded final-count request or a
  fresh exact-quote Decision Debt item. Loading, stale, failed, incomplete, or
  mismatched decision reads do not produce a due claim.
- When the exact Decision Debt item is available, **Review final-count task**
  opens that item in Workflow. Navigation does not confirm attendance, resolve
  the task, change pricing or staffing, resize quantities, reserve capacity,
  update the proposal or BEO, or save the quote.
- If a future attendance record is malformed, QuotePilot keeps the saved priced
  count visible and labels the added evidence **Attendance evidence needs
  review**. Do not treat the review state as a final or applied count.
- This is a source/local read presentation. QuotePilot does not yet persist new
  planning or confirmation envelopes through this surface, and hosted data and
  human acceptance remain separate.

### Living Opportunity guest-count pricing preview (source only)

- This Ambient host is present in source, not proven deployed or human-
  accepted. It appears only for `admin` or `sales` staff who also have ordinary
  quote-edit authority and whose selected quote has an exact package in the
  loaded tenant catalog. Missing role, edit permission, package, catalog, or
  pricing settings fails closed instead of offering a price action.
- Stage a reversible guest-count scenario, open `Inspect pricing`, then select
  `Price [guest count] guests`. A local-source quote receives a deterministic,
  advisory client `ImpactPreview` with no server receipt. A Firebase-source
  quote uses the existing governed Commercial Change simulation client and may
  return an immutable server simulation receipt. QuotePilot labels those two
  sources distinctly; neither one is authorization or evidence of a saved
  quote.
- The preview reads the staged guest-count change but does not mutate the saved
  quote. `Stage scenario in editor` is an explicit handoff to the priced edit
  flow, where the existing trusted save must reprice authoritatively and handle
  revision conflicts. The Ambient preview itself cannot save, authorize, apply,
  send, accept, book, charge, or pay.
- If a connected response is transport-uncertain, keep the exact tenant,
  quote, base revision, and retained request identity together. Use the same
  pricing action to reconcile that exact request before starting another
  simulation; local fallback rejects a pending server request. A definitive
  error leaves the saved quote and reversible scenario unchanged and offers
  contextual recovery without inventing a receipt.

- In a trusted quote edit, select `Review Change Impact` after changing event,
  customer, selection, pricing-input, or other governed fields. QuotePilot
  reloads the exact active revision, reprices the proposed form on the server,
  and shows before/proposed values, total/deposit deltas, and affected graph
  nodes. Simulation does not save the quote.
- `Authority dormant` means source is present but ordinary trusted save remains
  authoritative because both the release-controlled server gate and trusted
  tenant gate have not been promoted. A no-impact result also stays on the
  normal trusted save path. Neither state is authorization to promote a gate.
- When enforcement is active and governed impact exists, sales staff select
  `Request authorization`; tenant administrators may select `Authorize exact
  change`. Authorization binds the exact simulation, active revision, proposed
  digest, catalog authority, policy, expiry, tenant, quote, and actor. Any drift
  requires a new simulation.
- Select `Apply authorized change` only for the exact current authorization.
  One trusted transaction writes the canonical quote, immutable version, apply
  receipt, dependency state, and named invalidations. It does not regenerate,
  reconcile, publish, deliver, accept, book, charge, pay, or complete anything.
- `Submitting` means do not repeat the action. `Outcome uncertain` is not a
  saved quote. Select `Reconcile exact outcome` to retain the original apply
  identity: QuotePilot either validates its deterministic apply receipt and
  immutable target version, or records a `not committed` receipt that fences
  the timed-out request from committing later. Only then may you open the
  committed quote or start a fresh simulation. If the active source changed,
  open the authoritative quote before further editing. A second transport
  ambiguity keeps the same reconciliation identity and never resubmits the
  quote edit.

## Commercial Dependency State and reconciliation

- Open the authoritative quote record and review `Commercial Dependency
  State`. The bounded staff projection names the apply receipt/source revision,
  unresolved and resolved nodes, source/time, and derived publication
  eligibility. A missing receipt is `NOT_GENERATED`; incomplete or unsupported
  authority is `UNKNOWN`, never current.
- Select only the exact open invalidations you intend to reconcile. Choose the
  allowed resolution for that node kind and provide the required staff note for
  decision/output evidence. QuotePilot rejects stale, cross-quote, already-
  resolved, unsupported, or over-broad requests.
- An uncertain reconciliation keeps the same request identity; use `Reconcile
  exact request` instead of submitting another. A receipt confirms only the
  named dependency resolutions. Prior apply, invalidation, artifact, and
  reconciliation receipts remain immutable.
- `Safe to publish` is deterministic eligibility when no governed dependency
  remains unresolved. It does not publish a proposal, Kitchen BEO, portal
  revision, payment request, provider message, or any other artifact.

## Decision Debt and policy controls

- Open `Workflow` and select the Decision Debt view. It appears only from
  server-owned unresolved dependency state; an empty result does not infer that
  every operational task or customer decision is complete.
- Quote-level Decision Debt checks require the tenant's valid IANA business time
  zone. When it is missing or invalid, QuotePilot keeps the read local and points
  an administrator to `Library` → `Pricing`; retry after saving and publishing
  that configuration. The blocked read does not alter the quote or dependency.
- Each item shows the exact quote/source revision, event and lock dates, and
  affected dependencies. When authoritative commercial exposure exists, it also
  shows a bounded 0–100 score and the deterministic factors: dependency weight
  × event proximity × commercial-exposure factor × reversibility. When that
  exposure is unavailable, the UI says `Priority unknown` and leaves exposure,
  raw score, normalized score, and urgency unset instead of guessing a factor or
  coercing missing authority to zero.
  Decision Debt is priority, not predictive AI, likelihood, a receivable,
  recovered revenue, or accounting revenue.
- Any same-tenant staff member may review priority and open the exact quote.
  Tenant administrators alone may edit the versioned lock-window policy beside
  the snapshot. Keeping the policy at the point of use makes the current bounds
  and effect discoverable; changing it does not resolve a dependency or change
  a quote.
- Admin policy changes use an exact expected version and receipt. Reconcile an
  uncertain request unchanged; reset a definitive rejection before preparing a
  corrected policy.

## Revenue Autopilot operations

- Open `Workflow` and select Revenue Autopilot. The read-only quote preview and
  the persisted operations surface are deliberately separate. Operations reads
  at most 100 private job projections and 50 unread-reply Attention projections
  and shows source, capture time, bounds/truncation, policy, and provider
  outcomes. The Attention bound contains only currently open unread customer-
  reply records; resolved history remains private and the independent job-history
  bound is unchanged. A failed refresh retains prior evidence only as stale.
- Review the four visible activation families—release/runtime, tenant policy,
  outbound sends, and email provider—plus each lane. Runtime enablement and
  outbound-send enablement remain independent default-off release gates. A
  configured policy, prepared job, or locally passing test does not imply that
  either gate, provider, scheduler, or production delivery is active.
- The five lanes are Quote follow-up, Deposit reminder, Final-balance reminder,
  Post-event review request, and Unread customer reply. The first four are
  email; unread reply creates internal Attention only. Quote reminders stop on
  exact current view/accept/decline or terminal quote evidence. Deposit and
  final-balance stops require their exact authoritative acceptance/payment
  rail; browser returns or local payment labels are insufficient.
- Tenant administrators may select `Configure policy` to record tenant intent,
  IANA time zone, quiet hours, one-to-five bounded attempts, lane switches,
  quote/deposit offsets, the fixed event-minus-14/7/3 final-balance cadence,
  and post-event review destination. This form cannot enable the external
  runtime/send gates or provider.
- Staff may select one authoritative quote and `Prepare governed records` only
  when the current bounded operations read permits it. The server reloads
  canonical evidence and creates, updates, blocks, or stops stable occurrences.
  The receipt shows bounded new/updated counts and one outcome for each email
  lane. When outbound sends or the provider are off, eligible records may still
  be prepared and appear as `Preparation only`; dispatch remains disabled. A
  materialization receipt does not prove scheduling execution or a send.
- Job states remain distinct: scheduled, dispatch lease, bounded retry,
  ambiguous outcome, provider accepted, delivered, bounced, complained,
  stopped, and definite failure. `Provider accepted` is not delivery; delivery
  is not portal view. Reconcile an ambiguous job with its exact frozen provider
  identity rather than creating a replacement. Reconciliation reloads current
  quote, stop, customer-control, tenant, send-gate, and provider authority before
  any provider retry. If authority is no longer clear, the retry is withheld and
  the original ambiguous/provider evidence remains visible instead of becoming
  a false stopped or failed outcome. Workflow labels that receipt `Dispatch
  withheld` and states that no provider acceptance or delivery was established;
  a true provider-accepted receipt is labeled separately and still does not
  establish delivery, customer viewing, payment, or recovered revenue.
- An unread customer reply becomes Attention only for the exact latest
  quote-scoped customer message. `Open conversation` and `Acknowledge exact
  reply` are separate actions. Acknowledgement records an internal receipt; it
  does not prove that staff read or answered the message content. A newer
  customer message supersedes the older open item, a staff reply resolves the
  prior item, and the bounded scheduler repairs an exact latest-message item
  that was missed while the lane was unavailable. Message histories remain in
  their quote conversations.
- Customer 360 shows `Customer email controls`. Any staff member may review the
  safe consent/subscription projection; only tenant administrators may record
  exact customer-specific evidence. Consent and subscription are separate.
  Revoked consent cannot remain subscribed. Recording controls schedules or
  sends nothing and proves no delivery, view, payment, or revenue.

### Post-event review requests

- This lane is independently dormant until an admin enables it, its strict
  tenant template exists, and a valid public HTTPS review destination is saved.
  Local/private/internal URLs, credentials, fragments, and nonstandard ports
  are rejected. The destination is a link target, not review evidence.
- One occurrence may be materialized only from the exact accepted proposal
  revision, stable customer, private acceptance evidence, and private post-event
  closeout that remains `completed`. Portal expiry alone does not invalidate
  this post-event message, but a pending, configuration-blocked, invalid, or
  reopened closeout blocks or stops it and prevents stale rematerialization.
- The email may include a tenant-branded thank-you/review request and the
  configured review link. A job, provider acceptance, delivery, or link click
  does not prove that a public review was posted, a lead was created, an event
  was rebooked, payment was received, or revenue was recovered.

### Customer unsubscribe

- Governed emails include an opaque unsubscribe link. On any non-portal path,
  `?unsubscribe=<token>` opens Email preferences; `?portal=<token>` always has
  precedence so this route cannot replace the customer decision center.
- Review the organization label and current reminder state, then select `Stop
  automated reminders`. A valid current token records one idempotent server
  receipt and changes only email subscription eligibility. It does not cancel
  a quote/event, change proposal acceptance, alter payment, or delete messages.
- If the result is uncertain, reconcile the exact request; do not start a
  second unsubscribe attempt. V1 opt-out links intentionally do not expire; an
  invalid signature/scope or token that does not match the stored customer
  controls fails
  without revealing the customer email, quote, message, provider identity,
  token hash, or other private data.

## Reporting Dashboard
- Open `Reporting` or `/app/reporting` to review quote pipeline, conversion,
  accepted/booked quote value, and the separately verified paid-deposit total.
  These operational values are not accounting revenue.
- Start with `Evidence and scope`. Reporting reads at most 500 same-tenant quote
  records and shows the source, last complete client read, displayed-record
  count, and whether the result is current, empty, partial, truncated, retained
  stale, or unavailable. `Refresh snapshot` or `Retry read` requests a new
  bounded read; a failed refresh leaves a prior completed snapshot visibly stale
  instead of presenting it as current.
- Every money total and rate names its displayed-record denominator. A missing
  amount is excluded from its affected total and reported as unavailable; it is
  never silently converted to zero. A truncated 500-record result is not a
  tenant-wide or lifetime total.
- Accepted/booked quote value comes from recorded lifecycle states. The
  `Verified Paid-Deposit Total` is narrower: the read must be exclusively
  Firebase-backed, and each included record must have the paid deposit state, a
  valid provider-confirmation timestamp, and a recorded deposit amount. Local,
  unconfirmed-source, missing-timestamp, or missing-amount evidence remains
  excluded and visibly partial. Neither measure is cash reconciliation or
  recognized revenue.
- The six-month commercial trend uses UTC calendar-month boundaries and only
  the displayed records. Read its quote count, sent/viewed/accepted/booked count,
  accepted/booked denominator, and known/missing value coverage together.
- `Quote wizard funnel` shows anonymous staff sessions that reached each step
  and the share that saved a draft during the last 30 days. A session is not a
  customer or unique person count.
- `Add-on selection trends` counts selection and removal actions by the current
  catalog name. These analytics do not store customer names, emails, quote
  values, or proposal content.
- `Ambient interaction health` is a source-only extension of the same bounded
  server summary. It reports a primary-action dead-click rate only when the
  client recorded an exact 250ms acknowledgement assessment. `First intent →
  priced draft` pairs the first staff-session intent only with the first exact
  server-authoritative Firebase saved-draft receipt; local previews and local
  saves do not qualify. `Issue surfaced → resolved` pairs only the same bounded
  issue category in the same staff session. These are client observations, not
  server timing telemetry or proof that the user understood the experience.
  Local fallback and zero-sample windows show `Not available` rather than a
  manufactured zero.
- Ambient metric events exclude quote and customer identifiers, message and
  proposal content, and free text. The accepted issue labels are bounded
  Workflow, Staffing, and proposal-gap categories; a dismissed, displaced,
  unknown, or cross-session issue is not silently counted as resolved.
- Analytics delivery is non-blocking. If its server summary is unavailable,
  quote creation continues and the dashboard still loads its quote metrics.

## Operations Audit
- Organization admins can open `Integrations` or `/app/integrations` and use
  `Operations Audit` to
  review quote-delivery retry candidates, outcomes requiring provider review,
  and the last seven days of recorded integration success/error activity.
- The role totals reflect current authoritative admin and sales assignments.
  Receipt-backed rows cover final quote-approval executions, organization role
  changes, and controlled Resend acceptance tests. They are server-owned,
  role-stamped, tenant-filtered, and replay-stable. The table never includes
  principal UIDs, Resend provider message IDs, App Check identity, recent-auth
  timestamps, or raw receipt fields.
- Delivery reconciliation and catalog pricing confirmation remain labeled
  `server_projection` legacy observations rather than immutable receipts. A
  provider-derived outcome still requires its own provider evidence.
- The server samples at most 500 quotes and 200 each of approval executions,
  role records, role-authority receipts, and Resend acceptance receipts, then
  returns at most 50 action rows. The surface reports a partial state when a
  source sample reaches its bound.
- Browsers cannot export or clear the security receipt history. Role-authority
  receipts are indefinite server records; no receipt-clear workflow is
  implemented in this source candidate.
- A `Retry available` count is a work queue, not evidence that QuotePilot sent
  or resent a message. Check the quote's exact delivery state before acting.
- Integration success/error trends summarize operator-recorded audit entries
  until a server-authorized connector is enabled; they do not prove that a CRM
  or accounting provider accepted or applied a change.

## Email Provider Acceptance Test

- This control appears in `Integrations` or `/app/integrations` only for a
  verified platform administrator. An ordinary organization administrator can
  review provider status but cannot see or call this production test surface.
- Select **Check Setup** first. The panel must report provider `resend` and
  approved sender `configured`; no API key or secret value is shown.
- Enter an inbox you control on the exact `quietpilot.us` domain. Then type the
  displayed confirmation exactly, for example
  `SEND RESEND TEST TO flightcontrol@quietpilot.us`.
- Select **Send controlled test** once. QuotePilot creates one private durable
  receipt before contacting Resend and binds the request to a stable provider
  idempotency key. The subject and body are server-owned and contain no customer
  or quote data.
- A successful result shows `provider accepted`, the recipient, acceptance
  time, and the provider message ID. The controls lock so the same request
  cannot be sent again. Operations Audit records the action but deliberately
  omits the provider message ID.
- If the outcome is uncertain, do not retry. Use **Review durable record** to
  refresh Operations Audit and investigate the original provider request. A
  definite pre-acceptance rejection may offer a fresh-request recovery path.
- `Provider accepted` proves only that Resend accepted the API request. Record
  the matching Resend `delivered` event and confirm the message in the named
  inbox before describing delivery as complete. None of these facts alone
  proves ordinary customer-email readiness or human acceptance.

## Owner SMS Provider

- Organization admins can open `Integrations` or `/app/integrations` and review
  `SMS provider choice & delivery evidence`. The panel reports the
  deployment-owned choice (`None`, `Twilio`, or `Pingram`), non-secret runtime
  field completeness, and recorded provider evidence. Runtime-field
  completeness never proves that a bound credential exists; credential
  presence is deliberately reported as unknown until provider evidence exists.
  The panel never displays credentials, full phone numbers, or private provider
  identifiers, and the browser cannot change the selected provider.
- Current production remains `None`. The Pingram option exists in source but
  has not been deployed, registered with the provider, used for a provider
  request, or used to send a live SMS.
- Owner SMS is one-way and limited to the existing owner-alert events plus an
  admin-controlled setup diagnostic. It does not text customers or create a
  two-way messaging inbox. Signed subscribe/inbound callbacks are quarantined;
  any signed unsubscribe or exact inbound `STOP` signal creates an indefinite
  v1 hold on all owner SMS sends across provider selection. There is no browser
  or callable clear path; operator review or renewed consent does not resume
  sending in this version. The destination is a
  server-owned E.164 owner number and sends remain unavailable without explicit
  recorded consent.
- When a provider is later promoted, choose `Refresh SMS Status` before a test.
  `Send Test SMS` is available only when local non-secret configuration permits
  a controlled diagnostic attempt. The provider worker still verifies its
  bound secret and fails closed before sending when that secret is unavailable.
  Automatic Pingram alerts remain blocked until that exact configuration
  generation receives a signed delivered diagnostic. A queued, submitting,
  provider-accepted, or uncertain state identifies the exact original attempt;
  the browser and server both prevent a second test while it is unresolved.
- `Request accepted` means only that the provider accepted the send request. It
  is not carrier delivery or recipient receipt. For Pingram, only a verified
  signed webhook receipt can establish `delivered` or `failed`; reconciliation
  only reloads that original server evidence.
- If the result is indeterminate, it is unsafe to retry automatically. Use
  `Refresh Recorded Evidence` to reload the same attempt and signed-webhook
  receipts; this does not query the provider or create a second send. A
  definitive rejection may enter recovery only after the recorded outcome
  makes a fresh request safe.
- QuotePilot keeps the transactional outbox command, attempt, provider-message
  binding, rate limit, recipient fingerprint, readiness/opt-out controls, and
  webhook inbox receipt in server-only records. Early signed callbacks remain
  pending until their provider binding exists, then reprocess without requiring
  another provider send. Recipient fingerprints are versioned, organization-
  scoped HMACs so the same destination is not linkable across tenant records.
  The admin panel exposes only the operational outcome needed to decide whether
  to wait, reconcile, or recover.
- Pingram promotion is an operator task, not an in-app toggle. It requires the
  approved regional endpoint, a new `PINGRAM_CONFIGURATION_GENERATION`, Secret
  Manager credentials, approved sender/A2P
  state, explicit owner consent, registered signed webhook, governed
  deployment, and a controlled hosted UAT. Until those gates pass, leave SMS
  disabled.

## Event Schedule and Production Checklist
- Open **Operations** or `/app/operations` to review accepted and booked events
  by month or week, inspect derived conflicts, and assign a staff lead. Month
  keeps the full calendar above its selected-event workspace. Week uses real
  start and duration geometry across seven day columns, with collision lanes
  and a secondary detail rail. Operational sections remain collapsed until you
  open the one needed.
  `/app/schedule` is a compatibility path to the same Calendar. Quote/proposal
  lifecycle and booking confirmation are separately labeled; an accepted quote
  with confirmation pending is not displayed as a confirmed booking.
- Do not look for a **Mark as resolved** control. Overlap and capacity findings
  clear only after the affected Opportunity's authoritative date, time,
  duration, venue, guest count, or lifecycle changes and Calendar recomputes.
  Use the conflict comparison to open the exact related record.
- Each event includes a persistent production checklist covering event brief, guest count, dietary review, menu prep, equipment planning, staffing, pack-out, setup, service handoff, and closeout.
- Checklist completion is an operational task record only. Even when Inventory
  is enabled, checklist state does not confirm stock, allocation, menu-cost
  completeness, consumption, or item availability; those require exact current
  Inventory evidence.
- `Run of show` is a bounded, read-only sequence for the selected date. It
  includes only accepted or booked records from the current Schedule read,
  labels the source and result bounds, and exposes the recorded timing basis or
  exact unknowns for each expanded event. It does not establish payment,
  staffing attendance, inventory availability, or operational readiness. A
  failed refresh leaves the prior projection visibly stale; use `Retry run of
  show` to request a new tenant-scoped Schedule read.

## Trusted Kitchen BEO generation and artifact freshness

- From the authoritative quote record, open `Kitchen BEO authority`. The status
  read reloads canonical same-tenant quote data and private generation/
  invalidation evidence. It reports exactly one of `CURRENT`, `STALE`, `REVIEW`,
  `NOT_GENERATED`, or `UNKNOWN`; color never carries the state alone.
- `CURRENT` requires the current-artifact pointer to resolve to the exact
  immutable successful server receipt, strict base64 and exact stored byte
  length/SHA-256 validation of its retained PDF, the current canonical revision
  and declared-input fingerprint to match, and no qualifying open Kitchen BEO
  invalidation. `STALE` means a prior valid receipt
  exists but revision/fingerprint or named invalidation evidence no longer
  matches. `REVIEW` means a governed decision still needs reconciliation.
  `NOT_GENERATED` means no receipt exists; `UNKNOWN` means authority is missing,
  unsupported, corrupt, cross-scope, or unreadable.
- Select `Generate Kitchen BEO` only after reviewing the source. The server
  rereads and rechecks the canonical quote, builds the declared payload and
  fingerprint, generates exact PDF bytes, and binds tenant, quote, revision,
  graph/input/canonical schemas, actor, server time, digest, byte hash/size, and
  receipt identity. Browser-supplied digest, payload, actor, time, and bytes are
  never receipt truth. Idempotent replay and the final response revalidate the
  retained bytes before returning the immutable receipt.
- A successful fresh generation may resolve only the qualifying named Kitchen
  BEO invalidations in that trusted flow. It does not resolve staffing, rental,
  food, production, contract, payment, portal, or other decision evidence.
- Downloading uses retained server bytes. `Download current receipt` gets the
  active receipt; a listed prior receipt can be downloaded by its exact
  immutable receipt ID without regenerating from today's quote. A browser
  download failure does not erase or invalidate the trusted server receipt.
- `Submitting` means do not start a duplicate. An uncertain outcome retains the
  exact request for reconciliation; a definitive rejection can be reset before
  a corrected attempt. Refresh status after any generation or dependency
  reconciliation.
- The PDF still includes event/day-of contacts, staffing, checkpoints, menu,
  dietary/allergen callouts, checklist, prepared-by and chef sign-off lines,
  and ruled notes. A current receipt proves declared-input equivalence only—it
  does not prove kitchen review, inventory, handwritten sign-off, publication,
  customer acceptance, booking, payment, provider delivery, or operational
  completion. Use the proposal/token portal for customer commercial review.

## Admin Catalog Operations
- Open **Library** or `/app/catalog`. Administrators retain edit, draft, check,
  and publication authority. Sales staff can inspect the same commercial
  inventory and readiness in a read-only state. Contextual catalog setup from
  the quote builder may still open the guarded dialog wrapper.
- The first Library view presents **Offers**, **Components**, **Templates**, and
  **Pricing & Rules** as the primary commercial ledger. Setup readiness remains
  secondary and exposes one ranked unresolved action to administrators. Sales
  sees one statement that an administrator manages changes and publishing,
  rather than a field of disabled controls. This presentation adds no catalog
  read, save, pricing, rule, or role authority.
- The right readiness rail uses icons only as supplemental cues; its text names
  every state and action. Ordinary Library text remains at least 12px. A save or
  read failure exposes one owning **Save** or **Try again** action rather than
  duplicate recovery controls.
- Library recommends one next useful setup step from the evidence it has. If
  the complete event-specific menu inventory was not part of that read, **Open
  menus** means to inspect the existing menu records; it does not mean the menu
  is empty or that a saved template reference is broken. Saved references are
  preserved until an admin compares them with the current menu; the editor does
  not claim that partial inventory was validated. Browser-local records are
  isolated to the active organization, say **Catalog saved in this browser**,
  and are not proof of the organization's server catalog, current pricing
  authority, or operational availability.
- Select a Catalog row or exact Quote starting point to open that object in the
  existing editor. QuotePilot acknowledges the click before the editor mounts,
  focuses the requested tab or template, and never substitutes another record.
  Ordinary movement to Now, Opportunities, Clients, or another staff surface
  keeps an unsaved Library draft mounted so returning restores the exact work.
  Browser unload, customer-portal, and sign-out transitions remain guarded.
  **Back to Library**, direct browser Back, and browser Forward use the same
  busy/dirty guard. Declining discard preserves the exact editor, history
  entry, and draft; accepting removes only the transient draft and continues
  the original traversal. A later Forward opens the exact editor from current
  persisted data, not the discarded values. Return focus goes to the exact
  initiating Library control when it still exists and to Library's canonical
  heading only when it does not. If newer catalog
  evidence arrives, the editor preserves the draft and requires an explicit
  refresh/reconciliation choice before saving. A customer-portal route does not
  remount the workspace under that portal token until this draft guard accepts
  the transition. Opening a portal link directly still takes precedence, and
  changing from one portal token to another keeps the two public scopes separate.
- Switching tabs inside the embedded editor updates the Library breadcrumb and
  title to the active business object without remounting the editor or losing
  staged work.
- A blank organization starts on one guided **Setup** screen with four clearly
  described setup options. Empty Offers, Addons, Rentals, Menu, and Pricing
  tabs stay hidden until an option is applied or the administrator explicitly
  chooses **Set up Library manually**.
- Use tabbed sections:
  - Setup
  - Offers
  - Addons
  - Rentals
  - Menu
  - Templates
  - Rules
  - Pricing
- In `Offers`, the summary retains selling price, quoting availability,
  inclusions, derived margin, and the next decision. Detailed economics remain
  under Pricing. Existing recorded choice groups are inspectable but read-only;
  this browser does not author them.
- In `Addons` and `Rentals`, each commercial object leads with name, sell basis,
  price, and availability. **Usage** visibly derives its Offer and Template
  relationships; stable identity stays under **Technical details**. Menu keeps
  its existing managed editor and device-buffer behavior.
- In `Templates`, add or update reusable quote starting points. Starting points
  expand independently, and identity/completeness remain visible while their
  groups are collapsed. The group order is **Starting Offer**, **Event context**,
  **Preselected components**, **Service and rental defaults**, **Staffing and
  resource defaults**, **Pricing and policy defaults**, **What remains open**,
  and **Advanced identity and source**. A starting point's stable ID does not
  change after creation. Record its event type, service style, hours, starting
  Offer, add-ons, rentals, and menu references. When the menu
  inventory is not fully loaded, saved menu references remain preserved and
  visibly awaiting catalog validation; they are not silently removed or
  classified as missing. Quote-starting-point edits remain staged until
  **Check draft before publishing** and **Publish catalog** complete against the
  current catalog revision.
- In `Rules`, use the structured **WHEN / THEN / WHY** editor first. Advanced
  rule source opens for invalid JSON or a rule that cannot be represented safely
  in structured controls; correcting it still uses the existing draft and
  publication path.
- In `Pricing`, readiness and consequence appear first. Normal settings are
  grouped as **Base pricing**, **Adjustments & context**, **Fees**, **Tax**, and
  **Deposit**. Cost/margin evidence, guided recommendations, integrations, and
  raw technical policy sources remain under **Advanced policy**.
- Menu management flow:
  1. Select an Event type.
  2. Select a Menu section.
  3. Search, add, or edit items in that exact context.
  4. Use selection controls for bulk availability or dependency-safe movement.
  5. Wait for the setup draft to synchronize.
  6. Check and publish the combined Library change once.
- Menu and other catalog edits use the same server-backed setup draft. Field
  blur and Enter may finish local editing, but neither activates pricing nor
  advances the catalog revision. A deliberately entered zero is preserved;
  invalid, negative, non-finite, or over-bound money values are rejected.
- Creating or renaming an event type or menu section, and creating, updating,
  deactivating, moving, or deleting a menu item, preserves stable record IDs.
  Publication verifies the draft generation, active catalog revision,
  dependencies, and baselines before applying anything. Deactivation, movement,
  or deletion is rejected when it would break a package or quote starting point.
  If another session changes the catalog first, QuotePilot keeps recoverable
  staged work and reports a revision conflict instead of overwriting newer data.
- Menu item fields include:
  - Name
  - Price basis
  - Selling price
  - Cost
  - Availability
  - Menu section
- In `Offers`, QuotePilot opens the existing Package Workspace through a
  compact Offer navigator and one broad selected-Offer workspace. Use the Offer
  list to switch Package records without saving or discarding the current
  draft. The selected Offer leads with its customer-facing name, per-person
  price, quoting availability, included components, and one next action. Cost,
  contribution, margin, readiness evidence, immutable Package ID, catalog
  revision, pricing confirmation, and quote behavior remain available under
  secondary disclosures instead of a permanent health rail.
- Current inclusions appear before any candidate list. `Add menu items`,
  `Add add-ons`, and `Add rentals` reveal the searchable selector for that
  group only. Search or filter by menu section, select multiple records, then use
  `Apply` to stage that exact group or `Cancel` to leave the Offer unchanged.
  The menu event-type control narrows menu candidates for these add actions; it
  does not decide package eligibility or quote behavior.
- Turning **Available for quoting** on is blocked while deterministic Offer
  readiness is not Ready. QuotePilot names the first blocking reason; turning
  availability off remains a staged catalog change.
- **Revert this offer** restores the selected Package record to the last saved
  catalog snapshot only. **Offer actions** → **Delete offer...** first reports
  the event-template defaults and recommendation rules that reference the
  Package record; **Delete from draft** removes the Package and those references only after that
  review. Existing saved quotes are unchanged.
- Package inclusions still do not add themselves to a quote automatically. In
  the quote builder, covered choices remain `Included at no added charge —
  select to add`; unselected choices do not appear in the customer scope, and
  selected choices price at $0 instead of charging twice.
- The in-flow Offer workspace and Menu Builder stage into the same setup draft.
  **Check draft before publishing** and **Publish catalog** validate and activate the whole bounded change
  set, not only the currently selected package or menu section.
- In `Pricing` → `Proposal Details`, set `Business time zone` to a valid IANA value
  such as `America/Chicago`, then review and publish the catalog. Revenue timing uses this
  tenant-owned calendar context and fails closed when it is blank or invalid;
  the browser's local clock does not become Revenue Autopilot authority.
- In `Pricing` → `Proposal Details`, choose `Proposal font size`: Compact,
  Standard, or Large. This bounded setting is stored on future trusted quote
  create/edit snapshots and controls the Proposal Composer client preview and
  PDF export text scale. It does not change quote pricing or rewrite old PDFs.
- In `Pricing` → `Proposal Details`, set `Proposal intro title`, `Proposal
  intro message`, and `Proposal closing message` to tune how future proposals
  sound for your brand. These fields are snapped onto future trusted quote
  create/edit records, then appear in the Proposal Composer client preview,
  customer quote email, and PDF export. Updating the catalog later does not
  rewrite already-saved quote snapshots.
- In `Pricing` → `Your Customer-facing Brand`, choose Midnight Amber,
  Warm Linen, Garden Sage, or Coastal Blue. The preview changes immediately;
  use **Check draft before publishing** and then **Publish catalog** to persist
  the six existing brand colors for future quotes. Editing an individual color
  afterward is treated as a custom palette. A theme save uses the same catalog
  revision check as every other settings save and does not replace package,
  fee, tax, deposit, travel, or staffing values.
- Upload or clear the customer-facing logo in the same brand section. When no
  logo is defined, QuotePilot uses a monogram fallback in the admin preview,
  Proposal Composer, and PDF letterhead rather than inventing another image.
  Brand readiness calls out logo, business name, document font, and contact
  evidence before save.
- For a new blank tenant, open `Setup` and apply Wedding & events,
  Corporate drop-off, BBQ / Southern, or Church & community. This stages a
  complete draft immediately and opens the populated menu; there is no second
  save step for pack application. It does not unlock quote creation.
- Review package, add-on, rental, menu, travel, fee, tax, deposit, and staffing
  values. Suggested prices become active only after an admin checks pricing
  confirmation and saves. The server rechecks the complete catalog and the
  loaded catalog revision before recording who confirmed it and when. Quote
  creation remains locked unless that receipt includes the actor, exact ISO
  timestamp, and a confirmed revision equal to the current catalog revision.
  Missing, stale, or unattributed confirmation data is treated as unconfirmed.
- You may replace an untouched staged pack before confirmation. Once any
  generated record or suggested pricing setting is edited, replacement is
  blocked so the owner change cannot be overwritten; continue editing that
  catalog or remove the custom work manually instead.
- `Workspace Features` behavior depends on entitlement mode:
  - Standard mode: all module toggles are editable by admins.
  - Order-enforced mode: all module toggles are read-only; modules not paid for are locked off.
- In order-enforced mode each module row is labeled as either `Included in order (read only)` or `Not included in order (read only)`.
- To change what is included/locked, update entitlements through customer provisioning, then reopen `Admin Catalog`.

## Import Studio

Open **Imports** or `/app/imports`. Admin access is required. The destination is
locked to the signed-in admin's organization; a file cannot select or override
another tenant.

### Supported sources and records

- CSV files may be up to 5 MB and may contain Customers, Packages, Add-ons,
  Rentals, Event types, Menu sections, or Menu items. Comma, tab, semicolon, and
  pipe separators are detected. Duplicate headings and short rows remain
  visible for review. A row with values beyond its headings is blocked so those
  values cannot disappear during mapping.
- Searchable PDFs may be up to 12 MB and 80 pages and may contain only the six
  catalog record types: Packages, Add-ons, Rentals, Event types, Menu sections,
  or Menu items. QuotePilot reads the existing text layer and retains page and
  source-excerpt provenance. PDF extraction is heuristic: every inferred row,
  heading, price, and relationship must be reviewed.
- A single reviewed operation may contain at most 1,500 ready rows. Split a
  larger source into coherent sections so every inferred record remains
  inspectable.
- Package inclusion columns may name menu items, add-ons, or rentals. An
  inclusion is staged only when its ID or normalized name resolves uniquely in
  the current catalog; ambiguous and missing relationships are blockers. Each
  inclusion list is limited to 100 exact, non-duplicated record IDs.

The supported fields are deliberately narrower than an arbitrary source file:

- **Customers:** name, email, phone, company, and notes. At least name or email
  is required.
- **Packages:** name, positive price per person, optional cost per person,
  included menu items/add-ons/rentals, and active state.
- **Add-ons:** name, pricing basis, price, optional cost, and active state.
- **Rentals:** name, price, optional cost, a whole-number guests-per-unit ratio
  from 1 through 100,000, and active state.
- **Event types:** name and active state.
- **Menu sections:** name, exact event type, and active state.
- **Menu items:** name, exact event type and menu section, price, optional cost,
  pricing basis, and active state.

Money inputs accept no more than two decimal places and no amount above
`1000000.00`; package price per person must be greater than zero. Source columns
outside these fields—including catalog descriptions not supported by the
current catalog authority—are named under **Not imported as record fields**.
PDF page and excerpt columns remain visible provenance even when they are not
record fields.

Customer PDFs, image-only or scanned PDFs, password-protected PDFs, spreadsheets
other than CSV, and damaged or unsupported documents are not imported. Quotes,
opportunities/bookings, contracts, payments, messages, staff accounts, event
templates, and advanced pricing rules are also excluded. They must never be
represented as imported operational history. Export a searchable catalog PDF
or a CSV for the supported record type instead.

### The eight-stage workbench

1. **Choose source** accepts a CSV or searchable PDF, states the format and size
   boundary, and keeps the organization destination visible.
2. **Inspect source** reports the detected delimiter or PDF text method, row or
   page count, provenance, and any structural blocker before mapping begins.
3. **Confirm records** suggests one supported record type. Change it when the
   source means something else; PDFs never offer Customers.
4. **Map fields** suggests header matches without silently claiming certainty.
   One source column cannot drive multiple destination fields. For required
   relationships, zero choices show a blocker and recovery, one choice becomes
   static confirmed context, and many choices remain selectable.
5. **Resolve issues** shows every inferred source row with its row number or PDF
   page/excerpt and a scan-ready column for every mapped value, resolved stable
   ID, default, and field state. The review uses explicit 50-row pages with the
   visible range and Previous/Next controls, so every inferred row remains
   reachable; preflight still evaluates the exact included set across all
   pages. Invalid money, boolean, pricing-basis, required-field, duplicate, and
   relationship values stay blocked. Fix and reload the source, change its
   mapping, or explicitly uncheck a row. Blocked rows are never silently
   omitted, and every mapping, constant, or inclusion change makes an older
   preflight stale.
6. **Preflight plan** sends the exact included customer set to the tenant-bound
   server or checks the current shared catalog-draft generation and catalog
   revision. The resulting plan reports projected creates/skips or staged
   changes and must still match the exact source before Import becomes eligible.
7. **Authoritative import** asks for confirmation and states the destination,
   record count, expected effect, and that no messages will be sent. Controls
   that could change or discard the source are locked while the outcome is
   pending or uncertain.
8. **Review and publish** shows the authoritative receipt. Customer records are
   saved immediately. Catalog records are **Saved** into the shared setup draft
   and remain **Draft**—not **Published**—until an admin reviews and publishes
   that draft in Library. Use **Review catalog draft** for the exact handoff. If
   a replay proves that this exact request was already published, the workbench
   instead shows **Published**, links to **Review active catalog**, and offers no
   import undo; a later shared draft may contain unrelated work.

### Customer authority, batching, and recovery

The server owns customer IDs, normalized name/email directory keys, private
email claims, duplicate/collision decisions, actor receipts, and rollback
checks. Browser code cannot create those authoritative records directly. The
preflight records a tenant- and actor-bound server receipt that is valid for 15
minutes to begin and returns its SHA-256 plan hash; every transaction-sized
child request is bound to that issued receipt, full source, exact hash, and
child index. A correctly calculated but never-issued hash is rejected. The
server recomputes the binding before it writes. A child contains no more than
350 records and never exceeds Firestore's 500-write transaction budget; when
every row introduces a unique email claim, the safe ceiling is 249 rows. Stable
parent and child IDs make confirmed parts replay-safe when a later part needs
recovery.

The first accepted child receipt activates a 24-hour continuation window for
that exact session. Remaining children and exact replays may continue during
that window even after the original 15-minute issue window has elapsed. After
24 hours, the session cannot be extended: undo the confirmed subset or begin a
new import with a new server preflight.

Only `{ok: true}` child receipts with the expected batch identity, completed
state, plan hash, and child index count as success. If no acceptable receipt
returns, the workbench shows **Failed**, **Pending**, or a confirmed partial
result instead of manufacturing completion. A partial receipt names only the
accepted child batches and exposes both **Resume remaining import** and **Undo
this import**; the latter is limited to that confirmed subset. Retry or
reconcile the same stable identity rather than starting a blind second import.
Undo processes child receipts in reverse order and removes only unchanged
records stamped by the batch. Edited records are protected, and pre-existing
duplicates are never deleted.

Existing customer imports and their legacy receipts retain guarded rollback
compatibility. They do not acquire new normalized directory keys merely because
this workbench exists; any legacy-data normalization remains a separately
reviewed migration.

### Catalog draft authority and recovery

Catalog imports stage creates into the same shared setup draft used by Library.
Preflight SHA-256-binds the exact tenant, batch, included rows, generated
patches, draft generation, base catalog revision, current revision, change-count
limit, and conservative byte limit. An open draft based on an older active
revision is blocked before staging and must be reviewed, discarded, or
reconciled in Library. The active catalog, active prices, catalog
revision, and prior publication state do not change at import time. Review the
staged records, resolve any concurrent-draft conflict, and publish through the
existing catalog authority. The browser accepts a save receipt only when its
organization, base revision, expected and resulting generation, projected
change count, and complete patch identities and payloads match the reviewed
plan; a success-shaped but substituted response fails closed.

The server also keeps a tenant- and actor-bound mutation receipt for the exact
request ID and SHA-256-normalized patch set. Publication records the exact patch
hashes and resulting catalog revision under that draft's server-only session
lineage. This lets an exact replay after a lost response report **Staged** only
when the mutation remains in that open draft, or **Published** only when the
publication lineage matches and every requested field is still active. A
reused request ID, different actor or payload, missing lineage, or subsequently
changed active value fails closed instead of being presented as confirmation.

If another draft save or publication changes a generation or revision, the
workbench retains the same batch identity and waits for the requested catalog
read to finish before saying the source was refreshed. A read failure keeps
**Retry source refresh** available. After a successful read, run a fresh
preflight against the same source and identity; the workbench does not assume a
write. When the server definitively reports that the transaction was aborted,
the explicit **Release no-write attempt** action can unlock that rejected
identity after confirmation. This release does not claim that anything was
staged and does not discard the visible source.

Catalog Admin separately blocks menu deactivation or deletion while other
catalog, branding, menu-item, or menu-form drafts are pending. Finish, publish,
or discard those edits before retrying the revisioned action.

Saving or editing a quote continues to project its customer through the trusted
quote transaction. A matching normalized email is reused, and blank quote
fields do not erase richer imported phone, company, notes, or other details.
Browser code cannot write projected quote history.

## Public $1 Invoice-First Buyer Access

The current source includes a public Stripe test-invoice path on the existing
`tonicatering` Firebase project. It remains unavailable until a tagged release,
Turnstile, Stripe test credentials and webhook, Firebase verification delivery,
and guarded hosted release acceptance are complete. It is not an approved live
sales channel.

During an explicitly approved hosted test window:

1. Open `/start`. Enter the organization name, owner name, and the email that
   will receive and later claim the invoice. Complete the Turnstile challenge.
   QuotePilot does not collect a password or card details on this form.
2. Review the fixed Starter, $1 USD, Stripe test-mode disclosure. You cannot
   change the plan, price, currency, mode, or return URL. Continue to the true
   Stripe Hosted Invoice Page and pay there.
3. Return to QuotePilot. The return URL and invoice page are not access proof.
   `invoice_open` and `payment_processing` mean Stripe has not established paid
   state. `provisioning` may mean invoice preparation or that a signed
   `invoice.paid` event has prepared the organization, neutral settings, Starter
   workspace plan entitlements, provisioning record, and pending invite. It
   still means there is no user membership, admin role, custom claims, or
   `/app` access. When this status also says the workspace is ready, automatic
   polling stops and the page offers `/app` only for manual account setup. Use
   the exact invoice email to register or sign in, complete Firebase email
   verification through the authorized continue URL, and claim the invitation.
   Use `Check again` for a manual status refresh.
4. If the page reports `activation_sent`, the optional onboarding email provider
   accepted the exact activation-instructions message and QuotePilot durably
   recorded that acceptance. Acceptance does not prove delivery and is not
   required to start the manual verified-email path above. A different or
   unverified email receives no user role or access.
5. Open `/app` only after the order reports `active` and the server-confirmed
   Starter organization and admin role exist.

A safe retry with the same browser request should return the same Hosted Invoice
Page only while the invoice is open or payment-failed, and consumes another
network-rate attempt without charging the email window again. Do not start a
replacement while an invoice is open, payment-failed,
uncollectible/expired, paid, or activating. After 24 hours, only a provider-
verified `void` state permits a fresh request to supersede the old order. A
signed `invoice.voided` webhook establishes that state automatically. For an
uncollectible test Invoice, a platform administrator may open Customer
Provisioning or Integrations Ops and use Buyer Invoice Recovery with the exact
`ba-...` order id and generated
`VOID BUYER INVOICE <orderId>` confirmation. The server derives the Invoice
identity, verifies it with Stripe, permanently voids it, confirms no fulfillment
artifacts exist, and records the operator audit. Paid, open, partially paid,
fulfilled, superseded, or mismatched orders cannot use this recovery. When the
page reports `void`, use `Start a new test request`; the server still rejects it
until the 24-hour email window has elapsed. Do not bypass a rate limit with
additional emails or accounts.
Report only the approximate time and redacted order/invoice
references. Never send a payment method, hosted invoice URL, token, provider
secret, webhook signature, Turnstile response, or customer personal data.

This flow prepares real organization, neutral settings, Starter workspace plan
entitlements, provisioning, invitation, and audit records in `tonicatering`
after signed paid-invoice processing even though Stripe remains test mode. It
creates user membership, the admin role, custom claims, and application access
only after the exact-email verified invitation is consumed. Server-owned
controlled test-mode markers must be excluded from live revenue and live paid-
customer reporting. Deleting or refunding a Stripe test invoice does not prove
Firebase access was revoked or data was cleaned up.

Refunds, disputes, cancellations, account/access revocation, support,
tax/accounting, and live-mode selling remain separate operating gates. See the
[launch runbook](LAUNCH_RUNBOOK.md#public-1-invoice-first-buyer-access-on-tonicatering)
for the operator release and acceptance contract.

## Customer Onboarding (No Stripe Flow)
Use the admin provisioning workflow to create a customer organization, apply
paid module entitlements, and prepare owner access. Provisioning success is not
the same as completed owner onboarding or production acceptance.

Release status: this workflow is deployed from `v0.2.3`, but authenticated
disposable-tenant owner activation and hosted acceptance are still pending.
Use it for live tenant changes only through the documented platform-admin path,
and do not infer tenant usability from deployment or route reachability. See
[`PROJECT_STATUS.md`](../PROJECT_STATUS.md) for current operational truth.

Backend source of truth:
- Firebase Callable Function `provisionCustomerOrder` handles provisioning logic server-side.
- Firestore `provisioningOrders/{orderId}` stores onboarding status, feature entitlements, and email send outcome.

### Organization-owner authority

- New owner invitations are explicitly marked for organization ownership; a
  generic admin or sales invitation is role access only.
- After the invited person verifies the exact invited email and returns to the
  app, one server transaction binds that Firebase principal to the
  organization, consumes the invitation, and establishes the admin role.
- If the email, organization, role, existing owner, or invitation purpose does
  not match, owner binding fails closed. An older generic staff invitation is
  never upgraded into ownership by inference.
- The server records one immutable owner-binding receipt. That receipt and all
  direct role writes are private: browser users, including tenant admins, may
  not create, update, delete, or read the receipt. Use the existing
  provisioning and verified sign-in outcomes rather than editing Firestore
  role documents directly.
- A legacy organization without an explicit owner is not repaired through the
  browser. The operator-only backfill defaults to a no-write plan and accepts
  only one consumed admin invitation whose organization, order, verified Auth
  user, and existing admin role all agree. Zero, multiple, incomplete, or
  conflicting candidates remain `ownership_required`; apply additionally
  requires the exact planned UID and project/organization/UID confirmation.
  No production dry-run or apply is implied by the presence of this command.
- This source foundation does not create a Stripe connected account, complete
  hosted onboarding, enable charges or payouts, or prove production owner
  activation.

### Team access authority

Source/local status only: no hosted role change or production-data acceptance
is implied.

1. Sign in with a verified administrator account and open **Integrations Ops**.
2. In **Team access**, select an existing person or enter the exact verified
   email. QuotePilot shows the authoritative current role rather than guessing
   from the address.
3. Choose an outcome. The canonical organization owner may grant or remove
   Admin and Sales access. A non-owner admin may grant or remove Sales access
   only; owner rows and admin authority remain unavailable.
4. Select **Review this access change**. Before anything changes, review why
   the outcome is available, its consequence, what happens if you do nothing,
   and the exact-email/role-record confidence source.
5. If the current sign-in is older than five minutes, confirm identity with the
   account's password or Google sign-in. Unsupported providers fail closed;
   sign out and return through a supported provider rather than bypassing the
   proof.
6. Apply the outcome-named action. QuotePilot acknowledges the exact request
   immediately and returns its authoritative receipt. If transport is
   uncertain, use **Check exact change**: it replays the same request ID instead
   of creating a second mutation.

The callable rechecks the signed-in organization, actor authority, exact
verified target email, expected current role, and recent authentication before
writing. The immutable receipt is browser-private. The authoritative role is
committed before Firebase custom claims are synchronized; if that secondary
sync is interrupted, server access follows the role record and the exact
request can safely retry claim repair. Direct browser role and receipt writes
remain denied.

App verification is currently a source-wired monitor contract. The browser
integration is opt-in and uses an environment-specific public reCAPTCHA
Enterprise site key. Enforcement and consumed limited-use-token replay
protection must remain off until the staging application is registered,
monitoring evidence is reviewed, and the separate promotion is approved.
Neither this surface nor its receipt creates a Stripe connected account,
completes onboarding, or enables payment routing.

### Stripe connection availability (source only)

There is no Stripe connection control to operate in the app yet. The isolated
Connect package now contains dormant server contracts for a full Stripe
Dashboard account where Stripe collects fees and is responsible for negative
balances, and where payments will later be created directly for the connected
account. Those contracts include exact tenant/generation receipts, a one-use
same-tab hosted-onboarding handoff, transactionally enforced request limits,
and contextual recovery after an interrupted attempt.

The dormant edge contract also requires a short-lived, receipt-bound projection
of the organization's current enabled administrators and canonical owner; an
old identity-token role alone is insufficient. Account creation and live status
refresh are recorded as immutable digest-bound commands for a separately
leased worker, so the edge layer does not need the Stripe credential and exact
retries reuse the command-derived `qpcmd` value as the sole provider
idempotency identity. The repository's separate 30-day value is a recovery
deadline, not another provider key. The provider adapter must verify the exact
Sandbox platform account and mode before access, and it cannot report the
connection `ready` until both card payments and payouts are active. If provider
creation returns an identity but validation or current owner authority changes
before binding, that identity is retained only in private security-review
evidence and is not exposed as a connection. The owner handoff is bound to
current owner, authority, App Check application, revision, generation, request,
and payload evidence; it allows one active ten-minute attempt and rechecks those
bindings both before and after Stripe creates an Account Link, including its
local and provider expiry immediately before disclosure. Authority/state drift
records `provider_withheld`. A receipt-write interruption also exposes no
Stripe URL, but keeps the consumed attempt blocked until its local expiry
instead of claiming an uncommitted receipt. Both outcomes return only to
explicit recovery and never silently create another link.

The package still exports no endpoint, the tracked staging platform remains
unbound, and no browser action can instantiate the repository, limiter,
command bridge, worker, handoff, or provider adapter. App Check enforcement and
limited-use token consumption are not active. Do not interpret source tests, a
local success receipt, or the presence of these modules as a connected account,
Account Link, payment-routing readiness, Stripe provider acceptance, or
production availability.
The first operable surface remains blocked on applied isolated infrastructure,
App Check enforcement evidence, exact staging bindings, and a separate hosted
Sandbox release.

### Operator Runbook
1. Sign in at `/app` as an authorized platform admin on the canonical
   QuotePilot host with a verified Firebase email. Customer tenant admins
   cannot create tenants or change paid entitlements.
2. Open `Integrations Ops` → `Customer Provisioning (Admin)`.
3. For a new organization:
   - Leave `Update an existing organization` off.
   - Enter the customer organization and exact owner email.
   - Supply an owner UID only when it belongs to that same Firebase Auth user.
   - Use `Use My Account` only when intentionally assigning the signed-in
     operator as the customer owner.
   - Select an explicit plan and review the generated order id, read-only
     canonical app URL, and confirmation prompt.
   - Keep `Send onboarding email now` off for customer onboarding until the
     production custom-domain Resend sender is verified and delivery-tested.
     The prior `onboarding@resend.dev` check was an external, manual Resend
     dashboard sandbox test—not a deployable QuotePilot Functions
     configuration and not customer-ready sender-domain or inbox proof. The
     app provides copy-ready manual email text while the provider stays off.
4. Confirm the preflight result, then select `Provision Customer`. If the same
   order was interrupted, the exact matching request can resume only while its
   organization, settings, owner access, and catalog artifacts still match;
   changed or incomplete state is rejected without sending email.
   If an email dispatch lease is already active, wait for it to expire and retry
   the exact order rather than creating a second order to resend.
5. Review the returned organization, order, plan, email, and claims-sync state
   before sending access instructions.
6. A pending owner invitation expires after seven days. The owner must register
   or sign in with the exact invited address, verify that Firebase email, and
   then return to `/app`; organization bootstrap does not consume an unverified
   or expired invitation.
7. A new tenant starts with a blank catalog and neutral zero-valued fee, tax,
   deposit, travel, and staffing settings. Configure, import, or stage an
   industry starter pack before building or sharing a quote. The owner sees a
   catalog-setup screen, and the quote workspace stays locked until an admin
   reviews a specifically named package above $0, verifies at least one event
   type, and checks the pricing approval in `Admin Catalog` → `Pricing`.
8. Catalog save is conflict-safe: only locally changed records/settings are
   patched. If another session changed or deleted the same record, or reused a
   new record id, QuotePilot rejects the save and asks for a reload instead of
   overwriting the other change.

### Existing Organization Entitlement Update

Do not rerun the CLI or new-customer mode against an existing organization.

1. In `Customer Provisioning (Admin)`, explicitly select
   `Update an existing organization (plan entitlements only)`.
2. Enter the exact organization id, a new auditable order id, and the intended
   plan/feature selection.
3. Confirm the warning before applying the update.
4. Verify the resulting optional-module state in `Admin Catalog` → `Pricing` →
   `Workspace Features`.

This mode updates plan entitlements and the associated provisioning order only.
It does not change owner identity, branding, catalog records, invitations, or
onboarding email state.

### CLI Preview

The local `npm run customer:provision` path is preview-only. It prints the
proposed organization, explicit plan, entitlements, and onboarding copy but
does not write Firebase. `--apply` is intentionally rejected because the
legacy sequential write path cannot guarantee atomic tenant creation. Use the
in-app platform-admin workflow for all live changes.

Preview behavior:
- Requires explicit organization name/id, owner email, plan, and order id; it
  never derives a tenant or order identifier.
- Requires an explicit starter, growth, or enterprise plan.
- Shows paid/unpaid entitlement choices without changing provider state.
- Rejects unknown arguments, a noncanonical owner application URL, and
  `--apply`.
- Produces a `DRAFT - DO NOT SEND` handoff for review. `--email-out` creates a
  new file and refuses to overwrite an existing draft.

### Owner and Tenant Acceptance Checklist

Complete every item before calling the new tenant operational:

- Confirm the provisioning result and `provisioningOrders/{orderId}` status
  match the intended organization and plan.
- For direct owner assignment, confirm claims synchronization succeeded. For an
  email invitation, confirm the owner registers or signs in using the exact
  invited email, verifies that address before the seven-day invitation expiry,
  and the invitation is consumed only after verification.
- Confirm the owner reaches `/app`, sees the correct organization identity, and
  cannot access another organization's data.
- Confirm paid modules are available and unpaid modules remain locked.
- Confirm the initial pricing settings are neutral and unapproved, then
  configure or import the real customer catalog; provisioning intentionally
  creates no placeholder packages, add-ons, rentals, event types, tiers, or
  templates.
- Add at least one specifically named package above $0 and one event type,
  review every fee/tax/deposit/travel/staffing setting, and explicitly approve
  the pricing setup.
- Create a representative quote, save it, open it again from `Quote History`, and
  verify the organization-specific catalog and server-authoritative totals.
  The Firebase create path must return a server-generated quote number, portal
  token, and initial version; client-supplied totals, pricing, record/owner
  identities, and deposit links are not quote-creation authority. Direct
  Firestore quote creation must remain denied.
- Submit the representative quote from `Quote History`, confirm provider
  acceptance and current-issuance activation evidence are recorded for that
  exact revision, then copy the customer portal link and open it in a
  signed-out/private browser,
  complete a representative decision, and confirm the result appears in staff
  quote history. The public snapshot and organization quote must change in the
  same atomic commit, and accepted/declined outcomes cannot be flipped by a
  later portal request. Proposal acceptance remains separate from payment and
  booking.
- If onboarding email was enabled, confirm the Resend request was accepted, a
  provider delivery event exists, and the owner received it. Otherwise send the
  copy-ready onboarding message manually.

## Customer Portal
- Customers can open portal links and review event details, selected package/menu/add-ons/rentals, itemized pricing, total, deposit, and payment state. An eligible booked contract also shows its separate final-balance amount and provider-owned status.
- Customers with the exact current provider-accepted link can open the quote
  conversation, review staff messages, refresh, and send a reply. A failed send
  retains the draft and exposes `Retry message`; reusing that retry does not
  create a duplicate. QuotePilot supplies the sender name and time from trusted
  server context rather than accepting them from the browser. Declined quotes
  expose history as read-only.
- Portal responses support `Accept proposal`, `Ask for changes`, and `Decline proposal`; a change request requires a customer note. A pending proposal begins with no response selected and keeps notes, signature controls, and the final submit action hidden until the customer intentionally chooses one of those responses.
- To accept, the customer selects `Accept proposal`, types their full legal
  name, checks the electronic-signature statement, and chooses
  `Sign and accept proposal`.
  QuotePilot records the signer, server time, consent version, exact delivered
  proposal revision, receipt ID, and signed proposal hash. A stale or changed
  proposal must be reloaded before it can be signed.
- The decision feedback keeps each attempt explicit. `Recording your decision`
  means the operation is still submitting. If QuotePilot cannot determine the
  outcome, use `Check decision status`; it reloads the same portal and
  reconciles the same request identity, issuance, revision, and—when accepting—
  signer and consent rather than submitting a second decision. An exact receipt
  identifies whether electronic acceptance or another portal decision was
  recorded.
- `Review latest proposal` means the revision or portal issuance changed and the
  prior signature input was not applied to the newer proposal. A definitive
  `Decision not recorded` state offers only the safe retry or return action for
  that outcome. QuotePilot never auto-retries a decision. Missing legal name or
  consent returns keyboard focus to the exact invalid control, completed feedback
  is focusable, and decision animation honors the device's reduced-motion
  preference.
- Proposal acceptance is recorded separately from payment and booking
  confirmation. The receipt does not represent payment or a confirmed booking.
- Portal updates are reflected in staff quote history.
- After returning from Stripe, the portal may refresh its payment display while
  the signed webhook is processed. The return URL itself never proves payment;
  only server-observed provider state or admin reconciliation may update it.
- Accepted proposals persist through a server transaction to the public
  snapshot, organization quote, and immutable tenant receipt. Declines and
  change requests continue to update the matching quote and portal atomically.
  A terminal accepted or declined decision is immutable from the public portal.
- Portal tokens are time-bound and expire automatically.
- A portal is active only when its projection contains delivery evidence for
  the exact current valid issuance. Legacy projections without
  `deliveryEvidence` fail closed; recover them through an approved resend or
  truthful provider reconciliation, never by fabricating or backfilling
  acceptance evidence.
- Admins can use `Rotate Portal` on draft, sent, or viewed records to issue a
  fresh link and invalidate the old one. The replacement link remains
  unavailable until a provider accepts a separate send for that new issuance.
  An expired quote uses `Reopen`, which restores an eligible draft and creates a
  new issuance; terminal accepted, declined, or booked records are not reissued.

## Notifications and Confirmations
- Toast notifications are shown for save/update/delete and key operational actions.
- Workflow Attention is an in-app queue only. It does not send email or SMS and
  does not prove that a customer or staff member received a notification.
- Permanent quote deletion uses an explicit admin confirmation and
  callable-owned quote/version/portal cleanup.

## Client Change Requests (Structured Record)

When a customer uses "Request changes" on their proposal, their message is
tracked in Workflow and, with the pilot client-request panel enabled
(`VITE_PILOT_CHANGE_REQUESTS_ENABLED`), the quote editor shows the message
verbatim with deterministically parsed, stageable proposals.

After staging at least one proposal in a Firebase-backed workspace, use
`Record this review` to create an internal audit record. The record is
callable-only: the server verifies the exact stored request (id, submission
time, and message hash), attributes the acting staff member, and binds the
record to the quote revision at record time. Recording is create-only and
replay-stable — repeating the same review returns the same record.

The record is internal evidence only. It does not reply to the customer,
change the proposal or portal, or create a quote version; saving your edits
through the normal path remains the only way changes become a new version.
If recording fails, the staged draft is unchanged and the action can be
retried.

Once a record exists, saving the quote through the normal path — which
already fully completes on its own — triggers one best-effort follow-up:
the record links to the version that resulted, completing the audit trail
from the customer's message through to the saved version. Linking is
write-once (a record binds to exactly one version, ever), never blocks or
delays the save, and never surfaces its own failure; if it does not
succeed, the record simply stays one step short rather than pointing at
the wrong version.

## Pilot decision workspace

The production pilot groups seven staff-only build gates into one operating
experience:

- `Home` becomes NOW: bounded attention, next-seven-days, money, and staff
  evidence are restated as decision cards without adding new reads or outcomes.
- A quote's Event Workspace adds the proposal-completeness ring, advisory
  decide stack, and, for accepted/booked quotes, an evidence-bounded cascade
  receipt chain. `Unavailable` and pending steps are expected when the record
  does not support a stronger statement.
- Guided-selling suggestions use `Take it` decision cards. Taking one edits the
  draft only; saving remains the authoritative server reprice/version action.
- On `New quote`, describe the event in CREATE, review the details found and
  their confidence, confirm uncertain details, then add them to the editable
  form. Approximate/ranged guest counts show a draft-only price band; saved
  quotes always use the exact recorded guest count. A pristine route leads
  with this intake; the draft command bar appears only after draft work exists
  or when you explicitly open **Pilot**.
- The package and service style supplied as a starting point are labeled
  **Preset**, not complete. Experience becomes complete after you review both
  controls or after the draft has been saved. If known requirements remain,
  the save control reads **Review N blockers**. It opens Quote Pulse and moves
  keyboard focus to the exact list; it does not attempt a save. Resolve the
  named requirements, then use **Save draft** for the ordinary authoritative
  save checks.
- In an editable quote, the Pilot command bar previews a plain-language change
  and its fee/tax cascade before `Apply` stages it. Browser speech recognition
  may provide `Speak`; typed commands remain the availability floor.
- The live pricing rail shows Margin only when every selected revenue line has
  a tenant-recorded cost. `Margins unavailable` names missing inputs and is a
  safety state, not an error or an estimate. Margin never appears in the
  customer proposal.

These surfaces do not make an unsaved draft authoritative, send a customer
message, establish delivery/payment/booking, or replace the existing role
gates. Use the ordinary save, Workflow, quote administration, and provider
receipts for those actions and evidence.

### Ambient orientation, mobile remote, and exact arrivals (source only)

- With `VITE_AMBIENT_UI_ENABLED` explicitly enabled in a local build, use the
  lightweight **Now**, **Opportunities**, **Clients**, and role-safe **Library**
  entries to stay oriented. Search and New quote remain utilities. The same
  default-off staff shell now has one **Pilot** trigger grounded in the context
  already in view; it does not open a generic chat or appear in the customer
  decision room.
- When both `VITE_AMBIENT_UI_ENABLED` and `VITE_PILOT_NOW_ENABLED` are enabled,
  **Now** becomes an open briefing with no more than three priorities from the
  current bounded Workflow snapshot. The order comes from the existing
  deterministic Workflow evidence; NOW does not invent a blended score or
  re-rank it with a model. The headline names the strongest recorded condition,
  while **Needs you** distinguishes evidence-backed urgency from ordinary
  waiting without displaying a decorative `01/02/03` rank. Each row explains
  the supported consequence, opens its exact Workflow or Customer continuation,
  and first acknowledges what is opening and what remains unchanged.
- **Next 7 days** and **Coming up** are compact projections of the same recorded
  event dates used by Calendar. Use **Open in Calendar** to retain the exact
  event identity. They are not a second Calendar and do not infer staffing,
  readiness, conflicts, or live event state.
- **You are caught up** appears only when all expected staff reads completed,
  bounds are known and not truncated, the snapshot is current, and no recorded
  payment step remains in the same view. **Recently handled** names only recorded
  internal follow-up completion, request handling, or approval decisions.
  **Waiting on others** contains only recorded pending/provider payment states;
  staff-owned unpaid steps remain separately visible as **Commercial steps**.
  None of these labels means a customer was contacted, a provider delivered
  anything, or a payment was collected. Expand **Read details** whenever the
  compact freshness line reports stale, partial, unavailable, unknown, or
  bounded evidence.
- If the first **Now** read is unavailable, the briefing withholds priorities
  and caught-up language, hides raw provider text, and presents one **Try
  again** action plus **Start a quote**. No quote, customer, or Workflow record
  changes from either the failed read or retry request.
- Open **Opportunities** to use the default-off editorial stream over the
  existing tenant-scoped bounded quote read. Each opportunity shows identity
  and four separate views of where things stand: proposal completeness,
  pricing and margin, customer state, and event planning. Only proposal
  completeness may appear as a percentage; QuotePilot does not blend the four
  views into an event-readiness score.
- With QP-UXR-003, read each primary Opportunities row as **what**, **saved
  value and position**, **why it matters**, then **next action**. The saved total
  is the amount already recorded on the quote; the stream never reprices it.
  **Value unavailable** means no safe amount was present, while `$0.00` means
  zero was actually recorded. Lifecycle, proposal, booking, deposit, and final
  balance remain separate. Missing payment evidence is **not recorded**, not
  **unpaid**; timestamp-only or unrecognized status evidence is not promoted.
  Expand **Details** for the supporting momentum and provenance.
- Now priorities use the same saved-value and commercial-position projection
  without changing existing Workflow order. An exact Workflow continuation
  carries the quote and obligation. After a newly completed source read, return
  restores that action, the same quote's current action, or the source heading
  when the obligation is gone; it never substitutes another record. If the
  retained Workflow read fails to refresh, context remains readable but
  consequential controls stay unavailable.
- Required proposal completeness and recommended contact quality remain
  separate. A quote with every required proposal field can show **100%** while
  also naming **1 recommended contact detail**. A missing customer phone does
  not become a proposal gap, does not outrank staffing, and does not block the
  descriptive prepare/send model; trusted proposal controls still apply their
  independent saved-revision, pricing, email, portal, role, provider, and
  idempotency checks.
- If Opportunities cannot complete its first bounded read, it shows the same
  calm recovery grammar as Now and Events: **Try again** is primary, **Start a
  quote** remains available, and raw provider text is withheld. Expand **About
  this view** only when source and read-boundary detail is needed; an
  unavailable read never becomes an empty or caught-up claim.
- Open **Events** for accepted or booked planning records. If the current read
  is unavailable, Events withholds raw provider text, confirms that no event
  status changed, and offers one primary **Try again** action plus a return to
  **Opportunities**. The unavailable state removes the duplicate header refresh
  and keeps staff-read diagnostics collapsed under **About this view**, so the
  recovery remains the first decision. A completed empty read instead leads back to
  **Opportunities** or **Start a quote**. An unknown event link never opens a
  different event in its place.
- When an accepted or booked event remains available during a partial, stale,
  truncated, or otherwise bounded read, Events keeps it usable and collapses
  source diagnostics under **Some data may be out of date**. **Event Focus**
  presents the current commitment before the saved plan: customer, date/time,
  venue/address, duration, quote/revision, package/service, guests, saved total,
  acceptance/booking, acceptance receipt, deposit, and final balance remain
  distinct. **Enter Control Room** carries that exact event into bounded
  coordination; **Open commercial truth** returns to the existing quote owner.
- **Control Room** is a planning composition, not a live event console. Read
  **Needs attention now**, **Planned sequence**, **Recorded checklist**,
  **Actuals**, **Evidence**, then **Next**. Exact BEO freshness and operational
  staffing coverage come from their existing governed reads and remain
  separate. Neither checklist state nor those reads establishes live phase,
  staff attendance, operational readiness, actual labor, or completion. The
  single next action continues to the exact Workflow, Schedule event, or quote
  record that owns the work.
- After service, **Actuals** may show a closeout-recorded attendance count only
  when its accepted version and acceptance receipt still match this event. It
  stays beside, not in place of, the priced guest count. A mismatched source is
  labeled for review and the count is withheld. The attendance receipt does not
  establish live phase, staff attendance, labor or purchasing actuals, payment,
  settlement, or complete Replay.
- QP-UXR-005 **Event Preflight** appears inside selected Control Room and keeps
  **Ready / satisfied facts**, **Needs attention**, and **Unknown /
  unavailable** separate. It may confirm only narrow facts from the current
  commercial record, acceptance receipt, payment projection, final-count
  checklist, BEO, staffing, Workflow, and complete bounded Schedule evidence.
  It never calculates a readiness score. Missing or stale reads never pass;
  inventory, actual attendance, live phase, and live issues remain unavailable
  to the Preflight conclusion itself; separately governed actual attendance may
  appear only in the adjacent post-event Actuals boundary.
  Its one **Next** follows the first supported attention or resolvable unknown
  into the exact existing authority; otherwise it opens the exact event in
  Schedule.
- **Replay** remains unavailable as execution history until QuotePilot owns an
  immutable event-session ledger. Current commercial milestones or checklist
  timestamps may appear only as incomplete, non-immutable supporting evidence.
  Direct Control Room or Replay links keep the exact event visible and offer
  **Back to Event Focus** or **Open quote record**.
- Quote lifecycle, booking confirmation, deposit, and final balance remain
  separate recorded details in each row. Select the single primary action to
  open that exact opportunity or its existing role-safe Workflow item. An
  opportunity handoff carries the exact opaque opportunity, reason for opening,
  what the navigation changes, and the next resolution into the canonical
  Living Opportunity; it changes no quote, price, booking, payment, or provider
  record. When the source is browser-local, the stream says so and does not
  present it as server or provider confirmation.
- Expand **Quote administration** when the full legacy controls are needed.
  Those existing role-gated controls remain the compatibility and rollback
  path; the editorial stream does not grant a new control or role. A stale,
  incomplete, truncated, unavailable, or failed read withholds empty and
  caught-up conclusions and offers recovery instead of substituting evidence.
- From a focused Living Opportunity, **Open quote workspace** in Payment and
  **Open proposal controls** in Proposal retain the exact quote, open **Quote
  administration**, and narrow the table to that record. The arrival is
  explicitly **Finding Payment** or **Finding Proposal** while the connected
  Quote History read is incomplete; it becomes ready only when that completed
  read contains the exact quote and **Quote administration** receives focus.
  During this exact arrival, adjacent saved-quote, commercial-dependency,
  Decision Debt, and general Ambient panels stay out of the destination so the
  promised controls lead the first useful viewport. This is navigation to
  existing role-safe controls only. It does not request or settle money, send
  or deliver a proposal, rotate a portal, change lifecycle state, or create
  provider evidence. The exact opportunity stays visible; open **Why this
  view** only when you need the longer entry reason and consequence. With a
  keyboard, focus begins on **Close context**, moves through **Why this view**,
  the named details region, and continuation controls, remains inside the
  dialog, returns to the review trigger on Escape, and moves to **Quote
  administration** after continuing.
- For an accepted or booked Living Opportunity, **What is settled, and what is
  not** keeps customer acceptance, contract/booking, provider-confirmed
  payment, Kitchen BEO, authoritative staffing, and post-event closeout as six
  separate receipt domains. A lifecycle label alone does not prove the exact
  accepted revision or contract identity, and a checkout return or payment
  request does not prove settlement. Missing BEO, staffing, or closeout evidence
  remains unavailable and points back to the existing governed surface. The
  displayed next operational resolution adds no role or mutation authority.
- Open **Clients** to use the lighter default-off view over the existing
  bounded client directory. Its command header, page filters, dense rows, and
  responsive relationship record show only recorded identity, contact details,
  the most recent linked quote or event, and one **Review client** action. It
  does not infer relationship value, unread activity, engagement, or lifetime
  totals from the bounded page.
- With the explicit local authentication bypass enabled, Clients may show a
  24-record `local_fixture` review page spanning August through October. The
  source rail labels it **This browser**. Selecting one of those exact fixture
  identities opens its matching browser-local relationship overview, including
  locally generated opportunity and conversation context where present. The
  fixture is used only when no explicit tenant quote directory exists. Browser
  acceptance that supplies an exact directory, including an empty list, keeps
  those supplied identities and state instead of substituting fixture records.
  The fixture is never written to Firebase or a provider and is not production
  client, engagement, delivery, booking, or payment evidence.
- **Review client** opens that exact opaque client and focuses a relationship
  overview with identity, active work shown, items needing review, the next
  dated event, and one supported next step. A mismatched or missing arrival
  recovers without selecting another client. Quote-scoped conversations stay
  separate; opening one sends nothing and marks nothing read. Expand **More
  client history and controls** for the existing Customer 360 tabs, immutable
  versions, payment distinctions, and role-gated actions. The Ambient view adds
  no client, quote, message, payment, booking, provider, or rebooking authority.
- From a Living Opportunity, **Pilot** opens that exact opportunity's existing
  populated explanation only after its identifier matches the object in view.
  Missing or stale identity produces recovery instead of substituted guidance,
  and closing restores focus to the global trigger.
- From a new or editable quote, **Pilot** focuses the existing deterministic
  command field only when the independent `VITE_PILOT_COMMAND_ENABLED` gate is
  also enabled. Focus alone does not preview, stage, price, save, or send
  anything. When commands are disabled, or no opportunity is active, Pilot
  presents a nonempty unchanged-state explanation and either **Continue
  editing** or **Choose an opportunity** rather than inferring context.
- When that command bar and the default-off Ambient presentation are both
  enabled in a browser with speech recognition, hold **Hold to speak** while
  speaking and release to open a deterministic preview. Space or Enter provides
  the same press-and-release interaction. **Waiting for microphone**,
  **Listening**, and **Preparing your preview** acknowledge the action in place.
  The transcript is bounded to the current browser capture, is not persisted,
  and does not stage a draft change. Review the result, then choose **Apply to
  draft** if it is correct; normal save and server repricing remain separate.
  While that preview still matches the command, the command action reads
  **Refresh preview** and stays visually secondary to **Apply to draft**. If
  you edit the command, it returns to **Preview** so the displayed result is
  never presented as current without recalculation.
  Permission denial, unavailable speech service, missing microphone, network
  failure, no speech, cancellation, lost focus, timeout, or route exit retains
  the previous command, preview, and draft and points back to voice retry or
  typed input. The ordinary flag-off Pilot keeps its click-to-toggle **Speak**
  control. Real microphone permission and speech-service behavior remain a
  hosted/manual acceptance step.
- On a 390px Living Opportunity, the first in-flow section identifies the
  opportunity, its state, what matters, and the next action. It does not float
  over or cover later content. Use its Event, Menu, Pricing, and Proposal
  controls to open exact populated context. The desktop summary is intentionally
  not repeated in this mobile first layer.
- The Living Opportunity ranks recorded Workflow attention first, then missing
  core event/proposal facts, then an applicable staffing-guide review, and then
  optional customer-phone enrichment. For example, a missing event start time
  continues to **Review draft** before staffing. Once core facts are present,
  **Review staffing** may become the primary action and opens the exact saved
  counts, house guide, connected records, and safe draft options without
  changing the quote. Closing restores focus to the same primary action. The
  staffing guide remains a planning prompt, not proof of availability,
  assignment, sufficient coverage, cost, schedule fit, BEO freshness, or
  operational readiness.
- A focused Workflow, Approval, Messages, supported Schedule event/conflict, or
  supported Reporting action first shows **Finding** while
  QuotePilot locates the exact requested item. It may show **ready** only after
  the destination has loaded and focused that item. If the item is absent,
  stale, truncated, or unavailable, QuotePilot keeps the originating work intact
  and explains recovery instead of selecting another item.
- An exact customer reply keeps its message identifier in bounded same-app
  history state while the URL names only the quote-scoped conversation. This
  focus neither sends a message nor marks one read. Schedule focuses only an
  exact accepted/booked opportunity that is present in the current bounded
  tenant read; a missing item in a truncated read remains unknown, and conflict
  focus requires a complete current conflict view. Reporting accepts only an
  exact opportunity summary, bounded pipeline summary, or Ambient interaction-
  health target. Its targeted opportunity read stays outside aggregate
  denominators. Schedule does not use its legacy staff-lead field as proof of
  authoritative operational staffing, so that staffing arrival remains
  explicitly unavailable rather than focusing a substitute.
- These source behaviors add no role, read, mutation, workflow, message,
  pricing, provider, or payment authority. Full legacy Opportunities parity and
  retirement, universal cross-domain ranking/freshness, hosted behavior, and
  human acceptance remain open. These changes remain default-off; source text
  alone does not establish deployment or activation.

### Ambient object and Pilot policy foundations (source only)

- In the default-off Living Opportunity, saved add-ons, rentals, bar, and
  services become dependency-aware objects. Visible buttons and the equivalent
  horizontal swipe may adjust only a reversible browser-memory scenario. The
  scenario is not priced, saved, reserved, communicated, or treated as
  availability evidence; `Keep current selection` restores the saved selection.
- Menu order supports pointer drag, horizontal touch swipe, and the visible
  **Move earlier** / **Move later** buttons. Keyboard users activate those same
  native buttons. Every method opens the same unsaved review; none changes the
  authoritative quote until the ordinary outcome-named save reprices and
  versions it.
- The tested Money object keeps five kinds of evidence separate: deposit
  policy, deposit request, provider-confirmed deposit, balance request, and
  final settlement. A request never becomes payment. A browser return never becomes provider
  evidence. Local settlement-shaped data stays `Local record only`. Select
  `Review payments` in the default-off Living Opportunity to open all five domains
  with why they are shown and what they affect available under **Why this
  view**, plus the unchanged outcome, confidence, sources, and next safe
  resolution in the evidence body. Use **Open quote workspace** to continue with the
  exact quote's existing administration controls. Closing restores focus and
  either path changes no money state by itself.
- Select `Review proposal` to review proposal completeness, the saved quote
  version, current-pricing status, exactly what the customer sees,
  portal issuance, and provider evidence without collapsing one into another.
  **Why this view** retains the longer entry explanation without repeating it
  above and below the current proposal state.
  The inspector describes prepare, send, rotate, and recovery paths, but performs
  none of them. Use **Open proposal controls** to continue with the exact quote's
  existing governed administration surface. A provider acceptance is not delivery, a portal
  issuance is not a view, and neither is proposal acceptance, booking, or
  payment.
- Select `Review conversation` to review what QuotePilot currently knows about
  the conversation: sent, provider-reported delivery, portal view, latest reply,
  and bounded inferred engagement remain separate. The same context also
  explains exact change-request and follow-up evidence. **Why this view** keeps
  the longer entry explanation available without repeating it above and below
  the current evidence. It contains no send or mark-read control; use its
  focused Messaging or Workflow handoff when available. Closing or pressing `Escape`
  restores focus to `Review conversation` and changes no conversation or
  workflow state.
- Pilot classifies navigation, query, draft mutation, simulation, trusted
  mutation, communication, bulk action, and destructive action separately. V1
  permits only the first four categories through already-existing handlers.
  Draft mutations still require their exact preview and explicit outcome;
  trusted, communication, bulk, destructive, unclassified, or mismatched-
  authority commands fail closed and direct staff to the governed workflow.
- Ask Pilot to show proposal blockers, explain the price, explain recorded-cost
  margin, or prepare a client-safe summary. These are deterministic read-only
  answers with consequence, do-nothing, confidence, provenance, and authority
  language. Margin remains unavailable unless the signed-in staff role is
  authorized and every covered cost is recorded. An exact command such as
  `change package to Classic` may preview and stage the ordinary editable draft;
  ambiguity or an unknown package fails closed.
- For a Pilot option, state an explicit outcome such as
  `get this under $9,000` or `improve margin`, then review the current price,
  proposed changes, price difference, protected choices, confidence, and
  sources. `Already within goal`, `No option fits safely`, and `Unavailable` are
  complete outcomes and offer no adoption button. An available result requires
  `Adopt in draft review`, which opens a populated review with saved
  and proposed values plus **Apply scenario to draft** and **Keep current
  draft**. Nothing changes before Apply. Apply changes only the listed fields in
  the isolated editor draft; Keep changes nothing. If the organization, catalog
  source/revision/freshness, selected scenario, or affected draft fields drift,
  QuotePilot refuses adoption and asks for a fresh scenario. The outcome-named
  trusted save still reprices and versions the quote.
- These Ambient surfaces and deterministic helpers add no Firebase or provider
  authority, grant no role, and cannot themselves save, authoritatively reprice,
  send, mark read, accept a proposal, book, or confirm payment. They are local
  source foundations, not deployment, hosted behavior, production-data
  acceptance, provider-outcome, or human-acceptance evidence.

### Customer decision room (source only)

`VITE_PILOT_DECISION_ROOM_ENABLED` preserves the released portal subset when
enabled alone. The AIUI-46 layout additionally requires default-off
`VITE_AMBIENT_UI_ENABLED`. When both are enabled in a local
build, the exact-token customer portal arranges the existing customer-safe
proposal as the customer-facing half of Client 360. On desktop, the broad event
story sits beside one quieter decision rail; tablet and phone turn the same
content into one intentional sequence. The room orders **Your event**,
**Package & menu**, the proposal total and **Required deposit**, **Your
response**, **Optional additions**, collapsed **Planning assumptions**, and
tenant-authored **Terms**. The exact address and recorded payment state remain
visible when present. This is a presentation change, not a broader customer
read. Production builds keep this AIUI-46 replacement dormant while the
Ambient gate is omitted.

Each supported section offers **Ask a question** only when the existing
conversation authority is available. It opens the one existing
quote conversation and prepares ordinary editable starter text. The room
immediately reports whether that text is ready, an existing draft was kept, an
earlier send still needs reconciliation, or the conversation is read-only or
unavailable. Nothing is sent until the customer chooses **Send message**.

Catalog Admin's existing **Portal offer** checkbox remains off unless staff
deliberately enable it for an add-on or rental. An active marked option that is
not already in the proposal may appear under **Optional additions**, with its
unit basis shown as per guest, per item, or for the event. Choosing it prepares
one `Please add ...` line in the ordinary **Ask for changes** note. Choosing it
again removes only the exact line the room generated during that browser
session. Choosing **Accept proposal** or **Decline proposal** also removes any
still-generated addition lines and acknowledges that cleanup before the
customer continues. If the customer already wrote the same sentence, their
words are kept and are never treated as reversible generated text. The
customer can review, edit, remove, or send the note.

Preparing an addition never changes the selected package, items, totals,
deposit, revision, payment, booking, or provider evidence. The displayed unit
price is not a promise of the final total effect. Staff review the request and
the normal trusted save remains the only pricing and version authority. The
browser-local exact-token path mirrors the same bounded terms and option shape;
it does not gain canonical Firebase access. Hosted exact-token behavior,
production data, provider outcomes, and human acceptance remain separate open
gates.

## Model assist in CREATE

On New quote, next to Structure it, a Model assist button can ask a
configured AI provider (OpenAI or Anthropic) to read the same note. This
lane ships off: until your administrator enables it and configures a
provider key, the button reports that the lane is off and typed
structuring keeps working exactly the same. When it is on, model
suggestions appear in their own list and every one requires your explicit
Confirm before it touches the draft — the model never fills the form,
never prices, and never saves. Anything the model could not read is
quoted back for you to read yourself. Administrators may pin one provider
or use an internal `auto` route that tries the configured cheaper-first
provider:model order and may retry once when the first attempt is
unreadable or unavailable; this routing detail never changes the review-
only boundary.

After `Add details to the draft`, CREATE compresses the completed reading into
an `Inquiry added` handoff so the proposal becomes the next visible task,
especially on mobile. `Review intake` restores the source note, extracted
facts, confirmations, and notes without applying them again. The collapsed
state changes no saved quote, price, proposal revision, or provider evidence.
Keyboard focus moves to the visible `Inquiry added` heading after applying and
returns to the source field when `Review intake` is selected.

## Memory assist in CREATE

Once Structure it reads both an event type and a guest count, QuotePilot
quietly checks your own past accepted and booked events of the same type
and a similar size. With at least three real matches on file, a "From your
own history" card offers the typical servers, chefs, and bartenders, the
typical duration, and any rental most of those events included — each
number sourced from your own bookings, never a guess or an industry
average. Apply to draft sets only staffing and hours; any mentioned rental
stays a plain note, so it never overwrites a rental you already selected.
Fewer than three similar events on file is reported honestly as not enough
history yet rather than a suggestion from one or two data points.

## Catalog cost entry and margin advisory

With the pilot margin strip enabled (`VITE_PILOT_MARGINS_ENABLED`), Catalog
Admin gains cost fields beside the existing price fields — cost per person
on packages, cost on add-ons and rentals — plus server, chef, and bartender
cost rates and a target margin % policy in Pricing & Quote Defaults. Blank always
means the cost has not been recorded; it is never treated as $0, since an
entered $0 and an unrecorded cost are different facts.

The Pricing tab summarizes active catalog cost coverage, staff-cost coverage,
target-margin policy, and representative missing records before save.

The live pricing rail's margin strip computes margin only once every
selected revenue line has a matching recorded cost. Any gap names the exact
missing pieces instead of estimating. Once a target margin is recorded, a
quote below it surfaces a below-target commercial advisor card with the
point-and-dollar gap; meeting or beating the target stays a calm inline
note, not a card — advisor cards appear only where there is something to
decide. Costs are staff-only catalog data and never reach any
customer-facing projection.

The Proposal Composer uses the same fail-closed margin model in Quote Pulse:
recorded cost, computed margin, target-margin status, and missing-cost examples
are visible to staff only. For saved quotes, Quote Pulse prefers the saved
commercial snapshot captured at trusted quote create/edit time, so later
catalog cost edits do not silently rewrite prior staff evidence. The client
preview and exported proposal receive brand/logo/font/copy presentation, never
internal cost or margin data.

On a new proposal, catalog defaults are starting context rather than evidence
that staff finished the Experience section. **Preset** means the package or
service style still needs review. **Complete** means both were explicitly
reviewed in this draft or the quote has a saved identity. A blocked action
names the exact blocker count and focuses Quote Pulse; only an unblocked
**Save draft** action invokes persistence and its normal server checks.

Catalog Admin's save flow — ready, saving, a confirmed conflict
(reconciliation), a saved-but-unconfirmed revision (uncertain), a clean
success (receipt), a validation error, and a reload-required recovery when
even reconciliation could not complete — is pre-existing behavior, now
literally marked for automated coverage; recording a cost uses the exact
same save path as every other catalog field.

## Library readiness and Menu Builder

Open **Library** to review the commercial inventory first. **Before the next
quote** is contextual setup evidence, not the primary content. When something
needs attention, the first unresolved area receives one administrator action
and the remaining unresolved areas stay readable. Completed setup compresses
under a disclosure. Costs, optional starting points, additional users, and
provider connections do not block ordinary quote creation; missing cost
evidence does keep margin unavailable for the affected scope. Standalone
Library does not treat missing quote or proposal context as a setup failure.

Administrators can open the exact setup area. Sales staff receive the same
business outcomes in read-only form and one statement that an administrator
manages changes and publishing. **Draft ready to check** means unpublished
intent is durable; it does not mean pricing is active. Only **Publish catalog**
after a successful check activates a new revision and records pricing
confirmation. **Library changes are waiting to save** means those edits are
preserved in the current workspace but have not reached the shared draft and
must not be treated as saved or published.

The Menu Builder follows **Event type → Menu section → Item** in a two-part
workbench. A distinct context rail holds the event type and menu section;
infrequent create and rename controls stay collapsed until requested. Search
and availability filters narrow a compact item list, and one selected item opens
in the focused editor. Bulk controls appear only after selection and can change
availability or move selected items while preserving their stable identities.
Price basis appears as **Per guest**, **Per item**, or **Per event**. A **Setup
preset** and a catalog Import Studio batch stage into the same draft. A **Quote
starting point** remains optional setup guidance, not active pricing authority.

Managed menu costs participate in the same coverage used by staff margin
evidence. A missing menu cost is named as a gap even when the business remains
ready to quote. Costs and margin evidence never appear in customer proposal
preview, export, or portal surfaces.

## Catalog revision review on saved quotes

When a saved quote opens, QuotePilot checks its recorded catalog authority
against the current confirmed catalog. It does not silently remove an inactive
choice, replace a missing choice, or change a saved rate. The panel reports one
of five states: current; newer catalog with no selected impact; review required;
legacy revision unknown; or unavailable.

When review is required, inspect each quoted/current difference and choose:

- **Keep quoted values** preserves the saved commercial plan for the active
  quote version. Guests, duration, service style, staffing, and selections are
  then frozen until you choose current-catalog review.
- **Review and update** stages current catalog rates and opens the existing
  authoritative Change Impact flow. Nothing saves until that simulation and
  any required authorization complete as one new version.

Staffing provenance reads **Quote override**, **Current catalog rate**,
**Quoted at catalog revision N**, or **Saved rate — source revision
unavailable**. A legacy quote never receives an invented historical revision.
Accepted, declined, booked, paid, refunded, cancelled, expired, or void quotes
remain immutable; duplicate or reopen them to begin a new commercial plan.

## Unified commercial consequence review

After **Preview change impact** succeeds, use the single consequence review to
inspect **Price and deposit**, **Staffing**, **Rentals**, **Guided
recommendations**, **Margin evidence**, and **Proposal readiness** together.
Every entry names its source. Server-authoritative simulation effects are quote
consequences; operator-declared guided-selling entries are recommendations;
staff-only cost evidence and draft-completeness policy remain separate facts.

- **Apply all** stages every available guided recommendation into the exact
  proposed form.
- **Apply selected** stages only the checked recommendations.
- **Keep quoted plan** discards the unsaved proposal and restores the form that
  was loaded for editing.

Apply actions do not save a quote. QuotePilot reruns the authoritative simulation
for the rebuilt form, after which the existing authorization and immutable
version flow remains responsible for any save. If the quote revision, catalog
revision, or simulation identity changes, the review is disabled; refresh the
quote and simulation before choosing an outcome.

## Connected Quote Workspace compatibility and rollback

In the v0.16 Ambient-enabled release profile, opening an exact saved quote from
**Opportunities** uses the approved Opportunity workspace at
`/app/quotes/:quoteId`, including contextual Quick Updates. The connected
dinner-table Quote Workspace remains available to authorized staff at
`/app/quote-workspace?quoteId=<quote-id>` and
`/app/quote-workspace-concept?quoteId=<quote-id>` for compatible bookmarks and
as the ordinary exact-quote rollback presentation when Ambient is off.

The connected workspace keeps the quote number, event, saved timestamp,
lifecycle label, event image, recorded event facts, and completeness review
together. Menu items, quote totals, margin evidence when available, recent
activity, and Activity & Save Health remain on the same exact saved quote.

The workspace rail keeps **Now**, **Opportunities**, **Operations**, **Clients**,
and administrator-only **Library** as persistent orientation. Use **New quote**
for a new draft. Operations opens the accepted/booked Calendar directly; Event,
staffing, proposal, payment, and conversation work remains contextual to the
selected record instead of becoming additional permanent navigation.

The workspace does not itself save, approve, send, price, charge, or change a
quote's lifecycle. Use **Edit quote**, the Menu/Services/Pricing tabs, or the
editing controls to enter the trusted quote editor. Use **Send message** for
the exact quote conversation. **Preview** and **Review & send** open the full
role-safe Quote administration continuation, where existing proposal,
delivery, payment, booking, artifact, and recovery checks remain authoritative.
These compatibility routes do not replace the Ambient Opportunity workspace or
move their contextual tools into primary navigation.

## Difficult Question Desk preview

Authorized sales and administrative staff can see the Difficult Question Desk
in the connected Quote Workspace. The current source/local checkpoint is a
read-only boundary preview: it says `Steward is unavailable; quoting is not`,
shows that no changes were made, and keeps `Steward handoff unavailable`
disabled. It does not display a model draft, call a configured provider, save a
packet, alter the quote, or send a customer message.

Use `Open manual message` to continue through QuotePilot's ordinary messaging
workflow. That button is a manual recovery path, not a Steward-generated draft
or proof that a message was accepted, delivered, read, or answered. The `Why
Steward is limited` disclosure summarizes the current no-save, no-send,
no-approval, no-discount, no-charge, and no-configuration boundary.

## Troubleshooting
- If catalog fails to load in non-dev environments, Firebase catalog access is required and the app blocks edits until resolved.
- If starter packs do not appear in Catalog for an admin on hosted deployments, verify the organization has a `settings/config` document in Firestore and that your account is an admin for that same organization. A missing `settings`/`settings/config` document will keep catalog bootstrapping in a recoverable blocked state.
- If you see `organizationId is required` errors, the signed-in account is missing tenant context (`userRoles/{uid}.organizationId`) and must be re-provisioned/invited into an organization.
- If quote save fails, verify required fields:
  - customer name
  - customer email
  - event type
  - event date
  - event name
  - venue
  - guest count > 0
- If payment links fail, verify the coordinated frontend/Functions/rules
  revision, all four Stripe webhook subscriptions, and explicit
  `STRIPE_MODE=test|live` with a matching key in the trusted runtime. Do not
  paste provider secrets into the browser or a tracked environment file.

## Related Docs
- Product setup and commands: `README.md`
- Feature inventory and implementation chronology: `docs/FEATURE_MATRIX.md`
- Launch operations: `docs/LAUNCH_RUNBOOK.md`
- Release and governance policy: `docs/VERSION_CONTROL.md` and `docs/DOC_SYSTEM.md`

## Configured quote actions

The configured quote view ranks one next action from the quote's recorded lifecycle, exact current delivery revision, approval state, payment evidence, contract state, portal validity, recovery state, provider setup, rebook readiness, open conversation, and any action already in progress. Other permitted utilities are grouped under **More**; an unresolved delivery or transaction recovery replaces normal progression until it is reconciled. The rail renders only actions present in that compiled state and enforces the same disabled reason shown to the operator. When the preferred accepted-quote progression is blocked but the other approved progression is executable, the executable outcome becomes the next action. The quote number itself opens the workspace, so navigation does not compete with the commercial next action.

- **Edit draft** changes a current draft. **Revise quote** means a sent or viewed quote will return to a new draft version while the prior version remains historical evidence.
- **Send proposal** is the tracked QuotePilot provider path. **Manual email** and **Copy email text** are manual handoffs and do not establish QuotePilot send or delivery evidence. Provider acceptance is shown as delivery evidence rather than as a disabled button.
- **Create alternate draft** lives under **More** unless it is the ranked outcome for a closed opportunity. It creates a separate quote after an explicit consequence confirmation. Named customer, event, selection, pricing, and proposal-presentation fields carry forward through a nested schema projection; unknown nested fields and delivery, credential, acceptance, rebooking, payment-provider, integration-receipt, and booking proof do not transfer. The new quote receives its own `v0001` and version-history record. On success, QuotePilot opens that created draft while the source quote remains unchanged.
- Firebase-backed lifecycle management uses an explicit **Expire quote** action rather than a generic lifecycle selector; the browser-local fallback retains its existing status selector for compatibility.
- **Request deposit**, **Create contract**, **Request final balance**, **Record customer confirmation**, **Restore as draft**, and **Renew customer link** retain their existing approval, provider, portal, payment, and role boundaries. The action ranking does not change whether the organization's workflow treats contract creation before or after deposit settlement.

## Event Operating Spine phase recording

This bounded first slice is available only where the Event Operating Spine has
been separately enabled. Open the exact event's **Control Room** from its event
workspace. Administrators can initialize the operational record for an eligible
booked event, then record the next phase in order: **Prepared**, **In progress**,
and **Completed**. Sales users can read the phase and latest receipt but cannot
record a phase. A phase cannot skip forward or move backward in this slice.

Confirm that the displayed event and accepted source are the intended ones before
recording a phase. A stale source must be refreshed and reviewed. While submitting,
wait for the server receipt. If the outcome is uncertain, reconcile the same
attempt before starting another command; a timeout is not proof of failure. A
rejection or unavailable connection must be resolved before trying again. Local
fallback does not create an authoritative operational record.

The latest receipt identifies the recorded command; complete Replay history is
still unavailable. **Completed** means an administrator recorded the operational
phase. It does not establish staffing readiness, attendance, worked hours,
purchasing, post-event closeout review, customer communication, payment, or
settlement. Continue using the existing staffing and closeout surfaces for their
own evidence. This documented source slice does not imply hosted availability,
tenant activation, production verification, or operator acceptance.

## Event Operating Work Journal

In an enabled event's **Control Room**, initialize the event phase before using
its checkpoints and issue log. Administrators can record or reopen the four fixed
operator checkpoints: Venue access, Team briefing, Service handoff, and Pack down. Sales users can review the records and issues. A checkpoint
record is the operator's statement; it does not establish staffing readiness,
attendance, payment, or event completion.

To open an issue, enter a note of no more than 240 characters and choose normal or
urgent severity. Severity remains fixed after opening. Resolve or reopen an issue
with a new note explaining the decision. Reopening a checkpoint also requires a
note; recording one allows an optional note. Resolved issues remain in the log and
count toward its limit of 25. This slice has no deletion or automatic issue closure.

Wait for the exact work receipt before treating a change as recorded. While any
phase or work request is submitting or unresolved, complete that request's
reconciliation before starting another mutation. A returned historical receipt
establishes the old command; current journal evidence must refresh before the next
action. Changing the accepted source opens its own journal context and preserves
historical records and pending requests.

Journal corrections remain available after the event phase is **Completed**.
They neither reopen the phase nor complete the separate post-event closeout
review. The journal records checkpoints and issues only. Declared actuals use their
separate surface below; full Replay, customer communication and financial
outcomes remain outside the work journal. This
source documentation does not establish hosted availability or tenant activation.


## Event Operating Actuals

In an enabled event's **Control Room**, initialize the event phase before recording
actuals. Administrators can record labor, purchasing, and other costs. Sales users
can review the bounded records and captured totals. Enter explicitly known USD
costs; labor also requires whole duration minutes and a role category. These are
operator declarations, not inferred wages, attendance, invoice verification, or
proof that purchased materials were consumed.

Correct an entry with its replacement details and a reason, or void it with a
reason. Its category and identity stay fixed. Voids are final and remain in the
history; the limit is 50 retained entries including voids. Notes and reasons are
limited to 240 characters. Corrections remain available after the event phase is
completed and do not reopen or otherwise change that phase.

Review completeness separately for **Labor**, **Purchasing**, and **Other**.
An untouched category is **Not declared**. Recording, correcting, or voiding an
entry makes that category **Partial**, even if it was previously complete.
Declare **Complete** only when its captured costs are complete, including an
explicit confirmation of zero if appropriate. **Not applicable** is allowed only
when that category has no active entries. Captured totals stay provisional while
any category is undeclared or partial; an unknown amount is not a zero amount.

Wait for the exact actuals receipt before treating a command as recorded. An
unresolved phase, work, or actuals request must reconcile before another command
starts. A historical receipt confirms that original command; refresh current
evidence before proceeding. A changed accepted source has its own actuals context
and preserves the old records. These records do not establish delivery, closeout,
payment, settlement, or an approved overrun tolerance. This source slice does not
establish hosted availability or tenant activation.


## Event Operating Replay

For an enabled booked event, open Replay from the event workspace to inspect
recorded phase changes, checkpoints and issues, and declared-cost changes.
Each page belongs to the same accepted event source and the channel heads
captured when you opened the history. Load more to continue that history;
refresh to include newer actions. If the accepted source changes or the
underlying receipt evidence cannot be verified, refresh and review the error
instead of treating an incomplete history as complete.

Staffing, kitchen BEO, dependency status and run-of-show are current planning
references. Their own source and freshness labels remain visible. They do not
prove what happened at the event. Closeout continues through its existing
customer workflow. Its read-only actuals summary matches both the closeout
accepted version and acceptance receipt, shows the observed revision/time,
and suppresses totals when the sources differ. Refreshing that summary never
records or completes a closeout review.

Cost entries and category declarations are operator records. Expand an entry
for its full description. A declared zero is different from an unknown or
partial category. The read-only evidence export uses costs only after all
three categories have been explicitly completed or marked not applicable and
their private receipts verify. It never creates a payment, payroll result,
physical-consumption record or overrun policy.


## Tenant Workflow Configuration Studio

For an enabled organization, an administrator can open **Business workflows**
from Library. The editor distinguishes the QuotePilot seed, a tenant-published
version, a saved draft and a retired definition.

1. Edit task roles, task templates, due and escalation offsets, and optional
   review or comparison policy. Administrator authority remains required for
   operational commands and cost review. Communication references provide
   manual handoff guidance; choosing one does not send a message.
2. Save the draft. Resolve validation errors before requesting a preview.
3. Review the exact future-instance effect and enter the displayed publication
   confirmation. Publishing creates an immutable version. Existing events keep
   their pinned version.
4. To stop new bindings, retire the active version with a reason. Existing
   instances keep their version; retirement never silently restores the seed.

A missing threshold is different from an explicit zero. Comparison tolerances
must all be declared together; the publication records their declaring actor
and time. No rate is learned from past costs. Leaving a dirty Library editor
uses the existing dismissal guard.

If a command outcome is uncertain, reconcile that exact request before editing
or submitting another one. Once its receipt is confirmed, refresh the current
configuration; an older successful receipt is not the latest draft or version.
A conflict requires a current read and new preview. Publication does not enable
a tenant, deploy software, grant a new platform role or activate a provider.

## Event Workflow Coordination

Open an enabled booked event's Control Room to inspect its pinned coordination
policy. New instances use the explicit seed or active tenant publication at
initialization. Older phase records without a binding remain labeled legacy;
they do not acquire a tenant policy retrospectively.

Review task instructions, ownership, due time and escalation. An acknowledgement
records that the named obligation was checked, and reopening requires a reason.
It does not prove attendance, BEO generation, delivery, payment, or another
domain action. Due and escalation labels are observations, not notifications.
Workflow due time and individual task due times are separately anchored to
instance creation.

When complete actual costs meet the configured review threshold, an
administrator can acknowledge that exact cost revision and receipt. Incomplete
capture cannot be reviewed as complete. A correction, void, or later category
declaration requires a fresh review; the earlier receipt remains historical.

For a compatible policy update, use the separate migration preview in the
event policy panel. Review its exact source, current and proposed versions,
changed open tasks and additions, then type the displayed confirmation.
Removed tasks, changes to acknowledged task meaning, and review/comparison
policy changes are initially incompatible. Publishing alone never migrates an
event, and migration never rewrites operational or historical receipts.

Phase, checkpoint/issue, actual-cost and coordination requests share the event's
uncertain-outcome exclusion. Reconcile the original request and refresh its
current state before starting a different action.


## Catering Workflow Packs

In Library, choose the workflow you want to configure. Quote review controls
which staff may participate and whether the size of a proposed price change
requires approval. Existing administrator approval requirements still apply.
Event execution can require checkpoints before another checkpoint or phase,
and can block progression while an urgent issue is open. Closeout lets you
assign responsibility and choose a follow-up offset from the closeout due date.

Each running workflow displays the published version it uses. Publishing a new
version affects later workflows. To change a compatible running workflow,
preview the migration, review the differences and confirm the exact proposed
version. A completed task records an acknowledgement; check the separate domain
receipt to know whether the price, event or closeout actually changed.

### Final guest-count request and response

On the saved quote, open **Guest count**, then **See connections** to reach
the attendance controls. The priced count and reviewed planning estimate remain
visible separately. Request final guest count to create a
record with the deadline from your guest-count policy. Creating that request
does not send a message. Use the existing approved communication process to
contact the customer.

The current active customer portal can show the request and collect a whole
number from 1 to 400. Staff can also record a response with its stated source.
A response is proposed evidence, including when it matches the priced count.
Review the response through Commercial Change before applying it. That review
shows the exact source, count and approval requirements. It does not prove who
personally used a customer portal link.

Applying a response to an accepted or booked event creates a revised draft for
renewed customer acceptance and booking review. The old acceptance, booking and
payment history remain evidence for the earlier agreement. No new payment or
customer send happens automatically. Complete the existing proposal delivery,
acceptance and administrator booking steps before treating the revised event
as the current accepted operating source. A final count is never actual
attendance or proof of service.

If a request's result is uncertain, check the original request before submitting
another. Refresh after its receipt is confirmed. A changed accepted version or
portal link requires reviewing the current source; an old response cannot be
silently applied to a different agreement.

## Workflow availability in the RagnaKoK workspace

After deployment and tenant activation, a connected RagnaKoK administrator can
open Workflow Configuration Studio from Library. Save a draft, review it, and
publish explicitly before relying on a customized policy for new workflow
instances. Enabling the workspace does not itself publish drafts or change
existing event bindings. Native quote approval, attendance, event execution and
closeout actions continue to enforce their own permissions and source records.


RagnaKoK test access also admits operational staffing and Revenue Autopilot
preparation through the same exact-tenant runtime guard. The staffing tenant
setting remains required. Revenue policy configuration remains explicit; no
outreach policy is invented or published during activation. The global scheduler
receives no tenant scope and stays disabled, and the outbound-send gate stays
off. Other tenants cannot use these scoped authorities. Existing explicit
operator email actions retain their normal authorization and confirmations.
