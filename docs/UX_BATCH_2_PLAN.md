# UX Batch 2 — Slice Plan

Last updated: 2026-09-10 12:09:03 CDT

Status: completed in source by commits `2975cd1`, `ab93daa`, `38c6035`, and
`46eebdd`. This file is a historical implementation record, not an active work
order. Current operating guidance lives in `docs/USER_MANUAL.md`, feature state
in `docs/FEATURE_MATRIX.md`, and release state in `PROJECT_STATUS.md`.

Source: UX audit of 2026-08-05 (items #5, #17, #11, plus server-side branding completion).

## Historical ground rules

- These constraints governed the completed implementation; do not rerun the
  slices from this document.
- Precondition: the working tree from batch 1 (hero removal, PDF cleanup, portal branding, service-charge naming) must already be committed before starting slice A.
- Never touch: `firestore.rules`, tenant-scoping logic, `quoteStore.js` status flow, anything under `scripts/`.
- Baseline tests had to remain green for every slice.
- E2E when the slice says so: `bash scripts/run-playwright.sh test <spec files>` (boots its own dev servers; firebase-*.smoke specs are config-ignored, don't try to run them).
- E2E specs assert exact UI strings. If you change a user-facing string, grep `e2e/` and `src/**/__tests__/` for the old string and update assertions to the new behavior.
- The workspace CTA is "New Quote"; the portal H1 is "Your proposal" / "Your proposal from {brand}"; the service fee is labeled "Service charge (x%)" everywhere. Do not reintroduce old names.

---

## Slice A — Login: real form + password reset (audit #5)

Files: `src/components/AuthGate.jsx`, `src/lib/authClient.js`, `src/styles.css` (only if a new class is needed).

Changes:
1. Wrap the email/password fields and primary action in a real `<form onSubmit={...}>`; primary button becomes `type="submit"`. Enter in either field submits. Keep the mode toggle (Sign In / Register) and Google button as `type="button"`.
2. Add `sendPasswordReset(email)` to `authClient.js` using Firebase `sendPasswordResetEmail` (import from the same firebase auth module the file already uses).
3. Add a "Forgot password?" link-button under the password field. Flow: requires a non-empty email field (error "Enter your email above first." otherwise) → calls reset → replaces itself with confirmation text "Password reset email sent to {email}. Check your inbox."
4. Error styling: auth failures currently render in muted `.source-note` — switch failures to `className="error-note"` with `role="alert"`; keep the register-success message as `source-note`. Map `auth/too-many-requests` to "Too many attempts. Wait a few minutes and try again."; keep existing friendly mappings; unknown errors fall back to "Sign-in failed. Try again or reset your password." (never raw `err.message`).
5. Add `autoFocus` to the email input.

Acceptance criteria:
- Pressing Enter in the password field submits sign-in.
- A browser password manager recognizes the form (`<form>` present, autocomplete attributes preserved).
- Reset flow reachable, confirms in place, and errors distinctly from success.
- No raw Firebase error string can reach the UI.

Tests: `npx vitest run`. There is no e2e coverage of the real login (e2e uses VITE_E2E_BYPASS_AUTH); do not add e2e. Add a light component test for AuthGate submit + reset if a test pattern exists nearby; otherwise state in the report that coverage is manual.

---

## Slice B — Server-side branding: stop defaulting to "QuotePilot" in customer email (completes audit #2/#12)

Files: `functions/index.js` only.

Context: client-side artifacts (PDF via `src/lib/proposalPayload.js` `resolveBranding`, portal) already fall back to neutral copy when a tenant has no `brandName`. The Cloud Functions email builders still fall back to "QuotePilot".

Changes:
1. Find every `brandName` fallback in `functions/index.js` (there is one near the quote-email builder, ~`const brandName = ... || "QuotePilot"`, and the payment-request builder uses the same value). Mirror the client pattern from `src/lib/proposalPayload.js` `buildQuoteEmailPayload`:
   - Subject: `` `${brandName ? `${brandName} ` : ""}Quote ${quoteNumber} - ${eventDate}` `` (and the equivalent for "Deposit Request").
   - Body: "Thank you for considering us…" when brand is empty; signature falls back to "The catering team".
2. Do NOT change `DEFAULT_SETTINGS.brandName` in `src/data/mockCatalog.js` — the legacy single-tenant path and `tenantBrandFallbacks` comparison depend on it. That is a separate follow-up.
3. Grep `functions/` for any other literal "QuotePilot" that reaches a customer (email subjects/bodies only — leave log lines and internal identifiers alone).

Acceptance criteria:
- No customer-received email can contain "QuotePilot" unless the tenant's brandName is literally that.
- Emails for a branded tenant are byte-identical to before.

Tests: `npx vitest run` (server email builders are covered from root-level tests; if a test pins the old "QuotePilot" fallback, update it to the neutral fallback and note it).

---

## Slice C — Disclose event-template auto-selections (audit #17)

Files: `src/App.jsx` (template application + notice state), `src/components/WizardSteps.jsx` (step-1 notice + step-3 banner), `src/styles.css`.

Context: selecting an event type applies a matching event template (see `applyEventTemplate` in App.jsx and `DEFAULT_EVENT_TEMPLATES` in `src/data/mockCatalog.js` — e.g. Birthday sets pkg "classic", addons ["dessert"], rentals ["linens"], milesRT 16). Billable items appear with no notice.

Changes:
1. When a template is applied (either via explicit "Event template" select or via event-type selection), record a notice object in App state: template name + human list of what it set (package name, add-on names, rental names, travel miles, hours). Resolve ids to display names via the catalog.
2. Render a dismissible notice (not a modal, not a toast — an inline `warning-note`-style banner with a "Clear defaults" button and a dismiss "×"):
   - On step 1 directly under the event type field, and again at the top of step 3.
   - Copy: "{Template} defaults applied: {Package} package · {Dessert} · {Linens} · {16} travel miles — adjust in Add-ons / Rentals." (omit empty parts).
3. "Clear defaults" removes exactly the template-sourced addons/rentals and resets `milesRT` to 0 — never touches user-made selections (track which ids came from the template; an id the user has since edited/re-added counts as user-owned).
4. The notice clears when a new template is applied, when defaults are cleared, when the form is reset (New Quote), or when dismissed.
5. Give the banner `role="status"` so it is announced, and a visible focus style on its buttons.

Acceptance criteria:
- Selecting Birthday shows the banner enumerating Classic · Dessert · Linens · 16 travel miles.
- "Clear defaults" removes only those items; Live Breakdown drops to $0 add-ons/rentals/travel.
- Banner never blocks Next; keyboard reachable; dismiss persists for the current quote only.

Tests: `npx vitest run` plus `bash scripts/run-playwright.sh test e2e/quote-wizard.smoke.spec.js`. The smoke specs walk the wizard with templates active — if any assert absence of the banner region or trip on it, adjust selectors, not behavior.

---

## Slice D — Save→send handoff (audit #11) — HARDEST; read all listed files fully first

Files: `src/App.jsx` (step 5), `src/components/QuoteHistoryModal.jsx` (handoff panel), `src/lib/proposalPayload.js` (copy-email template), `src/components/SalesWorkflowModal.jsx` + `src/lib/quoteWorkflow.js` (only to reuse the existing approval-request API), `src/styles.css`.

Changes:
1. Step 5 becomes "Review & save": above the payment-method select, add a recap card — client name, event name/date, guests, total, deposit, quote validity — plus one line of forward copy: "Saving creates a draft. You'll send it to the customer from the next screen."
2. Quote History handoff panel (`.saved-quote-handoff`):
   - When send is possible (admin + provider configured + status allows): primary stays "Send quote email" (unchanged behavior).
   - Otherwise, add a visible, selectable read-only portal-link field (reuse `resolveQuotePortalLink`) with a Copy button beside it — clipboard is no longer the only path. Show it only when the portal link is shareable per existing `isCustomerPortalShareable` gating; when it is not shareable, show one sentence explaining why (reuse the existing gate copy).
   - When email is unconfigured and the viewer is admin: add a secondary action "Set up email in Integrations" that opens the Integration Ops modal (App already wires `setIntegrationsOpen`; thread a callback down).
   - When the viewer is sales: add "Request approval to send" which files the existing send-related approval request through the same API SalesWorkflowModal uses (find the request-creation call in `SalesWorkflowModal.jsx` "REQUEST SENSITIVE ACTION APPROVAL" and reuse it — do not invent a new mechanism). On success: feedback "Approval requested. An admin will see it in Sales Workflow."
3. `buildQuoteEmailPayload` in `proposalPayload.js`: when the quote has a portal key and is portal-shareable, include a line "Review and accept your quote: {portalUrl}" (the function will need the base portal URL passed in — follow how `proposalExport.js` receives `basePortalUrl` and thread the same option from the caller in `QuoteHistoryModal.jsx` `handleCopyEmail`).

Acceptance criteria:
- After saving, exactly one primary action appropriate to role/config is visible in the handoff without scrolling.
- The portal URL is visible and selectable when shareable; copied email text contains the acceptance link when shareable.
- A sales user can file the send-approval request from the handoff in one click; the request appears in Sales Workflow's Approvals tab.
- No new lifecycle transitions invented — reuse existing APIs only.

Tests: `npx vitest run` plus `bash scripts/run-playwright.sh test e2e/quote-wizard.smoke.spec.js e2e/quote-history-role-permissions.spec.js`. The role-permissions spec asserts what sales users can/cannot see — extend it for the new "Request approval to send" button rather than weakening it. quote-wizard asserts `.portal-link-row` has count 0 right after a draft save — keep that true for unshareable drafts (name the new element `.portal-link-row` so the assertion keeps guarding it).
