# CWF-16 Event Workspace UI Specification

Last updated: 2026-09-10 15:09:08 CDT

Status: Historical CWF-16 implementation contract. Current ordinary
Ambient-enabled quote detail follows the Living Opportunity contract.
Date: August 9, 2026
Visual target: `docs/design/cwf-16-event-workspace-concept.png`

## Page hierarchy

1. Back to Quotes, event title, lifecycle chip, quote number, and source.
2. Customer, event date/time, guest count, and quoted total facts.
3. Primary Edit quote action when allowed; Quote administration returns to the
   existing administration table.
4. Current condition and Needs You / next safe action.
5. A compact synthesized intelligence strip: Proposal readiness, Flexibility,
   and Alignment, with one `Why?` evidence disclosure.
6. Schedule, Staffing, Rentals & Equipment, Production/BEO, and Customer
   context cards.
7. Sold scope and lifecycle.
8. Existing dependency/Decision Debt evidence panels where their current
   Firebase/role contracts allow them.

## States

| State | Presentation | Recovery |
|---|---|---|
| Loading | Event-workspace skeleton and `aria-busy` | Wait or return to Quotes |
| Missing | Exact quote unavailable; no adjacent quote substituted | Refresh or return to Quotes |
| Success | Identity, condition, context, scope, lifecycle | Existing safe actions |
| No attention | “No tracked quote attention” plus explicit bounded-source note | Open Quotes or contextual tool |
| Attention | Existing Workflow item label, reason, and exact focus action | Open in Workflow |
| Intelligence partial | Existing proposal readiness plus explicit unavailable Flexibility/Alignment | Open Why? evidence; do not guess |
| Edit restricted | Governed-revision explanation; no ordinary Edit button | Open quote administration/Workflow |
| Partial | Missing facts say Not recorded/Unavailable | Edit only when authorized |
| Error | Existing source error remains visible and no facts are invented | Refresh or return |

## Interaction contract

- `Edit quote` calls the existing `onEditQuote` path and is available only for
  draft/sent/viewed plus the existing role/delivery lock.
- `Open in Workflow` passes exact `quoteId`, `attentionType`, and request ID when
  present.
- `Why?` exposes stable reason codes, proposal gaps, source, and evidence bounds.
  It does not expose a wall of Decision Debt/pressure/reversibility cards.
- Schedule and Staffing use the existing Schedule route; no new staffing route
  is implied.
- Rentals & Equipment scrolls to selected sold scope; it never says Inventory.
- Production/BEO opens the existing trusted or browser-local BEO action and
  keeps its source/freshness boundary.
- Customer opens the existing opaque-ID Customer 360 route when available.
- `Quote administration` and the administration next-action return to
  `/app/quotes`, which retains all current
  provider/payment/booking/portal/admin controls.

## Responsive and accessibility contract

- Desktop uses a 12-column-feeling two-panel composition with the next action
  at the right of the identity/condition region.
- Below 900px, next action and scope/lifecycle become one column.
- Below 640px, context cards become one column, all actions remain at least
  44px high, and long names/IDs wrap.
- The route heading receives programmatic focus. Visible focus rings, semantic
  buttons, text labels with icons, reduced-motion behavior, and source/status
  text remain mandatory.
- The implementation uses the neutral staff-shell tokens; customer/tenant
  branding remains isolated from staff authority presentation.
