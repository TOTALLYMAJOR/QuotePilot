# Launch Runbook

Last updated: August 3, 2026

## Goal
Prepare, promote, and verify QuotePilot safely with isolated credentials,
target-scoped payloads, deterministic manifests, and clear post-launch evidence.

## 1) Prepare Firebase
1. Create/select Firebase project.
2. Enable Firestore Database.
3. Create Firebase Web App and capture `VITE_FIREBASE_*` values.
4. Enable Authentication providers needed by staff (`Email/Password`, `Google`).

## 2) Configure Local Environment
1. Copy `.env.example` to `.env`.
2. Set required values:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
3. Validate and build:
```bash
npm run check:env
npm run build
```

## 3) Prepare a Verified Release Artifact

Do not run a primary production deploy from a workstation. After completing
the exact-main evidence sequence in section 6, dispatch one of these
policy-enforcing, prepare-only workflows from `main`:

- `Prepare Firebase Production Artifact`
- `Prepare Vercel Production Artifact`

Both workflows accept the full release SHA, exact-SHA CI run id, environment-gated UAT
run id, and target-specific rollback SHA. They check out the immutable dispatch
SHA and reject the run before dependency execution when evidence is incomplete,
mismatched, stale, or the current environment policy is unprotected. The
verifier also queries the exact UAT workflow run's historical GitHub deployment
review log and requires exactly one `APPROVED` review for `production-uat` by a
current directly assigned user reviewer other than the attester. It also queries
the exact preparation run and requires one `production` approval by a current
direct reviewer other than both the dispatcher and UAT attester.

Preparation runs tests and production configuration checks, builds only the
selected target surface, stages an explicit payload, hashes every payload file,
and uploads a deterministic manifest bound to the release evidence and fixed
provider identifiers. Provider mutation credentials and Functions runtime
secrets are deliberately absent. These workflows do not call Firebase or
Vercel and do not change production.

Production promotion remains blocked until a separately owned trusted deployer
can download the artifact, independently revalidate the GitHub run and artifact
identity/digest, repository, SHA, both review records, UAT, every payload file
against the manifest, allowed paths, provider project, and rollback record, and
perform only the final provider mutation with a locked audited client. The
trusted deployer must then record provider acceptance/READY state and the new
target-specific last-known-good receipt.

For Vercel, preserve the reviewed SPA contract in `vercel.json`. Preparation
validates that source contract and generates `.vercel/output/config.json` with
filesystem-first routing, the security headers, and an `/index.html` SPA
fallback so the exact payload can be promoted with `vercel deploy --prebuilt` by
the trusted deployer. After
an independently controlled promotion, verify that `/`, `/app`, and `/system`
each return the application shell with HTTP 200.

## 4) Configure CI Variables
Set repository or environment variables used by the prepare workflows:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- optional: `VITE_FIREBASE_FUNCTIONS_REGION`
- `RELEASE_UAT_ATTESTER_IDS`: comma-separated numeric GitHub user ids for the
  approved human UAT attesters; service/bot identities are not accepted

Do not expose `FIREBASE_TOKEN`, `VERCEL_TOKEN`, Stripe, Twilio, Resend, or
platform-admin secrets to either prepare workflow. Provider credentials belong
only in the independently owned trusted deployer.

Configure the external release controls before the first promotion:

1. Protect `main` with required `CI Quality` checks and pull-request review.
2. Create `production-uat` and `production` GitHub environments. For both,
   require an independent reviewer, enable prevention of self-review, and
   restrict deployment branches to protected branches. Disable administrator
   bypass of protection rules.
3. Ensure at least one required environment reviewer is not an approved UAT
   attester and is not the workflow dispatcher.
4. Confirm the GitHub plan and repository ownership support required reviewers
   for this private repository. If they do not, stop and transfer/upgrade the
   repository or install a separately owned deployment protection gate; do not
   weaken the verifier.
5. Disable Vercel automatic production promotion from Git pushes (or apply an
   equivalent provider rule) so the separately owned trusted deployer is the
   only production mutation path. Confirm no alternate Firebase automation or
   customer-site helper bypasses that boundary.
6. Rehearse the prepare workflow with intentionally invalid evidence and
   confirm it fails before dependency execution or artifact upload. Do not
   treat repository source as proof that these external settings are active.
7. Implement the separately owned trusted deployer before live use. It must use
   a locked, audited, checksum-verified provider client, receive only the
   minimum provider credential in an isolated environment, and never invoke
   repository code while that credential is present. The repository's legacy
   primary deploy commands now fail closed instead of calling `npx`.
8. Replace the human-entered staging label and rollback ancestry with
   provider-derived deployment manifests: project/environment, READY status,
   source SHA, artifact and non-secret configuration digests, successful
   deployment id, timestamp, and component-specific last-known-good record.

For intentional Firebase backend promotion windows only, configure these
values in the trusted deployer's approved runtime-configuration and secret
channels, not in the prepare job:
- Set trusted runtime configuration:
  - `APP_BASE_URL=https://quotepilot.mbmapps.com/app`
  - `APP_BASE_DOMAIN=mbmapps.com`
  - `NOTIFICATIONS_EMAIL_PROVIDER=none` until Resend is verified
  - `EMAIL_FROM_NAME=QuotePilot by MBMapps`
  - `EMAIL_FROM_EMAIL=onboarding@quotepilot.mbmapps.com`
  - `NOTIFICATIONS_SMS_PROVIDER=none` until Twilio is approved
  - `STRIPE_MODE=live` for an authorized production runtime; use `test` only in
    an isolated hosted acceptance environment
  - provider sender/owner values only when the matching provider is enabled
- Set trusted runtime secrets:
  - `AUTH_PLATFORM_ADMIN_EMAILS`
  - `STRIPE_SECRET_KEY` (secret or restricted key prefix must match
    `STRIPE_MODE`)
  - `STRIPE_WEBHOOK_SECRET`
  - `RESEND_API_KEY` only when Resend is enabled
  - Twilio account/auth secrets only when Twilio is enabled
- Select `firebase_scope=backend` or `firebase_scope=all` only after the
  matching evidence profile is attested (requires Blaze plan). The `backend`
  artifact and any eventual promotion always include Firestore rules and
  Functions together.
- The prepare artifact intentionally excludes every `.env` file and all
  provider secrets. The trusted deployer must validate and materialize runtime
  configuration only inside its credential-isolated boundary.
- Run the prepare workflow with the exact release evidence inputs, then provide
  its immutable artifact to the trusted deployer.

## 5) Functions Runtime Configuration (Optional Stripe + Twilio + Resend Providers)
These values are server-only Firebase Functions configuration. The repository
root `.env.example` is a browser-safe `VITE_*` template and must not contain
Stripe, Twilio, or Resend credentials.

Use [`functions/.env.example`](../functions/.env.example) as the Functions
placeholder inventory for local/emulator validation only:

```bash
cp functions/.env.example functions/.env.<firebase-project-id>
git check-ignore -v functions/.env.<firebase-project-id>
```

The second command must report an ignore rule before any non-production value
is added; if it does not, stop and establish the approved ignore rule first.
Credential fields are intentionally blank. Never put production credentials in
this local file. Do not enable a provider until every required production value
has been supplied through the trusted runtime's approved secret channel.

Keep this fail-safe state in the trusted production runtime during
custom-domain setup (the same values may be used locally for validation):

```dotenv
NOTIFICATIONS_SMS_PROVIDER=none
NOTIFICATIONS_EMAIL_PROVIDER=none
STRIPE_MODE=live
APP_BASE_URL=https://quotepilot.mbmapps.com/app
EMAIL_FROM_NAME=QuotePilot by MBMapps
AUTH_PLATFORM_ADMIN_EMAILS=<approved-platform-operator-email>
```

`APP_BASE_URL` must direct customer owners to the authenticated `/app` route,
not the public marketing page.

Provisioning requires an authenticated admin role document whose email exactly
matches an entry in `AUTH_PLATFORM_ADMIN_EMAILS`, and the Firebase Auth token
must report a verified email. Runtime token claims never elevate or replace the
current role document, and there is no broad cross-org admin switch. Tenant
admins cannot create tenants, change paid entitlements, or run organization
archive/delete operations.

### Resend activation gate

The intended sender is
`QuotePilot by MBMapps <onboarding@quotepilot.mbmapps.com>`. Do not activate or
represent that sender as operational until the `quotepilot.mbmapps.com` sender
domain is verified in the Resend dashboard and the required DNS records are
confirmed at the authoritative DNS provider.

Only after verification, set the trusted runtime configuration to:

```dotenv
NOTIFICATIONS_EMAIL_PROVIDER=resend
EMAIL_FROM_NAME=QuotePilot by MBMapps
EMAIL_FROM_EMAIL=onboarding@quotepilot.mbmapps.com
RESEND_API_KEY=<buyer-owned-resend-api-key>
APP_BASE_URL=https://quotepilot.mbmapps.com/app
```

If verification is incomplete, keep the production custom-domain sender gated
and send the copy-ready onboarding message manually. The recorded
`onboarding@resend.dev` check was performed externally as a manual Resend
dashboard sandbox test; it is not an allowed QuotePilot Functions sender
configuration, customer-ready sender-domain proof, or recipient-inbox proof.

Prepare the Firebase backend only by dispatching `Prepare Firebase Production
Artifact` with `firebase_scope=backend` and a successful `firebase-backend` UAT
attestation. This scope packages `firestore,functions`; it does not deploy them
or alter runtime configuration. Use `firebase_scope=all` only with a
`firebase-all` attestation, then submit the exact artifact and approved runtime
configuration to the separately owned trusted deployer.

After a controlled Resend deployment, send exactly one onboarding test to a
controlled recipient and capture all three proof layers:
1. QuotePilot reports that Resend accepted the request and records the provider
   message id in the provisioning audit.
2. The Resend dashboard records a `delivered` event for that message.
3. The recipient confirms the message arrived with the expected sender name,
   sender address, and `/app` sign-in link.

Configuration presence or an accepted API response alone is not delivery
proof. Keep production customer email disabled if any layer fails.

Buyer setup assistance is also available in-app:
- `Integrations Ops` -> `Buyer Setup Assistant (Optional Twilio)` to check status and send SMS test.

### Stripe activation gate

Stripe and Twilio use the corresponding blank fields in
`functions/.env.example` only as configuration inventory. Stripe has no
enabled/disabled provider flag: it requires explicit `STRIPE_MODE=test|live`,
`STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`. The secret or restricted key
prefix must match the configured mode, and webhook Event plus Checkout Session
`livemode` must match it. Missing or mixed-mode configuration fails closed.
Keep the Twilio provider flag at `none` until buyer-owned credentials, sender
registration, and provider acceptance checks are complete.

Use `STRIPE_MODE=test` only with test credentials in an isolated hosted
acceptance environment. An authorized production runtime must explicitly use
`STRIPE_MODE=live` with a matching live key. Passing source tests, setting
configuration, or receiving an emulator event does not establish either hosted
test-mode or live-mode provider acceptance.

Stripe webhook endpoint:
- `https://us-central1-tonicatering.cloudfunctions.net/stripeWebhook`
- events:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`

The current source candidate handles deposits only. An exact approved payment
scope binds organization, quote revision, portal issuance, customer email,
currency, and deposit amount. The server runs one governed, resumable operation:
it registers a new Session as `prepared` with no browser-readable link, stores
QuotePilot's URL copy in the server-only `privatePaymentDispatches` record, and
submits the payment-request email using an approval-bound provider idempotency
key. Only after email-provider acceptance is durably recorded does one
transaction publish the payment link to the quote and portal and complete the
approval. Direct standalone checkout creation fails closed. Signed events own
payment state, and the admin-only `Reconcile Payment` action re-reads the exact
server-recorded Session without downgrading paid/refunded truth.

Checkout creation and provider email are external calls, so “combined send” is
not an atomic provider/database claim. An ambiguous creation or email outcome
keeps the execution in progress and does not publish a link to the quote or
portal; any known prepared URL remains outside browser-readable app records.
Because an ambiguous email call may still have been accepted externally, retry
the exact approval as the same executing admin so QuotePilot reuses the same
Stripe-creation and email-provider keys. Durable provider acceptance converts
recovery to publication-only and must never send again. A definite email
failure may require a new approval only after the unsent checkout is
neutralized and the private URL cleared. If cleanup cannot be confirmed, keep
the exact execution resumable for retry or provider reconciliation.

Promote this slice only as one exact-revision frontend, Functions, and Firestore
rules rollout. The frontend exposes the combined send and reconciliation
controls, Functions own approval scope/provider calls/webhook transitions, and
rules deny browser payment-evidence writes. A frontend-only or backend-only
promotion is not acceptance of this workflow. The prepare job still does not
deploy or materialize provider secrets; the credential-isolated trusted
deployer must configure the runtime and promote the coordinated artifact.

Provider acceptance must cover, first in hosted test mode and then under a
separate live-mode authorization:

1. An accepted/booked quote with an exact approval creates or safely reuses one
   scoped deposit Session and registers `prepared` state without writing its
   URL to any browser-readable QuotePilot record before provider dispatch.
2. A changed quote revision, portal issuance, recipient, amount, or currency
   invalidates the prior approval.
3. An ambiguous Stripe-creation or email outcome leaves the exact approval
   resumable only for the same executing admin and uses the same Stripe/provider
   identities; a changed actor fails closed. It does not publish the URL to the
   quote/portal or create an independent replacement checkout. Treat external
   email acceptance as unknown until reconciled by the same-key retry.
4. Durable email-provider acceptance precedes quote/portal publication. An
   induced publication interruption resumes without another provider send.
5. A definite provider failure safely neutralizes the unsent Session and clears
   its private URL before requiring a new approval; unresolved cleanup remains
   resumable instead of guessing.
6. The four configured webhook events produce paid, processing, failed, or
   expired results without allowing a late event to downgrade settled truth.
7. `Reconcile Payment` reads the stored Session and either applies provider
   truth or records a review-required result; it is not a manual paid toggle.

Refund initiation/status, dispute handling, and final-balance collection or
reconciliation remain outside this deposit slice. Keep those processes manual
and separately audited until server-authoritative automation is implemented.

## 6) Candidate UAT and Exact-Main Release Attestation

### 6.1 Pre-Merge UAT (Required for Production-Triggering Merge)

Pass all checks before merging a release-intent PR to `main`. Use the stable
item ids and labels in `docs/release-uat-checklist.json`; changes to that file
change its SHA-256 digest and invalidate older attestations.

1. CI is fully green:
   - `Classify Changes + Lane Plan`
   - `lane:quick (Preflight + Secrets)`
   - `lane:core (Unit + Build + Governance + Bundle)`
   - `Docker Build Smoke`
   - `lane:playwright-smoke`
   - `lane:firebase-auth-rules`
   - `lane:authoritative-pricing`
   - `lane:cwv-smoke`
2. Record the exact candidate SHA and immutable candidate deployment id/URL,
   then manually verify the production-critical paths:
   - quote save succeeds,
   - Firebase quote creation is re-priced by the trusted callable and persists
     a draft quote, matching portal snapshot, and initial version,
   - an eligible quote edit is server-repriced and atomically updates the quote
     and portal while adding a version,
   - terminal evidence blocks edit/reopen, generic staff writes cannot claim
     `sent` or `viewed`, and direct quote/portal deletes fail,
   - an admin expiry changes the quote and matching portal atomically, a
     quote-only or portal-only expiry fails, and `Reopen` restores an eligible
     expired record as a draft with a new portal issuance,
   - quote history row appears and opens,
   - provider acceptance for the exact current valid issuance records `sent`
     and activates that portal, while acceptance for an invalid or expired
     issuance is retained as `requires_rotation` with the portal inactive,
   - guarded rotation invalidates the prior issuance and withholds both Copy
     Portal and the PDF portal link until a separate send accepts the new one,
   - an expired definite provider failure starts a fresh delivery generation,
     an ambiguous outcome remains locked for review, and a server-observed
     provider message ID cannot be reconciled as no-send,
   - a quote that expires during unresolved delivery remains visible for review;
     completing reconciliation reloads it into the paired expiry/Reopen path,
   - a legacy portal projection without `deliveryEvidence` stays inactive and
     is recoverable only through an approved resend or truthful provider
     reconciliation,
   - each sensitive action consumes only its exact approved request, writes a
     server-owned organization-scoped outcome audit, and a completed replay
     returns the stored result without executing again,
   - the payment-request approval is invalidated by any change to its quote
     revision, portal issuance, customer email, currency, or deposit amount;
     the valid action privately registers prepared state, durably records
     provider dispatch/acceptance, and only then publishes the payment link,
     while direct checkout creation fails closed,
   - an ambiguous checkout/email outcome resumes the exact approval with the
     same executing admin and provider keys and no quote/portal link; external
     email acceptance remains unknown until same-key retry. Durable provider
     acceptance resumes publication without resending; a definite failure
     neutralizes and clears the unsent checkout before a new approval becomes
     eligible,
   - explicit Stripe mode, key prefix, Event `livemode`, and Session `livemode`
     agree; all four configured Checkout Session events transition provider
     state without downgrading paid/refunded truth, and the same-tenant admin
     reconciliation reads only the server-recorded Session,
   - an accepted quote converts only through the exact approved server action
     to one booked contract with a server-owned contract number and availability
     result; unapproved or mismatched conversion fails closed,
   - as separate source/data-operation acceptance, the tenant-scoped portal
     projection backfill is read-only in dry-run, transactionally rechecks
     apply, leaves foreign, inactive, identity, and commercial-evidence
     conflicts unchanged, and never creates `deliveryEvidence`; this check is
     not evidence for a Hosting, Functions/rules, or Vercel payload,
   - the retired legacy bulk quote purge callable fails closed without mutation
     and its staff control is absent; within a retained organization, permanent
     quote deletion succeeds only one quote at a time through an exact approved
     `delete_quote` request. Separately governed platform-admin teardown of an
     archived organization is outside this per-quote claim,
   - customer portal view and accept/decline paths update their owned state,
   - PDF export succeeds and omits any portal link without current issuance
     evidence,
   - Integrations Ops setup assistant loads and reports status,
   - SMS test path returns disabled/not configured when
     `NOTIFICATIONS_SMS_PROVIDER=none` without blocking core flow.
3. Confirm rollback target:
   - the provider-specific last-known-good deployment receipt and commit SHA
     are documented,
   - that receipt remains unchanged until the replacement deployment is
     provider-accepted and post-launch verification succeeds.

For a tenant-provisioning release, also complete the disposable owner acceptance
checklist in `docs/USER_MANUAL.md`. At minimum, prove verified platform-admin
authority, unverified owner denial, exact-email invitation activation, neutral
blank-catalog setup, package/event/pricing approval, quote save and readback,
signed-out portal acceptance, cross-tenant denial, and exact cleanup. The
emulator matrix in `scripts/provisioning-emulator-acceptance.mjs` is local
evidence only; repeat the customer-visible flow against the exact hosted
release before calling production onboarding seamless.

### 6.2 Exact-Main Attestation and Promotion

After the reviewed PR merges:

1. Record the full current `main` SHA. Wait for the `push`-event `CI Quality`
   run for that exact SHA and confirm all eight named jobs succeeded. Record its
   numeric run id; a PR merge-ref run is not accepted.
2. Exercise the exact main SHA on an immutable non-production deployment and
   record the provider deployment id. The source gate treats this as a human
   attestation; independently confirm the provider maps that id to the exact
   SHA.
3. From the exact main checkout, run `npm run release:uat:digest`. Complete
   every item id in `docs/release-uat-checklist.json` against that deployment.
4. Dispatch `Release UAT Attestation` from `main` with:
   - `release_sha`: the full exact-main SHA,
   - `target`: `firebase-hosting`, `firebase-backend`, `firebase-all`, or
     `vercel`, matching the exact intended production surface,
   - `rollback_sha`: the full target-specific last-known-good ancestor,
   - `staging_id`: the immutable provider deployment id,
   - `checklist_digest`: the printed 64-character digest,
   - `checked_item_ids`: every checklist id exactly once, comma-separated,
   - `confirmation`: `ATTEST UAT <full-release-sha>`.
5. A reviewer other than the attester approves `production-uat`. Record the
   successful workflow run id. Reruns, bot actors, stale receipts, and a UAT run
   started before exact-SHA CI completion are rejected.
6. Create and publish the semantic version tag on that same SHA.
7. Dispatch the target prepare workflow with `release_sha`, `ci_run_id`,
   `uat_run_id`, and `rollback_sha`; Firebase also requires `firebase_scope`
   matching the attested profile. A protected `production` reviewer other than
   both the dispatcher and UAT attester must approve preparation. Download and
   record the resulting uploaded payload,
   release-evidence receipt, and deterministic manifest. If targets have
   different rollback SHAs, use separate target-specific attestations.
8. Only after the separately owned trusted deployer is implemented and
   qualified, submit that exact artifact for final provider mutation. Record
   the provider deployment id, accepted/READY state, and artifact and
   configuration digests, but retain the existing target-specific
   last-known-good receipt.
9. Complete the post-launch verification in section 7. Only after every check
   succeeds, sign the new target-specific last-known-good receipt. On failure,
   keep the prior receipt authoritative and begin the rollback sequence.

The verifier reads GitHub evidence live at preparation time. A protected
environment configuration error, changed checklist digest, missing job, failed
or skipped job, wrong workflow/repository/SHA, non-ancestor rollback, stale
attestation, missing exact-run UAT or production approval,
administrator-bypass setting, or
disallowed actor stops preparation. GitHub's deployment-review object does not
include an approval timestamp or historical environment-policy snapshot, so a
separately owned audit/webhook record is still required for stronger historical
proof.

## 7) Post-Launch Verification

Before testing legacy customer records, run the customer portal projection
backfill as a separately reviewed production-data operation. Projection
backfill may normalize eligible portal data, but it must not create
`deliveryEvidence`, activate a portal, or infer provider acceptance. A legacy
projection that lacks delivery evidence must continue to fail closed and be
recovered through an approved resend or truthful provider reconciliation.
Start with a tenant-scoped dry run and retain its aggregate evidence:

```bash
npm run portal:backfill -- \
  --project tonicatering \
  --organization <organization-id> \
  --dry-run \
  --evidence-out <new-dry-run-evidence-file.json>
```

Resolve all reported identity or commercial-evidence conflicts before apply.
Apply requires Firebase Admin ADC, a new evidence file, and the exact
scope-bound confirmation shown in the README. Do not infer permission to apply
from deployment or merge approval, and never copy portal tokens or customer
data into release evidence.

For a release containing the Stripe deposit slice, retain a separate provider
acceptance record. Exercise the exact coordinated frontend/Functions/rules
revision first against an isolated hosted `STRIPE_MODE=test` runtime with all
four webhook subscriptions. Exercise private prepared state, ambiguous
same-key recovery, publication-only recovery after durable acceptance, and
definite-failure cleanup in that environment. After explicit production
authorization, verify the matching `STRIPE_MODE=live` runtime and capture one
controlled live payment request, provider event, customer payment-state
refresh, and admin reconciliation observation. Redact keys, signatures, portal
tokens, and customer data from evidence. Test-mode success is not live-mode
acceptance, and neither proves refund, dispute, or final-balance automation.

1. Create a quote end-to-end.
2. Confirm quote appears in history.
3. Export the draft PDF and confirm it contains no inactive portal link.
4. Submit the exact saved revision and confirm provider acceptance creates
   current-issuance activation evidence before Copy Portal or the PDF portal
   link becomes available.
5. Rotate the portal and confirm both link surfaces are withheld until the new
   issuance receives a separate provider-accepted send.
6. Expire an eligible nonterminal quote and confirm the quote and public
   projection leave the active portal surface together. Use `Reopen` and confirm
   it returns as a draft with a new portal issuance; the prior token stays
   unusable.
7. Verify customer portal view and accept/decline updates.
   - Confirm the public snapshot and organization quote carry the same
     structured decision and timestamp.
   - Confirm a second public request cannot flip an accepted/declined outcome.
8. Confirm a legacy projection without `deliveryEvidence` stays inactive and
   the recovery path does not fabricate acceptance evidence.
9. Validate mobile layout and key interaction flows.

## 8) Rollback

Rollback is artifact-first and target-specific. A Git ancestor alone is not a
rollback artifact. Before any promotion, preserve a signed last-known-good
receipt containing the provider project and deployment id, source SHA, artifact
and non-secret configuration digests, target surface, and observed healthy
state.

For an incident:

1. Obtain explicit incident authorization and record the operator, target,
   reason, and start time.
2. Select the target's recorded last-known-good provider deployment or exact
   immutable artifact. Do not rebuild it from a Git checkout during the
   incident.
3. Have the separately owned trusted deployer revalidate that receipt and use
   its locked provider client to restore only the affected target. Repository
   scripts and workflows must not receive the provider credential.
4. Prefer provider-native restoration of the previously accepted Hosting or
   Vercel deployment. For Functions or Firestore rules, perform a compatibility
   review before restoring the prior target-specific artifact; do not widen a
   backend incident into an unreviewed `hosting,firestore,functions` mutation.
5. Repeat the post-launch checks, record provider acceptance/READY state and
   health evidence, then close the incident. Keep the prior receipt until the
   restored target is verified.

The separately owned trusted deployer and signed provider-specific
last-known-good receipts are not implemented yet. Until they are, production
promotion and reliable rollback remain release blockers; the legacy local
`npx` commands are not an approved break-glass substitute.
