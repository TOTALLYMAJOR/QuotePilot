"use strict";

const {
  canonicalJson,
  sha256,
  StripeConnectInterfaceError
} = require("./interfaceContracts");

const CONNECT_AUTHORITY_SCHEMA_VERSION = 1;
const CONNECT_AUTHORITY_POLICY_REVISION = 1;
const CONNECT_AUTHORITY_MAX_VALIDITY_SECONDS = 10 * 60;
const CONNECT_AUTHORITY_MAX_MEMBERS = 200;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const RECEIPT_ID_PATTERN = /^[A-Za-z0-9_:-]{1,200}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function text(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-argument", `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-argument", `${label} must contain only the exact supported fields.`);
  }
}

function safeId(value, label) {
  const normalized = text(value, 160);
  if (!SAFE_ID_PATTERN.test(normalized)) fail("invalid-argument", `${label} is invalid.`);
  return normalized;
}

function safeInteger(value, label, { min = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) fail("invalid-argument", `${label} is invalid.`);
  return parsed;
}

function email(value, label) {
  const normalized = text(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    fail("invalid-argument", `${label} is invalid.`);
  }
  return normalized;
}

function iso(value, label) {
  const parsed = Date.parse(text(value, 64));
  if (!Number.isFinite(parsed)) fail("invalid-argument", `${label} is invalid.`);
  return new Date(parsed).toISOString();
}

function normalizeMember(value, index) {
  exactKeys(
    value,
    ["disabled", "email", "emailVerified", "role", "uid"],
    `authority member ${index}`
  );
  const role = text(value.role, 32).toLowerCase();
  if (role !== "admin" || value.emailVerified !== true || value.disabled !== false) {
    fail("invalid-argument", "Authority projections may contain only enabled, verified administrators.");
  }
  return Object.freeze({
    uid: safeId(value.uid, `authority member ${index} uid`),
    email: email(value.email, `authority member ${index} email`),
    role,
    emailVerified: true,
    disabled: false
  });
}

function projectionDigestPayload(value) {
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    policyRevision: value.policyRevision,
    organizationId: value.organizationId,
    authorityRevision: value.authorityRevision,
    organizationActive: value.organizationActive,
    ownerUid: value.ownerUid,
    members: value.members,
    sourceReceiptId: value.sourceReceiptId,
    sourceReceiptDigest: value.sourceReceiptDigest,
    observedAtISO: value.observedAtISO,
    expiresAtISO: value.expiresAtISO
  });
}

function buildConnectAuthorityProjectionDigest(value) {
  return sha256(canonicalJson(projectionDigestPayload(value)));
}

function normalizeConnectAuthorityProjection(value = {}, { nowMs = Date.now(), allowExpired = false } = {}) {
  exactKeys(
    value,
    [
      "authorityRevision",
      "expiresAtISO",
      "members",
      "observedAtISO",
      "organizationActive",
      "organizationId",
      "ownerUid",
      "payloadDigest",
      "policyRevision",
      "schemaVersion",
      "sourceReceiptDigest",
      "sourceReceiptId"
    ],
    "Connect authority projection"
  );
  if (Number(value.schemaVersion) !== CONNECT_AUTHORITY_SCHEMA_VERSION) {
    fail("failed-precondition", "The Connect authority schema version is unsupported.");
  }
  if (Number(value.policyRevision) !== CONNECT_AUTHORITY_POLICY_REVISION) {
    fail("failed-precondition", "The Connect authority policy revision is unsupported.");
  }
  if (value.organizationActive !== true) {
    fail("failed-precondition", "Stripe authority is unavailable for an inactive organization.");
  }
  if (!Array.isArray(value.members) || value.members.length < 1 || value.members.length > CONNECT_AUTHORITY_MAX_MEMBERS) {
    fail("invalid-argument", "The Connect authority member set is invalid.");
  }
  const members = value.members.map(normalizeMember);
  const sortedMembers = [...members].sort((left, right) => left.uid.localeCompare(right.uid));
  if (members.some((member, index) => member.uid !== sortedMembers[index].uid)) {
    fail("invalid-argument", "Connect authority members must be sorted by UID.");
  }
  if (new Set(members.map((member) => member.uid)).size !== members.length) {
    fail("invalid-argument", "Connect authority members must have unique UIDs.");
  }

  const observedAtISO = iso(value.observedAtISO, "authority observedAtISO");
  const expiresAtISO = iso(value.expiresAtISO, "authority expiresAtISO");
  const observedAtMs = Date.parse(observedAtISO);
  const expiresAtMs = Date.parse(expiresAtISO);
  const currentMs = Number(nowMs);
  if (!Number.isFinite(currentMs) || observedAtMs > currentMs + 30_000) {
    fail("failed-precondition", "The Connect authority observation time is invalid.");
  }
  if (
    expiresAtMs <= observedAtMs
    || expiresAtMs - observedAtMs > CONNECT_AUTHORITY_MAX_VALIDITY_SECONDS * 1000
  ) {
    fail("failed-precondition", "The Connect authority validity window is invalid.");
  }
  if (!allowExpired && expiresAtMs <= currentMs) {
    fail("failed-precondition", "The Connect authority projection expired. Refresh authority before continuing.");
  }

  const sourceReceiptId = text(value.sourceReceiptId, 200);
  const sourceReceiptDigest = text(value.sourceReceiptDigest, 64).toLowerCase();
  const payloadDigest = text(value.payloadDigest, 64).toLowerCase();
  if (!RECEIPT_ID_PATTERN.test(sourceReceiptId) || !DIGEST_PATTERN.test(sourceReceiptDigest)) {
    fail("invalid-argument", "The Connect authority source receipt is invalid.");
  }
  if (!DIGEST_PATTERN.test(payloadDigest)) {
    fail("invalid-argument", "The Connect authority payload digest is invalid.");
  }

  const normalized = Object.freeze({
    schemaVersion: CONNECT_AUTHORITY_SCHEMA_VERSION,
    policyRevision: CONNECT_AUTHORITY_POLICY_REVISION,
    organizationId: safeId(value.organizationId, "authority organizationId").toLowerCase(),
    authorityRevision: safeInteger(value.authorityRevision, "authorityRevision", { min: 1 }),
    organizationActive: true,
    ownerUid: safeId(value.ownerUid, "authority ownerUid"),
    members: Object.freeze(members),
    sourceReceiptId,
    sourceReceiptDigest,
    observedAtISO,
    expiresAtISO,
    payloadDigest
  });
  if (!members.some((member) => member.uid === normalized.ownerUid)) {
    fail("failed-precondition", "The canonical owner must remain an enabled, verified administrator.");
  }
  if (buildConnectAuthorityProjectionDigest(normalized) !== normalized.payloadDigest) {
    fail("invalid-argument", "The Connect authority payload digest does not match its exact projection.");
  }
  return normalized;
}

function buildConnectAuthorityProjection(value = {}, { nowMs = Date.now() } = {}) {
  const draft = {
    ...value,
    schemaVersion: CONNECT_AUTHORITY_SCHEMA_VERSION,
    policyRevision: CONNECT_AUTHORITY_POLICY_REVISION,
    payloadDigest: "0".repeat(64)
  };
  draft.payloadDigest = buildConnectAuthorityProjectionDigest(draft);
  return normalizeConnectAuthorityProjection(draft, { nowMs });
}

function assertProjectedConnectAdmin(actor = {}, authority = {}, nowMs = Date.now()) {
  const projection = normalizeConnectAuthorityProjection(authority, { nowMs });
  if (projection.organizationId !== text(actor.organizationId, 160).toLowerCase()) {
    fail("permission-denied", "Stripe authority is unavailable outside the current organization.");
  }
  const member = projection.members.find((candidate) => candidate.uid === actor.uid);
  if (!member || member.email !== text(actor.email, 320).toLowerCase()) {
    fail("permission-denied", "Current same-organization admin authority is required.");
  }
  return Object.freeze({ projection, member, actorIsOwner: projection.ownerUid === actor.uid });
}

module.exports = {
  CONNECT_AUTHORITY_MAX_MEMBERS,
  CONNECT_AUTHORITY_MAX_VALIDITY_SECONDS,
  CONNECT_AUTHORITY_POLICY_REVISION,
  CONNECT_AUTHORITY_SCHEMA_VERSION,
  assertProjectedConnectAdmin,
  buildConnectAuthorityProjection,
  buildConnectAuthorityProjectionDigest,
  normalizeConnectAuthorityProjection
};
