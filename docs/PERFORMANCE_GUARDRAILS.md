# Performance Guardrails

Last updated: 2026-09-04 15:23:00 CDT

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
- The current compatibility graph has a temporary 3,331,404-byte aggregate
  and 395,916-byte largest-chunk ceiling. The production-equivalent Ambient
  graph has a separate temporary 4,172,754-byte aggregate ceiling and
  429,923-byte largest-chunk ceiling. The pre-authority local
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
  not grow the largest chunk; the current ceiling is pinned to the measured
  3,331,404 / 394,674-byte graph with no percentage headroom. The separately
  detected Ambient ceiling remains unchanged because that graph stays below its
  existing absolute limit.
  `ambient-opportunity-model` and `quote-builder-ui` chunk boundaries reduced
  the Ambient largest chunk from 436,188 bytes before Team access; the current
  largest chunk is 391,901 bytes. The remaining
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

## Exception Workflow
If a change needs temporary threshold relaxation or major dependency upgrade:
1. Add/update record in `docs/TECH_EXCEPTIONS.md`.
2. Include risk/perf/rollback notes.
3. Restore normal guardrails as soon as remediation lands.
