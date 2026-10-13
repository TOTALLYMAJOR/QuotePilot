# Google Calendar integration authority

Last updated: 2026-09-13 02:54:14 CDT

Status: source/local candidate; default-off; provider and hosted acceptance open.

## Decision

QuotePilot may create one manual, one-way Google Calendar copy for an exact
accepted or booked quote revision. The QuotePilot quote and immutable accepted
version remain authoritative. A Google event is never acceptance, booking,
readiness, staffing, inventory, BEO, checklist, payment, delivery, or completion
evidence.

The familiar interactions are:

1. An organization administrator connects the primary owned calendar in
   **Integrations Ops** through a separate Google web OAuth grant.
2. An administrator opens the focused accepted/booked event in **Operations**
   and deliberately adds or updates its copy.
3. An uncertain provider result locks blind retry and offers reconciliation of
   the exact operation.
4. A provider edit becomes drift; QuotePilot does not overwrite it.
5. **Remove Google Calendar copy** deletes only the external copy. It never
   changes the QuotePilot event or infers cancellation from booking fields.
6. Integrations Ops retains external-copy cleanup actions when an event no
   longer appears in the accepted/booked Calendar. Every retained or uncertain
   copy must be removed or reconciled before the authorization can be revoked.

## Authority and storage

The server reloads the organization-scoped quote, active immutable version, and
private proposal-acceptance receipt. The existing accepted-source verifier must
confirm snapshot digest, tenant, quote, customer, revision, and event-date
identity before projection. The tenant's recorded IANA time zone converts local
date/time; nonexistent or ambiguous daylight-saving wall times fail closed.

Provider state is callable-owned and browser-denied:

- `googleCalendarOAuthStates/{stateId}`: short-lived one-use OAuth attempt and
  encrypted PKCE verifier.
- `organizations/{orgId}/googleCalendarConnections/current`: encrypted refresh
  token, key version, connection generation, revocation state, and the one
  expiring mutation lease shared by OAuth, event dispatch, and disconnect.
- `organizations/{orgId}/googleCalendarEventLinks/{quoteId}`: exact source,
  connection generation, sync revision, safe state, event fingerprint, ETag,
  and last verification.
- `organizations/{orgId}/googleCalendarOperations/{operationId}`: stable request
  and provider-outcome receipt used for replay and reconciliation.

No direct browser read, list, create, update, or delete is permitted for those
records. Access tokens exist only for a single server request. Refresh tokens
are AES-256-GCM encrypted with tenant, original connector actor, and key-version
additional authenticated data. Another current same-tenant administrator may
disconnect by using that stored binding; tokens are never rebound to the new
actor.

## OAuth and release gates

Runtime requires all of the following:

- deployment gate `GOOGLE_CALENDAR_INTEGRATION_ENABLED`;
- trusted tenant setting `googleCalendarIntegrationEnabled=true`;
- exact HTTPS `GOOGLE_CALENDAR_OAUTH_REDIRECT_URI` and
  `GOOGLE_CALENDAR_APP_RETURN_URL`;
- Secret Manager bindings for `GOOGLE_CALENDAR_OAUTH_CLIENT_ID`,
  `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET`,
  `GOOGLE_CALENDAR_OAUTH_STATE_SECRET`, and
  `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`;
- a declared `GOOGLE_CALENDAR_OAUTH_KEY_VERSION`.

The OAuth request uses offline access, PKCE, a ten-minute one-use state bound to
organization/admin/request/callback, and only
`https://www.googleapis.com/auth/calendar.events.owned`. Firebase sign-in and
the CI datastore OAuth credential are unrelated and must not be reused.
Starting another connection cannot replace a stored authorization. The callback
claims the one-use exchange before contacting Google, retains an encrypted
issued token before activating it, and attempts revocation if that durable
retention or owned-calendar verification fails. An unconfirmed token exchange
is recorded as uncertain rather than failed. Before beginning another exchange,
the administrator must review the organization's Google third-party access and
explicitly acknowledge that review in QuotePilot. An issued grant whose
revocation is uncertain remains encrypted and routes through the disconnect
recovery path. Rejected existing credentials must be explicitly disconnected
before a new authorization begins, so one organization never accumulates two
unreconciled stored grants.
An expired pending attempt may be replaced only while its verifier is still
unused. Once an attempt is exchanging or has retained an issued grant, a new
attempt cannot supersede it. **Recover expired Google authorization** converts
an interrupted exchange to explicit unknown outcome, activates only a retained
grant that already passed owned-calendar verification, or routes an unverified
retained grant to revocation-only recovery.
The callback atomically extends the OAuth mutation lease for its bounded token
exchange and verification work. Expiry recovery honors that exchange lease, so
the original authorization-window deadline cannot invalidate an active provider
request or strand a grant that returns moments later. The exchange lease is
longer than the callback's explicit runtime ceiling. A late token whose
revocation is uncertain may still bind only to its exact recovered attempt and
only while no replacement authorization exists; it becomes revocation-only
evidence rather than an active connection.

## Outward data contract

Allowed:

- event title, with quote-number fallback;
- exact start/end and tenant IANA time zone;
- venue/location;
- private hashed QuotePilot ownership, organization, quote, source-revision,
  and payload fingerprints.

Forbidden:

- attendees or invitations;
- customer or staff identity/contact/assignment/availability;
- guest count, menu, dietary/allergy, pricing, payment, note, BEO, checklist,
  Inventory, or Staffing content.

Every mutation uses `sendUpdates=none`. Staff distribution or invitations need
a later independently authorized design.

Event title and venue are free text and may themselves identify a customer even
though QuotePilot sends no separate customer fields. The copy uses Google's
default event visibility, so its visibility follows the sharing policy of the
administrator-selected primary calendar.

## Duplicate, drift, and recovery policy

The provider event ID is stable for organization plus quote, including across
accepted revisions and reconnections. Insert `409`, timeout, rate limit, or
server error becomes `outcome_uncertain`; another mutation is blocked until the
deterministic event ID is reconciled. Update and removal first re-read the event,
compare the last verified owned-field fingerprint, and use the current ETag
with `If-Match`. A `412` or mismatched owned fingerprint becomes
`provider_drift`. A verified missing event completes a removal or makes a
failed publish retry-safe; it never creates a second event implicitly.

Only the invocation that transactionally creates the operation and acquires the
connection lease may call Google. A same-digest replay returns recorded status,
including while dispatch is in progress. OAuth exchange, event dispatch, and
token revocation cannot overlap. Every link is bound to the connection
generation that produced its evidence; an older-generation link becomes drift
instead of appearing current after reconnection. Integrations Ops projects that
same boundary into its retained-copy list and offers an exact operation check,
not a removal, until the older-generation evidence is reconciled.

Disconnect is intentionally last. It is blocked while a verified or uncertain
external copy remains because revoking the token first would remove QuotePilot's
ability to verify or delete that copy. A network-uncertain revocation keeps the
encrypted token, reports uncertainty, and permits only the exact retained
disconnect request to retry, or a newly identified retry fenced against that
recorded uncertain state when the browser receipt is gone. Integrations Ops
shows at most 50 retained copies at once and explicitly reports when more remain.
Rejected retained credentials can be explicitly revoked when no external copy
cleanup remains; reconnection is not the only available exit.

There are two narrow exceptions. A newly issued grant that never passed
calendar ownership verification is revocation-only and cannot safely operate
on prior event copies. A rejected stored credential likewise cannot complete
provider cleanup. QuotePilot permits revoking either unusable grant while prior
copies remain, names the retained-copy result explicitly, and never implies
that those copies were removed. Cleanup then requires a valid reconnection or a
separately verified manual provider action.

Turning off the deployment or tenant publishing gate does not strand a stored
Google grant. When the token-decryption secrets remain configured, Integrations Ops
keeps a narrow **Revoke stored Google access** action. That action revokes only
the credential, retains and names any existing external copies, and cannot add,
update, reconcile, or remove events while the integration is disabled.

## Evidence boundary

Local evidence can prove request/DTO validation, accepted-source verification,
time-zone behavior, payload allowlisting, deterministic identities, OAuth state
and token cryptography, provider classification through an injected transport,
browser-deny rules, UI states, and build/governance checks.

It cannot prove Google OAuth registration or verification, deployed secret
bindings/IAM, refresh-token issuance, a live Calendar insert/update/removal,
hosted callback behavior, production data, recipient behavior, accessibility
with assistive technology, or human acceptance. Those require separate governed
provider and hosted evidence.

## Provider references

- [Create Calendar events and supply stable event IDs](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [Use event resource versions and ETags](https://developers.google.com/workspace/calendar/api/guides/version-resources)
- [Calendar event resource and private extended properties](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Google OAuth web-server flow and offline access](https://developers.google.com/identity/protocols/oauth2/web-server)
- [OAuth credential and token-storage practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Google Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth)
