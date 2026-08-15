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

function envEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function envDisabled(value) {
  return ["0", "false", "no", "off"].includes(String(value || "").trim().toLowerCase());
}

function shouldUseLocalStaffDirectoryFixture() {
  const env = import.meta.env || {};
  if (!env.DEV) return false;
  if (envDisabled(env.VITE_E2E_LOCAL_REVIEW_FIXTURES)) return false;
  if (envDisabled(env.VITE_STAFF_DIRECTORY_LOCAL_SEED)) return false;
  return envEnabled(env.VITE_STAFF_DIRECTORY_LOCAL_SEED) || envEnabled(env.VITE_E2E_BYPASS_AUTH);
}

let localStaffDirectory = null;
if (import.meta.env.DEV) {
const LOCAL_STAFF_FIXTURE_STORAGE = "local_fixture";
const localStaffDirectories = new Map();

function localStaffPortrait({
  background = "#1f766b",
  shirt = "#d7a64e",
  skin = "#c89168",
  hair = "#251d17",
  initials: label = "QP"
} = {}) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="${background}"/>
          <stop offset="1" stop-color="#151617"/>
        </linearGradient>
      </defs>
      <rect width="160" height="160" fill="url(#bg)"/>
      <circle cx="80" cy="68" r="34" fill="${skin}"/>
      <path d="M45 66c4-29 22-42 45-38 19 3 31 17 31 39-22-4-42-9-68 2z" fill="${hair}"/>
      <path d="M35 160c7-34 27-52 45-52s38 18 45 52z" fill="${shirt}"/>
      <circle cx="67" cy="72" r="4" fill="#151617"/>
      <circle cx="93" cy="72" r="4" fill="#151617"/>
      <path d="M68 91c9 7 17 7 25 0" fill="none" stroke="#151617" stroke-width="5" stroke-linecap="round"/>
      <text x="80" y="146" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="#fff">${label}</text>
    </svg>
  `;
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/gu, " ").trim())}`;
}

function fixedAvailability(startAtISO, endAtISO, state = "available") {
  return {
    availabilityId: `availability-${startAtISO.slice(0, 10)}-${state}`,
    source: "operator_recorded",
    state,
    startAtISO,
    endAtISO
  };
}

function buildLocalStaffEntry(organizationId, definition) {
  const entry = createStaffRecordDraft({
    organizationId,
    staffId: definition.staffId,
    displayName: definition.displayName,
    capabilities: definition.capabilities
  });
  entry.profile.revision = definition.revision || 1;
  entry.profile.active = definition.active !== false;
  entry.profile.availabilityWindows = definition.availabilityWindows;
  entry.record.revision = definition.revision || 1;
  entry.record.updatedAtISO = definition.updatedAtISO || "2026-08-15T14:30:00.000Z";
  entry.record.preferredName = definition.preferredName || definition.displayName;
  entry.record.legalName = definition.legalName || definition.displayName;
  entry.record.photoUrl = definition.photoUrl;
  entry.record.contact = {
    ...entry.record.contact,
    email: definition.email,
    phone: definition.phone,
    emergencyContactName: definition.emergencyContactName || "",
    emergencyContactPhone: definition.emergencyContactPhone || "",
    preferredChannel: definition.preferredChannel || "email",
    emailStatus: definition.emailStatus || "verified",
    timeZone: "America/Chicago",
    communicationsEnabled: definition.communicationsEnabled !== false,
    lastVerifiedAtISO: definition.lastVerifiedAtISO || "2026-08-12T16:00:00.000Z"
  };
  entry.record.roleDetails = entry.profile.capabilities.map((role, index) => ({
    role,
    proficiency: definition.proficiency?.[role] || (role === "lead" ? "lead" : "experienced"),
    preferred: index === 0,
    acceptsAssignments: true
  }));
  entry.record.qualifications = definition.qualifications || [{
    qualificationId: `${definition.staffId}-food-handler`,
    type: "Food handler",
    number: `${definition.staffId.toUpperCase()}-FH`,
    provider: "Louisiana Department of Health",
    issuedOn: "2026-01-10",
    expiresOn: "2027-01-10",
    status: "current",
    documentUrl: "",
    notes: "Verified for local review fixture."
  }];
  entry.record.scheduling = {
    ...entry.record.scheduling,
    preferredHours: definition.preferredHours || "Weekends and evenings",
    maxWeeklyHours: definition.maxWeeklyHours || 38,
    maxConsecutiveDays: definition.maxConsecutiveDays || 5,
    minRestHours: 10,
    recurringAvailabilityNote: definition.recurringAvailabilityNote || "Confirm final call time before dispatch.",
    timeOffNote: definition.timeOffNote || ""
  };
  entry.record.compensation = {
    ...entry.record.compensation,
    payType: definition.payType || "hourly",
    currency: "USD",
    hourlyRate: definition.hourlyRate,
    eventRate: definition.eventRate || 0,
    overtimeRate: definition.overtimeRate || Math.round(definition.hourlyRate * 1.5 * 100) / 100,
    travelStipend: definition.travelStipend || 25,
    payrollStatus: definition.payrollStatus || "ready"
  };
  entry.record.travel = {
    ...entry.record.travel,
    homeBase: definition.homeBase || "Pearl River, LA",
    maxDistanceMiles: definition.maxDistanceMiles || 65,
    transportation: definition.transportation || "Personal vehicle",
    preferredAreas: definition.preferredAreas || ["Pearl River", "Slidell", "New Orleans Northshore"],
    lodgingRequired: false
  };
  entry.record.assignmentDefaults = {
    ...entry.record.assignmentDefaults,
    department: definition.department || "Service",
    station: definition.station || "",
    reportingLocation: "Venue service entrance",
    arrivalInstructions: definition.arrivalInstructions || "Arrive 60 minutes before guest service for briefing and station check."
  };
  entry.record.briefingDefaults = {
    ...entry.record.briefingDefaults,
    uniform: definition.uniform || "Black shirt, black pants, comfortable closed-toe shoes.",
    parking: "Use vendor parking unless the event lead sends a different instruction.",
    entrance: "Check in with the event lead before entering guest-facing areas.",
    mealPolicy: "Staff meal after guest service unless the lead changes timing.",
    responsibilities: definition.responsibilities || "Support setup, guest service, breakdown, and final count reconciliation."
  };
  entry.record.attendance = {
    ...entry.record.attendance,
    completedAssignments: definition.completedAssignments || 0,
    lateArrivals: definition.lateArrivals || 0,
    noShows: definition.noShows || 0,
    cancellations: definition.cancellations || 0,
    lastAssignmentAtISO: definition.lastAssignmentAtISO || "",
    lastResponse: definition.lastResponse || "",
    lastRespondedAtISO: definition.lastRespondedAtISO || ""
  };
  entry.record.reliability = {
    ...entry.record.reliability,
    status: definition.reliabilityStatus || "steady",
    managerRating: definition.managerRating || 4,
    notes: definition.reliabilityNotes || "Seeded local review record."
  };
  entry.record.privateNotes = definition.privateNotes || "";
  return entry;
}

function buildLocalStaffDirectory(organizationId) {
  const staffDefinitions = [
    {
      staffId: "staff-avery-richardson",
      displayName: "Avery Richardson",
      capabilities: ["server", "bartender"],
      hourlyRate: 27.5,
      email: "avery.staff@example.com",
      phone: "+1 555 555 0142",
      emergencyContactName: "Morgan Richardson",
      emergencyContactPhone: "+1 555 555 0192",
      department: "Front of house",
      station: "Bar and dining room",
      completedAssignments: 18,
      lastAssignmentAtISO: "2026-08-08T23:30:00.000Z",
      lastResponse: "accepted",
      lastRespondedAtISO: "2026-08-10T15:20:00.000Z",
      photoUrl: localStaffPortrait({ background: "#1f766b", shirt: "#b7842c", skin: "#bb7f5a", hair: "#2b1c16", initials: "AR" }),
      availabilityWindows: [
        fixedAvailability("2026-08-15T20:00:00.000Z", "2026-08-16T04:00:00.000Z"),
        fixedAvailability("2026-08-22T20:00:00.000Z", "2026-08-23T04:00:00.000Z"),
        fixedAvailability("2026-09-05T20:00:00.000Z", "2026-09-06T04:00:00.000Z")
      ]
    },
    {
      staffId: "staff-maya-torres",
      displayName: "Maya Torres",
      capabilities: ["lead", "server"],
      hourlyRate: 34,
      email: "maya.torres@example.com",
      phone: "+1 555 555 0160",
      emergencyContactName: "Elena Torres",
      emergencyContactPhone: "+1 555 555 0161",
      department: "Event leadership",
      station: "Captain",
      completedAssignments: 42,
      reliabilityStatus: "preferred",
      managerRating: 5,
      photoUrl: localStaffPortrait({ background: "#6d4f22", shirt: "#1f766b", skin: "#a96745", hair: "#17110d", initials: "MT" }),
      availabilityWindows: [
        fixedAvailability("2026-08-18T18:00:00.000Z", "2026-08-19T03:00:00.000Z"),
        fixedAvailability("2026-09-12T18:00:00.000Z", "2026-09-13T03:00:00.000Z"),
        fixedAvailability("2026-10-03T18:00:00.000Z", "2026-10-04T03:00:00.000Z")
      ]
    },
    {
      staffId: "staff-jalen-brooks",
      displayName: "Jalen Brooks",
      capabilities: ["chef"],
      hourlyRate: 31,
      email: "jalen.brooks@example.com",
      phone: "+1 555 555 0184",
      emergencyContactName: "Renee Brooks",
      emergencyContactPhone: "+1 555 555 0185",
      department: "Kitchen",
      station: "Hot line",
      completedAssignments: 25,
      photoUrl: localStaffPortrait({ background: "#28384a", shirt: "#b7842c", skin: "#7a4f37", hair: "#120f0e", initials: "JB" }),
      availabilityWindows: [
        fixedAvailability("2026-08-21T16:00:00.000Z", "2026-08-22T01:00:00.000Z"),
        fixedAvailability("2026-09-19T16:00:00.000Z", "2026-09-20T01:00:00.000Z")
      ]
    },
    {
      staffId: "staff-nora-patel",
      displayName: "Nora Patel",
      capabilities: ["bartender", "server"],
      hourlyRate: 29,
      email: "nora.patel@example.com",
      phone: "+1 555 555 0175",
      emergencyContactName: "Dev Patel",
      emergencyContactPhone: "+1 555 555 0176",
      department: "Beverage",
      station: "Signature bar",
      completedAssignments: 31,
      photoUrl: localStaffPortrait({ background: "#704a5b", shirt: "#1f766b", skin: "#b9865d", hair: "#1b1414", initials: "NP" }),
      availabilityWindows: [
        fixedAvailability("2026-08-29T20:00:00.000Z", "2026-08-30T04:00:00.000Z"),
        fixedAvailability("2026-09-26T20:00:00.000Z", "2026-09-27T04:00:00.000Z"),
        fixedAvailability("2026-10-10T20:00:00.000Z", "2026-10-11T04:00:00.000Z")
      ]
    },
    {
      staffId: "staff-camille-reed",
      displayName: "Camille Reed",
      capabilities: ["server"],
      hourlyRate: 23.75,
      email: "camille.reed@example.com",
      phone: "+1 555 555 0198",
      emergencyContactName: "",
      emergencyContactPhone: "",
      department: "Front of house",
      station: "Guest tables",
      completedAssignments: 7,
      managerRating: 3,
      reliabilityStatus: "review",
      photoUrl: localStaffPortrait({ background: "#8a5a2c", shirt: "#374151", skin: "#d09a72", hair: "#302016", initials: "CR" }),
      availabilityWindows: [
        fixedAvailability("2026-08-23T17:00:00.000Z", "2026-08-24T01:00:00.000Z")
      ]
    },
    {
      staffId: "staff-owen-keller",
      displayName: "Owen Keller",
      capabilities: ["chef", "server"],
      hourlyRate: 28.25,
      email: "owen.keller@example.com",
      phone: "+1 555 555 0154",
      emergencyContactName: "Paige Keller",
      emergencyContactPhone: "+1 555 555 0155",
      department: "Culinary support",
      station: "Carving and buffet",
      completedAssignments: 16,
      photoUrl: localStaffPortrait({ background: "#44513a", shirt: "#b7842c", skin: "#c58b62", hair: "#261a13", initials: "OK" }),
      availabilityWindows: [
        fixedAvailability("2026-09-04T16:00:00.000Z", "2026-09-05T00:00:00.000Z"),
        fixedAvailability("2026-10-17T16:00:00.000Z", "2026-10-18T00:00:00.000Z")
      ]
    },
    {
      staffId: "staff-lena-hart",
      displayName: "Lena Hart",
      capabilities: ["lead", "bartender"],
      hourlyRate: 36,
      email: "lena.hart@example.com",
      phone: "+1 555 555 0129",
      emergencyContactName: "Harper Hart",
      emergencyContactPhone: "+1 555 555 0130",
      department: "Event leadership",
      station: "Service captain",
      completedAssignments: 53,
      reliabilityStatus: "preferred",
      managerRating: 5,
      photoUrl: localStaffPortrait({ background: "#233047", shirt: "#d7a64e", skin: "#b87658", hair: "#2a1815", initials: "LH" }),
      availabilityWindows: [
        fixedAvailability("2026-09-12T18:00:00.000Z", "2026-09-13T04:00:00.000Z"),
        fixedAvailability("2026-10-24T18:00:00.000Z", "2026-10-25T04:00:00.000Z")
      ]
    },
    {
      staffId: "staff-darius-bell",
      displayName: "Darius Bell",
      capabilities: ["server"],
      active: false,
      hourlyRate: 0,
      email: "darius.bell@example.com",
      emailStatus: "unverified",
      phone: "+1 555 555 0118",
      emergencyContactName: "",
      emergencyContactPhone: "",
      payrollStatus: "not_ready",
      department: "Front of house",
      station: "Onboarding",
      completedAssignments: 0,
      photoUrl: localStaffPortrait({ background: "#4b5563", shirt: "#8c5f17", skin: "#70452f", hair: "#101010", initials: "DB" }),
      availabilityWindows: []
    }
  ];

  const assignments = [
    {
      assignmentId: "assignment-williams-avery-bar",
      staffId: "staff-avery-richardson",
      role: "bartender",
      state: "operator_confirmed",
      quoteId: "quote-williams-wedding",
      quoteRevisionId: "version-7",
      planRevision: 2,
      eventWindow: { startAtISO: "2026-08-22T21:00:00.000Z", endAtISO: "2026-08-23T04:00:00.000Z" },
      event: { name: "Williams Wedding", date: "2026-08-22", venue: "Riverside Hall", guests: 140 },
      selection: { packageName: "Wedding & events", menuItemNames: ["Roasted Chicken", "Shrimp and grits", "Late-night sliders"] },
      coverage: { state: "covered", gaps: {} }
    },
    {
      assignmentId: "assignment-metro-maya-lead",
      staffId: "staff-maya-torres",
      role: "lead",
      state: "operator_confirmed",
      quoteId: "quote-metro-lunch",
      quoteRevisionId: "version-3",
      planRevision: 1,
      eventWindow: { startAtISO: "2026-09-12T16:00:00.000Z", endAtISO: "2026-09-12T22:00:00.000Z" },
      event: { name: "Metro Health Leadership Lunch", date: "2026-09-12", venue: "Northshore Conference Center", guests: 90 },
      selection: { packageName: "Corporate drop-off", menuItemNames: ["Herb chicken", "Market salad"] },
      coverage: { state: "covered", gaps: {} }
    },
    {
      assignmentId: "assignment-founders-jalen-chef",
      staffId: "staff-jalen-brooks",
      role: "chef",
      state: "operator_confirmed",
      quoteId: "quote-founders-dinner",
      quoteRevisionId: "version-5",
      planRevision: 3,
      eventWindow: { startAtISO: "2026-09-19T19:00:00.000Z", endAtISO: "2026-09-20T02:00:00.000Z" },
      event: { name: "Founders Dinner", date: "2026-09-19", venue: "Magnolia Room", guests: 72 },
      selection: { packageName: "Plated dinner", menuItemNames: ["Braised short rib", "Crawfish risotto"] },
      coverage: { state: "covered", gaps: {} }
    },
    {
      assignmentId: "assignment-fall-nora-bar",
      staffId: "staff-nora-patel",
      role: "bartender",
      state: "operator_confirmed",
      quoteId: "quote-fall-gala",
      quoteRevisionId: "version-4",
      planRevision: 2,
      eventWindow: { startAtISO: "2026-10-10T21:00:00.000Z", endAtISO: "2026-10-11T04:00:00.000Z" },
      event: { name: "Fall Arts Gala", date: "2026-10-10", venue: "City Gallery", guests: 180 },
      selection: { packageName: "Premium reception", menuItemNames: ["Champagne welcome", "Passed hors d'oeuvres"] },
      coverage: { state: "attention", gaps: { server: 1 } }
    },
    {
      assignmentId: "assignment-harvest-lena-lead",
      staffId: "staff-lena-hart",
      role: "lead",
      state: "operator_confirmed",
      quoteId: "quote-harvest-benefit",
      quoteRevisionId: "version-6",
      planRevision: 2,
      eventWindow: { startAtISO: "2026-10-24T20:00:00.000Z", endAtISO: "2026-10-25T04:00:00.000Z" },
      event: { name: "Harvest Benefit", date: "2026-10-24", venue: "Oak Estate", guests: 220 },
      selection: { packageName: "Southern buffet", menuItemNames: ["Smoked brisket", "Seasonal cobbler"] },
      coverage: { state: "covered", gaps: {} }
    }
  ];
  const invitations = [{
    invitationId: "sti_williams_avery",
    staffId: "staff-avery-richardson",
    assignmentId: "assignment-williams-avery-bar",
    state: "provider_accepted",
    updatedAtISO: "2026-08-15T14:05:00.000Z",
    acknowledgement: {
      state: "accepted",
      respondedAtISO: "2026-08-15T14:12:00.000Z",
      declineReason: ""
    }
  }];
  return {
    ok: true,
    storage: LOCAL_STAFF_FIXTURE_STORAGE,
    authorityVersion: STAFF_DIRECTORY_AUTHORITY_VERSION,
    organizationId,
    state: "local_fixture",
    records: staffDefinitions
      .map((definition) => buildLocalStaffEntry(organizationId, definition))
      .sort((left, right) => left.profile.displayName.localeCompare(right.profile.displayName)),
    assignments,
    invitations,
    profilesTruncated: false,
    recordsTruncated: false,
    assignmentsTruncated: false
  };
}

function readLocalStaffDirectory(organizationId) {
  if (!localStaffDirectories.has(organizationId)) {
    localStaffDirectories.set(organizationId, buildLocalStaffDirectory(organizationId));
  }
  return clone(localStaffDirectories.get(organizationId));
}

localStaffDirectory = readLocalStaffDirectory;
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
  if (import.meta.env.DEV && shouldUseLocalStaffDirectoryFixture()) {
    return Object.freeze(localStaffDirectory(scopedOrganizationId));
  }
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
