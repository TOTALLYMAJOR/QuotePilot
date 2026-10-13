# Payment and Reconciliation Context

Last updated: 2026-09-08 15:04:45 CDT

## Governing Patterns

- `domain_pattern`: Agreement, payment request, provider acceptance, payment
  settlement, refund, and financial closeout are separate states.
- `failure_pattern`: A timed-out provider call has an ambiguous outcome. Treating
  it as failure and immediately repeating the financial command can duplicate
  the action.
- `design_implication`: Preserve attempt identity, expose uncertainty, reconcile
  against authoritative provider evidence, and permit retry only through the
  existing safe recovery contract.
- `quotepilot_doctrine`: Payment amount authority comes from the exact governed
  commercial obligation and pricing receipt. Browser state or a clicked button
  cannot establish payment.
- `quotepilot_doctrine`: The read-only Commercial Truth Loop may report findings
  but may never reprice, approve, settle, or repair payment state.
- `quotepilot_doctrine`: Stripe Connect remains bounded by the current stopping
  point in `docs/STRIPE_CONNECT_PROGRAM.md`; domain advice cannot activate or
  simulate provider capability.

## Reconsideration Questions

1. Which exact commercial obligation and amount does the attempt belong to?
2. Is the observed state prepared, dispatched, provider-accepted, processing,
   settled, failed, refunded, contradictory, or unknown under current code?
3. Could the provider have succeeded despite a client/server timeout?
4. What prevents duplicate active or settled operations?
5. Which server or provider receipt permits a customer-facing claim?
6. What recovery preserves both safety and operator comprehension?

Never fabricate provider settlement evidence or collapse missing, ambiguous,
and failed outcomes into one state.
