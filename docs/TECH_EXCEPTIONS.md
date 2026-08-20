# Technology Exceptions

Last updated: 2026-08-20 15:58:46 CDT

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

- Date: August 13, 2026 (supersedes the August 11 single-profile record)
- Owner: QuotePilot maintainers
- Change: Enforce separate, detected bundle profiles for the compatibility and
  production-equivalent Ambient graphs. The Proposal Composer quote-builder
  candidate (measured 2,943,941 local compatibility bytes, largest chunk
  unchanged), the first Live planning and Staff People presentation slice
  (measured 2,963,542 compatibility bytes, largest chunk unchanged), and the
  shared shell and Now visual-system pass (measured 2,964,327 compatibility
  bytes, largest chunk unchanged) recalibrate compatibility to an absolute
  ceiling of 2,964,327 aggregate
  JavaScript bytes and 391,901 bytes for the largest chunk. Ambient remains
  temporarily capped at 3,899,524 aggregate bytes and the same 391,901-byte
  largest-chunk ceiling. The prior local combined candidate measured 3,887,673
  Ambient bytes; the active ceiling is the exact protected-Playwright graph.
- Exception type: `perf-threshold-temp`
- Rationale: The strangler architecture intentionally emits materially
  different authenticated workspace graphs. A single ceiling either blocks the
  reviewed Ambient graph without describing its cost or silently grants the
  compatibility graph unnecessary room. The guard therefore detects the graph
  from mutually exclusive required chunks and rejects any requested-profile
  mismatch. The clean-main baseline remains unchanged.
- Risk impact: Ambient still carries materially more aggregate JavaScript than
  the measured compatibility graph. This is meaningful mobile download,
  parse, and execution risk even though most code is route-lazy. Passing this
  exception is not Core Web Vitals, hosted, production, or human-acceptance
  evidence.
- Performance impact: Local production-equivalent builds measured compatibility
  at 2,769,824 aggregate / 391,596 largest bytes and Ambient at 3,700,202 /
  391,596 before the owner-authority recovery surface. That source-only safety
  surface adds 2,651 aggregate bytes after reconciliation-path deduplication;
  its reviewed Ambient local measurement is 3,702,853 bytes. Manual
  `ambient-opportunity-model` and `quote-builder-ui` chunks
  reduced the prior Ambient largest chunk from 436,188 bytes to the then-current
  Firebase ceiling. Before Team access, the Ambient aggregate maximum remained
  the exact reviewed local figure plus the previously confirmed 303-byte
  CI-runner offset.
  The Team access role review, seven-state mutation recovery, recent-auth
  adapter, role callable client, and disabled App Check build adapter add
  14,850 local bytes to compatibility and 12,198 local bytes to Ambient. The
  new exact local measurements are 2,784,674 / 391,901 and 3,715,051 / 391,901.
  Compatibility retains its previously observed 7,025-byte CI-versus-local
  offset; Ambient retains its 303-byte offset. The enabled App Check provider
  graph is not production-bound and is excluded from these default-off
  measurements; its later promotion requires a new exact review.
  The operational Staff/invitation release then established 2,880,654-byte
  compatibility and 3,804,078-byte Ambient ceilings. The current Pingram
  candidate measures 2,891,116 / 391,901 bytes for compatibility and 3,817,075
  / 391,901 bytes for Ambient. Its ceilings retain only the same 7,025-byte and
  303-byte runner offsets and add no general headroom.
  The quote-builder decision-flow slice then measures 2,899,957 / 391,901 bytes
  for compatibility and 3,825,917 / 391,901 bytes for Ambient. Its ceilings
  retain those same runner offsets and do not increase the largest chunk.
  The first Live planning and Staff People presentation slice then measures
  2,963,542 / 391,901 bytes for compatibility and 3,749,888 / 391,901 bytes for
  Ambient. The compatibility ceiling is set to the exact measured aggregate;
  Ambient remains below the standing Ambient ceiling, so its ceiling is
  unchanged.
  The shared shell and Now visual-system pass adds 785 compatibility bytes and
  475 Ambient bytes by reusing existing icon glyphs. Its exact measurements are
  2,964,327 / 391,901 bytes for compatibility and 3,750,363 / 391,901 bytes for
  Ambient; only the compatibility ceiling changes, with no general headroom.
  The catalog onboarding recovery hotfix adds 1,025 Ambient aggregate bytes in
  CI (`3,827,245 / 391,901`) for the hosted setup, manual, import, and bypass
  paths; the largest chunk remains unchanged.
  The Document-hero landing remount (self-revising BEO hero, Plans rate card,
  and design-partner chapter) adds 12,245 Ambient aggregate bytes in CI
  (`3,839,490 / 387,248`); the Ambient ceiling recalibrates to `3,853,000`
  with the largest chunk unchanged. Compatibility is unaffected (measured
  2,936,683, under its standing 2,964,327 ceiling).
  The current combined source candidate, including the Package Workspace,
  proposal presentation, read-only quote-workspace concept, and adjacent
  workspace changes, measures 3,206,553 / 387,248 bytes for local compatibility
  and 3,887,673 / 387,248 bytes for a prior local Ambient build. The temporary
  ceilings are therefore 3,215,097 and 3,899,524 aggregate bytes respectively,
  pinned to the exact protected-Playwright production-flag graphs.
  The largest-chunk ceiling remains 391,901 bytes. This is a combined-candidate
  recalibration, not a claim that the Package Workspace alone caused the
  increase and not general growth headroom.
- Rollback plan: Revert the quote-builder decision-flow slice and its exact
  recalibration, then revert Pingram if needed; or revert Team access and its role/App Check adapters
  with the earlier recalibration. The two manual chunks, graph-aware checker,
  CI matrix, prior compatibility ceiling, and clean-main baseline remain
  recoverable and unchanged.
- Exit criteria: Optimize Ambient to the standard clean-main budget or obtain an
  explicit reviewed clean-main recalibration after merge. Remove the exception,
  pass both production graphs without it, pass authenticated desktop/mobile CWV,
  and preserve exact rollback evidence before AIUI-48 retirement or Ambient
  promotion.
- Verification evidence: Seven focused profiler/release-policy tests, workflow
  lint, and fresh local production builds for both graphs pass. CI exact-SHA
  confirmation, hosted timing, and human acceptance remain open.

## Superseded Exceptions

- Date: August 11, 2026 (supersedes the August 10 ceiling record)
- Owner: QuotePilot maintainers
- Change: Apply named, absolute temporary ceilings of 2,789,740 aggregate
  JavaScript bytes and 391,596 bytes for the largest chunk while the
  customer-centered workspace converges and the flag-gated pilot candidates
  (`VITE_PILOT_NOW_ENABLED`, `VITE_PILOT_EVENT_ROOM_ENABLED`,
  `VITE_PILOT_GUIDED_SELLING_ENABLED`, `VITE_PILOT_CREATE_ENABLED`,
  `VITE_PILOT_CHANGE_REQUESTS_ENABLED`, `VITE_PILOT_COMMAND_ENABLED`,
  `VITE_PILOT_MARGINS_ENABLED`, and `VITE_PILOT_DECISION_ROOM_ENABLED`, all
  default off in generic/local builds; the first seven are production-bound
  to true by the deployment workflows since `v0.6.0`, and the decision-room
  gate is production-bound the same way since `v0.7.0`) are reviewed with
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
- Risk impact: The aggregate asset ceiling is 792,375 bytes (39.67%) above
  the clean-main aggregate baseline, of which 84,480 bytes are the default-off
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
  the Pilot command bar and client-request panel, plus 4,371 for the
  decision-room pieces (portal block tags, per-block "Ask about this"
  buttons, the conversation composer prefill wiring, the strictly
  default-false portalDecidable option marks through the catalog
  normalizer, write shapes, and Catalog Admin rows, and the portal
  offer cards that draft a canonical change request through the existing
  decision path, plus the assumptions block restating recorded facts and the tenant-authored per-tenant terms block, all behind the
  `VITE_PILOT_DECISION_ROOM_ENABLED` gate), plus 2,785 for the CREATE
  canvas Model assist section and its client boundary for the dormant
  model-assisted intake lane (docs/INTENT_INTAKE_ADR.md; renders its
  states only when the lane is injected, and the lane is server-dormant
  regardless), plus 1,398 for the adversarially hardened deterministic
  staff-count extraction in the CREATE intake reader (always-on since the
  reader itself ships with the CREATE gate; digit, word-number, and range
  counts for servers/chefs/bartenders with possessive/compound/address/
  tech-sense guards, articles surfacing as confirm-required only), plus
  2,803 for that same reader's four further capture families — time
  ranges filling both start time and computed hours, party-of-N and
  reversed-date phrasing, and confirm-only relative weekdays — hardened by
  a second adversarial round: contact-hours context, month-day digit
  theft, inherited-meridiem wraparound, and month-prefix words like
  "decent"/"maybe" all extract nothing wrong, plus 4,906 for event-shape
  memory (design §4.10; behind its own `VITE_PILOT_MEMORY_ENABLED` gate,
  deliberately not one of the eight production-bound gates above): the
  pure tenant-history aggregation module and the CREATE section that
  renders it, ships unconditionally like every other pilot lane's client
  code even though the section itself renders nothing until the flag is
  on and a reading yields both an event type and a guest count, plus
  5,999 for the CREATE reader's four remaining queued capture families —
  "noon"/"midnight" clock words bare and in a range, written-out guest
  counts, a multi-day mention surfaced as a note only (never the draft
  date), and labeled venue names ("Venue: X", "the venue is X") beyond
  the original "at X" pattern — closing out that queue, together with the
  guard fixes two independent adversarial-verification agents' confirmed
  findings required before this figure was final: a "not followed by a
  Capitalized word" guard that broke under its own regex's `/i` flag
  (rejecting ordinary sentences like "starts at Noon sharp") and was then
  dropped outright once further adversarial testing showed it rejected
  more real sentences than it protected; "til"/"'til" added as a
  recognized range separator (and a matching word-form-hour case) after
  it was found to slip past the dangling-range guard; a real English-
  number grammar for written-out guest counts after a looser one let
  "and" bridge two independent numbers in a range and silently misread
  "between twenty and a hundred guests" as 20 x 100 = 2000; a sentence-
  boundary stop and a placeholder-phrase guard ("TBD", "N/A") for venue
  capture; and a lead-time/negation guard for the multi-day note (see
  CHANGELOG.md for the full list) — this
  branch's own
  bugfix corrections (guest cap and staffing-labor gating in the margin
  strip; clause-index-anchored proposal/ambiguity ids in the change-request
  parser — see CHANGELOG.md `### Fixed`) are folded into the feature figures
  they landed in rather than split out as a separate line, unlike the
  now-superseded `v0.6.0` ceiling record this reconciles with). A
  source-only owner-SMS provider panel, provider-evidence resolver, and
  duplicate-send fencing add 12,759 bytes in both exact same-environment
  comparisons against released `v0.7.0` main. The production-flag output is 14
  bytes smaller than default-off in both trees. This direct comparison
  supersedes the earlier +303 environment-offset and +52 flag-delta estimates.
  They are not production-enabled: runtime selection remains `none`, and this
  size record is not hosted or provider acceptance. A small remainder of the
  pilot-candidate delta belongs to the always-loaded
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
  with the protected non-secret Firebase build configuration emitted 2,789,740
  aggregate JavaScript bytes and a 391,596-byte largest chunk (default-off
  configuration), including the 12,759-byte owner-SMS source delta on top of
  exact released `v0.7.0` main at 2,776,981 bytes. That released checkpoint closed
  out the CREATE reader's
  build-out queue with its four remaining families: "noon"/"midnight"
  clock words (bare and in a range, guarded against reading a name as a
  time and against mislabeling a dangling range's unresolved end as its
  start), written-out guest counts parsed against a real English-number
  grammar including a genuine word-form range, a multi-day mention
  surfaced as an informational note only (never the draft date), and
  labeled venue names ("Venue: X", "the venue is X") beyond the original
  "at X" pattern — each hardened by two adversarial-verification agents
  that found and fixed six real defects (one serious: a silently
  multiplied guest count) before this figure was final; see CHANGELOG.md
  for the full list. Prior checkpoints at this ceiling
  added event-shape memory (design §4.10, its own
  `VITE_PILOT_MEMORY_ENABLED` gate, not one of the eight production-bound
  gates below): median staffing/hours from at least 3
  same-event-type-and-guest-band matches, any rental in a strict majority
  as a read-only mention, an honest below-threshold reply, and six literal
  `data-capability-state` markers (loading/empty/partial/success/error/
  recovery); the CREATE canvas
  Model assist section and client boundary for the owner-approved
  model-assisted intake lane (a staff-only parseIntentDraft callable,
  dormant three ways until flag, provider, and Secret Manager key all
  exist, with per-state UI whose model suggestions each require explicit
  confirmation before touching the draft); two further adversarially
  hardened rounds of the deterministic CREATE reader (staff counts, then
  time ranges/party-of-N/reversed dates/relative weekdays); and the
  decision-room portal pieces end to end (ask-about, decidable-option
  marks, projection pipeline, offer cards, assumptions and per-tenant
  terms blocks); by owner decision (2026-08-11) the decision-room gate is
  production-bound to true in both deployment workflows and both CI
  production-flag steps alongside the existing seven, taking effect at
  the next release from this branch. The
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
  decidable-option marks; 2,755,997 before the offer cards, unchanged
  through the functions-only projection-pipeline checkpoint; 2,757,299
  before the assumptions and per-tenant terms blocks; 2,758,603 before
  the CREATE Model assist section; 2,761,388 before the staff-count
  extraction; 2,762,786 before the four capture families; 2,765,589
  before event-shape memory; 2,770,495 before the reader's final four
  queued families). Separately,
  from the
  2,747,012 anchor, the `v0.6.0` release checkout's own local
  production-flag build (all seven `VITE_PILOT_*` gates true) measured a
  32-byte configuration delta over its same-environment default-off build;
  release PR CI run `31452174098` and exact-main CI run `31452570192` both
  passed the exact production-flag `Build production pilot bundle` check
  before `v0.6.0` deployed to both providers (see PROJECT_STATUS.md). Both
  configurations are re-measured fresh at every checkpoint since the
  reconciliation rather than projecting an old delta forward:
  contributor-sandbox default-off is 2,776,981 bytes before this slice and
  2,789,740 bytes after it. The same-environment production-flag build — all
  eight gates true, event-shape memory's own gate unbound and unchanged — is
  2,776,967 bytes before this slice and 2,789,726 bytes after it. Exact-main CI
  run `31528176575` measured the released tree at 2,776,793 bytes default-off
  and 2,776,849 bytes production-flag; applying the exact 12,759-byte source
  delta projects 2,789,552 and 2,789,608 bytes for the candidate runner. The
  ceiling above (2,789,740) is the larger literal contributor measurement, so
  one number covers both profiles and the projected CI environment without
  discretionary growth headroom. An exact-SHA candidate CI run must confirm
  the projection before release. The other
  largest emitted chunks were jsPDF at 385,630 bytes, `WorkspaceRoute` at
  380,150 bytes, and the isolated quote store at 146,072 bytes. The
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
  with `conclusion: success`. This checkpoint's initial 2,776,845-byte
  extrapolation was four bytes low. PR #57 run `31525358682` on exact head
  `34d990d` reported the production-flag bundle at 2,776,849 bytes. The later
  exact-main `v0.7.0` run `31528176575` reported 2,776,793 bytes default-off and
  the same 2,776,849 bytes production-flag. Fresh identical-profile builds of
  released main and this branch measured a 12,759-byte source delta in both
  profiles, projecting candidate CI values of 2,789,552 and 2,789,608 bytes.
  The named 2,789,740 ceiling is instead pinned to the larger literal current
  contributor build, leaving no local growth headroom while covering both
  projected CI profiles; exact-SHA candidate CI confirmation remains a release
  gate.
  Earlier checkpoint figures in this record were sandbox-measured and are
  superseded by this correction. CI Quality now additionally builds with
  all eight pilot gates enabled and runs the same bundle guard before its
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
