## Summary
- What changed:
- Why it changed:

## Change Intent Contract
- change_type: docs / process / ui / core / auth_rules / deploy
- risk_level: low / medium / high
- tenant_impact: none / read / write / rules
- required_lanes: auto / manual override (list lanes if override)
- doc_impact: canonical docs touched (`README.md`, `PROJECT_STATUS.md`, `DEV_TASKS.md`, `CHANGELOG.md`, `docs/DOC_SYSTEM.md`)

## Lane Evidence
- [ ] `lane:quick` (`npm run lane:quick`)
- [ ] `lane:core` (`npm run lane:core`)
- [ ] `lane:firebase-auth-rules` (required for high-risk/auth-rules/tenant-sensitive changes)
- [ ] `lane:authoritative-pricing` (required for high-risk/auth-rules/tenant-sensitive changes)
- [ ] `lane:release` (required for release-intent/main-bound operations)
- CI classifier summary:
- CI advisory failures accepted? yes / no (justify):

## Validation
- [ ] `npm run check:env`
- [ ] `npm run build`
- [ ] `npm run check:capability-surfaces` (required for backend/data authority changes)
- [ ] Manual behavior check completed (if needed)

## Capability Surfacing Contract
- Backend/data authority changed? yes / no
- Capability contract id(s):
- Audience and discoverable route/control/Attention entry:
- Directly changed export owner(s) and shared-helper affected export(s):
- UI state profile, canonical `data-capability-state` marker, and exact assertion-bearing test locator for each state/exception:
- If headless: classification, safe outcome, and non-exposure/reconciliation test:

## Risk Review
- Risk level: low / medium / high
- Affected areas:
- Rollback approach:
- Residual risk note:

## Production Release Gate
- Production impact: none / production-triggering
- [ ] If production-triggering: all hard-gate CI jobs are green (including Firebase/CWV lanes when required)
- [ ] If production-triggering: every intended target's tracked UAT item passed on immutable coordinated evidence; no profile-plan item remains blocked
- [ ] If production-triggering: rollback SHA/path is confirmed against `PROJECT_STATUS.md`
- Candidate commit SHA:
- Immutable candidate deployment id/URL:
- Checklist digest (`npm run release:uat:digest`):
- Intended target(s) and complete required positive-pass ids (`npm run release:uat:items -- --target <profile>`):
- Candidate profile plan (`npm run release:uat:plan -- --target <profile> --candidate-profile <staging-safe-off|staging-staffing-authority>`), including blocked ids/reasons:
- Candidate UAT attester and evidence link:
- Post-merge release SHA / exact-main CI run id (release operator):
- Protected UAT run id / exact deploy profile / rollback SHA (release operator):

## Documentation
- [ ] `CHANGELOG.md` updated (if user-visible change)
- [ ] `PROJECT_STATUS.md` updated (if milestone/status changed)
- [ ] `DEV_TASKS.md` updated (if roadmap priorities changed)
- [ ] `README.md` or `CONTRIBUTING.md` updated (if setup/process changed)

## Doc Impact Declaration
- Canonical docs touched:
- Why each update was needed under `docs/DOC_SYSTEM.md`:
- If no canonical doc changed, justify why:
