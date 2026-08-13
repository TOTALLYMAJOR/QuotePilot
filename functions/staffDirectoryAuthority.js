"use strict";

const { createHash } = require("node:crypto");

const STAFF_DIRECTORY_AUTHORITY_VERSION = "staff-directory-authority-v1";
const STAFF_RECORD_SCHEMA_VERSION = 1;
const STAFF_RECORD_RECEIPT_VERSION = "staff-record-command-receipt-v1";
const STAFF_ROLES = Object.freeze(["lead", "server", "chef", "bartender"]);
const STAFF_ROLE_SET = new Set(STAFF_ROLES);
const CHANNELS = new Set(["email", "phone", "either"]);
const EMAIL_STATES = new Set(["unverified", "verified", "bounced", "disabled"]);
const PROFICIENCY_STATES = new Set(["learning", "capable", "experienced", "lead"]);
const QUALIFICATION_STATES = new Set(["current", "expiring", "expired", "pending"]);
const PAY_TYPES = new Set(["hourly", "event", "mixed"]);
const PAYROLL_STATES = new Set(["not_ready", "ready", "on_hold"]);
const RELIABILITY_STATES = new Set(["new", "steady", "preferred", "review"]);
const MAX_QUALIFICATIONS = 32;
const MAX_CANONICAL_BYTES = 262_144;

class StaffDirectoryAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StaffDirectoryAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new StaffDirectoryAuthorityError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value, maximum = 240, { allowEmpty = true } = {}) {
  const normalized = String(value ?? "").trim().replace(/\r\n?/gu, "\n");
  if ((!allowEmpty && !normalized) || normalized.length > maximum || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    fail("invalid-argument", "Staff record text is invalid or exceeds its bound.");
  }
  return normalized;
}

function opaqueId(value, label, { allowEmpty = false } = {}) {
  const normalized = text(value, 160);
  if (allowEmpty && !normalized) return "";
  if (!normalized || /[\s/?#\\\u0000]/u.test(normalized) || normalized === "." || normalized === ".." || /^[^@\s]+@[^@\s]+$/u.test(normalized)) {
    fail("invalid-argument", `${label} must be a stable opaque identifier.`);
  }
  return normalized;
}

function exactISO(value, label, { allowEmpty = true } = {}) {
  const normalized = text(value, 40);
  if (allowEmpty && !normalized) return "";
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    fail("invalid-argument", `${label} must be an exact ISO timestamp.`);
  }
  return normalized;
}

function dateOnly(value, label, { allowEmpty = true } = {}) {
  const normalized = text(value, 10);
  if (allowEmpty && !normalized) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`))) {
    fail("invalid-argument", `${label} must be a YYYY-MM-DD date.`);
  }
  return normalized;
}

function email(value) {
  const normalized = text(value, 254).toLowerCase();
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    fail("invalid-argument", "Staff email must be valid.");
  }
  return normalized;
}

function url(value, label) {
  const normalized = text(value, 1200);
  if (!normalized) return "";
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail("invalid-argument", `${label} must be an HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") fail("invalid-argument", `${label} must be an HTTPS URL.`);
  return parsed.toString();
}

function boolean(value, label) {
  if (typeof value !== "boolean") fail("invalid-argument", `${label} must be explicit.`);
  return value;
}

function integer(value, label, { minimum = 0, maximum = 1_000_000 } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail("invalid-argument", `${label} must be a bounded integer.`);
  }
  return parsed;
}

function money(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
    fail("invalid-argument", `${label} must be a non-negative amount.`);
  }
  return Math.round(parsed * 100) / 100;
}

function enumValue(value, allowed, label) {
  const normalized = text(value, 40).toLowerCase();
  if (!allowed.has(normalized)) fail("invalid-argument", `${label} is unsupported.`);
  return normalized;
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)) fail("invalid-argument", `${label} is required.`);
  const expected = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (unknown.length || missing.length) {
    fail("invalid-argument", `${label} does not match the staff record contract.`, { unknown, missing });
  }
}

function normalizeCapabilities(values) {
  if (!Array.isArray(values) || !values.length || values.length > STAFF_ROLES.length) {
    fail("invalid-argument", "At least one bounded staff role is required.");
  }
  const normalized = values.map((value) => enumValue(value, STAFF_ROLE_SET, "Staff role")).sort();
  if (new Set(normalized).size !== normalized.length) fail("invalid-argument", "Staff roles must be unique.");
  return normalized;
}

function normalizeRoleDetails(values, capabilities) {
  if (!Array.isArray(values) || values.length !== capabilities.length) {
    fail("invalid-argument", "Every enabled role needs one role-detail record.");
  }
  const normalized = values.map((value) => {
    exactKeys(value, ["role", "proficiency", "preferred", "acceptsAssignments"], "Staff role detail");
    return {
      role: enumValue(value.role, STAFF_ROLE_SET, "Staff role"),
      proficiency: enumValue(value.proficiency, PROFICIENCY_STATES, "Role proficiency"),
      preferred: boolean(value.preferred, "Role preference"),
      acceptsAssignments: boolean(value.acceptsAssignments, "Role assignment preference")
    };
  }).sort((left, right) => left.role.localeCompare(right.role));
  if (new Set(normalized.map((item) => item.role)).size !== normalized.length) {
    fail("invalid-argument", "Role details must be unique.");
  }
  if (normalized.some((item) => !capabilities.includes(item.role)) || capabilities.some((role) => !normalized.some((item) => item.role === role))) {
    fail("invalid-argument", "Role details must exactly match enabled capabilities.");
  }
  return normalized;
}

function normalizeQualifications(values) {
  if (!Array.isArray(values) || values.length > MAX_QUALIFICATIONS) {
    fail("resource-exhausted", "Staff qualifications exceed their bound.");
  }
  const normalized = values.map((value) => {
    exactKeys(value, [
      "qualificationId", "type", "number", "provider", "issuedOn", "expiresOn",
      "status", "documentUrl", "notes"
    ], "Staff qualification");
    return {
      qualificationId: opaqueId(value.qualificationId, "qualificationId"),
      type: text(value.type, 100, { allowEmpty: false }),
      number: text(value.number, 100),
      provider: text(value.provider, 120),
      issuedOn: dateOnly(value.issuedOn, "Qualification issue date"),
      expiresOn: dateOnly(value.expiresOn, "Qualification expiry date"),
      status: enumValue(value.status, QUALIFICATION_STATES, "Qualification status"),
      documentUrl: url(value.documentUrl, "Qualification document URL"),
      notes: text(value.notes, 600)
    };
  }).sort((left, right) => left.qualificationId.localeCompare(right.qualificationId));
  if (new Set(normalized.map((item) => item.qualificationId)).size !== normalized.length) {
    fail("invalid-argument", "Qualification identifiers must be unique.");
  }
  return normalized;
}

function normalizeStaffRecord(value, { organizationId, staffId } = {}) {
  const scopedOrganizationId = opaqueId(organizationId, "organizationId");
  const scopedStaffId = opaqueId(staffId, "staffId");
  exactKeys(value, [
    "preferredName", "legalName", "photoUrl", "contact", "roleDetails", "qualifications",
    "scheduling", "compensation", "travel", "assignmentDefaults", "briefingDefaults",
    "attendance", "reliability", "privateNotes"
  ], "Staff record");
  const capabilities = normalizeCapabilities(value.roleDetails.map((item) => item?.role));

  exactKeys(value.contact, [
    "email", "phone", "emergencyContactName", "emergencyContactPhone", "preferredChannel",
    "emailStatus", "timeZone", "communicationsEnabled", "lastVerifiedAtISO"
  ], "Staff contact");
  exactKeys(value.scheduling, [
    "preferredHours", "maxWeeklyHours", "maxConsecutiveDays", "minRestHours",
    "recurringAvailabilityNote", "timeOffNote"
  ], "Staff scheduling preferences");
  exactKeys(value.compensation, [
    "payType", "currency", "hourlyRate", "eventRate", "overtimeRate", "travelStipend", "payrollStatus"
  ], "Staff compensation");
  exactKeys(value.travel, [
    "homeBase", "maxDistanceMiles", "transportation", "preferredAreas", "lodgingRequired"
  ], "Staff travel preferences");
  exactKeys(value.assignmentDefaults, [
    "department", "station", "supervisorStaffId", "reportingLocation", "arrivalInstructions"
  ], "Staff assignment defaults");
  exactKeys(value.briefingDefaults, [
    "uniform", "parking", "entrance", "mealPolicy", "responsibilities"
  ], "Staff briefing defaults");
  exactKeys(value.attendance, [
    "completedAssignments", "lateArrivals", "noShows", "cancellations", "lastAssignmentAtISO",
    "lastResponse", "lastRespondedAtISO", "lastDeclineReason"
  ], "Staff attendance summary");
  exactKeys(value.reliability, ["status", "managerRating", "notes"], "Staff reliability");

  const preferredAreas = Array.isArray(value.travel.preferredAreas)
    ? value.travel.preferredAreas.map((item) => text(item, 100, { allowEmpty: false })).slice(0, 20)
    : fail("invalid-argument", "Preferred travel areas must be an array.");
  return Object.freeze({
    schemaVersion: STAFF_RECORD_SCHEMA_VERSION,
    authority: "server_authoritative",
    authorityVersion: STAFF_DIRECTORY_AUTHORITY_VERSION,
    organizationId: scopedOrganizationId,
    staffId: scopedStaffId,
    preferredName: text(value.preferredName, 80),
    legalName: text(value.legalName, 120),
    photoUrl: url(value.photoUrl, "Staff photo URL"),
    contact: Object.freeze({
      email: email(value.contact.email),
      phone: text(value.contact.phone, 40),
      emergencyContactName: text(value.contact.emergencyContactName, 100),
      emergencyContactPhone: text(value.contact.emergencyContactPhone, 40),
      preferredChannel: enumValue(value.contact.preferredChannel, CHANNELS, "Preferred contact channel"),
      emailStatus: enumValue(value.contact.emailStatus, EMAIL_STATES, "Email status"),
      timeZone: text(value.contact.timeZone, 80),
      communicationsEnabled: boolean(value.contact.communicationsEnabled, "Communications enabled"),
      lastVerifiedAtISO: exactISO(value.contact.lastVerifiedAtISO, "Contact verification time")
    }),
    roleDetails: Object.freeze(normalizeRoleDetails(value.roleDetails, capabilities)),
    qualifications: Object.freeze(normalizeQualifications(value.qualifications)),
    scheduling: Object.freeze({
      preferredHours: text(value.scheduling.preferredHours, 160),
      maxWeeklyHours: integer(value.scheduling.maxWeeklyHours, "Maximum weekly hours", { maximum: 168 }),
      maxConsecutiveDays: integer(value.scheduling.maxConsecutiveDays, "Maximum consecutive days", { maximum: 31 }),
      minRestHours: integer(value.scheduling.minRestHours, "Minimum rest hours", { maximum: 72 }),
      recurringAvailabilityNote: text(value.scheduling.recurringAvailabilityNote, 800),
      timeOffNote: text(value.scheduling.timeOffNote, 800)
    }),
    compensation: Object.freeze({
      payType: enumValue(value.compensation.payType, PAY_TYPES, "Pay type"),
      currency: text(value.compensation.currency, 3, { allowEmpty: false }).toUpperCase(),
      hourlyRate: money(value.compensation.hourlyRate, "Hourly rate"),
      eventRate: money(value.compensation.eventRate, "Event rate"),
      overtimeRate: money(value.compensation.overtimeRate, "Overtime rate"),
      travelStipend: money(value.compensation.travelStipend, "Travel stipend"),
      payrollStatus: enumValue(value.compensation.payrollStatus, PAYROLL_STATES, "Payroll status")
    }),
    travel: Object.freeze({
      homeBase: text(value.travel.homeBase, 160),
      maxDistanceMiles: integer(value.travel.maxDistanceMiles, "Maximum travel distance", { maximum: 10_000 }),
      transportation: text(value.travel.transportation, 120),
      preferredAreas: Object.freeze(preferredAreas),
      lodgingRequired: boolean(value.travel.lodgingRequired, "Lodging requirement")
    }),
    assignmentDefaults: Object.freeze({
      department: text(value.assignmentDefaults.department, 100),
      station: text(value.assignmentDefaults.station, 100),
      supervisorStaffId: opaqueId(value.assignmentDefaults.supervisorStaffId, "Supervisor staffId", { allowEmpty: true }),
      reportingLocation: text(value.assignmentDefaults.reportingLocation, 180),
      arrivalInstructions: text(value.assignmentDefaults.arrivalInstructions, 1000)
    }),
    briefingDefaults: Object.freeze({
      uniform: text(value.briefingDefaults.uniform, 500),
      parking: text(value.briefingDefaults.parking, 500),
      entrance: text(value.briefingDefaults.entrance, 500),
      mealPolicy: text(value.briefingDefaults.mealPolicy, 500),
      responsibilities: text(value.briefingDefaults.responsibilities, 1000)
    }),
    attendance: Object.freeze({
      completedAssignments: integer(value.attendance.completedAssignments, "Completed assignments"),
      lateArrivals: integer(value.attendance.lateArrivals, "Late arrivals"),
      noShows: integer(value.attendance.noShows, "No shows"),
      cancellations: integer(value.attendance.cancellations, "Cancellations"),
      lastAssignmentAtISO: exactISO(value.attendance.lastAssignmentAtISO, "Last assignment time"),
      lastResponse: text(value.attendance.lastResponse, 40).toLowerCase(),
      lastRespondedAtISO: exactISO(value.attendance.lastRespondedAtISO, "Last response time"),
      lastDeclineReason: text(value.attendance.lastDeclineReason, 500)
    }),
    reliability: Object.freeze({
      status: enumValue(value.reliability.status, RELIABILITY_STATES, "Reliability status"),
      managerRating: integer(value.reliability.managerRating, "Manager rating", { maximum: 5 }),
      notes: text(value.reliability.notes, 1000)
    }),
    privateNotes: text(value.privateNotes, 4000)
  });
}

function defaultStaffRecord({ organizationId, staffId, displayName = "", capabilities = ["server"] } = {}) {
  const normalizedCapabilities = normalizeCapabilities(capabilities);
  return normalizeStaffRecord({
    preferredName: text(displayName, 80),
    legalName: "",
    photoUrl: "",
    contact: {
      email: "",
      phone: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      preferredChannel: "email",
      emailStatus: "unverified",
      timeZone: "",
      communicationsEnabled: true,
      lastVerifiedAtISO: ""
    },
    roleDetails: normalizedCapabilities.map((role, index) => ({
      role,
      proficiency: role === "lead" ? "lead" : "capable",
      preferred: index === 0,
      acceptsAssignments: true
    })),
    qualifications: [],
    scheduling: {
      preferredHours: "",
      maxWeeklyHours: 40,
      maxConsecutiveDays: 6,
      minRestHours: 8,
      recurringAvailabilityNote: "",
      timeOffNote: ""
    },
    compensation: {
      payType: "hourly",
      currency: "USD",
      hourlyRate: 0,
      eventRate: 0,
      overtimeRate: 0,
      travelStipend: 0,
      payrollStatus: "not_ready"
    },
    travel: {
      homeBase: "",
      maxDistanceMiles: 0,
      transportation: "",
      preferredAreas: [],
      lodgingRequired: false
    },
    assignmentDefaults: {
      department: "",
      station: "",
      supervisorStaffId: "",
      reportingLocation: "",
      arrivalInstructions: ""
    },
    briefingDefaults: {
      uniform: "",
      parking: "",
      entrance: "",
      mealPolicy: "",
      responsibilities: ""
    },
    attendance: {
      completedAssignments: 0,
      lateArrivals: 0,
      noShows: 0,
      cancellations: 0,
      lastAssignmentAtISO: "",
      lastResponse: "",
      lastRespondedAtISO: "",
      lastDeclineReason: ""
    },
    reliability: {
      status: "new",
      managerRating: 0,
      notes: ""
    },
    privateNotes: ""
  }, { organizationId, staffId });
}

function projectStaffRecord(value, scope = {}) {
  if (!isRecord(value)) return defaultStaffRecord(scope);
  const draft = Object.fromEntries([
    "preferredName", "legalName", "photoUrl", "contact", "roleDetails", "qualifications",
    "scheduling", "compensation", "travel", "assignmentDefaults", "briefingDefaults",
    "attendance", "reliability", "privateNotes"
  ].map((key) => [key, value[key]]));
  const normalized = normalizeStaffRecord(draft, scope);
  return Object.freeze({
    ...normalized,
    revision: integer(value.revision, "Staff record revision", { maximum: 1_000_000_000 }),
    updatedAtISO: exactISO(value.updatedAtISO, "Staff record update time")
  });
}

function canonicalize(value) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("failed-precondition", "Staff record contains a non-finite number.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) fail("failed-precondition", "Staff record must be canonical JSON.");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalDigest(value) {
  const serialized = JSON.stringify(canonicalize(value));
  if (Buffer.byteLength(serialized, "utf8") > MAX_CANONICAL_BYTES) {
    fail("resource-exhausted", "Staff record exceeds its authority bound.");
  }
  return createHash("sha256").update(serialized).digest("hex");
}

function buildStaffRecordReceiptId({ organizationId, staffId, requestId } = {}) {
  const identity = {
    organizationId: opaqueId(organizationId, "organizationId"),
    staffId: opaqueId(staffId, "staffId"),
    requestId: text(requestId, 160, { allowEmpty: false })
  };
  return `srr_${canonicalDigest(identity).slice(0, 48)}`;
}

function planStaffRecordCommand({ request, currentRecord = null, actor, serverTimeISO, existingReceipt = null } = {}) {
  if (!isRecord(request) || !isRecord(request.record)) fail("invalid-argument", "Staff record command is required.");
  const organizationId = opaqueId(request.organizationId, "organizationId");
  const staffId = opaqueId(request.staffId, "staffId");
  const requestId = text(request.requestId, 160, { allowEmpty: false });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{15,159}$/u.test(requestId)) {
    fail("invalid-argument", "requestId must be a stable bounded command identifier.");
  }
  const expectedRevision = integer(request.expectedRevision, "Expected staff record revision", { maximum: 1_000_000_000 });
  const normalizedRecord = normalizeStaffRecord(request.record, { organizationId, staffId });
  if (!isRecord(actor) || actor.role !== "admin" || opaqueId(actor.organizationId, "Actor organizationId") !== organizationId) {
    fail("permission-denied", "Admin authority is required to manage full staff records.");
  }
  const normalizedActor = Object.freeze({
    organizationId,
    uid: opaqueId(actor.uid, "Actor uid"),
    role: "admin"
  });
  const receiptId = buildStaffRecordReceiptId({ organizationId, staffId, requestId });
  const requestDigest = canonicalDigest({ organizationId, staffId, requestId, expectedRevision, record: normalizedRecord });
  if (existingReceipt) {
    if (
      existingReceipt.receiptId !== receiptId
      || existingReceipt.requestDigest !== requestDigest
      || existingReceipt.organizationId !== organizationId
      || existingReceipt.staffId !== staffId
    ) {
      fail("already-exists", "The staff record request identity is bound to different evidence.");
    }
    return Object.freeze({ kind: "reconcile", idempotent: true, snapshot: existingReceipt.snapshot, receipt: existingReceipt });
  }
  const observedRevision = currentRecord ? integer(currentRecord.revision, "Current staff record revision", { maximum: 1_000_000_000 }) : 0;
  if (observedRevision !== expectedRevision) fail("aborted", "The staff record changed after it was opened.");
  const recordedAtISO = exactISO(serverTimeISO, "Staff record server time", { allowEmpty: false });
  const nextRecord = Object.freeze({
    ...normalizedRecord,
    revision: observedRevision + 1,
    updatedAtISO: recordedAtISO,
    updatedBy: normalizedActor
  });
  const snapshot = nextRecord;
  const receiptBase = {
    schemaVersion: 1,
    authority: "server_authoritative",
    receiptType: "staff_record_command",
    receiptVersion: STAFF_RECORD_RECEIPT_VERSION,
    receiptId,
    requestId,
    organizationId,
    staffId,
    priorRevision: observedRevision,
    resultRevision: observedRevision + 1,
    requestDigest,
    resultDigest: canonicalDigest(nextRecord),
    snapshot,
    recordedAtISO,
    recordedBy: normalizedActor
  };
  const receipt = Object.freeze({ ...receiptBase, receiptDigest: canonicalDigest(receiptBase) });
  return Object.freeze({ kind: "apply", idempotent: false, nextRecord, snapshot, receipt });
}

module.exports = {
  MAX_QUALIFICATIONS,
  STAFF_DIRECTORY_AUTHORITY_VERSION,
  STAFF_RECORD_RECEIPT_VERSION,
  STAFF_RECORD_SCHEMA_VERSION,
  STAFF_ROLES,
  StaffDirectoryAuthorityError,
  buildStaffRecordReceiptId,
  defaultStaffRecord,
  normalizeStaffRecord,
  projectStaffRecord,
  planStaffRecordCommand
};
