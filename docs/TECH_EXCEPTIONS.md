# Technology Exceptions

Last updated: August 9, 2026

Use this log when a change intentionally departs from stable-first policy or requires temporary governance/performance exception handling.

## Record Template
- Date:
- Owner:
- Change:
- Exception type: `major-upgrade` | `perf-threshold-temp` | `other`
- Rationale:
- Risk impact:
- Performance impact:
- Rollback plan:
- Exit criteria:
- Verification evidence:

## Active Exceptions

- Date: August 9, 2026
- Owner: QuotePilot maintainers
- Change: Temporarily raise the aggregate JavaScript allowance from 5% to 5.5%
  for the customer-centered workspace convergence branch without changing the
  clean-main baseline.
- Exception type: `perf-threshold-temp`
- Rationale: The complete routed staff workspace, Customer 360, mutation-state
  recovery, and staff evidence presentation are being qualified together on an
  unmerged branch. The clean-main baseline cannot be truthfully regenerated
  until that source lands.
- Risk impact: Aggregate lazy-loaded JavaScript may grow by up to an additional
  0.5 percentage point during this branch. The largest-chunk gate remains
  unchanged and all new work remains subject to build and browser checks.
- Performance impact: The August 9 build contains 2,100,135 JavaScript bytes
  versus the 1,997,365-byte clean-main baseline (5.15% growth); the largest
  chunk is 390,494 bytes, within the existing largest-chunk allowance.
- Rollback plan: Revert the allowance to 5% and remove or defer enough branch
  source to pass the prior threshold.
- Exit criteria: After the workspace source lands, build from a clean updated
  `main`, reset the exact baseline per policy, restore the normal 5% allowance,
  and pass bundle, CWV, default-route, and flagged-workspace browser checks.
- Verification evidence: `npm run build`, `npm run check:perf:bundle`, the full
  unit suite, and default plus flagged Playwright lanes.

## Resolved Exceptions

- Date: July 26, 2026
- Resolved: August 6, 2026
- Owner: QuotePilot maintainers
- Change: Retain the current aggregate JavaScript baseline while adding the hospitality-first public route and lazy route boundaries for the saved system page and authenticated workspace.
- Exception type: `other`
- Rationale: The baseline was established from this feature branch rather than clean `main`. The redesigned marketing surface adds no animation dependency, and the heavy workspace, Firebase, export, and saved-system code is no longer part of the default route entry.
- Risk impact: The aggregate baseline resets from the current branch instead of a clean-main checkout, so the next release review must compare the merged build before accepting further bundle growth.
- Performance impact: Current aggregate JavaScript is 1,731,347 bytes against a 1,691,847-byte baseline, and the largest chunk is 397,905 bytes. The default route entry is 19,667 bytes plus the shared React chunk; its generated hero is 155,574 bytes. Local Lighthouse measured performance 0.88, LCP 3,722 ms, CLS 0.0012, and TBT 1 ms.
- Rollback plan: Revert the hospitality landing, route handoff, and saved-system route together.
- Exit criteria: Reconfirm or tighten the baseline from clean `main` after this feature lands and before approving another intentional aggregate-bundle increase.
- Resolution: Regenerated the baseline from the fully converged clean `main` checkout at 1,997,365 total JavaScript bytes and a 387,929-byte largest chunk, then tightened the forward allowance from 15% to 5%.
- Verification evidence: `npm run build`, `npm run check:perf:bundle`, the full general Playwright lane, focused Firebase starter-onboarding and authoritative-pricing lanes, and the static interaction audit.
