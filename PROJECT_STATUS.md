# Project Status

Last updated: August 11, 2026

## Current Production Release

- PR #57 merged the governed workspace and messaging release into `main` at
  `fb0aacc1c5c9f6c4ba8733f87c98c7b58e1611bd`; annotated tag `v0.7.0`
  resolves to that exact commit.
- Exact-main CI Quality run `31528176575` passed all eight required jobs.
- Governed Firebase `all` run `31529170963` and governed Vercel run
  `31530050353` both completed successfully from that tagged revision with
  `v0.6.0` commit `4f4e00d3829eb29a1ee90d7d8402b786344dd158`
  recorded as the rollback target.

## Operational Health

- Production runtime: `v0.7.0` is live from tagged `main` commit
  `fb0aacc1c5c9f6c4ba8733f87c98c7b58e1611bd`.
- Exact-main CI: run `31528176575` passed all eight required jobs.
- Firebase: `all` deployment run `31529170963` published Hosting release
  `sites/tonicatering/releases/1786477743665000` (version
  `a9f6a7ded70efcc0`), verified rules/index parity, and left every deployed
  Function active.
- Vercel: deployment run `31530050353` promoted deployment
  `dpl_HQaLBMe93QfNqgwZmT7ov9WzR9Z5` at
  `quoteflow-duqhsqfau-mbmapps.vercel.app` and rebound
  `https://quotepilot.mbmapps.com`.
- Public reachability: `/`, `/app`, and `/app/messages` returned HTTP 200 on
  the production edge; `/` and `/app` also returned HTTP 200 on the Firebase
  origin.
- Runtime inventory: Firebase lists 77 Functions, all `ACTIVE`.
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

### Implemented in source, not deployed

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
- No Pingram Functions deployment, endpoint registration, provider call, or
  live SMS has occurred. Production remains
  `NOTIFICATIONS_SMS_PROVIDER=none`. Promotion requires `PINGRAM_API_KEY`,
  `PINGRAM_WEBHOOK_SECRET`, and `SMS_CONTACT_DIGEST_SECRET` in Firebase Secret
  Manager, one exact approved US/CA/EU Pingram origin, a new lowercase
  `PINGRAM_CONFIGURATION_GENERATION`, a server-owned E.164
  owner destination, explicit consent, sender/A2P approval, exact
  signed-webhook registration, and controlled hosted/provider UAT.

### Deployed but intentionally dormant

| Capability | Current gate | Reason it remains off |
|---|---|---|
| Public buyer onboarding backend | `BUYER_ACCESS_ENABLED=false` | The browser route and Turnstile site key are live, but the bound buyer Stripe credential identifies as live mode while the buyer contract requires a dedicated test-mode key. The restricted key also cannot prove the required test webhook inventory. |
| Commercial Change enforcement | global `false`; all five observed tenant gates off | Simulation and evidence review remain usable. Enforcement requires authenticated admin-role acceptance and a separately authorized exact tenant gate. |
| Revenue Autopilot preparation | `REVENUE_AUTOPILOT_ENABLED=false`; no observed tenant policies | The complete local authority matrix passes, but an authenticated hosted admin acceptance is still required before the global preparation-only gate is promoted. |
| Revenue Autopilot outbound sends | `REVENUE_AUTOPILOT_SENDS_ENABLED=false` | The restricted Resend key can send but cannot independently verify webhook registration. Signed provider webhook, delivery/bounce/complaint, and recipient evidence remain open. |
| SMS | `NOTIFICATIONS_SMS_PROVIDER=none` | Current production is off. Twilio still lacks approved US A2P registration, and the Pingram source slice has not been deployed or provider-tested. No provider may be selected until its sender/compliance, consent, secret, endpoint, and controlled-UAT gates pass. |
| CRM synchronization | disabled | No reviewed server-authorized connector with provider acceptance is deployed. |

## Current Validation Evidence

- The `v0.7.0` exact-main CI checkpoint passed all eight required jobs; both
  governed deployment workflows then accepted the exact tagged SHA. Public
  routes returned HTTP 200 on both edges, and all 50 sampled built assets were
  byte-identical between Vercel and Firebase Hosting.
- The source-only Pingram slice passes 2,610 unit tests and 67 Firestore rules
  tests, a production build, environment/governance/capability/secret/workflow
  checks, and disposable Firestore acceptance for callback-before-binding,
  signed diagnostic readiness, STOP suppression, held-outbox redaction, and
  claimed-retry-without-resend. The disposable acceptance now runs inside the
  standard `lane:firebase-auth-rules` CI path. These are local results, not
  deployment, provider, carrier-delivery, recipient, or human-acceptance
  evidence.
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
9. The workspace plus owner-SMS bundle uses a named temporary no-headroom
   2,789,740-byte exception. The Pingram source delta is 12,759 bytes in both
   identical-profile comparisons against released `v0.7.0` main; the
   extrapolated ceiling still needs exact-SHA CI confirmation before release,
   and optimization or reviewed clean-main recalibration is required before
   removing it.
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
5. Prepare, but do not yet execute, the Pingram owner-SMS promotion record:
   Secret Manager bindings, exact regional origin, new configuration generation,
   sender/A2P and owner-consent evidence, registered signed endpoint, rollback,
   opt-out-hold proof, and one controlled UAT plan.
6. Run the disposable second-tenant lifecycle and hosted cross-tenant/portal
   denial matrix.
7. Complete the bundle-exception closure path and continue `functions.config()`
   migration planning.

Open work and priority sequencing live in [`DEV_TASKS.md`](DEV_TASKS.md).
Historical shipped changes live in [`CHANGELOG.md`](CHANGELOG.md).
