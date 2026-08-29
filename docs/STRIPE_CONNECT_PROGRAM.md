# Stripe Connect Program

Last updated: 2026-08-28 13:03:27 CDT

## Purpose and stopping point

Build Stripe Connect as a separately deployed control plane while preserving
the current deposit, final-balance, and buyer-access rails. The authorized
program stops after authenticated hosted Stripe Sandbox UAT and a pilot-ready
evidence package. Production connected-account creation, onboarding, routing,
charges, refunds, and pilot promotion remain separately authorized.

## Fixed commercial and provider model

- United States and USD only.
- The caterer is the merchant and the customer pays the caterer.
- Stripe Accounts v2 merchant configuration with full Stripe Dashboard access.
- Stripe collects fees and is responsible for negative balances.
- Direct charges in connected-account context.
- No application fee, transfer data, or `on_behalf_of` behavior.
- Hosted Stripe onboarding; Dashboard owns KYC, banking, tax configuration,
  payouts, refunds, and disputes.

## Isolation contract

| Domain | Contract |
|---|---|
| Existing payments | `functions` / Firebase codebase `default`; exact `stripe@16.12.0`; existing API and evidence semantics remain authoritative. |
| Connect | `functions-connect` / Firebase codebase `connect`; Node 22; exact `stripe@22.5.0`; API `2026-07-29.dahlia`. |
| Control data | Future named Firestore database `connect-control`; no browser access and no Connect-worker access to the default database. |
| Deployment | Existing release workflows select `functions:default` explicitly. The `connect` codebase has no deployable export during the foundation checkpoint. |
| Provider state | The tracked staging foundation manifest is secret-free, Sandbox-only, unbound, and rejects provider calls, onboarding, exports, service accounts, egress, webhooks, key policies, and rollback-floor claims until their own gates land. |

The fixed staging identity is project `quotepilot-staging-20260804`, project
number `844470813106`, and return origin
`https://quotepilot-staging-20260804.web.app`. Production remains project
`tonicatering` and origin `https://quotepilot.mbmapps.com`; there is no tracked
production Connect manifest yet.

## Delivery sequence

1. Establish explicit organization-owner authority and server-only role writes.
2. Split deployment codebases and pin both Stripe runtimes without adding a
   Connect export or provider credential.
3. Add exact owner backfill, owner/admin role-management authority, recent-auth
   proof, and App Check monitor-then-enforce contracts.
4. Provision isolated staging database, IAM, identities, network/egress,
   secrets, and GitHub OIDC with Terraform and separate state.
5. Implement strict status/onboarding interfaces, current-role authority
   projection, an edge-command/leased-worker boundary, and a replay-stable
   one-use same-tab Account Link handoff, still Sandbox-only and deploy-dormant.
6. Implement generation-bound routing, preclaims, direct Checkout binding,
   endpoint-specific inboxes, workers, receipt relay, journals, retention locks,
   projection, and no-fallback behavior.
7. Complete foundation and payment hosted Sandbox UAT; produce the evidence
   package and stop.

Each step is its own rollback and evidence boundary. A source commit, passing
local test, CI run, hosted route, Stripe request, provider object, deployment,
and human acceptance are distinct claims.

## Dormant rate policy

Every operation must pass both its principal and organization window in one
`connect-control` transaction. A limiter read or commit failure denies the
operation.

| Operation | Principal window | Organization window |
|---|---:|---:|
| Provider status refresh | 6 per 5 minutes | 6 per 5 minutes, at least 10 seconds apart |
| Begin onboarding | 6 per 24 hours | 10 per 24 hours |
| Prepare onboarding redirect | 3 per 15 minutes | 10 per 24 hours |

## Current source checkpoint

- Organization-owner activation is explicit, exact-email verified, atomically
  bound, receipted privately, and browser role writes are denied.
- The owner backfill command defaults to dry-run and returns
  `ownership_required` unless exactly one consumed admin invitation agrees with
  its organization, provisioning order, verified Auth user, and existing admin
  role. Apply additionally requires the planned UID and an exact
  project/organization/UID confirmation; no production apply has been run.
  Disposable Auth/Firestore emulator acceptance proves dry-run no-write,
  transactional bind, immutable receipt, replay idempotency, and ambiguous-
  candidate denial.
- Canonical owners can now manage same-organization admin and sales authority
  through one in-flow Team access surface; non-owner admins can manage sales
  access only. The callable requires exact verified email, expected current
  role, five-minute authentication proof, one replay-stable request ID, and an
  immutable browser-private receipt before synchronizing custom claims.
  Disposable emulator acceptance proves promotion, sales grant, replay,
  cross-authority denial, owner-demotion denial, and claims synchronization.
- Password and Google recent reauthentication are wired. Browser App Check is
  opt-in through an environment-specific reCAPTCHA Enterprise public site key.
  The staging foundation records monitoring first, disabled replay enforcement,
  and an unbound site key; its policy rejects premature enforcement or key
  binding. No provider registration or hosted token evidence exists yet.
- `firebase.json` names `default` and `connect` codebases.
- Existing deployment selectors address only `functions:default`.
- The Connect package is exactly pinned but exports nothing.
- `config/stripe-connect/staging-foundation.json` is provider-disabled and
  intentionally incomplete; its empty infrastructure bindings are blockers,
  not placeholders to infer as ready.
- A pinned staging-only Terraform module/root now defines the future named
  database, conditional IAM, five service identities, empty secret containers,
  private serverless network, fixed NAT egress, protected state bootstrap, and
  exact GitHub OIDC admission. Its validation workflow has no credentials,
  OIDC token permission, plan, or apply. App Check creation is forced off and
  production infrastructure is absent. Pinned-provider local format/init/
  validate is source evidence only; no cloud plan or resource exists.
- Dormant status/onboarding contract modules now define exact-key request
  digests, redacted `StripeConnectStatusV1`, owner-only recent-auth/App Check
  checks, HMAC-only rate-limit principals, reservation-before-provider
  ordering, redacted mutation receipts, and a one-use same-tab POST handoff.
  Edge authorization no longer treats an identity-token role as current by
  itself: it also requires a receipt-bound, monotonically revisioned authority
  projection containing the current enabled, verified administrators and
  canonical owner. The projection is valid for at most ten minutes, and stale,
  inactive, removed-admin, owner-missing, publisher-mismatched, or digest-
  mismatched authority fails closed.
- Every dormant status callable now requires the exact expected App Check
  application binding, and provider refresh additionally requires a consumed
  limited-use token before rate-limit or command work. These are source
  contracts only until the exported handlers enable Firebase enforcement and
  token consumption.
- Account creation and provider-status refresh now cross an immutable private
  command boundary. The edge freezes an exact payload/request digest without
  calling Stripe. The immutable command derives the sole provider idempotency
  key, `qpcmd_<digest>`; the repository reservation contains the generation,
  authority digest, and 30-day recovery deadline, but no second provider key.
  A separately composed worker claims a bounded lease, revalidates current
  authority, revision, generation, unexpired recovery reservation or account
  binding, executes the injected provider adapter, and writes one terminal
  receipt. Exact retries reuse the command-owned provider identity; conflicting
  request-ID reuse is rejected, deterministic authority/provider-contract
  failures enter `security_review`, and exhausted lease attempts produce a
  dead-letter receipt.
- Account binding has a second authority gate after Stripe returns. The
  completion transaction re-reads the current owner projection with a fresh
  clock on every transaction attempt before it can bind the account. A
  provider response that fails post-create validation, an
  owner/authority change during the provider call, or a binding collision keeps
  the returned account identity and provider occurrence only in private
  quarantine records, marks the provider-account claim quarantined, and exposes
  no usable binding. If command-receipt persistence is interrupted after that
  quarantine commits, retry validates the exact occurrence and reconstructs
  the same terminal quarantine without another Stripe call. These command and
  worker modules are not exported or instantiated by the deployment entry
  point.
- The same-tab handoff is now bound to the exact owner UID, authority revision,
  expected App Check application digest, organization generation/revision,
  request ID, and payload digest. Its bearer value is deterministically derived
  but never stored; only its digest and a bounded attempt receipt persist. An
  exact request replay returns the same still-active attempt, a different
  active attempt is refused, and the ten-minute handoff is consumed before an
  injected Account Link adapter runs. Consumption transactionally rechecks the
  current owner authority, connection state, revision, generation, and private
  account binding. After Stripe creates the Account Link, a second transaction
  rechecks that same authority, state, prepared-attempt ceiling, provider
  expiry, and post-receipt clock before the URL may be disclosed. Authority or
  state drift records `provider_withheld` and permits a new explicit recovery
  attempt. If the issuance receipt cannot be committed, the URL is still
  withheld but the consumed attempt remains blocked until its local expiry;
  QuotePilot never claims that `provider_withheld` committed. Every withheld
  path returns only the QuotePilot recovery destination, retains no provider
  URL, and never silently creates another link.
- A dormant concrete repository selects Firestore only through the exact named
  `connect-control` database argument. It transactionally reserves one
  immutable generation, exact authority digest, and 30-day provider-recovery
  deadline before command enqueue. The command—not the reservation—owns the
  sole Stripe idempotency key. The repository binds each platform/mode/account
  identity to one organization and generation, preserves private post-provider
  quarantine occurrences and provider identities, reconstructs exact
  quarantine replay, stores redacted public receipts, refreshes by exact
  revision, rejects unreviewed platform/configuration bindings, and consumes
  each HMAC-digested handoff once. The paired limiter
  stores no raw UID or organization ID and enforces the reviewed principal and
  organization windows atomically with fail-closed database behavior.
- A dormant injected Stripe adapter is fixed to the exact SDK/API versions,
  Sandbox mode, an explicit platform-account binding, Accounts v2 merchant
  configuration, full Stripe Dashboard access, Stripe fee and negative-balance
  responsibility, USD, US identity, and requested card payments. Before every
  account create, account retrieve, or Account Link request, it independently
  retrieves the exact v1 platform account and Sandbox balance; wrong platform,
  wrong mode, or unavailable preflight fails before provider mutation. It
  validates the provider-shaped RFC 3339
  `configuration.merchant.applied` timestamp, requires both card payments and
  payouts to be active before projecting `ready`, creates merchant-only hosted
  Account Links with stable v2 idempotency, and projects only bounded health
  evidence. When Stripe returns an account identity whose remaining fields fail
  post-create validation, the adapter makes that identity available only as
  non-enumerable private quarantine evidence. Live mode, responsibility drift,
  foreign return origins, and provider identity mismatch fail before a usable
  binding is returned.
- These repository, limiter, and adapter modules are not imported by
  `functions-connect/index.js`. The tracked staging platform remains `unbound`,
  so the adapter cannot be instantiated from the current manifest. Callable and
  HTTP bindings remain absent until the applied infrastructure and App Check
  gates pass.

## Completion-boundary reassessment

The repository-preparable foundation is complete before the cloud/provider
gate. The fixed Accounts v2 configuration remains internally consistent:
connected caterers receive full Stripe Dashboard access, Stripe collects fees
and owns negative-balance liability, payments use direct charges, and
QuotePilot takes no application fee. The foundation, infrastructure, and
onboarding checks pass. The read-only live staging preflight also confirms the
exact Firebase project, single Web app, and protected `connect-control`
database inventory.

That preflight is not an applied Terraform plan, IAM/egress reconciliation,
App Check registration or enforcement, restricted Stripe credential, provider
binding, deployment, or hosted acceptance. Those actions require a human to
review a saved cloud plan, authorize its exact digest, reconcile applied
identities into the secret-free manifest, observe App Check before promotion,
and approve the Sandbox runtime/UAT window. `functions-connect/index.js` must
remain export-empty until those gates pass; source work must not simulate their
evidence.

No connected account, App Check enforcement or callable token consumption,
applied Terraform resource, credential, callable/HTTP export, Stripe call,
Account Link, webhook destination, provider evidence, Connect deployment,
hosted UAT, production
enablement, or human acceptance is claimed.
