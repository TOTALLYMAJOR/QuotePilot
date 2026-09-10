# Pattern Record: Domain Operating Model Discovery

Last updated: 2026-09-10 12:09:03 CDT

## Classification

This methodology **combines and refines existing patterns**.

It combines:

- Brand/product framing from early product discovery.
- Role-based operating-model mapping.
- Status-boundary separation from proof-safe commercial workflow design.
- Technical integration scoping from implementation readiness reviews.

It refines those patterns by sequencing them into a reusable control flow:

1. Name the business and product.
2. Define the product category.
3. Identify users and permissions.
4. Map the end-to-end workflow.
5. Split lifecycle states into separate truth domains.
6. Translate the operating model into visual and technical requirements.

The differentiator is not the term "QuotePilot." The useful synthesis is the **state-separation control mechanism**: lead, quote, payment, and operations readiness are modeled as related but independent truth domains before UI, integrations, or permissions are finalized.

## Existing Pattern Comparison

No formal pattern records were found in this repository before this record was created.

Compared with prior recorded methods from adjacent work:

- **Evidence-backed maturity assessment**: refined by requiring visible proof levels before claims of readiness.
- **Review-only AI boundary**: compatible; it reinforces that advisory or customer-facing surfaces cannot mutate authoritative commercial records without controlled operator/server authority.
- **Fan-out/fan-in evaluation pattern**: compatible as a later automation option, but not instantiated here because this work did not introduce multi-agent orchestration.

Verdict: **combines multiple existing patterns and establishes a candidate reusable product-discovery pattern for vertical SaaS workflow apps**.

## Applicability Test

Use this methodology when:

- A product idea starts with a business name, software name, or vague category.
- The product is a workflow app, vertical SaaS tool, portal, dashboard, or operating system.
- Multiple roles interact with the same business object.
- Customer-facing actions could be confused with internal approval, payment, fulfillment, or operational readiness.
- Technical integrations need to be scoped from business workflow rather than from a shopping list.

Do not use it as the main pattern when:

- The task is only visual branding or logo exploration.
- The product has no meaningful workflow or permissions model.
- The user is asking for a narrow implementation fix in an already settled architecture.

## Repeatable Prompt Chain

1. "What is the business or brand name, what does it offer, and are we creating a website, web app, mobile app, or landing page?"
2. "What is a good software/product name for this offer?"
3. "Who are the primary users, and what should the ideal end-to-end workflow look like?"
4. "What roles and permissions are required?"
5. "Which lifecycle states must remain separate?"
6. "What visual direction and technical requirements should guide the build?"
7. "Which integrations are must-have now, next, or later?"
8. "What proof must exist before the product can claim approval, payment, booking, readiness, or completion?"

## Decision Rules

- If the product involves a transaction, separate customer acceptance from payment confirmation.
- If the product involves fulfillment, separate booking from operational readiness.
- If the product involves customer portals, customer users may request or approve but must not edit authoritative internal pricing rules.
- If pricing matters commercially, final pricing must be computed or verified by trusted server-side logic.
- If integrations affect money, delivery, or records of authority, webhook/provider confirmation outranks browser return or UI state.
- If a role only needs execution details, hide pricing and internal sales notes by default.
- If the visual design is for an operations app, prioritize dense, calm, scannable workflows over marketing composition.

## Protected Invariants

- `Approved` does not mean `Paid`.
- `Paid` does not mean `Ready for Ops`.
- `Booked` does not mean kitchen, staffing, rental, or logistics details are complete.
- Customer access is scoped to that customer's proposal, uploads, approval, and payment actions.
- Internal notes, cost models, margins, pricing rules, and discount authority remain staff-only.
- Quote versions are preserved once sent or approved.
- Payment status comes from the payment provider or trusted backend, not from frontend navigation.
- Operational sheets are generated from approved/booked records, not draft quote state.

## Anti-Patterns

- Treating a quote wizard as the whole product when the real value is quote-to-booking operations.
- Collapsing lead, quote, payment, and event statuses into one ambiguous status field.
- Allowing customer revision requests to directly mutate authoritative pricing.
- Claiming a booking is ready for staff because a proposal was accepted.
- Starting with integrations before defining lifecycle ownership.
- Designing the staff app like a restaurant marketing site.
- Building mobile-first for complex quote construction when desktop is the real staff workflow.
- Treating PDF generation as the source of truth instead of an artifact generated from structured records.

## Evidence

Completed work produced these reusable outputs:

- Business/brand name: **MBMApps**.
- Product/software name: **QuotePilot**.
- Product category: a **web app** for quote creation, customer proposals, and quote-to-booking operations.
- Core workflow: `Lead -> Draft Quote -> Sent Proposal -> Revision -> Approved -> Paid/Booked -> Ready for Ops -> Completed`.
- Role model: Admin/Owner, Sales Manager, Sales Rep, Event Coordinator, Kitchen/Ops Staff, Customer.
- Technical direction: React/Vite with Firebase Auth, Firestore, Storage, Functions, Stripe, email delivery, PDF generation, calendar sync, and later accounting integration.
- Key control rule: lifecycle states must remain separate across lead, quote, payment, and operations domains.

## Measured Outcome

Measured in this discovery pass:

- Reduced an ambiguous product prompt into one named software product.
- Converted a brand-level idea into a role-aware operating model.
- Identified six primary role classes and their permission boundaries.
- Established four separate lifecycle status domains: lead, quote, payment, and event operations.
- Produced a technical integration map ordered by business criticality.

Not yet measured:

- User task completion time.
- Quote creation speed.
- Proposal conversion rate.
- Revision cycle reduction.
- Operational handoff error rate.
- Payment reconciliation accuracy.

## Reuse Guidance

Reuse this pattern for vertical SaaS products where the product is not just a screen but a controlled business workflow.

The strongest reuse targets are:

- Catering and event services.
- Home services quoting.
- Field service dispatch.
- B2B proposal portals.
- Appointment-to-payment workflows.
- Service businesses with customer approval plus internal fulfillment.

When reusing, preserve the sequencing. Do not jump from product name to technical stack before mapping users, statuses, authority, and proof boundaries.

## Confidence And Maturity

Confidence: **Medium-high**.

Maturity level: **Candidate pattern**.

Reasoning:

- The methodology is coherent and immediately reusable.
- It aligns with prior proof-boundary and maturity-assessment methods.
- It has not yet been validated across multiple independent product builds with measured outcomes.

Promote to **validated pattern** after it produces successful implementation plans for at least three different workflow products and at least one shipped build shows measurable workflow improvement.

## Reusable Implementation Prompt

Use this prompt to apply the pattern:

> We are defining a workflow software product for `[business name]`. First identify the product category and primary users. Then map the end-to-end workflow from first lead/intake through customer review, revision, approval, payment, fulfillment readiness, and completion. Define roles and permissions. Separate lifecycle states into independent truth domains such as lead, quote/proposal, payment, and operations. List protected invariants where one state must not imply another. Then produce the visual direction, technical architecture, required integrations, and the proof needed before each lifecycle claim can be made.

## Teaching Explanation

This methodology prevents product discovery from becoming either a branding exercise or a feature wishlist.

The key teaching point is that workflow software needs authority modeling before screen design. In QuotePilot, the customer can approve a proposal, Stripe can confirm payment, and operations can mark the event ready. Those are separate authorities. When the product keeps those authorities separate, the UI becomes clearer, permissions are easier to enforce, integrations have a purpose, and business claims stay honest.

## Consulting Diagnostic

Ask these questions in a consulting session:

- Can the team explain the difference between approved, paid, booked, and ready for operations?
- Who is allowed to change pricing after a proposal has been sent?
- What does the customer control, and what can they only request?
- Which system is authoritative for payment status?
- What artifact is generated for the customer, and what structured record generated it?
- What information should kitchen or operations staff never need to see?
- What event changes require a new quote version?
- What proof is required before the business treats the event as confirmed?

If the team cannot answer these questions, the product is not ready for high-confidence implementation.

## Automation Opportunity

Build a discovery-to-schema assistant that:

- Takes a business name, product name, and workflow description.
- Generates a role-permission matrix.
- Produces lifecycle status domains.
- Flags collapsed or ambiguous states.
- Suggests Firestore collections and security-rule boundaries.
- Drafts user stories and acceptance tests.
- Creates a proof-boundary checklist for payments, approvals, and operations readiness.

For QuotePilot, this could generate initial schemas for `leads`, `quotes`, `quoteVersions`, `proposals`, `payments`, `events`, `eventOps`, `users`, `roles`, and `auditLogs`.

## Next Validation Experiment

Run this pattern against one concrete QuotePilot build slice:

**Experiment:** implement the lead-to-sent-proposal workflow with role boundaries and separated lead/quote/proposal states.

Validation checks:

- Admin and Sales Manager can create and edit quotes.
- Customer can view only their own proposal.
- Customer revision requests do not mutate authoritative pricing.
- Sent quote versions are preserved.
- Approval creates an acceptance record but does not mark payment complete.
- Payment status changes only through a trusted backend/provider confirmation.
- Operations views do not expose internal margin or pricing-rule details.

Success threshold:

- All role-permission checks pass in tests.
- The UI shows distinct quote, payment, and operations states.
- No customer action can directly edit staff-only pricing, internal notes, or readiness status.
