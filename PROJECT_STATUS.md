# Project Status

Last updated: August 11, 2026

## Current Production Release

- PR #54 merged the governed post-competitive pilot release into `main` at
  `4f4e00d3829eb29a1ee90d7d8402b786344dd158`; annotated tag `v0.6.0`
  resolves to that exact commit.
- Exact-main CI Quality run `31452570192` passed all eight required jobs,
  including the default-off rollback suite and the exact seven-flag production
  bundle/browser matrix.
- Governed Firebase `all` run `31452927999` and governed Vercel run
  `31452928296` both completed successfully from that tagged revision with
  `v0.5.0` commit `3cca8cc4bb985de6ec08c9d62094cfe81b1d2a43`
  recorded as the rollback target.

## Operational Health

- Production runtime: `v0.6.0` is live from tagged `main` commit
  `4f4e00d3829eb29a1ee90d7d8402b786344dd158`.
- Exact-main CI: run `31452570192` passed all eight required jobs.
- Firebase: `all` deployment run `31452927999` updated Hosting, Firestore rules,
  indexes, and Functions, then verified `https://tonicatering.web.app`.
- Vercel: deployment run `31452928296` promoted immutable deployment
  `quoteflow-3q51ufo9y-mbmapps.vercel.app` and rebound
  `https://quotepilot.mbmapps.com`.
- Public reachability: `/`, `/app`, and `/app/messages` returned HTTP 200 on
  the production edge; `/` and `/app` also returned HTTP 200 on the Firebase
  origin.
- Runtime inventory: Firebase lists 75 Functions. The newly deployed callable
  `recordChangeRequestParse` reports `ACTIVE` on Node.js 22 in `us-central1`.
- Merged/deployed parity: both production workflows checked out the exact
  tagged release SHA. This receipt-only documentation reconciliation does not
  change the deployed runtime.
- Credential health: local Firebase CLI access to `tonicatering` and the
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

### Deployed but intentionally dormant

| Capability | Current gate | Reason it remains off |
|---|---|---|
| Public buyer onboarding backend | `BUYER_ACCESS_ENABLED=false` | The browser route and Turnstile site key are live, but the bound buyer Stripe credential identifies as live mode while the buyer contract requires a dedicated test-mode key. The restricted key also cannot prove the required test webhook inventory. |
| Commercial Change enforcement | global `false`; all five observed tenant gates off | Simulation and evidence review remain usable. Enforcement requires authenticated admin-role acceptance and a separately authorized exact tenant gate. |
| Revenue Autopilot preparation | `REVENUE_AUTOPILOT_ENABLED=false`; no observed tenant policies | The complete local authority matrix passes, but an authenticated hosted admin acceptance is still required before the global preparation-only gate is promoted. |
| Revenue Autopilot outbound sends | `REVENUE_AUTOPILOT_SENDS_ENABLED=false` | The restricted Resend key can send but cannot independently verify webhook registration. Signed provider webhook, delivery/bounce/complaint, and recipient evidence remain open. |
| SMS | `NOTIFICATIONS_SMS_PROVIDER=none` | The Twilio Messaging Service has no approved US A2P registration. Repeated carrier-rejected tests are prohibited until approval. |
| CRM synchronization | disabled | No reviewed server-authorized connector with provider acceptance is deployed. |

## Current Validation Evidence

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
   Kitchen BEO, Decision Debt, and Revenue Autopilot operations.
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
6. Twilio SMS lacks A2P approval. Keep SMS off and avoid additional carrier-
   rejected tests.
7. A disposable second-tenant create/activate/isolation/cleanup acceptance is
   still required. Existing organization documents do not substitute for that
   exact lifecycle proof.
8. Portal projection and legacy customer-identity normalization remain guarded
   data operations. Run tenant-scoped dry runs and review conflicts before any
   production apply.
9. The customer-centered convergence bundle still uses the named temporary
   no-headroom exception. Optimization or reviewed clean-main recalibration is
   required before removing it.
10. `functions.config()` compatibility remains in source and must migrate before
    Firebase removes the legacy API in March 2027.
11. The repository still lacks an independent human reviewer for stronger
    pre-merge and production UAT separation in the current solo-operator model.

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
5. Run the disposable second-tenant lifecycle and hosted cross-tenant/portal
   denial matrix.
6. Complete the bundle-exception closure path and continue `functions.config()`
   migration planning.

Open work and priority sequencing live in [`DEV_TASKS.md`](DEV_TASKS.md).
Historical shipped changes live in [`CHANGELOG.md`](CHANGELOG.md).
