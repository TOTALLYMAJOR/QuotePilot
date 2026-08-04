# Project Status

Last updated: August 3, 2026

## Operational Health
- Runtime: the public custom domain (`https://quotepilot.mbmapps.com`) is aliased to Vercel production deployment `dpl_9K7pqmZjqAMBbegKq3uyUf6rGVXv` from `main` commit `dc460e3dca79c0b0eea512bb1902ba20a4b7c67c`, which is `READY` and promoted. Hosted HTTP checks returned the QuotePilot application shell with status `200` at `/`, `/app`, and `/system`. Firebase Hosting remains the origin/fallback (`https://tonicatering.web.app`).
- Current branch product identity: install metadata, runtime defaults, proposals, integration messages, and onboarding links use QuotePilot/MBMapps branding; the legacy Firebase project ID and hosting origin remain unchanged infrastructure identifiers.
- Build and local validation: the full unit suite passes with its intentional
  skips, along with 33 focused Firestore rules tests and the default
  Playwright suite (27 passed, 2 intentionally gated provisioning-role cases
  skipped). The Firebase Auth/catalog browser lane, authoritative
  pricing/quote/portal browser lane, and full provisioning emulator acceptance
  matrix also pass. Both the browser application and Functions production
  dependency trees report zero known vulnerabilities under `npm audit
  --omit=dev`. This is local/emulator evidence, not hosted tenant acceptance.
- Functions runtime readiness: Functions now target Node.js 22 and use Firebase
  Admin 14 modular app, Auth, and Firestore APIs. The local authoritative and
  provisioning matrices pass with that runtime candidate.
- Test coverage: unit + Playwright smoke suites are configured in CI.
- Current branch workflow delivery: proposal readiness, Good/Better/Best scenarios, quote lifecycle timelines, lead follow-ups, sensitive-action approval requests, the customer decision center, and event production checklists are implemented and locally covered.
- Production marketing delivery: a hospitality-first prospect page is live at `/`, the prior dark product overview is live at `/system`, and the authenticated workspace resolves at `/app`; customer portal query routes retain precedence in the client router.
- Current branch tenant onboarding delivery: admin-only Import Studio supports tenant-locked CSV preview/import for customers, packages, add-ons, rentals, and menu items, with duplicate skipping, receipts, and rollback limited to records stamped by the import batch.
- Current release-candidate provisioning hardening adds verified-email,
  role-document, and allowlist-backed platform authority; explicit plan/create
  confirmation; atomic collision-safe creation; seven-day owner invitations;
  an explicit active organization lifecycle; blank catalog and neutral
  unapproved pricing defaults; conflict-safe catalog saves; trusted atomic
  server-priced quote creation and edits; admin-only safe reopen; callable-only
  quote/portal cleanup; exact-order resume; a durable email-dispatch lease; a
  separate entitlement-only mode; preview-only CLI behavior; owner claims
  repair; deletion tombstones; and atomic terminal portal decisions across both
  quote copies. Until the coordinated production deployment is verified, these
  Functions/frontend changes do not have hosted tenant-acceptance proof.
- Policy-enforcing release preparation now packages Functions source without loading
  or materializing runtime secrets. Firebase scope is an explicit workflow
  input (`hosting`, `backend`, or `all`) bound to UAT and preparation evidence
  rather than a mutable repository toggle; `backend` is Firestore rules plus
  Functions. Runtime configuration remains the responsibility of a separately
  owned credential-isolated deployer.
- Current branch tenant identity fix: explicit blank tenant logo/contact/address/crew values no longer fall back to the legacy customer profile, and Catalog Admin branding edits retain their draft through parent rerenders with persistent save/discard affordances.
- Current branch tenant authorization hardening: Firestore denies unverified
  email authority and conflicting claim/role organization scopes, permits
  tenant-domain mapping changes only for same-organization admins, and keeps
  commercial entitlements server-owned. Direct quote and portal deletion is
  denied, sales status authority is limited to an exact draft-to-sent
  transition, and sales schedule writes are limited to non-evidentiary
  staff/checklist fields.
- Current branch provider authorization hardening: outbound quote email, owner
  SMS, payment requests, checkout creation, provider status, and provider tests
  require the current authoritative admin role. Disabled providers reject and
  omit retained credentials. Browser CRM networking is disabled; admins can
  record organization-scoped integration audit events without an outbound send.
- Workflow authority boundaries: approval resolution does not execute a sensitive action; customer acceptance does not prove payment or booking; production checklist completion does not prove inventory availability.
- CI gates: all eight verifier-required jobs are configured (`Classify Changes
  + Lane Plan`, `lane:quick`, `lane:core`, `Docker Build Smoke`,
  `lane:playwright-smoke`, `lane:firebase-auth-rules`,
  `lane:authoritative-pricing`, `lane:cwv-smoke`).
- P0 fallback-retirement safeguard: classifier now elevates `menuService`/`useCatalogData`/`organizationService`/`OrganizationContext` edits to `high_risk`, so Firebase heavy lanes are required (not advisory) on feature branches.
- Legacy global runtime fallback retired: frontend tenant data services and authoritative pricing/functions paths now fail closed when org context is missing instead of reading legacy global collections.
- Firestore policy hardening: retired global business collections (`catalog*`, `pricing/settings`, `eventTypes`, `menu*`, `quotes`, `quoteHistory`) are now denied in rules so org-scoped paths are authoritative.
- P0 denial evidence captured: focused Firestore emulator matrix now documents same-org allow + wrong-org deny behavior for org-scoped quote/catalog write paths.
- Migration dry-run evidence captured for production project/org (`tonicatering` / `250`) under `.cache/migration-dry-runs/` with structured totals (`wouldCreate=468`, `wouldPatch=20`).
- Production migration execution evidence captured for project/org (`tonicatering` / `250`) under `.cache/migration-runs/` with structured totals (`source=496`, `created=1`, `patched=0`).
- Migration operator resilience: `scripts/migrate-to-multi-tenant.mjs` supports
  Firestore REST execution when ADC credentials are unavailable, defaults to a
  read-only dry run, requires explicit project/organization scope, and requires
  an exact confirmation token before apply mode.
- Portal token rule hardening is implemented and emulator-validated: portal snapshot reads/status updates now require active (non-deleted + non-expired) snapshots at the Firestore rule layer.
- Portal snapshot expiry-ms backfill was executed for production org `250` (`customerPortalQuotes patched=2`) to preserve existing portal-link behavior under hardened rules.
- Legacy quote safety: Firebase writes no longer copy legacy global quote data
  into an organization during mutation. Direct quote creation is denied by
  Firestore rules, trusted Functions create and edit canonical drafts
  atomically with their portal/version records, and existing write/version
  flows require the org-scoped quote target to exist. Admin-only reopen rejects
  accepted, declined, booked, paid, or refunded evidence.
- E2E operational safety: Firebase browser lanes use an isolated emulator
  configuration and dedicated ports; they fail on a port conflict rather than
  terminating unrelated local processes.
- Firebase hosting target safety: the deterministic payload manifest binds the
  `app` target to the `tonicatering` site and hashes the exact staged payload.
- Functions emulator compatibility: `functions.config()` v7 removal path now degrades safely to environment values instead of throwing at runtime.
- Release gate: preparation requires an unchanged tracked checkout of a
  semantically tagged `main` commit
  matching `origin/main`. The current source candidate fail-closes on the exact
  main-push CI run and eight required jobs, a fresh allowlisted-human UAT result,
  exactly one recorded approval for that UAT run by an independent current
  direct reviewer, exactly one recorded `production` approval for the preparation
  run by a reviewer other than its dispatcher and UAT attester, the tracked
  checklist digest and human-entered staging label, a target-specific rollback
  ancestor, and protected no-bypass
  `production-uat`/`production` policy. It then stages an explicit payload and
  records deterministic file hashes plus fixed provider identifiers without
  receiving provider mutation credentials or Functions runtime secrets or
  mutating production.
- Delivery controls: canonical doc ownership and governance checks are now enforced in CI.
- Commerce resilience: Twilio SMS failures are non-blocking for quote save and Stripe checkout.
- Buyer onboarding: admin-only Integrations Ops includes an in-app setup assistant for optional Twilio configuration.
- Production guardrail: Firebase preparation scope defaults to `hosting`; a
  `backend` or `all` artifact requires a matching evidence profile.
- Source-defined production fail-safe integration mode is
  `NOTIFICATIONS_SMS_PROVIDER=none`. That value still needs provider-hosted
  runtime verification through the approved trusted channel; the ignored
  project-scoped Functions environment is for local/emulator validation only.
- Latest Vercel production operation: SPA rewrite hotfix restoring direct `/app` and `/system` requests on the custom domain.
- Last known good Firebase Hosting deploy:
  - commit: `a4a2568f06eaedcf9805c503bb161d2847d12710`
  - CI run: `CI Quality` #23203096351 (March 17, 2026 UTC)
  - workflow run (historical name): `Deploy Firebase Hosting (+ Optional Functions)` #23203174267 (March 17, 2026 UTC)

## Active Risks
- The exact-SHA release gate is a source candidate, not an operationally proven
  production control. As audited on August 3, `main` has strict required checks,
  admin enforcement, linear history, and force-push/deletion denial, but it
  requires zero PR approvals and has no code-owner, stale-review, or last-push
  approval rule. The sole collaborator is the repository administrator.
  `production-uat` does not exist; `Production` has no required reviewer,
  deployment branch policy, variables, or environment secrets and permits
  administrator bypass. Independent review is therefore not enforceable in
  the present collaborator/environment setup. Confirm private-repository plan
  eligibility or move to an eligible organization/external gate, then rehearse
  the complete sequence outside production. Vercel Git integration must also
  be prevented from bypassing the controlled workflow.
- The verifier, workflows, checklist, test jobs, payload stager, and manifest
  generator are all candidate-controlled code in this repository; they are not
  an independent authorization authority. The separately owned trusted deployer
  must revalidate the GitHub run/artifact identity and digest, both review
  records, and every downloaded payload file against the manifest while rejecting
  extras before any provider mutation credential is introduced.
- Draft PR #21 (product hardening) and draft PR #22 (release preparation) have
  each earned green eight-job GitHub CI on a published SHA; every subsequent
  push still requires fresh exact-head qualification. Their Vercel Preview
  deployments fail at `npm run check:env` because all six required Preview-scope
  `VITE_FIREBASE_*` browser variables are absent. No hosted release-candidate
  acceptance exists until those non-secret Preview variables are configured and
  the exact PR SHA is reverified; source CI is not hosted proof.
- The tracked UAT receipt still binds only a human-entered staging identifier.
  It does not query a provider to prove project, non-production environment,
  READY status, source SHA, artifact/configuration digest, or timestamp. The
  verifier now proves `APPROVED` review records are attached to the exact UAT and
  preparation workflow runs, but GitHub exposes no review timestamp or historical
  environment-policy snapshot through that object, and the uploaded UAT receipt
  is not independently consumed. Bind provider-derived staging evidence and a
  separately owned audit record before treating the result as tamper-independent
  release proof.
- Primary Firebase and Vercel workflows are now
  provider-mutation-credential-free prepare-only jobs; their legacy deploy
  commands fail closed and no longer resolve provider
  CLIs through `npx`. Production promotion is intentionally unavailable until a
  separately owned trusted deployer revalidates the uploaded artifact identity,
  manifest, and payload and uses a locked audited provider client while holding
  the minimum provider mutation credential. The
  separate customer-site Hosting entrypoint now also fails closed; that
  promotion path is intentionally unavailable until it moves behind the same
  trusted boundary.
- Rollback input currently proves Git ancestry only, not that the selected SHA
  is a provider-specific last-known-good deployment. Record signed target
  deployment manifests with provider deployment id, source SHA, artifact and
  configuration digests, success status, and component-specific rollback data.
- The Node.js 22/Firebase Admin 14 Functions candidate is locally validated but
  has not been deployed or observed on the production Functions runtime.
- The Vercel deployment and custom-domain alias are provider-verified, but the authenticated production quote/save/export workflow still needs post-release browser acceptance.
- Provisioning hardening is release-candidate implementation only. Do not treat the
  in-app preflight, verified-owner activation, entitlement-only update path,
  catalog conflict checks, trusted quote creation, CLI safety changes, or
  onboarding checklist as production behavior until the reviewed
  Functions/frontend/rules slice is deployed and exercised with a disposable
  second organization.
- Resend custom-domain sending remains blocked because the account's one included domain slot is occupied by `leaguepilot.us`; adding `quotepilot.mbmapps.com` requires an account upgrade or explicit authorization to remove/migrate the existing domain, followed by authoritative DNS verification. The production custom-domain sender remains disabled. An external, manual Resend dashboard sandbox message from `QuotePilot by MBMapps <onboarding@resend.dev>` was provider-accepted and recorded as delivered (`34deea9f-8a1c-47ce-8f4e-2ea5164a2eec`), but that address is not an allowed QuotePilot Functions configuration and the result is not custom-domain or recipient-inbox proof.
- Import Studio and its `importBatches` Firestore rules are implemented locally but are not deployed or hosted-smoke-verified. Excel intake, merge/update policies, saved import history UI, and active quote/payment/contract/booking imports are intentionally not included in this first slice.
- The new `portalDecision` Firestore rule changes and enriched portal snapshots are implemented locally but are not deployed or hosted-smoke-verified in this branch.
- Approval requests are role-gated in the application workflow, but stronger server-authoritative action-specific enforcement and end-to-end audit linkage remain follow-up work.
- Existing portal snapshots need refresh/backfill before older links can display every newly added event, selection, and pricing field.
- Firestore production hardening is in active P0 execution; fallback retirement, denial evidence, migration execution, and portal hardening implementation are complete, but production rollout of updated portal rules is not complete yet.
- Bundle size remains a watch item; budget/CWV gates now prevent uncontrolled regressions.
- Functions integrations (Stripe, Twilio, and Resend) remain optional and require secure runtime configuration plus provider-level acceptance/delivery proof; committed placeholder templates are not provider configuration.
- CRM outbound synchronization is intentionally disabled until a
  server-authorized connector with provider acceptance evidence is implemented.
- Staging sign-off routine must be re-established to keep `main` release-only under higher delivery velocity.

## Current Focus (Near-Term)
1. Review and qualify the exact published heads of draft PR #21 (product
   hardening) and draft PR #22 (release preparation); every new push needs fresh
   exact-head CI evidence.
2. Configure the six non-secret Preview-scope `VITE_FIREBASE_*` variables and
   complete hosted release-candidate acceptance on the exact PR heads.
3. Configure protected no-bypass GitHub environments and independent direct
   reviewers, disable provider-side bypasses, implement the separately owned
   trusted deployer plus provider-specific staging/LKG receipts, and complete a
   non-production rehearsal before any promotion.
4. After those controls are qualified, promote the exact reviewed
   rules/Functions/frontend artifacts and run the hosted owner/quote/portal
   tenant acceptance checklist, including active, expired, deleted, and
   change-request portal paths.
5. Verify the intended Resend sender domain in the Resend dashboard and authoritative DNS; only then configure `onboarding@quotepilot.mbmapps.com` and capture accepted, delivered, and recipient proof from one controlled test.
6. Refresh/backfill existing customer portal snapshots with the new customer-safe event and pricing fields.
7. Extend the tracked UAT checklist for PR #21's delivery, approval execution,
   contract, and backfill paths when that product slice is integrated.
8. Add server-authoritative enforcement and audit linkage for approval-request-to-admin-action execution.
9. Improve large-chunk performance while staying inside bundle/CWV guardrails.

## P0 Execution Tracking (Completed March 28, 2026)
- Focus completed: migration execution after fallback retirement and denial-matrix verification.
- Evidence captured:
  - `.cache/p0-denial-matrix/20260328T001230Z--firestore-rules-cross-org-denial.log`
  - `.cache/p0-denial-matrix/20260328T022716Z--firestore-rules-portal-expiry-hardening.log`
  - `.cache/migration-dry-runs/20260328T001210Z--tonicatering--250--dry-run.log`
  - `.cache/migration-dry-runs/20260328T001210Z--tonicatering--250--dry-run.json`
  - `.cache/migration-dry-runs/20260328T022619Z--tonicatering--250--portal-ms-dry-run.log`
  - `.cache/migration-dry-runs/20260328T022619Z--tonicatering--250--portal-ms-dry-run.json`
  - `.cache/migration-runs/20260328T001919Z--tonicatering--250--apply.log`
  - `.cache/migration-runs/20260328T001919Z--tonicatering--250--apply.json`
  - `.cache/migration-runs/20260328T022640Z--tonicatering--250--portal-ms-apply.log`
  - `.cache/migration-runs/20260328T022640Z--tonicatering--250--portal-ms-apply.json`
- Remaining P0 rollout item: deploy hardened portal rules to production and attach post-deploy smoke evidence.

## Notes

- Canonical status ownership is defined in [docs/DOC_SYSTEM.md](docs/DOC_SYSTEM.md).
- Launch operations guidance now lives in [docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md).
- Release-only branch and rollback policy live in [docs/VERSION_CONTROL.md](docs/VERSION_CONTROL.md).
- Backlog prioritization is tracked in [DEV_TASKS.md](DEV_TASKS.md).
