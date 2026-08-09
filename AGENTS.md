# AGENTS.md

Last updated: August 8, 2026

## Mission
Maintain QuotePilot as a reliable production system.
Ship safe changes with validation evidence and canonical documentation sync.

## Core Facts
- Frontend: React 18 + Vite 7
- Services: Firebase Auth, Firestore, Firebase Hosting
- Public production edge: Vercel (`https://quotepilot.mbmapps.com`)
- Firebase origin/fallback: Firebase Hosting (`https://tonicatering.web.app`)
- Legacy Firebase project/site ID `tonicatering` is an infrastructure identifier,
  not the customer-facing product name.

## Required Workflow
1. Read canonical ownership policy in `docs/DOC_SYSTEM.md`.
2. Use the smallest safe implementation scope.
3. Run required checks:
   - `npm run check:env`
   - `npm run build`
   - `npm run check:capability-surfaces` when backend/data authority changes
   - plus scope-specific tests (`test:unit`, `test:e2e`, governance/perf checks) as needed.
4. Update canonical docs per trigger rules in `docs/DOC_SYSTEM.md`.
5. Report changed files, validations, and residual risks.

## Guardrails
- Never commit secrets (`.env`, private keys, token values).
- Treat `firestore.rules` and `firestore.indexes.json` as high-risk files.
- Preserve local fallback behavior when Firebase config is missing.
- Keep customer-facing quote/proposal outputs accurate.
- Keep role-gated controls restricted to authorized users.
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
- `firestore.rules`
- `firestore.indexes.json`

## Definition of Done
- Build passes.
- User-visible behavior matches scope.
- Canonical docs are in sync (`docs/DOC_SYSTEM.md`).
- Risks and follow-ups are explicit.

## Local Skill Pack
Canonical skill assets are tracked in `.codex/skills/`.
Governance policy is defined in `docs/AGENT_GOVERNANCE.md`.
