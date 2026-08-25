# Performance Guardrails

Last updated: 2026-08-25 00:58:05 CDT

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
- The current compatibility graph has a temporary 3,221,176-byte aggregate
  and 391,901-byte largest-chunk ceiling. The production-equivalent Ambient
  graph has a separate temporary 3,905,603-byte aggregate ceiling and
  the same 391,901-byte largest-chunk ceiling. The pre-authority local
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
  The current reconciled source candidate measures 3,221,176 / 387,248 bytes
  for the explicit compatibility production graph and 3,905,603 / 387,248
  bytes for the explicit Ambient production graph. Those exact local
  measurements are the temporary ceilings; exact-SHA CI must independently
  confirm them. This recalibration is not general product-growth headroom.
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
`Local` label so ANSI terminal formatting cannot delay the audit.

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
