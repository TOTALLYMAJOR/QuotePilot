import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const STAFF_DIRECTORY_CALLABLES = Object.freeze({
  read: "getStaffDirectory",
  save: "saveStaffRecord",
  previewInvitation: "previewStaffInvitation",
  dispatchInvitation: "dispatchStaffInvitation"
});

export const STAFF_DIRECTORY_AUTHORITY_VERSION = "staff-directory-authority-v1";
export const STAFF_ROLES = Object.freeze(["lead", "server", "chef", "bartender"]);

function text(value) {
  return String(value ?? "").trim();
}

function opaqueId(value, label) {
  const normalized = text(value);
  if (!normalized || normalized.length > 160 || /[\s/?#\\\u0000]/u.test(normalized)) {
    throw new Error(`${label} must be an exact opaque identifier.`);
  }
  return normalized;
}

function requestId(prefix = "staff-record") {
  const cryptoApi = globalThis.crypto;
  const suffix = typeof cryptoApi?.randomUUID === "function"
    ? cryptoApi.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${suffix}`.slice(0, 159);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createStaffRecordDraft({
  organizationId = "local-fallback",
  staffId = "new-staff",
  displayName = "",
  capabilities = ["server"]
} = {}) {
  const safeCapabilities = STAFF_ROLES.filter((role) => capabilities.includes(role));
  const roles = safeCapabilities.length ? safeCapabilities : ["server"];
  return {
    profile: {
      organizationId,
      staffId,
      displayName,
      active: true,
      capabilities: roles,
      revision: 0,
      availabilityWindows: []
    },
    record: {
      organizationId,
      staffId,
      revision: 0,
      updatedAtISO: "",
      preferredName: displayName,
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
      roleDetails: roles.map((role, index) => ({
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
    }
  };
}

function normalizeDirectoryResponse(value, organizationId) {
  if (
    !value
    || value.ok !== true
    || value.storage !== "firebase"
    || text(value.organizationId) !== organizationId
    || value.authorityVersion !== STAFF_DIRECTORY_AUTHORITY_VERSION
    || !Array.isArray(value.records)
    || !Array.isArray(value.assignments)
    || !Array.isArray(value.invitations)
  ) {
    throw new Error("Staff directory returned incomplete or mismatched authority evidence.");
  }
  return Object.freeze({
    ...clone(value),
    records: Object.freeze(value.records.map((entry) => Object.freeze(clone(entry)))),
    assignments: Object.freeze(value.assignments.map((entry) => Object.freeze(clone(entry)))),
    invitations: Object.freeze(value.invitations.map((entry) => Object.freeze(clone(entry))))
  });
}

export async function getStaffDirectory({ organizationId } = {}) {
  const scopedOrganizationId = opaqueId(organizationId, "organizationId");
  if (!firebaseReady || !cloudFunctions) {
    return Object.freeze({
      ok: false,
      storage: "local",
      authorityVersion: STAFF_DIRECTORY_AUTHORITY_VERSION,
      organizationId: scopedOrganizationId,
      state: "unavailable",
      records: Object.freeze([]),
      assignments: Object.freeze([]),
      invitations: Object.freeze([]),
      profilesTruncated: false,
      recordsTruncated: false,
      assignmentsTruncated: false
    });
  }
  const call = httpsCallable(cloudFunctions, STAFF_DIRECTORY_CALLABLES.read);
  const response = await call({ organizationId: scopedOrganizationId });
  return normalizeDirectoryResponse(response?.data, scopedOrganizationId);
}

function invitationScope({ organizationId, entry, assignment } = {}) {
  return {
    organizationId: opaqueId(organizationId, "organizationId"),
    quoteId: opaqueId(assignment?.quoteId, "quoteId"),
    staffId: opaqueId(entry?.profile?.staffId, "staffId"),
    assignmentId: opaqueId(assignment?.assignmentId, "assignmentId"),
    expectedQuoteRevisionId: opaqueId(assignment?.quoteRevisionId, "quoteRevisionId"),
    expectedPlanRevision: Number(assignment?.planRevision || 0),
    expectedRecordRevision: Number(entry?.record?.revision || 0)
  };
}

export async function previewStaffInvitation({ organizationId, entry, assignment } = {}) {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Invitation previews require the connected organization workspace.");
  }
  const payload = invitationScope({ organizationId, entry, assignment });
  const call = httpsCallable(cloudFunctions, STAFF_DIRECTORY_CALLABLES.previewInvitation);
  const response = await call(payload);
  const result = response?.data;
  if (
    !result
    || result.ok !== true
    || result.storage !== "firebase"
    || text(result.organizationId) !== payload.organizationId
    || !result.preview?.previewDigest
    || text(result.preview?.scope?.assignmentId) !== payload.assignmentId
  ) {
    throw new Error("Invitation preview returned incomplete or mismatched authority evidence.");
  }
  return Object.freeze({
    payload: Object.freeze(payload),
    preview: Object.freeze(clone(result.preview)),
    dispatchRequestId: requestId("staff-invitation")
  });
}

export async function dispatchStaffInvitation({ previewResult } = {}) {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Invitation dispatch requires the connected organization workspace.");
  }
  const payload = {
    ...(previewResult?.payload || {}),
    previewDigest: text(previewResult?.preview?.previewDigest),
    requestId: text(previewResult?.dispatchRequestId) || requestId("staff-invitation")
  };
  const call = httpsCallable(cloudFunctions, STAFF_DIRECTORY_CALLABLES.dispatchInvitation);
  const response = await call(payload);
  const result = response?.data;
  if (
    !result
    || result.ok !== true
    || result.storage !== "firebase"
    || text(result.organizationId) !== payload.organizationId
    || !result.invitation?.invitationId
  ) {
    throw new Error("Invitation dispatch returned incomplete or mismatched authority evidence.");
  }
  return Object.freeze(clone(result));
}

function recordCommandPayload(entry, organizationId, suppliedRequestId = "") {
  const profile = clone(entry?.profile || {});
  const record = clone(entry?.record || {});
  delete profile.organizationId;
  delete profile.staffId;
  delete profile.revision;
  delete profile.authority;
  delete profile.authorityVersion;
  delete profile.schemaVersion;
  delete profile.availabilityBoundary;
  delete record.organizationId;
  delete record.staffId;
  delete record.revision;
  delete record.updatedAtISO;
  delete record.authority;
  delete record.authorityVersion;
  delete record.schemaVersion;
  return {
    requestId: suppliedRequestId || requestId(),
    organizationId,
    staffId: opaqueId(entry?.profile?.staffId || entry?.record?.staffId, "staffId"),
    expectedProfileRevision: Number(entry?.profile?.revision || 0),
    expectedRecordRevision: Number(entry?.record?.revision || 0),
    profile,
    record
  };
}

export async function saveStaffRecord(entry, { organizationId, requestId: suppliedRequestId = "" } = {}) {
  const scopedOrganizationId = opaqueId(organizationId, "organizationId");
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Authoritative staff records require the connected organization workspace.");
  }
  const payload = recordCommandPayload(entry, scopedOrganizationId, suppliedRequestId);
  const call = httpsCallable(cloudFunctions, STAFF_DIRECTORY_CALLABLES.save);
  const response = await call(payload);
  const result = response?.data;
  if (
    !result
    || result.ok !== true
    || result.storage !== "firebase"
    || result.authorityVersion !== STAFF_DIRECTORY_AUTHORITY_VERSION
    || text(result.organizationId) !== scopedOrganizationId
    || text(result.staffId) !== payload.staffId
    || !result.profile
    || !result.record
    || !result.receipts?.profile
    || !result.receipts?.record
  ) {
    throw new Error("Staff record save returned incomplete or mismatched authority evidence.");
  }
  return Object.freeze({
    ...clone(result),
    entry: Object.freeze({
      profile: Object.freeze(clone(result.profile)),
      record: Object.freeze(clone(result.record))
    })
  });
}

export function withStaffRole(entry, role, enabled) {
  const next = clone(entry);
  const normalizedRole = STAFF_ROLES.includes(role) ? role : "";
  if (!normalizedRole) return next;
  const capabilities = new Set(next.profile.capabilities || []);
  if (enabled) capabilities.add(normalizedRole);
  else capabilities.delete(normalizedRole);
  if (!capabilities.size) return next;
  next.profile.capabilities = STAFF_ROLES.filter((item) => capabilities.has(item));
  const details = new Map((next.record.roleDetails || []).map((item) => [item.role, item]));
  next.record.roleDetails = next.profile.capabilities.map((item, index) => details.get(item) || ({
    role: item,
    proficiency: item === "lead" ? "lead" : "capable",
    preferred: index === 0,
    acceptsAssignments: true
  }));
  return next;
}

export function createAvailabilityWindow(index = 0) {
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
  return {
    availabilityId: `availability-${Date.now()}-${index + 1}`,
    source: "operator_recorded",
    state: "available",
    startAtISO: start.toISOString(),
    endAtISO: end.toISOString()
  };
}

export function createQualification(index = 0) {
  return {
    qualificationId: `qualification-${Date.now()}-${index + 1}`,
    type: "Food handler",
    number: "",
    provider: "",
    issuedOn: "",
    expiresOn: "",
    status: "current",
    documentUrl: "",
    notes: ""
  };
}
