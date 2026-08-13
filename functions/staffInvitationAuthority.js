"use strict";

const { createHash, createHmac, timingSafeEqual } = require("node:crypto");

const STAFF_INVITATION_AUTHORITY_VERSION = "staff-invitation-authority-v1";
const STAFF_INVITATION_SCHEMA_VERSION = 1;
const STAFF_INVITATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;
const INVITATION_STATES = new Set([
  "dispatching",
  "outcome_ambiguous",
  "provider_accepted",
  "delivered",
  "bounced",
  "complained",
  "definite_failure"
]);
const DECISIONS = new Set(["accepted", "declined"]);

class StaffInvitationAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StaffInvitationAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new StaffInvitationAuthorityError(code, message, details);
}

function text(value, maximum = 500, { allowEmpty = true } = {}) {
  const normalized = String(value ?? "").trim().replace(/\r\n?/gu, "\n");
  if ((!allowEmpty && !normalized) || normalized.length > maximum || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    fail("invalid-argument", "Staff invitation text is invalid or exceeds its bound.");
  }
  return normalized;
}

function opaqueId(value, label) {
  const normalized = text(value, 256, { allowEmpty: false });
  if (/\s|[/?#\\\u0000]/u.test(normalized) || normalized === "." || normalized === ".." || /^[^@\s]+@[^@\s]+$/u.test(normalized)) {
    fail("invalid-argument", `${label} must be an exact opaque identifier.`);
  }
  return normalized;
}

function exactISO(value, label) {
  const normalized = text(value, 40, { allowEmpty: false });
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail("invalid-argument", `${label} must be an exact ISO timestamp.`);
  }
  return normalized;
}

function email(value) {
  const normalized = text(value, 254, { allowEmpty: false }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    fail("failed-precondition", "The staff record needs a valid private email before invitation dispatch.");
  }
  return normalized;
}

function integer(value, label, { minimum = 0, maximum = 1_000_000_000 } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail("invalid-argument", `${label} must be a bounded integer.`);
  }
  return parsed;
}

function canonical(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") fail("invalid-argument", "Staff invitation evidence must be canonical JSON.");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function normalizeScope(value = {}) {
  return Object.freeze({
    organizationId: opaqueId(value.organizationId, "organizationId"),
    quoteId: opaqueId(value.quoteId, "quoteId"),
    quoteRevisionId: opaqueId(value.quoteRevisionId, "quoteRevisionId"),
    planRevision: integer(value.planRevision, "Plan revision", { minimum: 1 }),
    assignmentId: opaqueId(value.assignmentId, "assignmentId"),
    staffId: opaqueId(value.staffId, "staffId"),
    recordRevision: integer(value.recordRevision, "Staff record revision", { minimum: 1 })
  });
}

function buildStaffInvitationId(scope = {}) {
  const normalized = normalizeScope(scope);
  return `sti_${digest(normalized).slice(0, 48)}`;
}

function buildStaffInvitationPreview({ scope, staffRecord, assignment, organizationName = "QuotePilot" } = {}) {
  const normalizedScope = normalizeScope(scope);
  const contact = staffRecord?.contact && typeof staffRecord.contact === "object" ? staffRecord.contact : {};
  const toEmail = email(contact.email);
  if (contact.communicationsEnabled !== true) {
    fail("failed-precondition", "Staff communications are disabled for this person.");
  }
  if (text(contact.emailStatus, 32).toLowerCase() !== "verified") {
    fail("failed-precondition", "Verify the staff email in the private record before invitation dispatch.");
  }
  const event = assignment?.event && typeof assignment.event === "object" ? assignment.event : {};
  const selection = assignment?.selection && typeof assignment.selection === "object" ? assignment.selection : {};
  const preferredName = text(staffRecord?.preferredName || assignment?.staffName || "there", 80);
  const eventName = text(event.name || "Event", 160);
  const eventDate = text(event.date || "Date pending", 80);
  const role = text(assignment?.role, 40).toLowerCase();
  if (!new Set(["lead", "server", "chef", "bartender"]).has(role)) {
    fail("failed-precondition", "The confirmed assignment has an unsupported role.");
  }
  const lines = [
    `Hi ${preferredName},`,
    "",
    `${text(organizationName, 120) || "QuotePilot"} would like you to review this event assignment:`,
    `Event: ${eventName}`,
    `Date: ${eventDate}`,
    `Time: ${text(event.time || assignment?.eventWindow?.startAtISO || "Time pending", 120)}`,
    `Role: ${role}`,
    `Venue: ${text(event.venue || "Venue pending", 180)}`,
    ...(text(event.venueAddress, 240) ? [`Address: ${text(event.venueAddress, 240)}`] : []),
    ...(Number(event.guests || 0) > 0 ? [`Guests: ${Math.round(Number(event.guests))}`] : []),
    ...(text(selection.packageName, 160) ? [`Package: ${text(selection.packageName, 160)}`] : []),
    "",
    "Use the secure response link to accept or decline. Your response records only this invitation decision; it does not record attendance, payroll, or event completion."
  ];
  const preview = {
    authorityVersion: STAFF_INVITATION_AUTHORITY_VERSION,
    invitationId: buildStaffInvitationId(normalizedScope),
    scope: normalizedScope,
    recipient: { email: toEmail, name: preferredName },
    event: {
      name: eventName,
      date: eventDate,
      time: text(event.time || assignment?.eventWindow?.startAtISO || "Time pending", 120),
      venue: text(event.venue || "Venue pending", 180),
      venueAddress: text(event.venueAddress, 240),
      guests: Math.max(0, Math.round(Number(event.guests || 0)))
    },
    role,
    subject: `${eventName} staff invitation · ${eventDate}`.slice(0, 240),
    textWithoutResponseLink: lines.join("\n"),
    consequence: "Dispatch sends one invitation for this exact confirmed assignment and current private email.",
    doNothing: "Nothing is sent and the confirmed staffing plan remains unchanged.",
    evidenceBoundary: "Provider acceptance, provider-reported delivery, and staff acknowledgement remain separate evidence."
  };
  return Object.freeze({ ...preview, previewDigest: digest(preview) });
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function tokenSecret(secret) {
  const normalized = text(secret, 4096, { allowEmpty: false });
  if (Buffer.byteLength(normalized, "utf8") < 32) {
    fail("failed-precondition", "Staff invitation token authority is not configured.");
  }
  return normalized;
}

function buildStaffInvitationToken({ preview, secret, issuedAtISO, expiresAtISO } = {}) {
  if (!preview?.scope || !preview?.invitationId || !preview?.previewDigest) {
    fail("invalid-argument", "An exact staff invitation preview is required.");
  }
  const payload = {
    v: 1,
    invitationId: opaqueId(preview.invitationId, "invitationId"),
    ...normalizeScope(preview.scope),
    previewDigest: text(preview.previewDigest, 64, { allowEmpty: false }),
    issuedAtISO: exactISO(issuedAtISO, "Invitation issue time"),
    expiresAtISO: exactISO(expiresAtISO, "Invitation expiry time")
  };
  if (payload.expiresAtISO <= payload.issuedAtISO) fail("invalid-argument", "Invitation expiry must follow issue time.");
  const encoded = base64urlJson(payload);
  const signature = createHmac("sha256", tokenSecret(secret)).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyStaffInvitationToken(token, secret, { nowISO = new Date().toISOString(), allowExpired = false } = {}) {
  const normalized = text(token, 4096, { allowEmpty: false });
  const [encoded, suppliedSignature, extra] = normalized.split(".");
  if (!encoded || !suppliedSignature || extra) fail("permission-denied", "Staff invitation link is invalid.");
  const expectedSignature = createHmac("sha256", tokenSecret(secret)).update(encoded).digest();
  let supplied;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    fail("permission-denied", "Staff invitation link is invalid.");
  }
  if (supplied.length !== expectedSignature.length || !timingSafeEqual(supplied, expectedSignature)) {
    fail("permission-denied", "Staff invitation link is invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    fail("permission-denied", "Staff invitation link is invalid.");
  }
  const verified = {
    v: integer(payload.v, "Token version", { minimum: 1, maximum: 1 }),
    invitationId: opaqueId(payload.invitationId, "invitationId"),
    ...normalizeScope(payload),
    previewDigest: text(payload.previewDigest, 64, { allowEmpty: false }),
    issuedAtISO: exactISO(payload.issuedAtISO, "Invitation issue time"),
    expiresAtISO: exactISO(payload.expiresAtISO, "Invitation expiry time")
  };
  const observedAtISO = exactISO(nowISO, "Invitation observation time");
  if (!allowExpired && verified.expiresAtISO <= observedAtISO) {
    fail("failed-precondition", "This staff invitation link has expired.");
  }
  return Object.freeze(verified);
}

function hashStaffInvitationToken(token) {
  return digest({ token: text(token, 4096, { allowEmpty: false }) });
}

function projectStaffInvitation(value = {}) {
  const state = text(value.state, 40).toLowerCase();
  const decision = text(value.acknowledgement?.state || "pending", 40).toLowerCase();
  return Object.freeze({
    authorityVersion: STAFF_INVITATION_AUTHORITY_VERSION,
    invitationId: opaqueId(value.invitationId, "invitationId"),
    quoteId: opaqueId(value.quoteId, "quoteId"),
    quoteRevisionId: opaqueId(value.quoteRevisionId, "quoteRevisionId"),
    planRevision: integer(value.planRevision, "Plan revision", { minimum: 1 }),
    assignmentId: opaqueId(value.assignmentId, "assignmentId"),
    staffId: opaqueId(value.staffId, "staffId"),
    role: text(value.role, 40).toLowerCase(),
    state: INVITATION_STATES.has(state) ? state : "outcome_ambiguous",
    providerAcceptedAtISO: text(value.providerAcceptedAtISO, 40),
    deliveredAtISO: text(value.deliveredAtISO, 40),
    bouncedAtISO: text(value.bouncedAtISO, 40),
    complainedAtISO: text(value.complainedAtISO, 40),
    acknowledgement: {
      state: DECISIONS.has(decision) ? decision : "pending",
      respondedAtISO: text(value.acknowledgement?.respondedAtISO, 40),
      declineReason: decision === "declined" ? text(value.acknowledgement?.declineReason, 500) : ""
    },
    expiresAtISO: text(value.expiresAtISO, 40),
    updatedAtISO: text(value.updatedAtISO, 40)
  });
}

function recordStaffInvitationDecision({ invitation, decision, declineReason = "", nowISO } = {}) {
  const current = projectStaffInvitation(invitation);
  const normalizedDecision = text(decision, 40).toLowerCase();
  if (!DECISIONS.has(normalizedDecision)) fail("invalid-argument", "Choose accept or decline.");
  const respondedAtISO = exactISO(nowISO, "Staff response time");
  if (current.expiresAtISO && current.expiresAtISO <= respondedAtISO) fail("failed-precondition", "This staff invitation link has expired.");
  if (["bounced", "complained", "definite_failure"].includes(current.state)) {
    fail("failed-precondition", "This invitation is no longer available for response.");
  }
  if (current.acknowledgement.state !== "pending") {
    if (current.acknowledgement.state !== normalizedDecision) {
      fail("already-exists", `This invitation was already ${current.acknowledgement.state}.`);
    }
    return Object.freeze({ idempotent: true, acknowledgement: current.acknowledgement });
  }
  return Object.freeze({
    idempotent: false,
    acknowledgement: {
      state: normalizedDecision,
      respondedAtISO,
      declineReason: normalizedDecision === "declined" ? text(declineReason, 500) : ""
    }
  });
}

module.exports = {
  STAFF_INVITATION_AUTHORITY_VERSION,
  STAFF_INVITATION_SCHEMA_VERSION,
  STAFF_INVITATION_VALIDITY_MS,
  StaffInvitationAuthorityError,
  buildStaffInvitationId,
  buildStaffInvitationPreview,
  buildStaffInvitationToken,
  hashStaffInvitationToken,
  projectStaffInvitation,
  recordStaffInvitationDecision,
  verifyStaffInvitationToken
};
