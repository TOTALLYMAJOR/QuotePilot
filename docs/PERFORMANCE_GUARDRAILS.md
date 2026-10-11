# Performance Guardrails

Last updated: 2026-10-10 21:06:24 CDT

## Objectives
Keep delivery speed high while protecting end-user experience and predictable performance.

## Hard Gates
CI blocks merges when either gate fails:
- Bundle budget gate: `npm run check:perf:bundle`
- Core Web Vitals smoke gate (Lighthouse CI): `npm run check:perf:cwv`

## Bundle Budget Policy
Baseline file: `docs/performance/bundle-budget.json`

Measured metrics:
- `totalJsBytes`: total JavaScript bytes in `dist/assets`
- `largestJsChunkBytes`: largest single JavaScript asset in `dist/assets`

Threshold policy:
- The clean-main maximum is the recorded baseline plus its normal 5% allowance.
- A temporary exception, when present in
  `docs/performance/bundle-exception.json`, supplies graph-specific absolute
  ceilings. The guard detects the emitted graph from required chunk markers,
  rejects a requested-profile mismatch, and accepts an exception only when its
  active ID and pinned baseline date and metrics exactly match
  `bundle-budget.json`.
- The current compatibility graph has a temporary 3,652,845-byte aggregate
  and 399,665-byte largest-chunk ceiling. The production-equivalent Ambient
  graph has a separate temporary 4,947,989-byte aggregate ceiling and
  445,422-byte largest-chunk ceiling. The pre-authority local
  measurements were 2,769,824 / 391,596 bytes for compatibility and 3,700,202
  / 391,596 bytes for Ambient. The deduplicated owner-provisioning recovery
  states add 2,651 Ambient aggregate bytes, for a reviewed 3,702,853-byte local
  graph. The Ambient aggregate ceiling adds only the previously observed
  303-byte CI-versus-local offset; it is not general growth headroom.
  The owner/admin Team access authority then measures 2,784,674 / 391,901
  locally for compatibility and 3,715,051 / 391,901 for Ambient. Its exact
  recalibration retains only the previously observed per-profile CI offsets
  (7,025 and 303 bytes respectively). The App Check provider module remains
  build-excluded while its explicit browser flag is false; later provider
  promotion requires its own exact bundle review.
  The operational Staff and invitation release then established 2,880,654-byte
  compatibility and 3,804,078-byte Ambient ceilings without increasing the
  largest chunk. The current Pingram source candidate measures 2,891,116 bytes
  for compatibility and 3,817,075 bytes for Ambient. Its profile ceilings add
  only the already observed 7,025-byte and 303-byte runner offsets; this is not
  general product-growth headroom.
  The quote-builder decision-flow slice then measures 2,899,957 bytes for the
  compatibility graph and 3,825,917 bytes for Ambient. Its exact ceilings keep
  those same runner offsets and the 391,901-byte largest-chunk limit; no general
  product-growth headroom was added.
  The first Live planning and Staff People presentation slice then measured
  2,963,542 / 391,901 bytes for compatibility and 3,749,888 / 391,901 for
  Ambient. The shared shell and Now visual-system pass measures 2,964,327 /
  391,901 bytes for compatibility and 3,750,363 / 391,901 for Ambient.
  The earlier combined source checkpoint measured 3,206,553 / 387,248 bytes
  for compatibility and 3,887,673 / 387,248 bytes for Ambient. Exact-SHA CI run
  `33239048234` on release candidate `6ff9d605` measured 3,208,826 / 384,998
  bytes for compatibility and 3,928,479 / 388,269 bytes for Ambient. The
  CI-equivalent local Ambient build measured 3,928,552 / 388,303 bytes. The
  earlier Ambient ceiling was pinned to that larger literal exact-candidate
  measurement; the 73-byte local/runner difference was the only retained
  environment margin.
  The approved v0.16 Calm Four and Quick Updates candidate now measures
  3,214,012 / 385,130 bytes for compatibility and 4,017,689 / 385,130 bytes
  for the exact production-equivalent Ambient graph. Lazy-loading the customer
  portal removes it from the Ambient workspace chunk, bringing that chunk
  below the unchanged largest-chunk ceiling; Firebase is again the largest
  emitted asset. Compatibility remains below the Calm Four source candidate's
  already reviewed absolute ceiling; the reconciliation restores that exact
  source-approved value rather than widening it again.
  The Calm Four Ambient aggregate ceiling was therefore 4,017,992 bytes: the
  literal candidate measurement plus only the previously established 303-byte
  Ambient runner offset. This reconciliation is not general product-growth
  headroom; any source increase beyond that offset must fail or receive a new
  explicit review.
  The Business Setup and revision-review program measures 3,224,340 / 385,181
  bytes for the compatibility graph and 4,050,831 / 385,181 bytes for the
  config-free Ambient graph. The compatibility ceiling remains 3,231,504
  aggregate bytes. Exact-head CI run `33540311518` then measured the
  Firebase-configured production-equivalent Ambient graph at 4,056,299 /
  385,181 bytes; the same CI-equivalent graph measured 4,056,372 / 385,181
  locally. The Ambient ceiling is therefore 4,056,372 aggregate bytes, the
  larger literal verified graph, with no discretionary growth headroom. The
  largest-chunk ceiling remains unchanged.
  The v0.16.3 reconciliation initially measured 3,295,659 / 393,459 bytes for the
  compatibility graph after restoring the approved staff task continuity,
  return-context, and durable action-feedback contracts on current main. Its
  aggregate ceiling retains only the previously established 7,025-byte
  compatibility runner offset. Exact-head CI run `33782951695` exercised the
  complete compatibility flag matrix and measured 3,298,166 / 395,862 bytes;
  the same matrix measured 3,298,234 / 395,896 bytes locally. The
  largest-chunk ceiling is therefore the larger literal verified measurement,
  not discretionary headroom. Exact-head CI then measured the complete Ambient
  production flag matrix at 4,164,201 / 429,869 bytes; its local reproduction
  measured 4,164,269 / 429,903 bytes. The Ambient ceilings are the larger
  literal verified graph, not a percentage allowance. The increase is carried
  by the approved cross-route continuity, return-context, and action-feedback
  contracts across the shared route and their already-lazy feature surfaces;
  recovering it is tracked optimization debt rather than a safe reconciliation
  deletion.
  The controlled Resend acceptance surface keeps its client adapter inside the
  already-lazy Integrations Ops boundary. Exact local CI-flag builds measure
  3,306,709 / 395,916 bytes for compatibility and 4,172,754 / 429,923 bytes
  for Ambient. The ceiling changes are pinned to those literal graphs: 4,025
  and 8,485 aggregate bytes respectively, plus 20 bytes in each largest route
  chunk. This is reviewed capability cost, not discretionary headroom.
  The shared commercial kernel subsequently moved the exact compatibility
  ceiling to 3,330,544 bytes. Promoting Calendar-first Operations into the
  existing Ambient orientation adds 860 aggregate compatibility bytes and does
  not grow the largest chunk; that checkpoint's ceiling is pinned to the measured
  3,331,404 / 394,674-byte graph with no percentage headroom. The separately
  detected Ambient ceiling remained unchanged at that checkpoint because its
  then-measured graph stayed below the existing absolute limit.
  A later reproduction of the complete CI flag matrix showed that the
  pre-Library Operations head itself emitted 3,333,438 / 397,090 bytes for
  compatibility and 4,240,261 / 431,619 bytes for Ambient, so the published
  full-profile ceilings were stale even before the Library refinement. The
  Library nested-commercial-object implementation at
  `b593fe4d2c45ff5db20bafe205461157952b9ab4` adds 45,724 aggregate
  compatibility bytes and 61,440 aggregate Ambient bytes. The Ambient delta is
  isolated to the already-lazy Library surfaces: 45,370 bytes in Catalog Admin,
  10,380 in Event Templates, 4,819 in the Library route, and 871 in the shared
  Workspace route. The corresponding transferred gzip growth is approximately
  10.6 KB for compatibility and 14.6 KB for Ambient. Removing the full raw-byte
  delta safely would remove selected editor behavior; chunk splitting would not
  reduce this aggregate guard. The current ceilings therefore equal the literal
  local complete-profile measurements of 3,379,162 / 397,409 and 4,301,701 /
  432,490 bytes. Exact-head CI run `33951463058` on
  `3eecfa89d8bf843089bae9921a2bdf655b715b73` then measured the completed
  compatibility graph at 3,381,257 / 397,428 bytes after every browser case
  passed. Exact-head follow-up run `33952106871` then measured the completed
  Ambient graph at 4,319,173 / 432,561 bytes after the compatibility build
  passed. Both ceilings are pinned to those larger literal CI graphs; neither
  profile receives percentage or future-growth headroom. This budget evidence
  is not hosted, production, or human acceptance.
  The field-state, interaction-integrity, and Import Workbench candidate was
  then rebuilt locally under both exact `ci-quality.yml` flag matrices.
  Compatibility measures 3,476,619 / 399,646 bytes and Ambient measures
  4,427,364 / 435,494 bytes. Against the preceding local Library graphs, the
  reviewed source deltas are 97,457 / 2,237 bytes and 125,663 / 3,004 bytes. The
  temporary ceilings add those literal source deltas to the preceding exact-CI
  ceilings, retaining only the already observed profile-specific runner
  differences: 3,478,714 / 399,665 for compatibility and 4,444,836 / 435,565
  for Ambient. This is not percentage or future-growth headroom.
  The Guided Inquiry Showcase plus the explicit browser-gated model-assist
  binding now measures the exact local CI matrices at 3,517,367 / 385,181
  bytes for compatibility and 4,796,685 / 443,563 bytes for Ambient. The
  exception aggregate ceilings are pinned to those literal graphs; the
  existing 399,665-byte and 445,000-byte largest-chunk ceilings remain
  unchanged. The increase is distributed across the new lazy public inquiry,
  Library administration, Opportunities queue, recovery, and conversion
  surfaces; it is reviewed feature cost, not future growth headroom. Exact-PR
  CI must still confirm both graphs before release.
  The v0.20.0 combined-open-work candidate adds Delivery Planning, Google
  Calendar operations, event notes and attendance, server-bound commercial
  Staffing and Inventory observations, progressive client loading, and the
  Commercial Decision Surface. Exact local CI-matrix builds measure
  3,652,845 / 385,181 bytes for compatibility and 4,947,989 / 445,422 bytes
  for Ambient. The aggregate ceilings and Ambient largest-chunk ceiling are
  pinned to those literal graphs; the compatibility largest-chunk ceiling
  remains unchanged. This is reviewed combined-candidate cost with no future
  growth allowance, and exact-PR CI remains required.
  Reproducing that complete local flag matrix from clean committed HEAD
  `568d86bb1505c32c00319a23a854cfb7b068ddf5` measured 4,951,064 / 447,746
  bytes, already 3,075 / 2,324 bytes over the preceding Ambient exception.
  The current open-work graph initially measured 4,965,582 / 461,976 bytes.
  Moving the default-off Create intake implementation behind its existing
  feature gate and a recoverable lazy boundary reduces the shared Workspace
  chunk to 432,767 bytes. The extra lazy-chunk wrapper adds 830 aggregate bytes,
  so the resulting graph measures 4,966,412 aggregate bytes; this is packaging,
  not deleted capability. The Ambient aggregate ceiling is pinned to that
  literal local graph while the 445,422-byte largest-chunk ceiling remains
  unchanged. Exact-PR CI, Core Web Vitals, hosted timing, production behavior,
  and human acceptance remain separate evidence gates.
  The subsequent exact imported-menu review handoff adds bounded route intent,
  exact record focus, and a principal-bound 30-minute task freshness fence.
  Fresh exact-source Ambient builds measure 4,968,733 / 435,222 bytes. The
  temporary ceiling is pinned at 4,968,757 / 445,422 bytes, retaining 24 / 10,200
  bytes of margin with no percentage or future-growth allowance. Removing the delta
  would remove the governed handoff or its stale-task protection, and moving
  the same code between chunks would not reduce the aggregate metric. The
  Ambient aggregate ceiling remains a bounded exception rather than a baseline.
  Searchable-PDF inspection additionally emits 1,667,684 raw runtime bytes in
  `dist/vendor/pdfjs-5.7.284`, with a 1,232,303-byte worker as its largest file.
  These assets are same-origin and load only after PDF inspection begins; they
  are excluded from `dist/assets` aggregate JavaScript by design and therefore
  have their own exact byte-and-SHA-256 manifest in
  `docs/performance/optional-tool-budget.json`. The bundle guard rejects a
  changed, missing, additional, or unbudgeted optional runtime asset.
  `ambient-opportunity-model` and `quote-builder-ui` chunk boundaries reduced
  the Ambient largest chunk from 436,188 bytes before Team access; at that
  checkpoint the largest chunk was 391,901 bytes. The remaining
  aggregate cost must still be optimized or replaced by an explicitly reviewed
  clean-main baseline decision before legacy retirement or Ambient promotion.
  See `docs/TECH_EXCEPTIONS.md` for rationale and exit evidence.
- An active exception prevents `--update-baseline`; remove it before producing
  a new clean-main baseline. Passing under an exception is branch budget
  compliance, not Core Web Vitals, hosted, production, or human-acceptance
  evidence.

Regenerate baseline (intentional only):
```bash
git checkout main
git pull origin main
npm run build
npm run check:perf:bundle -- --update-baseline
```

The current baseline was regenerated from the fully converged clean `main`
checkout on August 7, 2026. It captures 1,997,365 total JavaScript bytes and a
387,929-byte largest chunk; the prior temporary 15% allowance was tightened to
5% when that exception closed.

Baseline updates must include a brief reason in PR notes.
Run baseline updates only from a clean `main` checkout. A temporary exception
must stay separate from the baseline and must be removed before recalibration.

## CWV Smoke Policy
Lighthouse CI config: `.lighthouserc.json`
The CI lane builds a fresh production bundle, explicitly selects the
Playwright-managed Chromium binary, and runs a local `vite preview` server on
the strict `127.0.0.1:4173` endpoint. Readiness detection matches Vite's stable
`Local` label so ANSI terminal formatting cannot delay the audit. The runner
sets `TMPDIR`, `TMP`, and `TEMP` to Linux `/tmp` so Chrome profiles remain OS
scratch artifacts rather than repository or runner-workspace state.

The latest `@lhci/cli` release still pins vulnerable Lighthouse 12.6.1. The
root dependency policy therefore overrides only the Lighthouse copies used by
`@lhci/cli` and `@lhci/utils` to 13.4.1. This selects Puppeteer 25.9.0 and
removes the vulnerable `extract-zip` chain while preserving the existing LHCI
configuration and thresholds. Treat this as a reviewed major-tool
compatibility exception until LHCI publishes a release with a non-vulnerable
Lighthouse dependency; exact local and CI CWV gates remain mandatory.

Current enforced assertions:
- Performance category score minimum
- LCP maximum threshold
- CLS maximum threshold
- TBT maximum threshold

## Authenticated workspace route performance

`npm run calibrate:perf:routes` builds an isolated production Ambient graph and
runs each of Now, Clients customer detail, Inventory, and quote review five
times. `npm run check:perf:routes` runs each three times and evaluates the median
of route bytes, route-start to usable core, and route-start to supplemental
completion separately. `npm run test:perf:routes` checks the aggregation and
fail-closed budget rules; either browser command accepts `-- --list` to inspect
the exact test matrix without a build or browser run.

The fixed profile is `ambient-local-staff-v1`: Chromium, 1440 x 900, DPR 1,
4x simulated CPU slowdown, 40 ms latency, 200,000 bytes/s download and 93,750
bytes/s upload, cold contexts with cache disabled, reduced motion, fixed
2026-10-10 wall-clock date and deterministic random seed. These are declared
test inputs, not measured device capabilities. Google Fonts stylesheet/font
requests are aborted in this isolated profile, using the native font fallback;
their transfer bytes and font-service latency are excluded explicitly. Other
external services fail the scenario. The exact installed Playwright
version, host CPU/OS, Git HEAD/dirty state, and SHA-256 of the built HTML/assets
are recorded in each receipt. The strict loopback preview never reuses another
server; its build marker must match before route navigation.

Only Date and the fixture's random/data inputs are overridden. Native
Performance and native timers remain intact: Playwright 1.58.2's fixed-time
clock also replaces Performance and cannot supply native mark/resource entries
for this measurement contract.

Route bytes are encoded resource bodies initiated from document arrival through
the matched supplemental-complete mark, plus the document body. They include
the shared shell as well as route assets; they are not incremental warm-route
bytes or total raw emitted bundle bytes. The two stage durations start at the
application's actual `markRouteStage` route-start mark, so shell/bootstrap time
before that mark is recorded separately as `documentToRouteStartMs`. Only a
matched navigation with usable-core outcome `ready` can qualify. Supplemental
`partial` remains explicit in the receipt; errors, unavailable stages, missing
marks, failed tests, missing runs, or uncalibrated budgets fail closed. No
test-created performance marks are permitted.

This profile uses the existing synthetic admin session and local quote data.
It does not prove Firebase authentication, persistence, hosted timing,
production timing, accessibility, visual acceptance, or physical-device
performance. It covers the Ambient graph only. The existing authenticated
Inventory success fixture lives inside
`e2e/inventory-workspace-responsive.spec.js` and requires the Firebase emulator
tenant-authority profile; the local fallback cannot qualify Inventory. Until a
successful authorized fixture is available to this gate, Inventory calibration
is BLOCKED and the command exits nonzero. This command is available for CI use
but is not yet wired as a required CI job.

Quote review also requires the organization Library in the production
transform. `useCatalogData` permits local catalog fallback only in a development
transform; setting its fallback flag or seeding a local catalog does not grant
production Library availability. This Firebase-free profile therefore cannot
qualify quote review either. No development transform or invented catalog or
Inventory authority may be substituted to make calibration pass. Ambient Now
reports real bounded-read readiness once per organization/mount, including
partial/error/stale outcomes; canonical `clients` is accepted by the same route
mark allow-list as its customer-detail alias.

`docs/performance/route-performance-budget.json` starts uncalibrated with no
ceilings. A fully successful five-run calibration emits an ignored
`output/playwright/quotepilot-route-performance-*/budget-proposal.json` with
nearest-rank p75 plus 10% headroom, rounded up to integer bytes/milliseconds.
Review the measured receipt before replacing the budget; the command never
changes committed ceilings automatically. The check rejects a ceiling that
does not equal its recorded p75 + 10% calculation. Any ceiling increase requires
a new successful measured calibration, retained receipt, and review. Existing
bundle and CWV budgets remain independent.

The October 10 integrated dirty-worktree snapshot passes the unchanged Ambient
exception at 4,964,683 total JavaScript bytes versus 4,968,757 allowed (4,074
bytes headroom); its largest chunk is 385,181 bytes versus 445,422 allowed.
This narrow artifact margin is not a request to raise the ceiling. Now and
Clients have repeatable route-stage measurements, while Inventory and quote
review remain deliberately uncalibrated until authorized production-profile
fixtures exist. Those blocked scenarios must remain failures rather than being
replaced with local fallback authority.

## Exception Workflow
If a change needs temporary threshold relaxation or major dependency upgrade:
1. Add/update record in `docs/TECH_EXCEPTIONS.md`.
2. Include risk/perf/rollback notes.
3. Restore normal guardrails as soon as remediation lands.
