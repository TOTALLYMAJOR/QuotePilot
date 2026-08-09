# Quoting Enhancement Design Notes

Last updated: August 9, 2026

Source: competitive-stage review of the quoting process (August 2026).
Load this reference before implementing any roadmap item below. Backlog
priority lives in `DEV_TASKS.md`; this file owns the design rationale and
constraints only.

## Shipped baseline (August 9, 2026)

The following five enhancements are merged on the quoting-process branch and
define the baseline these notes build on:

1. Shared `currency()` in `src/lib/quoteCalculator.js` formats with en-US
   thousands separators across wizard, breakdown, proposal sheet, emails,
   exports, and portal.
2. Wizard stepper chips are buttons (`.stepper-trigger` in `src/App.jsx`);
   backward jumps are free, forward jumps pass the step-1 required-field and
   step-2 menu-selection gates via `handleStepSelect`.
3. All-in per-guest figure (total / priced guests) in `LiveBreakdown` totals,
   the proposal sheet, the staff summary, and the save-step recap.
4. Typed counts clamp to control bounds (`clampCount` in `src/lib/wizardUi.js`),
   the proposal sheet prints the priced guest count (`totals.guests`), and the
   event-date field warns (non-blocking) on past dates (`isPastEventDateISO`).
5. Explicit expiry (`resolveQuoteValidThroughISO`) rendered as
   "valid for N days — through <date>" on the sheet, save step, and footer.

## Template system: current-state findings

The event-template machinery is well built and mostly dormant. Evidence:

- Starter packs seed no templates. `functions/starterCatalogPacks.js` sets
  `eventTemplates: []` in pack settings even though the same file fully
  validates template ids, package refs, and add-on/rental refs (up to 100
  entries). Pack-onboarded tenants therefore start with zero templates, and
  the auto-defaults machinery never fires for them. Only the local demo
  catalog (`src/data/mockCatalog.js` `DEFAULT_EVENT_TEMPLATES`) has content.
- Authoring is a raw JSON textarea ("Event Templates JSON" in
  `src/components/AdminCatalogModal.jsx`) that requires hand-written arrays
  with exact internal catalog ids. Realistically not usable by tenant admins.
- The auto-apply contract is invisible: `findTemplateForEventType`
  (`src/lib/wizardUi.js`) matches only `template.id === eventTypeId` or an
  exact case-insensitive `template.name === eventType.name`. Nothing in the
  UI or docs states this; a near-miss name silently never applies.
- The manual picker is buried inside the collapsed "Advanced Pricing
  Overrides" accordion on step 1.

What must be preserved when fixing this (audit #17 contract):

- `applyEventTypeTemplateDefaults` fills only untouched/default fields.
- Ownership tracking (`createTemplateDefaultsOwnership`,
  `releaseTemplateDefaultsOwnership`, `restoreTemplateOwnedDefaults`) powers
  the disclosure banner and "Clear defaults"; a template application must
  never overwrite a user-made selection, and clearing defaults must never
  strip one.

## Cross-cutting invariants for all proposals

- Money persists in integer minor units server-side; browser totals are never
  creation authority. Trusted callables re-price from current tenant data.
- Catalog writes use catalog-revision preconditions; pricing activation
  requires the actor-attributed confirmation receipt for the current revision.
- Quote/portal writes happen through trusted callables only; portal
  accepted/declined outcomes are terminal evidence and block overwrite.
- Guests cap at 400 in `calculateQuote`; displayed guests must stay the priced
  guests.
- Tenant scoping fails closed without `organizationId`; keep local fallback
  behavior when Firebase config is absent.
- Client analytics event names must exist in the server allowlist
  (`functions/productAnalytics.js` `ANALYTICS_EVENT_NAMES`); adding a new
  event requires the Functions allowlist change in the same release, or the
  client queue wedges on rejected batches.

## Roadmap proposals

### P1 — Template flywheel

Problem: templates are dormant (see findings). Value: repeatable, fast,
consistent quotes; the machinery already exists.

Design:
- "Save as template" action on a saved quote (Quote History and/or step 5):
  captures package, menu items, add-ons, rentals, staffing counts, hours,
  style, travel default; writes into `settings.eventTemplates` through the
  existing revision-guarded catalog save path. Admin-gated.
- Replace the JSON textarea with a form-based editor (name, linked event
  type, package select, menu/add-on/rental pickers scoped to active records).
- Add an explicit `eventTypeId` field to templates; keep name-matching only
  as legacy fallback in `findTemplateForEventType`.
- Seed 2–3 templates per starter pack in `functions/starterCatalogPacks.js`
  manifests (validator already supports them; manifest versions are
  append-only while referenced — add a new version, never edit one in place).
- Surface templates as step-1 "Start from" choice cards; keep the Advanced
  picker for overrides.

Touchpoints: `AdminCatalogModal.jsx`, `WizardSteps.jsx` (step 1),
`wizardUi.js`, `useCatalogData.js` save path, `functions/starterCatalogPacks.js`
(+ its emulator lane), `QuoteHistoryModal.jsx`.
Risks: pack manifest versioning rules; keep audit #17 semantics untouched.
Validation: `test:unit`, `test:e2e`, `test:e2e:firebase:starter-onboarding`.

### P1 — Price-from-wins prefill and context

Problem: staff re-derive every quote; win knowledge stays in heads.
Design:
- On event type + guest count entry, rank the tenant's accepted/booked quotes
  by similarity (same event type; nearest guests, then season/hours) and offer
  "Start from your last won quote like this" as an explicit, dismissible
  action — never auto-apply (reuse the template-defaults ownership mechanics
  if prefill is applied).
- Side panel: package tier, all-in per-guest, and win status of the 2–3 most
  similar wins.
- Client-side only, from existing quote history reads; no new server surface.

Touchpoints: `quoteWorkflow.js` (similarity helper), `App.jsx`,
`WizardSteps.jsx`, `quoteStore.js` reads (tenant-scoped, already available).
Risks: keep it read-only over history; respect role visibility rules.
Validation: `test:unit` (similarity helper fixtures), `test:e2e`.

### P2 — Customer-choice tiered proposals (Good/Better/Best portal)

Problem: `buildQuoteScenarios` exists but only staff see tiers; customers get
one number.
Design:
- Staff opt-in per quote: "Send as tiered proposal". Server stores the three
  scenario snapshots (each re-priced server-side) in the portal projection.
- Portal renders tier cards; customer selects a tier, then the existing
  typed-consent acceptance flow binds the accepted tier's revision/hash.
  Acceptance stays terminal; deposit derives from the accepted tier's total.
Touchpoints: `quoteWorkflow.js`, `functions/` proposal-acceptance callables,
portal snapshot schema, `CustomerPortalView.jsx`; Firestore rules unchanged
reads-wise but snapshot shape changes.
Risks: high — touches acceptance evidence and payment derivation; requires a
coordinated frontend + Functions + rules release and hosted UAT per the
release playbook. Do not ship partially.
Validation: `test:proposal-acceptance:emulator`, authoritative-pricing lane,
hosted UAT items.

### P2 — Margin guardrails

Problem: no cost basis; discount/win pricing has no visible floor.
Design:
- Optional `costMinor` per package/add-on/rental/menu item in catalog admin.
- Client: margin % line in Live Breakdown (staff-only surface) and a
  "below margin floor" warning banner; floor % configured in settings.
- Server: mirror the computation in authoritative pricing for the saved
  snapshot so staff-visible margin is evidence-backed, in minor units.
Touchpoints: catalog schemas, `AdminCatalogModal.jsx`, `quoteCalculator.js`,
`LiveBreakdown.jsx`, `functions/` pricing callable, import studio columns.
Risks: high-risk files (`quoteCalculator`, `quoteStore`, pricing callable);
margin must never leak into customer-facing sheets, emails, exports, or the
portal projection.
Validation: `test:unit` fixtures, authoritative-pricing lane, catalog-import
emulator lane if CSV columns change.

### P3 — Public self-serve estimator

Problem: inbound leads wait for a staff-built quote.
Design: trimmed public steps 1–3 (event basics, guest count, menu interests)
producing a ballpark range + inquiry record; a trusted callable creates a
draft quote for staff follow-up. Model the public gating, rate limiting, and
fail-closed server flag on the existing `/start` buyer-access pattern; the
browser never fixes prices.
Risks: public abuse surface; needs its own Turnstile/rate-limit design and a
separately approved server gate. Do not reuse buyer-access secrets or rails.
Validation: dedicated emulator lane + hosted negative-path acceptance.

### P3 — Expiry-driven follow-up automation

Problem: the explicit valid-through date (shipped) is not yet a workflow
lever.
Design:
- Portal: "pricing held through <date>" countdown from the existing
  `expiresAtISO` snapshot field.
- Sales workflow: auto-suggest follow-ups at T-7/T-2 days before expiry in
  the existing Workflow Attention queue (client-derived; provider-backed
  notifications remain the separate P1 backlog item and its delivery-proof
  rules).
Touchpoints: `CustomerPortalView.jsx`, `quoteWorkflow.js` attention builder.
Risks: low; keep attention queue as tracking, not delivery proof.
Validation: `test:unit`, `test:e2e`.
