const OWNER_PURPOSE = "organization_owner";

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function email(value) {
  return text(value, 254).toLowerCase();
}

function data(entry) {
  return entry?.data && typeof entry.data === "object" && !Array.isArray(entry.data)
    ? entry.data
    : {};
}

function ownershipRequired(reasons, candidateCount = 0) {
  return Object.freeze({
    state: "ownership_required",
    candidateCount,
    reasons: Object.freeze([...new Set(reasons)].sort()),
    organizationPatch: Object.freeze({}),
    orderPatch: Object.freeze({}),
    receipt: null
  });
}
function receiptMatches(receipt, expected) {
  return (
    Number(receipt.schemaVersion) === expected.schemaVersion
    && text(receipt.organizationId, 128) === expected.organizationId
    && text(receipt.ownerUid, 128) === expected.ownerUid
    && email(receipt.ownerEmail) === expected.ownerEmail
    && text(receipt.inviteId, 256) === expected.inviteId
  );
}

export function planOrganizationOwnerBackfill({
  organizationId = "",
  organization = {},
  invites = [],
  orders = [],
  roles = [],
  authUsers = [],
  receipt = null,
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedOrganizationId = text(organizationId, 128);
  const normalizedNowISO = text(nowISO, 64);
  if (!normalizedOrganizationId || !Number.isFinite(Date.parse(normalizedNowISO))) {
    throw new Error("organizationId and a valid nowISO are required.");
  }

  const scopedConsumedAdminInvites = invites
    .map((entry) => ({ id: text(entry?.id, 256), data: data(entry) }))
    .filter((entry) => (
      entry.id
      && text(entry.data.organizationId, 128) === normalizedOrganizationId
      && text(entry.data.status, 64).toLowerCase() === "consumed"
      && text(entry.data.role, 64).toLowerCase() === "admin"
    ));

  if (scopedConsumedAdminInvites.length !== 1) {
    return ownershipRequired([
      scopedConsumedAdminInvites.length === 0
        ? "consumed_owner_invite_missing"
        : "multiple_consumed_owner_invites"
    ], scopedConsumedAdminInvites.length);
  }

  const [invite] = scopedConsumedAdminInvites;
  const invitePurpose = text(invite.data.purpose, 64).toLowerCase();
  const inviteEmail = email(invite.data.email);
  const inviteUid = text(invite.data.consumedByUid, 128);
  const inviteConsumedEmail = email(invite.data.consumedByEmail);
  const inviteOrderId = text(invite.data.orderId, 128);
  const reasons = [];

  if (invitePurpose && invitePurpose !== OWNER_PURPOSE) reasons.push("invite_purpose_conflict");
  if (!inviteEmail || !inviteUid || !inviteOrderId) reasons.push("invite_identity_incomplete");
  if (inviteConsumedEmail !== inviteEmail) reasons.push("invite_consumed_email_mismatch");

  const matchingOrders = orders
    .map((entry) => ({ id: text(entry?.id, 128), data: data(entry) }))
    .filter((entry) => entry.id === inviteOrderId);
  if (matchingOrders.length !== 1) reasons.push("provisioning_order_missing");
  const order = matchingOrders[0]?.data || {};
  if (matchingOrders.length === 1) {
    if (text(order.organizationId, 128) !== normalizedOrganizationId) {
      reasons.push("provisioning_order_organization_mismatch");
    }
    if (email(order.ownerEmail) !== inviteEmail) reasons.push("provisioning_order_email_mismatch");
    const orderOwnerUid = text(order.ownerUid, 128);
    if (orderOwnerUid && orderOwnerUid !== inviteUid) reasons.push("provisioning_order_owner_conflict");
  }

  const matchingRoles = roles
    .map((entry) => ({ id: text(entry?.id, 128), data: data(entry) }))
    .filter((entry) => entry.id === inviteUid);
  if (matchingRoles.length !== 1) reasons.push("admin_role_missing");
  const role = matchingRoles[0]?.data || {};
  if (matchingRoles.length === 1) {
    if (text(role.organizationId, 128) !== normalizedOrganizationId) reasons.push("admin_role_organization_mismatch");
    if (text(role.role, 64).toLowerCase() !== "admin") reasons.push("admin_role_mismatch");
    if (email(role.email) !== inviteEmail) reasons.push("admin_role_email_mismatch");
  }

  const matchingAuthUsers = authUsers.filter((entry) => text(entry?.uid, 128) === inviteUid);
  if (matchingAuthUsers.length !== 1) reasons.push("auth_user_missing");
  const authUser = matchingAuthUsers[0] || {};
  if (matchingAuthUsers.length === 1) {
    if (authUser.emailVerified !== true) reasons.push("auth_email_unverified");
    if (email(authUser.email) !== inviteEmail) reasons.push("auth_email_mismatch");
  }

  if (!organization || typeof organization !== "object" || Array.isArray(organization)) {
    reasons.push("organization_missing");
  } else {
    if (email(organization.ownerEmail) !== inviteEmail) reasons.push("organization_owner_email_mismatch");
    const currentOwnerUid = text(organization.ownerUid, 128);
    if (currentOwnerUid && currentOwnerUid !== inviteUid) reasons.push("organization_owner_conflict");
    const status = text(organization.status, 64).toLowerCase();
    if (organization.archived === true || ["archived", "deleted", "inactive"].includes(status)) {
      reasons.push("organization_inactive");
    }
  }

  const expectedReceipt = Object.freeze({
    schemaVersion: 1,
    organizationId: normalizedOrganizationId,
    ownerUid: inviteUid,
    ownerEmail: inviteEmail,
    inviteId: invite.id,
    invitePurpose: invitePurpose === OWNER_PURPOSE ? OWNER_PURPOSE : "legacy_unmarked_owner_invite",
    orderId: inviteOrderId,
    bindingSource: "consumed_owner_invite_backfill",
    boundAtISO: normalizedNowISO
  });
  if (receipt && !receiptMatches(receipt, expectedReceipt)) reasons.push("owner_receipt_conflict");

  if (reasons.length) return ownershipRequired(reasons, 1);

  const alreadyBound = text(organization.ownerUid, 128) === inviteUid;
  const orderAlreadyBound = text(order.ownerUid, 128) === inviteUid;
  if (alreadyBound && orderAlreadyBound && receipt) {
    return Object.freeze({
      state: "already_current",
      candidateCount: 1,
      reasons: Object.freeze([]),
      ownerUid: inviteUid,
      inviteId: invite.id,
      orderId: inviteOrderId,
      organizationPatch: Object.freeze({}),
      orderPatch: Object.freeze({}),
      receipt: null
    });
  }

  if (receipt) return ownershipRequired(["owner_binding_incomplete_with_existing_receipt"], 1);

  return Object.freeze({
    state: "bind",
    candidateCount: 1,
    reasons: Object.freeze([]),
    ownerUid: inviteUid,
    inviteId: invite.id,
    orderId: inviteOrderId,
    organizationPatch: Object.freeze({
      ownerUid: inviteUid,
      ownerBoundAtISO: normalizedNowISO,
      ownerBindingSource: "consumed_owner_invite_backfill",
      updatedAtISO: normalizedNowISO
    }),
    orderPatch: Object.freeze({
      ownerUid: inviteUid,
      ownerBindingBackfilledAtISO: normalizedNowISO,
      updatedAtISO: normalizedNowISO
    }),
    receipt: expectedReceipt
  });
}
