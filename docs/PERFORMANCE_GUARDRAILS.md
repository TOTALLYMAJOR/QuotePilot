# Performance Guardrails

Last updated: 2026-10-11 04:13:28 CDT

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

The fixed profile is `ambient-emulator-staff-v2`: Chromium, 1440 x 900, DPR 1,
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

Route bytes are same-origin encoded resource bodies completed by the matched
supplemental-complete mark, plus the document body. They include the shared
shell and route assets, but exclude unfinished requests, cross-origin emulator
traffic and headers. They are not total wire bytes, incremental warm-route
bytes or raw emitted bundle bytes. The two stage durations start at the
application's actual `markRouteStage` route-start mark, so shell/bootstrap time
before that mark is recorded separately as `documentToRouteStartMs`. Only a
matched navigation with usable-core outcome `ready` can qualify. Supplemental
`partial` remains explicit in the receipt; browser errors or unexpected external
origins retained after final UI assertions, unavailable stages, missing
marks, failed tests, missing runs, or uncalibrated budgets fail closed. No
test-created performance marks are permitted.

The disposable fixture rejects every project/host combination except
`demo-qp-routeperf`, Auth `127.0.0.1:9498`, and Firestore `127.0.0.1:8488` before
writing. It seeds one administrator, organization, Library, customer and quote.
Inventory projections are generated through the existing authority runtime's
location, ingredient and opening-balance commands, not injected by browser code.
The browser signs in through the real Auth emulator and completes the actual
"Explore the workspace" prompt before the measured cold document reload; the
organization-scoped session choice is restored by the application, not injected
by the test. The application reads tenant roles and data through Firestore
rules. No production auth bypass or local catalog fallback is enabled.
Functions on `127.0.0.1:5998` exposes only the real staff-authorized
`getRevenueAutopilotOperations`, `getDecisionDebtSnapshot`, and
`getRevenueAutopilotCustomerControls` read handlers. Its temporary source copies
tracked JS/CJS and explicitly named package/catalog JSON only; no local dotenv
or secret file is copied, and child environments exclude inherited credentials.
An empty per-run Firebase CLI configuration and an explicitly nonexistent ADC
path prevent discovery of the operator's saved login or Google credentials;
the operator's home directory and credential files are not changed.
No write endpoint, schedule, or Firestore trigger is exported by that wrapper.
The browser blocks all other callable paths before transmission, including
bootstrap writes, preserving the application's existing read-only role fallback.
Other unexpected external requests are also blocked and fail the scenario.

This covers local emulator authentication and the Ambient production transform,
not hosted authentication/timing, provider behavior, production timing,
accessibility, visual acceptance, physical-device performance or physical stock.
The command is available for CI use but not yet a required CI job. Ambient Now
reports real bounded-read readiness once per organization/mount. A fresh
successful attention or history read establishes usable core independently of
the order or outcome of sibling reads. Pending/error-only reads do not establish
usable core; retained stale content remains partial, and supplemental completion
retains partial/error/unavailable outcomes. This is telemetry correctness, not
event-wide operational readiness. Canonical `clients` is accepted by the same route
mark allow-list as its customer-detail alias.

`docs/performance/route-performance-budget.json` retains the reviewed October 11
five-run calibration. A fully successful new calibration emits an ignored
`output/playwright/quotepilot-route-performance-*/budget-proposal.json` with
nearest-rank p75 plus 10% headroom, rounded up to integer bytes/milliseconds.
Review the measured receipt before replacing the budget; the command never
changes committed ceilings automatically. The check rejects a ceiling that
does not equal its recorded p75 + 10% calculation. This arithmetic/profile check
does not authenticate the calibration receipt; comparing the retained five runs
with the proposed p75 values remains a mandatory review step. Any ceiling increase
requires a new successful measured calibration, retained receipt, and review. Existing
bundle and CWV budgets remain independent.

The October 11 calibration at HEAD
`216431a256d31c585be97be719e1fabbeec68d93` plus dirty repairs passed all 20
scenarios. Its build hash, fixed profile, all samples, diagnostics and exact
p75/ceiling arithmetic are retained in
[`route-performance-calibration.json`](performance/route-performance-calibration.json).
The source receipt is `output/playwright/quotepilot-route-performance-sYfMr3/receipt.json`.
All core/supplemental outcomes were `ready`; no browser errors or unexpected
external origins were recorded. Independent review recomputed every ceiling.

| Route | Encoded-body ceiling (bytes) | Route-start to core ceiling (ms) | Route-start to supplemental ceiling (ms) |
| --- | ---: | ---: | ---: |
| Now | 707,096 | 703 | 1,027 |
| Clients | 745,114 | 1,257 | 1,498 |
| Inventory | 698,850 | 2,155 | 2,155 |
| Quote review | 794,701 | 2,462 | 2,464 |

These are not full cold-page-load durations. The same five samples yield
document-to-core p75s of 5.388, 5.657, 6.143 and 6.650 seconds respectively;
document/bootstrap time remains visible in each sample and is not hidden by the
shorter route-stage timings. The independent three-run check used the same build
hash and passed all 12 browser scenarios, but its budget result is **FAIL**.
Now, Clients and all byte ceilings pass. Inventory core/supplemental medians
are 2,994.8/2,994.9 ms against 2,155/2,155 ms; quote review is 2,488.5/2,489.3 ms
against 2,462/2,464 ms. The complete failed check is retained under
`threeRunVerification` with its source receipt `2oWf32`. Shared-host load was
elevated, but causal attribution is unproven. No ceiling was changed to absorb
the failure; that check did not qualify the candidate.

The predeclared final three-run batch `XiQcPO`, after the focus repair and green
full browser suite, passes all twelve visits and every unchanged ceiling.
Its production build SHA is
`027c8e5ab9c0159e8f52b3a5d0e5dcac938836db32667045d1952584255521e6`.
The compact receipt retains all twelve samples under `candidateVerifications`,
plus the raw receipt SHA and unchanged comparison-budget SHA. The original
failed `threeRunVerification` remains unchanged. This is one successful local
qualification of the new candidate, not evidence that the focus repair caused
the timing difference or that shared-host variability has been eliminated.

| Route | Median encoded-body bytes | Median route-start to core (ms) | Median route-start to supplemental (ms) |
| --- | ---: | ---: | ---: |
| Now | 642,482 | 498.2 | 638.0 |
| Clients | 654,333 | 662.5 | 740.4 |
| Inventory | 635,470 | 1,083.2 | 1,085.4 |
| Quote review | 720,150 | 1,689.0 | 1,690.0 |

For diagnosis only, the direct Playwright child accepts
`ROUTE_PERF_DIAGNOSTIC=1` to record CDP CPU samples and path-only request timing
beside each repeat-indexed sample. The normal calibration/check launcher does
not forward this optional variable; the diagnostic requires a separate isolated
launcher with the same fixture/profile, not the standard budget command.
It does not retain
headers, payloads, or URL query strings. Profiled samples carry
`status: diagnostic-only`; both calibration and check aggregation reject them.
The retained local Inventory capture at
`/tmp/quotepilot-route-inventory-diagnostic-aQu9jj` observed 753 ms from
route-start to Inventory chunk discovery, 266.5 ms downloading it, and 814.1 ms
from download completion to usable core. Its 1,833.7 ms route-to-core result is
not a qualification run. System-wide CPU pressure overlapped the trace, but
neither an isolated Inventory computation hotspot nor the cause of the earlier
failed median was established. A profiled fast visit cannot replace that failure.

Earlier failed receipts remain failures: `NQd0MA` exposed missing Inventory
route-local settings readiness, `WpcZfs` exposed a 201-record ingredient query
against the existing 200-record authorization bound, and `q4OlZz` exposed a
test warm-up race with onboarding. No ceilings came from those runs. Bounded
owner-authorized App/rules inspection supported the repairs. Inventory now
displays 199 records with one lookahead, preserving pagination without changing
rules, permissions or fallback authority. The aggregate JavaScript exception
remains 4,968,757 bytes; route calibration does not alter bundle or CWV ceilings.

The later focus-repaired candidate passes the compatibility bundle check at
3,477,038 bytes and the Ambient check at 4,964,850 bytes (3,907 bytes below its
unchanged exception ceiling). Its standard local homepage Lighthouse run at
`2026-10-11T08:55:51.182Z` passes: performance 93, LCP 2,012.2345 ms, CLS
0.0172919, and TBT 276.741 ms. These static-profile checks do not qualify the
authenticated route medians. Branch-wide documentation governance separately
fails on 14 pre-existing timestamp debts; a passing working-tree-only check
does not establish release readiness.

## Exception Workflow
If a change needs temporary threshold relaxation or major dependency upgrade:
1. Add/update record in `docs/TECH_EXCEPTIONS.md`.
2. Include risk/perf/rollback notes.
3. Restore normal guardrails as soon as remediation lands.
