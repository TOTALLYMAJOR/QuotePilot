# Tenant Operating Model Acceptance Matrix

Last updated: 2026-09-05 17:51:27 CDT

Status: local qualification complete; real tenant pilot and human acceptance pending

The [program plan](../plans/20260905-tenant-operating-model.md) owns scope;
[Project Status](../../PROJECT_STATUS.md#tenant-operating-model-local-development)
owns current results. This matrix names the remaining proof events and their
boundaries. It does not authorize deployment, tenant activation or provider sends.

## Reviewable local candidate

The local candidate is `feature/qp-tom-local-pilot-20260905`, reconstructed from
current main `8f2d2dcf78d4512aa7d02495ee27cbeeea4ccc12`. Reconciliation and whole-app
rehearsal retain the per-slice planner, explicit ownership, focused and integrated
checks, canonical documentation, local commit and immutable checkpoint contract.
No remote push is included. Current-main source qualification passes; whole-app rehearsal remains in progress.
Configuration Studio serves `quote_review`, `final_guest_count`,
`event_execution` and `closeout_follow_up`. Existing native authorities own
commercial and event outcomes. Definitions own tenant policy; instances own
coordination progress. The accepted ADR defines this separation.

| Criterion | Local executable evidence | Remaining external proof |
|---|---|---|
| Publish immutable policy; preserve existing pins; migrate explicitly | Definition/kernel tests, Studio fixtures, workflow emulator | Operator comprehension on selected tenant |
| Govern quote approval without weakening original authority | Commercial authority and actual-handler integration tests | Hosted current-catalog quote review |
| Request and receive exact-source final count; apply separately | Attendance tests, portal/staff fixtures, CCA handler and emulator | Real customer journey and separately authorized communication |
| Preserve acceptance, payment and booking history during amendment | Quote owner lifecycle tests and atomic handler checks | Selected pilot proposal/reacceptance walkthrough |
| Record phase, checkpoints, issues and actuals through original owners | Event owner/replay tests and emulator | Connectivity and event-day usability |
| Coordinate closeout and reviewed rebooking | Native closeout review/refresh and workflow tests | Operator follow-up walkthrough |
| Preserve canonical facts across task, publication and migration | Byte-comparison handler/emulator assertions; native and coordinator pins verified independently | Operator explanation of the two policy pins |
| Deny wrong tenant/role, stale source, replay duplication and browser writes | Rules, native kernel/handler and emulator matrix | Exact hosted identity/gate readback |
| Retain populated history while gates are off, then restore safely | Disposable all-pack rollback matrix | Selected tenant rollback rehearsal |
| Classify migration without inventing history or applying changes | Offline schema 1/2 inventory CLI and proof validation tests | Approved tenant-scoped input and reviewed classification |

Browser proof under `output/playwright/workflow-packs/` uses real components and
clients with synthetic transport at 390, 768 and 1440 pixels. Emulator provider
acceptance fixtures are explicitly synthetic; they establish no real send,
delivery, recipient behavior, settlement or production result. The read-only
inventory and Truth Loop hold no credential or application write path.

The prior frozen TOM checkpoint is `/tmp/qp-tom-studio-checkpoints/end/`. Its public
emulator artifacts prove enabled, imported global-disabled and restored modes
against identical source hashes. All modes retain 5 instances, 22 coordinator
receipts and 2 phase ledgers. The private emulator export is deliberately excluded
from the checkpoint. Full unit evidence is 4,748 passed / 83 skipped; separate
rules and Python suites pass 81 and 136. Both build profiles and their unchanged
bundle budgets pass. These results qualify the prior TOM baseline only; current-main evidence is recorded separately.

## Current-main source qualification

The reconstructed source passes 4,861 unit tests with 85 skips, 83 Firestore
rules tests and 136 Python tests. Both builds and current main's unchanged
bundle budgets pass, together with capability, documentation, project-state
and quick-lane checks. The enabled, imported global-disabled and restored real
emulator reports share all 15 source digests and retain 5 workflow instances,
22 coordinator receipts and 2 phase ledgers. Reports are recorded separately as
`/tmp/qp-tom-main-all-four-{enabled,disabled,restored}.json`; the prior end
checkpoint remains historical. These are local synthetic evidence only.

## Current-main cohort eligibility

Use fresh current-catalog confirmed quote sources for local amendments. The
current-main native catalog-review owner cannot review accepted/booked sources;
legacy or changed-catalog terminal quotes therefore remain blocked without
writes. A separately reviewed terminal policy or a new agreement is required
for recovery. No coordinator acknowledgement, migration or fixture may invent
a catalog-review receipt. Synthetic activation fixtures prove local contracts
only and must never be presented as provider delivery or customer acceptance.

## Required pilot selection

| Input | Current state |
|---|---|
| Exact tenant ID and approved environment | Not selected |
| Explicit quote/event cohort and date window | Not selected |
| Operator performing moderated walkthrough | Not selected |
| Event-day connectivity needs | Not observed |
| Baseline effort, exceptions and rework | Unavailable until measured |
| Approved candidate SHA, deployment and tenant gate readback | Not performed |
| Customer/provider communication approval and evidence | Not performed |

Use existing administrator and sales roles. Operations and finance are business
responsibilities; unsupported role claims must remain denied. Customer access
uses the current activated issuance, not a staff role or verified-person claim.

## Moderated walkthrough

1. Record the exact candidate, environment, tenant, participant role, selected
   sources, native receipts and initial policy pins. Keep unavailable baseline
   values explicit. Measure elapsed time and recovery attempts without inventing
   target improvements.
2. In Library, edit and preview one bounded field in each pack. Have the operator
   explain the affected future instances, existing pin, typed confirmation and
   retirement behavior. Publish only within the approved pilot scope.
3. Run a quote change with below/at-threshold cases and the existing approval
   floor. Explain simulation, approval and apply separately; verify exact receipts.
4. Request a final count, receive a matching and a differing response, and review
   the latter through commercial apply. Verify renewed acceptance is required,
   prior paid/booking evidence remains intact, and no automatic charge or send
   occurred. A request record alone must not be described as customer contact.
5. Use Control Room to record permitted event work, an urgent blocker and
   declared actuals. Have the operator identify missing dependencies, historical
   evidence and the safe next action in Replay.
6. Review closeout and prepare the existing rebooking draft handoff. Distinguish
   native completion from a coordinator task acknowledgement and a new sale.
7. Lose one transport response, reconcile the original identity, and verify one
   immutable outcome. Preview a compatible migration and explain why the
   original commercial policy remains attached to its native receipt.
8. Rehearse tenant gate disable/restore on the approved environment. Compare
   canonical and workflow evidence before/after; do not erase records. Confirm
   wrong-role, cross-tenant and stale-token attempts remain denied.
9. Record participant explanations, errors, timings and unresolved usability
   findings. Compare only observed baselines. Request an explicit
   continue/revise/pause decision; wider activation and production promotion
   remain separate decisions.

## Known limits to exercise

- Configuration is bounded to named fields and existing roles; it is not an
  arbitrary workflow builder or new pricing/payment/communication authority.
- Schedule anchors are pinned at initialization. Native timing changes do not
  silently reschedule active coordinator tasks.
- Actual attendance is not supplied by final-count confirmation. The separate
  Attendance ADR's operational actual-count slice remains unfinished.
- Browser-local fallback is separately labeled and cannot claim server receipts.
- A local green suite, staged manifest or synthetic delivery fixture does not
  substitute for the hosted, provider, production or human evidence above.
