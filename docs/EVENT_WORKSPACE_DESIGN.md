# CWF-16 Event Workspace Design and Repository Audit

Status: Approved design direction and pre-code audit
Date: August 9, 2026
Visual source: `docs/design/cwf-16-event-workspace-concept.png`

## Current capability truth

The classifications below use repository behavior, not roadmap language.

| Capability | Classification | Repository evidence | Merged slice treatment |
|---|---|---|---|
| Quote creation/persistence | Implemented | `quoteStore`, trusted Firebase create/update paths, local fallback | Reuse; no write change |
| Quote editing | Implemented | `App.jsx#handleEditQuote`, `/app/quotes/:quoteId/edit` | Reuse exact route and existing gates |
| Quote revisions/history | Implemented | quote versions, active revision, comparison/history surfaces | Show lifecycle; keep dense history in Quotes |
| Proposal delivery/portal/acceptance | Implemented with evidence gates | `commerceOps`, customer portal, acceptance receipt | Preserve; do not synthesize inbox or acceptance claims |
| Payment/contract conversion | Implemented with provider/governed gates | Stripe evidence, conversion callable and approval path | Keep in administration; display quoted total only |
| Workflow Attention | Implemented deterministic projection | `buildWorkflowAttentionSummary`, `SalesWorkflowView` | Reuse top exact item for Condition/Needs You |
| Proposal readiness | Implemented deterministic selector | `buildProposalReadiness` | Reuse as proposal-completeness intelligence only |
| Scheduling | Implemented | `EventScheduleModal`, accepted/booking distinctions | Existing route shortcut |
| Staffing | Partial | quoted counts plus limited schedule assignments/checkpoints | Show quoted count only; no capacity/payroll/attendance claim |
| Rentals/equipment | Partial | selected quote items and quantities | Show sold scope; no inventory/reservation claim |
| Inventory availability/reservations | Absent | no owned/reserved/available/damaged/return authority | Omit and mark flexibility unavailable |
| Production checklist | Implemented, bounded | event production checklist and run-of-show projection | Existing Schedule/production context only |
| BEO generation/freshness | Implemented with source-specific authority | local export plus trusted server receipt/freshness panel | Reuse exact source boundary |
| Dependency reconciliation | Implemented, default-gated | Commercial Dependency State and named reconciliation | Retain existing evidence panel; do not flatten into a guessed state |
| Governed change/Change Impact | Implemented in edit/review context | Commercial Change Impact/Authority | Point to existing edit/review path; no idle recomputation |
| Decision Debt | Implemented for Firebase evidence | deterministic server score and exact factors | Keep technical panel below synthesis; do not duplicate score in overview |
| Optionality/Flexibility | Absent | no central optionality or declared change-window model | Return `Unavailable`, never estimate |
| Commitment Pressure/Leverage/Reversibility | Partial | exact Decision Debt factors for governed dependencies only | Evidence depth only; insufficient for event-wide Flexibility |
| Operational Slack | Absent | no capacity/resource absorption contract | Omit/Unavailable |
| Execution Fragility | Absent | no critical-path/resource-scarcity model | Omit/Unavailable |
| Artifact freshness | Partial | BEO/dependency-specific freshness | Preserve per-artifact evidence; no combined freshness score |
| Transaction Integrity/Alignment | Partial | separate revision, dependency and BEO evidence, no combined read | Return `Unavailable`; existing panels remain evidence |
| Materialization | Partial/unrelated | deterministic job materialization and UI cues exist in separate contracts | No Event Intelligence materialization in this slice |
| Navigation/permissions/responsive/tests | Implemented | workspace routes, role gates, responsive CSS, Vitest/Playwright | Reuse and extend |

## Existing UI infrastructure truth

| Infrastructure | Classification | Treatment |
|---|---|---|
| Shared UI components | Partial | Reuse `StatusChip`, route shells, evidence panels; add one focused view |
| Design tokens/typography | Partial | Reuse `styles.css` variables and neutral staff shell |
| Theme infrastructure | Partial | Preserve staff-versus-customer presentation boundaries |
| Motion primitives | Partial | No new intelligence animation |
| Accessibility helpers | Implemented/partial | Reuse route-heading focus and semantic controls; add tested details disclosure |
| Responsive conventions | Implemented | Reuse repository breakpoints and 390px containment contract |
| State/status primitives | Implemented/partial | Reuse status semantics; synthesis owns its own stable states/reason codes |

## UX problem map

| Current problem | Evidence | Design response |
|---|---|---|
| One event is buried in a 14-column table | `QuoteHistoryModal.jsx` history table | Dedicated first viewport |
| Focused handoff competes with search/table/admin controls | `.saved-quote-handoff` plus table | Separate detail and administration modes |
| Next action is distributed across row controls and Workflow | row actions, Workflow Attention | One bounded next-safe-action card |
| Event context lives in separate tools | Schedule, Customer 360, BEO panels | Five truthful context entries |
| Mobile detail inherits dense horizontal table | `.history-table-wrap` | Card/grid layout with no table on detail route |

## Intelligence synthesis map

```text
bounded quote facts
  + buildWorkflowAttentionSummary
  + buildProposalReadiness
  + source/authority availability
        ↓
stable presentation signals
  - exact top Workflow attention item
  - proposal completeness score + exact gaps
  - explicit missing change-window contract
  - explicit missing combined integrity projection
        ↓
operator-facing synthesis
  - Condition: exact attention or no tracked attention
  - Readiness: proposal readiness only
  - Flexibility: Unavailable until CWF-18 facts exist
  - Needs You: exact top Workflow item or none tracked
  - Alignment: Unavailable until combined evidence exists
        ↓
Why? disclosure
  - stable reason codes
  - evidence bounds
  - exact proposal gaps
```

The central presentation selector must not infer event-wide operational
readiness, commitment trap, flexibility, alignment, slack, fragility, capacity,
or predictive state from absent inputs. It deliberately returns `Unavailable`
for unsupported conclusions. The existing Commercial Dependency State,
Decision Debt, and BEO panels remain deeper evidence rather than independent
overview KPIs.

## Workspace hierarchy

```text
Event record
├── Identity and ordinary/governed edit boundary
├── Current condition
├── Needs You / next safe action
├── Deterministic intelligence strip
│   ├── Proposal readiness
│   ├── Flexibility (explicit availability state)
│   └── Alignment (explicit availability state)
│       └── Why? reason codes and evidence bounds
├── Operational context
│   ├── Schedule
│   ├── Staffing (quoted counts)
│   ├── Rentals & Equipment (selected scope)
│   ├── Production/BEO
│   └── Customer
├── Sold scope
├── Lifecycle
└── Existing trusted dependency/Decision Debt panels
```

## Component and function reuse map

| Reuse | Path |
|---|---|
| Quote loader, permissions, delivery locks, actions | `src/components/QuoteHistoryModal.jsx` |
| Route/edit/customer/workflow builders | `src/lib/workspaceRoutes.js` |
| Workflow item priority | `src/lib/quoteWorkflow.js#buildWorkflowAttentionSummary` |
| Proposal readiness | `src/lib/quoteWorkflow.js#buildProposalReadiness` |
| Status semantics | `src/lib/statusSemantics.js`, `StatusChip.jsx` |
| Human-readable presentation | `src/lib/workspacePresentation.js` |
| Shell tokens and breakpoints | `src/styles.css` |

## Expected path list

- New: `src/components/eventWorkspacePresentation.js` and focused unit tests.
- New: `src/components/EventWorkspaceView.jsx` and component tests.
- Extended: `src/components/QuoteHistoryModal.jsx`, `src/App.jsx`,
  `src/styles.css`, `e2e/customer-centered-workspace.spec.js`.
- Documentation: this PRD/UI spec/ADR/design/work plan plus canonical status,
  changelog, feature matrix, and user manual updates.
- No Functions, rules, indexes, pricing, quote persistence, or portal paths.

## Authority-risk review

- Ordinary edit availability must reuse current role/status/delivery gates.
- Accepted/booked scope must not imply direct mutation.
- Quote total is quoted commercial scope, not money received.
- Selected rentals are not inventory or reservations.
- Quoted staff counts are not assignments, attendance, payroll, or capacity.
- BEO state/action must retain local versus trusted Firebase labeling.
- An empty Workflow result is not event readiness.

## Repository-native test plan

- Pure model: identity formatting, lifecycle, attention/no-attention, proposal
  readiness reuse, deterministic repetition, stable reason codes, explicit
  Flexibility/Alignment unavailability, scope counts, and negative authority
  language.
- Component: visible hierarchy, action availability, exact callbacks, keyboard
  semantics, missing/partial content, and mobile-safe markers.
- E2E: direct detail route, Edit quote, Workflow focus, context navigation,
  Back/Forward, portal precedence, and 390px overflow.
- Gates: maintainer checks, full unit/build, default and flag-on Playwright,
  bundle, docs governance, secrets, workflows, and diff hygiene.
