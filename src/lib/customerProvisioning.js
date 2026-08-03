function cleanText(value) {
  return String(value || "").trim();
}

let fallbackOrderSequence = 0;

export function normalizeProvisioningEmail(value = "") {
  return cleanText(value).toLowerCase();
}

export function isValidProvisioningEmail(value = "") {
  const email = normalizeProvisioningEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeProvisioningOrganizationId(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function resolveProvisionOwnerUid(value = "") {
  return cleanText(value);
}

export function normalizeProvisioningOrderId(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function createCustomerProvisioningOrderId({
  randomUUID,
  now = Date.now,
  random = Math.random
} = {}) {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  const uuidFactory = typeof randomUUID === "function"
    ? randomUUID
    : typeof cryptoApi?.randomUUID === "function"
      ? () => cryptoApi.randomUUID()
      : null;
  const uuidToken = normalizeProvisioningOrderId(uuidFactory?.());
  if (uuidToken) {
    return `qp-${uuidToken}`;
  }

  fallbackOrderSequence = (fallbackOrderSequence + 1) % 1_679_616;
  const timestampValue = Number(typeof now === "function" ? now() : Date.now());
  const timestampToken = Math.max(0, Math.trunc(
    Number.isFinite(timestampValue) ? timestampValue : Date.now()
  )).toString(36);
  const randomValue = Number(typeof random === "function" ? random() : Math.random());
  const boundedRandom = Number.isFinite(randomValue)
    ? Math.min(0.999999999, Math.max(0, randomValue))
    : 0;
  const randomToken = Math.floor(boundedRandom * 2_821_109_907_455)
    .toString(36)
    .padStart(8, "0");
  const sequenceToken = fallbackOrderSequence.toString(36).padStart(4, "0");
  return `qp-${timestampToken}-${sequenceToken}-${randomToken}`;
}

export function ensureCustomerProvisioningOrderId(value = "", options = {}) {
  return normalizeProvisioningOrderId(value) || createCustomerProvisioningOrderId(options);
}

export function createCustomerProvisioningForm(appUrl = "") {
  return {
    organizationName: "",
    organizationId: "",
    ownerEmail: "",
    ownerName: "",
    ownerUid: "",
    plan: "",
    orderId: "",
    supportEmail: "",
    appUrl: cleanText(appUrl),
    sendEmail: false,
    updateExistingOrganization: false
  };
}

export function buildCustomerProvisioningPayload(form = {}, fallbackAppUrl = "") {
  const updateExistingOrganization = form.updateExistingOrganization === true;
  const organizationName = cleanText(form.organizationName);
  const ownerEmail = updateExistingOrganization ? "" : normalizeProvisioningEmail(form.ownerEmail);
  const ownerUid = updateExistingOrganization ? "" : resolveProvisionOwnerUid(form.ownerUid);
  const organizationId = normalizeProvisioningOrganizationId(form.organizationId);
  const payload = {
    organizationName,
    ownerEmail,
    ownerName: updateExistingOrganization ? "" : cleanText(form.ownerName),
    ownerUid,
    plan: cleanText(form.plan).toLowerCase(),
    orderId: normalizeProvisioningOrderId(form.orderId),
    supportEmail: updateExistingOrganization ? "" : normalizeProvisioningEmail(form.supportEmail),
    appUrl: updateExistingOrganization ? "" : cleanText(form.appUrl) || cleanText(fallbackAppUrl),
    sendEmail: updateExistingOrganization ? false : Boolean(form.sendEmail),
    updateExistingOrganization
  };
  if (organizationId) {
    payload.organizationId = organizationId;
  }
  return payload;
}

export function validateCustomerProvisioningPayload(payload = {}) {
  if (!["starter", "growth", "enterprise"].includes(cleanText(payload.plan).toLowerCase())) {
    return "Select an explicit starter, growth, or enterprise plan.";
  }
  if (payload.updateExistingOrganization === true) {
    if (!normalizeProvisioningOrganizationId(payload.organizationId)) {
      return "Organization id is required for an existing-organization update.";
    }
    return "";
  }
  if (!cleanText(payload.organizationName) || !normalizeProvisioningEmail(payload.ownerEmail)) {
    return "Organization name and owner email are required.";
  }
  if (!isValidProvisioningEmail(payload.ownerEmail)) {
    return "Enter a valid owner email address.";
  }
  if (payload.supportEmail && !isValidProvisioningEmail(payload.supportEmail)) {
    return "Enter a valid support email address.";
  }
  return "";
}

export function buildCustomerProvisioningConfirmationMessage(payload = {}, preflight = {}) {
  const organizationId = normalizeProvisioningOrganizationId(payload.organizationId) || "(unresolved)";
  const plan = cleanText(payload.plan).toLowerCase() || "(missing)";
  const orderId = normalizeProvisioningOrderId(payload.orderId) || "(missing)";
  const currentPlan = cleanText(preflight.currentPlan).toLowerCase();
  const planLine = payload.updateExistingOrganization
    ? `Plan change: ${currentPlan || "(unknown)"} → ${plan}`
    : `Plan: ${plan}`;
  const details = `Organization ID: ${organizationId}\n${planLine}\nOrder ID: ${orderId}`;

  if (payload.updateExistingOrganization === true) {
    return [
      preflight.canResume
        ? "Resume this matching entitlement order?"
        : "Update plan entitlements for this existing organization?",
      details,
      "",
      "This will not change owner identity, branding, catalog data, or invites."
    ].join("\n");
  }

  return [
    preflight.canResume
      ? `Resume provisioning ${cleanText(payload.organizationName) || "this organization"} for ${normalizeProvisioningEmail(payload.ownerEmail) || "the owner"}?`
      : `Provision ${cleanText(payload.organizationName) || "this organization"} for ${normalizeProvisioningEmail(payload.ownerEmail) || "the owner"}?`,
    details,
    "",
    "This creates a new organization, org settings, invite/role access, and a provisioning order record."
  ].join("\n");
}
