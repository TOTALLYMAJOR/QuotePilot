const ORGANIZATION_OWNER_INVITE_PURPOSE = "organization_owner";

class OrganizationAuthorityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OrganizationAuthorityError";
    this.code = code;
  }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeRole(value) {
  const role = normalizeText(value).toLowerCase();
  return ["admin", "sales", "customer"].includes(role) ? role : "customer";
}

function normalizeInvitePurpose(value) {
  return normalizeText(value).toLowerCase() === ORGANIZATION_OWNER_INVITE_PURPOSE
    ? ORGANIZATION_OWNER_INVITE_PURPOSE
    : "";
}

function planOrganizationOwnerBinding({
  invite = {},
  organization = {},
  organizationId = "",
  uid = "",
  email = "",
  nowISO = ""
} = {}) {
  const purpose = normalizeInvitePurpose(invite.purpose);
  if (purpose !== ORGANIZATION_OWNER_INVITE_PURPOSE) {
    return Object.freeze({ required: false });
  }

  const normalizedOrganizationId = normalizeText(organizationId);
  const normalizedUid = normalizeText(uid);
  const normalizedEmail = normalizeEmail(email);
  const normalizedNowISO = normalizeText(nowISO);
  if (!normalizedOrganizationId || !normalizedUid || !normalizedEmail || !normalizedNowISO) {
    throw new OrganizationAuthorityError(
      "invalid-argument",
      "Organization owner binding requires organization, principal, email, and time."
    );
  }
  if (normalizeRole(invite.role) !== "admin") {
    throw new OrganizationAuthorityError(
      "failed-precondition",
      "Organization owner invitations must grant the admin role."
    );
  }
  if (normalizeText(invite.organizationId) !== normalizedOrganizationId) {
    throw new OrganizationAuthorityError(
      "failed-precondition",
      "Organization owner invitation scope does not match the organization."
    );
  }
  if (normalizeEmail(invite.email) !== normalizedEmail) {
    throw new OrganizationAuthorityError(
      "failed-precondition",
      "Organization owner invitation email does not match the authenticated principal."
    );
  }
  if (normalizeEmail(organization.ownerEmail) !== normalizedEmail) {
    throw new OrganizationAuthorityError(
      "failed-precondition",
      "Organization owner email does not match the authenticated principal."
    );
  }

  const existingOwnerUid = normalizeText(organization.ownerUid);
  if (existingOwnerUid && existingOwnerUid !== normalizedUid) {
    throw new OrganizationAuthorityError(
      "failed-precondition",
      "Organization ownership is already bound to another principal."
    );
  }

  return Object.freeze({
    required: true,
    organizationPatch: Object.freeze({
      ownerUid: normalizedUid,
      ownerBoundAtISO: normalizedNowISO,
      ownerBindingSource: ORGANIZATION_OWNER_INVITE_PURPOSE
    }),
    receipt: Object.freeze({
      schemaVersion: 1,
      organizationId: normalizedOrganizationId,
      ownerUid: normalizedUid,
      ownerEmail: normalizedEmail,
      invitePurpose: ORGANIZATION_OWNER_INVITE_PURPOSE,
      boundAtISO: normalizedNowISO
    })
  });
}

module.exports = {
  ORGANIZATION_OWNER_INVITE_PURPOSE,
  OrganizationAuthorityError,
  normalizeInvitePurpose,
  planOrganizationOwnerBinding
};
