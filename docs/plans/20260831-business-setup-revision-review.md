# Business Setup and Revision-Safe Quoting Overhaul

Last updated: 2026-08-31 20:14:17 CDT

- Program recorded at (UTC): `2026-09-01T01:14:17Z`
- Source candidate: `2d999c422da6aacaad0800eeb498d86a70b74427`
- Implementation branch: `codex/business-setup-revision-review-20260831`
- Isolated worktree: `/tmp/quoteflow-business-setup-2d999c4`
- Original checkout: `/home/administrator/projects_new/quoteflow` (preserved; no edits from this program)
- Bounded task: `business-setup-revision-review`
- Session rule: one continuous bounded implementation session with validated checkpoint commits
- Publication boundary: local source and validation only; no push, merge, deployment, provider mutation, production claim, or human-acceptance claim

## Outcome

An operator must be able to answer within five seconds:

1. Can I quote now?
2. Are there unpublished changes?
3. Has this quote fallen behind the catalog?
4. What changed, and what should I do next?

The active catalog remains the only pricing authority. A setup draft is staged intent. Existing quotes are never silently repriced and legacy authority is never invented.

## Locked scope

Owned implementation areas are the catalog and quote callables under `functions/`, the catalog and quote application surfaces under `src/`, `firestore.rules`, and the canonical documentation named in the evidence ledger. High-risk changes remain constrained to the smallest coherent path and require focused tests.

Explicit exclusions:

- Existing dirty or untracked work in the original checkout.
- Provider, hosting, production, release-promotion, and tenant-data mutations.
- Roles and provider connections inside catalog publication; they retain separate authorities.
- Customer exposure of costs, margin evidence, pricing authority, or private receipts.
- Bulk repricing or synthesized historical revision authority for existing quotes.

## Governing contracts

### Money contract

- Persist integer minor-unit settings keys.
- Prefer minor-unit keys on every read and ignore or remove conflicting legacy major-unit fields.
- Preserve deliberately entered zero.
- Reject invalid, negative, non-finite, or over-bound amounts.
- Pricing confirmation must validate the new revision without restoring older values.
- Completion requires agreement across raw stored values, a forced reload, normalized editor values, and authoritative server pricing.

### Draft and publication contract

- One durable admin-only draft per organization with `baseCatalogRevision`, `generation`, state, actor, timestamps, changed-record count, and bounded stable change records.
- Local edits are immediate. Background synchronization is coalesced after approximately 800 ms and never calls active-catalog mutations.
- Failed synchronization retains a clearly labeled device-only buffer.
- Manual edits, Menu Builder, setup presets, and Import Studio share this draft authority.
- Publication atomically validates authority, generation, base revision, baselines, dependencies, size, and payload shape; applies at most 400 records; advances exactly one catalog revision; records one actor-attributed confirmation and immutable receipt; and closes the draft.
- Autosave and review do not establish pricing confirmation.

### Readiness contract

The application keeps these projections distinct:

- Business ready to quote.
- Catalog draft ready to publish.
- Quote draft ready to save.
- Proposal ready to send.
- Margin evidence complete.
- Provider connection ready.

Ordinary quote creation requires an authoritative catalog, an active named positively priced package, an active event type and menu choice, valid required pricing policies, and current pricing confirmation. Costs, optional quote starting points, additional users, and provider connections do not block quote creation.

### Quote revision contract

- New quotes and immutable versions persist the pricing engine's exact `pricingCatalogAuthority`.
- Legacy quotes remain `Legacy revision unknown`.
- Review states are `current`, `newer_catalog_no_selected_impact`, `review_required`, `legacy_unknown`, and `unavailable`.
- Review compares selected names, availability, price basis, prices, staffing rates and policy, and rental quantity rules.
- Loaded quotes retain missing or inactive selections until an operator explicitly resolves them.
- `Keep quoted values` records an outcome receipt against the active quote version and current catalog revision; later commercial-input changes require current-catalog review.
- `Review and update` uses the existing governed simulation and versioning authority.
- Terminal quotes remain immutable and use duplicate or reopen workflows.

### Unified consequence-review contract

The existing governed commercial-change path is extended into one review grouped by Price and deposit, Staffing, Rentals, Guided recommendations, Margin evidence, and Proposal readiness. Operators may Apply all, Apply selected, or Keep quoted plan. Apply actions build an exact proposed form, rerun authoritative simulation, and create one governed version. Review fences invalidate stale proposals.

## Slice checklist

- [x] Record the complete program before implementation.
- [ ] Slice 1 — Characterize and repair travel and staffing price persistence.
- [ ] Slice 2 — Add the admin-only catalog setup draft and atomic publisher.
- [ ] Slice 3 — Add the Business Setup Center, Menu Builder, canonical costs, and readiness truth.
- [ ] Slice 4 — Add revision-aware quotes and explicit review outcomes.
- [ ] Slice 5 — Unify commercial consequence review.
- [ ] Final — Run local gates, close canonical documentation, and record residual evidence gaps.

Planned checkpoint commits:

1. `docs: record business setup revision review program`
2. `fix: preserve travel and staffing catalog prices`
3. `feat: add catalog setup draft publish authority`
4. `feat: add business setup center and menu builder`
5. `feat: add quote catalog revision review`
6. `feat: unify commercial consequence review`
7. `docs: close business setup overhaul evidence`

## Acceptance matrix

| Capability | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| Settings money round trip | Standard and long-distance travel; base server, chef, and bartender rates; named staffing/bartender rate types survive save, confirmation, forced reload, rehydration, and server pricing | Pending | Slice 1 |
| Mixed money records | Minor-unit values win over conflicting legacy majors; zero survives; invalid/negative/non-finite/over-bound values fail closed | Pending | Slice 1 |
| Old-rate scenario | Saved `$24/$32` quote with current `$48/$62` catalog is not labeled house/current and is not silently repriced | Pending | Slices 1 and 4 |
| Draft autosave | Rapid edits update locally, coalesce to at most one draft sync, produce no active revision change, and avoid blocking flicker | Pending | Slice 2 |
| Atomic publication | One revision, confirmation, and receipt; stable IDs; all-or-nothing conflict and dependency failures; at most 400 changes | Pending | Slice 2 |
| Draft privacy and roles | Direct browser access to draft/receipt collections denied; callable same-org admin enforcement; sales read-only projection | Pending | Slices 2 and 3 |
| Setup Center | Ordered eight-row readiness surface, one approved status and next action per row, operator terminology, role-safe actions | Pending | Slice 3 |
| Readiness separation | Business-to-quote, draft-to-publish, quote-to-save, proposal-to-send, margin evidence, and provider connection remain independent | Pending | Slice 3 |
| Cost truth | Managed menu `costMinor` participates in imports, normalization, publication, setup coverage, and margin from the same authoritative menu source | Pending | Slice 3 |
| Revision review | All five states, selected-record comparison, inactive/missing preservation, keep/update outcomes, terminal immutability, stale fences | Pending | Slice 4 |
| Provenance labels | Quote override, current catalog rate, quoted revision, and unavailable source labels are accurate | Pending | Slice 4 |
| Consequence review | One governed review with six groups, source labels, apply all/selected/keep, exact simulation, versioning, and invalidation | Pending | Slice 5 |
| Customer-data boundary | Costs, margins, authorities, and private receipts absent from proposals, exports, portals, and customer projections | Pending | Slices 3–5 |
| Interaction acceptance | Responsive phone/tablet/desktop behavior; keyboard, focus, overflow, and accessibility checks | Pending | Slices 3–5 |
| Final local gates | Firestore rules, capability surfaces, unit suite, environment, build, documentation governance, focused browser tests, completion planner | Pending | Final |

## Interface inventory

New callable surfaces:

- `getCatalogSetupDraft`
- `saveCatalogSetupDraft`
- `reviewCatalogSetupDraft`
- `publishCatalogSetupDraft`
- `getQuoteCatalogRevisionReview`
- `recordQuoteCatalogReviewOutcome`

Private collections:

- `organizations/{orgId}/catalogSetupDrafts/{draftId}`
- `organizations/{orgId}/catalogPublicationReceipts/{receiptId}`
- `organizations/{orgId}/quoteCatalogReviewReceipts/{receiptId}`

Shared readiness and revision-review models carry reason codes, evidence timestamps, blocking flags, and one route-safe next action. Interactive direct catalog/menu mutation is deprecated once every editing entry point uses the publisher.

## Evidence ledger

| Recorded at (UTC) | Checkpoint | Source/commit | Validation and observation | Residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-01T01:14:17Z | Session opened | `2d999c422da6aacaad0800eeb498d86a70b74427` | Original checkout identity and dirty state observed; clean sibling worktree created on dedicated branch; bounded read/write/validation scope locked; initial worktree status clean; task planner recorded `2026-09-01T01:12:29.843Z` | Implementation and all acceptance evidence pending |

## Per-slice execution record

Each slice begins at a clean checkpoint, refreshes the bounded inventory once for the new source fingerprint, runs focused tests, inspects the exact diff, updates this ledger and canonical documentation, and commits exact paths only. Checkpoint commits are continuation points, not session endpoints.

## Final evidence boundary

Local source and test evidence can qualify this implementation candidate only. Hosted behavior, provider state, production readiness, and authenticated human acceptance remain separate future gates even if every local check passes.
