# Launch Runbook

Last updated: August 3, 2026

## Goal
Deploy QuotePilot safely with environment validation, reproducible build checks, and clear post-launch verification.

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

## 3) Promote a Verified Release

Do not run a primary production deploy from a workstation. After completing
the exact-main evidence sequence in section 6, dispatch one of these protected
workflows from `main`:

- `Deploy Firebase Hosting / Backend`
- `Deploy Vercel Production`

Both workflows accept the full release SHA, exact-SHA CI run id, protected UAT
run id, and target-specific rollback SHA. They check out the immutable dispatch
SHA and the deploy wrapper rejects the run before build or provider access if
the evidence is incomplete, mismatched, stale, or the current environment
policy is unprotected. Current-policy validation does not prove which reviewer
approved the historical UAT run or whether that run was bypassed; close that
evidence gap before live use.

The Firebase entrypoint validates the ignored production Functions
environment, binds Firebase Hosting target `app` to the primary `tonicatering`
site, and deploys `hosting:app` and/or an intentionally enabled `backend`
surface (`firestore,functions`) from the same revision. Do not substitute an
unscoped default Hosting deploy.

For the optional Vercel target, preserve the SPA rewrite in `vercel.json`. Because
`cleanUrls` is enabled, the catch-all destination must be `/` rather than
`/index.html`. Promote only through `Deploy Vercel Production` from the same
published tagged revision.

The Vercel production build runs `check:env` with the production environment
before Vite, so emulator, E2E-auth-bypass, or local-catalog-fallback flags fail
the deployment. After promotion, verify that `/`, `/app`, and `/system` each
return the application shell with HTTP 200.

## 4) Configure CI Variables
Set repository variables/secrets used by deploy workflow:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- optional: `VITE_FIREBASE_FUNCTIONS_REGION`
- `RELEASE_UAT_ATTESTER_IDS`: comma-separated numeric GitHub user ids for the
  approved human UAT attesters; service/bot identities are not accepted
- `FIREBASE_TOKEN` repository or `production` environment secret
- `VERCEL_TOKEN` repository or `production` environment secret

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
   equivalent provider rule) so the protected workflow is the only production
   path. Confirm no alternate Firebase automation bypasses the wrapper.
6. Rehearse the workflow with intentionally invalid evidence and confirm it
   fails before any provider command. Do not treat repository source as proof
   that these external settings are active.
7. Supply provider CLIs from a separately locked, audited, checksum-verified
   release toolchain before live use. The current wrappers still use `npx` as a
   compatibility path; do not expose production credentials to an on-demand
   mutable install. The provider CLIs were intentionally not added to the
   application lockfile because their current dependency trees failed the
   repository audit gate. Split prepare/build/evidence verification from the
   final provider mutation. The fixed final tool must receive the minimum
   provider credential in an isolated environment and must not invoke repository
   code; the current wrapper structure does not provide that isolation.
8. Replace the human-entered staging label and rollback ancestry with
   provider-derived deployment manifests: project/environment, READY status,
   source SHA, artifact and non-secret configuration digests, successful
   deployment id, timestamp, and component-specific last-known-good record.

For intentional Firebase backend deploy windows only:
- Set repository variables:
  - `APP_BASE_URL=https://quotepilot.mbmapps.com/app`
  - `APP_BASE_DOMAIN=mbmapps.com`
  - `NOTIFICATIONS_EMAIL_PROVIDER=none` until Resend is verified
  - `EMAIL_FROM_NAME=QuotePilot by MBMapps`
  - `EMAIL_FROM_EMAIL=onboarding@quotepilot.mbmapps.com`
  - `NOTIFICATIONS_SMS_PROVIDER=none` until Twilio is approved
  - provider sender/owner values only when the matching provider is enabled
- Set repository secrets:
  - `AUTH_PLATFORM_ADMIN_EMAILS`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `RESEND_API_KEY` only when Resend is enabled
  - Twilio account/auth secrets only when Twilio is enabled
- Select `firebase_scope=backend` or `firebase_scope=all` only after the
  matching evidence profile is attested (requires Blaze plan). The `backend`
  scope always deploys Firestore rules and Functions together.
- Confirm `scripts/materialize-functions-env.mjs` validates these values and
  creates the ignored `functions/.env.<firebase-project-id>` file. The
  materializer fails rather than deploying with a missing allowlist, a
  noncanonical owner URL, a different sender identity, missing Stripe secrets,
  or incomplete credentials for an enabled provider; it does not print secret
  values.
- Run the controlled workflow with the exact release evidence inputs.

## 5) Optional Functions (Stripe + Twilio + Resend)
These values are server-only Firebase Functions configuration. The repository
root `.env.example` is a browser-safe `VITE_*` template and must not contain
Stripe, Twilio, or Resend credentials.

Use [`functions/.env.example`](../functions/.env.example) as the Functions
placeholder inventory:

```bash
cp functions/.env.example functions/.env.<firebase-project-id>
git check-ignore -v functions/.env.<firebase-project-id>
```

The second command must report an ignore rule before any credential is added;
if it does not, stop and establish the approved ignore rule first. Credential
fields are intentionally blank. Do not enable a provider until every required
value for that provider has been supplied through an approved secret channel.

Keep the production fail-safe state during custom-domain setup:

```dotenv
NOTIFICATIONS_SMS_PROVIDER=none
NOTIFICATIONS_EMAIL_PROVIDER=none
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

Only after verification, set the ignored Functions environment file to:

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

Deploy the Firebase backend only by dispatching `Deploy Firebase Hosting /
Backend` with `firebase_scope=backend` and a successful `firebase-backend` UAT
attestation. This scope deploys `firestore,functions`. Use
`firebase_scope=all` only with a `firebase-all` attestation.

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

Stripe and Twilio use the corresponding blank fields in
`functions/.env.example`. Stripe has no provider flag in this runtime: its
secret and webhook secret are required before any production backend deploy
because checkout and webhook handlers ship in the same bundle. Keep the Twilio
provider flag at `none` until buyer-owned credentials, sender registration, and
provider acceptance checks are complete.

Stripe webhook endpoint:
- `https://us-central1-tonicatering.cloudfunctions.net/stripeWebhook`
- events:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`

## 6) Candidate UAT and Exact-Main Release Attestation

### 6.1 Pre-Merge UAT (Required for Production-Triggering Merge)

Pass all checks before merging a release-intent PR to `main`. Use the stable
item ids and labels in `docs/release-uat-checklist.json`; changes to that file
change its SHA-256 digest and invalidate older attestations.

1. CI is fully green:
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
   - terminal evidence blocks edit/reopen, sales cannot bypass the exact
     draft-to-sent boundary, and direct quote/portal deletes fail,
   - quote history row appears and opens,
   - customer portal accept/decline path updates state,
   - PDF export succeeds,
   - Integrations Ops setup assistant loads and reports status,
   - SMS test path returns disabled/not configured when
     `NOTIFICATIONS_SMS_PROVIDER=none` without blocking core flow.
3. Confirm rollback target:
   - previous known-good commit SHA is documented,
   - current known-good SHA in `PROJECT_STATUS.md` is ready to update after successful deploy.

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
7. Dispatch the target deploy workflow with `release_sha`, `ci_run_id`,
   `uat_run_id`, and `rollback_sha`; Firebase also requires `firebase_scope`
   matching the attested profile. A protected `production` reviewer must
   approve the deployment. If targets have different rollback SHAs, use
   separate target-specific attestations.

The verifier reads GitHub evidence live at deployment time. A protected
environment configuration error, changed checklist digest, missing job, failed
or skipped job, wrong workflow/repository/SHA, non-ancestor rollback, stale
attestation, or disallowed actor stops promotion before the provider CLI runs.

## 7) Post-Launch Verification
1. Create a quote end-to-end.
2. Confirm quote appears in history.
3. Export PDF proposal.
4. Verify customer portal accept/decline updates.
   - Confirm the public snapshot and organization quote carry the same
     structured decision and timestamp.
   - Confirm a second public request cannot flip an accepted/declined outcome.
5. Validate mobile layout and key interaction flows.

## 8) Rollback
Use the prior known-good commit SHA tracked in `PROJECT_STATUS.md`.

The commands below are a break-glass incident path, not a normal promotion
path. Obtain explicit incident authorization, record the operator, target,
reason, and provider result, and restore the controlled workflow afterward.
The release evidence wrapper intentionally does not delay an authorized
rollback to a known-good revision.

Hosting rollback:
```bash
git checkout <known_good_sha>
npm ci
npm run check:env
npm run build
npx firebase-tools target:apply hosting app tonicatering --project tonicatering
npx firebase-tools deploy --only hosting:app --project tonicatering --non-interactive
```

If a controlled `firebase-backend` or `firebase-all` deploy caused regression:
```bash
git checkout <known_good_sha>
npm ci
npm ci --prefix functions
npm run check:env
npm run build
npx firebase-tools target:apply hosting app tonicatering --project tonicatering
npx firebase-tools deploy --only hosting:app,firestore,functions --project tonicatering --non-interactive
```
