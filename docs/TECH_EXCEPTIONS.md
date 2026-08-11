# Technology Exceptions

Last updated: August 11, 2026

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

- Date: August 11, 2026 (supersedes the August 10 ceiling record)
- Owner: QuotePilot maintainers
- Change: Apply named, absolute temporary ceilings of 2,756,352 aggregate
  JavaScript bytes and 391,596 bytes for the largest chunk while the
  customer-centered workspace converges and the flag-gated pilot candidates
  (`VITE_PILOT_NOW_ENABLED`, `VITE_PILOT_EVENT_ROOM_ENABLED`,
  `VITE_PILOT_GUIDED_SELLING_ENABLED`, `VITE_PILOT_CREATE_ENABLED`,
  `VITE_PILOT_CHANGE_REQUESTS_ENABLED`, `VITE_PILOT_COMMAND_ENABLED`,
  `VITE_PILOT_MARGINS_ENABLED`, and `VITE_PILOT_DECISION_ROOM_ENABLED`, all
  default off in generic/local builds; the first seven are production-bound
  to true by the deployment workflows since `v0.6.0`, and the decision-room
  gate is production-bound the same way by owner decision on 2026-08-11,
  taking effect at the next release from this branch) are reviewed with
  it. The clean-main baseline remains
  1,997,365 aggregate bytes, a 387,929-byte largest chunk, and a 5% normal
  allowance.
- Exception type: `perf-threshold-temp`
- Rationale: The routed staff workspace, Customer 360, commercial dependency
  graph, rebooking, commercial measures, governed commercial-change authority,
  artifact freshness, Decision Debt, Revenue Autopilot operations, CWF-16 Event
  Workspace, the Event Messaging Station, and their role-safe
  recovery/presentation states are being reviewed together during production
  release qualification. Resetting the baseline prematurely would erase
  the comparison with clean `main`; one shared percentage would also grant the
  largest chunk substantially more room than the measured build needs.
- Risk impact: The production-flag asset set is 758,688 bytes (37.98%) above
  the clean-main aggregate baseline, of which 63,983 bytes are the default-off
  pilot candidates (9,093 for the lazy-chunked NOW home surface, 5,544 for
  the Event Room ring and decide stack, 1,560 for the guided-selling decide
  cards, 13,797 for the CREATE intake canvas, deterministic extractor, and
  draft-only band pricing strip, 10,011 for the client-request panel
  and parser, 4,452 for the structured-record boundary and client (now
  including best-effort version linking after save), 5,495 for
  the cascade receipts panel, 2,993 for the Pilot command bar, and 9,273 for
  the fail-closed margin strip, its Catalog Admin cost-entry fields
  (package/add-on/rental cost, staff cost rates, target margin), its
  below-target commercial advisor card, its literal save-outcome
  `data-capability-state` markers, the CREATE intake band-pricing
  preview's margin range, Scenario Compare's margin figures and
  comparison row, and the change-request impact preview's margin delta in
  the Pilot command bar and client-request panel, plus 1,765 for the
  decision-room pieces (portal block tags, per-block "Ask about this"
  buttons, the conversation composer prefill wiring, and the strictly
  default-false portalDecidable option marks through the catalog
  normalizer, write shapes, and Catalog Admin rows, all behind the
  `VITE_PILOT_DECISION_ROOM_ENABLED` gate) — this
  branch's own
  bugfix corrections (guest cap and staffing-labor gating in the margin
  strip; clause-index-anchored proposal/ambiguity ids in the change-request
  parser — see CHANGELOG.md `### Fixed`) are folded into the feature figures
  they landed in rather than split out as a separate line, unlike the
  now-superseded `v0.6.0` ceiling record this reconciles with) and 347 bytes
  are non-feature deltas: 299 are the confirmed CI-vs-local build-environment
  offset (see Verification evidence below) and 56 are this tree's own
  measured flag-off-to-production-flag build delta with all eight gates
  bound, superseding the earlier 52- and 48-byte figures and the 32-byte
  figure measured before this branch's post-`v0.6.0` work landed. A
  small remainder of the pilot-candidate delta belongs to the always-loaded
  catalog normalizer (nullable cost-field parsing shared by every tenant,
  not itself flag-gated) rather than the named pilot surfaces; it is folded
  into the margin-strip figure above rather than claimed as a precise
  separate measurement. A targeted `quoteStore` manual chunk reduces
  `WorkspaceRoute` from 448,190 to 357,957 bytes; Firebase is now the largest
  chunk at 391,596 bytes, 3,667 bytes (0.95%) above the clean-main largest-
  chunk baseline and 15,729 bytes below the normal 5% ceiling. Lazy route
  boundaries keep the new staff route bodies out of the public entry chunk,
  but staff who enter affected
  routes can still incur added download, parse, and execution cost, especially
  on slower mobile hardware. This exception has zero byte headroom: any further
  growth fails the guard.
- Performance impact: This checkpoint's contributor-sandbox `npm run build`
  emitted 2,755,997 aggregate JavaScript bytes and a 391,596-byte largest
  chunk (default-off configuration), adding the decision-room pilot's
  decidable-option data model: a strictly default-false `portalDecidable`
  mark on add-ons and rentals through the catalog normalizer (both
  directions), both catalog write shapes, and a flag-gated "Portal offer"
  checkbox in Catalog Admin's add-on and rental rows — the staff opt-in
  that later slices will project into the portal as offerable options,
  each landing as a staged change request for staff approval. The prior
  checkpoint at this ceiling added the ask-about affordance (portal block
  tags, per-block buttons, composer prefill); by owner decision
  (2026-08-11) the decision-room gate is production-bound to true in both
  deployment workflows and both CI production-flag steps alongside the
  existing seven, taking effect at the next release from this branch. The
  extrapolation method already validated exactly
  (to the byte) on the first checkpoint it was ever applied to. The last
  exact-SHA CI-confirmed value remains 2,747,012: CI Quality run
  `31447641093` on commit `20f69e7bc94fd8adaef5195e0bda0dde326bcb8b`
  reported
  `Current bundle metrics: { totalJsBytes: 2747012, largestJsChunkBytes: 391596 }`
  against that ceiling and passed (prior contributor-sandbox checkpoints,
  all now superseded: 2,691,344
  converged; 2,700,437 with the NOW surface only; 2,705,981 before the
  guided-selling cards; 2,707,541 before the CREATE intake canvas; 2,719,059
  before the band pricing strip; 2,721,338 before the client-request panel;
  2,731,349 before the structured-record boundary; 2,734,964 before the
  cascade panel; 2,740,459 before the command bar; 2,743,452 before the
  margin strip; 2,746,713 before Catalog Admin cost entry and the advisor
  card; 2,750,912 before the capability-state markers; 2,751,241 before
  version linking; 2,752,078 before the band-pricing margin range; 2,752,617
  after the recovery-button bugfix; 2,753,614 before the command-bar and
  change-request margin delta; 2,754,232 after the `v0.6.0` `main`
  reconciliation, before the ask-about affordance; 2,755,007 before the
  decidable-option marks). Separately, from the
  2,747,012 anchor, the `v0.6.0` release checkout's own local
  production-flag build (all seven `VITE_PILOT_*` gates true) measured a
  32-byte configuration delta over its same-environment default-off build;
  release PR CI run `31452174098` and exact-main CI run `31452570192` both
  passed the exact production-flag `Build production pilot bundle` check
  before `v0.6.0` deployed to both providers (see PROJECT_STATUS.md). Both
  configurations are re-measured fresh at every checkpoint since the
  reconciliation rather than projecting an old delta forward:
  contributor-sandbox default-off is 2,755,997 bytes and the
  same-environment production-flag build — all eight gates true,
  including the newly bound decision-room gate — is 2,756,053 bytes, a
  56-byte configuration delta. The ceiling above (2,756,352) is
  the larger of the two, 2,756,053, plus the confirmed +299 CI-vs-sandbox
  offset, so one number safely covers both the default-off and
  production-flag CI bundle checks; no CI run against this exact commit
  exists yet, so treat it as provisional exactly like every prior
  checkpoint until its own CI run confirms or corrects it. The other
  largest emitted chunks were jsPDF at 385,630 bytes, `WorkspaceRoute` at
  357,957 bytes, and the isolated quote store at 145,728 bytes. The
  Messaging Station itself remains a 30,941-byte lazy route chunk. These
  are local source-build measurements, not Core Web Vitals, hosted,
  production, or human-acceptance evidence.
- Rollback plan: Delete `docs/performance/bundle-exception.json` and remove,
  defer, or split enough branch code to pass the unchanged standard ceilings of
  2,097,233 aggregate bytes and 407,325 bytes for the largest chunk. The
  clean-main baseline needs no rollback because this exception does not change
  it.
- Exit criteria: Before this exception is closed, use one of two explicit
  paths: (1) optimize the source to the standard ceilings and delete the
  exception, or (2) obtain maintainer approval for
  a clean updated-`main` baseline reset, delete the exception, and retain the
  normal 5% allowance. Either path must pass a fresh build, the bundle guard
  with no active exception, local CWV, and focused default plus flagged staff
  route checks at desktop and mobile widths. Hosted signed-in acceptance, flag
  removal, and production promotion remain separate release gates.
- Verification evidence: two exact-SHA `CI Quality` runs on PR #53
  (`31446312573` on commit `f8dc86b`, `31446572599` on commit `d5dead0`) each
  failed `lane:core`'s bundle guard by exactly 299 bytes against a ceiling set
  from a contributor-sandbox `npm run build` (including a clean `npm ci`
  reinstall, which reproduced the sandbox number exactly and ruled out local
  dependency drift). The 299-byte gap was identical across both commits,
  indicating a fixed CI-runner-vs-sandbox build-environment difference rather
  than a source or dependency-resolution difference. The ceiling above is the
  literal `totalJsBytes` CI reported for commit `d5dead0`; future ceiling
  updates on this exception should be taken from an exact-SHA CI run rather
  than a contributor sandbox to avoid repeating this gap. The ceiling was
  then extrapolated forward by the automated-review bugfix commit's own
  contributor-sandbox delta (+72 bytes) plus the confirmed +299 offset, in
  lieu of a CI run against that exact commit at record time. CI Quality run
  `31447641093` on commit `20f69e7` (the bugfix commit) subsequently
  confirmed this extrapolation exactly: its `lane:core` bundle guard log
  reports `Current bundle metrics: { totalJsBytes: 2747012,
  largestJsChunkBytes: 391596 }`, matching the ceiling to the byte, and the
  full check run set for that commit (`lane:quick`, `lane:core`,
  `lane:firebase-auth-rules`, `lane:authoritative-pricing`,
  `lane:playwright-smoke`, `lane:cwv-smoke`, Docker Build Smoke) completed
  with `conclusion: success`. This checkpoint's own ceiling (2,756,352)
  is the same extrapolation applied a tenth time, against the larger of
  the two build configurations — this commit's contributor-sandbox
  eight-gate production-flag measurement (2,756,053) plus the confirmed
  +299 offset —
  since it has no CI run of its own yet at record time; correct it to the
  literal exact-SHA CI value in a follow-up commit if either the default-off
  or production-flag CI run reports a different number, per the same
  commitment that already proved correct on every prior checkpoint. Earlier
  checkpoint figures in this record were sandbox-measured and are
  superseded by this correction. CI Quality now additionally builds with
  all seven pilot gates enabled and runs the same bundle guard before its
  production-mode browser matrix on every push; `v0.6.0`'s release PR run
  `31452174098` and exact-main run `31452570192` were the first to pass it,
  ahead of that tag's production deployment. `npm run check:perf:bundle`
  must report this
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
