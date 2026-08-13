# Stripe Connect Program

Last updated: August 13, 2026

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
5. Implement strict status/onboarding interfaces and one-use same-tab Account
   Link handoff, still Sandbox-only.
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
| Provider status refresh | 6 per 5 minutes | 30 per 5 minutes |
| Begin onboarding | 6 per 24 hours | 10 per 24 hours |
| Prepare onboarding redirect | 5 per 15 minutes | 20 per 15 minutes |

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
  digests, auth-claim tenant scope, redacted `StripeConnectStatusV1`, owner-only
  recent-auth/App Check checks, HMAC-only rate-limit principals,
  reservation-before-provider ordering, redacted
  mutation receipts, and a one-use same-tab POST handoff. The handoff keeps its
  token out of URLs/referrers, stores only an HMAC token digest, is consumed
  before an injected Account Link adapter runs,
  limits retained provider evidence to the attempt digest and bounded expiry,
  and recovers without automatic link recreation.
- A dormant concrete repository selects Firestore only through the exact named
  `connect-control` database argument. It transactionally reserves one
  immutable generation and stable 30-day Accounts v2 idempotency identity,
  binds each platform/mode/account identity to one organization and generation,
  quarantines collisions, stores redacted replay receipts, refreshes by exact
  revision, and consumes each HMAC-digested handoff once. The paired limiter
  stores no raw UID or organization ID and enforces the reviewed principal and
  organization windows atomically with fail-closed database behavior.
- A dormant injected Stripe adapter is fixed to the exact SDK/API versions,
  Sandbox mode, an explicit platform-account binding, Accounts v2 merchant
  configuration, full Stripe Dashboard access, Stripe fee and negative-balance
  responsibility, USD, US identity, and requested card payments. It creates
  merchant-only hosted Account Links with stable v2 idempotency and projects
  only bounded health evidence. Live mode, responsibility drift, platform
  mismatch, foreign return origins, and provider identity mismatch fail before
  a usable binding is returned.
- These repository, limiter, and adapter modules are not imported by
  `functions-connect/index.js`. The tracked staging platform remains `unbound`,
  so the adapter cannot be instantiated from the current manifest. Callable and
  HTTP bindings remain absent until the applied infrastructure and App Check
  gates pass.

No connected account, App Check enforcement, applied Terraform resource,
credential, callable/HTTP export, Stripe call, Account Link, webhook
destination, provider evidence, Connect deployment, hosted UAT, production
enablement, or human acceptance is claimed.
