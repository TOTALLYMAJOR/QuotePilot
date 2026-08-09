# CWF-16 Event Workspace Product Requirements

Status: Accepted for source implementation from the approved concept
Date: August 9, 2026
Owner: QuotePilot maintainers
Visual target: `docs/design/cwf-16-event-workspace-concept.png`

## Outcome

Turn `/app/quotes/:quoteId` into the calm commercial record for one catering
event. A staff member should understand the event, customer, sold scope,
lifecycle, tracked attention, and next safe action before opening a separate
tool. The existing `/app/quotes` table remains the dense administration surface
and `/app/quotes/:quoteId/edit` remains the only editor.

## In scope

- Event/customer identity, date/time, guest count, quoted total, and lifecycle.
- One bounded current-condition and next-action presentation derived from the
  existing quote and Workflow contracts.
- One calm deterministic-intelligence strip that reuses existing proposal
  readiness and Workflow selectors while returning explicit unavailable states
  for unsupported Flexibility and Alignment conclusions.
- Context entry points for Schedule, quoted Staffing, selected Rentals &
  Equipment, Production/BEO, and Customer.
- Sold-scope summary and a four-milestone Draft/Sent/Accepted/Booked lifecycle.
- A prominent Edit quote action only when the existing status/role contract
  allows ordinary editing.
- Truthful fallback, loading, missing-record, local-source, and unavailable
  states; responsive desktop/mobile layout and keyboard access.

## Out of scope

- New backend reads, writes, collections, routes, or authority.
- Inventory availability, reservations, capacity, payroll, attendance, or
  staffing assignment claims.
- Payment receipt, customer view, provider delivery, booking, BEO freshness, or
  completion claims not already established by their canonical evidence.
- CWF-17 intelligence scoring, readiness/flexibility math, predictive AI, or
  persisted summaries beyond the existing proposal-readiness calculation.
- Automatic quote editing, publication, provider contact, or gate promotion.

## Product requirements

1. The first viewport establishes event identity and the most useful safe
   action without requiring the operator to scan the quote table.
2. Accepted/booked quotes must not receive an ordinary Edit quote affordance;
   the UI explains that a governed revision is required and routes staff to the
   existing administration/Workflow surfaces.
3. Current condition describes only the bounded tracked quote evidence. An
   empty queue reads “No tracked quote attention,” never “ready” or “complete.”
4. Context cards navigate only to existing routes or exact in-page tools.
5. The quote-list administration surface remains available in one action and
  retains every existing payment, portal, contract, approval, and delete gate.
6. The UI consumes one central deterministic presentation contract with stable
   reason codes and evidence bounds. It must not turn proposal completeness into
   event readiness or infer Flexibility/Alignment from missing authority.

## Acceptance criteria

- **When** a valid detail route loads, **then** the event workspace shows the
  exact quote/customer/event identity and formats human-readable dates/money.
- **When** the quote has a change request, due follow-up, pending approval, or
  post-event closeout item, **then** the highest-priority existing Workflow item
  supplies the condition, next-action copy, and exact Workflow focus target.
- **When** no bounded Workflow item exists, **then** the UI explicitly says no
  tracked quote attention and does not infer event readiness.
- **When** role/status permits ordinary editing, **then** Edit quote opens the
  existing trusted edit route; otherwise the control is absent and the governed
  revision boundary is visible.
- **When** the viewport narrows to 390px, **then** identity, next action,
  context, scope, and lifecycle stack without horizontal page overflow.
