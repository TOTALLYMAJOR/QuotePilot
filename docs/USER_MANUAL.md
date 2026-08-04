# User Manual

Last updated: August 3, 2026

## Purpose
This guide explains day-to-day usage of QuotePilot for staff users and admins.

## Access and Roles
- Staff access (`sales` or `admin`) is required for the quote builder workspace.
- Admin access is required for Catalog Admin configuration.
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
1. Open the app and sign in.
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
4. Select `Save draft` from the final step. Saving creates or updates the quote
   but does not send it to the customer or mark it sent.
5. Quote History opens on the exact saved quote. A Firebase-backed admin can
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
- Open `Quote History` from the top navigation.
- Available actions per quote:
  - Edit an eligible draft, sent, or viewed quote. Firebase re-prices the edit
    from current tenant settings and atomically updates the quote/portal while
    creating the next version; terminal customer, booking, or payment evidence
    blocks the edit.
  - Duplicate to a new draft
  - Permanently delete through the admin-only cleanup callable. Direct quote or
    portal document deletion is denied.
  - Admin-only `Reopen` for an expired quote. It restores the last eligible
    nonterminal version as a draft and creates a new portal issuance. The trusted
    callable can also recover an eligible legacy `status=deleted` record, but a
    permanently deleted quote cannot be restored. Accepted, declined, booked,
    paid, or refunded evidence blocks both paths.
  - Export PDF
  - Copy email template. Copying prepares an artifact only; it does not send
    anything or change draft status.
  - Copy a customer portal link only after the current saved revision has
    provider-acceptance evidence for its exact current valid issuance; draft,
    rotated-but-unsent, and legacy portals without that evidence fail closed.
  - Admin only: submit customer email to the configured provider, copy a
    verified Stripe payment link, create/send a Stripe deposit request, and
    rotate a customer portal token for a draft, sent, or viewed quote when its
    issuance should be replaced. Use `Reopen` when the quote itself is expired;
    accepted, declined, and booked records cannot rotate their portal identity.
    Quote email submission is bound to the exact saved version and portal
    issuance, remains disabled in local fallback mode, and fails closed while
    provider configuration readiness is unknown. This configuration check does
    not prove sender-domain verification, provider acceptance, inbox delivery,
    or bounce handling. Rotation invalidates prior portal activation evidence,
    so both Copy Portal and the portal link inside a PDF remain unavailable
    until a separate provider send accepts the new issuance.
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

## Sales Workflow
- Open `Sales Workflow` from the top navigation.
- When active quotes need action, the navigation control shows the number of
  affected quotes. One quote counts once even when it has multiple attention
  reasons. The count loads after the main workspace becomes interactive and
  does not eagerly load the Sales Workflow modal.
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
- Sales staff can request approval for sensitive actions such as payment requests, contract conversion, portal-link rotation, or quote deletion.
- Admins can approve or reject those requests with a resolution note. Approval
  records authority but does not execute the action; select `Open Quote
  History` and complete the matching operation there. Firebase-backed actions
  consume that exact approval once and display awaiting, in-progress,
  completed, or failed execution evidence. A failed provider action requires a
  new approval request.
- In the current source candidate, Firebase-backed request and resolution
  records prefer trusted Functions using the authenticated staff identity and
  server timestamp. A narrowly scoped missing-endpoint fallback preserves the
  existing rule-authorized path during a Vercel-first rollout; other callable
  errors fail closed. Sensitive action execution has no browser-write fallback.
  Once the matching Functions and Firestore rules are deployed together,
  direct approval-array, contract-evidence, and execution-audit writes are
  denied.

## Event Schedule and Production Checklist
- Open `Schedule` to review accepted and booked events by month or week, inspect conflicts, and assign a staff lead.
- Each event includes a persistent production checklist covering event brief, guest count, dietary review, menu prep, equipment planning, staffing, pack-out, setup, service handoff, and closeout.
- Checklist completion is an operational task record only. The app does not track inventory, so checklist state does not confirm stock counts or item availability.

## Admin Catalog Operations
- Open `Admin Catalog` (admin users only).
- Use tabbed sections:
  - Packages
  - Addons
  - Rentals
  - Menu
  - Pricing
- Menu management flow:
  1. Select Event Type
  2. Select Category
  3. Add/Edit/Delete items
  4. Inline edits auto-save on blur or Enter
- Menu item fields include:
  - Name
  - Price
  - `pricingType`
  - `active` toggle
- Save overall catalog changes with `Save Catalog`.
- `Optional Modules` behavior depends on entitlement mode:
  - Standard mode: all module toggles are editable by admins.
  - Order-enforced mode: all module toggles are read-only; modules not paid for are locked off.
- In order-enforced mode each module row is labeled as either `Included in order (read only)` or `Not included in order (read only)`.
- To change what is included/locked, update entitlements through customer provisioning, then reopen `Admin Catalog`.

## Import Studio
- Open `Import Studio` from the top navigation. Admin access is required.
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
- `Undo this import` removes only unchanged documents whose `importBatchId` matches that receipt. Records edited after import are protected from rollback, and pre-existing records are never deleted by the batch.
- Active quotes, payments, contracts, bookings, and staff accounts are outside the first Import Studio release and must not be represented as imported operational history.

## Customer Onboarding (No Stripe Flow)
Use the admin provisioning workflow to create a customer organization, apply
paid module entitlements, and prepare owner access. Provisioning success is not
the same as completed owner onboarding or production acceptance.

Release status: this runbook describes locally validated release-candidate
behavior. The slice is not deployed or
production-accepted. Use it for live tenant changes only after the frontend,
Functions, and rules are deployed together from the reviewed commit. See
[`PROJECT_STATUS.md`](../PROJECT_STATUS.md) for current operational truth.

Backend source of truth:
- Firebase Callable Function `provisionCustomerOrder` handles provisioning logic server-side.
- Firestore `provisioningOrders/{orderId}` stores onboarding status, feature entitlements, and email send outcome.

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
   deposit, travel, and staffing settings. Configure or import reviewed
   customer pricing before building or sharing a quote. The owner sees a
   catalog-setup screen, and the quote workspace stays locked until an admin
   adds a specifically named package above $0, creates at least one event type,
   and checks the pricing review approval in `Admin Catalog` → `Pricing`.
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
   `Optional Modules`.

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
- Customers can open portal links and review event details, selected package/menu/add-ons/rentals, itemized pricing, total, deposit, and payment state.
- Portal decisions support `Accept`, `Request Changes`, and `Decline`; change requests require a customer note.
- Proposal acceptance is recorded separately from payment and booking confirmation.
- Portal updates are reflected in staff quote history.
- Portal decisions persist atomically to the public snapshot and organization
  quote; a terminal accepted or declined decision is immutable from the public
  portal.
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

## Troubleshooting
- If catalog fails to load in non-dev environments, Firebase catalog access is required and the app blocks edits until resolved.
- If you see `organizationId is required` errors, the signed-in account is missing tenant context (`userRoles/{uid}.organizationId`) and must be re-provisioned/invited into an organization.
- If quote save fails, verify required fields:
  - customer name
  - customer email
  - event type
  - event date
  - event name
  - venue
  - guest count > 0
- If payment links fail, verify Firebase Functions/Stripe configuration in Integrations settings.

## Related Docs
- Product setup and commands: `README.md`
- Launch operations: `docs/LAUNCH_RUNBOOK.md`
- Release and governance policy: `docs/VERSION_CONTROL.md` and `docs/DOC_SYSTEM.md`
