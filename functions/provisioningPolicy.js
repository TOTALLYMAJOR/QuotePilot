"use strict";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeHostname(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
}

function isConfiguredAppHost(hostname = "", appBaseUrl = "") {
  const normalizedHost = normalizeHostname(hostname);
  const configuredAppHost = normalizeHostname(appBaseUrl);
  return Boolean(normalizedHost && configuredAppHost && normalizedHost === configuredAppHost);
}

function hasExistingProvisioningTarget({
  organizationExists = false,
  settingsExists = false
} = {}) {
  return Boolean(organizationExists || settingsExists);
}

function buildExistingOrganizationMessage(organizationId = "") {
  const id = normalizeText(organizationId) || "requested organization";
  return `Organization "${id}" already exists. No changes were made. Use an explicit tenant update workflow instead of new-customer provisioning.`;
}

function buildExistingOrderMessage(orderId = "") {
  const id = normalizeText(orderId) || "requested order";
  return `Provisioning order "${id}" already exists. No changes were made. Use a new order id.`;
}

function findConflictingOrganizationScope({
  targetOrganizationId = "",
  roleOrganizationId = "",
  claimsOrganizationId = "",
  inviteOrganizationId = ""
} = {}) {
  const target = normalizeText(targetOrganizationId).toLowerCase();
  if (!target) return "";
  return [roleOrganizationId, claimsOrganizationId, inviteOrganizationId]
    .map((value) => normalizeText(value).toLowerCase())
    .find((value) => value && value !== target) || "";
}

function canProvisionOrganization({
  targetOrganizationId = "",
  principalOrganizationId = "",
  resolvedHostOrganizationId = "",
  hasCrossOrganizationBypass = false
} = {}) {
  const target = normalizeText(targetOrganizationId).toLowerCase();
  const principal = normalizeText(principalOrganizationId).toLowerCase();
  const resolvedHost = normalizeText(resolvedHostOrganizationId).toLowerCase();
  if (!target) return false;

  // A tenant hostname is an authority boundary even for a platform operator.
  // Cross-tenant work must originate from the canonical application host.
  if (resolvedHost && target !== resolvedHost) return false;
  if (principal && target === principal) return true;
  return hasCrossOrganizationBypass === true;
}

function isAlreadyExistsError(error) {
  const code = error?.code;
  if (code === 6 || code === "6" || code === "already-exists" || code === "ALREADY_EXISTS") {
    return true;
  }
  return /already exists/i.test(normalizeText(error?.message));
}

module.exports = {
  buildExistingOrderMessage,
  buildExistingOrganizationMessage,
  canProvisionOrganization,
  findConflictingOrganizationScope,
  hasExistingProvisioningTarget,
  isAlreadyExistsError,
  isConfiguredAppHost
};
