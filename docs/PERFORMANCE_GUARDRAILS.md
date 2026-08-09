# Performance Guardrails

Last updated: August 9, 2026

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
- Maximum allowed = baseline plus the allowance recorded in the baseline file.
- The normal allowance is 5%. A temporary 5.5% branch allowance is active for
  the customer-centered workspace convergence and is governed by
  `docs/TECH_EXCEPTIONS.md`; the clean-main baseline is unchanged.

Regenerate baseline (intentional only):
```bash
git checkout main
git pull origin main
npm run build
npm run check:perf:bundle -- --update-baseline
```

The current baseline was regenerated from the fully converged clean `main`
checkout on August 6, 2026. It captures 1,997,365 total JavaScript bytes and a
387,929-byte largest chunk; the prior temporary 15% allowance was tightened to
5% when that exception closed.

Baseline updates must include a brief reason in PR notes.
Run baseline updates only from a clean `main` checkout unless an exception is recorded.

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
