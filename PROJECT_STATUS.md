# Project Status

Last updated: August 3, 2026

## Operational Health
- Runtime: the public custom domain (`https://quotepilot.mbmapps.com`) is
  aliased to Vercel production deployment
  `dpl_9K7pqmZjqAMBbegKq3uyUf6rGVXv`, built from merged `main` commit
  `dc460e3dca79c0b0eea512bb1902ba20a4b7c67c`; it reached `READY` on August 3,
  2026. Main CI run `30837136091` passed all eight jobs, and hosted HTTP checks
  returned status `200` at `/`, `/app`, and `/system`. Firebase Hosting remains
  the origin/fallback (`https://tonicatering.web.app`).
- Current branch product identity: install metadata, runtime defaults,
  proposals, integration messages, and onboarding links use QuotePilot/MBMapps
  branding; the legacy Firebase project ID and hosting origin remain unchanged
  infrastructure identifiers.
- Candidate validation: the combined sell-readiness working tree passes the
  local quick/core gates: 624 unit tests pass with 39 intentional skips, the
  production build, documentation governance, bundle budget, secret scan, and
  environment check pass, and 327 focused release/deletion regressions plus all
  four target-specific UAT item sets pass. Its product/runtime changes also
  passed isolated Firestore rules (38/38), default Playwright (31 pass, 2
  intentional skips), Firebase Auth and authoritative-pricing browser lanes,
  the provisioning acceptance matrix, Docker production-image build,
  Lighthouse, and both production dependency audits; only release
  checklist/docs/tests changed after those high-risk runs. The candidate still
  needs to be committed, published, and requalified by exact remote head; local
  results are not hosted tenant or provider acceptance.
  All local/emulator results remain distinct from hosted tenant and provider
  acceptance.
- Functions runtime readiness: Functions now target Node.js 22 and use Firebase
  Admin 14 modular app, Auth, and Firestore APIs. The local authoritative and
  provisioning matrices pass with that runtime candidate.
- Test coverage: unit + Playwright smoke suites are configured in CI.
- Current branch workflow delivery: proposal readiness, Good/Better/Best
  scenarios, quote lifecycle timelines, lead follow-ups, sensitive-action
  approval requests, the customer decision center, and event production
  checklists are implemented and locally covered. A tenant-scoped Workflow
  Attention queue now consolidates due follow-ups, pending approvals, and
  current customer change requests. Its post-idle header count preserves the
  lazy workspace boundary; request-ID-bound acknowledge/handled state is internal
  only and never edits customer decision evidence or sends email/SMS.
- Current branch quote-entry simplification: Step 1 keeps attendance and role
  counts in the primary flow while placing five exceptional staffing-rate
  values in Advanced Pricing. Existing saved/template values trigger a visible
  review warning and survive collapse/reopen; 1440px, 390px, and 320px layout
  containment is locally covered without changing pricing or persistence code.
- Current branch draft handoff: the final wizard action explicitly saves a
  draft, Quote History focuses the exact saved quote with a role-safe next
  action, copying an email template preserves draft status, and draft portal
  links are neither rendered nor copyable as customer-ready artifacts. Firebase
  admin delivery fails closed until a supported provider configuration is
  present, is bound to the saved content revision plus portal issuance, and
  sends only server-built
  email/portal content; browser PDF attachments are rejected. A 23-hour bounded
  provider-idempotency window supports prompt same-key retry, while uncertain
  outcomes enter a mutation-locked review state. An expired definite failure
  starts a fresh delivery generation; an ambiguous outcome requires same-key
  retry or audited provider review. A server-observed provider acceptance cannot
  be reconciled as not sent. Provider acceptance activates the portal only when
  it matches the valid current issuance. Acceptance against an invalid or
  expired portal is retained as `requires_rotation`; that portal remains
  inactive until guarded rotation and a new provider send establish evidence
  for the new issuance. Generic staff writes cannot claim `sent` or `viewed`,
  customer portal decisions are blocked during unresolved delivery, and owner
  draft SMS omits the inactive portal token. Copy Portal and portal links inside
  PDFs remain withheld without matching current-issuance delivery evidence.
  Admin expiry writes quote and portal lifecycle state atomically; the visible
  `Reopen` recovery returns an eligible expired quote to draft with a new portal
  issuance, while accepted, declined, and booked portal identities remain
  terminal. A quote expiring during unresolved delivery remains visible for
  provider review, and one failed legacy expiry projection no longer prevents
  the rest of Quote History from loading.
  The configuration check does not prove sender-domain verification or inbox
  delivery. Focused source/unit/rules coverage and a
  provider-disabled emulator failure path are local evidence; successful
  provider acceptance, atomic hosted completion, inbox delivery, and bounce
  handling remain unproved until provider/hosted acceptance is captured.
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
  denied, generic staff status writes cannot create `sent` or `viewed` evidence
  or rewrite an existing provider/customer lifecycle, and sales schedule writes
  are limited to non-evidentiary staff/checklist fields.
- Current branch provider authorization hardening: outbound quote email, owner
  SMS, payment requests, checkout creation, provider status, and provider tests
  require the current authoritative admin role. Disabled providers reject and
  omit retained credentials. Browser CRM networking is disabled; admins can
  record organization-scoped integration audit events without an outbound send.
- Workflow authority boundaries: approval resolution authorizes but does not
  itself execute a sensitive action; the matching Quote History operation must
  consume that exact approval. Customer acceptance does not prove payment or
  booking, and production checklist completion does not prove inventory
  availability.
- Current source-candidate approval authority: Firebase-backed approval request
  creation and admin resolution use same-tenant callable transactions with
  server-owned actor identity/timestamps and duplicate/replay rejection.
  Payment-request email, contract conversion, portal-link rotation, and
  permanent deletion require the exact approved request, persist server-owned
  execution outcome fields, and write a durable org-scoped execution audit.
  Contract conversion is server-planned, and completed atomic actions replay
  idempotently; failed provider execution requires a new approval. Direct
  Firestore approval-array, contract-evidence, and execution-audit writes are
  denied after the rules rollout. Only approval request creation and resolution
  may use the existing rule-authorized path after a confirmed missing-callable
  response during the Vercel-first deployment window; the four governed action
  executions never fall back, and every other callable error fails closed.
  Pure planning, client delegation, rules denial,
  and the full provisioning emulator matrix pass. This boundary is not
  production behavior until the matching Functions and Firestore rules are
  deployed together.
- CI gates: all eight verifier-required jobs are configured (`Classify Changes
  + Lane Plan`, `lane:quick`, `lane:core`, `Docker Build Smoke`,
  `lane:playwright-smoke`, `lane:firebase-auth-rules`,
  `lane:authoritative-pricing`, `lane:cwv-smoke`).
- Legacy bulk deletion is retired: the old organization-wide quote purge
  callable now fails closed, and its browser client and operator control are
  removed. Within a retained organization, permanent quote deletion remains
  one quote at a time through the exact approved `delete_quote` execution and
  durable org-scoped audit. Separately governed archived-workspace teardown
  still uses a platform-admin confirmation and deletion tombstone.
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
- Portal token and delivery-evidence hardening is implemented in the current
  source candidate: portal reads and customer decisions require a non-deleted,
  non-expired snapshot whose delivery evidence matches provider acceptance for
  the quote's current portal issuance. The Firestore emulator suite passes
  38/38, including fail-closed legacy/no-evidence coverage; the rules are not
  yet production behavior.
- A prior portal expiry-ms backfill was executed for production org `250`
  (`customerPortalQuotes patched=2`). That historical expiry field is not
  delivery evidence. Legacy projections without the new evidence fail closed
  under the current candidate and require an approved resend or truthful
  reconciliation; no backfill may fabricate acceptance.
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
  the schema-v2 set of all and only checklist ids applicable to the selected
  preparation target,
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
- Latest Vercel production operation: merged `main` deployment
  `dpl_9K7pqmZjqAMBbegKq3uyUf6rGVXv`, built from
  `dc460e3dca79c0b0eea512bb1902ba20a4b7c67c`, including the canonical SPA
  rewrite and returning `200` for direct `/app` and `/system` requests.
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
  Schema-v2 target applicability prevents one profile from claiming unrelated
  checklist items, but it does not bind the tested provider surface or any
  dependency; `firebase-all` still lacks a provider-derived compound receipt
  tying Hosting, Functions, and Firestore rules to one SHA.
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
- Provisioning hardening remains production-incomplete. The frontend source is
  live on Vercel, but do not treat the in-app preflight, verified-owner
  activation, entitlement-only update path, catalog conflict checks, trusted
  quote creation, CLI safety changes, or onboarding checklist as production
  behavior until the reviewed Functions/rules slice is deployed and exercised
  with a disposable second organization.
- Resend custom-domain sending remains blocked because the account's one included domain slot is occupied by `leaguepilot.us`; adding `quotepilot.mbmapps.com` requires an account upgrade or explicit authorization to remove/migrate the existing domain, followed by authoritative DNS verification. The production custom-domain sender remains disabled. An external, manual Resend dashboard sandbox message from `QuotePilot by MBMapps <onboarding@resend.dev>` was provider-accepted and recorded as delivered (`34deea9f-8a1c-47ce-8f4e-2ea5164a2eec`), but that address is not an allowed QuotePilot Functions configuration and the result is not custom-domain or recipient-inbox proof.
- Import Studio frontend code is live on Vercel, but its `importBatches`
  Firestore rules are not deployed or hosted-smoke-verified. Excel intake,
  merge/update policies, saved import history UI, and active
  quote/payment/contract/booking imports are intentionally not included in this
  first slice.
- The customer decision frontend is live on Vercel, but the new
  `portalDecision` Firestore rule changes and enriched portal snapshots are not
  deployed or hosted-smoke-verified.
- Approval request creation, admin resolution, and action-specific execution
  linkage are server-authoritative in the current source candidate, but the
  matching Functions/rules deployment and hosted acceptance remain pending.
- Workflow Attention and its change-request handling rules are locally covered
  only. Until this branch is reviewed, merged, and the matching Firestore rules
  are deployed, do not represent the header count or internal handling records as
  hosted production behavior. Automated customer/staff notifications and
  escalation delivery remain unimplemented.
- Existing portal snapshots still need a reviewed production dry run and apply
  before their customer-safe event, selection, and pricing projection is
  complete. Projection backfill is not delivery authority: legacy links without
  matching `deliveryEvidence` remain inactive and must be recovered through an
  approved resend or truthful provider reconciliation. The dry-run-first,
  tenant-scoped projection tool is implemented and locally validated; it never
  creates delivery evidence, is not packaged or attested by a deployment-target
  checklist, and requires separate explicit authorization before production
  apply. No production portal record was changed by that validation.
- Firestore production hardening is in active P0 execution; fallback retirement, denial evidence, migration execution, and portal hardening implementation are complete, but production rollout of updated portal rules is not complete yet.
- Bundle size remains a watch item; budget/CWV gates now prevent uncontrolled regressions.
- The quote builder now has a locally accepted mobile pricing path: after the
  user enters the wizard, Total and Deposit remain in view throughout steps
  1–5 at tested 320px, 390px, and 768px widths; the active step recenters after
  navigation and resize; and the one full breakdown opens as a focus-contained
  sheet with background isolation, Close/Escape recovery, and one concise live
  announcement. The 320px Save action remains unobstructed. Hosted mobile
  acceptance is pending publication.
- Authenticated workspace modal chunks now load on first use instead of during
  initial `/app` startup; local request-level browser coverage verifies the
  boundary, while hosted transfer/CWV evidence remains pending publication.
- Functions integrations (Stripe, Twilio, and Resend) remain optional and require secure runtime configuration plus provider-level acceptance/delivery proof; committed placeholder templates are not provider configuration.
- CRM outbound synchronization is intentionally disabled until a
  server-authorized connector with provider acceptance evidence is implemented.
- Staging sign-off routine must be re-established to keep `main` release-only under higher delivery velocity.

## Current Focus (Near-Term)
1. Publish and remotely qualify the locally validated combined sell-readiness
   candidate on one exact branch head; every new push requires fresh exact-head
   evidence.
2. Configure the six non-secret Preview-scope `VITE_FIREBASE_*` variables and
   complete hosted release-candidate acceptance on that exact head.
3. Configure protected no-bypass GitHub environments and independent direct
   reviewers, disable provider-side bypasses, implement the separately owned
   trusted deployer plus provider-specific staging/LKG receipts, and complete a
   non-production rehearsal before any promotion.
4. After those controls are qualified, promote the exact reviewed
   rules/Functions/frontend artifacts and run the hosted owner/quote/portal
   tenant acceptance checklist, including current/invalid issuance, active,
   expired, deleted, approval execution, contract, and change-request paths.
5. Verify the intended Resend sender domain in the Resend dashboard and
   authoritative DNS; only then configure
   `onboarding@quotepilot.mbmapps.com` and capture accepted, delivered, and
   recipient proof from one controlled test.
6. Run and review the scoped production portal-projection dry run, resolve any
   conflicts, then explicitly authorize guarded apply and retain count-only
   evidence.
7. Improve large-chunk performance while staying inside bundle/CWV guardrails.

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
