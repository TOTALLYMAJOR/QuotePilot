# Project Status

Last updated: August 4, 2026

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
- Candidate validation: draft PR #23 publishes the combined sell-readiness
  candidate. Exact head `d97258870b4e5a44070cbea0be781f2133b0a7cb`
  passed all eight source CI jobs in run `30884396855`; Vercel Preview
  `dpl_A53KRxvmA6WUNeakQuDLZuAsbmZk` failed
  before build because all six required `VITE_FIREBASE_*` values are scoped
  only to the older `fix/quote-history-role-permissions` branch. The local
  quick/core gates pass: 721 unit tests pass with 41 intentional skips, the
  production build, documentation governance, bundle budget, secret scan,
  environment check, and checksum-pinned workflow lint pass, along with 327
  focused release/deletion regressions and all four target-specific UAT item
  sets. Product/runtime changes also passed isolated Firestore rules (40/40),
  default Playwright (31 pass, 2 intentional skips), Firebase Auth and
  authoritative-pricing browser lanes, the provisioning acceptance matrix,
  Docker production-image build, Lighthouse, and both production dependency
  audits. Every subsequent PR head requires fresh exact-head CI; local/source
  results are not hosted tenant or provider acceptance.
  All local/emulator results remain distinct from hosted tenant and provider
  acceptance.
  The final-balance source work is on
  `feature/server-authoritative-final-balance`, based on that candidate; neither
  branch is merged to `main`.
- Functions runtime readiness: Functions now target Node.js 22 and use Firebase
  Admin 14 modular app, Auth, and Firestore APIs. The local authoritative and
  provisioning matrices pass with that runtime candidate.
- Current branch account recovery: the staff sign-in screen now lets
  email/password users request a Firebase password-reset message. The helper
  normalizes the entered email, supplies a validated HTTPS `/app` return
  URL, returns the same on-screen confirmation for unknown or disabled account
  errors, and preserves operational failures instead of claiming a message was
  sent. Seven focused unit tests and an isolated two-test
  Auth/Firestore/Functions browser run pass, including action-code creation,
  password replacement, QuotePilot return state, and sign-in with the new
  password. Exact-head CI must repeat the package lane, and emulator evidence
  remains distinct from hosted password-reset delivery. Production acceptance
  must separately verify the return domain is authorized and Firebase
  email-enumeration protection is enabled. Public registration may still
  return an existing-email error, so this feature is not claimed as full
  account-enumeration resistance.
- Current branch release UAT contract: checklist version `2026-08-04.10` now
  makes hosted password recovery and target-applicable deposit, final-balance,
  webhook/reconciliation, cross-rail isolation, projection privacy, and payment
  surface observations mandatory. It also binds public buyer onboarding to
  target-specific Turnstile entry, durable rate/idempotency controls, true
  Hosted Invoice Page creation, pinned buyer API/webhook version `2024-06-20`,
  signed invoice lifecycle, paid workspace preparation, pending invite,
  secret-keyed pre-read status throttling, proof-safe manual account setup at
  `workspaceReady=true`, optional onboarding-email provider acceptance,
  separate Firebase verification-email delivery and continue URL, no user role
  or access before verified claim, replay/cross-account denial, and quote-Stripe
  isolation observations. Browser targets own locked UI/instructions only;
  backend targets own provider and fulfillment evidence. The
  regression suite fixes those critical IDs to their intended target profiles
  so a mechanical checklist edit cannot silently remove them.
- Current branch provider-secret hardening: generic `RESEND_API_KEY`,
  `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` reads are now strict Firebase
  Secret Manager bindings on only the complete consuming Function call graph;
  the generic webhook statically verifies signatures and does not receive the
  Stripe API key. The Functions dotenv materializer rejects and does not emit
  those three values, while the ignored `functions/.secret.local` is reserved
  for expendable emulator fixtures. This is source evidence only. The known
  exposed or locally cached generic Resend/Stripe credentials remain a hard
  release blocker until fresh provider credentials complete the documented
  overlap/cutover, exact hosted UAT, old-key revocation, and provider readback.
- Current branch public invoice-first buyer candidate:
  `feature/paid-buyer-onboarding` adds `/start` on the existing `tonicatering`
  Firebase project behind independent browser and Functions gates. Preparation
  workflows compile the route and marketing CTA only with a syntactically valid
  non-placeholder public Turnstile site key; `check:env` cannot prove provider
  setup or human review. The server
  gate remains disabled by default and requires a Secret Manager Turnstile
  secret plus exact production hostnames. `createBuyerAccessInvoice` applies
  server-owned Turnstile, durable rate-limit, and idempotency controls, then
  fixes Starter to $1 USD using a dedicated Stripe test-mode client and returns
  only a true Stripe Hosted Invoice Page. The dedicated buyer client and
  endpoint are pinned to Stripe API version `2024-06-20` without changing the
  generic quote Stripe client or version. `buyerAccessStripeWebhook` accepts
  only signed, deduplicated `invoice.paid`, `invoice.payment_failed`,
  `invoice.voided`, and `invoice.marked_uncollectible` events. A paid invoice
  prepares the organization, neutral settings, Starter workspace plan
  entitlements, provisioning record, and pending invite, but creates no user
  membership, admin role, custom claims, or application access. The public
  status can advance to `activation_sent` only after durable onboarding-email
  provider acceptance. Independently, token-bound `provisioning` with
  `workspaceReady=true` now stops automatic `/start` polling and offers `/app`
  as a manual exact-invoice-email registration/sign-in and Firebase verification
  path. That handoff does not claim Resend acceptance or delivery, membership,
  claims, or access; the optional onboarding message is not required to start
  verified-email activation. An exact matching Firebase account must separately
  verify the invoice email and consume the invite, and only `active` is
  access-ready.
  `getBuyerAccessInvoiceStatus` remains a public capability-token callable, but
  each public request now consumes an atomic secret-keyed per-network lease
  before its first buyer-order read; later fulfillment reads remain within that
  bounded request. The 60-request-per-five-minute status budget also charges
  well-formed unknown-order and wrong-token requests and fails closed when the
  dedicated rate secret or Firestore limiter is unavailable. Creation
  now atomically reserves a request-scoped `(email, requestId)` order before any
  Auth, invite, or order read. Exact retry consumes IP capacity again without a
  duplicate email charge during the 24-hour reservation; reservation and rate
  records carry a Firestore Timestamp `expiresAt`. After the one-email-per-
  24-hour window, a fresh request can replace only a prior provider-verified
  void order,
  which is durably marked superseded so stale events cannot fulfill it. Open
  and payment-failed orders return the same invoice only to the exact original
  creation request. Uncollectible/expired, paid, and activation orders cannot
  be replaced automatically. The source candidate now includes a platform-
  admin-only Buyer Invoice Recovery surface and callable. It accepts only an
  exact order-bound confirmation, derives provider identity server-side,
  retrieves the terminal unpaid test Invoice from Stripe, permanently voids an
  uncollectible Invoice, rechecks the absence of fulfillment artifacts in the
  commit transaction, and records a private operator audit before replacement
  eligibility. Paid, open, partially paid, fulfilled, superseded, and
  mismatched targets fail closed. This closes the source recovery gap but
  remains unproved in hosted Stripe test mode. Creation and status record
  identifiers are HMAC-derived without raw network or email identity.
  The Functions gate must still stay off until the fourth Secret Manager binding,
  the `buyerAccessRateLimits.expiresAt` TTL policy, coordinated deployment, and
  hosted valid/invalid polling acceptance are provider-proven; optional edge or
  App Check controls remain defense in depth rather than source evidence.
  The existing live quote-payment mode, credentials, `stripeWebhook`,
  deposit, and final-balance rails remain separate. Controlled test-mode
  markers require exclusion from live revenue and paid-customer reporting.
  Focused source, unit, rules, browser, and emulator evidence remains local.
  The branch has not been merged, tagged, deployed, hosted-accepted,
  Stripe-provider-accepted, or approved for live-mode sale.
- Current branch Stripe payment lifecycle: an exact approved deposit scope now
  binds the quote revision, current portal issuance, customer email, currency,
  and amount before one resumable server operation prepares/restores the
  Checkout Session and sends the payment-request email. A newly prepared
  Session is registered on the quote without a link; its URL remains in a
  server-only application record and is not published to the quote or portal
  until email-provider acceptance is durably recorded, after which publication
  completes atomically.
  Ambiguous checkout or email outcomes retain the exact in-progress approval
  and executing-admin identity and reuse its Stripe/provider keys. Durable
  acceptance makes a later retry publication-only; a definite failure advances
  to a new approval only after any unsent checkout is neutralized, while
  unresolved cleanup remains resumable. Direct standalone checkout creation is
  disabled. Runtime
  `STRIPE_MODE` is required as `test` or `live` and must match the secret-key
  prefix plus Stripe event/Session `livemode`; signed
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, and `checkout.session.expired`
  events own monotonic payment transitions. Same-tenant admins can reconcile
  the server-recorded Session when webhook delivery needs review, while client
  payment-evidence writes fail closed.
  The final-balance branch adds a separate exact approval and payment rail for
  booked contracts after a verified provider-paid deposit. QuotePilot derives
  the remaining amount from the authoritative total and deposit, binds that
  amount plus the contract and deposit evidence into the approval, and records
  final-balance operations in a versioned ledger and a distinct
  `payment.finalBalance` projection. The same private-before-email-acceptance,
  resumable dispatch, signed-webhook, monotonic transition, and admin provider
  reconciliation boundaries apply without allowing a final-balance event to
  rewrite deposit truth. The customer portal receives only customer-safe final
  balance status, amount, confirmation, and an accepted published link; Stripe
  Session identifiers remain private. Late provider settlement may promote a
  failed or expired balance to paid, while an accepted email whose Checkout
  expires during interrupted publication closes its approval and permits a
  fresh request instead of remaining in progress. If the portal expires while
  email dispatch is still `sending` or ambiguous, recovery keeps the provider
  outcome unknown, waits through a 15-minute stale-attempt boundary before
  touching Stripe, resolves the exact Checkout without downgrading paid or
  refunded truth, and closes the stale approval for reconciliation rather than
  resending. Missing or mismatched expired portal projection is flagged and
  skipped instead of blocking quote/ledger closure. This is source/local
  evidence only and is not deployed, hosted-accepted, or
  Stripe-provider-accepted behavior.
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
  `lane:authoritative-pricing`, `lane:cwv-smoke`). The required quick lane now
  downloads the exact actionlint v1.7.12 platform archive, verifies its tracked
  official SHA-256, and checks all workflows before dependency installation.
  CI Quality grants only `contents: read` and none of its eight checkout steps
  persist the GitHub token while repository-controlled checks execute.
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
- Draft PR #23 converges the product-hardening and release-preparation work
  previously split across draft PRs #21 and #22. Its first exact head earned
  green eight-job GitHub CI, but its Vercel Preview failed at
  `npm run check:env`: all six required `VITE_FIREBASE_*` values exist only as
  branch-scoped Preview variables for `fix/quote-history-role-permissions`, so
  none apply to the release branch. No hosted release-candidate acceptance
  exists until those non-secret values are intentionally scoped to PR #23 and
  the resulting exact deployment is reverified; source CI is not hosted proof.
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
- Stripe production readiness remains open until the exact reviewed frontend,
  Functions, and Firestore rules are promoted together; the trusted runtime is
  configured with an explicit matching mode/key pair and all four webhook
  subscriptions; and isolated hosted test-mode plus separately authorized
  live-mode acceptance are recorded. Acceptance must include browser-inaccessible
  prepared state, same-key recovery from ambiguous creation/email outcomes,
  publication-only recovery after durable provider acceptance, and safe
  definite-failure cleanup for both deposit and final-balance rails, plus proof
  that events cannot cross those rails; a happy-path email alone is
  insufficient. The final-balance automation is currently source-only on a
  feature branch based on the sell-readiness candidate, not `main`. Refund
  initiation/status and dispute handling remain manual or unimplemented.
- The public `$1` invoice-first path is still a Stripe test-mode source
  candidate, not a live sales launch. Its public initiation surface raises
  abuse, duplicate-invoice, provider-delivery, and identity-claim risk, so the
  independently disabled server gate, exact Turnstile host/action checks,
  secret-keyed durable rate limits before status order reads, deterministic
  idempotency, four separate buyer Secret Manager bindings, Firestore rate TTL,
  signed invoice events, pending-invite boundary, proof-safe manual verified-
  email handoff when the workspace is ready, exact-email claim, and hosted
  negative-path
  evidence are release requirements. No hosted invoice, payment, webhook,
  workspace preparation, optional onboarding-email acceptance, Firebase verification-
  email delivery, verified claim, role readback, or proof that the live quote
  Stripe rail stayed unchanged exists yet. The platform-admin terminal Invoice
  repair is also source-only: hosted UAT has not proved exact provider void,
  private audit persistence, fulfillment-artifact denial, or the subsequent
  post-window replacement. Refund,
  dispute, cancellation, account/access revocation, support, tax/accounting,
  and any live-mode launch remain separate operating gates.
- CRM outbound synchronization is intentionally disabled until a
  server-authorized connector with provider acceptance evidence is implemented.
- Staging sign-off routine must be re-established to keep `main` release-only under higher delivery velocity.

## Current Focus (Near-Term)
1. Finish and review the single-project invoice-first buyer candidate, keeping
   the server gate disabled until Turnstile, durable rate/idempotency controls,
   all four dedicated buyer secrets, the rate-record TTL policy, and
   target-scoped UAT are approved. Route the
   four supported buyer invoice events only to `buyerAccessStripeWebhook`, keep
   the existing live quote Stripe configuration and `stripeWebhook` unchanged,
   and treat the compiled public CTA as artifact configuration rather than
   backend release authority.
2. Keep draft PR #23 source-green on its exact head and intentionally scope the
   six non-secret Vercel Preview Firebase variables to its release branch, then
   complete hosted release-candidate acceptance on that exact deployment.
3. Configure protected no-bypass GitHub environments and independent direct
   reviewers, disable provider-side bypasses, implement the separately owned
   trusted deployer plus provider-specific staging/LKG receipts, and complete a
   non-production rehearsal before any promotion.
4. After those controls are qualified, promote the exact reviewed
   rules/Functions/frontend artifacts and run the hosted owner/quote/portal
   tenant acceptance checklist, including current/invalid issuance, active,
   expired, deleted, approval execution, contract, and change-request paths.
5. Run invoice-first buyer onboarding through the same reviewed main, semantic
   tag, exact-main CI, target-specific UAT, prepare-artifact, and trusted-deployer
   path. Verify fresh Turnstile and abuse-control paths, one idempotent true $1
   Hosted Invoice Page, signed invoice transitions, paid workspace preparation,
   pending invite with no user role/access, proof-safe manual `/app` handoff at
   `workspaceReady=true`, optional onboarding-email provider acceptance before
   `activation_sent`, separate Firebase verification-email delivery and
   continue URL, successful exact-email verified claim, cross-
   account/replay/failure denial, controlled test-data classification, and
   quote-Stripe isolation. Disable the server gate after the bounded acceptance window; a
   live-mode launch requires separate approval.
6. As part of the coordinated quote-payment rollout, configure the matching Stripe mode/key
   and all four Checkout Session webhook events, then capture separate hosted
   test-mode approval/send/webhook/reconciliation evidence for deposit and
   final-balance collection before separately authorized live-mode acceptance.
   Prove that payment-kind metadata and stored Session scope prevent cross-rail
   updates. Do not infer any provider result from local emulator coverage.
7. Verify the intended Resend sender domain in the Resend dashboard and
   authoritative DNS; only then configure
   `onboarding@quotepilot.mbmapps.com` and capture accepted, delivered, and
   recipient proof from one controlled test.
8. Run and review the scoped production portal-projection dry run, resolve any
   conflicts, then explicitly authorize guarded apply and retain count-only
   evidence.
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
