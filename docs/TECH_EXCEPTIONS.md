# Technology Exceptions

Last updated: July 21, 2026

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

- Date: July 21, 2026
- Owner: QuotePilot maintainers
- Change: Refresh the aggregate JavaScript baseline after adding the public animated QuotePilot marketing route.
- Exception type: `other`
- Rationale: The March baseline is stale against the current feature branch; the existing application build measured 1,678,596 bytes before the marketing route, already 149 bytes above its 15% allowance. The completed marketing page adds 13,251 bytes (0.79%) without adding an animation dependency. Policy normally refreshes from clean `main`, but this branch contains the current canonical workflow implementation and the requested marketing surface.
- Risk impact: The aggregate baseline resets from the current branch instead of a clean-main checkout, so the next release review must compare the merged build before accepting further bundle growth.
- Performance impact: Expected aggregate JavaScript is 1,691,847 bytes; the largest chunk remains 397,827 bytes, materially below the prior 615,421-byte largest-chunk baseline.
- Rollback plan: Revert the marketing route, its route handoff, and this baseline refresh together.
- Exit criteria: Reconfirm or tighten the baseline from clean `main` after this feature lands and before approving another intentional aggregate-bundle increase.
- Verification evidence: `npm run build`, `npm run check:perf:bundle`, focused public-page Playwright coverage, and focused `/app` workflow smoke coverage.
