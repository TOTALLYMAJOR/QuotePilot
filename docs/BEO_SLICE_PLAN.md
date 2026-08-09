# BEO Slice Plan

Status: slices E/F are completed historical work from commits `3632021` and
`eb5791c`. Slice G is implemented in the current source/local candidate and is
not deployed, hosted-accepted, or production-promoted. This file is an
architecture/implementation record, not release authorization. Current
operating guidance lives in `docs/USER_MANUAL.md`, feature state in
`docs/FEATURE_MATRIX.md`, and release state in `PROJECT_STATUS.md`.

Source: not from the 2026-08-05 UX audit. This is a new differentiation feature
(kitchen-facing Banquet Event Order export) proposed and designed in a
2026-08-06 planning conversation, kept in its own doc so it isn't misread as
audit-sourced work.

## Historical E/F ground rules

- These constraints governed the completed implementation; do not rerun the
  slices from this document.
- Never touch: `firestore.rules`, tenant-scoping logic, `quoteStore.js` status flow, anything under `scripts/`.
- Baseline tests had to remain green.
- E2E: not required for this slice (no user-facing wizard/portal strings change).

Those constraints do not describe Slice G, which intentionally adds trusted
Functions, private rules, client, and UI authority under the accepted
Commercial Change design documents.

---

## Slice E — Kitchen BEO (Banquet Event Order) export (implemented)

Goal: a staff-facing, printable/downloadable kitchen prep document per quote —
distinct from the customer-facing proposal PDF (`src/lib/proposalExport.js`).
Content: event timing, staffing headcounts, kitchen checkpoint timeline,
menu/selections, and production checklist grouped by phase.

### Step 1 — Finish the existing checkpoint-logic extraction (prerequisite)

`src/components/EventScheduleModal.jsx` already imports `buildProductionChecklist`
from `src/lib/quoteWorkflow.js` — that extraction happened already. Its sibling,
`buildKitchenCheckpoints`, was never moved and is still a private, unexported
function in `EventScheduleModal.jsx` (currently around line 303), along with
its private helpers `defaultKitchenCheckpointOffsets`, `parseTimeToMinutes`,
`formatCheckpointTime`, and `formatMinutesToTimeInput`.

Move all five functions verbatim (cut, not duplicate) from
`EventScheduleModal.jsx` into `src/lib/quoteWorkflow.js`, and export
`buildKitchenCheckpoints` and `defaultKitchenCheckpointOffsets` (the other
three are internal helpers to those two — export them too only if
`buildKitchenCheckpoints`/`defaultKitchenCheckpointOffsets` need them exported
transitively; otherwise keep them module-private in `quoteWorkflow.js`).
`EventScheduleModal.jsx`'s own local `toNumber` may already have an equivalent
in `quoteWorkflow.js` — reuse the existing one instead of moving a second copy
if so; check before moving.

Replace the deleted local definitions in `EventScheduleModal.jsx` with a
named import from `quoteWorkflow.js`. Do not change any calling code, JSX, or
behavior in `EventScheduleModal.jsx` beyond this — the goal is byte-identical
runtime behavior, just relocated. Do not touch `quoteStore.js`'s separate
`KITCHEN_CHECKPOINT_DEFS`/`KITCHEN_CHECKPOINT_IDS`/`KITCHEN_CHECKPOINT_BY_ID`
(server-side override-id validation) — that's a distinct, intentionally
separate concern (input validation vs. display-time computation) and is inside
the "never touch `quoteStore.js`" boundary regardless.

Add or extend `src/lib/__tests__/quoteWorkflow.test.js` with tests for
`buildKitchenCheckpoints` (it currently has no test coverage anywhere — verify
default offsets, override application, and the duration-aware `service-end`/
`reset` offsets that depend on `event.hours`).

### Step 2 — Data derivation: `src/lib/beoPayload.js` (new file)

Mirror the style of `src/lib/proposalPayload.js` exactly: small local
`cleanText`/`toNumber`/`toList` helpers (do not import shared helpers from
elsewhere — this codebase's convention, per `proposalPayload.js`, is each
payload module owns its own tiny normalizers), no side effects, pure function
of a `quote` object.

Export `buildBeoPayload(quote)` returning:
- `quoteNumber`, `organizationName` (from `quote.quoteMeta?.organizationName`,
  no brand name/logo — this document is internal, not customer branding)
- `event`: name, date, time, venue, venueAddress, guests, hours, style,
  dietaryRestrictions (same source fields as `buildProposalPayload`'s `event`
  block in `proposalPayload.js`)
- `staffing`: servers, chefs, bartenders (numeric, same source as
  `proposalPayload.js`), plus `staffLead` (from `quote.booking?.staffLead`,
  cleaned text)
- `selections`: packageName, menuItemNames, addons, rentals (flat lists —
  match `proposalPayload.js`'s existing flat shape; do not invent
  course/category grouping, catalog items do not carry that field)
- `checkpoints`: the array returned by `buildKitchenCheckpoints(event)`
  (imported from `quoteWorkflow.js` per Step 1) called with an `event` shaped
  the same way `EventScheduleModal.jsx` builds it today — i.e.
  `{ time: quote.event?.time, hours: quote.event?.hours, kitchenCheckpointOverrides: quote.booking?.kitchenCheckpoints }`.
  Read how `EventScheduleModal.jsx` currently constructs that shape (around
  its own line ~401-405, before your Step 1 edit removes the local
  functions) to match it exactly — do not guess the field names.
- `productionChecklist`: cross-reference `PRODUCTION_CHECKLIST_ITEMS`
  (imported from `quoteWorkflow.js`) against `quote.booking?.productionChecklist`
  completion state, grouped by each item's `group` field (Plan/Kitchen/
  Logistics/Team/Service/Closeout), preserving `PRODUCTION_CHECKLIST_ITEMS`'s
  existing order within each group.

Add `src/lib/__tests__/beoPayload.test.js`. Reuse or adapt the fixture at
`src/lib/__tests__/fixtures/proposalPayloadFixture.js` rather than inventing a
new one, if its shape covers `event`/`selection`/`booking` fields (extend the
fixture file with a `booking` block only if it's missing one — check first).

### Step 3 — Rendering: `src/lib/beoExport.js` (new file)

Sibling module to `src/lib/proposalExport.js`, same low-level approach
(`jsPDF`, `unit: "pt"`, `format: "letter"`) but simpler: no brand images, no
crew photos, no color palette theming (plain black-on-white functional
document — this is an internal kitchen doc, not a customer-facing branded
proposal). Re-declare local `ensureSpace`/`section`/`row` closures the same
way `proposalExport.js` does (do not import them — they're closures over
that function's local `doc`/`y` state, not currently extractable without a
broader refactor of `proposalExport.js`, which is out of scope here).

Export `async function exportKitchenBeo(quote, { output = "save" } = {})`.
Sections, in order: header (org name, quote number, event name/date — no
logo), Event & Timing, Staffing, Kitchen Timeline (checkpoint id/label/
computed clock time, one row per checkpoint), Menu & Selections (package,
menu items, add-ons, rentals as flat lists — same row-per-list-with-preview
pattern as `proposalExport.js`'s `countedAmountRow`), Production Checklist
(grouped by phase, each item showing a checkbox-style mark for completion
state and `completedByEmail`/`completedAtISO` when completed).

Support the same `output: "base64"` vs `"save"` branches as
`exportQuoteProposal` (mirror that function's ending exactly) even though
only `"save"` is wired to UI in this slice — keep the shape consistent in
case a future slice needs server-side generation.

### Step 4 — UI wiring: `src/components/QuoteHistoryModal.jsx`

Add `canExportBeo: isStaff` to the `permissions` object (same tier as the
existing `canExportProposal: isStaff` — a kitchen prep sheet is an
operational document, not a sensitive commercial action, so it does not need
`isAdmin`-only gating).

Add `handleExportBeo(quote)`, mirroring `handleExportPdf` exactly (dynamic
`import("../lib/beoExport")`, call `exportKitchenBeo(quote, { output: "save" })`,
same error handling/feedback pattern as `handleExportPdf`).

Add a button labeled "Kitchen sheet" next to the existing "Export PDF" button
in the per-quote row actions (same location as the `handleExportPdf` call
site around line ~1703), gated on `permissions.canExportBeo`. Do not add it to
the save→send handoff panel in this slice — row actions only, to keep this
change reviewable; the handoff panel is a plausible follow-up, not required
here.

Styles: only touch `src/styles.css` if the new button cannot reuse an
existing button class from the same row-actions group — check first.

### Acceptance criteria

- A staff user (admin or sales) sees a "Kitchen sheet" button on each saved
  quote in Quote History, next to "Export PDF".
- Clicking it downloads a PDF containing: event/timing, staffing headcounts +
  staff lead, a kitchen checkpoint timeline with computed clock times matching
  what `EventScheduleModal.jsx`'s schedule board would show for the same
  quote, menu/add-ons/rentals, and the production checklist grouped by phase
  with completion state.
- `EventScheduleModal.jsx`'s kitchen-checkpoint behavior (default offsets,
  overrides, duration-aware service-end/reset timing) is unchanged after the
  Step 1 move — same computed times as before, just sourced from
  `quoteWorkflow.js` instead of a local function.
- No changes to `quoteStore.js`, `firestore.rules`, or any customer-facing
  surface (portal, customer email, the existing proposal PDF).

### Tests

`npx vitest run` must stay fully green, including new tests for
`buildKitchenCheckpoints` (moved logic, previously untested) and
`buildBeoPayload` (new). No e2e coverage required — this is a staff-only,
non-wizard, non-portal surface with no existing e2e lane touching it.

---

## Slice F — BEO maturity: revision stamping, day-of contacts, allergen callout, sign-off (implemented after slice E)

Goal: close the gap between the v1 kitchen sheet and how professional BEOs are
actually used on event day. Four themes, all derivable from data the quote
already carries — this slice adds NO new persisted fields and does not touch
`quoteStore.js`, `functions/`, or `firestore.rules`.

Verified data facts (checked against current code — do not re-derive):
- `quote.versionMeta` is normalized by `normalizeVersionMetadata` in
  `src/lib/pricingContracts.js` (~line 583): `{ versionNumber, createdAt,
  createdBy: {uid,email,role}, reason }`. `quote.latestVersionNumber` also
  exists (number, 0 when absent). Legacy quotes may have neither.
- `quote.customer` carries `name`, `phone` (see `buildProposalPayload`'s
  customer block in `proposalPayload.js`). `quote.quoteMeta.businessPhone`
  exists (same file, meta block).
- There is NO notes/special-instructions field anywhere on a quote — do not
  invent one. The printed sheet gets blank ruled lines instead.
- `src/lib/beoExport.js` currently renders NO page footer (unlike
  `proposalExport.js`, which has `appendFooterToAllPages`).

### Changes

Files: `src/lib/beoPayload.js`, `src/lib/beoExport.js`,
`src/lib/__tests__/beoPayload.test.js`. No component changes — the existing
"Kitchen sheet" button and `handleExportBeo` call path are unchanged.

1. **Revision block in `buildBeoPayload`** — add a `version` field:
   `{ number, createdAtISO, createdOn }` where `number` is
   `quote.versionMeta?.versionNumber` when present, else
   `quote.latestVersionNumber` when > 0, else `0` (meaning "unversioned
   legacy"); `createdAtISO` is `quote.versionMeta?.createdAt ||
   quote.updatedAtISO || quote.createdAtISO || ""` (same fallback chain as
   `resolvePdfCreationDate` in `proposalExport.js`); `createdOn` is its
   `YYYY-MM-DD` slice or `"-"`. Keep `buildBeoPayload` pure — no `new Date()`
   inside the payload module.

2. **Contacts block in `buildBeoPayload`** — add a `contacts` field:
   `{ clientName, clientPhone, businessPhone }` from `quote.customer?.name`,
   `quote.customer?.phone`, `quote.quoteMeta?.businessPhone` (cleaned text).

3. **Revision stamping in `beoExport.js`**:
   - Header line under the title: when `version.number > 0`, append
     `· Rev {number} ({createdOn})` to the existing org/quote/event line
     region (exact placement: a new line under the date line is fine).
   - Page footer on EVERY page (mirror `proposalExport.js`'s
     `appendFooterToAllPages` shape as a local function — do not import it):
     left side `Quote {quoteNumber} · Rev {number}` (omit the Rev part when
     number is 0), right side `Page {n} of {total}`, and centered or on the
     left after the quote number: `Discard earlier revisions.` printed ONLY
     when `version.number > 1` (a rev-1 sheet has nothing to supersede).
     Use a thin top rule above the footer like the proposal PDF does.
   - Add a "Generated" line in the header area using `new Date()` AT EXPORT
     TIME in `beoExport.js` (not in the payload): `Generated {YYYY-MM-DD
     HH:mm}` local time. This is a freshness cue for printed sheets; it lives
     only in the renderer so the payload stays deterministic/testable.
   - Filename: insert `rev{number}` segment before `kitchen-beo` when
     number > 0 (e.g. `Q-1042-2026-09-12-rev3-kitchen-beo.pdf`) so stale
     files are distinguishable on disk.

4. **Day-of contacts section in `beoExport.js`** — new section rendered
   between "Staffing" and "Kitchen Timeline", labeled "Day-of Contacts":
   rows for Client (`clientName`, with `clientPhone` appended after a
   `·` when present), Staff Lead (reuse `staffing.staffLead`, "Unassigned"
   fallback as elsewhere), Venue (existing `event.venue` +
   `event.venueAddress` on one wrapped row), and Office (`businessPhone`,
   row omitted entirely when empty).

5. **Allergen/dietary callout in `beoExport.js`** — when
   `event.dietaryRestrictions` is non-empty, render a bordered box
   immediately after the header block (before "Event & Timing"): 1pt black
   border, label `DIETARY / ALLERGENS` bold, then the restriction text
   wrapped inside the box. The existing "Dietary Restrictions" row in
   Event & Timing stays as-is (redundancy is acceptable on a safety-critical
   line; do not remove the row). When empty, no box — layout must not
   reserve dead space.

6. **Sign-off + day-of notes at the end of `beoExport.js`** — after the
   Production Checklist section:
   - Section "Sign-off": two ruled signature lines (a horizontal line with a
     small caption under each): `Prepared by / date` and `Chef sign-off /
     date`. Draw with `doc.line(...)`, caption font size 8, muted gray
     (80,80,80).
   - Section "Day-of Notes": four blank ruled lines full content width,
     spaced ~22pt apart, for handwritten annotations. No data behind them by
     design (verified: no notes field exists to print).

### Acceptance criteria

- A quote with `versionMeta.versionNumber` 3 produces a sheet whose header
  shows `Rev 3`, whose every page footer shows `Quote {n} · Rev 3 · Page x of
  y` plus `Discard earlier revisions.`, and whose filename contains `rev3`.
- A legacy quote with no version fields renders with no `Rev` text anywhere,
  no discard warning, and the old filename shape — not `Rev 0`.
- Dietary text present → boxed callout appears before Event & Timing; absent
  → no box and no gap.
- Contacts section shows client name/phone, staff lead, venue, office phone;
  office row absent when `businessPhone` is empty.
- Sign-off lines and four ruled note lines render at the end; multi-page
  documents get the footer on every page (verify with a quote whose checklist
  + menu push past one page, or by temporarily lowering page height in a
  scratch check — do not commit scratch changes).
- `buildBeoPayload` remains a pure function (no Date.now/new Date inside it).

### Tests

Extend `src/lib/__tests__/beoPayload.test.js`: version block derivation
(versionMeta present, latestVersionNumber fallback, legacy → number 0;
createdAt fallback chain), contacts block (all present / businessPhone
empty). Rendering (`beoExport.js`) stays untested like `proposalExport.js` —
this repo has no jsPDF test harness; do not add one. `npx vitest run` fully
green (364+ at time of writing).

---

## Slice G — trusted generation, immutable receipts, freshness, and exact download (source candidate)

Goal: turn the staff Kitchen BEO from a browser-only download with provenance
into a server-generated artifact whose exact bytes and generation evidence can
be retained, compared to current canonical source, downloaded later, and used
to reconcile only qualifying Kitchen BEO invalidations.

Architecture authority:

- `docs/COMMERCIAL_DEPENDENCY_GRAPH_ADR.md` keeps graph topology and canonical
  hashing pure and non-authoritative for pricing or mutation.
- `docs/COMMERCIAL_CHANGE_AUTHORITY_ADR.md` owns receipt, role, transaction,
  invalidation, reconciliation, and publication-eligibility boundaries.
- `docs/COMMERCIAL_CHANGE_AUTHORITY_UI_SPEC.md` owns visible states and
  recovery.

### Trusted generation contract

`generateKitchenBeo` accepts only opaque organization, quote, and exact request
identity from authenticated same-tenant staff. The server:

1. reads the canonical quote and validates the active immutable source revision;
2. builds the same declared BEO input model used by the reviewed payload adapter;
3. computes the versioned graph/input/canonical fingerprint;
4. generates bounded PDF bytes on the server;
5. transactionally rereads the canonical source before persistence;
6. writes one immutable receipt plus retained artifact bytes bound to tenant,
   quote, revision, schemas, actor, server time, fingerprint, byte hash/size,
   request, and receipt identity; and
7. resolves only named open Kitchen BEO invalidations whose trusted evidence is
   satisfied by that exact fresh generation.

Browser-supplied revision, digest, actor, time, payload, bytes, invalidation, or
completion evidence is never accepted. Idempotent replay returns the existing
exact receipt only after strict base64 decoding and exact stored byte-length and
SHA-256 validation. The final generation response performs the same validation;
a reused identity with changed intent/bytes or corrupt retained bytes fails
closed.

### Freshness contract

`getKitchenBeoArtifactStatus` returns one bounded staff projection:

| State | Meaning |
|---|---|
| `CURRENT` | The current-artifact pointer resolves to the exact immutable successful receipt, its retained bytes pass strict base64 plus exact byte-length/SHA-256 validation, the canonical revision/fingerprint matches, and no qualifying Kitchen BEO invalidation remains open. |
| `STALE` | A valid prior receipt exists but its revision/fingerprint or named invalidation evidence no longer matches. |
| `REVIEW` | Trusted source/receipt exists but a governed decision must be reconciled before currentness. |
| `NOT_GENERATED` | No successful trusted receipt exists. |
| `UNKNOWN` | Required evidence is missing, corrupt, unsupported, cross-scope, or unavailable. |

This classification proves only declared-input freshness. It does not prove
inventory, kitchen review, publication, handwritten sign-off, operational
completion, proposal acceptance, booking, payment, provider delivery, or
customer view.

### Exact current and prior receipt download

`downloadKitchenBeoReceipt` accepts the exact same-tenant quote and receipt ID,
validates the immutable private receipt/artifact binding and byte hash/size, and
returns those retained PDF bytes. It never regenerates an old document from the
current quote. The staff UI exposes the current receipt and bounded prior
receipts with separate download actions. A browser download failure does not
invalidate the server receipt.

### Staff surface and recovery

`KitchenBeoArtifactPanel` lives on the authoritative Quote record and exposes
all five read states plus ready, submitting, uncertain, reconciliation,
receipt, error, and recovery mutation states. An uncertain generation retains
the exact request identity; a definitive rejection must be reset before a
corrected new request. The public token portal receives no BEO receipt,
fingerprint, bytes, invalidation, actor, or Decision Debt evidence.

### Source qualification boundary

Focused server authority/PDF/client/component/integration tests cover canonical
derivation, double-read drift, idempotency/collision, five-state freshness,
strict base64 and retained-byte length/SHA validation on replay, response,
status, and download, bounded bytes, exact receipt download, invalidation
handling, browser download failure, role/scope, and private rules. Final
full-repository qualification is
recorded in `PROJECT_STATUS.md` only after it completes. None of this is
deployment, hosted operator acceptance, production receipt/data, feature-gate
promotion, or human acceptance.

---

## Deferred (tier 2) — additional data capture outside slices E-G

Recorded so the next planning pass starts here. Each requires new editable
operational/catalog authority beyond the current trusted artifact inputs:

- Persisted kitchen/special-instructions notes field on the quote (wizard +
  BEO + portal-invisible).
- Per-checkpoint owner assignment (who owns "Line check") — new booking
  subfield + schedule-board UI.
- Course/station grouping and per-item prep quantities — needs catalog item
  metadata (menu items are flat name lists on the quote today) and a
  catalog join at export time.
- Equipment/rental quantities on the sheet — same catalog-join dependency.
