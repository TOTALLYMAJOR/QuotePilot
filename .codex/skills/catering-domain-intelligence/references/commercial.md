# Commercial, Pricing, Proposal, and Revision Context

Last updated: 2026-09-08 15:04:45 CDT

## Governing Patterns

- `domain_pattern`: A quote is a priced proposal of scope; a customer-facing
  proposal is a decision artifact; acceptance establishes the agreed snapshot.
  These may share data without sharing state.
- `domain_pattern`: Current is not the same as latest. A later draft is not
  necessarily the published, customer-current, accepted, or operationally
  current version.
- `failure_pattern`: Rewriting an accepted record destroys the ability to
  explain what changed, what was agreed, and which payment or document belongs
  to which obligation.
- `design_implication`: Consequential revisions should preserve prior truth,
  show the delta, identify affected obligations and artifacts, and provide the
  next authorized action.
- `quotepilot_doctrine`: Current pricing behavior, exact-money semantics,
  waterfall order, policy versions, and payment handoff are governed by
  `docs/PRICING_CONSTITUTION.md`, not by generic catering vocabulary.
- `quotepilot_doctrine`: `event.guests` remains QuotePilot's exact commercial
  pricing basis. Planning estimates, submitted confirmations, and actual
  attendance have separate evidence semantics under
  `docs/ATTENDANCE_STATE_ADR.md`.

## Consequence Check

When scope, guest count, date, venue, menu, or service changes, determine which
of these are actually supported and affected:

- price, cost, margin, fee, tax, deposit, balance, or payment timing;
- proposal/current customer decision artifact;
- accepted historical snapshot or required re-approval;
- staffing, production, rentals, logistics, or readiness;
- BEO or other operational document currentness;
- change receipt, provenance, and recovery.

Do not infer support for minimum spend, gratuity, arbitrary discounts, recipes,
procurement, or other source-pack concepts unless current QuotePilot authority
and implementation establish them.

## Reconsideration Triggers

- `REFINE` when the method is sound but needs version, delta, or consequence
  visibility.
- `REPLACE` when a mutable status or record edit should be an authoritative
  command with a receipt.
- `EXPAND` when a valid commercial change necessarily affects another supported
  domain or validation path.
- `BOUND` when the request would make a draft, suggestion, or later timestamp
  carry accepted or customer-current authority.
