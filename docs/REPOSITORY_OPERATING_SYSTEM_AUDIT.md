# Repository Operating System Audit

Last updated: 2026-08-28 14:51:00 CDT

## Executive Assessment
QuotePilot already has a strong solo-developer agent harness. It is not a
greenfield repository and should not receive a parallel operating system.

Current maturity: **7.6 / 10**.

The strongest current mechanisms are `AGENTS.md`, `docs/DOC_SYSTEM.md`,
`docs/task-orchestration-contracts.json`, `npm run plan:task`, orchestration
lanes, capability-surfacing checks, release evidence checks, and repository
skills, local evidence records, the evidence index, and privacy-bounded session
diagnostics. The largest remaining constraint is reconciling accumulated
source, release, runtime, provider, production, human, and outcome evidence into
an owner-readable view without confusing those evidence classes or creating a
second authority.

## Adapted Scope
The full "best-of-breed repository operating system" prompt was intentionally
reduced for this repository:

- Keep existing canonical governance instead of creating a second framework.
- Strengthen evidence capture instead of adding dashboards or broad ceremony.
- Mechanize only the highest-leverage missing loop.
- Defer subagent review, hosted proof automation, and quality dashboards until
  repeated evidence shows they reduce human attention cost.

## Request-To-Outcome State Machine
| State | Trigger | Authority | Output | Validation | Failure / Escalation | Next |
|---|---|---|---|---|---|---|
| Request received | Human prompt, IDE context, attachment, or handoff | User and platform instructions | Intent signal | None | Ambiguous authority | Intent compiled |
| Intent compiled | Substantive request | Context amplifier / agent reasoning | Goal, likely scope, unknowns | Evidence classification | Unsupported assumption would change work | Repo scoped |
| Repo scoped | Work references this checkout | Git root and bounded scope | Root, dirty-tree awareness, allowed reads/writes | `git status`, scope manifest when editing | External/sibling target needed | Plan generated |
| Plan generated | Broad read or edit needed | `npm run plan:task` | Profile, risk, model tier, read-first files, docs, validations, task graph | Planner exits 0 | High-risk task needs frontier/external authority | Discovery |
| Discovery | Plan read-first files | Canonical docs and source | System facts and constraints | Targeted reads/searches | Conflicting docs/source | Scope correction |
| Skill loaded | Planner or task requires skill | Skill `SKILL.md` plus references | Reusable workflow rules | Skill body read before acting | Skill conflicts with repo truth | Implementation or report |
| Acceptance defined | User-visible, backend, or process behavior changes | Product docs, capability contracts, PR template | Expected behavior and evidence class | Test/check mapping | Acceptance cannot be made objective | Human decision |
| Implementation | Change authorized and scoped | Owned files only | Patch or artifact | Focused checks | Dirty unrelated WIP or ownership collision | Verification |
| Verification | Implementation complete | Planner validation list and scope-specific checks | Local proof | Commands exit 0 | Failed check | Fix or block |
| Documentation sync | Code/process/state truth changes | `docs/DOC_SYSTEM.md` | Canonical docs updated | `npm run check:docs:governance` | Stale/duplicated truth | Completion |
| Completion packet | Local work complete | `plan:task --phase complete` | Exact `recordedAt`, changed files, checks, risks | Planner exits 0 | Missing evidence | Handoff |
| Handoff | Human, PR, cloud runner, or AgentFlow needs continuity | Runbook / PR template | Evidence-separated packet | Reviewer/CI/provider checks as applicable | Local proof overstated as hosted/provider/production | Release or follow-up |
| Outcome observed | Feature used, defect filed, or human accepts/rejects | Human/product evidence | Outcome signal | Explicit record | No feedback path | Learning |
| Learning compressed | Repeated or structurally important outcome | Docs, skill, script, test, planner rule, or memory | Better future agent behavior | Subsequent task effectiveness | One-off accident overfit | Next request |

## Scorecard
| Dimension | Score | Evidence | Main Gap |
|---|---:|---|---|
| Agent legibility | 8 | Concise `AGENTS.md`, ownership map, runbook | No single audit entry point before this file |
| Context architecture | 8 | `plan:task` read-first files and skills | Some older docs/artifacts still require judgment |
| Source-of-truth integrity | 8 | `docs/DOC_SYSTEM.md` ownership matrix | Cross-project memory is outside repo authority |
| Intent compilation | 7 | Global context-amplifier behavior plus planner | Intent output is not persisted by default |
| Planning | 8 | Machine-readable planner and task graph | No built-in outcome ledger |
| Acceptance engineering | 7 | Capability contracts, PR template, emulator receipts | Product acceptance is uneven across newer docs |
| Proof architecture | 8 | Local/CI/provider/hosted/production/human boundaries | Requires discipline in final handoff language |
| Architecture enforcement | 7 | Capability, workflow, doc, bundle checks | Not every architectural rule is executable |
| Product invariant enforcement | 8 | Pricing/auth/proposal acceptance emulator coverage | Coverage varies by capability family |
| Test effectiveness | 7 | Unit, browser, Firebase emulator, CWV lanes | Some acceptance remains document-level |
| Agent review | 6 | PR template and human review expectations | Independent agent review is not systematic |
| Security and authority | 8 | Secret checks, high-risk routing, release gates | Provider proof still external/manual |
| Parallelism | 7 | CI fan-out, AgentFlow-compatible handoff, scoped ownership | Local task collisions remain possible in dirty trees |
| Skills and workflows | 7 | Maintainer/release skills and reusable scripts | Few repo-local skills for recurring product audits |
| Observability/debuggability | 8 | CI artifacts, emulator logs, release evidence scripts, `npm run evidence:index`, privacy-bounded session diagnostics | Hosted/product outcome observability remains separate |
| Documentation integrity | 8 | Governance timestamp and change-type enforcement | Generated design artifacts can drift |
| Recovery | 7 | Release candidate policy, rollback fields, mainline safety net | Non-release task recovery evidence is thin |
| Entropy control | 6 | Bundle/doc/secret/capability checks | No periodic entropy scan |
| Institutional memory | 6 | Docs and changelog | Outcome learning still lives mostly in chat/memory |
| Learning | 5 | Planner timestamps and memory outside repo | No repo-native task outcome compiler before this slice |
| Human attention efficiency | 7 | Planner and lanes reduce repeated instruction | Human still composes most completion evidence |
| Product feedback | 4 | UAT/release checklist exists | Shipped behavior outcome observation is mostly manual |

## Strongest Existing Mechanisms To Preserve
- `AGENTS.md` as the concise entry point.
- `docs/DOC_SYSTEM.md` as documentation authority.
- `npm run plan:task` as the task compiler and model-routing contract.
- Orchestration lanes as reproducible validation bundles.
- Capability-surfacing checks for no-orphan backend/data authority.
- Release evidence scripts and UAT separation.
- Repo-local skills for maintainer and release workflows.

## Highest-Impact Gaps
Critical:
- Persisted task outcome evidence is not yet a first-class local artifact.

High leverage:
- Independent review is policy-driven, not consistently mechanized.
- Product acceptance is uneven outside mature backend/proposal/payment flows.
- Entropy cleanup lacks a small recurring scan.

Worthwhile:
- Add a repo-local product-audit skill after one or two more repeated audits.
- Add a thin quality summary once task evidence exists.

Unnecessary now:
- A hosted dashboard or new telemetry database. A thin generated terminal/CI
  digest is now justified by observed release/document/branch contradictions.
- Mandatory subagents for every task.
- New cloud infrastructure.
- A second governance hierarchy.

## Target Architecture
The target system remains the current layered model:

1. Entry: `AGENTS.md`.
2. Knowledge: canonical docs from `docs/DOC_SYSTEM.md`.
3. Planning: `npm run plan:task`.
4. Execution: bounded owned files and skills.
5. Acceptance: user outcome mapped to objective proof.
6. Verification: focused checks plus lane gates.
7. Authority: explicit separation of analyze, edit, commit, push, merge, deploy,
   release, provider mutation, and production claims.
8. Evidence: local task evidence records under ignored `.cache/`.
9. Learning: repeated evidence becomes docs, scripts, skills, tests, or planner
  rules only when it earns that weight.
10. Reconciliation: a generated, read-only Product Truth Digest cites those
  authorities, surfaces contradictions and unknowns, and feeds an advisory
  drift gate before any future owner UI.

## Implemented In This Slice
- Added this adapted audit so future agents do not rerun the same system-level
  reasoning from scratch.
- Added `docs/DEVELOPMENT_EVIDENCE_COMPILER.md` as the evidence contract.
- Added `npm run evidence:task` for low-friction local evidence capture.
- Added `npm run evidence:index` to summarize ignored local evidence records
  into repeated risks, failed validations, missing timestamps, and next actions.
- Linked the evidence compiler from orchestration and governance docs.
- Hardened session diagnostics as the app-local runtime observability path:
  route/error/session events remain exportable, while URLs drop query/hash
  values, sensitive context values are redacted, and stable user identifiers and
  stack traces are hashed.

## Remaining Unknowns
- Current cloud-runner adoption is not verified by this local docs/process slice.
- Current AgentFlow service state is not checked here.
- CI proof for this exact change remains pending until pushed/PR-run.
- Human acceptance remains pending until the repository owner reviews this slice.

## Human Attention Analysis
Still should require the human:

- Product intent and priority.
- Approval for provider mutation, deployment, release, merge, destructive git, or
  production-data changes.
- Human acceptance of user-facing behavior.

Should not require the human repeatedly:

- Remembering validation commands.
- Rewriting proof-boundary language.
- Reconstructing which docs govern a change.
- Manually inventing every completion handoff from scratch.

## Evolution Mechanism
Future meaningful tasks should produce a small evidence file with:

- request and inferred intent,
- planner timestamp and risk profile,
- pre/post Git identity,
- changed files,
- validations and outcomes,
- evidence-class separation,
- human decision if available,
- residual risks,
- follow-up outcome.

Repeated patterns can then be promoted into a planner rule, check, skill,
template, or canonical doc. One-off accidents stay in evidence and do not become
permanent process.

## Next Best Action
Implement Phase 1 of `QP-OBS-018`: characterize the observed production-version
and branch-divergence conflicts, define normalized source facts, and prove that
the reconciler reports both sides without selecting a convenient source. Keep
the first delivery terminal/CI-only and advisory.
