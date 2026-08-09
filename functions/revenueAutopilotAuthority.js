"use strict";

const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const defaultCoreApi = require("./revenueAutopilot");
const defaultTemplatesApi = require("./revenueAutopilotTemplates");

const REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION = 1;
const REVENUE_AUTOPILOT_POLICY_SCHEMA_VERSION = 1;
const OUTBOUND_KINDS = Object.freeze([
  "quote_follow_up",
  "deposit_reminder",
  "final_balance_reminder",
  "post_event_review_request"
]);
const REQUIRED_OUTBOUND_KINDS = Object.freeze([
  "quote_follow_up",
  "deposit_reminder",
  "final_balance_reminder"
]);
const ALL_KINDS = Object.freeze([...OUTBOUND_KINDS, "unread_customer_reply"]);
const DEFAULT_DAY_OFFSETS = Object.freeze({
  quote_follow_up: Object.freeze([2, 5]),
  deposit_reminder: Object.freeze([1, 3]),
  final_balance_reminder: Object.freeze([14, 7, 3])
});
const REVENUE_AUTOPILOT_AUTHORITY_PROOF_BOUNDARIES = Object.freeze([
  "Configured does not mean globally enabled, provider-ready, scheduled, or sent.",
  "Scheduled or leased work does not prove provider acceptance, delivery, inbox placement, or customer action.",
  "Provider acceptance is distinct from delivery, and delivery is distinct from a customer portal view.",
  "Payment stops require exact verified-webhook or canonical-ledger evidence. This does not establish accounting revenue or recovered revenue.",
  "Post-event review email requires the exact private closeout to remain completed at execution; reopening self-stops the one immutable occurrence.",
  "A verified attribution-window match is temporal association only. Booked value and money received are not accounting revenue or recovered revenue.",
  "Unread-reply attention is based only on the exact latest quote message and a matching staff acknowledgement. Acknowledgement is not proof that message content was rendered or read.",
  "Message bodies, customer email addresses, portal tokens, payment links, provider credentials, and unsubscribe tokens or hashes are excluded from staff projections."
]);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,256}$/;

class RevenueAutopilotAuthorityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "RevenueAutopilotAuthorityError";
    this.code = code;
    if (details) this.details = details;
  }
}

function fail(code, message, details) {
  throw new RevenueAutopilotAuthorityError(code, message, details);
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function identifier(value, label) {
  const candidate = text(value, 256);
  if (!IDENTIFIER_PATTERN.test(candidate) || EMAIL_PATTERN.test(candidate)) {
    fail("invalid-argument", `${label} must be a stable non-email identifier.`);
  }
  return candidate;
}

function optionalIdentifier(value, label) {
  return text(value, 256) ? identifier(value, label) : "";
}

function stableReference(value, label) {
  const candidate = text(value, 256);
  if (!IDENTIFIER_PATTERN.test(candidate)) {
    fail("invalid-argument", `${label} must be a stable reference.`);
  }
  return candidate;
}

function requireISO(value, label) {
  const candidate = text(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(candidate)) {
    fail("invalid-argument", `${label} must be a valid ISO timestamp.`);
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    fail("invalid-argument", `${label} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
}

function optionalISO(value, label) {
  return text(value, 64) ? requireISO(value, label) : "";
}

function requireDate(value, label) {
  const candidate = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    fail("failed-precondition", `${label} must be a valid YYYY-MM-DD date.`);
  }
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    fail("failed-precondition", `${label} must be a valid YYYY-MM-DD date.`);
  }
  return candidate;
}

function addCalendarDays(value, days) {
  const candidate = requireDate(value, "Calendar source date");
  const offset = Number(days);
  if (!Number.isSafeInteger(offset) || Math.abs(offset) > 3660) {
    fail("failed-precondition", "Calendar-day offset is invalid.");
  }
  return new Date(
    Date.parse(`${candidate}T00:00:00.000Z`) + (offset * 86400000)
  ).toISOString().slice(0, 10);
}

function normalizeTimeZone(value, { required = false } = {}) {
  const candidate = text(value, 100);
  if (!candidate && !required) return "";
  try {
    const normalized = new Intl.DateTimeFormat("en-US", { timeZone: candidate })
      .resolvedOptions().timeZone;
    if (normalized) return normalized;
  } catch {
    // Fall through to one stable typed error.
  }
  fail("failed-precondition", "Revenue Autopilot requires an explicit valid tenant IANA time zone.");
}

function normalizeReviewRequestUrl(value, { required = false } = {}) {
  const candidate = String(value ?? "").trim();
  if (!candidate && !required) return "";
  if (!candidate || candidate.length > 2048) {
    fail("invalid-argument", "Post-event review requests require a valid HTTPS review URL.");
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    fail("invalid-argument", "Post-event review requests require a valid HTTPS review URL.");
  }
  const hostname = text(parsed.hostname, 253).toLowerCase().replace(/^\[|\]$/gu, "");
  const privateIpv4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u;
  const privateIpv6 = /^(?:::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/u;
  const unsafeHost = (
    !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || privateIpv4.test(hostname)
    || privateIpv6.test(hostname)
  );
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || (parsed.port && parsed.port !== "443")
    || unsafeHost
  ) {
    fail(
      "invalid-argument",
      "Post-event review requests require a public HTTPS review URL without credentials, fragments, or a nonstandard port."
    );
  }
  return parsed.toString();
}

function nonNegativeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    fail("invalid-argument", `${label} must be a non-negative integer.`);
  }
  return normalized;
}

function assertExactKeys(input, allowed, label) {
  if (!record(input)) fail("invalid-argument", `${label} is required.`);
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    fail(
      "invalid-argument",
      `${label} contains browser-authority fields that are not accepted: ${unexpected.join(", ")}.`
    );
  }
}

function normalizeBoolean(value, label) {
  if (value !== true && value !== false) fail("invalid-argument", `${label} must be explicit.`);
  return value;
}

function normalizeOffsets(value, kind) {
  if (!Array.isArray(value) || !value.length || value.length > 12) {
    fail("failed-precondition", `${kind} requires one to twelve day offsets.`);
  }
  const offsets = [...new Set(value.map(Number))];
  if (offsets.some((entry) => !Number.isSafeInteger(entry) || entry < 0 || entry > 365)) {
    fail("invalid-argument", `${kind} day offsets must be bounded non-negative integers.`);
  }
  const normalized = kind === "final_balance_reminder"
    ? offsets.sort((left, right) => right - left)
    : offsets.sort((left, right) => left - right);
  if (
    kind === "final_balance_reminder"
    && JSON.stringify(normalized) !== JSON.stringify(DEFAULT_DAY_OFFSETS.final_balance_reminder)
  ) {
    fail("failed-precondition", "Final-balance reminders are fixed to event-minus-14/7/3 days in v1.");
  }
  return normalized;
}

function normalizeKindPolicies(input, { strict = true } = {}) {
  const source = record(input) ? input : {};
  if (strict) {
    assertExactKeys(source, ALL_KINDS, "Revenue Autopilot kind policy");
    const missing = [...REQUIRED_OUTBOUND_KINDS, "unread_customer_reply"]
      .filter((kind) => !record(source[kind]));
    if (missing.length) fail("failed-precondition", `Kind policy is missing: ${missing.join(", ")}.`);
  }
  return Object.fromEntries(ALL_KINDS.map((kind) => {
    const lane = record(source[kind]) ? source[kind] : {};
    const singleOccurrence = new Set([
      "unread_customer_reply",
      "post_event_review_request"
    ]).has(kind);
    const allowed = singleOccurrence ? ["enabled"] : ["enabled", "dayOffsets"];
    if (strict && record(source[kind])) assertExactKeys(lane, allowed, `${kind} policy`);
    const enabled = strict && record(source[kind])
      ? normalizeBoolean(lane.enabled, `${kind}.enabled`)
      : lane.enabled === true;
    if (singleOccurrence) return [kind, { enabled }];
    const offsets = strict
      ? normalizeOffsets(lane.dayOffsets, kind)
      : [...DEFAULT_DAY_OFFSETS[kind]];
    return [kind, { enabled, dayOffsets: offsets }];
  }));
}

function normalizeQuietHours(input, { strict = true } = {}) {
  if (!strict && !record(input)) return { enabled: false, start: "21:00", end: "08:00" };
  assertExactKeys(input, ["enabled", "start", "end"], "Quiet-hours policy");
  const enabled = normalizeBoolean(input.enabled, "quietHours.enabled");
  const start = text(input.start, 5);
  const end = text(input.end, 5);
  if (!LOCAL_TIME_PATTERN.test(start) || !LOCAL_TIME_PATTERN.test(end) || start === end) {
    fail("failed-precondition", "Quiet hours require distinct HH:mm start and end values.");
  }
  return { enabled, start, end };
}

function templateApis(dependencies = {}) {
  const api = dependencies.templatesApi || defaultTemplatesApi;
  if (typeof api?.compileRevenueAutopilotTemplate !== "function") {
    fail("failed-precondition", "Revenue Autopilot template compiler is unavailable.");
  }
  return api;
}

function coreApis(dependencies = {}) {
  const api = dependencies.coreApi || defaultCoreApi;
  for (const method of [
    "buildRevenueAutopilotOccurrences",
    "buildRevenueAutopilotScopeKey",
    "planRevenueAutopilotMaterialization"
  ]) {
    if (typeof api?.[method] !== "function") {
      fail("failed-precondition", `Revenue Autopilot core ${method} is unavailable.`);
    }
  }
  return api;
}

function normalizeRevenueAutopilotTemplateSet(input, dependencies = {}) {
  const api = templateApis(dependencies);
  const entries = Array.isArray(input)
    ? input
    : record(input)
      ? Object.entries(input).map(([kind, value]) => ({ ...value, kind: value?.kind || kind }))
      : [];
  if (
    entries.length < REQUIRED_OUTBOUND_KINDS.length
    || entries.length > OUTBOUND_KINDS.length
  ) {
    fail(
      "failed-precondition",
      "Revenue Autopilot requires exactly three lifecycle templates and allows one post-event template."
    );
  }
  const compiled = {};
  for (const entry of entries) {
    let template;
    try {
      template = api.compileRevenueAutopilotTemplate(entry);
    } catch (error) {
      fail(error?.code || "failed-precondition", error?.message || "Revenue Autopilot template is invalid.");
    }
    if (!OUTBOUND_KINDS.includes(template.kind)) {
      fail("invalid-argument", "Only outbound Revenue Autopilot template kinds may be configured.");
    }
    if (compiled[template.kind]) {
      fail("already-exists", `Revenue Autopilot template kind ${template.kind} is duplicated.`);
    }
    compiled[template.kind] = template;
  }
  const missing = REQUIRED_OUTBOUND_KINDS.filter((kind) => !compiled[kind]);
  if (missing.length) fail("failed-precondition", `Revenue Autopilot templates are missing: ${missing.join(", ")}.`);
  return deepFreeze(compiled);
}

function dormantRevenueAutopilotTenantPolicy({ organizationId = "", authorityState = "unconfigured" } = {}) {
  return deepFreeze({
    schemaVersion: REVENUE_AUTOPILOT_POLICY_SCHEMA_VERSION,
    organizationId: organizationId ? identifier(organizationId, "Organization identity") : "",
    authorityState,
    revision: 0,
    policyVersion: "unconfigured-v1",
    enabled: false,
    timeZone: "",
    reviewRequestUrl: "",
    quietHours: { enabled: false, start: "21:00", end: "08:00" },
    maxAttempts: defaultCoreApi.DEFAULT_MAX_ATTEMPTS || 3,
    kinds: normalizeKindPolicies({}, { strict: false }),
    templates: {},
    configuredAtISO: "",
    configuredBy: "",
    lastMutation: null
  });
}

function normalizeLastMutation(input) {
  if (!record(input)) return null;
  const requestId = optionalIdentifier(input.requestId, "Mutation request identity");
  const requestFingerprint = text(input.requestFingerprint, 64).toLowerCase();
  if (!requestId || !/^[a-f0-9]{64}$/.test(requestFingerprint)) return null;
  return { requestId, requestFingerprint };
}

function normalizeRevenueAutopilotTenantPolicy(input, dependencies = {}) {
  if (!record(input) || !Object.keys(input).length) return dormantRevenueAutopilotTenantPolicy();
  const organizationId = optionalIdentifier(input.organizationId, "Organization identity");
  if (Number(input.schemaVersion) !== REVENUE_AUTOPILOT_POLICY_SCHEMA_VERSION) {
    return dormantRevenueAutopilotTenantPolicy({
      organizationId,
      authorityState: "legacy_blocked"
    });
  }
  const authorityState = text(input.authorityState, 32).toLowerCase();
  if (!new Set(["configured", "unconfigured"]).has(authorityState)) {
    fail("failed-precondition", "Revenue Autopilot policy authority state is invalid.");
  }
  if (authorityState === "unconfigured") {
    return dormantRevenueAutopilotTenantPolicy({ organizationId });
  }
  if (!organizationId) fail("failed-precondition", "Configured Revenue Autopilot policy requires an organization.");
  const revision = nonNegativeInteger(input.revision, "Policy revision");
  if (!revision) fail("failed-precondition", "Configured Revenue Autopilot policy requires a positive revision.");
  const maxAttempts = Number(input.maxAttempts);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    fail("failed-precondition", "Revenue Autopilot max attempts must be between one and five.");
  }
  const kinds = normalizeKindPolicies(input.kinds);
  const templates = normalizeRevenueAutopilotTemplateSet(input.templates, dependencies);
  const reviewRequestUrl = normalizeReviewRequestUrl(input.reviewRequestUrl, {
    required: kinds.post_event_review_request.enabled
  });
  if (kinds.post_event_review_request.enabled && !templates.post_event_review_request) {
    fail(
      "failed-precondition",
      "Enabled post-event review email requires its compiled tenant template."
    );
  }
  const configuredAtISO = requireISO(input.configuredAtISO, "Policy configured time");
  const configuredBy = identifier(input.configuredBy, "Policy actor identity");
  return deepFreeze({
    schemaVersion: REVENUE_AUTOPILOT_POLICY_SCHEMA_VERSION,
    organizationId,
    authorityState,
    revision,
    policyVersion: identifier(input.policyVersion || `policy-r${revision}`, "Policy version"),
    enabled: normalizeBoolean(input.enabled, "policy.enabled"),
    timeZone: normalizeTimeZone(input.timeZone, { required: true }),
    reviewRequestUrl,
    quietHours: normalizeQuietHours(input.quietHours),
    maxAttempts,
    kinds,
    templates,
    configuredAtISO,
    configuredBy,
    lastMutation: normalizeLastMutation(input.lastMutation)
  });
}

function normalizeAdminActor(actor, organizationId) {
  if (!record(actor)) fail("unauthenticated", "A server-authenticated staff actor is required.");
  const actorOrganizationId = identifier(actor.organizationId, "Actor organization identity");
  if (actorOrganizationId !== organizationId) {
    fail("permission-denied", "The staff actor is outside the requested organization.");
  }
  if (text(actor.role, 32).toLowerCase() !== "admin") {
    fail("permission-denied", "Revenue Autopilot configuration requires an administrator.");
  }
  return { uid: identifier(actor.uid, "Actor identity"), organizationId, role: "admin" };
}

function normalizeConfigurationRequest(input, dependencies = {}) {
  assertExactKeys(input, [
    "organizationId",
    "requestId",
    "expectedRevision",
    "enabled",
    "timeZone",
    "reviewRequestUrl",
    "quietHours",
    "maxAttempts",
    "kinds",
    "templates"
  ], "Revenue Autopilot configuration request");
  const expectedRevision = nonNegativeInteger(input.expectedRevision, "Expected policy revision");
  const maxAttempts = Number(input.maxAttempts);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    fail("invalid-argument", "Revenue Autopilot max attempts must be between one and five.");
  }
  const kinds = normalizeKindPolicies(input.kinds);
  const templates = normalizeRevenueAutopilotTemplateSet(input.templates, dependencies);
  const reviewRequestUrl = normalizeReviewRequestUrl(input.reviewRequestUrl, {
    required: kinds.post_event_review_request.enabled
  });
  if (kinds.post_event_review_request.enabled && !templates.post_event_review_request) {
    fail(
      "failed-precondition",
      "Enable post-event review email only with its compiled tenant template."
    );
  }
  return deepFreeze({
    organizationId: identifier(input.organizationId, "Organization identity"),
    requestId: identifier(input.requestId, "Configuration request identity"),
    expectedRevision,
    enabled: normalizeBoolean(input.enabled, "enabled"),
    timeZone: normalizeTimeZone(input.timeZone, { required: true }),
    reviewRequestUrl,
    quietHours: normalizeQuietHours(input.quietHours),
    maxAttempts,
    kinds,
    templates
  });
}

function planRevenueAutopilotAdminConfiguration({
  request,
  currentPolicy,
  actor,
  nowISO
} = {}, dependencies = {}) {
  const normalizedRequest = normalizeConfigurationRequest(request, dependencies);
  const normalizedActor = normalizeAdminActor(actor, normalizedRequest.organizationId);
  const now = requireISO(nowISO, "Server configuration time");
  const current = normalizeRevenueAutopilotTenantPolicy(currentPolicy, dependencies);
  if (current.organizationId && current.organizationId !== normalizedRequest.organizationId) {
    fail("permission-denied", "The stored policy belongs to another organization.");
  }
  const requestFingerprint = fingerprint(normalizedRequest);
  if (current.lastMutation?.requestId === normalizedRequest.requestId) {
    if (current.lastMutation.requestFingerprint !== requestFingerprint) {
      fail("already-exists", "Configuration request identity was reused with different content.");
    }
    return deepFreeze({
      idempotent: true,
      policy: current,
      receipt: {
        schemaVersion: REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
        type: "revenue_autopilot_configuration",
        organizationId: current.organizationId,
        requestId: normalizedRequest.requestId,
        requestFingerprint,
        revision: current.revision,
        configuredAtISO: current.configuredAtISO
      }
    });
  }
  if (current.revision !== normalizedRequest.expectedRevision) {
    fail("aborted", "Revenue Autopilot policy changed after this configuration form was loaded.");
  }
  for (const kind of OUTBOUND_KINDS) {
    const prior = current.templates[kind];
    const next = normalizedRequest.templates[kind];
    if (prior && next && prior.version === next.version && prior.fingerprint !== next.fingerprint) {
      fail("already-exists", `${kind} template content changed without a new template version.`);
    }
  }
  const revision = current.revision + 1;
  const policy = normalizeRevenueAutopilotTenantPolicy({
    schemaVersion: REVENUE_AUTOPILOT_POLICY_SCHEMA_VERSION,
    organizationId: normalizedRequest.organizationId,
    authorityState: "configured",
    revision,
    policyVersion: `policy-r${revision}`,
    enabled: normalizedRequest.enabled,
    timeZone: normalizedRequest.timeZone,
    reviewRequestUrl: normalizedRequest.reviewRequestUrl,
    quietHours: normalizedRequest.quietHours,
    maxAttempts: normalizedRequest.maxAttempts,
    kinds: normalizedRequest.kinds,
    templates: normalizedRequest.templates,
    configuredAtISO: now,
    configuredBy: normalizedActor.uid,
    lastMutation: { requestId: normalizedRequest.requestId, requestFingerprint }
  }, dependencies);
  return deepFreeze({
    idempotent: false,
    policy,
    receipt: {
      schemaVersion: REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
      type: "revenue_autopilot_configuration",
      organizationId: policy.organizationId,
      requestId: normalizedRequest.requestId,
      requestFingerprint,
      revision,
      configuredAtISO: now
    }
  });
}

function secretKey(value) {
  const secret = String(value ?? "");
  if (Buffer.byteLength(secret, "utf8") < 32) {
    fail("failed-precondition", "Revenue Autopilot token hashing requires a server secret of at least 32 bytes.");
  }
  return secret;
}

function normalizeEmail(value) {
  const email = text(value, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) fail("failed-precondition", "A normalized customer email is required.");
  return email;
}

function buildRevenueAutopilotRecipientKey({
  organizationId,
  customerId,
  normalizedEmail,
  secret
} = {}) {
  const organization = identifier(organizationId, "Organization identity");
  const customer = identifier(customerId, "Customer identity");
  const email = normalizeEmail(normalizedEmail);
  const digest = createHmac("sha256", secretKey(secret))
    .update(["revenue-autopilot-recipient-v1", organization, customer, email].join("|"))
    .digest("hex");
  return `rar_${digest}`;
}

function hashRevenueAutopilotUnsubscribeToken({ token, organizationId, customerId, secret } = {}) {
  const opaqueToken = String(token ?? "");
  if (!OPAQUE_TOKEN_PATTERN.test(opaqueToken)) {
    fail("invalid-argument", "Unsubscribe tokens must contain at least 256 bits of opaque base64url entropy.");
  }
  const organization = identifier(organizationId, "Organization identity");
  const customer = identifier(customerId, "Customer identity");
  const digest = createHmac("sha256", secretKey(secret))
    .update(["revenue-autopilot-unsubscribe-v1", organization, customer, opaqueToken].join("|"))
    .digest("hex");
  return `rau_${digest}`;
}

function verifyRevenueAutopilotUnsubscribeToken(input = {}) {
  const expected = text(input.storedHash, 68).toLowerCase();
  if (!/^rau_[a-f0-9]{64}$/.test(expected)) return false;
  let actual;
  try {
    actual = hashRevenueAutopilotUnsubscribeToken(input);
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function dormantEmailControls({ organizationId = "", customerId = "", recipientKey = "" } = {}) {
  return deepFreeze({
    schemaVersion: REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
    organizationId,
    customerId,
    recipientKey,
    authorityState: "unconfigured",
    revision: 0,
    consent: { evidenceId: "", channel: "email", state: "unknown", recordedAtISO: "", source: "" },
    subscription: { evidenceId: "", state: "unknown", recordedAtISO: "", source: "" },
    lastMutation: null
  });
}

function normalizeRevenueAutopilotEmailControls(input, scope = {}) {
  const requestedOrganizationId = optionalIdentifier(scope.organizationId, "Organization identity");
  const requestedCustomerId = optionalIdentifier(scope.customerId, "Customer identity");
  const requestedRecipientKey = text(scope.recipientKey, 68);
  if (!record(input) || !Object.keys(input).length) {
    return dormantEmailControls({
      organizationId: requestedOrganizationId,
      customerId: requestedCustomerId,
      recipientKey: requestedRecipientKey
    });
  }
  if (Number(input.schemaVersion) !== REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION) {
    return dormantEmailControls({
      organizationId: requestedOrganizationId,
      customerId: requestedCustomerId,
      recipientKey: requestedRecipientKey
    });
  }
  const organizationId = identifier(input.organizationId, "Organization identity");
  const customerId = identifier(input.customerId, "Customer identity");
  const recipientKey = text(input.recipientKey, 68);
  const authorityState = text(input.authorityState, 32).toLowerCase();
  if (!recipientKey && authorityState !== "configured") {
    if (
      (requestedOrganizationId && organizationId !== requestedOrganizationId)
      || (requestedCustomerId && customerId !== requestedCustomerId)
    ) {
      fail("permission-denied", "Customer email controls are outside the requested recipient scope.");
    }
    return dormantEmailControls({
      organizationId,
      customerId,
      recipientKey: requestedRecipientKey
    });
  }
  if (!/^rar_[a-f0-9]{64}$/.test(recipientKey)) {
    fail("failed-precondition", "Customer email controls require an opaque recipient key.");
  }
  if (
    (requestedOrganizationId && organizationId !== requestedOrganizationId)
    || (requestedCustomerId && customerId !== requestedCustomerId)
    || (requestedRecipientKey && recipientKey !== requestedRecipientKey)
  ) {
    fail("permission-denied", "Customer email controls are outside the requested recipient scope.");
  }
  if (authorityState !== "configured") {
    return dormantEmailControls({ organizationId, customerId, recipientKey });
  }
  const revision = nonNegativeInteger(input.revision, "Email-control revision");
  if (!revision) fail("failed-precondition", "Configured email controls require a positive revision.");
  const consentState = text(input.consent?.state, 32).toLowerCase();
  const subscriptionState = text(input.subscription?.state, 32).toLowerCase();
  if (!new Set(["granted", "revoked"]).has(consentState)) {
    fail("failed-precondition", "Email consent must be granted or revoked.");
  }
  if (!new Set(["subscribed", "unsubscribed"]).has(subscriptionState)) {
    fail("failed-precondition", "Email subscription must be subscribed or unsubscribed.");
  }
  const consent = {
    evidenceId: identifier(input.consent?.evidenceId, "Consent evidence identity"),
    channel: "email",
    state: consentState,
    recordedAtISO: requireISO(input.consent?.recordedAtISO, "Consent evidence time"),
    source: text(input.consent?.source, 64) || "admin_configuration"
  };
  const subscription = {
    evidenceId: identifier(input.subscription?.evidenceId, "Subscription evidence identity"),
    state: subscriptionState,
    recordedAtISO: requireISO(input.subscription?.recordedAtISO, "Subscription evidence time"),
    source: text(input.subscription?.source, 64) || "admin_configuration"
  };
  return deepFreeze({
    schemaVersion: REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
    organizationId,
    customerId,
    recipientKey,
    authorityState,
    revision,
    consent,
    subscription,
    lastMutation: normalizeLastMutation(input.lastMutation)
  });
}

function normalizeEmailControlRequest(input) {
  assertExactKeys(input, [
    "organizationId",
    "customerId",
    "requestId",
    "expectedRevision",
    "consentState",
    "subscriptionState"
  ], "Customer email-control request");
  const consentState = text(input.consentState, 32).toLowerCase();
  const subscriptionState = text(input.subscriptionState, 32).toLowerCase();
  if (!new Set(["granted", "revoked"]).has(consentState)) {
    fail("invalid-argument", "Email consent intent must be granted or revoked.");
  }
  if (!new Set(["subscribed", "unsubscribed"]).has(subscriptionState)) {
    fail("invalid-argument", "Email subscription intent must be subscribed or unsubscribed.");
  }
  if (consentState === "revoked" && subscriptionState === "subscribed") {
    fail("failed-precondition", "A customer cannot remain subscribed after email consent is revoked.");
  }
  return deepFreeze({
    organizationId: identifier(input.organizationId, "Organization identity"),
    customerId: identifier(input.customerId, "Customer identity"),
    requestId: identifier(input.requestId, "Email-control request identity"),
    expectedRevision: nonNegativeInteger(input.expectedRevision, "Expected email-control revision"),
    consentState,
    subscriptionState
  });
}

function planRevenueAutopilotEmailControlUpdate({
  request,
  currentControls,
  customer,
  actor,
  nowISO,
  secret
} = {}) {
  const normalizedRequest = normalizeEmailControlRequest(request);
  const normalizedActor = normalizeAdminActor(actor, normalizedRequest.organizationId);
  const now = requireISO(nowISO, "Server email-control time");
  if (!record(customer)) fail("failed-precondition", "A server-owned customer record is required.");
  const customerOrganizationId = identifier(customer.organizationId, "Customer organization identity");
  const customerId = identifier(customer.id || customer.customerId, "Customer identity");
  if (
    customerOrganizationId !== normalizedRequest.organizationId
    || customerId !== normalizedRequest.customerId
  ) {
    fail("permission-denied", "The customer is outside the requested email-control scope.");
  }
  const recipientKey = buildRevenueAutopilotRecipientKey({
    organizationId: normalizedRequest.organizationId,
    customerId,
    normalizedEmail: customer.normalizedEmail,
    secret
  });
  const current = normalizeRevenueAutopilotEmailControls(currentControls, {
    organizationId: normalizedRequest.organizationId,
    customerId
  });
  if (current.revision > 0 && current.recipientKey !== recipientKey) {
    fail("aborted", "The customer email changed; prior consent cannot be silently migrated.");
  }
  const requestFingerprint = fingerprint(normalizedRequest);
  if (current.lastMutation?.requestId === normalizedRequest.requestId) {
    if (current.lastMutation.requestFingerprint !== requestFingerprint) {
      fail("already-exists", "Email-control request identity was reused with different content.");
    }
    return deepFreeze({ idempotent: true, controls: current, receipt: {
      schemaVersion: REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
      type: "revenue_autopilot_email_controls",
      organizationId: current.organizationId,
      customerId: current.customerId,
      requestId: normalizedRequest.requestId,
      requestFingerprint,
      revision: current.revision,
      recordedAtISO: current.consent.recordedAtISO
    } });
  }
  if (current.revision !== normalizedRequest.expectedRevision) {
    fail("aborted", "Customer email controls changed after this form was loaded.");
  }
  const revision = current.revision + 1;
  const evidenceId = `race_${fingerprint({
    organizationId: normalizedRequest.organizationId,
    customerId,
    requestId: normalizedRequest.requestId,
    revision
  })}`;
  const controls = normalizeRevenueAutopilotEmailControls({
    schemaVersion: REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
    organizationId: normalizedRequest.organizationId,
    customerId,
    recipientKey,
    authorityState: "configured",
    revision,
    consent: {
      evidenceId: `${evidenceId}_consent`,
      channel: "email",
      state: normalizedRequest.consentState,
      recordedAtISO: now,
      source: "admin_configuration"
    },
    subscription: {
      evidenceId: `${evidenceId}_subscription`,
      state: normalizedRequest.subscriptionState,
      recordedAtISO: now,
      source: "admin_configuration"
    },
    lastMutation: { requestId: normalizedRequest.requestId, requestFingerprint }
  }, { organizationId: normalizedRequest.organizationId, customerId, recipientKey });
  return deepFreeze({
    idempotent: false,
    controls,
    receipt: {
      schemaVersion: REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
      type: "revenue_autopilot_email_controls",
      organizationId: controls.organizationId,
      customerId: controls.customerId,
      requestId: normalizedRequest.requestId,
      requestFingerprint,
      revision,
      consentState: controls.consent.state,
      subscriptionState: controls.subscription.state,
      recordedAtISO: now,
      recordedBy: normalizedActor.uid
    }
  });
}

function projectRevenueAutopilotAuthorityForStaff({
  organizationId,
  policy,
  controls = null,
  provider = null,
  suppression = null,
  observedAtISO
} = {}, dependencies = {}) {
  const organization = identifier(organizationId, "Organization identity");
  const normalizedPolicy = normalizeRevenueAutopilotTenantPolicy(policy, dependencies);
  if (normalizedPolicy.organizationId && normalizedPolicy.organizationId !== organization) {
    fail("permission-denied", "Revenue Autopilot policy is outside the staff organization.");
  }
  const normalizedControls = controls
    ? normalizeRevenueAutopilotEmailControls(controls, { organizationId: organization })
    : dormantEmailControls({ organizationId: organization });
  const templateMetadata = Object.fromEntries(OUTBOUND_KINDS.map((kind) => {
    const template = normalizedPolicy.templates[kind];
    return [kind, template ? {
      templateId: template.templateId,
      version: template.version,
      fingerprint: template.fingerprint
    } : null];
  }));
  return deepFreeze({
    schemaVersion: REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
    organizationId: organization,
    observedAtISO: requireISO(observedAtISO, "Authority projection time"),
    policy: {
      authorityState: normalizedPolicy.authorityState,
      revision: normalizedPolicy.revision,
      policyVersion: normalizedPolicy.policyVersion,
      enabled: normalizedPolicy.enabled,
      timeZone: normalizedPolicy.timeZone,
      reviewRequestUrl: normalizedPolicy.reviewRequestUrl,
      quietHours: normalizedPolicy.quietHours,
      maxAttempts: normalizedPolicy.maxAttempts,
      kinds: normalizedPolicy.kinds,
      templates: templateMetadata
    },
    customerControls: {
      authorityState: normalizedControls.authorityState,
      revision: normalizedControls.revision,
      customerId: normalizedControls.customerId,
      consent: {
        state: normalizedControls.consent.state,
        recordedAtISO: normalizedControls.consent.recordedAtISO
      },
      subscription: {
        state: normalizedControls.subscription.state,
        recordedAtISO: normalizedControls.subscription.recordedAtISO
      }
    },
    provider: {
      configured: record(provider) && provider.state === "configured",
      evaluatedAtISO: record(provider) ? optionalISO(provider.evaluatedAtISO, "Provider evidence time") : ""
    },
    suppression: {
      state: record(suppression) && new Set(["clear", "suppressed"]).has(suppression.state)
        ? suppression.state
        : "unknown",
      evaluatedAtISO: record(suppression)
        ? optionalISO(suppression.evaluatedAtISO, "Suppression evidence time")
        : ""
    },
    proofBoundaries: REVENUE_AUTOPILOT_AUTHORITY_PROOF_BOUNDARIES
  });
}

function exactQuoteIdentity(quote, requested) {
  if (!record(quote)) fail("failed-precondition", "A canonical quote record is required.");
  const quoteId = identifier(quote.id || quote.quoteId, "Canonical quote identity");
  const organizationId = identifier(quote.organizationId, "Canonical quote organization");
  const customerId = identifier(quote.customerId, "Canonical quote customer identity");
  if (quoteId !== requested.quoteId || organizationId !== requested.organizationId) {
    fail("permission-denied", "The canonical quote is outside the requested scope.");
  }
  return { quoteId, organizationId, customerId };
}

function exactPortalBinding(quote, canonical, identity) {
  const delivery = record(quote.workflow?.quoteDelivery) ? quote.workflow.quoteDelivery : {};
  const revisionId = stableReference(delivery.revisionId, "Active proposal revision");
  const portalIssuedAtISO = requireISO(delivery.portalIssuedAtISO, "Portal issuance time");
  const providerAcceptedAtISO = requireISO(
    delivery.providerAcceptedAtISO,
    "Provider-bound quote delivery time"
  );
  const activeVersionId = identifier(
    quote.activeVersionId || quote.versionMeta?.versionId,
    "Active quote version"
  );
  if (revisionId !== activeVersionId && revisionId !== `${activeVersionId}@${portalIssuedAtISO}`) {
    fail("aborted", "The active quote version and provider-bound proposal revision conflict.");
  }
  const portal = canonical.portal;
  if (
    !record(portal)
    || text(portal.source, 64).toLowerCase() !== "customer_portal_projection"
    || identifier(portal.organizationId, "Portal organization") !== identity.organizationId
    || identifier(portal.quoteId, "Portal quote") !== identity.quoteId
    || stableReference(portal.revisionId, "Portal revision") !== revisionId
    || requireISO(portal.portalIssuedAtISO, "Portal projection issuance time") !== portalIssuedAtISO
  ) {
    fail("aborted", "The portal projection is not bound to the exact active quote revision.");
  }
  const state = text(portal.state, 32).toLowerCase();
  const status = text(quote.status, 32).toLowerCase();
  if (!new Set(["sent", "viewed", "accepted", "booked", "declined"]).has(state) || status !== state) {
    fail("aborted", "The canonical quote and portal projection states conflict.");
  }
  const stateAtISO = requireISO(portal.stateAtISO, "Portal state time");
  const lifecycleTime = requireISO(quote.lifecycle?.[`${state}AtISO`], "Canonical quote state time");
  if (stateAtISO !== lifecycleTime) fail("aborted", "The portal state timestamp is stale.");
  return {
    revisionId,
    portalIssuedAtISO,
    providerAcceptedAtISO,
    portal: {
      source: "customer_portal_projection",
      organizationId: identity.organizationId,
      quoteId: identity.quoteId,
      revisionId,
      state,
      stateAtISO,
      acceptedAtISO: optionalISO(portal.acceptedAtISO, "Portal acceptance time")
    }
  };
}

function exactAcceptance(canonical, identity, binding) {
  const receipt = canonical.acceptance;
  if (!record(receipt)) fail("failed-precondition", "An exact proposal acceptance receipt is required.");
  const acceptance = {
    source: "proposal_acceptance_receipt",
    organizationId: identifier(receipt.organizationId, "Acceptance organization"),
    quoteId: identifier(receipt.quoteId, "Acceptance quote"),
    revisionId: stableReference(receipt.revisionId || receipt.quoteRevisionId, "Accepted revision"),
    receiptId: identifier(receipt.receiptId, "Acceptance receipt identity"),
    acceptedAtISO: requireISO(receipt.acceptedAtISO, "Acceptance receipt time")
  };
  if (
    acceptance.organizationId !== identity.organizationId
    || acceptance.quoteId !== identity.quoteId
    || acceptance.revisionId !== binding.revisionId
    || acceptance.acceptedAtISO !== binding.portal.acceptedAtISO
  ) {
    fail("aborted", "The proposal acceptance receipt does not match the exact portal revision.");
  }
  return acceptance;
}

function exactPostEventCloseout(
  canonical,
  quote,
  identity,
  binding,
  acceptance,
  policy,
  nowISO
) {
  const source = canonical.postEventCloseout;
  if (!record(source)) {
    fail(
      "failed-precondition",
      "Post-event review email requires the exact private post-event closeout record."
    );
  }
  const activeVersionId = identifier(
    quote.activeVersionId || quote.versionMeta?.versionId,
    "Active quote version"
  );
  const eventDate = requireDate(quote.event?.date, "Canonical event date");
  const bookedAtISO = requireISO(
    quote.booking?.bookedAtISO || quote.lifecycle?.bookedAtISO,
    "Canonical booking time"
  );
  const closeoutId = identifier(source.closeoutId, "Post-event closeout identity");
  const state = text(source.state, 32).toLowerCase();
  const closeoutPolicy = record(source.policy) ? source.policy : {};
  const closeoutPolicyState = text(closeoutPolicy.state, 32).toLowerCase();
  if (
    Number(source.schemaVersion) !== 1
    || identifier(source.organizationId, "Closeout organization") !== identity.organizationId
    || identifier(source.quoteId, "Closeout quote") !== identity.quoteId
    || identifier(source.customerId, "Closeout customer") !== identity.customerId
    || identifier(source.sourceVersionId, "Closeout source version") !== activeVersionId
    || identifier(source.acceptanceReceiptId, "Closeout acceptance receipt") !== acceptance.receiptId
    || requireISO(source.sourceAcceptedAtISO, "Closeout acceptance time") !== acceptance.acceptedAtISO
    || requireISO(source.sourcePortalIssuedAtISO, "Closeout portal issuance") !== binding.portalIssuedAtISO
    || requireISO(source.sourceBookedAtISO, "Closeout booking time") !== bookedAtISO
    || requireDate(source.eventDate, "Closeout event date") !== eventDate
    || requireDate(source.dueDate, "Closeout due date") !== addCalendarDays(eventDate, 7)
    || Number(closeoutPolicy.version) !== 1
    || text(closeoutPolicy.source, 64) !== "organization_settings"
    || Number(closeoutPolicy.offsetDays) !== 7
    || text(closeoutPolicy.dueBoundary, 64) !== "tenant_calendar_date"
    || !new Set(["configured", "blocked_configuration"]).has(closeoutPolicyState)
    || !new Set(["blocked_configuration", "pending", "completed"]).has(state)
  ) {
    fail(
      "aborted",
      "The private post-event closeout no longer matches its booked quote, accepted revision, or due policy."
    );
  }
  if (closeoutPolicyState === "configured") {
    const closeoutTimeZone = normalizeTimeZone(closeoutPolicy.timeZone, { required: true });
    if (closeoutTimeZone !== policy.timeZone || state === "blocked_configuration") {
      fail("aborted", "Post-event closeout time-zone authority conflicts with current tenant policy.");
    }
  } else if (state !== "blocked_configuration") {
    fail("aborted", "A configuration-blocked closeout cannot claim an actionable state.");
  }
  const reviewItems = {};
  for (const code of [
    "internal_closeout",
    "thank_you",
    "review_request",
    "operational_follow_up"
  ]) {
    const item = record(source.reviewItems?.[code]) ? source.reviewItems[code] : {};
    const itemState = text(item.state, 32).toLowerCase();
    if (!new Set(["pending", "reviewed"]).has(itemState)) {
      fail("failed-precondition", `Post-event closeout review item ${code} is invalid.`);
    }
    const reviewedAtISO = optionalISO(item.reviewedAtISO, `${code} review time`);
    if (
      (itemState === "reviewed" && (!reviewedAtISO || !record(item.reviewedBy)))
      || (itemState === "pending" && (reviewedAtISO || item.reviewedBy))
    ) {
      fail("failed-precondition", `Post-event closeout review item ${code} has contradictory evidence.`);
    }
    if (itemState === "reviewed") {
      identifier(item.reviewedBy.uid, `${code} reviewer identity`);
    }
    reviewItems[code] = { state: itemState, reviewedAtISO };
  }
  const allReviewed = Object.values(reviewItems).every((item) => item.state === "reviewed");
  const completedAtISO = optionalISO(source.completedAtISO, "Closeout completion time");
  const updatedAtISO = requireISO(source.updatedAtISO, "Closeout update time");
  const latestReviewAtISO = Object.values(reviewItems)
    .map((item) => item.reviewedAtISO)
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  if (
    updatedAtISO > nowISO
    || completedAtISO > nowISO
    || Object.values(reviewItems).some((item) => item.reviewedAtISO > nowISO)
  ) {
    fail("failed-precondition", "Post-event closeout evidence cannot be future-dated.");
  }
  if (state === "completed") {
    if (
      !allReviewed
      || !completedAtISO
      || !record(source.completedBy)
      || completedAtISO < latestReviewAtISO
      || updatedAtISO < completedAtISO
    ) {
      fail("failed-precondition", "Completed post-event closeout evidence is incomplete.");
    }
    identifier(source.completedBy.uid, "Closeout completion actor");
  } else if (allReviewed || completedAtISO || source.completedBy) {
    fail("failed-precondition", "An incomplete post-event closeout cannot retain completion evidence.");
  }
  return deepFreeze({
    schemaVersion: 1,
    source: "post_event_closeout_authority",
    organizationId: identity.organizationId,
    quoteId: identity.quoteId,
    customerId: identity.customerId,
    revisionId: binding.revisionId,
    closeoutId,
    sourceVersionId: activeVersionId,
    acceptanceReceiptId: acceptance.receiptId,
    eventDate,
    dueDate: addCalendarDays(eventDate, 7),
    state,
    reviewItems,
    completedAtISO,
    completedBy: state === "completed" ? "server_recorded" : "",
    updatedAtISO
  });
}

function exactDeposit(canonical, identity) {
  const source = canonical.deposit;
  if (!record(source)) fail("failed-precondition", "A bounded verified deposit snapshot is required.");
  const state = text(source.state, 32).toLowerCase();
  if (!new Set(["unpaid", "paid", "refunded"]).has(state)) {
    fail("failed-precondition", "Canonical deposit state is invalid.");
  }
  const deposit = {
    source: "verified_provider_webhooks",
    organizationId: identifier(source.organizationId, "Deposit organization"),
    quoteId: identifier(source.quoteId, "Deposit quote"),
    bounded: source.bounded === true,
    observedAtISO: requireISO(source.observedAtISO, "Deposit observation time"),
    state
  };
  if (deposit.organizationId !== identity.organizationId || deposit.quoteId !== identity.quoteId || !deposit.bounded) {
    fail("permission-denied", "Deposit evidence is not an exact bounded snapshot for this quote.");
  }
  if (state !== "unpaid") {
    deposit.signatureVerified = source.signatureVerified === true;
    deposit.processingState = text(source.processingState, 32).toLowerCase();
    deposit.providerReference = identifier(source.providerReference, "Deposit provider reference");
    deposit.processedAtISO = requireISO(source.processedAtISO, "Deposit processed time");
    if (!deposit.signatureVerified || deposit.processingState !== "processed") {
      fail("failed-precondition", "Settled deposit evidence must come from a processed verified webhook.");
    }
  }
  return deposit;
}

function exactFinalBalance(canonical, identity) {
  const source = canonical.finalBalance;
  if (!record(source)) fail("failed-precondition", "An exact final-balance ledger operation is required.");
  const state = text(source.state, 32).toLowerCase();
  if (!new Set(["unpaid", "sent", "processing", "paid", "refunded"]).has(state)) {
    fail("failed-precondition", "Canonical final-balance state is invalid.");
  }
  const finalBalance = {
    source: "canonical_payment_ledger",
    organizationId: identifier(source.organizationId, "Final-balance organization"),
    quoteId: identifier(source.quoteId, "Final-balance quote"),
    operationId: identifier(source.operationId, "Final-balance operation"),
    observedAtISO: requireISO(source.observedAtISO, "Final-balance observation time"),
    state
  };
  if (finalBalance.organizationId !== identity.organizationId || finalBalance.quoteId !== identity.quoteId) {
    fail("permission-denied", "Final-balance evidence is outside this quote scope.");
  }
  if (["paid", "refunded"].includes(state)) {
    finalBalance.providerReference = identifier(source.providerReference, "Final-balance provider reference");
    finalBalance.providerSettledAtISO = requireISO(
      source.providerSettledAtISO,
      "Final-balance settlement time"
    );
  }
  return finalBalance;
}

function exactDeliveryControls({ emailControls, provider, suppression }, identity, nowISO) {
  const recipient = normalizeRevenueAutopilotEmailControls(emailControls, {
    organizationId: identity.organizationId,
    customerId: identity.customerId
  });
  if (recipient.authorityState !== "configured") {
    return { consent: recipient.consent, subscription: recipient.subscription };
  }
  if (
    !record(provider)
    || identifier(provider.organizationId, "Provider organization") !== identity.organizationId
    || !record(suppression)
    || identifier(suppression.organizationId, "Suppression organization") !== identity.organizationId
    || identifier(suppression.customerId, "Suppression customer") !== identity.customerId
    || text(suppression.recipientKey, 68) !== recipient.recipientKey
  ) {
    fail("permission-denied", "Provider or suppression evidence is outside the exact recipient scope.");
  }
  const providerState = text(provider.state, 32).toLowerCase();
  const suppressionState = text(suppression.state, 32).toLowerCase();
  if (!new Set(["configured", "unconfigured"]).has(providerState)) {
    fail("failed-precondition", "Provider configuration evidence state is invalid.");
  }
  if (!new Set(["clear", "suppressed"]).has(suppressionState)) {
    fail("failed-precondition", "Provider suppression evidence state is invalid.");
  }
  const providerEvaluatedAtISO = requireISO(provider.evaluatedAtISO, "Provider evidence time");
  const suppressionEvaluatedAtISO = requireISO(
    suppression.evaluatedAtISO,
    "Suppression evidence time"
  );
  const recipientEvidenceTimes = [
    recipient.consent.recordedAtISO,
    recipient.subscription.recordedAtISO,
    providerEvaluatedAtISO,
    suppressionEvaluatedAtISO
  ].filter(Boolean);
  if (recipientEvidenceTimes.some((value) => value > nowISO)) {
    fail("failed-precondition", "Revenue Autopilot control evidence cannot be future-dated.");
  }
  return {
    consent: recipient.consent,
    subscription: recipient.subscription,
    provider: {
      evidenceId: identifier(provider.evidenceId, "Provider evidence identity"),
      providerId: identifier(provider.providerId, "Provider identity"),
      configurationId: providerState === "configured"
        ? identifier(provider.configurationId, "Provider configuration identity")
        : optionalIdentifier(provider.configurationId, "Provider configuration identity"),
      state: providerState,
      evaluatedAtISO: providerEvaluatedAtISO
    },
    suppression: {
      evidenceId: identifier(suppression.evidenceId, "Suppression evidence identity"),
      state: suppressionState,
      evaluatedAtISO: suppressionEvaluatedAtISO
    }
  };
}

function buildRevenueAutopilotMaterializationInput({
  request,
  canonical,
  policy,
  emailControls,
  provider,
  suppression,
  global,
  existingJobs = []
} = {}, dependencies = {}) {
  assertExactKeys(request, ["organizationId", "quoteId", "kind"], "Revenue Autopilot materialization request");
  const requested = {
    organizationId: identifier(request.organizationId, "Organization identity"),
    quoteId: identifier(request.quoteId, "Quote identity"),
    kind: text(request.kind, 64).toLowerCase()
  };
  if (!OUTBOUND_KINDS.includes(requested.kind)) {
    fail("invalid-argument", "Materialization requires one outbound Revenue Autopilot kind.");
  }
  if (!record(canonical)) fail("failed-precondition", "Server-owned canonical quote evidence is required.");
  const now = requireISO(dependencies.nowISO, "Server materialization time");
  const core = coreApis(dependencies);
  const normalizedPolicy = normalizeRevenueAutopilotTenantPolicy(policy, dependencies);
  if (
    normalizedPolicy.authorityState !== "configured"
    || normalizedPolicy.organizationId !== requested.organizationId
  ) {
    fail("failed-precondition", "A current same-tenant Revenue Autopilot policy is required.");
  }
  const identity = exactQuoteIdentity(canonical.quote, requested);
  const binding = exactPortalBinding(canonical.quote, canonical, identity);
  const controls = exactDeliveryControls({ emailControls, provider, suppression }, identity, now);
  const evidence = { portal: binding.portal };
  const stopScope = {
    organizationId: identity.organizationId,
    quoteId: identity.quoteId,
    revisionId: binding.revisionId
  };
  let occurrenceInput;
  if (requested.kind === "quote_follow_up") {
    occurrenceInput = {
      kind: requested.kind,
      timeZone: normalizedPolicy.timeZone,
      anchorAtISO: binding.providerAcceptedAtISO,
      dayOffsets: normalizedPolicy.kinds[requested.kind].dayOffsets
    };
  } else if (requested.kind === "post_event_review_request") {
    evidence.acceptance = exactAcceptance(canonical, identity, binding);
    evidence.postEventCloseout = exactPostEventCloseout(
      canonical,
      canonical.quote,
      identity,
      binding,
      evidence.acceptance,
      normalizedPolicy,
      now
    );
    stopScope.closeoutId = evidence.postEventCloseout.closeoutId;
    occurrenceInput = {
      kind: requested.kind,
      timeZone: normalizedPolicy.timeZone,
      anchorAtISO: evidence.postEventCloseout.completedAtISO,
      dueDate: evidence.postEventCloseout.dueDate,
      closeoutId: evidence.postEventCloseout.closeoutId
    };
  } else {
    evidence.acceptance = exactAcceptance(canonical, identity, binding);
    evidence.deposit = exactDeposit(canonical, identity);
    if (requested.kind === "deposit_reminder") {
      occurrenceInput = {
        kind: requested.kind,
        timeZone: normalizedPolicy.timeZone,
        anchorAtISO: evidence.acceptance.acceptedAtISO,
        dayOffsets: normalizedPolicy.kinds[requested.kind].dayOffsets
      };
    } else {
      evidence.finalBalance = exactFinalBalance(canonical, identity);
      stopScope.paymentOperationId = evidence.finalBalance.operationId;
      occurrenceInput = {
        kind: requested.kind,
        timeZone: normalizedPolicy.timeZone,
        eventDate: requireDate(canonical.quote.event?.date, "Canonical event date"),
        dayOffsets: normalizedPolicy.kinds[requested.kind].dayOffsets
      };
    }
  }
  const occurrences = core.buildRevenueAutopilotOccurrences(occurrenceInput);
  const scopeKey = core.buildRevenueAutopilotScopeKey({
    kind: requested.kind,
    revisionId: binding.revisionId,
    paymentOperationId: stopScope.paymentOperationId,
    closeoutId: stopScope.closeoutId
  });
  const template = normalizedPolicy.templates[requested.kind];
  if (!template) fail("failed-precondition", "The selected Revenue Autopilot template is unavailable.");
  if (!record(global) || typeof global.enabled !== "boolean" || typeof global.sendsEnabled !== "boolean") {
    fail("failed-precondition", "Server-owned global Revenue Autopilot gates are required.");
  }
  if (!Array.isArray(existingJobs)) fail("invalid-argument", "Existing Revenue Autopilot jobs must be bounded records.");
  return deepFreeze({
    organizationId: identity.organizationId,
    quoteId: identity.quoteId,
    kind: requested.kind,
    scopeKey,
    stopScope,
    evidence,
    global: { enabled: global.enabled, sendsEnabled: global.sendsEnabled },
    tenantPolicy: {
      enabled: normalizedPolicy.enabled,
      timeZone: normalizedPolicy.timeZone,
      quietHours: normalizedPolicy.quietHours,
      maxAttempts: normalizedPolicy.maxAttempts,
      kinds: normalizedPolicy.kinds
    },
    controls,
    occurrences,
    template: {
      templateId: template.templateId,
      version: template.version,
      fingerprint: template.fingerprint
    },
    policyVersion: normalizedPolicy.policyVersion,
    existingJobs: [...existingJobs],
    nowISO: now
  });
}

function planRevenueAutopilotMaterializationFromCanonical(input, dependencies = {}) {
  const core = coreApis(dependencies);
  const materializationInput = buildRevenueAutopilotMaterializationInput(input, dependencies);
  return deepFreeze({
    input: materializationInput,
    plan: core.planRevenueAutopilotMaterialization(materializationInput)
  });
}

function normalizeRevenueAutopilotStaffAcknowledgementRequest(input) {
  assertExactKeys(input, ["organizationId", "quoteId", "messageId", "requestId"], "Staff acknowledgement request");
  return deepFreeze({
    organizationId: identifier(input.organizationId, "Organization identity"),
    quoteId: identifier(input.quoteId, "Quote identity"),
    messageId: identifier(input.messageId, "Conversation message identity"),
    requestId: identifier(input.requestId, "Staff acknowledgement request identity")
  });
}

function normalizeStaffActor(actor, organizationId) {
  if (!record(actor)) fail("unauthenticated", "A server-authenticated staff actor is required.");
  const actorOrganizationId = identifier(actor.organizationId, "Actor organization identity");
  const role = text(actor.role, 32).toLowerCase();
  if (actorOrganizationId !== organizationId || !new Set(["admin", "sales"]).has(role)) {
    fail("permission-denied", "The actor cannot acknowledge customer-reply attention for this organization.");
  }
  return { uid: identifier(actor.uid, "Actor identity"), role, organizationId };
}

function exactConversationFacts({ quote, conversationState, latestMessage }, request) {
  const identity = exactQuoteIdentity(quote, request);
  const summary = quote.conversationSummary;
  if (!record(summary) || !record(conversationState) || !record(latestMessage)) {
    fail("failed-precondition", "Exact quote conversation state and latest message are required.");
  }
  const messageId = identifier(latestMessage.id || latestMessage.messageId, "Latest message identity");
  const messageAtISO = requireISO(latestMessage.createdAtISO || latestMessage.messageAtISO, "Latest message time");
  const actorType = text(latestMessage.actorType, 32).toLowerCase();
  if (!new Set(["staff", "customer"]).has(actorType)) {
    fail("failed-precondition", "Latest conversation actor is invalid.");
  }
  const scopeValues = [conversationState, latestMessage];
  if (scopeValues.some((value) => (
    identifier(value.organizationId, "Conversation organization") !== identity.organizationId
    || identifier(value.quoteId, "Conversation quote") !== identity.quoteId
  ))) {
    fail("permission-denied", "Conversation evidence is outside the requested quote scope.");
  }
  const exact = [summary, conversationState].every((value) => (
    identifier(value.latestMessageId, "Latest conversation message") === messageId
    && requireISO(value.latestMessageAtISO, "Latest conversation time") === messageAtISO
    && text(value.latestActorType, 32).toLowerCase() === actorType
  ));
  if (!exact || messageId !== request.messageId) {
    fail("aborted", "Conversation evidence changed or conflicts with the requested latest message.");
  }
  return { identity, messageId, messageAtISO, actorType };
}

function planRevenueAutopilotStaffAcknowledgementReceipt({
  request,
  quote,
  conversationState,
  latestMessage,
  existingReceipt = null,
  actor,
  nowISO
} = {}) {
  const normalizedRequest = normalizeRevenueAutopilotStaffAcknowledgementRequest(request);
  const normalizedActor = normalizeStaffActor(actor, normalizedRequest.organizationId);
  const now = requireISO(nowISO, "Server staff acknowledgement time");
  const facts = exactConversationFacts({ quote, conversationState, latestMessage }, normalizedRequest);
  if (facts.actorType !== "customer") {
    fail("failed-precondition", "Staff acknowledgement is only valid for the exact latest customer message.");
  }
  if (now < facts.messageAtISO) fail("failed-precondition", "Staff acknowledgement cannot predate its message.");
  const requestFingerprint = fingerprint(normalizedRequest);
  if (record(existingReceipt)) {
    if (text(existingReceipt.requestId, 256) === normalizedRequest.requestId) {
      if (text(existingReceipt.requestFingerprint, 64) !== requestFingerprint) {
        fail("already-exists", "Staff acknowledgement request identity was reused with different content.");
      }
      if (
        text(existingReceipt.latestMessageId, 256) !== facts.messageId
        || requireISO(existingReceipt.latestMessageAtISO, "Existing staff acknowledgement message time") !== facts.messageAtISO
      ) {
        fail("aborted", "Existing staff acknowledgement is not bound to the current latest message.");
      }
      return deepFreeze({ idempotent: true, receipt: existingReceipt });
    }
    if (text(existingReceipt.latestMessageId, 256) === facts.messageId) {
      return deepFreeze({ idempotent: true, receipt: existingReceipt });
    }
  }
  return deepFreeze({
    idempotent: false,
    receipt: {
      schemaVersion: REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
      source: "server_staff_acknowledgement_receipt",
      organizationId: facts.identity.organizationId,
      quoteId: facts.identity.quoteId,
      latestMessageId: facts.messageId,
      latestMessageAtISO: facts.messageAtISO,
      acknowledgedAtISO: now,
      acknowledgedBy: normalizedActor.uid,
      acknowledgedByRole: normalizedActor.role,
      requestId: normalizedRequest.requestId,
      requestFingerprint
    }
  });
}

function buildRevenueAutopilotConversationEvidence({
  quote,
  conversationState,
  latestMessage,
  staffAcknowledgementReceipt = null
} = {}) {
  if (!record(quote)) fail("failed-precondition", "A canonical quote is required.");
  const request = {
    organizationId: identifier(quote.organizationId, "Quote organization"),
    quoteId: identifier(quote.id || quote.quoteId, "Quote identity"),
    messageId: identifier(
      latestMessage?.id || latestMessage?.messageId,
      "Latest conversation message"
    )
  };
  const facts = exactConversationFacts({ quote, conversationState, latestMessage }, request);
  let staffAcknowledged = {};
  if (record(staffAcknowledgementReceipt)) {
    const receiptMessageId = identifier(
      staffAcknowledgementReceipt.latestMessageId,
      "Staff acknowledgement message identity"
    );
    const receiptMessageAtISO = requireISO(
      staffAcknowledgementReceipt.latestMessageAtISO,
      "Staff acknowledgement message time"
    );
    const acknowledgedAtISO = requireISO(
      staffAcknowledgementReceipt.acknowledgedAtISO,
      "Staff acknowledgement time"
    );
    if (
      identifier(staffAcknowledgementReceipt.organizationId, "Staff acknowledgement organization") !== facts.identity.organizationId
      || identifier(staffAcknowledgementReceipt.quoteId, "Staff acknowledgement quote") !== facts.identity.quoteId
      || receiptMessageId !== facts.messageId
      || receiptMessageAtISO !== facts.messageAtISO
      || acknowledgedAtISO < facts.messageAtISO
    ) {
      fail("aborted", "Staff acknowledgement is stale or outside the exact latest-message scope.");
    }
    staffAcknowledged = { latestMessageId: facts.messageId, acknowledgedAtISO };
  }
  return deepFreeze({
    source: "quote_conversation_attention_state",
    organizationId: facts.identity.organizationId,
    quoteId: facts.identity.quoteId,
    latestMessageId: facts.messageId,
    latestMessageAtISO: facts.messageAtISO,
    latestActorType: facts.actorType,
    staffAcknowledged
  });
}

module.exports = {
  ALL_KINDS,
  DEFAULT_DAY_OFFSETS,
  OUTBOUND_KINDS,
  REVENUE_AUTOPILOT_AUTHORITY_PROOF_BOUNDARIES,
  REVENUE_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
  REVENUE_AUTOPILOT_POLICY_SCHEMA_VERSION,
  RevenueAutopilotAuthorityError,
  buildRevenueAutopilotConversationEvidence,
  buildRevenueAutopilotMaterializationInput,
  buildRevenueAutopilotRecipientKey,
  dormantRevenueAutopilotTenantPolicy,
  hashRevenueAutopilotUnsubscribeToken,
  normalizeRevenueAutopilotEmailControls,
  normalizeRevenueAutopilotStaffAcknowledgementRequest,
  normalizeRevenueAutopilotTemplateSet,
  normalizeRevenueAutopilotTenantPolicy,
  planRevenueAutopilotAdminConfiguration,
  planRevenueAutopilotEmailControlUpdate,
  planRevenueAutopilotMaterializationFromCanonical,
  planRevenueAutopilotStaffAcknowledgementReceipt,
  projectRevenueAutopilotAuthorityForStaff,
  verifyRevenueAutopilotUnsubscribeToken
};
