# User Manual

Last updated: 2026-08-29 03:22:47 CDT

## Purpose
This guide explains day-to-day usage of QuotePilot for staff users and admins.

## Access and Roles
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

## Event Workspace (Quote Detail)

- Open a quote from Home, Customer 360, or Quotes to use
  `/app/quotes/:quoteId` as the event record. Use `Back to Quotes` or `Quote
  administration` to return to the full role-gated quote table.
- Review the exact customer/event identity, quoted scope, lifecycle, and bounded
  current condition. `No tracked quote attention` means only that the bounded
  quote/Workflow read has no due item; it does not mean the event is ready or
  complete.
- The intelligence strip reuses the existing proposal-readiness calculation and
  labels it `Proposal readiness`; it measures required proposal fields, not
  operational event readiness. `Flexibility` and `Alignment` show `Unavailable`
  until QuotePilot has the required change-window and combined-integrity facts.
  Open `Why?` to review the exact missing proposal fields, evidence bounds, and
  stable reason codes. Do not interpret an unavailable dimension as zero or as
  a negative score.
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

- This source-only capability is independently default-off. It appears only
  when the presentation gate `VITE_OPERATIONAL_STAFFING_ENABLED` is enabled,
  and server reads or commands still fail closed unless both the global
  `OPERATIONAL_STAFFING_AUTHORITY_ENABLED` gate and the exact tenant's
  `operationalStaffingAuthorityEnabled` setting are enabled. Turning on one
  gate does not turn on either of the others, deploy the source, or establish
  hosted, production-data, or human acceptance.
- Production operators promote or roll back the tenant gate through the
  protected **Set Operational Staffing Tenant** release workflow after an exact
  successful Firebase all-scope deployment. The workflow changes only the named
  tenant field and verifies readback. It authenticates through the reviewed
  workload-identity provider and distinct tenant-operator service account; it
  does not use a Firebase refresh token, create a service-account key, or create
  staffing or email evidence.
- In the flagged Event Workspace, open the exact quote and select `Inspect
  staffing`. The panel reads only that tenant and quote, binds commercial role
  counts and the event window to the exact active immutable quote revision,
  and keeps quoted requirements separate from operational fulfillment. A
  cross-tenant identity, customer role, or unscoped request fails closed.
- Admins may add or edit bounded staff profiles and record capability plus
  `operator_recorded` availability windows. Sales staff may inspect those safe
  profiles but cannot configure them. `operator_recorded` means an authorized
  operator entered the window; it is not a staff member's acknowledgement.
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
  availability, assignment, or attention state, and start **Add staff**. Each
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
- In the Ambient Clients view, use the compact command header to inspect only
  this page's **Clients shown**, **With linked work**, **Upcoming events**, and **Contact details to add**
  counts. The filters narrow the current bounded page; they do not rank a
  relationship, search older pages, or infer engagement. Each dense row keeps
  identity, the latest recorded link, contact data, one relationship state,
  and one **Review client** action aligned.
- On a phone, QuotePilot replaces those four desktop metric cards with one
  **Suggested next view** based only on the current page. Select its action to
  focus the bounded directory on contact gaps, upcoming events, or all clients;
  use **View clients** to choose another exact page filter. This changes no
  customer, quote, conversation, booking, payment, or provider evidence.
- Select a customer name or `Open 360` to open
  `/app/customers/<customerId>`. A missing or other-tenant ID does not reveal a
  customer and offers a safe return to the directory.
- `Customer directory read context` and `Customer 360 read context` name the
  exact tenant, source, bounded contract, device-time last complete read, and
  loading/current/partial/retained-stale/error outcome. A fresh staff read does
  not prove delivery, viewing, acceptance, booking, payment, or operational
  completion. A refresh failure keeps only a prior result from the exact same
  tenant, search/page, or customer scope.
- The `What matters next` briefing shows active records, current Attention,
  next dated event, latest recorded activity, and the exact next safe staff
  action from the bounded DTO. When older quotes exist, missing event/activity
  copy says that it is limited to the bounded view instead of implying a
  lifetime absence.
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

## Commercial Change Authority

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
  Receipt-backed rows cover final quote-approval executions and organization
  role changes. They are server-owned, role-stamped, tenant-filtered, and
  replay-stable. The table never includes principal UIDs, App Check identity,
  recent-auth timestamps, or raw receipt fields.
- Delivery reconciliation and catalog pricing confirmation remain labeled
  `server_projection` legacy observations rather than immutable receipts. A
  provider-derived outcome still requires its own provider evidence.
- The server samples at most 500 quotes, 200 approval executions, 200 role
  records, and 200 role-authority receipts, then returns at most 50 action rows.
  The surface reports a partial state when a source sample reaches its bound.
- Browsers cannot export or clear the security receipt history. Role-authority
  receipts are indefinite server records; no receipt-clear workflow is
  implemented in this source candidate.
- A `Retry available` count is a work queue, not evidence that QuotePilot sent
  or resent a message. Check the quote's exact delivery state before acting.
- Integration success/error trends summarize operator-recorded audit entries
  until a server-authorized connector is enabled; they do not prove that a CRM
  or accounting provider accepted or applied a change.

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
- Open `Schedule` or `/app/schedule` to review accepted and booked events by
  month or week, inspect conflicts, and assign a staff lead. Quote/proposal
  lifecycle and booking confirmation are separately labeled; an accepted quote
  with confirmation pending is not displayed as a confirmed booking.
- Each event includes a persistent production checklist covering event brief, guest count, dietary review, menu prep, equipment planning, staffing, pack-out, setup, service handoff, and closeout.
- Checklist completion is an operational task record only. The app does not track inventory, so checklist state does not confirm stock counts or item availability.
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
- Open `Catalog` or `/app/catalog` (admin users only). Contextual catalog setup
  from the quote builder may still open the guarded dialog wrapper.
- In a local build with `VITE_AMBIENT_UI_ENABLED=true`, `/app/catalog` opens as
  **Library**. The first view shows the current catalog source, observation time,
  **Catalog version**, pricing-review state, Catalog choices, and Event Templates.
  It does not add a catalog read or save path. A sales user receives a role-
  specific explanation and **Return to Now** instead of an empty or generic
  destination.
- Library recommends one next useful step from the evidence it has. If the
  complete event-specific menu inventory was not part of that read, **Review
  menu** means to inspect the existing menu records; it does not mean the menu
  is empty or that a saved template reference is broken. Saved references are
  preserved until an admin compares them with the current menu; the editor does
  not claim that partial inventory was validated. Browser-local records are
  isolated to the active organization, say **Catalog saved in this browser**,
  and are not proof of the organization's server catalog, current pricing
  authority, or operational availability.
- Select a Catalog row or exact Event Template to open that object in the
  existing editor. QuotePilot acknowledges the click before the editor mounts,
  focuses the requested tab or template, and never substitutes another record.
  Ordinary movement to Now, Opportunities, Clients, or another staff surface
  keeps an unsaved Library draft mounted so returning restores the exact work.
  Browser unload, customer-portal, and sign-out transitions remain guarded.
  **Back to Library** asks before discarding a dirty draft and returns focus to
  Library when the initiating control is no longer mounted. If newer catalog
  evidence arrives, the editor preserves the draft and requires an explicit
  refresh/reconciliation choice before saving. A customer-portal route does not
  remount the workspace under that portal token until this draft guard accepts
  the transition. Opening a portal link directly still takes precedence, and
  changing from one portal token to another keeps the two public scopes separate.
- A blank organization starts on one guided screen with four clearly described
  industry packs. Empty Packages, Addons, Rentals, Menu, and Pricing tabs stay
  hidden until a pack is populated or the admin explicitly chooses
  `Create my own catalog`.
- Use tabbed sections:
  - Starter Packs
  - Packages
  - Addons
  - Rentals
  - Menu
  - Templates
  - Pricing
- In `Templates`, add or update reusable event starting points. A template's
  stable ID does not change after creation. Record its event type, service
  style, hours, package, add-ons, rentals, and menu references. When the menu
  inventory is not fully loaded, saved menu references remain preserved and
  visibly awaiting catalog validation; they are not silently removed or
  classified as missing. Template edits remain staged until **Save catalog
  changes**, which uses the existing catalog revision and reconciliation path.
- Menu management flow:
  1. Select Event Type
  2. Select Category
  3. Add/Edit/Delete items
  4. Inline edits auto-save on blur or Enter
- Finish or discard any unsaved Catalog settings before changing managed-menu
  records, and finish or discard managed-menu work before saving Catalog
  settings. QuotePilot does not combine these two draft areas into one save.
- All seven managed-menu operations—create or rename an event type; create or
  rename a category; and create, update (including deactivate), or delete a menu
  item—use the catalog revision currently loaded in Catalog Admin. The Firebase
  transaction and browser-local fallback both compare that revision before any
  record is written; local fallback checks the active organization's catalog
  revision. Deactivation or deletion also refuses items still referenced by a
  package or event template. A successful change advances the revision and
  reopens pricing review. If another session changes the catalog first,
  QuotePilot keeps the current work, loads nothing over it silently, and asks
  the user to refresh or retry instead of overwriting the newer catalog.
- Menu item fields include:
  - Name
  - Price
  - `pricingType`
  - `active` toggle
- In `Packages`, QuotePilot now opens one package workspace instead of a stack
  of permanently expanded forms. Use the package list to switch records
  without saving or discarding the current draft. The selected package leads
  with its customer-facing name, ID, price, recorded cost, contribution,
  margin state, readiness, and one next action.
- Current inclusions appear before any candidate list. `Add menu items`,
  `Add add-ons`, and `Add rentals` reveal the searchable selector for that
  group only. Search or filter by category, select multiple records, then use
  `Apply` to stage that exact group or `Cancel` to leave the package unchanged.
  The menu event-type control narrows menu candidates for these add actions; it
  does not decide package eligibility or quote behavior.
- Turning `Available in Quote Builder` on is blocked while deterministic
  package health is not Ready. QuotePilot names the first blocking reason and
  focuses Health; turning availability off remains a staged catalog change.
- `Revert this package` restores the selected package to the last saved catalog
  snapshot only. `Package actions` -> `Delete package...` first reports the
  event-template defaults and recommendation rules that reference the package;
  `Delete from draft` removes the package and those references only after that
  review. Existing saved quotes are unchanged.
- Package inclusions still do not add themselves to a quote automatically. In
  the quote builder, covered choices remain `Included at no added charge —
  select to add`; unselected choices do not appear in the customer scope, and
  selected choices price at $0 instead of charging twice.
- The in-flow package workspace save bar still saves the whole catalog draft, not just
  the selected package. Managed-menu edits remain a separate mutation path and
  must be finished or discarded before the ordinary catalog save runs.
- Save overall catalog changes with `Save Catalog`.
- In `Pricing` → `Proposal Details`, set `Business time zone` to a valid IANA value
  such as `America/Chicago`, then save the catalog. Revenue timing uses this
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
  select `Save catalog changes` to persist the six existing brand colors for
  future quotes. Editing an individual color afterward is treated as a custom
  palette. A theme save uses the same catalog revision check as every other
  settings save and does not replace package, fee, tax, deposit, travel, or
  staffing values.
- Upload or clear the customer-facing logo in the same brand section. When no
  logo is defined, QuotePilot uses a monogram fallback in the admin preview,
  Proposal Composer, and PDF letterhead rather than inventing another image.
  Brand readiness calls out logo, business name, document font, and contact
  evidence before save.
- For a new blank tenant, open `Starter Packs` and apply Wedding & events,
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
- Open `Imports` or `/app/imports`. Admin access is required.
- The destination organization is locked to the authenticated admin's organization and cannot be supplied or changed by uploaded data.
- The first release accepts CSV files up to 2 MB and supports:
  - Customers
  - Packages
  - Add-ons
  - Rentals
  - Menu items
- Upload a CSV, confirm the suggested record type, and review the proposed column mappings.
- Rows labeled `Need attention` are not imported. Correct the source file or change the mapping, then review again.
- Import creates ready records only, skips existing duplicate emails/names, sends no outbound messages, and saves an organization-scoped receipt.
- Customer and catalog imports run through the signed-in organization's
  admin-only server operations. For customers, the server owns the opaque
  customer ID, normalized name/email directory keys, private normalized-email
  ownership claim, duplicate/collision decision, actor receipt, and rollback
  check; browser code cannot read or write the email claim or create/mutate
  customer/import-receipt documents directly. For package, add-on,
  rental, and menu records, the server also stores prices in integer minor
  units and, when a record is created, advances the catalog revision once and
  clears prior pricing confirmation so an owner reviews the resulting catalog
  again. An all-duplicate receipt does not disturb confirmed pricing.
- An import retry keeps the same batch identity. Customer retries are accepted
  only for the exact same normalized input; a mismatched retry fails closed.
  If a request returns without a server receipt, Import Studio labels the
  outcome uncertain and offers reconciliation of that same batch instead of
  assuming success or failure. While submission or reconciliation is active,
  Close, reset, source-type changes, and file replacement stay locked so the
  batch identity cannot be discarded. A confirmed receipt is the only completed-state
  evidence and never implies outbound messages. If another catalog save,
  import, pack action, rollback, or confirmation advanced the revision first,
  the server returns a definitive conflict and makes no writes; Import Studio
  refreshes the catalog in place and labels the action as recovery while
  keeping the batch identity, file, visible error, or receipt available. If the
  refresh itself fails, use `Retry source refresh`. Review the
  refreshed source before retrying the same batch identity; no completed write
  is assumed.
- `Undo this import` removes only unchanged documents whose `importBatchId` and
  baseline hash match that receipt. Records edited after import, package
  inclusions, and records still selected by persistent templates are protected
  so rollback cannot leave an orphaned catalog reference. Pre-existing records
  are never deleted by the batch. Catalog rollback also requires the current
  revision; it advances once and reopens pricing review only when a record is
  actually deleted.
- Existing customer imports created by the previously deployed browser path
  remain readable records, and their legacy receipts retain guarded rollback
  compatibility. They do not acquire new directory keys merely because this
  source exists; normalize/migrate legacy customer data under a separately
  reviewed data operation before enabling the new directory for a tenant.
- Catalog Admin blocks menu deactivation or deletion while other catalog,
  branding, menu-item, or menu-form drafts are pending. Finish/save those edits,
  or close and discard them, before retrying the revisioned menu action.
- Saving or editing a quote also projects its customer into the matching
  organization record inside the trusted server transaction. An existing
  normalized email is reused; blank quote fields do not erase imported phone,
  company, notes, or other richer data. Browser code cannot write projected
  quote history.
- Active quotes, payments, contracts, bookings, and staff accounts are outside the first Import Studio release and must not be represented as imported operational history.

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
  re-rank it with a model. Each row opens its exact Workflow item and first
  acknowledges what is opening and what remains unchanged.
- **You are caught up** appears only when all expected staff reads completed,
  bounds are known and not truncated, the snapshot is current, and no recorded
  payment step remains in the same view. **Recently completed** names only recorded
  internal follow-up completion, request handling, or approval decisions. It
  does not mean a customer was contacted, a provider delivered anything, or a
  payment was collected. Expand **Read details** whenever the compact freshness
  line reports stale, partial, unavailable, unknown, or bounded evidence.
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
  truncated, or otherwise bounded read, Events keeps the event usable and
  collapses source diagnostics under **Some data may be out of date**. In
  **Event Focus**, event basics appear before planning status. The recorded
  accepted/booked state does not by itself establish operational readiness;
  unavailable live phase, issue, labor-actual, and replay evidence is named once
  as **Planning view only**. Until that authority is enabled, Events does not
  present Control Room or Replay as active actions. A direct link to either
  unavailable view keeps the exact event visible and offers **Back to Event
  Focus** or **Open quote record**.
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
  fixture is never written to Firebase or a provider and is not production
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
proposal into a calm reading order: **Your event**, **Menu and service**,
**Pricing**, **Planning assumptions**, tenant-authored **Terms**, **Possible
additions**, **Your response**, and **Questions for your catering team**. This
is a presentation change, not a broader customer read. Production builds keep
this AIUI-46 replacement dormant while the Ambient gate is omitted.

Each supported section offers **Ask a question**. It opens the one existing
quote conversation and prepares ordinary editable starter text. The room
immediately reports whether that text is ready, an existing draft was kept, an
earlier send still needs reconciliation, or the conversation is read-only or
unavailable. Nothing is sent until the customer chooses **Send message**.

Catalog Admin's existing **Portal offer** checkbox remains off unless staff
deliberately enable it for an add-on or rental. An active marked option that is
not already in the proposal may appear under **Possible additions**, with its
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
