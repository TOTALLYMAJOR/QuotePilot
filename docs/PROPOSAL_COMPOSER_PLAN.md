# Proposal Composer — Design & Implementation Plan

Status: implementing (feature/proposal-composer, Aug 2026)
Owner surface: quote builder routes (`/app/quotes/new`, `/app/quotes/:id/edit`)
Flag: `VITE_PROPOSAL_COMPOSER_ENABLED` — **default ON**, disabled only by explicit
`0/false/no/off` (same convention as `VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED`).

## 1. Intent

Rebuild the quote creation experience so the **proposal document is the primary
editing surface**. The user designs the client's event; pricing, staffing, rentals,
and financial consequences stay synchronized and visible in a live **Quote Pulse**
rail. The existing five-step wizard is not deleted: it becomes **Guided mode**
(sequential decisions for new users), reachable from the composer, writing to the
same `form` state. The legacy flag-off configuration is byte-compatible with
today's wizard contract.

Source brief: "QuotePilot Quote Experience — Proposal Composer Redesign Prompt"
(user-provided, Aug 2026). This plan maps that brief onto the real data model;
anything the model cannot support honestly is listed in §8 (deferred) rather than
faked.

## 2. Architecture

- `src/lib/proposalComposerPresentation.js` — pure presentation model
  (`proposal-composer-v1`): section models, completeness, staffing recommendation
  (house `STAFF_RULES`), rental suggestions, guest-change consequences, watching
  list, investment rows, pulse model. No component state; fully unit-testable.
- `src/components/ProposalComposer.jsx` — the composer surface. Reuses:
  - `src/components/ambient/InlineValue.jsx` — accessible click-to-edit
  - `DigitRoll` — odometer money transitions
  - `detectBreakdownValueChanges` (`wizardUi.js`) — change flashes
  - `calculateQuote` what-ifs — impact previews (same pattern #83 introduced)
  - `buildMarginPresentation` — margin in Pulse (only under
    `VITE_PILOT_MARGINS_ENABLED`, fail-closed as everywhere else)
- `src/components/proposalComposer.css` — all styles `pc-` prefixed, scoped under
  `.proposal-composer` / `.pc-shell`; no changes to legacy wizard CSS.
- Wiring in **both** `src/App.jsx` and `src/LegacyApp.jsx` (dual-graph tax):
  - mode state: `composer` | `guided`; composer default when flag on
  - shared JSX extracted per file (`draftReviewSurfaces`, `builderStatusNotes`)
    so Pilot review surfaces + availability/save notices render in both modes
  - `PilotCommandBar`, `CreateIntake`, `ChangeRequestPanel` mounts unchanged
- `vite.config.js`: composer files join the `quote-builder-ui` manual chunk.
- `playwright.config.js`: pins `VITE_PROPOSAL_COMPOSER_ENABLED ?? "false"` so the
  default lane keeps exercising the legacy wizard contract; new
  `e2e/proposal-composer.spec.js` runs flag-on (skips when off).

## 3. Visual system (scoped tokens, `--pc-*`)

Palette (from the brief, verbatim):

| Token | Value | Use |
|---|---|---|
| `--pc-bone` | `#F3EFE6` | page canvas behind the sheet |
| `--pc-sheet` | `#FBFAF6` | proposal surface |
| `--pc-ink` | `#171D1A` | primary text |
| `--pc-muted` | `#73746F` | secondary text (4.6:1 on sheet) |
| `--pc-rule` | `#D8D4C9` | hairlines |
| `--pc-brass` | `#A7771C` | accents, large text, eyebrows |
| `--pc-brass-deep` | `#7A5713` | brass at small text sizes (AA) |
| `--pc-teal` | `#0F6B61` | operational health / completion |
| `--pc-amber` | `#B17A21` | watch states (badges/large only) |
| `--pc-amber-deep` | `#8A5E12` | amber small text (AA) |
| `--pc-red` | `#B65143` | risk (badges/large only) |
| `--pc-red-deep` | `#9C4033` | risk small text (AA) |

Type roles: **Bodoni Moda** (`--font-editorial`, already loaded) for quote title,
section titles, and major totals; **Manrope** for controls/labels/metadata;
**DM Mono** (already loaded) for tabular money in Pulse + Investment — the
financial-clarity signature. Grouping is done by whitespace + hairlines, not
boxes; no new shadows beyond one whisper under the sheet.

Signature element: the sheet-on-bone proposal with brass small-cap eyebrows whose
hairline runs through the header line, and the Quote Pulse rail as a quiet
instrument (serif total, mono figures, teal/amber watching dots). Motion budget:
crossfade/odometer 120–240 ms ease-out, warm highlight fade ≤ 500 ms, none of it
on unrelated content; `prefers-reduced-motion` snaps everything.

## 4. Sections (progressive disclosure)

1. **Event** — inline: event name, event type, date, start time, duration,
   guests, venue, venue address, dietary notes.
2. **Client** — inline: client name, organization, phone, email.
3. **Experience** — package + service style presented as client-readable copy
   with per-option price deltas (what-if `calculateQuote`); changing shows the
   consequence before/as it applies.
4. **Menu** — composed menu grouped by catalog section; "Edit menu" opens an
   in-place picker (search + per-item impact labels); no Library round-trip.
5. **Staffing** — counts inline; recommendation card from `STAFF_RULES`
   (ratio + minimum shown as the basis, labor delta as impact, "Use
   recommendation" applies). Never auto-modifies headcount.
6. **Rentals** — included list with quantities; when guests change and explicit
   quantities lag the house `qtyRule`, a suggestion card offers per-item updates.
   (Un-overridden quantities already float with guests in pricing — no nag.)
7. **Enhancements** — add-ons with visible `+$` impact; "+ Add enhancement"
   in-place picker.
8. **Investment** — serif event total, per guest, deposit; ruled breakdown
   (package & menu, staffing, rentals, enhancements, travel, service charge,
   tax). **Advanced pricing** `<details>` (collapsed): tax region, season
   profile, travel miles, staffing rate overrides + rate-mix CSVs, disposables,
   payment method, validity note.

**Quote Pulse** (sticky rail): total (DigitRoll), per guest, deposit, margin
(margins flag only, fail-closed with missing-cost note), composition line,
watching board (readiness gaps from `buildProposalReadiness`, staffing vs house
ratio, travel entered, client email, date/venue), Save + Compare actions.

**Guest-change consequences**: committing a guest edit snapshots the prior form;
a consequence card shows totals before → after, staffing recommendation gap, and
rental suggestions with `Apply staffing & rentals` / `Keep as quoted` /
`Undo guest change`. Nothing is silently modified.

**Header**: eyebrow (`Current draft` / `Editing quote N`), serif title from event
name, meta line (date · venue · guests), save-state chip (`Unsaved changes` /
`Saving…` / `Saved just now ✓`), actions: Preview client view*, Compare
scenarios, Guided mode. (*v1 renders the existing client-facing recap composed
from draft data — see §8 for the full portal-preview follow-up.)

**Mobile** (≤980px): single column; Pulse collapses to a sticky bottom bar
(total + `Review quote →`) opening the Pulse as an overlay; 44px touch targets;
inline editing preserved.

## 5. What maps to what (no functionality removed)

| Brief asks | Implementation |
|---|---|
| Inline editing | `InlineValue` per field, autolive totals |
| Impact preview | what-if `calculateQuote` + consequence card |
| Quote Pulse | new rail; legacy `LiveBreakdown` remains in Guided/flag-off |
| Scenario comparison | existing `QuoteCompareModal` (header action) |
| Client preview | draft recap action (v1) + saved-quote portal/PDF unchanged |
| Revisions | existing version history + comparison (unchanged) |
| Pilot NL + voice | existing `PilotCommandBar` mounts above the document |
| Guided mode | the existing wizard, toggled at runtime, same `form` |
| Autosave | honest save-state chip; continuous autosave deferred (§8) |
| Budget intelligence | deferred — no per-quote budget field in the model (§8) |
| Margin in Pulse | only with recorded costs + margins flag (fail-closed) |

## 6. Slices

- **A** presentation model + unit tests (`proposalComposerPresentation.js`)
- **B** composer components + scoped CSS
- **C** App/LegacyApp wiring + flag + mode toggle + chunking
- **D** playwright pin + flag-on e2e spec
- **E** verification: unit, build, bundle budget (raise exception per #83
  precedent if needed), legacy smoke, flag-on spec
- **F** docs: CHANGELOG entry; this plan updated with outcomes

## 7. Non-negotiable invariants

- Flag off ⇒ DOM and behavior of the wizard remain exactly today's contract.
- Save path authority unchanged: explicit save, server-authoritative pricing on
  Firebase catalogs, version snapshots on update. The composer never invents a
  second save path.
- No customer-facing surface renders margin, costs, or internal watch states.
- All figures shown come from `calculateQuote`/`totals` or fail-closed models —
  nothing estimated in the UI layer.

## 8. Deferred (honest gaps, next iterations)

- **Continuous autosave** — requires versioning-authority design (debounced
  draft persistence vs. version spam; offline conflicts). v1 ships the truthful
  save-state chip + existing beforeunload guard.
- **Per-quote budget target** — needs a data-model field (form + quoteStore
  submit/update/hydrate + server sanitizers). Pilot's transient `under_budget`
  scenarios still work today.
- **Portal-fidelity client preview from an unsaved draft** — portal snapshot
  builders assume saved quotes; v1 preview is a client-safe recap of the draft.
- **Dietary conflict detection** — free-text field has no structured model.
- **Keyboard `E`/section arrows** — ⌘K, Esc, Enter/blur commits ship in v1;
  bespoke section navigation deferred to avoid input conflicts.
- **Scenario diff-only compare view** — existing Good/Better/Best modal is kept;
  diff-only presentation is a follow-up.

### Spec sketch: per-quote price overrides (needs product + server sign-off)

Operators asked to change package/item prices per quote. Today the catalog is
the sole price authority and `functions/pricingEngine.js` recomputes from it
on save, so a client-side price field would be silently discarded — the
composer instead surfaces staffing-rate overrides (which the model supports)
and an admin shortcut into catalog pricing. Real per-quote price overrides
would require, in order:

1. **Data model** — `selection.priceOverrides` map (`{ scope: "package"|
   "addon"|"rental"|"menu_item", itemId, unitPrice }`), persisted through
   `quoteStore` submit/update/hydrate and sanitized server-side.
2. **Pricing engines** — both `src/lib/quoteCalculator.js` and
   `functions/pricingEngine.js` honor the override (bounded: no negative
   prices, optional max-discount guardrail from settings), and record it in
   `rulesSnapshot` so revisions explain themselves.
3. **Authority** — an overridden price is a governed commercial change:
   the change-impact simulation and (when enforcement is promoted) exact
   authorization must treat it as a changed fact.
4. **UI** — inline price edit on menu/enhancement rows, admin-gated, with a
   provenance chip ("catalog $28 → this quote $25") and margin fail-closed
   behavior unchanged.

Until all four land together this stays out of the UI; a partial version
would show prices the server refuses to honor.
