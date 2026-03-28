# User Manual

Last updated: March 27, 2026

## Purpose
This guide explains day-to-day usage of the Firebase Quote Wizard for staff users and admins.

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
- If `Optional Modules` are managed by order policy, only unpaid modules are locked off.
- Paid modules remain editable by admins.

## Customer Onboarding (No Stripe Flow)
Use the provisioning script to create a customer org, enforce ordered feature entitlements, and generate a send-ready onboarding email.

Backend source of truth:
- Firebase Callable Function `provisionCustomerOrder` handles provisioning logic server-side.
- Firestore `provisioningOrders/{orderId}` stores onboarding status, feature entitlements, and email send outcome.

Example:
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

Behavior:
- Auto-assigns org id when `--organization` is omitted using numeric sequence (default starts at `250`).
- Defaults `orderId` to `orgId + 1` when org id is numeric and `--order-id` is omitted.
- Skips menu/event seed by default (`--seed-menu` to opt in).
- Applies ordered feature entitlements in org settings.
  - unpaid modules are locked off
  - paid modules remain editable
- Applies neutral white-label branding defaults so new orgs do not inherit another customer's branding.
- Ensures a minimal neutral catalog skeleton exists so runtime does not fall back to legacy defaults.
- Grants owner admin access immediately when `--owner-uid` is provided.
- Otherwise creates an email-based invite consumed at first sign-in for the owner email.
- Uses Firebase Admin credentials when available; otherwise falls back to Firestore REST writes using your Firebase CLI login token (requires `--project`).

## Customer Portal
- Customers can open portal links and view quote details.
- Portal actions allow customer status responses (for example accept/decline).
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
