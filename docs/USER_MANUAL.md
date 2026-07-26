# User Manual

Last updated: July 21, 2026

## Purpose
This guide explains day-to-day usage of QuotePilot for staff users and admins.

## Access and Roles
- Staff access (`sales` or `admin`) is required for the quote builder workspace.
- Admin access is required for Catalog Admin configuration.
- Customer Portal links are generated from saved quotes and can be shared with clients.

## Staff Workflow (Quote Builder)
1. Open the app and sign in.
2. Build quote data through the 5 wizard steps:
   - `Event Basics`
   - `Menu Selection`
   - `Add-ons / Rentals`
   - `Pricing Summary`
   - `Save / Submit`
3. Review the sticky Live Breakdown panel while editing.
4. Save or submit from the final step.
5. Copy/share the generated customer portal link if needed.

## Quote Builder Details
- Event Type drives dynamic menu categories and items.
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
  - Edit existing quote
  - Duplicate to a new draft
  - Soft delete
  - Reopen deleted quote
  - Export PDF
  - Copy email template, portal link, and payment link
  - Create Stripe deposit link
  - Rotate customer portal token when a link expires or should be reissued
- Status filtering supports grouped views:
  - `Submitted` (sent/viewed/accepted)
  - `Archived` (booked/declined/expired)

## Sales Workflow
- Open `Sales Workflow` from the top navigation.
- Summary metrics show active opportunities, readiness gaps, follow-ups due, and pending approval requests.
- The `Follow-ups` view supports lead stage, due date, note, completion state, proposal readiness, and a lifecycle timeline for each quote.
- Sales staff can request approval for sensitive actions such as payment requests, contract conversion, portal-link rotation, or quote deletion.
- Admins can approve or reject those requests with a resolution note. Approval records intent only; it does not execute the sensitive action. The admin must complete the separate action in Quote History.

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
  - Order-enforced mode: modules paid for in the order remain editable; modules not paid for are locked off.
- In order-enforced mode each module row is labeled as either `Included in order` or `Locked (not in order)`.
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
Use provisioning to create/update a customer org, apply paid module entitlements, and generate a send-ready onboarding email.

Backend source of truth:
- Firebase Callable Function `provisionCustomerOrder` handles provisioning logic server-side.
- Firestore `provisioningOrders/{orderId}` stores onboarding status, feature entitlements, and email send outcome.

### Operator Runbook
1. Confirm project access and local setup:
   - `firebase login`
   - `npm install`
   - `npm run check:env`
2. Run provisioning for a new customer:
```bash
npm run customer:provision -- \
  --project <your-project-id> \
  --name "Customer Org Name" \
  --owner-email owner@example.com \
  --owner-name "Owner Name" \
  --plan growth \
  --sequence-start 250 \
  --email-out ./artifacts/onboarding/customer-email.txt
```
3. (Optional) Update paid/unpaid modules for an existing customer org:
```bash
npm run customer:provision -- \
  --project <your-project-id> \
  --organization <orgId> \
  --order-id <orderId> \
  --name "Customer Org Name" \
  --owner-email owner@example.com \
  --owner-name "Owner Name" \
  --features customerPortal,eventSchedule,guidedSelling \
  --disable-features crmSync,diagnostics \
  --email-out ./artifacts/onboarding/customer-email-updated.txt
```
4. Send the generated email template from `--email-out`.
5. Verify in-app:
   - Sign in as org admin.
   - Open `Admin Catalog` → `Pricing` → `Optional Modules`.
   - Confirm paid modules are editable and unpaid modules show `Locked (not in order)`.

Provisioning behavior:
- Auto-assigns org id when `--organization` is omitted using numeric sequence (default starts at `250`).
- Defaults `orderId` to `orgId + 1` when org id is numeric and `--order-id` is omitted.
- Skips menu/event seed by default (`--seed-menu` to opt in).
- Applies ordered feature entitlements in org settings:
  - unpaid modules are locked off
  - paid modules remain editable
- Applies neutral white-label branding defaults so new orgs do not inherit another customer's branding.
- Ensures a minimal neutral catalog skeleton exists so runtime does not fall back to legacy defaults.
- Grants owner admin access immediately when `--owner-uid` is provided.
- Otherwise creates an email-based invite consumed at first sign-in for the owner email.
- Uses Firebase Admin credentials when available; otherwise falls back to Firestore REST writes using your Firebase CLI login token (requires `--project`).

## Customer Portal
- Customers can open portal links and review event details, selected package/menu/add-ons/rentals, itemized pricing, total, deposit, and payment state.
- Portal decisions support `Accept`, `Request Changes`, and `Decline`; change requests require a customer note.
- Proposal acceptance is recorded separately from payment and booking confirmation.
- Portal updates are reflected in staff quote history.
- Portal tokens are time-bound and expire automatically.
- Staff can use `Rotate Portal` in `Quote History` to issue a fresh link and invalidate the old one.

## Notifications and Confirmations
- Toast notifications are shown for save/update/delete and key operational actions.
- Soft delete uses an explicit confirmation step.

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
