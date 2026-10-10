# AGENTS.md

Last updated: 2026-09-16 18:04:49 CDT

## Mission
Maintain QuotePilot as a reliable production system.
Ship safe changes with validation evidence and canonical documentation sync.

## Core Facts
- Frontend: React 18 + Vite 7
- Services: Firebase Auth, Firestore, Firebase Hosting
- Reconciliation tier: Python 3.11+ (`truthloop/`), read-only, standard library
  only, no credentials and no write path
- Public production edge: Vercel (`https://quotepilot.mbmapps.com`)
- Firebase origin/fallback: Firebase Hosting (`https://tonicatering.web.app`)
- Legacy Firebase project/site ID `tonicatering` is an infrastructure identifier,
  not the customer-facing product name.

## Required Workflow
1. Read canonical ownership policy in `docs/DOC_SYSTEM.md`.
2. Before broad reading or edits, run `npm run plan:task` with an explicit
   `--task` and `--files` set, then follow its dependency/read map. An external
   runner may apply the emitted model and reasoning recommendation before work;
   an already-running agent records the recommendation and continues without
   claiming an in-process model switch. Load every emitted `requiredSkills`
   entry completely before acting. UI work must load `design-language` and use
   `docs/DESIGN_SYSTEM.md` plus `docs/DESIGN_PRINCIPLES.md` as its local truth.
   When `domainClassification.applicable` is true, load
   `catering-domain-intelligence`, form a provisional action from current
   repository authority and implementation, then read only the emitted domain
   reference slices and reconsider that action before implementation. Domain
   commentary is optional; a changed decision or validation is the evidence
   that the expertise affected the work.
3. Use the smallest safe implementation scope.
4. Run required checks:
   - `npm run check:env`
   - `npm run build`
   - `npm run check:capability-surfaces` when backend/data authority changes
   - `npm run test:truthloop` when `truthloop/` changes
   - `npm run test:unit` and `npm run truthloop:coverage` when `evidence/` changes
   - plus scope-specific tests (`test:unit`, `test:e2e`, governance/perf checks) as needed.
5. Update canonical docs per trigger rules in `docs/DOC_SYSTEM.md`.
6. At completion, rerun `npm run plan:task` with the same `--task` and
   `--files` plus `--phase complete`, then report its exact UTC `recordedAt`
   timestamp with changed files, validations, and residual risks.

## Guardrails
- Never commit secrets (`.env`, private keys, token values).
- Treat `firestore.rules` and `firestore.indexes.json` as high-risk files.
- Preserve local fallback behavior when Firebase config is missing.
- Keep customer-facing quote/proposal outputs accurate.
- Keep role-gated controls restricted to authorized users.
- Keep the reconciliation tier read-only. The Python reconciler
  (`truthloop/`) and the evidence exporter (`evidence/`) must never gain a
  write path, a credential, or network access, and findings are observations
  rather than pricing, approval, or customer-facing authority.
- Never let the reconciler or a producer infer a rate or threshold from
  history and then apply it as policy; such values are operator-declared
  evidence carried with a declaring actor and timestamp.
- Never collapse evidence availability into null. `missing`,
  `not_applicable`, `not_yet_available`, `blocked_by_integration`,
  `contradictory`, and `schema_drift` are distinct operator instructions.
  Only `available` and `not_applicable` may let a rule reach a verdict.
- Keep the payout producer inert behind the Stripe Connect stopping point in
  `docs/STRIPE_CONNECT_PROGRAM.md`. Never fabricate or simulate provider
  settlement evidence to make a record reconcile.
- Do not ship an orphan user-relevant backend capability: bind it to a
  discoverable role-safe frontend surface, UI-state tests, Feature Matrix, and
  User Manual through `docs/capability-surfacing-contracts.json`. Keep private
  security primitives hidden and surface only their safe operational outcome.
  Direct callable ownership and shared-helper callable impacts must be declared;
  each claimed UI state must have an assertion-bearing canonical component marker.

## High-Risk Files
- `src/lib/quoteCalculator.js`
- `src/lib/quoteStore.js`
- `src/lib/firebase.js`
- `src/lib/authClient.js`
- `src/lib/proposalExport.js`
- `truthloop/src/quotepilot_truthloop/money.py`
- `evidence/src/producers/payoutProducer.mjs`
- `docs/truthloop-evidence-contract.json`
- `firestore.rules`
- `firestore.indexes.json`

## Definition of Done
- Build passes.
- User-visible behavior matches scope.
- Canonical docs are in sync (`docs/DOC_SYSTEM.md`).
- Project state and evidence references pass `npm run check:project-state`.
- Risks and follow-ups are explicit.

## Local Skill Pack
Canonical skill assets are tracked in `.codex/skills/`.
Governance policy is defined in `docs/AGENT_GOVERNANCE.md`.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues for `TOTALLYMAJOR/quoteflow`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` labels. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context domain layout: an optional root `CONTEXT.md` glossary and system-wide decisions under `docs/adr/`. See `docs/agents/domain.md`.
