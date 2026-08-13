const ROLE_AUTHORITY_SCHEMA_VERSION = 1;
const ROLE_AUTHORITY_RECENT_AUTH_MAX_AGE_SECONDS = 300;
const ROLE_AUTHORITY_REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{20,80}$/;
const ROLE_AUTHORITY_ROLES = new Set(["admin", "sales", "none"]);

class OrganizationRoleAuthorityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OrganizationRoleAuthorityError";
    this.code = code;
  }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeOrganizationId(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeManagedRole(value) {
  const role = normalizeText(value).toLowerCase();
  return ROLE_AUTHORITY_ROLES.has(role) ? role : "";
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OrganizationRoleAuthorityError("invalid-argument", `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new OrganizationRoleAuthorityError(
      "invalid-argument",
      `${label} must contain only the exact supported fields.`
    );
  }
}

function normalizeOrganizationRoleMutationRequest(value = {}) {
  assertExactKeys(
    value,
    ["expectedCurrentRole", "nextRole", "requestId", "targetEmail"],
    "Role mutation request"
  );
  const requestId = normalizeText(value.requestId);
  const targetEmail = normalizeEmail(value.targetEmail);
  const expectedCurrentRole = normalizeManagedRole(value.expectedCurrentRole);
  const nextRole = normalizeManagedRole(value.nextRole);
  if (!ROLE_AUTHORITY_REQUEST_ID_PATTERN.test(requestId)) {
    throw new OrganizationRoleAuthorityError(
      "invalid-argument",
      "requestId must be 20-80 letters, numbers, or hyphens."
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    throw new OrganizationRoleAuthorityError("invalid-argument", "targetEmail must be valid.");
  }
  if (!expectedCurrentRole || !nextRole) {
    throw new OrganizationRoleAuthorityError(
      "invalid-argument",
      "expectedCurrentRole and nextRole must be admin, sales, or none."
    );
  }
  if (expectedCurrentRole === nextRole) {
    throw new OrganizationRoleAuthorityError(
      "invalid-argument",
      "Role mutation must produce a different role."
    );
  }
  return Object.freeze({ requestId, targetEmail, expectedCurrentRole, nextRole });
}

function assertRecentAuthentication({
  authTimeSeconds,
  nowMs = Date.now(),
  maxAgeSeconds = ROLE_AUTHORITY_RECENT_AUTH_MAX_AGE_SECONDS
} = {}) {
  const authTime = Number(authTimeSeconds);
  const currentMs = Number(nowMs);
  const maxAge = Number(maxAgeSeconds);
  if (!Number.isFinite(authTime) || authTime <= 0 || !Number.isFinite(currentMs)) {
    throw new OrganizationRoleAuthorityError(
      "failed-precondition",
      "Recent authentication is required. Sign in again before changing access."
    );
  }
  if (!Number.isFinite(maxAge) || maxAge <= 0) {
    throw new OrganizationRoleAuthorityError("internal", "Recent-auth policy is invalid.");
  }
  const ageSeconds = Math.floor(currentMs / 1000) - Math.floor(authTime);
  if (ageSeconds < -30 || ageSeconds > maxAge) {
    throw new OrganizationRoleAuthorityError(
      "failed-precondition",
      "Your sign-in is no longer recent. Sign in again before changing access."
    );
  }
  return Object.freeze({
    authenticatedAtISO: new Date(authTime * 1000).toISOString(),
    ageSeconds: Math.max(0, ageSeconds),
    maxAgeSeconds: maxAge
  });
}

function assertRoleAuthorityAppCheck({ app = null, enforced = false, consumeToken = false } = {}) {
  const hasAppCheck = Boolean(app && typeof app === "object" && normalizeText(app.appId));
  if (enforced && !hasAppCheck) {
    throw new OrganizationRoleAuthorityError(
      "failed-precondition",
      "App verification is required before changing access. Refresh and try again."
    );
  }
  if (consumeToken && app?.alreadyConsumed === true) {
    throw new OrganizationRoleAuthorityError(
      "permission-denied",
      "This access-change verification was already used. Refresh and try again."
    );
  }
  return Object.freeze({
    state: hasAppCheck ? "verified" : "unavailable",
    appId: hasAppCheck ? normalizeText(app.appId) : "",
    replayProtection: consumeToken ? "consumed" : "monitor"
  });
}

function planOrganizationRoleMutation({
  actor = {},
  organization = {},
  organizationId = "",
  request = {},
  target = {},
  nowISO = ""
} = {}) {
  const input = normalizeOrganizationRoleMutationRequest(request);
  const orgId = normalizeOrganizationId(organizationId);
  const ownerUid = normalizeText(organization.ownerUid);
  const actorUid = normalizeText(actor.uid);
  const actorEmail = normalizeEmail(actor.email);
  const actorRole = normalizeText(actor.role).toLowerCase();
  const actorOrganizationId = normalizeOrganizationId(actor.organizationId);
  const targetUid = normalizeText(target.uid);
  const targetEmail = normalizeEmail(target.email);
  const targetRole = normalizeManagedRole(target.role || "none") || "none";
  const targetOrganizationId = normalizeOrganizationId(target.organizationId);
  const timestamp = normalizeText(nowISO);

  if (!orgId || !ownerUid || !actorUid || !actorEmail || !targetUid || !targetEmail || !timestamp) {
    throw new OrganizationRoleAuthorityError(
      "failed-precondition",
      "Role authority requires a bound owner, actor, target, organization, and time."
    );
  }
  if (actorRole !== "admin" || actorOrganizationId !== orgId) {
    throw new OrganizationRoleAuthorityError(
      "permission-denied",
      "Same-organization admin authority is required."
    );
  }
  if (target.disabled === true || target.emailVerified !== true || targetEmail !== input.targetEmail) {
    throw new OrganizationRoleAuthorityError(
      "failed-precondition",
      "The target must be an enabled, verified account matching the exact email."
    );
  }
  if (targetOrganizationId && targetOrganizationId !== orgId) {
    throw new OrganizationRoleAuthorityError(
      "permission-denied",
      "The target already belongs to another organization."
    );
  }
  if (targetRole !== input.expectedCurrentRole) {
    throw new OrganizationRoleAuthorityError(
      "aborted",
      "The target role changed. Refresh the team roster before trying again."
    );
  }

  const actorIsOwner = actorUid === ownerUid;
  const targetIsOwner = targetUid === ownerUid;
  const touchesAdminAuthority = targetRole === "admin" || input.nextRole === "admin";
  if (touchesAdminAuthority && !actorIsOwner) {
    throw new OrganizationRoleAuthorityError(
      "permission-denied",
      "Only the canonical organization owner can grant or revoke admin access."
    );
  }
  if (targetIsOwner && input.nextRole !== "admin") {
    throw new OrganizationRoleAuthorityError(
      "failed-precondition",
      "The canonical organization owner cannot be demoted through role management."
    );
  }

  const nextRoleDocument = input.nextRole === "none"
    ? null
    : Object.freeze({
        role: input.nextRole,
        organizationId: orgId,
        email: targetEmail
      });
  return Object.freeze({
    requestId: input.requestId,
    organizationId: orgId,
    actorIsOwner,
    targetUid,
    targetEmail,
    previousRole: targetRole,
    nextRole: input.nextRole,
    nextRoleDocument,
    receipt: Object.freeze({
      schemaVersion: ROLE_AUTHORITY_SCHEMA_VERSION,
      requestId: input.requestId,
      organizationId: orgId,
      actorUid,
      actorEmail,
      actorWasOwner: actorIsOwner,
      targetUid,
      targetEmail,
      previousRole: targetRole,
      nextRole: input.nextRole,
      changedAtISO: timestamp
    })
  });
}

module.exports = {
  ROLE_AUTHORITY_RECENT_AUTH_MAX_AGE_SECONDS,
  ROLE_AUTHORITY_SCHEMA_VERSION,
  OrganizationRoleAuthorityError,
  assertRecentAuthentication,
  assertRoleAuthorityAppCheck,
  normalizeOrganizationRoleMutationRequest,
  planOrganizationRoleMutation
};
