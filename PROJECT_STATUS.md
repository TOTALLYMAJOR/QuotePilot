# Project Status

Last updated: March 27, 2026

## Operational Health
- Runtime: app is live on Firebase Hosting (`https://tonicatering.web.app`).
- Build: `npm run build` passes locally for this branch.
- Test coverage: unit + Playwright smoke suites are configured in CI.
- CI gates: classifier-driven lane gates are configured (`lane:quick`, `lane:core`, `Docker Build Smoke`, `lane:playwright-smoke`, `lane:firebase-auth-rules`, `lane:authoritative-pricing`, `lane:cwv-smoke`).
- P0 fallback-retirement safeguard: classifier now elevates `menuService`/`useCatalogData`/`organizationService`/`OrganizationContext` edits to `high_risk`, so Firebase heavy lanes are required (not advisory) on feature branches.
- Legacy quote safety: Firebase quote writes now auto-migrate legacy global quote docs into org-scoped paths during write/version flows when org context is present.
- Functions emulator compatibility: `functions.config()` v7 removal path now degrades safely to environment values instead of throwing at runtime.
- Deploy gate: production deploy workflow now runs only after successful `CI Quality` completion on `main` pushes (or controlled manual dispatch).
- Delivery controls: canonical doc ownership and governance checks are now enforced in CI.
- Commerce resilience: Twilio SMS failures are non-blocking for quote save and Stripe checkout.
- Buyer onboarding: Integrations Ops now includes an in-app setup assistant for optional Twilio configuration.
- Production guardrail: `ENABLE_FUNCTIONS_DEPLOY=false` (default locked state).
- Production fail-safe integration mode: `notifications.sms_provider="none"` in Firebase Functions config.
- Latest production release: header crew image/name spacing fix for narrow desktop header widths.
- Last known good production deploy:
  - commit: `a4a2568f06eaedcf9805c503bb161d2847d12710`
  - CI run: `CI Quality` #23203096351 (March 17, 2026 UTC)
  - workflow run: `Deploy Firebase Hosting (+ Optional Functions)` #23203174267 (March 17, 2026 UTC)

## Active Risks
- Firestore production hardening is in active P0 execution; fallback-retirement-sensitive feature-branch changes are now hard-gated through heavy Firebase lanes, but cross-org denial evidence is not complete yet.
- Bundle size remains a watch item; budget/CWV gates now prevent uncontrolled regressions.
- Functions integrations (Stripe/Twilio) remain optional and require secure runtime configuration.
- Staging sign-off routine must be re-established to keep `main` release-only under higher delivery velocity.

## Current Focus (Near-Term)
1. Complete P0 multi-tenant hardening execution for cross-org denial coverage on org-scoped quote/catalog writes.
2. Re-establish staging sign-off workflow before broadening merge velocity into `main`.
3. Expand end-to-end coverage for scheduling/booking edge paths.
4. Improve large-chunk performance while staying inside bundle/CWV guardrails.
5. Maintain per-merge documentation sync discipline under `docs/DOC_SYSTEM.md`.

## P0 Execution Tracking (In Progress)
- Focus: cross-org denial coverage for org-scoped quote/catalog write paths.
- Evidence expected before closure: emulator proof of wrong-org denial plus same-org allow controls, with command/test artifacts captured in merge evidence.
- Completion criteria: denial matrix is complete for org-scoped quote/catalog writes, no unresolved legacy-global fallback bypass remains on protected writes, and residual risk notes are updated if any gap remains.

## Notes
- Canonical status ownership is defined in [docs/DOC_SYSTEM.md](docs/DOC_SYSTEM.md).
- Launch operations guidance now lives in [docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md).
- Release-only branch and rollback policy live in [docs/VERSION_CONTROL.md](docs/VERSION_CONTROL.md).
- Backlog prioritization is tracked in [DEV_TASKS.md](DEV_TASKS.md).
