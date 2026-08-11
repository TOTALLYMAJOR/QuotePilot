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
- The clean-main maximum is the recorded baseline plus its normal 5% allowance.
- A temporary exception, when present in
  `docs/performance/bundle-exception.json`, supplies separate absolute ceilings
  for aggregate JavaScript and the largest chunk. The guard accepts it only
  when its ID is active and its pinned baseline date and metrics exactly match
  `bundle-budget.json`.
- The workspace-convergence exception (now including the flag-gated pilot
  candidates: NOW home surface, Event Room ring/decide stack, guided-selling
  decide cards, the CREATE intake canvas with its band pricing strip, and
  the client-request panel with its structured-record boundary, the Event Room cascade panel, the Pilot command bar, and the fail-closed margin strip) is
  currently capped at
  2,747,044
  aggregate JavaScript bytes and a 391,596-byte largest chunk. CI Quality
  run `31447641093` on the bugfix commit (`20f69e7`) confirmed the default-off
  2,747,012-byte figure exactly. The release candidate's production-flag build
  is 32 bytes larger in a same-environment comparison, so the temporary ceiling carries that exact
  configuration delta over the confirmed CI value; the release PR repeats the
  production-flag build and bundle guard to confirm the extrapolation. See
  `docs/TECH_EXCEPTIONS.md` for the full basis. Against the unchanged
  clean-main baseline, aggregate output is 749,679 bytes (37.53%) larger, while
  the largest chunk is 3,667 bytes (0.95%) larger and
  remains 15,729 bytes below the normal 5% largest-chunk ceiling. Targeted quote-store
  splitting keeps the authenticated route bounded, and route-level
  splitting keeps the new Customer 360, Messaging Station, Workflow,
  commercial-authority, Decision Debt, Revenue Autopilot, and BEO surfaces out
  of the public entry chunk, but aggregate download, parse, and execution cost
  still requires explicit remediation or reviewed post-merge recalibration.
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
