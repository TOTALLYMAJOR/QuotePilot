---
name: quote-wizard-maintainer
description: Maintain and evolve the React + Firebase catering quote wizard. Use when implementing features, fixing defects, refactoring quote or catalog logic, adjusting Firebase data/auth flows, or updating technical documentation in this repository.
---

# Quote Wizard Maintainer

## Core Workflow
1. Read `docs/DOC_SYSTEM.md`, `README.md`, `AGENTS.md`, and `PROJECT_STATUS.md`.
2. Load references before edits:
   - `references/code-map.md`
   - `references/safe-change-checklist.md`
   - `references/quoting-enhancement-design-notes.md` (required before any
     quoting-roadmap or template-system work)
3. Implement the smallest safe change set.
4. Validate with `scripts/run-maintainer-checks.sh`.
5. Update canonical docs using `docs/DOC_SYSTEM.md` triggers.
6. Report changed files, checks run, and residual risks.

## Technical Standards
- Preserve compatibility with existing quote and customer portal records.
- Keep quote status values consistent with lifecycle states.
- Preserve local fallback behavior when Firebase is unavailable.
- Treat `quoteCalculator`, `quoteStore`, and Firestore rules as high-risk areas.

## Validation Rules
- Default validation: `scripts/run-maintainer-checks.sh`
- Fast validation (docs/light edits): `scripts/run-maintainer-checks.sh --quick`
- Build-only validation: `scripts/run-maintainer-checks.sh --build-only`
- High-risk validation: `scripts/run-maintainer-checks.sh --high-risk`
- Explicit lane validation: `scripts/run-maintainer-checks.sh --lane lane:quick|lane:core|lane:firebase-auth-rules|lane:authoritative-pricing|lane:release`
- Optional CWV gate: `scripts/run-maintainer-checks.sh --with-cwv`

## Resources
- `references/code-map.md`: fast map of high-impact files.
- `references/safe-change-checklist.md`: pre-change and post-change checklist.
- `references/quoting-enhancement-design-notes.md`: quoting roadmap design
  rationale, template-system findings, and per-proposal constraints.
- `scripts/run-maintainer-checks.sh`: repeatable quality gate runner.
