---
name: quote-wizard-release-manager
description: Prepare and validate releases for the React + Firebase quote wizard. Use when assembling release notes, confirming deployment readiness, updating changelog/status documentation, reviewing risk, or preparing a production deploy handoff.
---

# Quote Wizard Release Manager

## Release Workflow
1. Read `docs/DOC_SYSTEM.md`, `CHANGELOG.md`, `PROJECT_STATUS.md`, and `docs/VERSION_CONTROL.md`.
2. Load references:
   - `references/release-playbook.md`
   - `references/document-sync-checklist.md`
3. Confirm release scope and risk level.
4. Run readiness checks via `scripts/release-readiness.sh`.
5. Finalize canonical doc updates.
6. Publish release summary with rollback notes.

## Guardrails
- Do not release without passing build, governance, and bundle checks.
- Keep release notes aligned to actual merged changes.
- Highlight high-risk edits (pricing, persistence, Firestore rules, auth).
- Preserve traceability from release notes to commit/PR history.

## Resources
- `references/release-playbook.md`: canonical release sequence.
- `references/document-sync-checklist.md`: doc consistency checks.
- `scripts/release-readiness.sh`: repeatable pre-release checks.

## Readiness Script Options
- Base: `scripts/release-readiness.sh`
- Include CWV: `scripts/release-readiness.sh --with-cwv`
- Include high-risk Firebase lanes: `scripts/release-readiness.sh --high-risk`
