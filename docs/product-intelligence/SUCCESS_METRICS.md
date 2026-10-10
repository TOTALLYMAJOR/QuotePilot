# Success Metric Specification

Last updated: 2026-09-17 11:56:08 CDT

## Quote-to-Confidence diagnostic measures

| Metric ID | Definition and denominator | Observation and boundary |
|---|---|---|
| `MET-19` | Successful completion-action resolutions / completion actions shown within the bounded summary window, plus raw numerator/denominator. | `SIG-017`, `SIG-018`; aggregate client diagnostics, not paired unique-event outcome conversion. Repeated exposure and missing telemetry can bias the ratio. Zero denominator is unavailable. |
| `MET-20` | Count of eligible quote-session sendable transitions; report observed sessions and exposure window separately. | `SIG-019`; sendable is neither sent nor accepted. No standalone success rate is inferred. |
| `MET-21` | Proposed and explicitly receipt-confirmed applied learning observations, separated by category and eligible exposure window. | `SIG-020`, `SIG-021`; client observations only, not a proposal-level conversion rate. Recipe/pack receipt confirmation is supported; template/workflow correlation remains blocked by integration. |

Summary fields are `quoteCompletion.actionsShown / actionsResolved /
actionResolutionRate / sendableReached` and `postEventLearning.proposed / applied`.
`postEventLearning.categories` retains one `{category, proposed, applied}` row for
recipe, template, pack conversion and workflow. With no shown completion actions,
`quoteCompletion.actionResolutionRate` is `null` (unavailable), never a zero rate.
Only categorical dimensions and the existing bounded organization/session envelope
are persisted. Quote IDs, proposal IDs, source references, quantities, money,
customer fields and rationale never enter event dimensions. These signals use
the existing analytics session; absent sessions or failed telemetry yield missing
observations, never invented counts. No product outcome baseline is yet collected.

## Measurement rules

- Every rate states its numerator, denominator, eligibility rules, window, and
  evidence source.
- `0 samples` is unavailable, not zero performance.
- Synthetic fixtures, local tests, and emulator receipts never enter production
  product metrics.
- Client observation may describe interaction but cannot establish pricing,
  acceptance, payment, delivery, or operational authority.
- Metrics are segmented by organization, create/edit mode, role where safe,
  evidence state, and release exposure. No metric label contains customer PII,
  free text, raw URLs, secrets, or unbounded record identifiers.
- No single metric may collapse commercial, operational, payment, human, and
  outcome evidence into a universal readiness score.

## Metric catalog

| Metric ID | Definition | Formula / unit | Evidence source | Observability | Decision use |
|---|---|---|---|---|---|
| `MET-01` | Quote workflow completion | Saved quote sessions / started quote sessions, percent; create and edit segmented | Existing `wizard_started` and `quote_saved` product events | Implemented | Detect builder abandonment; never equate save with customer or commercial success. |
| `MET-02` | Quote funnel continuation | Sessions reaching each governed step / sessions started, percent | Existing `wizard_step_completed` summary | Implemented | Locate workflow friction by step. |
| `MET-03` | Intent-to-priced-draft duration | Median and p75 milliseconds from first intent to Firebase-saved server-authoritative pricing receipt | Existing paired analytics events | Implemented | Determine whether QuotePilot accelerates the first defensible commercial artifact. |
| `MET-04` | Primary-action dead-click rate | Assessed primary actions with no acknowledged result by 250 ms / assessed primary actions | Existing Ambient assessment event | Implemented, client-observed | Detect deceptive or non-responsive primary actions. |
| `MET-05` | Issue-resolution duration | Median and p75 duration for same-session exact-category surfaced/resolved pairs | Existing Ambient issue events | Implemented for the current allowlisted categories | Identify whether guidance helps resolve missing facts and workflow attention. |
| `MET-06` | Proposal decision lead time | Time from current proposal issuance to first valid accept/reject/expiry outcome | Proposal issuance and decision receipts | Derivable but not centrally summarized | Measure customer decision friction without treating provider send as receipt or view. |
| `MET-07` | Commercial correction rate | Accepted engagements requiring a material post-acceptance price/scope correction / eligible accepted engagements | Versioned acceptance and Commercial Change receipts | Partial; materiality policy not frozen | Detect preventable commercial rework. |
| `MET-08` | Complete cost-evidence rate | Eligible commercial records without `provisional_cost_basis` / eligible records, percent | Commercial Truth Loop report | Derivable from exported evidence bundles | Show where margin can be explained; not proof that recorded costs equal physical actuals. |
| `MET-09` | Fully reconciled engagement rate | Eligible completed commercial records with no unresolved discrepancy or unverifiable blocking evidence / eligible completed records | Commercial Truth Loop `fullyReconciledBasisPoints` | Derivable locally; production export/use unproven | Measure explainability of the commercial chain. |
| `MET-10` | Unexplained financial exposure | Sum of unresolved discrepancy amount in integer cents; count shown separately | Truth Loop `unexplainedAmountCents` and `openDiscrepancies` | Derivable locally | Prioritize investigation; no inferred tolerance becomes policy. |
| `MET-11` | Operational handoff currency | Accepted/booked events whose required supported projections cite the current commercial basis / eligible accepted/booked events | Quote/version, Staffing, Inventory, BEO, workflow, and event-ledger evidence | Not yet centrally observable | Detect accepted work proceeding on stale assumptions without inventing one readiness score. |
| `MET-12` | Late operational discovery rate | Events with a material staffing, production, Inventory, BEO, venue, timeline, or quantity correction after the operator-declared cutoff / eligible events | Domain receipts plus owner-declared cutoff/materiality | Not yet observable | Measure avoidable last-minute recovery work. |
| `MET-13` | Payment ambiguity rate | Payment attempts remaining `unknown` or contradictory after the recovery window / eligible attempts | Payment dispatch, ledger, webhook, reconciliation, and provider receipts | Partially derivable; no governed aggregate | Detect risky retries and unresolved cash state. |
| `MET-14` | Closeout timeliness | Completed events with governed closeout evidence within the declared window / eligible completed events | Closeout and actual-attendance receipts | Partial | Determine whether engagements become explainable while facts are still fresh. |
| `MET-15` | Safe rebook reuse rate | Rebooks with explicit origin and without copied acceptance/payment/provider authority / eligible rebooks | Rebook and quote-version evidence | Not yet centrally observable | Verify relationship reuse without cloning obsolete commitments. |
| `MET-16` | Human workflow preference | Participants preferring the governed workflow after comparable-event use / participants completing the study | Structured pilot decision receipt | Defined in Delivery Planning; no current baseline | Establish whether speed and control are experienced by real operators. |
| `MET-17` | Critical integrity breach count | Count of confirmed cross-tenant exposure, unauthorized mutation, pricing mismatch, duplicate financial action, fabricated evidence, or customer-private leakage | Security, authority, provider, incident, and acceptance evidence | Multiple gates exist; no unified outcome feed | Stop or roll back when non-zero. |
| `MET-18` | Product analytics coverage | Governed metrics with a valid production source and sufficient samples / governed metrics, percent | This catalog, event schema, and baseline register | Derivable from documentation state | Prevent confident product claims from unobservable metrics. |

## Metric state vocabulary

- `implemented`: production-capable signal and summary logic exist.
- `derivable`: authoritative records exist, but no governed product summary is
  currently proven.
- `partial`: some required states, segments, or evidence classes are absent.
- `not_observable`: the required event, authority link, or baseline does not
  exist.
- `blocked`: observation is intentionally stopped by an external/provider,
  privacy, authority, or release gate.

## Interpretation constraints

- An improvement in `MET-01` is harmful if `MET-07`, `MET-12`, or `MET-17`
  worsens.
- A faster `MET-03` is not success if pricing is not server-authoritative and
  stored against the correct revision.
- A higher `MET-09` must never be created by treating missing evidence as clean.
- `MET-16` requires comparable real work; synthetic walkthroughs are not human
  preference evidence.
- Release correlation is not causation. The ledger must identify exposure,
  competing changes, sample limits, and the owner decision.
