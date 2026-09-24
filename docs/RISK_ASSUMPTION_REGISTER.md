# QuotePilot Risk and Assumption Register

Last updated: 2026-09-24 01:57:41 CDT

## Use

This register captures uncertainties capable of changing product scope,
architecture, acceptance, or execution order. `PROJECT_STATUS.md` remains the
authority for current operational state and `DEV_TASKS.md` remains the backlog.

## Active risks

| ID | Risk | Impact | Evidence/state | Mitigation or validation | Owner | Review trigger |
|---|---|---|---|---|---|---|
| `RSK-001` | Source capability is mistaken for product completion. | Critical | All `FR-*` source requirements are mapped; product-acceptance boxes remain open. | Enforce `ACCEPTANCE_STANDARD.md` and close evidence classes independently. | Product owner + release reviewer | Any “done,” “ready,” or “successful” claim |
| `RSK-002` | No owner-approved outcome baseline or target policy exists. | High | Baselines are open and the target acceptance record is pending. | Run `BASE-04` and related baseline protocols; record owner decisions in the release/experiment ledger. | Product owner | Before outcome-led prioritization or commercial claims |
| `RSK-003` | The broad roadmap silently expands the core definition of finished. | High | Nine `QPI-*` packets span release proof, operations, commercial proof, and optional AI. | Keep `QPI-01`–`QPI-05` as the core release; treat later packets as separately gated phases. | Product owner | Backlog or release-boundary change |
| `RSK-004` | Documentation indexes drift from operational truth. | High | `docs/project/BLOCKERS.md` and `docs/project/PROOF.md` contain older split-release facts than `PROJECT_STATUS.md`. | Treat them as compatibility indexes only; reconcile or regenerate them before using their rows in a decision. | Documentation owner | Project-state check, release review, or index edit |
| `RSK-005` | Large uncommitted work mixes candidate, historical, and deployed state. | High | The active checkout contains substantial modified and untracked work across source, tests, and canonical docs. | Preserve exact-path ownership; keep source/local/CI/hosted/production claims separate; publish only scoped reviewed slices. | Release reviewer | Commit, PR, deploy, or acceptance preparation |
| `RSK-006` | Authenticated production proof overstates ordinary-role or cross-tenant safety. | Critical | Recorded production read used an identity with apparent platform-admin bypass; ordinary admin/sales denial remains open. | Run exact-SHA ordinary-role and cross-tenant hosted journeys with readback. | Security/release owner | Core release gate `QPI-01` |
| `RSK-007` | App Check state blocks or weakens safe operator workflows. | High | Browser token evidence and hard-enforcement readiness remain open. | Keep monitored safe state; verify provider registration, token exchange, denial, displayed recovery, and exact command readback before enforcement. | Firebase owner | Enforcement or Inventory command change |
| `RSK-008` | Provider configuration is mistaken for customer delivery, settlement, or consent. | Critical | Provider and production evidence are incomplete for ordinary email, payment, inquiry, and recipient journeys. | Reconcile exact request/provider/recipient identities and retain unknown states; collect customer/staff receipts. | Provider/domain owner | Any provider-backed release claim |
| `RSK-009` | Product value remains untested with real operators. | High | Human preference, workflow baseline, adoption, retention, and commercial outcome evidence are mostly absent. | Observe comparable real work with frozen cohorts and measures before claiming improvement. | Product owner | `QPI-06` or `QPI-08` entry |
| `RSK-010` | Rule/config architecture detail is asserted from incomplete retrieval evidence. | High | The refreshed graph did not establish tracked freshness for `firestore.rules` or `firebase.json`. | Keep rule-level detail out of summary docs; perform an authorized direct source review and run the rules/config validation lanes. | Security/release reviewer | Architecture, rules, deploy, or trust-boundary change |
| `RSK-011` | Independent operational domains are collapsed into one readiness claim. | High | Staffing, Inventory, BEO, production, attendance, payment, and evidence have distinct authorities and partial coverage. | Show per-domain basis and state; prohibit universal readiness aggregation. | Domain owners | New dashboard, score, or orchestration change |

## Assumptions requiring validation

| ID | Assumption | Current confidence | If false | Validation plan | Decision owner |
|---|---|---|---|---|---|
| `ASM-001` | The owner-operator is the primary coordinating user and receives the highest value from reduced reconciliation. | Moderate; repository-grounded hypothesis | Product hierarchy and prioritization may favor the wrong actor. | Interview and observe owner-operators plus sales, operations, kitchen, staffing, finance, and customer contacts. | Product owner |
| `ASM-002` | `QPI-01`–`QPI-05` form a sufficient core release boundary. | Moderate; dependency graph supports it | The release may omit a necessary operational or commercial proof step. | Conduct a release-boundary review against the charter, all Must requirements, and one complete real journey. | Product owner |
| `ASM-003` | Existing source capabilities can support the core journey without a new platform authority. | Moderate | Additional implementation, schema, or migration work may precede acceptance. | Execute the five packet acceptance journeys and record gaps without inventing new aggregate authority. | Architecture/domain owners |
| `ASM-004` | Operators will prefer explicit evidence and recovery states over faster but opaque automation. | Low until human study | The product may add cognitive load without reducing risk or time. | Run comparable before/after tasks and `MET-16` with correction guardrails. | Product owner |
| `ASM-005` | Current Vercel/Firebase split deployment remains the intended topology. | High for current source and policy | Architecture, rollback, receipts, and runbooks would need revision. | Reconsider only through an ADR and provider/release plan. | Architecture/release owner |

## Closed or converted items

When a risk is eliminated, retain the row with closure evidence or convert the
resolved trade-off into an ADR. When an assumption is accepted as policy, move
it into the owning charter, PRD, architecture, or contract and retain the
decision reference here.
