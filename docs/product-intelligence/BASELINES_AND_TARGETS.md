# Baselines and Targets

Last updated: 2026-09-16 23:25:23 CDT

## Current baseline status

QuotePilot does not yet have a trustworthy production baseline for product
outcomes. The current repository proves that some measurements can be produced;
it does not provide a frozen owner-operator baseline, adequate production
samples, or a causal result.

Synthetic founder-pilot records, unit tests, browser fixtures, emulator runs,
and provider configuration are excluded from outcome baselines.

The Delivery Planning program already defines the strongest human baseline
protocol in the repository: observe at least five owner-operators using two
recent staffed-buffet events each, record elapsed time, repeated entry,
navigation, corrections, late discoveries, and workarounds, then freeze the
baseline before testing. Its accepted slice target is 30% faster with no
increase in material corrections and preference from at least four of five
participants.

## Baseline register

| Baseline ID | Metrics | Population and window | Current state | Freeze rule |
|---|---|---|---|---|
| `BASE-01` | `MET-01`–`MET-05` | First 30 production days or 100 eligible staff quote sessions, whichever is later; create/edit segmented | Collectable from existing analytics, not frozen | Freeze only after sample limits and truncation are reported and obvious fixture/dev sessions are excluded. |
| `BASE-02` | `MET-06`, `MET-07` | At least 30 current proposal decision cycles across real tenant work | Not centrally summarized | Freeze issuance/decision authority and material-correction policy before counting. |
| `BASE-03` | `MET-08`–`MET-10` | At least 20 eligible completed engagements with complete export eligibility | Source/local derivation only | Freeze evidence contract, evaluation instant, and eligibility denominator. Missing evidence remains unreconciled. |
| `BASE-04` | `MET-11`, `MET-12`, `MET-14` | Five owner-operators, two recent staffed-buffet events each, including kitchen and staffing review | Open; explicitly unproven in Delivery Planning | Freeze actor, cutoff, material correction, and required supported projection definitions before pilot exposure. |
| `BASE-05` | `MET-13` | At least 30 real payment attempts across deposit/final-balance rails | Not summarized | Freeze recovery window and provider/ledger state mapping; unknown is not failed. |
| `BASE-06` | `MET-15` | First 20 eligible real rebooks | Not observable | Freeze eligible origin and safe-copy/exclusion manifest before collection. |
| `BASE-07` | `MET-16` | Five owner-operators completing comparable before/after tasks | Open | Freeze tasks, facilitation, correction rubric, and preference question before exposure. |
| `BASE-08` | `MET-17` | Continuous, release-bound integrity evidence | Fragmented | Count only confirmed events; retain zero-event windows and evidence sources. |

## Proposed initial targets

These are proposed decision thresholds, not current policy or achieved results.
Owner acceptance is required before they govern prioritization or release.

| Target ID | Metric | Proposed threshold | Minimum evidence | Guardrail |
|---|---|---|---|---|
| `TGT-01` | `MET-01` | Improve quote completion by at least 10 percentage points from `BASE-01`. | 100 eligible sessions in both baseline and comparison windows | `MET-07`, `MET-12`, and `MET-17` do not worsen. |
| `TGT-02` | `MET-03` | Reduce p75 intent-to-priced-draft time by at least 30% from `BASE-01`. | 50 valid paired samples per window | Every counted draft remains Firebase-saved and server-authoritatively priced. |
| `TGT-03` | `MET-04` | Dead-click rate at or below 2% after at least 100 assessed primary actions. | 100 assessed actions; report release and route exposure | Analytics loss or a hidden error may not be counted as acknowledgement. |
| `TGT-04` | `MET-05` | Reduce p75 supported issue-resolution time by at least 25%. | 30 same-session exact-category pairs per compared category | Categories and pairing rules remain unchanged across comparison. |
| `TGT-05` | `MET-07` | No increase in material commercial corrections while speed targets improve. | Frozen materiality rule and 30 accepted engagements per window | Accepted history and revision receipts remain immutable. |
| `TGT-06` | `MET-08` | At least 95% of eligible accepted engagements have complete cost evidence. | 20 eligible engagements and current evidence contract | Synthetic or provisional costs never become observed actual cost. |
| `TGT-07` | `MET-09` | At least 90% of eligible completed engagements are fully reconciled within seven days of closeout. | 20 completed engagements with export eligibility | Missing/unverifiable evidence cannot be counted as reconciled. |
| `TGT-08` | `MET-10` | Zero unexplained discrepancies above an operator-declared tolerance; never infer the tolerance from history. | Named actor, value, and declaration timestamp | A lower discrepancy total cannot be achieved by excluding eligible records. |
| `TGT-09` | `MET-11` | At least 95% of eligible accepted/booked events have each required supported projection current by its operator-declared cutoff. | 20 events; domain results shown separately | No blended readiness score and no unsupported domain added to the denominator. |
| `TGT-10` | `MET-12` | Reduce material late discoveries by at least 30% from `BASE-04`. | Comparable staffed-buffet events and frozen correction rubric | Customer price, staffing need, production output, and purchase requirement corrections do not increase. |
| `TGT-11` | `MET-13` | Fewer than 1% of eligible payment attempts remain ambiguous beyond the declared recovery window. | 100 real attempts or report insufficient sample | Duplicate active or settled financial actions remain zero. |
| `TGT-12` | `MET-14` | At least 90% of eligible completed events record governed closeout within two business days. | 20 completed events | Actual attendance never overwrites contracted or planned counts. |
| `TGT-13` | `MET-15` | 100% of eligible rebooks retain origin provenance and copy no forbidden authority. | 20 eligible rebooks | Acceptance, signatures, payment/provider evidence, and obsolete pricing are excluded. |
| `TGT-14` | `MET-16` | At least four of five owner-operators prefer the governed workflow for comparable work. | Delivery Planning pilot protocol | Preference cannot override a material correctness or integrity regression. |
| `TGT-15` | `MET-17` | Zero confirmed critical integrity breaches. | Continuous evidence linked to release exposure | Any confirmed breach triggers stop, containment, and owner decision. |
| `TGT-16` | `MET-18` | At least 80% of Tier-1 product metrics are production-observable before outcome claims become routine. | Metric-to-signal audit | Documentation-only specification is not counted as implemented observation. |

## Comparison policy

- Compare like-for-like cohorts: tenant, role, create/edit mode, event type,
  release exposure, and evidence eligibility.
- Report sample count, missingness, truncation, and freshness beside every value.
- Use medians and p75 for task duration; do not rely on averages.
- Do not declare causality from a before/after release comparison when other
  material changes occurred. Record competing changes in the ledger.
- Adopt, revise, stop, or investigate only through an explicit owner decision.

## Owner acceptance record

Status: `pending`.

To accept, record the accepted target IDs, any revised thresholds, the deciding
owner, and timestamp in the Release / Experiment Ledger. Rejected targets remain
historical proposals rather than silently disappearing.
