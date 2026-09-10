const MATURITY_SCHEMA_VERSION = "staff-maturity-v1";

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
}

function availableWindow(windows) {
  return Array.isArray(windows) && windows.some((window) => (
    text(window?.state).toLowerCase() === "available"
    && Number.isFinite(Date.parse(window?.startAtISO))
    && Number.isFinite(Date.parse(window?.endAtISO))
    && Date.parse(window.endAtISO) > Date.parse(window.startAtISO)
  ));
}

function roleCapabilities(profile) {
  if (!Array.isArray(profile?.capabilities)) return [];
  return [...new Set(profile.capabilities.map((role) => text(role).toLowerCase()).filter(Boolean))];
}

function state(available, availableLabel, unavailableLabel, evidence = []) {
  return Object.freeze({
    state: available ? "available" : "not_yet_available",
    label: available ? availableLabel : unavailableLabel,
    evidence: Object.freeze(evidence)
  });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

/**
 * Derives descriptive staffing maturity from already-authoritative facts.
 * These states never grant permission, prove attendance, or make optional
 * enrichment part of the minimum roster identity.
 */
export function deriveStaffMaturity(entry, {
  assignments = [],
  invitationRequested = false,
  laborCostRequested = false,
  availabilityRequired = false,
  requiredQualificationTypes = []
} = {}) {
  const profile = record(entry?.profile) ? entry.profile : {};
  const privateRecord = record(entry?.record) ? entry.record : {};
  const contact = record(privateRecord.contact) ? privateRecord.contact : {};
  const compensation = record(privateRecord.compensation) ? privateRecord.compensation : {};
  const capabilities = roleCapabilities(profile);
  const rosterIdentityValid = Boolean(text(profile.displayName)) && capabilities.length > 0;
  const active = profile.active === true;
  const contactChannels = [text(contact.email), text(contact.phone)].filter(Boolean);
  const contactable = contact.communicationsEnabled !== false && contactChannels.length > 0;
  const schedulable = availableWindow(profile.availabilityWindows);
  const costAware = [compensation.hourlyRate, compensation.eventRate]
    .some(positiveMoney);
  const qualifications = Array.isArray(privateRecord.qualifications)
    ? privateRecord.qualifications : [];
  const currentQualificationTypes = new Set(qualifications
    .filter((qualification) => text(qualification?.status).toLowerCase() === "current")
    .map((qualification) => text(qualification?.type).toLowerCase())
    .filter(Boolean));
  const credentialAware = currentQualificationTypes.size > 0;
  const enrichmentSignals = [
    privateRecord.legalName,
    privateRecord.photoUrl,
    privateRecord.privateNotes,
    contact.emergencyContactPhone,
    privateRecord.scheduling?.preferredHours,
    privateRecord.travel?.homeBase,
    privateRecord.assignmentDefaults?.station,
    privateRecord.briefingDefaults?.uniform
  ];
  const enriched = enrichmentSignals.some((value) => Boolean(text(value)));
  const scopedAssignments = Array.isArray(assignments)
    ? assignments.filter((assignment) => text(assignment?.staffId) === text(profile.staffId))
    : [];

  const contextAttention = [];
  if (invitationRequested && !text(contact.email)) {
    contextAttention.push({
      code: "invitation_email_missing",
      label: "Add an email before previewing an invitation.",
      recovery: "add_contact"
    });
  }
  if (laborCostRequested && !costAware) {
    contextAttention.push({
      code: "labor_rate_missing",
      label: "Add a rate before calculating this person's labor cost.",
      recovery: "add_rate"
    });
  }
  if (availabilityRequired && !schedulable) {
    contextAttention.push({
      code: "availability_missing",
      label: "Record availability before using availability-backed scheduling.",
      recovery: "add_availability"
    });
  }
  const normalizedRequiredQualifications = [...new Set((Array.isArray(requiredQualificationTypes)
    ? requiredQualificationTypes : [])
    .map((value) => text(value).toLowerCase())
    .filter(Boolean))];
  const missingQualifications = normalizedRequiredQualifications
    .filter((value) => !currentQualificationTypes.has(value));
  if (missingQualifications.length) {
    contextAttention.push({
      code: "required_qualification_missing",
      label: "A qualification required for this assignment is not current.",
      recovery: "review_qualifications",
      qualificationTypes: missingQualifications
    });
  }

  const primaryState = !active
    ? "inactive"
    : !rosterIdentityValid
      ? "invalid_roster_identity"
      : scopedAssignments.length > 0
        ? "assigned"
        : schedulable
          ? "schedulable"
          : "rostered";

  return deepFreeze({
    schemaVersion: MATURITY_SCHEMA_VERSION,
    authority: "derived_presentation_only",
    staffId: text(profile.staffId) || null,
    active,
    rosterIdentityValid,
    capabilities,
    primaryState,
    stages: {
      rostered: state(
        active && rosterIdentityValid,
        "Rostered",
        active ? "Name and at least one role required" : "Inactive",
        active && rosterIdentityValid ? ["display_name", "role_capability", "active_state"] : []
      ),
      contactable: state(contactable, "Contactable", "Contact not recorded", contactable ? ["usable_contact_channel"] : []),
      schedulable: state(schedulable, "Schedulable", "Availability not recorded", schedulable ? ["operator_recorded_availability"] : []),
      costAware: state(costAware, "Cost-aware", "Rate not recorded", costAware ? ["recorded_compensation"] : []),
      credentialAware: state(credentialAware, "Credential-aware", "Qualifications not recorded", credentialAware ? ["current_qualification"] : []),
      enriched: state(enriched, "Enriched", "Optional details not recorded", enriched ? ["optional_enrichment"] : [])
    },
    assignmentCount: scopedAssignments.length,
    contextAttention,
    boundary: "Descriptive maturity only. Optional enrichment does not invalidate a rostered worker or grant staffing permission."
  });
}

export { MATURITY_SCHEMA_VERSION };

