# Project Status

Last updated: 2026-09-01 12:34:23 CDT

## Current Production Release

- Annotated tag `v0.15.0` resolves to
  `bc495c8c948d440b12363d5da34209a11ff151fd`.
- Exact-main CI Quality run `32817744859` passed all eight required jobs,
  including authoritative pricing, Firebase rules/emulators, Playwright,
  performance, bundle, governance, and Docker gates.
- Governed Vercel run `32819363438` deployed exact `v0.15.0` with
  `f2f08629a784d0ff6c8af9af8139d3746d77085f` as its explicit rollback target.
- Governed Firebase all-scope run `32818605404` deployed exact `v0.15.0` with
  `87e97c113070424c6d522399116f19877a67721a` as its explicit Firebase rollback
  target. The run verified the `pingram` / `pingram-2026-08-14-a` deployment
  profile, completed the Hosting, Firestore, and default Functions mutation,
  and passed the Firebase Hosting origin probe.
- The application artifact at `v0.15.0` is the current production runtime. A
  later receipt-only documentation commit may place repository `main` ahead of
  that SHA without changing runtime code or requiring another application
  deployment.
- These deployment receipts prove exact source, CI, and provider workflow
  success only. Tenant activation has its own receipt below; neither class of
  receipt proves authenticated staff/portal acceptance,
  production-data correctness, provider delivery, recipient acknowledgement,
  or human acceptance.

## v0.16 Calm Four Candidate Integration

- Release head `fc1352bf6356b30dc4aaf8f4708ce3f0135d01ef` passed all nine
  jobs in exact-head CI run `33467223260`, but the required local click-through
  correctly stopped promotion after finding five Business Setup acceptance
  defects: the wrong Offerings destination, a lost device-only menu buffer,
  false saved labels, low-contrast mobile draft controls, and duplicate main
  landmarks for sales. The bounded repair now has focused unit coverage and an
  eight-scenario Ambient Library browser pass at 390, 768, and 1440 pixels,
  including price-and-section rehydration and sales read-only access. The full
  local release, Firebase auth/rules, authoritative-pricing, environment,
  build, bundle, Truth Loop, governance, and 4,254-test unit gates now pass.
  Local repair checkpoint `f5d0c24` records that evidence. A new exact-head CI
  run remains pending; current production remains `v0.15.0`.

- The approved whole-application Calm Four source change is integrated onto the
  `integration/v016-calm-four` source line and has completed its Phase 1 local
  functional gate:
  **Now**, **Opportunities**,
  **Clients**, and role-safe **Library** are the only persistent primary
  destinations; **New quote** remains an action; Search, Operations,
  workspace/account controls, and sign-out remain secondary. The exact
  `/app/quotes/:quoteId` route resolves to the approved Opportunity workspace
  when the v0.16 Ambient profile is enabled and gains the contextual Quick
  Updates drawer/sheet with a local draft, universal dismissal guard,
  server-derived material-effects review, and single-flight
  revision/catalog/policy-fenced save for Firebase-backed draft quotes.
  Browser-local, sent, and viewed records hand off to the full editor; success
  requires the exact write receipt followed by authoritative quote and
  opportunity-list rereads. The connected Quote Workspace remains on its two
  compatibility aliases and as the Ambient-off rollback presentation.
- The integrated Phase 1 candidate passed the ten-scenario browser gate
  **10/10**, the responsive/accessibility cohort **26/26** at 390, 768, and
  1440 pixels, the full unit suite with **4,194 passed and 78 intentionally
  skipped** across **369 passed and 3 skipped files**, all **76** Firestore
  rules tests, all **127** Truth Loop tests, both selected build graphs, and
  the local release/governance checks. Side-by-side visual QA recorded no
  actionable P0, P1, or P2 finding.
- Phase 2A deployed candidate
  `49c51b42fd595f75295ef9b6848778ce0f6e619e` to the isolated Firebase staging
  path and immutable Vercel Preview, then completed the hosted automated
  qualification boundary. Final operator acceptance subsequently rejected that
  candidate after a sales follow-up save and an administrator integration
  activity record both received Firestore `PERMISSION_DENIED`; production
  authorization therefore remains closed.
- Candidate `4f6b9bbe01d71fd2ea231460d9ece0de910f3836` was deployed to isolated
  Firebase staging after exact-SHA CI passed. Hosted sales follow-up now passes
  and survives an independent reread. The same candidate also persists the
  administrator integration version and audit record, but then reports a false
  failure because that internal-only event unnecessarily invokes the
  customer-portal snapshot mirror, which correctly denies the unrelated write.
  The next bounded replacement removes only that mirror call; a focused
  regression, full local qualification, a new immutable candidate, staging
  deployment, and hosted readback remain required. No production,
  provider-outcome, or founder-acceptance claim is made.

## Commercial Truth Loop (Python Tier + Evidence Exporter + Firestore Reader)

- The chain is complete in source: `authoritative Firestore -> reader ->
  exporter -> canonical bundle -> reconciler -> verdict + reason`. The reader
  (`evidence/src/firestoreReader.mjs`) landed with 19 always-on unit tests and
  a disposable `demo-*` emulator lane
  (`npm run test:truthloop-export:emulator`) that exercises the whole chain
  against a real Firestore.
- **It has never run against production data.** The emulator lane is local
  evidence only: not hosted verification, not provider evidence, not a
  production data path, and not human acceptance. Running it against a real
  tenant is a separate, separately authorized step.
- **No record can reach `fullyReconciled` yet**, and the coverage report says
  so: 8 of 11 rules can reach a verdict. Three sections still have no producer
  — processor payout settlement (`integration`, blocked behind the Connect
  stopping point), declared processor fee schedules (`business_policy`, the
  settings field does not exist), and post-event consumption (`engineering`,
  no capture surface). Generate the current split with the explicit source and
  evaluation instant required by the read-only contract, for example
  `npm run truthloop:coverage -- --source <sources.json> --evaluated-at <ISO>`;
  the bare command intentionally refuses to infer either input.
- Containment is explicit-scope, not rule-enforced. The reader runs on the
  Admin SDK, which bypasses Firestore rules, so its guarantees come from a
  required organization argument, reads rooted at that organization, the
  absence of any `collectionGroup` query, an abort on any cross-tenant
  document, and a field allowlist that withholds portal keys, buyer tokens,
  and provider secrets. Those properties are asserted by tests and by the
  emulator lane against a populated second tenant; they are not enforced by
  Firestore itself.
- Active risk: the loop's narratives read as authoritative. Findings carry
  `authority: "observation_only"` and must not be presented to a customer or
  used as a repricing, approval, or accounting authority. The kill criteria in
  `docs/COMMERCIAL_TRUTH_LOOP_ADR.md` are the disable trigger.
- Active risk: the payout producer remains one authorized settlement source
  away from emitting provider evidence. It refuses any source not explicitly
  marked authorized and production passes none, but that is a code guarantee
  until the Connect program proceeds.
- Known noise before a first real run: `margin_category_omission` will fire on
  every record carrying delivery/travel revenue. That is correct but
  undecided — see the travel/margin decision in `DEV_TASKS.md`.

## Production Completion and Pending Acceptance

### v0.16.0 bounded promotion in progress

- Repeated staging verification for `flightcontrol@quietpilot.us` reached
  Firebase's generic invalid-page-mode screen. Read-only Auth configuration
  inspection found the correct default callback and `%LINK%` template, and a
  disposable staging identity proved a newly generated five-parameter
  `verifyEmail` link works end to end through the reserved Firebase handler;
  that probe identity was then deleted. The candidate now contains a
  QuotePilot-owned `/app/auth/action` repair that validates the exact local
  project/mode/code-presence/continuation policy, strips the code from the
  visible URL, requires a deliberate click, sends the code only to Firebase's
  verify-email endpoint, and treats only a verified provider receipt as
  success. The focused auth and recovery suites pass locally. This is not yet hosted:
  a new exact-SHA candidate must pass release validation and deploy before the
  staging Auth callback is rebound and a fresh message is requested. The real
  account remains unverified and unbound to a tenant; no administrator override
  is permitted. Production Auth and Stripe Connect remain unchanged.
  Both CI-shaped production graphs build locally. Compatibility emits 3,213,133
  JavaScript bytes under its existing 3,213,578-byte ceiling. Ambient emits
  3,930,814 bytes after the isolated handler is included; the existing named
  temporary exception records that exact aggregate while its largest-chunk
  ceiling remains unchanged.

- The owner authorized remote publication and governed deployment pursuit for
  the current 74-commit candidate. Against `origin/main`, baseline
  `303eec5237d143fc11398e23f24e86fcb28c2655` changes 180 files with 12,313
  insertions and 1,030 deletions (net +11,283). The capability and holdback
  inventory is recorded in `docs/RELEASE_V0_16_PROMOTION_REPORT.md`.
- The current full release lane plus Core Web Vitals passes after the
  documentation gate correctly required timestamp reconciliation: 4,099 unit
  tests pass with 78 skipped, 127 Truth Loop tests pass, the 503-module build
  passes, all 76 Firestore rules tests pass, authoritative pricing, Firebase
  auth/rules browser coverage, owner-SMS emulator coverage, bundle budget, and
  Lighthouse/CWV pass.
- The six high-severity root development-tool findings are resolved without
  the breaking `@lhci/cli` downgrade proposed by `npm audit fix --force`.
  Because `@lhci/cli` 0.15.1 remains the latest release and pins vulnerable
  Lighthouse 12.6.1, the root lock now narrowly overrides its Lighthouse copy
  to 13.4.1. That selects Puppeteer 25.9.0, removes `extract-zip`, passes the
  unchanged real CWV gate, and leaves `npm audit` at zero findings. The major
  tool-compatibility boundary is recorded in `docs/TECH_EXCEPTIONS.md` and
  still requires exact remote CI before release use.
- GitHub Dependabot alert #139 remains open against default-branch
  `package-lock.json` for development-only `extract-zip` path traversal. The
  release candidate no longer contains `extract-zip`, its root audit is clean,
  and exact remote CWV passes. Narrow backport PR #112 at exact
  `204f0d2eefd72a8f2d41a6fbb4e7ec6728bd454c` is open and mergeable; CI Quality
  run `33246642372` passes all eight jobs and Stripe source-only runs
  `33246642371`/`33246642373` pass. The alert remains operationally open until
  the reviewed backport or release reaches `main`.
- The Firebase production workflow source now uses a commit-pinned Google
  authentication action and accepts only GitHub workload-identity ADC for the
  fixed `tonicatering` project; its deploy command rejects `FIREBASE_TOKEN`,
  static service-account JSON, missing credentials, and credentials outside the
  checkout. The protected tenant-gate workflow also uses WIF, but with a
  distinct service account and one short-lived Datastore-scoped token passed
  only to its exact read/patch/readback client. The production WIF provider,
  distinct deploy and tenant-operator service accounts, least-privilege
  bindings, and all three repository variables are now provisioned with no
  service-account key. First production workflow token exchange and governed
  production deployment remain unverified.
- Firebase production and staging-candidate mutation now execute only the
  official v15.24.0 Linux CLI artifact after verifying SHA-256
  `bf964987f095a5fb991cf1c709f640526a4e1b4f9eb1f271f5c09bc693263d33`.
  The production workflow downloads it before OIDC authentication and passes
  its verified path only to the deploy step. Candidate Web config, Functions,
  Hosting, and secret-metadata inspection now use that same verified path;
  Firestore Rules readback uses exact `google-auth-library` 10.5.0 ADC and the
  public Rules API. Vercel preview uses a locally built Build Output API v3
  artifact plus narrow REST upload/deploy/readback requests. No candidate path
  searches local/global/npm-cache Firebase modules or runtime-downloads a
  Vercel CLI. That lock has now produced a verified Firebase staging receipt;
  Vercel preview remains unverified.
- Release PR #111 publishes `release/v0.16.0`. Pre-reconciliation exact head
  `ed228c1e84218eabaa8b859378d84f5e2339c17b` passed all eight jobs in CI
  Quality run `33280654199`. Current `main` then added three verified staffing
  activation and receipt commits, making the PR conflicting; the release
  candidate is being reconciled with those exact commits and must obtain fresh
  exact-head CI before another candidate deployment.
- The governed `staging-staffing-authority` Firebase-all receipt for exact
  `17582da99ae9ace1ec6fb11fe224336faaf75410` is verified. It binds staging
  project `quotepilot-staging-20260804`, Hosting version
  `503080e914239d13`, 95 Functions, Firestore Rules hashes, the positive global
  staffing server and browser gates, and the safe-off unrelated authorities.
  It does not enable a tenant, prove authenticated staffing behavior, or count
  as Vercel, production, provider-delivery, or human-acceptance evidence.
- Earlier governed candidate deployment was attempted for both targets at exact
  `e620ce80`, rechecked at `98f5395`, and rechecked again at latest exact-CI
  head `8b04582`. Every attempt stopped before provider mutation or receipt
  reservation.
  Those attempts found that Firebase staging lacked enabled versions for all eleven candidate-required
  secret names: `BUYER_ACCESS_RATE_LIMIT_SECRET`,
  `BUYER_ACCESS_STRIPE_SECRET_KEY`, `BUYER_ACCESS_STRIPE_WEBHOOK_SECRET`,
  `BUYER_ACCESS_TURNSTILE_SECRET`, `RESEND_API_KEY`,
  `RESEND_WEBHOOK_SECRET`, `REVENUE_AUTOPILOT_TOKEN_SECRET`,
  `STAFF_INVITATION_TOKEN_SECRET`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, and `TWILIO_AUTH_TOKEN`. The candidate tool will not
  create or read their values. Vercel preview then stopped because the current
  staging `acceptQuoteProposal` Functions readback does not prove
  `COMMERCIAL_CHANGE_AUTHORITY_ENABLED=false`. The required order is: authorize
  and create the required non-provider staging placeholders through the secret
  process, deploy Firebase with one explicit tracked candidate profile, verify
  the matching Functions readback, then deploy Vercel preview with that same
  profile.
- The bounded release-tooling correction makes the candidate command use
  `GITHUB_TOKEN`, then `GH_TOKEN`, then the authenticated local GitHub CLI for
  CI verification. A live exact-SHA run with both token environment variables
  explicitly unset verified CI through the CLI and reached the real missing
  staging-secret prerequisite. It stopped before receipt reservation or
  provider mutation and changed no deployment authority, secret handling,
  provider target, or promotion gate. The later verified Firebase-all receipt
  above proves that the staging metadata and deployment prerequisites were
  subsequently satisfied without exposing secret values.
- The tracked `staging-safe-off` UAT plan still has 17 applicable and 21
  blocked items for Firebase-all, and 11 applicable and 7 blocked items for
  Vercel preview. Applicable hosted results and named human review remain
  separate evidence classes; current production remains exact `v0.15.0`.
- The `staging-staffing-authority` profile remains separate from
  `staging-safe-off`. Its verified receipt proves the selected profile and
  global staging gates; the exact-tenant gate and positive authenticated
  journey remain separate operations and evidence classes.
- The current `firebase-all` `staging-staffing-authority` UAT plan is blocked:
  18 items are applicable and 20 mandatory release-wide items remain blocked.
  The blocked set covers provider-secret cutover, buyer, portal/delivery,
  contract, payment, disabled-staffing rollback, and provider-backed SMS
  evidence. Founder approval authorizes execution but is not evidence that
  those hosted/provider checks passed, so PR #111 cannot yet be merged under
  the canonical production-triggering release policy.
- Production keyless identity configuration is now provisioned. The WIF
  provider is restricted to the private repository's numeric owner/repository
  ids, protected `main`, manual dispatch, and the two exact workflow refs. The
  deploy and tenant workflows use separate service accounts; the tenant custom
  role has only Firestore entity read/update permissions, and no key exists.
  The three required GitHub variables are present. First token exchange and
  governed deployment remain unverified.
- The owner selected existing organization `mm05366-sandbox` as the bounded
  founder-pilot tenant instead of creating tenant `250`. Protected run
  `33282940451` verified its `operationalStaffingAuthorityEnabled` transition
  from false to true against the exact tagged v0.15 Firebase-all deployment.
  Tenant `250` remains absent. One person owns the designated email accounts,
  so they are role-test identities rather than independent staff or reviewers.
  Hosted use, role-path behavior, accessibility, rollback rehearsal, and
  founder acceptance remain separate evidence.
- Stripe Connect remains deploy-empty/provider-disabled; Steward remains
  providerless with model output hidden; buyer access, Commercial Change,
  Revenue Autopilot, and authoritative staffing remain fail-closed. Candidate
  deployment may inspect their safe unavailable/presentation states but cannot
  activate them or convert their external gates into production qualification.

- Product Truth Observability is implemented as a read-only source/local
  repository/CI candidate. The branch now contains the governed `v0.15.0`
  receipts and is reconciled to current `origin/main`; an earlier digest's
  branch-divergence and v0.14/v0.15 contradiction are therefore historical
  findings, not current release truth. The compiler still preserves exact HEAD,
  keeps unavailable CI/hosted/provider/production/human/outcome proof
  `unknown`, and does not treat reachability as deployed identity. Exact CI
  observation, owner comprehension review, freshness calibration, and any
  promotion to a required gate remain pending human/external decisions.
- Steward has no remaining repository-preparable work before its reviewed
  private-runtime and human-evaluation gate. The deploy-dormant compiler,
  policy/validation controls, consent/evaluation contracts, pinned synthetic
  corpus, hidden-output workbench, disabled handoff, and manual recovery route
  pass 84 focused tests, the secret scan, and three responsive browser checks.
  A reviewed provider transport and credential, canonical context reads,
  private persistence, billing/privacy approval, consenting silent execution,
  100 actual human packet reviews, hosted rules evidence, deployment, and human
  acceptance remain external. Model output stays unavailable to users.
- Stripe Connect has no remaining repository-preparable foundation gap before
  its cloud/provider gate. The reviewed Accounts v2 model remains full Stripe
  Dashboard access, Stripe fee collection, Stripe negative-balance liability,
  and direct charges with no QuotePilot application fee. Foundation,
  infrastructure, and onboarding checks pass, and the read-only live staging
  preflight currently confirms the exact project, Web app, and protected
  `connect-control` database. Runtime exports stay empty and provider access
  stays disabled until a human reviews and authorizes the saved Terraform plan,
  reconciles applied identities, observes then promotes App Check, binds the
  restricted Sandbox credential, and accepts hosted negative/replay UAT.
- The optional bounded security-audit slice is repository-complete in the
  current source candidate. Operations Audit has an explicit two-action
  immutable taxonomy for final quote-approval executions and organization role
  changes, a bounded privacy-safe DTO, replay and foreign-tenant filtering,
  source-truncation state, and an explicit indefinite server-retention/no-clear
  policy. Delivery and catalog rows remain legacy observations; provider
  outcomes remain separate.
  Deployment, authenticated hosted admin/tenant denial checks, production-data
  review, and human acceptance remain open.
- The PWA safe recovery shell is repository-complete in the current source
  candidate. Its install manifest has stable identity and 192/512 maskable
  icons; the service worker owns only its namespaced shell cache, allowlists
  public build/brand assets, preserves unrelated caches, and serves an explicit
  reconnect page instead of cached authenticated routes. Six unit contracts,
  four responsive axe/browser checks, and a real minified-preview service-worker
  fallback pass locally. The hosted app still serves the prior scaffold;
  deployment, hosted installation/relaunch, and physical-device acceptance
  remain open.
- The tracked release-UAT contract now includes the stable
  `operator.authenticated-workspace-journey` item for Hosting, Firebase-all,
  and Vercel targets. It binds the required authenticated route/task matrix to
  the exact SHA, immutable deployment, target, organization, role, and evidence
  level. Repository validation does not complete the real staff session,
  hosted data checks, denied-role/cross-tenant observations, or human acceptance.
- Historical tenant-250 activation run `32425529671` failed closed because the
  settings document did not exist. The founder subsequently selected existing
  tenant `mm05366-sandbox`; protected run `33282940451` verified the bounded
  false-to-true update and readback. No tenant was created or migrated, and the
  successful activation does not establish hosted staffing usability.
- Production configuration names Resend as the email provider and binds the
  reviewed Pingram deployment profile. Configuration and deployment do not
  prove provider delivery, staff acknowledgement, attendance, payroll, tenant
  activation, or human acceptance.

## Engineering Checkpoint Detail

- The owner authorized exact-candidate publication and coordinated Firebase
  and Vercel production deployment for live testing after the required gates.
  Exact `v0.15.0` reached both production targets and the founder-pilot tenant
  activation now has the separate verified receipt recorded above. Provider
  acceptance, signed delivery evidence, recipient acknowledgement, and human
  acceptance remain separate post-deployment tests.
- The Stripe Connect program has begun with a source-only organization
  authority prerequisite. New owner invitations are explicit, verified
  activation atomically binds one owner and leaves an immutable browser-private
  receipt, and browser principals can no longer create or rewrite role
  authority. The disposable provisioning emulator passes this owner path. No
  Accounts v2 connected account, Stripe API call, hosted onboarding, charge,
  payout, refund, dispute, provider evidence, deployment, or human acceptance
  exists from this slice; the current deposit, final-balance, and buyer-access
  rails are unchanged.
- A second source-only checkpoint names Firebase `default` and `connect`
  Functions codebases, pins the existing Stripe package to `16.12.0` and the
  isolated Connect package to `22.5.0`, records the Connect API contract as
  `2026-07-29.dahlia`, and makes all existing production/candidate selectors
  address `functions:default` explicitly. The tracked staging manifest is
  Sandbox-only, unbound, provider-disabled, and rejects every infrastructure or
  callable claim; `functions-connect` exports nothing. This is local source and
  test evidence only, not a Connect deployment or provider result.
- A third source-only checkpoint adds an exact organization-owner backfill.
  Dry-run is the default; zero, multiple, incomplete, unverified, or conflicting
  consumed-invite candidates return `ownership_required`. Apply requires the
  dry-run owner UID and an exact project/organization/UID confirmation, then
  transactionally revalidates Firestore evidence before binding the organization,
  provisioning order, and immutable receipt. No production dry-run or apply has
  been performed.
- A current source-only catalog/proposal checkpoint extends the Quote Composer
  direction without adding customer commercial exposure: Catalog Admin owns a
  bounded proposal document font scale, logo/monogram readiness, guided-rule
  coverage, and cost/margin coverage summaries; trusted quote creation/edit
  snapshots persist the selected font scale; Proposal Composer applies the
  saved brand/font presentation, adds proposal-polish checks, and mirrors the
  fail-closed selected-line margin calculation as staff-only Quote Pulse
  context. PDF export uses the saved font scale and letterhead fallback.
  Costs and margin remain absent from customer preview/export/portal artifacts.
- The Ambient-enabled v0.16 source candidate makes the approved Opportunity
  workspace the ordinary exact-quote presentation at `/app/quotes/:quoteId`,
  including contextual Quick Updates. The connected dinner-table Quote
  Workspace remains available to authenticated admin/sales staff at
  `/app/quote-workspace` and `/app/quote-workspace-concept` as a compatibility
  presentation and becomes the ordinary exact-quote rollback when Ambient is
  off. It reads the exact tenant saved quote without substitution, consolidates
  persistent orientation to Now, Opportunities, Clients, and role-safe
  Library, presents bounded completeness and save-health evidence, and
  preserves trusted edit, message, Proposal, Payment, lifecycle, delivery, and
  recovery continuation. It performs no quote/provider mutation. Candidate
  deployment, authenticated staging review for the selected
  `mm05366-sandbox` organization, and owner acceptance remain unverified until
  the exact published SHA completes those gates.
- A ninth source-only checkpoint materially implements the QuotePilot Package
  Workspace on the existing `Library -> Packages` route without changing the
  package persistence contract or quote-pricing authority. Catalog Admin now
  presents a stable-ID package navigator, selected-package overview, recorded
  cost/contribution/margin evidence, deterministic health with one next action,
  current-inclusion-first composition groups, reviewed Apply/Cancel searchable
  inclusion selectors, readiness-gated activation, selected-package revert,
  dependency-aware confirmed delete, and one in-flow staged save bar on that
  tab. Mobile uses a compact package switcher, collapsible Health, and a full-
  viewport selector. Package pricing remains per person, inclusions remain optional
  and selected-at-$0 only when a staff user explicitly chooses them in Quote
  Builder, managed-menu mutations remain separate from the ordinary catalog
  save, and all changes still persist only through the existing catalog save
  path. This is source/local evidence only: no hosted admin-role acceptance,
  production deployment, or human acceptance is claimed.
- A fourth source-only checkpoint adds canonical owner/admin Team access
  authority. The same administrator operations surface now exposes an in-flow,
  exact-email role review with current role, consequence, do-nothing outcome,
  provenance, recent identity confirmation, replay-stable reconciliation, and
  a receipt. Owners alone may change admin authority; same-organization admins
  may manage sales access. The trusted Functions transaction revalidates the
  actor, target, organization, and expected role, writes a browser-private
  immutable receipt, then synchronizes custom claims. Disposable
  Auth/Functions/Firestore emulator acceptance passed promotion, sales grant,
  replay, owner-demotion denial, cross-authority denial, and claims sync. App
  Check remains in monitoring mode: no reCAPTCHA Enterprise provider/site key
  was registered or bound, no limited-use token was consumed in a hosted
  environment, and no deployment, production role mutation, or human
  acceptance is claimed.
- A fifth source-only checkpoint adds a pinned, staging-only Terraform
  foundation and credential-free validation workflow. It defines—but has not
  planned or created—the named `connect-control` database, exact-database IAM,
  five isolated service accounts, seven empty secret containers, private
  serverless network, fixed NAT egress address, protected state bootstrap, and
  exact-repository/owner/branch/environment GitHub OIDC admission. A separate
  Firebase config targets only Connect functions and deny-all named-database
  browser rules. App Check registration remains structurally available but
  forced off, and no production Terraform root exists. Local pinned-provider
  `fmt`, offline-backend `init`, and `validate` pass for bootstrap and staging;
  the isolated Firestore emulator also compiles the named-database deny rules.
  This is source/local evidence only: no cloud-authenticated plan, apply, GCP
  resource, App Check key, Stripe binding, deployment, hosted verification, or
  human acceptance exists.
- A sixth source-only checkpoint defines—but does not export—the strict
  Connect status/onboarding and one-use same-tab handoff contracts. Browser
  payloads cannot name an organization; verified admin claims supply tenant
  scope, cached status is redacted, limiter storage accepts only a separately
  HMAC-hashed principal digest, and owner onboarding requires exact
  revision/generation/digest evidence, recent authentication, and an unused App
  Check token. Provider access remains behind injected, unbound adapters. The
  internal POST handoff keeps its token out of the URL/referrer, stores only an
  HMAC token digest, consumes before Account Link creation, never returns the
  Stripe URL to application JavaScript, and
  records only bounded expiry/attempt evidence. `functions-connect` still
  exports nothing. Focused local tests and a credential-free source policy
  pass; no callable, HTTP handoff export, provider request, deployment, hosted
  result, or human acceptance exists.
- A seventh source-only checkpoint implements, but does not instantiate, an
  exact `connect-control` repository, transactional durable limiter, and
  injected Accounts v2 Sandbox adapter. The repository reserves one immutable
  connection generation and a bounded provider-recovery window before access,
  binds a platform/mode/account identity to only one organization and
  generation, quarantines collisions, preserves one-use handoffs, and stores
  redacted replay receipts. The limiter enforces fixed principal and
  organization windows in one transaction, stores neither raw UID nor
  organization ID, and denies access when state is unavailable. The adapter
  accepts only the approved US/USD merchant configuration with full Stripe
  Dashboard access, Stripe fee and negative-balance responsibility, direct-
  charge semantics, and Sandbox mode. Failure injection proves that a provider
  success followed by database interruption reuses the same idempotency key
  and converges on one binding and receipt. The staging manifest remains
  provider-disabled and unbound, and `functions-connect/index.js` still exports
  nothing. This is source/local evidence only: no applied database, credential,
  Stripe request, connected account, Account Link, callable/HTTP export,
  deployment, hosted result, or human acceptance exists.
- An eighth source-only checkpoint removes identity-token role staleness from
  the dormant Connect edge contract and separates provider credentials from
  edge authority. A trusted, receipt-bound authority projection contains only
  the current enabled, verified administrators and canonical owner, advances
  monotonically, and expires within ten minutes. Account creation and status
  refresh are frozen into immutable digest-bound commands; each command's
  `qpcmd_<digest>` value is the sole provider idempotency identity, while the
  repository reserves only generation, authority digest, and a 30-day recovery
  deadline. A separately composed worker uses bounded leases,
  revalidates authority/revision/generation/reservation or binding, and records
  one terminal, quarantine, or dead-letter receipt. The edge never calls the
  provider adapter. After account creation, the repository rechecks current
  owner authority before binding. Post-create validation failure, authority
  drift, or a binding conflict preserves the returned provider identity and
  occurrence privately as a quarantined claim without publishing a usable
  binding; an interrupted command receipt reconstructs that exact quarantine
  on retry without a second provider call. The owner POST handoff is replay-
  stable, permits one active ten-minute attempt, binds owner/authority/App Check
  application/revision/generation/request/payload evidence, and rechecks
  current authority and connection state both before and after Account Link
  creation. Post-provider authority/state drift records `provider_withheld`;
  expiry drift also withholds the URL. If receipt persistence fails, the URL
  remains withheld and the consumed attempt stays blocked until local expiry
  instead of claiming an uncommitted receipt. Every path returns only to
  explicit recovery. Exact rate policies are now 6 principal and
  6 organization refreshes per five minutes with a ten-second organization
  interval, 6 principal and 10 organization onboarding starts per day, and 3
  principal handoffs per 15 minutes plus 10 organization handoffs per day.
  Before provider access, the Sandbox adapter retrieves the exact platform
  account and confirms a test-mode balance; it validates the Accounts v2
  merchant application as an RFC 3339 timestamp and requires both card-payment
  and payout activity before `ready`. These modules remain deploy-dormant:
  `functions-connect/index.js` exports nothing, the staging manifest is unbound
  and provider-disabled, and no authority publisher, App Check enforcement or
  token consumption, cloud resource, credential, callable/HTTP route, Stripe
  request, connected account, Account Link, deployment, hosted result, or human
  acceptance exists.

### Historical v0.8.1 checkpoint

- At that checkpoint, `main` was tagged `v0.8.1` at
  `31b7f8040667d6ae6158b5d16c1b3556193dde16`; the tag enables the Ambient
  presentation in both production workflow build environments. The live
  deployment receipts below still identify `v0.7.0`, so this source state is
  not evidence that `v0.8.1` was deployed or accepted.
- The work after `v0.7.0` was the proposed `v0.8.1` source candidate. That
  source snapshot does not itself establish a published candidate head, release
  tag, exact-candidate CI run, governed deployment receipt, or production
  acceptance; each requires its separate Git, CI, provider, or human evidence.
- The fixed Firebase staging project now has enabled placeholder versions for
  the two previously absent Secret Manager bindings required to deploy the
  complete Functions graph. No value was recorded, no production secret was
  changed, and the associated webhook and Revenue Autopilot authority gates
  remain explicitly disabled.
- The tracked v3 UAT checklist now binds the fixed candidate to the
  `staging-safe-off` profile and classifies every target item as applicable or
  blocked with an explicit reason. For the current checklist, Firebase-all is
  14 applicable / 19 blocked, each browser-only target is 9 / 7, and the narrow
  Firebase backend target is 10 / 14. These counts are profile classification,
  not passed UAT. Positive buyer, delivery, payment, contract-conversion, and
  authoritative-staffing paths remain blocked by the fixed fail-closed gates;
  the all-positive exact-main attestation still requires every target item.
  No candidate deployment, hosted pass, attestation, production promotion, or
  human acceptance is implied.
- The ordinary Ambient-off production-flag build now selects a dedicated
  v0.7-compatible workspace graph at build time while Ambient candidates select
  the replacement graph. Local mode-specific `.env` flags and explicit release
  shell overrides resolve consistently. The compatibility boundary retains
  portal-token isolation, unsaved quote/Catalog recovery, and privacy-bounded
  analytics. A clean committed candidate initially exceeded its unchanged
  temporary ceiling by 5,600 bytes; eligible function-to-arrow minification now
  reduces total JavaScript by 21,682 bytes to 3,197,496 bytes and the largest
  chunk to 384,998 bytes. The full unit suite and a minified local-preview lazy-
  route smoke pass with zero page errors. The temporary exception remains
  active: standard-budget retirement still requires reviewed graph optimization
  or baseline policy, browser/CWV evidence, and both build profiles. This is
  local source/build qualification only; no hosted candidate or production
  runtime changed.
- The `v0.7.0` deployment receipts do not establish authenticated hosted-role
  behavior, production-data correctness, downstream provider acceptance,
  recipient evidence, or human acceptance.
- The current post-`v0.8.1` candidate contains the Ambient Intelligence build.
  **All 50 stable AIUI items are materially implemented in local source, while
  0 of 50 are formally closed.** This now
  includes the compatibility inventory/browser baseline; extracted workspace
  shell and saved-draft hydration seams; canonical Ambient signal and action
  kernels; unified client/server `ImpactPreview`; the Living Opportunity;
  intelligent guest, event-logistics, Package/Menu, staffing, pricing, and
  selection objects; integrated Money, Proposal, and Conversation objects;
  sensory semantics; accessibility proof; bounded Pilot command classes,
  deterministic explanations and exact Package changes, and bounded under-
  budget/improve-margin scenarios with an explicit draft review; client-
  observed product metrics; and dead-click/layout recovery. The final material
  additions include AIUI-16 (lightweight persistent orientation plus one
  context-resolving global Pilot trigger), AIUI-17 (the bounded Ambient NOW
  briefing), AIUI-18 (the editorial Opportunities stream and exact Living
  Opportunity handoff), AIUI-19 (the lighter Clients directory, relationship
  overview, and exact client handoff), AIUI-20 (the role-safe Library, first-
  class Event Templates, and exact guarded editor arrivals), AIUI-40 (exact Workflow, Approval,
  Messages, Schedule, and Reporting arrivals), and AIUI-41 (the in-flow mobile
  Living Opportunity remote), and AIUI-46 (the content-first customer decision
  room), AIUI-43 (hold-to-capture Ambient Pilot voice with deterministic
  preview-before-apply), and AIUI-50 (the protected zero-dead-click Alpha
  browser gate plus its fail-closed configuration policy); AIUI-04 (the
  Opportunities/Event Room/role-safe action controller seam); AIUI-12 (the
  shared purpose-bearing editorial surface grammar); AIUI-35 (separate
  acceptance, contract, payment, BEO, staffing, and closeout receipt domains);
  AIUI-42 (shared pointer-gesture resolution with visible and keyboard
  equivalents); and AIUI-48 (Ambient-graph route retirement plus fail-closed
  rollback-retirement readiness). Ambient NOW
  preserves the existing ranked Workflow order but shows at most three
  priorities, withholds caught-up language for incomplete evidence or recorded
  payment steps, and limits quiet progress to timestamp-backed internal
  workflow receipts. All 50 remain partial against their complete acceptance
  contracts.
  The quick Ambient release policy now also verifies that all 50 canonical
  work-item definitions remain present, the authenticated operator UAT item is
  browser-applicable under the fixed safe-off profile, and AIUI-48 cannot
  authorize legacy removal before parity, exact rollback, release acceptance,
  and explicit promotion approval all pass. This closes a repository policy
  gap only; no item is formally closed and no external gate is reported passed.
  The exact CI-equivalent production Ambient build passes locally with 3,714,204 total
  JavaScript bytes and a 391,901-byte largest chunk, inside the existing
  temporary ceiling without recalibration. Its selected graph excludes the
  replaced Command Center, redundant search palette, and legacy Clients table;
  those surfaces remain available through the compatibility build. The compatibility core lane passes
  3,570 unit tests with 74 intentional skips, and the production-equivalent
  Ambient browser proof passes the exact zero-dead-click contract plus all 80
  no-unintended-overlap cases across the supported widths and contained overlay
  states. This is local source, unit, build, and browser evidence only; no
  hosted candidate, production promotion, provider outcome, or human acceptance
  is established.
  The AIUI-18 stream is a presentation over the caller-owned, already tenant-
  scoped bounded quote read. It presents identity and four independent momentum
  domains, permits a percentage only for proposal completeness, and keeps quote
  lifecycle, booking confirmation, deposit, and final-balance evidence
  separate. Each row exposes one deterministic next action; opening an
  opportunity carries its exact opaque identity and focused arrival context to
  the canonical Living Opportunity. The complete legacy role-gated controls
  remain available under **Quote administration**, and browser-local fallback
  is labeled as local rather than server or provider confirmation. This adds no
  data, role, pricing, save, provider, or lifecycle authority.
  The AIUI-19 Clients presentation uses the caller-owned bounded directory and
  client relationship reads without adding a lookup, mutation, ranking claim,
  or new authority. The directory opens one exact opaque client identity. The
  relationship view leads with the client, active opportunities found in the
  completed read, recorded conversation context, and one supported next step;
  its exact arrival is resolved only after the matching client is loaded and
  focused. Mismatched or missing arrival context recovers without substituting
  another client. Existing history, rebook, communication, commercial, and
  role-gated controls remain available under **More client history and
  controls**, and local records remain labeled as browser-local rather than
  customer, provider, payment, booking, or delivery confirmation.
  The AIUI-20 Library is an administrator-only presentation over the existing
  organization-scoped catalog snapshot and save authority. It separates
  Catalog choices from first-class Event Templates, shows source, observation,
  **Catalog version**, and pricing-review boundaries, and chooses one
  deterministic next step. Incomplete event-specific menu inventory remains
  unavailable rather
  than being misreported as empty. Section and template actions acknowledge
  immediately, then open the exact existing guarded editor context; structured
  template changes preserve stable IDs and linked-item references and continue
  through the existing revision-conflict and save path. Catalog-setting and
  managed-menu dirty domains cannot advance together; one must be finished or
  explicitly discarded first. All seven managed-menu mutations require the
  loaded catalog revision and validate it inside the Firebase transaction or
  local commit before writing; local fallback compares the active
  organization's catalog revision. Unsaved editor work survives ordinary
  workspace navigation; unload, portal, and sign-out boundaries remain guarded;
  and fresher catalog evidence cannot silently replace a dirty draft. A portal
  provider remount waits for the App-level guard to accept the token transition,
  while direct initial portal precedence and token-to-token isolation remain.
  Invalid exact arrivals show a visible contextual recovery. Browser-local catalog
  caches are isolated by organization and remain explicitly local, and a sales
  user receives a contextual role boundary rather than a generic destination.
  This adds no read, role, pricing, mutation, provider, or new persistence
  authority.
  AIUI-46 now gives the combined Decision Room plus default-off Ambient
  exact-token customer portal a calmer,
  content-first reading order across Event, Menu and service, Pricing,
  assumptions, tenant terms, optional additions, response, and questions.
  Contextual question actions reuse the one existing conversation composer and
  acknowledge staged text, preserved drafts, unresolved sends, read-only
  threads, and unavailable conversations. Staff-marked additions prepare only
  reversible ordinary change-request lines; customer-authored text is never
  removed as generated content. Browser-local exact-token fallback mirrors the
  same bounded terms and option shape as the canonical projection. A focused
  local suite passes for helper, portal, conversation, and fallback behavior;
  a dedicated four-case Chromium lane passes at 390, 768, and 1440px with
  44px targets, axe, overflow, clipping, collision, and proposal-nonmutation
  checks. The local proof images are source evidence only. No new customer
  read, callable, direct quote mutation, pricing authority, payment, booking,
  or provider evidence is introduced; connected exact-token behavior,
  deployment, production data, provider outcomes, and human acceptance remain
  open.
  The production workflows now bind the already promoted Ambient presentation
  and the owner-approved staffing presentation. Firebase `all` materializes
  `OPERATIONAL_STAFFING_AUTHORITY_ENABLED=true`; the exact tenant gate remains
  independently required, and provider dispatch also requires the approved
  sender plus its bound secrets. This changes release intent only after the
  exact candidate passes source, emulator, CI, tagged-main, and deployment
  gates; it does not itself prove hosted use, provider delivery, recipient
  acknowledgement, or human acceptance.
  Focused local proof for this Library slice passes 122 of 122 tests across its
  pure model, structured Event Templates editor, exact-arrival contract, route, role
  boundary, fallback isolation, and existing Catalog Admin tests. A dedicated
  Chromium-admin lane passes 7 of 7 cases across 390, 768, and 1440px with
  exact object focus, sub-250ms acknowledgement, preserved unsaved work,
  guarded focus restoration, 44px pointer targets, axe, overflow, and collision
  checks. Three overview images and one focused mobile template-editor image
  are local visual evidence only.
  Package/Menu replacement and equivalent pointer/keyboard reorder handoffs
  are accepted only against the exact parent opportunity revision and fresh
  same-tenant catalog evidence. They arrive in a populated editor review with
  human-readable saved/proposed values and explicit Apply or Keep outcomes;
  Apply changes only the isolated draft and still requires an outcome-named
  trusted save. Proposal preserves saved revision, authoritative pricing,
  customer projection, portal issuance, and provider evidence without
  performing prepare/send/rotate/recover mutations. Conversation keeps sent,
  provider-delivered, portal-viewed, replied, and inferred-engagement evidence
  independent; its inspector sends nothing and marks nothing read. Pilot's
  deterministic blocker, price, authorized-margin, and client-summary answers
  expose confidence and provenance. Scenario adoption binds the exact tenant,
  catalog observation, proposal, and changed draft fields into an immutable
  review before an explicit Apply or Keep; Apply remains in-memory, and trusted
  save retains authoritative repricing/version authority. The partial items
  retain explicit open boundaries: AIUI-18 lacks proved full legacy parity and
  retirement, universal cross-domain ranking/freshness, hosted behavior, and
  human acceptance; AIUI-19 has local responsive browser proof but still needs
  hosted role and production-data review, rollback-release evidence, and human
  acceptance; authentication and organization
  state have not fully left `App.jsx`, the draft runtime is not yet the complete
  reducer/command owner, event-logistics draft intent is not consumed by
  focused editor controls, Package/Menu price/margin and inclusion
  reconciliation remain open, the Money inspector remains read-only rather than
  owning governed request/settlement actions, Proposal and Conversation retain
  their existing governed action surfaces, and canonical signals now drive the
  bounded Ambient NOW priorities but are not yet integrated through every
  object. AIUI-16 still lacks complete
  interpreted-destination parity beyond its exact opportunity, draft-focus,
  and choose-an-opportunity outcomes. AIUI-40 now consumes exact supported
  Schedule event/conflict arrivals and three strict Reporting targets in
  addition to Workflow, Approval, and Messages. Authoritative operational
  staffing remains non-primary-ready in Schedule rather than being conflated
  with its legacy staff-lead field. AIUI-41 keeps its next action in normal flow to avoid covering content;
  sticky behavior and complete mobile parity remain open.
  The exact-arrival contract carries only allowlisted semantics and opaque
  identifiers, keeps exact customer-message identity out of the URL, and treats
  transport as pending until its supported destination proves the exact item
  was loaded and focused. A missing, stale, truncated, or unavailable item
  recovers without substituting another. The accepted source-only architecture
  decision is recorded in `docs/AMBIENT_WORKSPACE_ARRIVAL_ADR.md`.
  AIUI-29's independently gated operational authority covers tenant-isolated
  roster profiles, operator-recorded availability, conflict-safe assignments,
  explicit coverage gaps, and immutable receipts. AIUI-47 now has material
  local source: the existing product-event rail accepts privacy-bounded 250ms
  primary-action assessments, first intent paired only with an exact
  server-authoritative Firebase saved-draft receipt, and issue timing paired
  only by the same bounded category in the same staff session; Reporting labels
  these as client observations rather than server timing. AIUI-49's expanded
  browser audit is also material but not a permanent release gate. This
  candidate source is not part of `v0.7.0`; compatibility
  parity, hosted roles, rollback-release evidence, timed comprehension,
  production-data acceptance, and human acceptance remain open.

## Historical Operational Receipt — v0.7.0 (Superseded)

- This retained record describes the governed August 11 deployment of commit
  `fb0aacc1c5c9f6c4ba8733f87c98c7b58e1611bd`, tagged `v0.7.0`; it was
  superseded by the exact `v0.15.0` production release identified at the top of
  this document and must not be read as current runtime state.
- Exact-main CI run `31528176575` passed all eight required jobs.
- Firebase `all` deployment run `31529170963` updated Hosting, Firestore rules,
  indexes, and Functions, then verified `https://tonicatering.web.app`.
- Vercel deployment run `31530050353` promoted immutable deployment
  `quoteflow-duqhsqfau-mbmapps.vercel.app` and rebound
  `https://quotepilot.mbmapps.com`.
- At that time, `/`, `/app`, and `/app/messages` returned HTTP 200 on
  the production edge; `/` and `/app` also returned HTTP 200 on the Firebase
  origin.
- The contemporaneous Firebase inventory listed 75 Functions; the newly
  deployed callable `recordChangeRequestParse` reported `ACTIVE` on Node.js 22
  in `us-central1`.
- Both contemporaneous production workflows checked out that exact tagged
  release SHA.
- At that checkpoint, local Firebase CLI access to `tonicatering` and the
  protected GitHub Firebase deployment credential were renewed and
  authenticated on August 10. No credential values are stored in tracked files.

These receipts prove source promotion, provider acceptance of the deployments,
and public route reachability. They do not prove authenticated staff behavior,
production-data correctness, external provider delivery, recipient receipt, or
human acceptance.

## Production Capability State

### Enabled and deployed

- Customer-centered staff workspace, including the Command Center, routed
  Quotes, CWF-16 Event Workspace, Customer Directory, Internal Customer 360,
  Event Messaging Station, Workflow, Schedule, Reporting, Catalog, Imports,
  Integrations, and Diagnostics.
- Deterministic event intelligence and proposal-completeness presentation. The
  UI continues to return `Unavailable` for unsupported Flexibility or Alignment
  evidence instead of manufacturing a score.
- Trusted quote creation, update, duplicate, reopen, exact-version rebook,
  lifecycle history, proposal export, and server-authoritative pricing.
- Exact-token customer proposal portal, authoritative proposal acceptance,
  request-changes/decline paths, portal recovery, portal rotation, and
  quote-scoped staff/customer conversation exchange.
- Customer and catalog CSV import/rollback, blank-catalog onboarding, starter
  catalog packs, reviewed pricing confirmation, and conflict-safe catalog
  revision handling.
- Workflow Attention, approvals, post-event closeout, bounded schedule/run-of-
  show, bounded reporting, product analytics, and Operations Audit surfaces.
- Commercial Change simulation/authorization/reconciliation callables, trusted
  Kitchen BEO receipts, deterministic dependency invalidation, and Decision
  Debt projection are deployed. Enforcement remains dormant unless both the
  global and exact tenant gates are enabled.
- Revenue Autopilot policy, customer-control, materialization, reconciliation,
  unsubscribe, scheduler, and signed Resend-webhook callables are deployed.
  Runtime and outbound gates remain off.
- Primary quote email configuration is deployed with the approved restricted
  Resend sender. Configuration presence is not provider-accepted delivery,
  delivered-event, or recipient-inbox proof.
- Primary quote Stripe runtime is configured for live mode. Deposit and final-
  balance code, signed webhook handling, reconciliation, and customer-safe
  projection are deployed; exact hosted/provider acceptance for each rail is
  still required before broad operational claims.

Authenticated hosted use and human acceptance remain separate for the listed
staff capabilities even where source, local/emulator, CI, deployment, and public
route evidence are complete.

### Deployed configuration without provider acceptance

- The owner-SMS rail now has a deployment-owned
  `NOTIFICATIONS_SMS_PROVIDER=none|twilio|pingram` choice, a provider-neutral
  admin status/test surface, a transactional private outbox, single-call
  attempt, provider binding, durable signed-callback inbox, and
  reconciliation-safe outcomes. It remains one-way for existing owner alerts
  only; it does not add customer SMS or a two-way inbox. Signed unsubscribe or
  exact inbound STOP creates an indefinite v1 hold on all owner SMS sends across
  provider selection, with no browser or callable clear path; provider
  acceptance is not delivery, and claimed or indeterminate attempts are not
  automatically resent.
- Exact `v0.15.0` deployed the Pingram-capable Functions and selected
  `NOTIFICATIONS_SMS_PROVIDER=pingram` with generation
  `pingram-2026-08-14-a`. The deployment receipt does not establish endpoint
  registration, a provider-accepted call, carrier delivery, live SMS, or
  recipient-device receipt. Controlled hosted/provider UAT still requires the
  bound secrets, approved origin and sender/compliance posture, server-owned
  E.164 destination, explicit consent, signed-webhook registration, and exact
  evidence separation.

### Deployed but intentionally dormant

| Capability | Current gate | Reason it remains off |
|---|---|---|
| Public buyer onboarding backend | `BUYER_ACCESS_ENABLED=false` | The browser route and Turnstile site key are live, but the bound buyer Stripe credential identifies as live mode while the buyer contract requires a dedicated test-mode key. The restricted key also cannot prove the required test webhook inventory. |
| Commercial Change enforcement | global `false`; all five observed tenant gates off | Simulation and evidence review remain usable. Enforcement requires authenticated admin-role acceptance and a separately authorized exact tenant gate. |
| Revenue Autopilot preparation | `REVENUE_AUTOPILOT_ENABLED=false`; no observed tenant policies | The complete local authority matrix passes, but an authenticated hosted admin acceptance is still required before the global preparation-only gate is promoted. |
| Revenue Autopilot outbound sends | `REVENUE_AUTOPILOT_SENDS_ENABLED=false` | The restricted Resend key can send but cannot independently verify webhook registration. Signed provider webhook, delivery/bounce/complaint, and recipient evidence remain open. |
| SMS | `NOTIFICATIONS_SMS_PROVIDER=pingram`; generation `pingram-2026-08-14-a` | The bounded Pingram rail is deployed, but endpoint registration, provider acceptance, carrier delivery, opt-out handling in production, recipient-device receipt, and human acceptance remain unverified. |
| CRM synchronization | disabled | No reviewed server-authorized connector with provider acceptance is deployed. |

## Current Validation Evidence

- The focused Connect source suites cover exact named-database selection,
  current-role projection expiry and removal, stable generation reservation,
  authority-bound 30-day recovery deadline, sole command-derived `qpcmd`
  provider identity, unique provider-account binding, collision quarantine,
  private provider-identity/occurrence retention, exact quarantine replay after
  command-receipt interruption, lease ownership and exhaustion, terminal
  receipts, provider-success/interrupted-database convergence, pre- and post-
  provider authority checks, `provider_withheld` URL non-disclosure, one active
  replay-stable handoff, the reviewed transactional rate windows, platform/mode
  preflight, provider-shaped merchant timestamps, separate card-payment and
  payout readiness, and deterministic security review. This is source/local
  evidence only and made no provider or cloud request.

- The QuotePilot Package Workspace source slice passes 45 of 45 focused package
  model, pricing parity, catalog save-state, static presentation, staged
  selector, activation, dependency-review, switch, and revert suites. A fresh
  local real-route browser audit passes at 390, 768, and 1440 pixels with zero
  Axe violations, zero document/workspace overflow, no visible target below 44
  pixels, correct mobile/desktop navigation modes, full-viewport mobile selector
  focus, Escape cancellation/focus restoration, Apply staging, dirty package
  switching, activation blocking, and non-mutating dependency review. The local
  production build and environment check also pass. This is source/local
  evidence only; authenticated hosted admin/sales behavior, production-data
  correctness, deployment, and human acceptance remain open.

- The Ambient zero-dead-click release contract now runs as a dedicated step in
  the protected Playwright CI lane with the production presentation flags and
  operational staffing explicitly disabled. A fail-closed `lane:quick` policy
  check protects the command, flags, workflow bindings, enabled-control mapping,
  and zero-rate assertion. Local proof passes 24 focused monitor/runtime/policy
  tests, the 1-of-1 Chromium-admin release-gate case, the current 340-file /
  3,839-test unit lane with 77 intentional skips, capability-surfacing check,
  documentation governance, workflow lint, and its existing bundle budget.
  CI now has independent, graph-detected compatibility and Ambient production
  build steps. Exact-SHA CI run `33239048234` on release candidate `6ff9d605`
  measures 3,208,826 / 384,998 bytes for compatibility and 3,928,479 / 388,269
  for Ambient; a CI-equivalent local Ambient build measures 3,928,552 / 388,303.
  The temporary ceilings are 3,213,578 and 3,928,552 aggregate bytes
  respectively, with Ambient pinned to the larger literal exact-candidate
  measurement and no discretionary growth headroom; both keep the 391,901-byte
  largest-chunk ceiling. App Check provider code is excluded while its browser
  flag is off. This remains an explicit temporary exception
  requiring optimization or reviewed recalibration and is source/local evidence;
  preview deployment, hosted roles and portal behavior, production timing,
  human acceptance, and rollback evidence remain open.

- The authoritative operational staffing source passes 77 focused
  server/runtime/client tests and 19 focused panel tests (96 focused tests
  combined), the now 70-test Firestore
  rules lane, and a disposable Auth/Firestore/Functions emulator matrix. The
  emulator proves global and exact-tenant gates, role and cross-tenant denial,
  immutable-revision derivation, DST/time/count validation, idempotent replay,
  revision conflicts, overlap exclusion, half-open adjacency, atomic rollback,
  and non-mutation of quote, portal, payment, booking, and BEO evidence. This is
  local/emulator evidence only. Exact `v0.15.0` deployed the default-off
  authority, but it is not tenant-enabled for organization `250`.
- The local default-off Ambient slice has focused contract/component proof. Its
  AIUI-19 Clients slice passes 15 of 15 client-model tests and 8 of 8 component
  tests (23 of 23 combined), 18 of 18 legacy Customer Directory/Customer 360
  tests, 19 of 19 exact-arrival contract tests, and the local production build.
  Its dedicated Chromium-admin lane passes 3 of 3 cases at 390, 768, and
  1440px with exact client arrival, 44px controls, zero axe violations, no
  horizontal overflow, and no audited overlap; six directory and relationship
  images were captured locally. The flag-off production build excludes the
  Ambient Clients chunk and passes the existing bundle ceiling without a new
  exception. These are source and local-test results only;
  hosted-role, production-data, provider, and human acceptance remain open. Its
  targeted 390px mobile comprehension and axe case passes after the top layer
  was reduced to one in-flow remote and its action contrast was corrected. The
  last completed full no-unintended-overlap Chromium-admin browser gate
  passes 80 of 80 local cases with 0 failed or skipped in 6.3 minutes across
  390×844, 768×900, and 1440×1000. Its matrix contains 45 route cases; three
  Library template-editor cases; 27 header, search, context, and Pilot cases;
  two mobile Live Breakdown cases; and three editor review/feedback cases. Its
  15 exact routes cover Now, Quotes (the
  current Opportunities proxy), Customer Directory and Customer 360, Catalog
  Admin (the current Library proxy), Messages, Living Opportunity, Workflow,
  Schedule, Reporting, Imports, Integrations, Diagnostics, not-found, and the
  exact-token customer portal. It
  also opens the header More, Operations, and Account popovers, Workspace
  search, Package, Money, Proposal, and Conversation contexts, mobile Live
  Breakdown, deterministic Pilot answers, the explicit Pilot scenario review,
  and the draft-review/feedback flow. The systemic audit reserves focus paint,
  rejects peer collisions and undeclared overlays, and walks visible controls
  to prove viewport, clipping, scroll, horizontal-overflow, and focus
  containment. Collisions, overflow, escaped controls, escaped focus paint, and
  undeclared overlays remain empty; document overflow is at most 1px, and the
  Messages focused title-to-subtitle clearance is at least 8px.
  Sales-role geometry, Firefox/WebKit, zoom and safe-area behavior, connected
  portal conversation/Ask states, maximum-result search states, and hosted/
  provider/human acceptance remain open; AIUI-49 is therefore material but not
  closed. The full post-hardening accessibility lane also passes 11 of 11 local
  cases. This is source/local browser evidence only.

- The last completed full flag-enabled local Ambient object-verification
  browser lane passes 40 of 40 cases. It covers responsive Event Logistics,
  Package/Menu, Selection, Money, Proposal, Conversation, and global Pilot context at 390, 768, and
  1440px; exact Package and keyboard-equivalent Menu handoffs; Package adoption
  into the draft with an outcome-named save; pending-review dead-save recovery;
  date, pricing, and mobile Staffing contexts; the focused Messages heading at
  all three widths; and transient editor feedback rendered in normal flow with
  zero collision against the Package/Menu review or Live Breakdown. Proposal
  and Conversation proof asserts populated arrival context, independent
  evidence rails, no inline send/mark-read authority, exact focus restoration,
  no horizontal overflow, and saved-quote non-mutation. This is local browser
  evidence only; it does not establish deployment, production-data behavior,
  provider outcomes, or human acceptance. The fresh run includes strict invalid-
  arrival recovery and the single-layer mobile Event disclosure.

- The `v0.6.0` checkpoint passed 202 unit files with 2,390 tests (plus the
  documented skips), the full 59-test default browser suite, the exact
  production-flag matrix, 63 Firestore rules tests, Firebase Auth/rules and
  authoritative-pricing browser lanes, CWV, bundle, governance, Docker, and all
  exact-main CI gates.
- The August 10 customer-centered authority emulator acceptance passed against
  real Auth, Firestore, and Functions emulators with Commercial Change
  enforcement and Revenue Autopilot preparation enabled while outbound sends
  stayed off. It covered governed quote change, apply-outcome reconciliation,
  Kitchen BEO freshness, Decision Debt, Autopilot policy/customer controls,
  deterministic materialization, unread-reply Attention, acknowledgement, and
  signed Resend webhook tamper rejection.
- Production configuration inspection found five organization documents and
  four organization-scoped admin role documents. No observed organization had
  Commercial Change enforcement enabled, and no observed organization had a
  configured Revenue Autopilot policy.
- An attempted hosted app sign-in correctly rejected the Firebase CLI Google
  OAuth token because its audience is not the QuotePilot Firebase Auth client.
  That boundary was preserved; authenticated hosted acceptance still requires
  a real QuotePilot user session.

## Active Risks

1. Authenticated production acceptance is incomplete for quote save/readback,
   export, Event Workspace, Customer 360, Messaging Station, Commercial Change,
   Kitchen BEO, Decision Debt, Revenue Autopilot, and operational staffing.
2. Public buyer onboarding must not be enabled with the current live-mode buyer
   Stripe credential. Replace it with a dedicated test-mode restricted key,
   verify the exact webhook endpoint/events, then run the coordinated Turnstile,
   invoice, signed-webhook, activation, and negative-path acceptance window.
3. Resend configuration and historical domain verification do not prove an
   exact current provider acceptance, delivered event, or recipient inbox.
4. Commercial Change enforcement has no production tenant enabled. Keep it off
   until role-specific hosted acceptance and exact tenant authorization close.
5. Revenue Autopilot outbound sends lack independently verified provider webhook
   registration and hosted scheduler/provider acceptance. Keep sends off.
6. Owner SMS remains off. Twilio lacks A2P approval; Pingram still lacks a
   deployed credential/sender/consent/webhook/UAT receipt. Do not run another
   provider attempt or automatically retry an indeterminate send before one
   complete governed promotion path is approved.
7. A disposable second-tenant create/activate/isolation/cleanup acceptance is
   still required. Existing organization documents do not substitute for that
   exact lifecycle proof.
8. Portal projection and legacy customer-identity normalization remain guarded
   data operations. Run tenant-scoped dry runs and review conflicts before any
   production apply.
9. The combined workspace candidate uses named per-graph temporary ceilings:
   3,213,578 bytes for compatibility and 3,928,552 bytes for Ambient. The
   Ambient ceiling is pinned to the larger of exact-SHA CI and CI-equivalent
   local candidate measurements, a 73-byte environment difference with no
   discretionary headroom. A fresh exact-SHA CI pass is still required before merge, and
   optimization or reviewed clean-main recalibration is required before the
   exception can close.
10. The sole `functions.config()` compatibility read is removed in the current
    source candidate. Production still runs the prior deployed revision, so an
    exact coordinated backend release and runtime readback remain required
    before the March 2027 platform removal can be called operationally closed.
11. The repository still lacks an independent human reviewer for stronger
    pre-merge and production UAT separation in the current solo-operator model.
12. Operational staffing code and both global gates are deployed in exact
    `v0.15.0`; protected run `33282940451` independently activated and verified
    the tenant gate for selected founder-pilot tenant `mm05366-sandbox` from
    exact-main operator SHA `8582e4ac4dc54c8c2eb60c09bd1b2176cf1cd125`.
    Exact hosted admin/sales and denied-role behavior, responsive accessibility,
    rollback, and explicit founder acceptance remain separate evidence.
13. The fixed `staging-safe-off` candidate cannot by itself satisfy the
    all-positive release checklist. The separately tracked
    `staging-staffing-authority` profile can expose positive staffing checks in
    an immutable non-production window, but it does not create or enable a
    tenant and does not unblock provider-backed buyer, delivery, payment, or
    contract-conversion evidence. Blocked profile items cannot be omitted or
    attested as passed.
14. Stripe Connect remains deliberately unexported and unbound. Do not add a
    browser control, callable, handoff route, provider credential, or worker
    deployment until the isolated staging resources, trusted authority
    publisher, App Check enforcement/consumption, exact runtime identities, and
    hosted negative/replay evidence are separately reviewed.
15. The owner reviewed and accepted the Steward PRD, ADR, UI specification,
    technical design, threat model, and work plan for implementation planning.
    The approved context excludes sensitive personal information from provider
    packets, limits the pilot to the US, requires admin checkpoints for
    discounts/custom menu items/policy text, and permits sales staff to stage
    response drafts without send authority. The owner then expanded the
    planning scope to menu/workflow configuration, credential-blind provider
    readiness, deterministic margin monitoring, and tenant-owned client advice
    from source-labeled reviewed memory. Steward now has a deploy-dormant pure
    validation and control foundation only: fixed task/request/source contracts,
    tenant/revision fences, US/role/content policy, deterministic commercial
    provenance, safe-text validation, expiring tamper-evident packets,
    pseudonymous audit metadata, bounded retention/deletion, incident recovery,
    and kill/rollback gates pass 32 focused tests. Nine planned private
    collection paths deny browser access across all 76 Firestore emulator
    tests. The branch-wide validation blockers are now closed: local pricing-
    snapshot enrichment preserves exact supplied pricing while adding private
    commercial evidence, all 3,883 unit tests pass, and both Firebase
    orchestration lanes complete. Nothing imports or exports the Steward
    modules, and provider/runtime
    integration, billing, hosted rules proof, deployment,
    production, background-model, customer contact, and autonomous authority
    remain absent.
    The first Phase 1 source slice now adds a fixed hidden `draft_response`
    compiler: minimized authorized excerpts enter a storage-off, background-off,
    zero-tool injected-adapter request; exact claim inventory, source/policy,
    whole-output, kill-gate, refusal, and outage behavior pass 16 focused tests.
    It remains deploy-dormant with no configured provider transport or
    credential, runtime import/export, callable, UI, persistence, composer
    handoff, customer send, deployment, or production evidence.
    The next source slice adds current organization owner/admin approval plus
    exact participant opt-in before adapter use, a pinned 100-case corpus,
    hidden-only results, digest-only human-comparison receipts, duplicate
    rejection, and source-local evidence thresholds that cannot promote
    themselves. Fourteen added tests pass. The corpus is not 100 completed human
    reviews; private runtime, provider-backed pilot, model-output UI,
    persistence, deployment, production behavior, and human acceptance remain
    absent.
    The tracked review-receipt negative test now constructs its clearly
    synthetic Stripe credential shape at runtime. The exact secret-rejection
    assertion still passes 14/14, the repository secret scan and complete
    `lane:quick` pass, and the release lane now advances to the independently
    known capability-surfacing debt. No scanner rule or Steward policy changed.
    The authorized staff Quote Workspace now includes the bounded Desk status
    panel. Its live state is provider-unavailable, renders no model prose,
    labels no changes made, disables Steward handoff, and routes only to the
    existing manual-message workflow. Twenty-two UI tests and three local real-
    route Playwright checks pass at desktop and mobile. This does not prove a
    provider run, pilot, hosting, deployment, production behavior, or human
    acceptance.
16. Production-only dependency audits are clean for the root app, default
    Functions, and Connect Functions. The full root audit retains six high-
    severity development-tool findings through Lighthouse CI's current
    Puppeteer/`extract-zip` chain; npm's available remediation is a breaking
    Lighthouse CI downgrade and must not be forced without a reviewed tooling
    migration.
17. Cloud runner handoff is now documented as a source/process contract in the
    orchestration blueprint and runbook. Hosted agents should bootstrap with
    `npm ci`, `npm run check:env`, a bounded `plan:task --json` packet, emitted
    validations, and a matching `--phase complete` packet. This improves
    repeatability only; it does not prove a configured cloud provider account,
    injected secrets, hosted deployment, production behavior, or human
    acceptance.
## Current Focus

1. Complete an authenticated production operator pass for quote create/save/
   readback/export and the customer-centered routes using an actual QuotePilot
   user session.
2. Replace and verify the buyer Stripe credential in test mode before opening a
   bounded buyer-access acceptance window.
3. Verify the Revenue Autopilot Resend webhook in the provider dashboard, then
   promote preparation-only mode first; keep outbound sends disabled until a
   separate provider-delivery acceptance.
4. Capture one controlled Resend quote-delivery attempt with provider accepted,
   delivered/bounced reconciliation, and recipient-inbox evidence kept distinct.
5. Prepare, but do not yet execute, the Pingram owner-SMS promotion record:
   Secret Manager bindings, exact regional origin, new configuration generation,
   sender/A2P and owner-consent evidence, registered signed endpoint, rollback,
   opt-out-hold proof, and one controlled UAT plan.
6. Run the disposable second-tenant lifecycle and hosted cross-tenant/portal
   denial matrix.
7. Review the remaining bundle-exception retirement path—graph optimization or
   clean-main baseline policy—then run both build profiles, browser, and CWV
   gates. Separately include the environment-only Functions configuration
   candidate in an exact coordinated backend release and verify runtime readback
   before closing that migration operationally.
8. Define and review an exact-SHA non-production acceptance profile for the
   currently blocked provider and authoritative-staffing UAT items before any
   all-positive attestation or production-intent merge.
9. For Stripe Connect, review and apply the isolated staging foundation before
   activating any runtime: reconcile exact database/IAM/egress/service-account
   identities, establish the trusted authority publisher, register and observe
   App Check, then bind the edge and worker identities under an explicit hosted
   Sandbox release. Keep `functions-connect/index.js` export-empty until those
   gates pass.
10. Finish the read-only Difficult Question Desk shadow proof with a reviewed
    private runtime, actual consenting silent execution, and 100 human packet
    reviews. Its deploy-dormant fixed compiler, consent/evaluation contract,
    pinned 100-case corpus, digest-only comparison receipts, 30-case server
    suite, and unavailable-state Quote Workspace panel are complete; no model
    output is user-visible and no staging is enabled. Sequence expanded
    setup/workflow, provider-readiness, margin, and client-memory tasks only
    after their pure privacy, memory, no-secret, and adversarial contracts pass;
    keep provider, billing, deployment, production, and autonomous authority
    outside that authorization.
11. On the exact deployed PWA candidate, install and relaunch from supported
    desktop and mobile devices, verify offline navigation reaches the truthful
    reconnect state, reconnect successfully, and record the browser/OS/build
    identity. Do not interpret installation as authenticated offline-data or
    queued-mutation support.

Open work and priority sequencing live in [`DEV_TASKS.md`](DEV_TASKS.md).
Historical shipped changes live in [`CHANGELOG.md`](CHANGELOG.md).
