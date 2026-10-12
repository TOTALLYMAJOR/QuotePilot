# Quality and Reliability Guardrails

Last updated: 2026-09-17 10:51:24 CDT

## Quote-to-Confidence application

`GRD-01`, `GRD-02`, `GRD-04`, `GRD-06`, `GRD-07`, `GRD-09`,
`GRD-10`, `GRD-11`, `GRD-12`, `GRD-14` and `GRD-15` govern all five
journeys. New build and tenant gates default off; server gates still apply.
Internal supply approval is never a vendor action. Device drafts never imply
server persistence or cold-start offline support. Source drift blocks adoption;
unknown commands reconcile their exact identity before new requests. Learning
never changes prices, margins, rates, thresholds, supplier policy, recipe yield
or conversion contents automatically. An applied observation requires both the
existing exact publication receipt and explicit operator confirmation; no click,
route change, recommendation or test fixture may substitute. Incompatible
receipt categories and event-bound receiving remain blocked by integration.

## Purpose

Success metrics are valid only while these guardrails hold. A growth or speed
gain that breaches a stop guard is a failed result, not a trade-off hidden in
an aggregate.

## Guardrail register

| Guardrail ID | Boundary | Threshold | Evidence | Response |
|---|---|---|---|---|
| `GRD-01` | Tenant isolation | Zero confirmed cross-tenant reads, writes, analytics exposure, or provider action | Rules/emulator, callable authorization, hosted role journey, incident evidence | Stop exposure, contain, investigate, and require owner release decision. |
| `GRD-02` | Role authority | Zero unauthorized privileged mutations or hidden role expansion | Server authorization tests, UI state tests, receipts | Disable affected action and preserve evidence. |
| `GRD-03` | Pricing correctness | Zero accepted/payment amounts inconsistent with the exact authoritative pricing receipt | Golden Corpus, differential tests, acceptance/payment checks | Block acceptance/payment path; never repair by client-side arithmetic. |
| `GRD-04` | Historical truth | Zero destructive rewrites of accepted versions, signatures, receipts, or provider evidence | Version and Commercial Change tests/receipts | Roll back or stop the mutation path; recover through governed revision. |
| `GRD-05` | Financial idempotency | Zero duplicate active or settled operations for one obligation and request identity | Payment ledger, dispatch, webhook, reconciliation evidence | Treat ambiguity as unknown; reconcile before retry. |
| `GRD-06` | Evidence honesty | Missing, not-applicable, not-yet-available, blocked, contradictory, and schema-drift states remain distinct | Truth Loop and field-state checks | Block verdicts that collapse evidence states. |
| `GRD-07` | Operational currentness | No supported projection presented as current without its exact basis and currentness evidence | Dependency graph, Staffing/Inventory/BEO/workflow receipts | Mark stale/unknown and expose the owner-specific recovery action. |
| `GRD-08` | Customer privacy | Zero customer exposure to staff-only margin, staffing, provider, private evidence, or internal commentary | Portal DTO, rules, component, and hosted checks | Remove exposure and treat as a privacy incident. |
| `GRD-09` | Analytics privacy | Zero secrets, tokens, customer PII, free text, or unbounded identifiers in product analytics | Event allowlist, sanitizer tests, data inspection | Reject event and investigate any persisted exposure. |
| `GRD-10` | Workflow non-blocking analytics | Product analytics causes zero blocked quote saves or primary workflow failures | Client queue/fallback tests and production error evidence | Fail telemetry open while keeping business authority closed and observable. |
| `GRD-11` | Accessibility | Zero serious or critical automated accessibility violations on governed journey states; keyboard/focus and 200% zoom evidence for release-critical changes | Component/browser/assistive-technology evidence | Do not claim human accessibility acceptance from automation alone. |
| `GRD-12` | Responsive usability | No page-level horizontal overflow at governed 390/768/1440 widths and no clipped decision-critical content | Browser evidence and human review | Block promotion of the affected journey or record a bounded exception. |
| `GRD-13` | Performance | Bundle/CWV measures remain inside `PERFORMANCE_GUARDRAILS.md`; temporary ceilings require an explicit exception | Bundle and CWV checks | Remove regression or use time-bounded governed exception. |
| `GRD-14` | Release integrity | Required checks pass on the exact candidate SHA and deployment receipts remain distinct from human/outcome proof | Protected CI, release/UAT receipts, provider readback | No production-success claim from local or dirty-tree evidence. |
| `GRD-15` | Recovery clarity | Every consequential async action exposes eligibility, pending/unknown outcome, receipt, and safe recovery | State contracts and acceptance evidence | Block or revise actions that encourage blind retry. |
| `GRD-16` | Human correction | Material correction rate does not worsen while speed, completion, or adoption improves | `MET-07`, `MET-12`, pilot receipts | Reject the optimization even if engagement metrics improve. |

## Reliability measures not yet supportable

No product-wide availability or latency SLO is adopted here because the current
repository does not establish a complete production request/error/duration
telemetry source for every critical journey. An invented `99.9%` target would
create false confidence.

Before adopting a service SLO, instrument bounded rate, errors, and duration for
the critical server/provider boundaries; define the eligible request set; link
alerts to an actionable runbook; and verify the telemetry in hosted staging.

## Release decision rule

A release or experiment may be adopted only when:

1. its primary metric meets the predeclared decision threshold or produces a
   valuable falsification;
2. no stop guardrail is breached;
3. missing samples and evidence remain visible;
4. exposure and competing changes are recorded; and
5. the owner records `adopt`, `revise`, `stop`, or `investigate`.

`MET-17 > 0` for any confirmed critical integrity class is a stop condition
regardless of conversion, speed, revenue, or preference improvement.
