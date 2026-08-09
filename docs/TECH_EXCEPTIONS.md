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
- Change: Apply named, absolute branch ceilings of 2,597,989 aggregate
  JavaScript bytes and 390,494 bytes for the largest chunk while the
  customer-centered workspace converges. The clean-main baseline remains
  1,997,365 aggregate bytes, a 387,929-byte largest chunk, and a 5% normal
  allowance.
- Exception type: `perf-threshold-temp`
- Rationale: The routed staff workspace, Customer 360, commercial dependency
  graph, rebooking, commercial measures, governed commercial-change authority,
  artifact freshness, Decision Debt, Revenue Autopilot operations, and their
  role-safe recovery/presentation states are being reviewed together on an
  unmerged source branch. Resetting the baseline from that branch would erase
  the comparison with clean `main`; one shared percentage would also grant the
  largest chunk substantially more room than the measured build needs.
- Risk impact: The emitted asset set is 600,624 bytes (30.07%) above the
  clean-main aggregate baseline. A targeted `quoteStore` manual chunk reduces
  `WorkspaceRoute` from 448,190 to 310,102 bytes; Firebase is now the largest
  chunk at 390,494 bytes, only 2,565 bytes (0.66%) above the clean-main largest-
  chunk baseline and 16,831 bytes below the normal 5% ceiling. Lazy route
  boundaries keep the new staff route bodies out of the public entry chunk,
  but staff who enter affected
  routes can still incur added download, parse, and execution cost, especially
  on slower mobile hardware. This exception has zero byte headroom: any further
  growth fails the guard.
- Performance impact: The August 9 completed source/local convergence build
  emitted 2,597,989 aggregate JavaScript bytes and a 390,494-byte largest
  chunk. The other largest emitted chunks were jsPDF at 385,630 bytes,
  `WorkspaceRoute` at 310,102 bytes, and the isolated quote store at 146,067
  bytes. These are
  local source-build measurements, not Core Web Vitals, hosted, production, or
  human-acceptance evidence.
- Rollback plan: Delete `docs/performance/bundle-exception.json` and remove,
  defer, or split enough branch code to pass the unchanged standard ceilings of
  2,097,233 aggregate bytes and 407,325 bytes for the largest chunk. The
  clean-main baseline needs no rollback because this exception does not change
  it.
- Exit criteria: Before this exception is closed, use one of two explicit
  paths: (1) optimize the branch to the standard ceilings and delete the
  exception, or (2) after the source is merged, obtain maintainer approval for
  a clean updated-`main` baseline reset, delete the exception, and retain the
  normal 5% allowance. Either path must pass a fresh build, the bundle guard
  with no active exception, local CWV, and focused default plus flagged staff
  route checks at desktop and mobile widths. Hosted signed-in acceptance, flag
  removal, and production promotion remain separate release gates.
- Verification evidence: a fresh `npm run build` execution produced the
  checkpoint measurements above. `npm run check:perf:bundle` must report this
  exact named exception, its absolute ceilings, and the unchanged normal limits
  before the checkpoint is committed. The earlier converged-workspace
  `npm run check:perf:cwv` run passed locally on
  the public `/` route at 0.90 performance, 3,292.5 ms LCP, 0 CLS, and 146.5 ms
  TBT. That public-route result is not authenticated staff-workspace evidence
  and does not waive the exit checks: a no-exception build, focused default and
  flagged `/app` performance checks, hosted staff acceptance, flag removal, and
  production promotion remain pending.

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
