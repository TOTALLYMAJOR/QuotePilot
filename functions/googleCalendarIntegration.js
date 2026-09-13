"use strict";

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes: nodeRandomBytes,
  timingSafeEqual
} = require("node:crypto");

const GOOGLE_CALENDAR_POLICY = Object.freeze({
  schemaVersion: "google-calendar-integration-v1",
  provider: "google_calendar",
  oauthStateVersion: 1,
  tokenEnvelopeVersion: 1,
  eventProjectionVersion: 1,
  maximumEventHours: 72,
  maximumSummaryCharacters: 200,
  maximumLocationCharacters: 500,
  maximumDescriptionCharacters: 1_000,
  oauthStateLifetimeSeconds: 10 * 60,
  scopes: Object.freeze([
    "https://www.googleapis.com/auth/calendar.events.owned"
  ]),
  evidenceBoundary: "One-way, operator-requested projection of one accepted or booked QuotePilot event into an explicitly connected Google Calendar. Provider acceptance is not customer acceptance, event readiness, staffing, inventory, BEO, checklist, payment, or delivery evidence."
});

const COMMAND_KEYS = Object.freeze([
  "organizationId", "quoteId", "requestId", "expectedSyncRevision",
  "expectedConnectionGeneration", "command"
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{19,159}$/;
const OPERATION_ID_PATTERN = /^calendar_operation_[a-f0-9]{48}$/;
const GOOGLE_EVENT_ID_PATTERN = /^[a-v0-9]{5,1024}$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SAFE_REASON_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const CONNECTION_STATES = Object.freeze([
  "unconfigured", "authorizing", "active", "reconnect_required", "revoked", "disabled"
]);
const SYNC_STATES = Object.freeze([
  "not_synced", "queued", "dispatching", "outcome_uncertain", "synced",
  "update_required", "cancel_queued", "canceled", "provider_drift",
  "blocked_connection", "definite_failure"
]);

class GoogleCalendarIntegrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GoogleCalendarIntegrationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new GoogleCalendarIntegrationError(code, message);
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!record(value)
    || Object.keys(value).length !== expected.length
    || expected.some((key) => !Object.hasOwn(value, key))) {
    fail("invalid-argument", `${label} contains missing or unsupported fields.`);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(canonical(value))
  ).digest("hex");
}

const GOOGLE_CALENDAR_POLICY_DIGEST = sha256(GOOGLE_CALENDAR_POLICY);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function planExpiredOAuthRecovery({ connection, attempt, nowISO } = {}) {
  if (!record(connection) || !record(attempt)) {
    fail("data-loss", "The expired Google authorization evidence is incomplete.");
  }
  const nowMs = Date.parse(nowISO);
  const pendingExpiresAtMs = Date.parse(connection.pendingExpiresAtISO);
  const exchangeLeaseCandidates = [
    connection.mutationLeaseExpiresAtISO,
    attempt.exchangeLeaseExpiresAtISO,
    connection.pendingExpiresAtISO
  ].map((value) => Date.parse(value)).filter(Number.isFinite);
  const recoveryExpiresAtMs = ["exchanging", "token_issued"].includes(attempt.state)
    ? Math.max(...exchangeLeaseCandidates)
    : pendingExpiresAtMs;
  if (!Number.isFinite(nowMs) || !Number.isFinite(recoveryExpiresAtMs)) {
    fail("data-loss", "The Google authorization expiry evidence is invalid.");
  }
  if (connection.state !== "authorizing" || recoveryExpiresAtMs > nowMs) {
    return deepFreeze({ action: "none" });
  }
  if (attempt.state === "pending") {
    return deepFreeze({ action: connection.tokenEnvelope ? "restore_prior" : "replace_pending" });
  }
  if (attempt.state === "exchanging") {
    return deepFreeze({ action: "record_exchange_uncertain" });
  }
  if (attempt.state === "token_issued" && record(attempt.tokenEnvelope)) {
    return deepFreeze({
      action: attempt.ownershipVerified === true
        ? "activate_verified_grant"
        : "revoke_unverified_grant"
    });
  }
  fail("data-loss", "The expired Google authorization has no safe recovery transition.");
}

function identifier(value, label, maximum = 256) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum
    || /[\s/?#\\\p{Cc}\p{Cf}]/u.test(value) || value === "." || value === "..") {
    fail("invalid-argument", `${label} must be an exact opaque identifier.`);
  }
  return value;
}

function exactISO(value, label = "timestamp") {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail("invalid-argument", `${label} must be an exact ISO timestamp.`);
  }
  return value;
}

function boundedRevision(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value >= Number.MAX_SAFE_INTEGER) {
    fail("invalid-argument", `${label} must be a bounded integer revision.`);
  }
  return value;
}

function boundedText(value, label, maximum, required = true) {
  if (typeof value !== "string" || value.length > maximum || /[\p{Cc}\p{Cf}]/u.test(value)) {
    fail("invalid-argument", `${label} must be plain text of ${maximum} characters or fewer.`);
  }
  const normalized = value.trim();
  if (required && !normalized) fail("invalid-argument", `${label} is required.`);
  return normalized;
}

function validIanaTimeZone(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 100) {
    fail("failed-precondition", "A tenant IANA time zone is required for Calendar sync.");
  }
  try {
    const normalized = new Intl.DateTimeFormat("en-US", { timeZone: value })
      .resolvedOptions().timeZone;
    if (!normalized) throw new Error("invalid");
    return normalized;
  } catch {
    fail("failed-precondition", "A valid tenant IANA time zone is required for Calendar sync.");
  }
}

function validDateOnly(value) {
  if (typeof value !== "string" || !LOCAL_DATE_PATTERN.test(value)) {
    fail("failed-precondition", "The accepted event requires an exact YYYY-MM-DD date.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    fail("failed-precondition", "The accepted event date is invalid.");
  }
  return value;
}

function validLocalTime(value) {
  if (typeof value !== "string" || !LOCAL_TIME_PATTERN.test(value)) {
    fail("failed-precondition", "The accepted event requires an exact 24-hour start time.");
  }
  return value;
}

function localPartsAt(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function resolveTenantLocalInstant(date, time, timeZone) {
  const requestedDate = validDateOnly(date);
  const requestedTime = validLocalTime(time);
  const zone = validIanaTimeZone(timeZone);
  const wanted = `${requestedDate}T${requestedTime}`;
  const nominal = Date.parse(`${wanted}:00.000Z`);
  const candidates = [];
  for (let offsetMinutes = -18 * 60; offsetMinutes <= 18 * 60; offsetMinutes += 15) {
    const candidate = nominal + offsetMinutes * 60_000;
    if (localPartsAt(candidate, zone) === wanted) candidates.push(candidate);
  }
  if (candidates.length !== 1) {
    fail(
      "failed-precondition",
      candidates.length === 0
        ? "The event start does not exist in the tenant time zone because of a clock change."
        : "The event start is ambiguous in the tenant time zone because of a clock change."
    );
  }
  return candidates[0];
}

function normalizeSyncCommand(input) {
  if (!record(input) || !["sync", "cancel", "reconcile"].includes(input.command)) {
    fail("invalid-argument", "A supported Calendar command is required.");
  }
  const extra = input.command === "sync"
    ? ["expectedSourceVersionId"]
    : input.command === "cancel"
      ? ["expectedBoundSourceVersionId"]
      : ["expectedOperationId"];
  exactKeys(input, [...COMMAND_KEYS, ...extra], "Calendar command");
  const value = {
    organizationId: identifier(input.organizationId, "organizationId"),
    quoteId: identifier(input.quoteId, "quoteId"),
    requestId: input.requestId,
    expectedSyncRevision: boundedRevision(input.expectedSyncRevision, "expectedSyncRevision"),
    expectedConnectionGeneration: boundedRevision(
      input.expectedConnectionGeneration,
      "expectedConnectionGeneration",
      1
    ),
    command: input.command
  };
  if (typeof value.requestId !== "string" || !REQUEST_ID_PATTERN.test(value.requestId)) {
    fail("invalid-argument", "A stable Calendar request identity of 20 to 160 characters is required.");
  }
  if (input.command === "sync") {
    value.expectedSourceVersionId = identifier(input.expectedSourceVersionId, "expectedSourceVersionId");
  } else if (input.command === "cancel") {
    value.expectedBoundSourceVersionId = identifier(
      input.expectedBoundSourceVersionId,
      "expectedBoundSourceVersionId"
    );
  } else {
    if (typeof input.expectedOperationId !== "string"
      || !OPERATION_ID_PATTERN.test(input.expectedOperationId)) {
      fail("invalid-argument", "An exact Calendar operation identity is required for reconciliation.");
    }
    value.expectedOperationId = input.expectedOperationId;
  }
  return deepFreeze(value);
}

function calendarOperationIdFor(request) {
  const value = normalizeSyncCommand(request);
  return `calendar_operation_${sha256({
    organizationId: value.organizationId,
    quoteId: value.quoteId,
    requestId: value.requestId
  }).slice(0, 48)}`;
}

function calendarEventIdFor({ organizationId, quoteId, calendarBindingId } = {}) {
  const refs = {
    organizationId: identifier(organizationId, "organizationId"),
    quoteId: identifier(quoteId, "quoteId")
  };
  // Validate the private binding without allowing a reconnect to create a
  // second provider event for the same QuotePilot event.
  identifier(calendarBindingId, "calendarBindingId");
  const eventId = `qpe${sha256(refs).slice(0, 50)}`;
  if (!GOOGLE_EVENT_ID_PATTERN.test(eventId)) {
    fail("internal", "The deterministic Google Calendar event identity is invalid.");
  }
  return eventId;
}

function acceptedRevisionMatches(receipt, sourceVersionId, portalIssuedAtISO) {
  const receiptRevision = String(receipt?.quoteRevisionId || "").trim();
  return receiptRevision === sourceVersionId
    || (portalIssuedAtISO && receiptRevision === `${sourceVersionId}@${portalIssuedAtISO}`);
}

function buildCanonicalEventProjection(input) {
  exactKeys(input, [
    "organizationId", "quoteId", "sourceVersionId", "quote", "sourceVersion",
    "acceptanceReceipt", "tenantTimeZone", "calendarBindingId"
  ], "Canonical Calendar projection input");
  const organizationId = identifier(input.organizationId, "organizationId");
  const quoteId = identifier(input.quoteId, "quoteId");
  const sourceVersionId = identifier(input.sourceVersionId, "sourceVersionId");
  const quote = record(input.quote) ? input.quote : {};
  const version = record(input.sourceVersion) ? input.sourceVersion : {};
  const receipt = record(input.acceptanceReceipt) ? input.acceptanceReceipt : {};
  const status = String(quote.status || "").trim().toLowerCase();
  const versionId = String(version.versionId || version.id || "").trim();
  const portalIssuedAtISO = String(quote.portalIssuedAtISO || "").trim();
  if (quote.organizationId !== organizationId || String(quote.id || quote.quoteId || "") !== quoteId
    || String(quote.activeVersionId || "") !== sourceVersionId
    || !["accepted", "booked"].includes(status)
    || version.organizationId !== organizationId || version.quoteId !== quoteId
    || versionId !== sourceVersionId
    || receipt.organizationId !== organizationId || receipt.quoteId !== quoteId
    || !acceptedRevisionMatches(receipt, sourceVersionId, portalIssuedAtISO)) {
    fail(
      "failed-precondition",
      "Calendar sync requires one active accepted or booked quote revision with exact acceptance evidence."
    );
  }
  const snapshot = record(version.snapshot) ? version.snapshot : {};
  if (snapshot.organizationId !== organizationId
    || String(snapshot.id || snapshot.quoteId || "") !== quoteId) {
    fail("data-loss", "The accepted quote-version snapshot identity is invalid.");
  }
  const event = record(snapshot.event) ? snapshot.event : {};
  const date = validDateOnly(String(event.date || "").trim());
  const time = validLocalTime(String(event.time || "").trim());
  const timeZone = validIanaTimeZone(input.tenantTimeZone);
  const hours = Number(event.hours);
  const durationMinutes = Math.round(hours * 60);
  if (!Number.isFinite(hours) || !Number.isSafeInteger(durationMinutes)
    || durationMinutes < 15 || durationMinutes > GOOGLE_CALENDAR_POLICY.maximumEventHours * 60) {
    fail("failed-precondition", "The accepted event requires a duration from 15 minutes through 72 hours.");
  }
  const startMs = resolveTenantLocalInstant(date, time, timeZone);
  const endMs = startMs + durationMinutes * 60_000;
  const eventName = boundedText(
    String(event.name || ""),
    "Event name",
    GOOGLE_CALENDAR_POLICY.maximumSummaryCharacters,
    false
  );
  const summary = boundedText(
    eventName || (quote.quoteNumber ? `Catering event ${quote.quoteNumber}` : "Catering event"),
    "Calendar summary",
    GOOGLE_CALENDAR_POLICY.maximumSummaryCharacters
  );
  const venue = boundedText(
    String(event.venue || ""),
    "Venue",
    GOOGLE_CALENDAR_POLICY.maximumLocationCharacters,
    false
  );
  const venueAddress = boundedText(
    String(event.venueAddress || ""),
    "Venue address",
    GOOGLE_CALENDAR_POLICY.maximumLocationCharacters,
    false
  );
  const location = boundedText(
    [venue, venueAddress].filter(Boolean).join(" — ").slice(
      0,
      GOOGLE_CALENDAR_POLICY.maximumLocationCharacters
    ),
    "Calendar location",
    GOOGLE_CALENDAR_POLICY.maximumLocationCharacters
  );
  const quoteNumber = boundedText(String(snapshot.quoteNumber || quote.quoteNumber || ""), "Quote number", 120, false);
  const description = boundedText(
    quoteNumber ? `QuotePilot event ${quoteNumber}` : "QuotePilot catering event",
    "Calendar description",
    GOOGLE_CALENDAR_POLICY.maximumDescriptionCharacters
  );
  const calendarBindingId = identifier(input.calendarBindingId, "calendarBindingId");
  const eventId = calendarEventIdFor({ organizationId, quoteId, calendarBindingId });
  const content = {
    summary,
    description,
    location,
    start: { dateTime: new Date(startMs).toISOString(), timeZone },
    end: { dateTime: new Date(endMs).toISOString(), timeZone },
    transparency: "opaque",
    visibility: "default"
  };
  const payloadSha256 = sha256({
    eventProjectionVersion: GOOGLE_CALENDAR_POLICY.eventProjectionVersion,
    organizationId,
    quoteId,
    sourceVersionId,
    content
  });
  const providerEvent = {
    id: eventId,
    ...content,
    extendedProperties: {
      private: {
        qp_owner: "quotepilot",
        qp_org_hash: sha256(organizationId),
        qp_quote_hash: sha256(quoteId),
        qp_source_hash: sha256(sourceVersionId),
        qp_payload_sha: payloadSha256
      }
    }
  };
  const ownedFieldsSha256 = googleOwnedFieldsSha256(providerEvent);
  return deepFreeze({
    schemaVersion: "google-calendar-event-projection-v1",
    organizationId,
    quoteId,
    sourceVersionId,
    acceptanceReceiptId: identifier(receipt.receiptId, "acceptanceReceiptId"),
    calendarBindingId,
    eventId,
    payloadSha256,
    ownedFieldsSha256,
    durationMinutes,
    providerEvent,
    sendUpdates: "none",
    evidenceBoundary: GOOGLE_CALENDAR_POLICY.evidenceBoundary
  });
}

function secretBuffer(secret, label) {
  const value = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret || ""), "utf8");
  if (value.length < 32) fail("failed-precondition", `${label} must contain at least 32 bytes.`);
  return value;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function createOAuthState({
  organizationId,
  actorUid,
  requestId,
  redirectUri,
  nowISO,
  expiresInSeconds = GOOGLE_CALENDAR_POLICY.oauthStateLifetimeSeconds,
  signingSecret,
  randomBytes = nodeRandomBytes
} = {}) {
  const refs = {
    organizationId: identifier(organizationId, "organizationId"),
    actorUid: identifier(actorUid, "actorUid"),
    requestId: identifier(requestId, "requestId", 160),
    redirectUri: boundedText(String(redirectUri || ""), "OAuth redirect URI", 2_000),
    nowISO: exactISO(nowISO, "OAuth state issue time")
  };
  if (!REQUEST_ID_PATTERN.test(refs.requestId)
    || !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 900) {
    fail("invalid-argument", "OAuth state requires a stable request identity and a 60 to 900 second lifetime.");
  }
  let redirect;
  try {
    redirect = new URL(refs.redirectUri);
    if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash) throw new Error("unsafe");
  } catch {
    fail("invalid-argument", "OAuth redirect URI must be an exact HTTPS endpoint without credentials or a fragment.");
  }
  const secret = secretBuffer(signingSecret, "OAuth state signing secret");
  const nonceBytes = randomBytes(24);
  if (!Buffer.isBuffer(nonceBytes) || nonceBytes.length !== 24) {
    fail("internal", "OAuth state nonce generation failed.");
  }
  const issuedAtSeconds = Math.floor(Date.parse(refs.nowISO) / 1_000);
  const claims = {
    v: GOOGLE_CALENDAR_POLICY.oauthStateVersion,
    aud: "quotepilot_google_calendar_oauth",
    nonce: nonceBytes.toString("base64url"),
    org: sha256(refs.organizationId),
    actor: sha256(refs.actorUid),
    request: sha256(refs.requestId),
    redirect: sha256(redirect.toString()),
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + expiresInSeconds
  };
  const payload = base64url(JSON.stringify(canonical(claims)));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  const state = `${payload}.${signature}`;
  return deepFreeze({
    state,
    stateId: `calendar_oauth_state_${sha256(state).slice(0, 48)}`,
    expiresAtISO: new Date(claims.exp * 1_000).toISOString(),
    claims
  });
}

function verifyOAuthState(state, {
  organizationId,
  actorUid,
  requestId,
  redirectUri,
  nowISO,
  signingSecret
} = {}) {
  if (typeof state !== "string" || state.length < 80 || state.length > 2_000) {
    fail("permission-denied", "Google Calendar authorization state is invalid.");
  }
  const pieces = state.split(".");
  if (pieces.length !== 2 || !pieces.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
    fail("permission-denied", "Google Calendar authorization state is invalid.");
  }
  const secret = secretBuffer(signingSecret, "OAuth state signing secret");
  const expected = createHmac("sha256", secret).update(pieces[0]).digest();
  const supplied = Buffer.from(pieces[1], "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    fail("permission-denied", "Google Calendar authorization state signature is invalid.");
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8"));
  } catch {
    fail("permission-denied", "Google Calendar authorization state payload is invalid.");
  }
  const now = exactISO(nowISO, "OAuth state verification time");
  const expectedClaims = {
    org: sha256(identifier(organizationId, "organizationId")),
    actor: sha256(identifier(actorUid, "actorUid")),
    request: sha256(identifier(requestId, "requestId", 160)),
    redirect: sha256(boundedText(String(redirectUri || ""), "OAuth redirect URI", 2_000))
  };
  if (!record(claims) || claims.v !== GOOGLE_CALENDAR_POLICY.oauthStateVersion
    || claims.aud !== "quotepilot_google_calendar_oauth"
    || typeof claims.nonce !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(claims.nonce)
    || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
    || claims.exp <= claims.iat || claims.exp - claims.iat > 900
    || claims.iat > Math.floor(Date.parse(now) / 1_000) + 30
    || claims.exp < Math.floor(Date.parse(now) / 1_000)
    || Object.entries(expectedClaims).some(([key, value]) => claims[key] !== value)) {
    fail("permission-denied", "Google Calendar authorization state is expired or belongs to another request.");
  }
  return deepFreeze({
    stateId: `calendar_oauth_state_${sha256(state).slice(0, 48)}`,
    issuedAtISO: new Date(claims.iat * 1_000).toISOString(),
    expiresAtISO: new Date(claims.exp * 1_000).toISOString(),
    claims
  });
}

function tokenAad({ organizationId, actorUid, keyVersion }) {
  return Buffer.from(JSON.stringify(canonical({
    schemaVersion: GOOGLE_CALENDAR_POLICY.tokenEnvelopeVersion,
    provider: GOOGLE_CALENDAR_POLICY.provider,
    organizationId: identifier(organizationId, "organizationId"),
    actorUid: identifier(actorUid, "actorUid"),
    keyVersion: identifier(keyVersion, "keyVersion", 80)
  })), "utf8");
}

function exactAesKey(value) {
  const key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value || ""), "base64");
  if (key.length !== 32) fail("failed-precondition", "Calendar token encryption requires an exact 256-bit key.");
  return key;
}

function encryptRefreshToken({
  refreshToken,
  organizationId,
  actorUid,
  keyVersion,
  encryptionKey,
  randomBytes = nodeRandomBytes
} = {}) {
  const token = boundedText(String(refreshToken || ""), "Google refresh token", 4_096);
  const key = exactAesKey(encryptionKey);
  const iv = randomBytes(12);
  if (!Buffer.isBuffer(iv) || iv.length !== 12) fail("internal", "Calendar token IV generation failed.");
  const aad = tokenAad({ organizationId, actorUid, keyVersion });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return deepFreeze({
    schemaVersion: GOOGLE_CALENDAR_POLICY.tokenEnvelopeVersion,
    algorithm: "A256GCM",
    keyVersion,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    aadSha256: sha256(aad)
  });
}

function decryptRefreshToken({ envelope, organizationId, actorUid, encryptionKey } = {}) {
  exactKeys(envelope, [
    "schemaVersion", "algorithm", "keyVersion", "iv", "ciphertext", "authTag", "aadSha256"
  ], "Calendar token envelope");
  if (envelope.schemaVersion !== GOOGLE_CALENDAR_POLICY.tokenEnvelopeVersion
    || envelope.algorithm !== "A256GCM") {
    fail("data-loss", "Calendar token envelope policy is invalid.");
  }
  const key = exactAesKey(encryptionKey);
  const aad = tokenAad({ organizationId, actorUid, keyVersion: envelope.keyVersion });
  if (sha256(aad) !== envelope.aadSha256) fail("permission-denied", "Calendar token binding does not match.");
  try {
    const iv = Buffer.from(envelope.iv, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length < 1) throw new Error("shape");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return boundedText(plaintext, "Google refresh token", 4_096);
  } catch (error) {
    if (error instanceof GoogleCalendarIntegrationError) throw error;
    fail("data-loss", "Calendar token envelope authentication failed.");
  }
}

function normalizeProviderReason(value) {
  const reason = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "").slice(0, 80);
  return SAFE_REASON_PATTERN.test(reason) ? reason : "provider_response_unclassified";
}

function classifyProviderResponse({
  operation,
  httpStatus = 0,
  providerReason = "",
  networkError = false,
  hasExpectedEventId = false,
  hasEtag = false
} = {}) {
  if (!["insert", "update", "cancel", "reconcile"].includes(operation)) {
    fail("invalid-argument", "A supported Calendar provider operation is required.");
  }
  const status = Number(httpStatus);
  const reason = normalizeProviderReason(providerReason);
  if (networkError === true || status === 408 || status === 429 || status >= 500
    || (status === 403 && /rate|quota|usage/.test(reason))) {
    return deepFreeze({ state: "outcome_uncertain", reasonCode: networkError ? "provider_network_error" : `provider_${status || "unknown"}_${reason}`, retrySafe: false, reconcileRequired: true });
  }
  if (status === 401) {
    return deepFreeze({ state: "reconnect_required", reasonCode: "provider_credentials_rejected", retrySafe: false, reconcileRequired: false });
  }
  if (status === 409) {
    return deepFreeze({ state: "outcome_uncertain", reasonCode: "provider_duplicate_requires_reconciliation", retrySafe: false, reconcileRequired: true });
  }
  if (status === 412) {
    return deepFreeze({ state: "provider_drift", reasonCode: "provider_etag_conflict", retrySafe: false, reconcileRequired: true });
  }
  if ((status === 404 || status === 410) && operation === "cancel") {
    return deepFreeze({ state: "provider_absent", reasonCode: "provider_event_already_absent", retrySafe: false, reconcileRequired: false });
  }
  if ((status === 404 || status === 410) && ["update", "reconcile"].includes(operation)) {
    return deepFreeze({ state: "provider_drift", reasonCode: "provider_event_missing", retrySafe: false, reconcileRequired: false });
  }
  if (status >= 200 && status <= 299) {
    if (operation === "cancel" || (operation === "reconcile" && !hasExpectedEventId)) {
      return deepFreeze({ state: operation === "cancel" ? "provider_absent" : "provider_drift", reasonCode: operation === "cancel" ? "provider_cancellation_accepted" : "provider_identity_mismatch", retrySafe: false, reconcileRequired: false });
    }
    if (!hasExpectedEventId || !hasEtag) {
      return deepFreeze({ state: "outcome_uncertain", reasonCode: "provider_success_evidence_incomplete", retrySafe: false, reconcileRequired: true });
    }
    return deepFreeze({ state: "provider_accepted", reasonCode: "provider_event_verified", retrySafe: false, reconcileRequired: false });
  }
  if (status >= 400 && status <= 499) {
    return deepFreeze({ state: "definite_failure", reasonCode: `provider_${status}_${reason}`, retrySafe: true, reconcileRequired: false });
  }
  return deepFreeze({ state: "outcome_uncertain", reasonCode: "provider_response_missing", retrySafe: false, reconcileRequired: true });
}

function providerOwnedFields(value) {
  const source = record(value) ? value : {};
  const interval = (entry) => ({
    date: typeof entry?.date === "string" ? entry.date : "",
    dateTime: typeof entry?.dateTime === "string" ? entry.dateTime : "",
    timeZone: typeof entry?.timeZone === "string" ? entry.timeZone : ""
  });
  const privateProperties = record(source.extendedProperties?.private)
    ? Object.fromEntries(Object.entries(source.extendedProperties.private)
      .filter(([key, value]) => typeof key === "string" && typeof value === "string")
      .sort(([left], [right]) => left.localeCompare(right)))
    : {};
  return {
    summary: typeof source.summary === "string" ? source.summary : "",
    description: typeof source.description === "string" ? source.description : "",
    location: typeof source.location === "string" ? source.location : "",
    start: interval(source.start),
    end: interval(source.end),
    transparency: typeof source.transparency === "string" ? source.transparency : "",
    visibility: typeof source.visibility === "string" ? source.visibility : "",
    extendedProperties: { private: privateProperties }
  };
}

function googleOwnedFieldsSha256(value) {
  return sha256(providerOwnedFields(value));
}

function safeGoogleCalendarHtmlLink(value) {
  if (typeof value !== "string" || value.length > 2_000) return "";
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const keys = [...parsed.searchParams.keys()];
    const eid = parsed.searchParams.get("eid") || "";
    const approved = parsed.protocol === "https:"
      && !parsed.username && !parsed.password && !parsed.hash
      && ["calendar.google.com", "www.google.com"].includes(host)
      && parsed.pathname === "/calendar/event"
      && keys.length === 1 && keys[0] === "eid"
      && /^[A-Za-z0-9_-]{1,2048}$/u.test(eid);
    return approved ? parsed.toString() : "";
  } catch {
    return "";
  }
}

async function executeProviderRequest({
  fetchImpl,
  accessToken,
  calendarId,
  operation,
  eventId,
  providerEvent = null,
  etag = ""
} = {}) {
  if (typeof fetchImpl !== "function") fail("failed-precondition", "A server-only Calendar transport is required.");
  const token = boundedText(String(accessToken || ""), "Calendar access token", 8_192);
  const calendar = boundedText(String(calendarId || ""), "Google calendar identity", 1_024);
  if (!["insert", "update", "cancel", "reconcile"].includes(operation)
    || !GOOGLE_EVENT_ID_PATTERN.test(String(eventId || ""))) {
    fail("invalid-argument", "Calendar provider request identity is invalid.");
  }
  if (["insert", "update"].includes(operation) && !record(providerEvent)) {
    fail("invalid-argument", "Calendar insert or update requires a canonical provider event.");
  }
  if (["update", "cancel"].includes(operation) && !String(etag || "").trim()) {
    fail("failed-precondition", "Calendar update or cancellation requires the last verified provider etag.");
  }
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events`;
  const url = operation === "insert"
    ? `${base}?sendUpdates=none`
    : `${base}/${encodeURIComponent(eventId)}${["update", "cancel"].includes(operation) ? "?sendUpdates=none" : ""}`;
  const method = { insert: "POST", update: "PATCH", cancel: "DELETE", reconcile: "GET" }[operation];
  const requestEvent = operation === "update"
    ? Object.fromEntries(Object.entries(providerEvent).filter(([key]) => key !== "id"))
    : providerEvent;
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(["insert", "update"].includes(operation) ? { "Content-Type": "application/json" } : {}),
        ...(["update", "cancel"].includes(operation) ? { "If-Match": String(etag).trim() } : {})
      },
      ...(["insert", "update"].includes(operation)
        ? { body: JSON.stringify(requestEvent) }
        : {})
    });
  } catch {
    return deepFreeze({
      outcome: classifyProviderResponse({ operation, networkError: true }),
      provider: {
        eventId: "",
        etag: "",
        ownedFieldsSha256: "",
        htmlLink: "",
        updatedAtISO: ""
      }
    });
  }
  let payload = null;
  try {
    payload = typeof response?.json === "function" ? await response.json() : null;
  } catch {
    payload = null;
  }
  const status = Number(response?.status) || 0;
  const returnedEventId = String(payload?.id || "").trim();
  const returnedEtag = String(payload?.etag || response?.headers?.get?.("etag") || "").trim();
  const returnedOwnedFieldsSha256 = returnedEventId
    ? googleOwnedFieldsSha256(payload)
    : "";
  let outcome = classifyProviderResponse({
    operation,
    httpStatus: status,
    providerReason: payload?.error?.errors?.[0]?.reason || payload?.error?.status || "",
    hasExpectedEventId: returnedEventId === eventId,
    hasEtag: Boolean(returnedEtag)
  });
  if (outcome.state === "provider_accepted" && ["insert", "update"].includes(operation)
    && returnedOwnedFieldsSha256 !== googleOwnedFieldsSha256(providerEvent)) {
    outcome = deepFreeze({
      state: "provider_drift",
      reasonCode: "provider_owned_fields_mismatch",
      retrySafe: false,
      reconcileRequired: true
    });
  }
  return deepFreeze({
    outcome,
    provider: outcome.state === "provider_accepted"
      ? {
        eventId: returnedEventId,
        etag: returnedEtag,
        ownedFieldsSha256: returnedOwnedFieldsSha256,
        htmlLink: safeGoogleCalendarHtmlLink(payload?.htmlLink),
        updatedAtISO: typeof payload?.updated === "string" && Number.isFinite(Date.parse(payload.updated))
          ? new Date(payload.updated).toISOString()
          : ""
      }
      : { eventId: "", etag: "", ownedFieldsSha256: "", htmlLink: "", updatedAtISO: "" }
  });
}

function projectStaffStatus({ connection = null, sync = null, activeSourceVersionId = "" } = {}) {
  const connectionState = CONNECTION_STATES.includes(connection?.state)
    ? connection.state
    : "unconfigured";
  const syncState = SYNC_STATES.includes(sync?.state) ? sync.state : "not_synced";
  const activeRevision = activeSourceVersionId
    ? identifier(activeSourceVersionId, "activeSourceVersionId")
    : "";
  const sourceVersionId = sync?.sourceVersionId
    ? identifier(sync.sourceVersionId, "sourceVersionId")
    : "";
  const connectionGeneration = Number.isSafeInteger(connection?.configurationGeneration)
    && connection.configurationGeneration >= 0
    ? connection.configurationGeneration : 0;
  const syncConnectionGeneration = Number.isSafeInteger(sync?.connectionGeneration)
    && sync.connectionGeneration >= 0
    ? sync.connectionGeneration : 0;
  const generationMismatch = connectionState === "active"
    && !["not_synced", "canceled"].includes(syncState)
    && connectionGeneration > 0
    && syncConnectionGeneration !== connectionGeneration;
  const effectiveState = generationMismatch
    ? "provider_drift"
    : syncState === "synced" && activeRevision && sourceVersionId !== activeRevision
      ? "update_required"
      : connectionState !== "active" && !["not_synced", "canceled"].includes(syncState)
        ? "blocked_connection"
        : syncState;
  const reasonCode = generationMismatch
    ? "calendar_connection_generation_changed"
    : effectiveState === "update_required"
    ? "quote_revision_changed"
    : effectiveState === "blocked_connection"
      ? "calendar_connection_unavailable"
      : SAFE_REASON_PATTERN.test(String(sync?.reasonCode || "")) ? sync.reasonCode : "";
  const recoveryAction = {
    update_required: "sync_current_revision",
    outcome_uncertain: "reconcile_exact_operation",
    provider_drift: generationMismatch ? "reconcile_exact_operation" : "review_provider_event",
    blocked_connection: "reconnect_calendar",
    definite_failure: "correct_and_retry"
  }[effectiveState] || "";
  return deepFreeze({
    schemaVersion: "google-calendar-staff-status-v1",
    connection: {
      state: connectionState,
      connectionRevision: Number.isSafeInteger(connection?.connectionRevision)
        ? connection.connectionRevision : 0,
      configurationGeneration: connectionGeneration,
      calendarLabel: boundedText(String(connection?.calendarLabel || ""), "Calendar label", 120, false)
    },
    sync: {
      state: effectiveState,
      syncRevision: Number.isSafeInteger(sync?.syncRevision) ? sync.syncRevision : 0,
      connectionGeneration: syncConnectionGeneration,
      sourceVersionId,
      activeSourceVersionId: activeRevision,
      reasonCode,
      recoveryAction,
      lastVerifiedAtISO: typeof sync?.lastVerifiedAtISO === "string"
        && Number.isFinite(Date.parse(sync.lastVerifiedAtISO))
        ? new Date(sync.lastVerifiedAtISO).toISOString() : ""
    },
    evidenceBoundary: GOOGLE_CALENDAR_POLICY.evidenceBoundary
  });
}

module.exports = {
  GoogleCalendarIntegrationError,
  GOOGLE_CALENDAR_POLICY,
  GOOGLE_CALENDAR_POLICY_DIGEST,
  sha256,
  normalizeSyncCommand,
  calendarOperationIdFor,
  calendarEventIdFor,
  resolveTenantLocalInstant,
  buildCanonicalEventProjection,
  createOAuthState,
  verifyOAuthState,
  encryptRefreshToken,
  decryptRefreshToken,
  classifyProviderResponse,
  googleOwnedFieldsSha256,
  safeGoogleCalendarHtmlLink,
  executeProviderRequest,
  planExpiredOAuthRecovery,
  projectStaffStatus
};
