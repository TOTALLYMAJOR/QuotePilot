# Business Setup and Revision-Safe Quoting Overhaul

Last updated: 2026-09-01 21:06:03 CDT

- Program recorded at (UTC): `2026-09-01T01:14:17Z`
- Completion planner recorded at (UTC): `2026-09-01T02:35:29.075Z`
- Acceptance-repair completion planner recorded at (UTC): `2026-09-01T17:33:52.650Z`
- Production hardening planner recorded at (UTC): `2026-09-02T01:16:27.061Z`
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
- [x] Slice 1 — Characterize and repair travel and staffing price persistence.
- [x] Slice 2 — Add the admin-only catalog setup draft and atomic publisher.
- [x] Slice 3 — Add the Business Setup Center, Menu Builder, canonical costs, and readiness truth.
- [x] Slice 4 — Add revision-aware quotes and explicit review outcomes.
- [x] Slice 5 — Unify commercial consequence review.
- [x] Final — Run local gates, close canonical documentation, and record residual evidence gaps.

Planned checkpoint commits:

1. `docs: record business setup revision review program`
2. `fix: preserve travel and staffing catalog prices`
3. `feat: add catalog setup draft publish authority`
4. `feat: add business setup center and menu builder`
5. `feat: add quote catalog revision review`
6. `feat: unify commercial consequence review`
7. `docs: close business setup overhaul evidence`
8. `fix: close business setup acceptance defects`

Checkpoint identities:

1. `f719870` — recorded program
2. `faefe9d` — money persistence
3. `1d63eee` — setup draft and publisher
4. `394bba6` — Setup Center and Menu Builder
5. `eb217f2` — quote revision review
6. `efa8271` — unified consequence review
7. `274d9e0` — closed local evidence
8. `f5d0c24` — closed the five manual-acceptance defects and requalified locally

## Acceptance matrix

| Capability | Required proof | Status | Evidence |
| --- | --- | --- | --- |
| Settings money round trip | Standard and long-distance travel; base server, chef, and bartender rates; named staffing/bartender rate types survive save, confirmation, forced reload, rehydration, and server pricing | Locally proven | Failing characterization reproduced stale minor shadowing; focused suites cover save planning, forced normalization, confirmation storage, and authoritative pricing |
| Mixed money records | Minor-unit values win over conflicting legacy majors; zero survives; invalid/negative/non-finite/over-bound values fail closed | Locally proven | `useCatalogData.savePlan`, `starterCatalogPacks.server`, and `pricingEngine.authoritative` focused tests |
| Old-rate scenario | Saved `$24/$32` quote with current `$48/$62` catalog is not labeled house/current and is not silently repriced | Locally proven | Revision model and panel tests show quoted/current values and `Quoted at catalog revision 7`; no house-rate label |
| Draft autosave | Rapid edits update locally, coalesce to at most one draft sync, produce no active revision change, and avoid blocking flicker | Locally proven | Hook and server characterization cover immediate local buffering, one 800 ms sync, retry, and no active-catalog mutation |
| Atomic publication | One revision, confirmation, and receipt; stable IDs; all-or-nothing conflict and dependency failures; at most 400 changes | Locally proven | Server unit suite covers one revision/confirmation/receipt, stable IDs, idempotency, baselines, dependency validation, and size bounds |
| Draft privacy and roles | Direct browser access to draft/receipt collections denied; callable same-org admin enforcement; sales read-only projection | Locally proven | Private rule assertions, callable same-org admin gates, and sales read-only Library component/model tests |
| Setup Center | Ordered eight-row readiness surface, one approved status and next action per row, operator terminology, role-safe actions | Locally proven | Business readiness model and Setup Center component tests; Workspace Shell exposes read-only Library to sales |
| Readiness separation | Business-to-quote, draft-to-publish, quote-to-save, proposal-to-send, margin evidence, and provider connection remain independent | Locally proven | Pure readiness projection plus publication receipt projection with reason codes, timestamps, blocking flags, and route-safe actions |
| Cost truth | Managed menu `costMinor` participates in imports, normalization, publication, setup coverage, and margin from the same authoritative menu source | Locally proven | Managed-menu/import/draft/pricing normalization paths plus missing-cost readiness regression |
| Revision review | All five states, selected-record comparison, inactive/missing preservation, keep/update outcomes, terminal immutability, stale fences | Locally proven | Server model, receipt, quote creation/runtime, and panel tests; editor disables automatic loaded-quote reconciliation and server save rechecks the review fence |
| Provenance labels | Quote override, current catalog rate, quoted revision, and unavailable source labels are accurate | Locally proven | Pure provenance helper plus old-rate/legacy/current/override presentation tests |
| Consequence review | One governed review with six groups, source labels, apply all/selected/keep, exact simulation, versioning, and invalidation | Locally proven | Unified model/component tests verify exact groups, source labels, non-mutating form construction, three outcomes, and fail-closed quote/catalog/simulation fences; existing governed authority remains the only version-write path |
| Customer-data boundary | Costs, margins, authorities, and private receipts absent from proposals, exports, portals, and customer projections | Locally proven | Existing customer-safe projection tests plus setup/revision/consequence models keep costs, margins, internal authorities, and receipts on staff/server-only paths; final full suite remains pending |
| Interaction acceptance | Responsive phone/tablet/desktop behavior; keyboard, focus, overflow, and accessibility checks | Locally proven | Enabled Ambient Library Playwright cohort passed 8/8, including axe, focus, control-size, collision, overflow, device-only price/section rehydration, and sales read-only access at 390, 768, and 1440 pixels; Catalog Admin browser cohort passed 3/3 including one coalesced draft sync and no active-quote mutation |
| Final local gates | Firestore rules, capability surfaces, unit suite, environment, build, documentation governance, focused browser tests, completion planner | Locally proven | Canonical release, Firebase auth/rules, and authoritative-pricing lanes passed; rules 77/77; unit 4,254 passed with 79 intentional skips; Truth Loop 127/127; capability, project-state, environment, production build, bundle, workflow, secret, documentation-governance, and browser gates passed; repair completion planner recorded `2026-09-01T17:33:52.650Z`. |

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
| 2026-09-01T01:21:19Z | Slice 1 money persistence | `faefe9d` | Added a failing `$24/$32 → $48/$62` normalize-before-save characterization, then separated storage minor fields from the editor model; changed settings now write validated minor units and delete legacy majors; confirmation removes mixed-record conflicts; named rates reach client/server pricing. Focused result: 5 files, 90 tests passed. | Firebase emulator and hosted hard-refresh proof remain final local/hosted gates; the next publisher must reuse the same contract |
| 2026-09-01T01:39:36Z | Slice 2 catalog draft publisher | `1d63eee` | Added six-layer draft authority: private rules, same-org admin callables, bounded normalized change records, generation/revision/baseline fences, 800 ms device buffer sync, and a sticky review/publish state bar. Publication is atomic, advances once, confirms once, receipts once, and closes the draft. Focused result: 5 files, 32 tests passed; capability-surface gate passed. | Setup presets, Import Studio, and direct managed-menu actions are routed through the shared draft in Slice 3; emulator rules and full suite remain final gates |
| 2026-09-01T01:56:39Z | Slice 3 setup center and menu builder | `394bba6` | Library now starts with six independent readiness signals and the ordered eight-row Setup Center; sales receive read-only evidence. Menu Builder, setup presets, and catalog imports stage through the shared draft. Managed menu `costMinor` reaches import, normalization, publication, coverage, pricing context, and staff margin. Focused UI/model/server suites and the production build passed. | Browser viewport/accessibility acceptance remains a final gate; revision-aware quote behavior begins in Slice 4 |
| 2026-09-01T02:07:42Z | Slice 4 revision-aware quotes | `eb217f2` | Trusted quotes and versions persist exact pricing authority; the five-state server review compares selected commercial inputs and staffing/rental policy without silently reconciling loaded choices. Keep/update outcomes create private version-and-revision-fenced receipts; update reuses governed Change Impact, while terminal and stale work fail closed. Focused 55-test and broader 81-test runs passed; production build passed. | Hosted callable/readback and human workflow acceptance remain final external gates; Slice 5 unifies consequence presentation and selection actions |
| 2026-09-01T02:15:42Z | Slice 5 unified consequence review | `efa8271` | Extended the existing Commercial Change Impact presentation into six source-labeled groups. Apply all/selected rebuild exact proposed forms and rerun the existing authoritative simulation; Keep quoted plan restores the loaded base form without writing. Quote, catalog, and simulation fences invalidate stale work. Focused result: 5 files, 44 tests passed; production build passed. | External hosted/human evidence remains pending |
| 2026-09-01T02:35:29.075Z | Full local qualification and closeout | `274d9e0` | Firestore rules passed 77/77; unit suite passed 4,245 with 79 intentionally skipped; capability, docs-governance, environment, build, and project-state gates passed; the exact existing ignored Firebase environment supplied the isolated check without copying or printing values; responsive/accessibility Library passed 3/3 at 390/768/1440; Catalog Admin passed 3/3. The callable parser inventory was deliberately advanced from 95 to 101 for the six new exports. Completion planner classified the finished scope high-risk/auth-rules at this exact time. | Hosted/provider and authenticated human acceptance remain unproven. A later user request authorized deployment, but the governed candidate path still requires a clean published `release/vX.Y.Z` head and exact successful CI before any provider mutation. |
| 2026-09-01T17:33:52.650Z | Manual-acceptance repair and local requalification | `f5d0c24` | Corrected the Offerings route, durable bounded device-only draft rehydration, truthful draft-state labels, mobile contrast, and the sales duplicate-main defect. Staged creates preserve create intent through later edits and movement. Canonical `lane:release`, `lane:firebase-auth-rules`, and `lane:authoritative-pricing` all passed; full unit was 4,254 passed/79 skipped, Firestore rules 77/77, Truth Loop 127/127, and final responsive Library acceptance 8/8. Completion planner classified the closed repair scope high-risk UI at this exact time. | Release-branch push, exact-head remote CI, hosted/provider qualification, and authenticated human acceptance remain separate gates. Production remains `v0.15.0` until those gates and the governed tag/main promotion path pass. |
| 2026-09-02T01:35:57Z | Production-canary hardening qualification | pending checkpoint | Added local required-field sign-in validation with focus/error semantics and blocked Decision Debt before its callable when the tenant IANA time zone is absent. Focused suites passed 20/20; Firestore rules passed 77/77; full unit passed 4,262 with 79 intentionally skipped; `lane:release`, `lane:firebase-auth-rules`, environment, project-state, capability-surface, docs-governance, production build, bundle budget, Truth Loop 127/127, and responsive unauthenticated browser acceptance all passed. | Exact-path checkpoint, remote CI, governed deployment, authenticated production readback, and reversible catalog canary remain pending. No production write has occurred in this hardening checkpoint. |
| 2026-09-02T02:06:03Z | Exact-head CI bundle repair | `a95d228` to pending repair | GitHub run `33580436842` passed classification, quick, core, Docker, Product Truth, authoritative-pricing, CWV, and Firebase auth/rules but stopped before Playwright because the Ambient bundle exceeded its temporary exception by 1,108 bytes. The client validation was reduced to browser-native required constraints and concise local Decision Debt recovery without widening the exception. The exact Ambient profile now passes at 4,056,369/4,056,372 bytes; focused tests passed 12/12; canonical `lane:release` passed with 4,262 unit and 127 Truth Loop tests; responsive accessibility passed 3/3. | A new checkpoint SHA, exact-head remote CI rerun, merge/tag/deployment, production readback, and catalog canary remain pending. Production was not mutated by the failed CI run. |

## Per-slice execution record

Each slice begins at a clean checkpoint, refreshes the bounded inventory once for the new source fingerprint, runs focused tests, inspects the exact diff, updates this ledger and canonical documentation, and commits exact paths only. Checkpoint commits are continuation points, not session endpoints.

## Final evidence boundary

Local source and test evidence qualifies repair checkpoint `f5d0c24` only.
Hosted behavior, provider state, production readiness, and authenticated human
acceptance remain separate future gates. The user later requested deployment,
but repository policy rejects this local topic branch before provider mutation:
the approved deployer requires a clean, remotely published `release/vX.Y.Z`
head, its exact successful CI run, the fixed staging profile, and a typed
SHA-bound confirmation. No ad hoc Vercel CLI deployment, push, merge, provider
mutation, or production claim was made.

## Changed path inventory

The bounded program owns and changed these exact repository paths:

```text
CHANGELOG.md
docs/FEATURE_MATRIX.md
docs/USER_MANUAL.md
docs/capability-surfacing-contracts.json
docs/plans/20260831-business-setup-revision-review.md
e2e/quote-wizard.smoke.spec.js
firestore.rules
functions/catalogImportBatches.js
functions/catalogSetupDrafts.js
functions/index.js
functions/pricingEngine.js
functions/quoteCatalogRevisionReview.js
functions/quoteCreation.js
functions/starterCatalogPacks.js
src/App.jsx
src/components/AdminCatalogModal.jsx
src/components/AmbientLibraryRoute.jsx
src/components/BusinessSetupCenter.jsx
src/components/CatalogDraftStateBar.jsx
src/components/CommercialChangeImpactPanel.jsx
src/components/ImportStudioModal.jsx
src/components/QuoteCatalogRevisionReviewPanel.jsx
src/components/UnifiedCommercialConsequenceReview.jsx
src/components/WorkspaceShell.jsx
src/components/__tests__/adminCatalogSaveCapabilityState.test.jsx
src/components/__tests__/ambientLibraryRoute.test.jsx
src/components/__tests__/adminCatalogStarterChoice.test.jsx
src/components/__tests__/businessSetupCenter.test.jsx
src/components/__tests__/catalogDraftStateBar.test.jsx
src/components/__tests__/packageWorkspace.test.jsx
src/components/__tests__/quoteCatalogRevisionReviewPanel.test.jsx
src/components/__tests__/unifiedCommercialConsequenceReview.test.jsx
src/components/__tests__/workspaceShell.test.jsx
src/components/ambientLibraryRoute.css
src/components/marginPresentation.js
src/data/mockCatalog.js
src/hooks/__tests__/useCatalogData.savePlan.test.js
src/hooks/__tests__/useCatalogSetupDraft.test.jsx
src/hooks/useCatalogData.js
src/hooks/useCatalogSetupDraft.js
src/lib/__tests__/ambientLibrary.test.js
src/lib/__tests__/businessReadiness.test.js
src/lib/__tests__/capabilitySurfacingGate.test.js
src/lib/__tests__/catalogSetupDraftService.test.js
src/lib/__tests__/catalogSetupDrafts.server.test.js
src/lib/__tests__/pricingEngine.authoritative.test.js
src/lib/__tests__/quoteCatalogRevisionReview.server.test.js
src/lib/__tests__/quoteCreation.server.test.js
src/lib/__tests__/starterCatalogPacks.server.test.js
src/lib/__tests__/unifiedCommercialConsequenceReview.test.js
src/lib/__tests__/workspaceShellModel.test.js
src/lib/ambientLibrary.js
src/lib/businessReadiness.js
src/lib/catalogSetupDraftService.js
src/lib/importStudio.js
src/lib/menuService.js
src/lib/quoteCalculator.js
src/lib/quoteCatalogRevisionReview.js
src/lib/quoteDraftRuntimeBase.js
src/lib/quoteStore.js
src/lib/unifiedCommercialConsequenceReview.js
src/lib/workspaceShellModel.js
src/rules/__tests__/firestore.rules.test.js
src/styles.css
e2e/ambient-library.spec.js
e2e/v16-calm-four-acceptance.spec.js
```
