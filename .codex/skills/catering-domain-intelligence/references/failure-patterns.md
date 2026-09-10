# Catering Failure and Recovery Patterns

Last updated: 2026-09-08 15:04:45 CDT

Load this file only for explicit failure, ambiguity, recovery, risk, staleness,
or adversarial validation work.

## Commercial and Document Failures

- `failure_pattern`: A post-acceptance scope change rewrites historical truth or
  fails to identify a required revision, delta, re-approval, or stale artifact.
- `failure_pattern`: A customer-current proposal and an internal-current BEO
  silently disagree without evidence explaining whether the difference is
  intentional projection or drift.
- `failure_pattern`: A payment attaches to an older commercial obligation and
  the remaining balance cannot be explained from receipts.

## Payment Failures

- `failure_pattern`: A provider request times out, is retried, and duplicates a
  financial action because ambiguous outcome was treated as failure.
- `failure_pattern`: Acceptance is presented as paid or secured without the
  required payment evidence.

## Operational Failures

- `failure_pattern`: Staffing, production, logistics, or BEO work continues from
  a superseded attendance, menu, venue, or timeline basis.
- `failure_pattern`: External availability disappears after a commercial
  promise, but the system conflates the commitment with availability evidence.
- `failure_pattern`: Actual attendance overwrites the contracted or planned
  count instead of remaining separate closeout evidence.

## Data and Workflow Failures

- `failure_pattern`: Missing cost or provenance is presented as a precise
  margin or completed state.
- `failure_pattern`: Contradictory sources are silently resolved rather than
  represented with an owner-facing recovery path.
- `failure_pattern`: Acknowledgement is treated as resolution, or automation
  acts after an operator has already resolved the issue.
- `failure_pattern`: Rebooking clones signatures, acceptance, payment receipts,
  provider evidence, or obsolete pricing authority.

For each applicable pattern, require a test of eligibility, transition,
outcome evidence, ambiguity/staleness, and recovery. Do not add unsupported
runtime states merely to mirror this vocabulary.
